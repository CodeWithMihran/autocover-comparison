import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseProviderA } from "../src/providers/providerA.js";
import { parseProviderB } from "../src/providers/providerB.js";
import { parseProviderC } from "../src/providers/providerC.js";
import { parseProviderD } from "../src/providers/providerD.js";
import { normalizeAddon, normalizeRegistration, parseIsoDate, parseMoney, referenceDateFromEnv } from "../src/normalization.js";
import { loadVehicles } from "../src/vehicles.js";

const ROOT = process.cwd();
const DATA = resolve(ROOT, "data");
const AS_OF = "2026-11-10";

test("registration and date normalization support supplied formats", () => {
  assert.equal(normalizeRegistration(" kl-07-de 3030 "), "KL07DE3030");
  assert.equal(parseIsoDate("15/12/2026"), "2026-12-15");
  assert.equal(parseIsoDate("30-11-2026"), "2026-11-30");
  assert.equal(parseIsoDate("2026-11-30T23:59:00+05:30"), "2026-11-30");
  assert.throws(() => parseIsoDate("2026-02-30"));
  assert.throws(() => parseIsoDate("2026-11-10junk"));
  assert.equal(parseMoney("   "), null);
  assert.equal(parseMoney("₹1,23,456"), 123_456);
  assert.throws(() => parseMoney("₹1,2,3"), /money grouping/);
  assert.throws(() => parseMoney(-10));
  assert.throws(() => parseMoney("9007199254740992"), /supported INR precision/);
  assert.equal(normalizeAddon("RSA").concept, "roadside_assistance");
  assert.equal(normalizeAddon("Universal roadside package").concept, "unknown");
});

test("reference date configuration must be a valid ISO calendar date", () => {
  const previous = process.env.AUTOCOVER_REFERENCE_DATE;
  try {
    process.env.AUTOCOVER_REFERENCE_DATE = "2026-13-01";
    assert.throws(() => referenceDateFromEnv(), /valid YYYY-MM-DD/);
  } finally {
    if (previous === undefined) delete process.env.AUTOCOVER_REFERENCE_DATE;
    else process.env.AUTOCOVER_REFERENCE_DATE = previous;
  }
});

test("Provider A calculates explicit GST, keeps missing GST unknown, and removes duplicates", async () => {
  const all = await parseProviderA(resolve(DATA, "provider_a.json"), undefined, AS_OF);
  assert.equal(all.quotes.length, 28);
  assert.equal(all.declines.length, 2);
  assert.ok(all.warnings.some((warning) => warning.toLowerCase().includes("duplicate")));

  const swift = await parseProviderA(resolve(DATA, "provider_a.json"), "WB 02 AB 1234", AS_OF);
  assert.equal(swift.quotes.length, 3);
  const essential = swift.quotes.find((quote) => quote.planName === "Essential")!;
  assert.equal(essential.totalPremiumInr, 11_759);
  assert.equal(essential.gstInr, 1_794);

  const missingTax = await parseProviderA(resolve(DATA, "provider_a.json"), "MH12EF4321", AS_OF);
  const missingTaxEssential = missingTax.quotes.find((quote) => quote.planName === "Essential")!;
  assert.equal(missingTaxEssential.basePremiumInr, 19_459);
  assert.equal(missingTaxEssential.totalPremiumInr, null);
  assert.equal(missingTaxEssential.gstInr, null);

  const inclusive = await parseProviderA(resolve(DATA, "provider_a.json"), "DL3CAB0042", AS_OF);
  const plus = inclusive.quotes.find((quote) => quote.planName === "Comprehensive Plus")!;
  assert.equal(plus.totalPremiumInr, 34_370);
  assert.equal(plus.gstInr, null);

  const expired = await parseProviderA(resolve(DATA, "provider_a.json"), "KL07DE3030", AS_OF);
  assert.ok(expired.quotes.every((quote) => quote.validityStatus === "expired"));
});

test("Provider A isolates malformed row fields and does not label non-GST taxes as GST", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "autocover-provider-a-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "quotes.json");
  await writeFile(path, JSON.stringify({ quotes: [
    {
      registration: "WB02AB1234", status: "quoted", plan: "Other Tax", coverage: "third party",
      base_premium: 1000, taxes: [{ name: "SERVICE_FEE", rate: 0.1 }], addons: [], valid_until: "2026-11-30",
    },
    {
      registration: "WB02AB1234", status: "QUOTED", plan: "Bad Tax Row", base_premium: 1000,
      taxes: [{ name: "GST", rate: -0.18 }], idv: "not money", valid_until: "not a date",
    },
  ] }));

  const result = await parseProviderA(path, "WB02AB1234", AS_OF);
  assert.equal(result.quotes.length, 2);
  assert.equal(result.quotes[0].totalPremiumInr, 1100);
  assert.equal(result.quotes[0].gstInr, null);
  assert.equal(result.quotes[0].coverageType, "third_party");
  assert.equal(result.quotes[1].totalPremiumInr, null);
  assert.equal(result.quotes[1].idvInr, null);
  assert.equal(result.quotes[1].validityStatus, "unknown");
  assert.ok(result.quotes[1].warnings.some((warning) => warning.includes("invalid")));
});

test("Provider A isolates unsupported row shapes and unsafe premium values", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "autocover-provider-a-shapes-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "quotes.json");
  await writeFile(path, JSON.stringify({ quotes: [
    {
      registration: "WB02AB1234", status: "QUOTED", plan: "Unsafe amount", coverage: { value: "COMPREHENSIVE" },
      base_premium: 10_000_000_000_000_000, taxes: [{ name: 12, rate: 0.18 }],
    },
  ] }));

  const result = await parseProviderA(path, "WB02AB1234", AS_OF);
  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0].totalPremiumInr, null);
  assert.equal(result.quotes[0].gstInr, null);
  assert.equal(result.quotes[0].coverageType, "unknown");
  assert.ok(result.quotes[0].warnings.some((warning) => warning.includes("supported INR range")));
});

test("Provider B joins HTML cards to their embedded JavaScript quote payload", async () => {
  const all = await parseProviderB(resolve(DATA, "provider_b.html"), undefined, AS_OF);
  assert.equal(all.quotes.length, 26);
  assert.equal(all.declines.length, 2);
  const first = all.quotes.find((quote) => quote.sourceQuoteId === "B-101")!;
  assert.equal(first.totalPremiumInr, 12_830);
  assert.equal(first.idvInr, 310_000);
  assert.equal(first.gstInr, null);
  assert.equal(first.taxIncluded, true);
  assert.ok(first.warnings.some((warning) => warning.includes("incl. taxes")));
  assert.equal(first.addons[0].concept, "zero_depreciation");
  assert.equal(first.addons[1].concept, "roadside_assistance");

  const maxPlan = (await parseProviderB(resolve(DATA, "provider_b.html"), "WB02AB1234", AS_OF))
    .quotes.find((quote) => quote.planName === "Smart Shield Max")!;
  assert.deepEqual(maxPlan.benefits, ["Total Cover"]);
  assert.ok(maxPlan.addons.some((addon) => addon.concept === "key_replacement"));

  const expired = (await parseProviderB(resolve(DATA, "provider_b.html"), "TN09XY3456", AS_OF)).quotes[0];
  assert.equal(expired.validityStatus, "expired");
});

test("Provider B does not mistake an unknown tax basis for a GST-inclusive total", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "autocover-provider-b-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "quotes.html");
  const html = await readFile(resolve(DATA, "provider_b.html"), "utf8");
  await writeFile(path, html.replace('"tax_note": "incl. taxes"', '"tax_note": "tax basis pending"'));

  const result = await parseProviderB(path, "WB02AB1234", AS_OF);
  const quote = result.quotes.find((item) => item.sourceQuoteId === "B-101")!;
  assert.equal(quote.totalPremiumInr, null);
  assert.equal(quote.basePremiumInr, null);
  assert.equal(quote.taxIncluded, null);
  assert.ok(quote.warnings.some((warning) => warning.includes("not represented as the total premium")));
});

test("Provider C extracts the PDF rate card, calculates quotes, and reports eligibility declines", async () => {
  const result = await parseProviderC(
    resolve(DATA, "provider_c.pdf"),
    resolve(DATA, "registry.json"),
    undefined,
    AS_OF,
  );
  assert.equal(result.quotes.length, 18);
  assert.equal(result.declines.length, 4);

  const standard = result.quotes.find((quote) => quote.registration === "WB02AB1234" && quote.planName === "C-Standard")!;
  assert.equal(standard.idvInr, 325_000);
  assert.equal(standard.basePremiumInr, 9_965);
  assert.equal(standard.gstInr, 1_794);
  assert.equal(standard.totalPremiumInr, 11_759);
  assert.equal(standard.priceBasis, "calculated_from_rate_card");

  const shield = result.quotes.find((quote) => quote.registration === "WB02AB1234" && quote.planName === "C-Shield")!;
  assert.equal(shield.totalPremiumInr, 14_038);
  assert.deepEqual(new Set(shield.addons.map((addon) => addon.concept)), new Set([
    "zero_depreciation", "roadside_assistance", "consumables",
  ]));
  assert.ok(result.declines.some((decline) => decline.registration === "TN09XY3456" && decline.planName === "C-Shield"));
  assert.ok(result.declines.some((decline) => decline.registration === "WB06CD5678" && decline.planName === null));

  const beforeEffective = await parseProviderC(
    resolve(DATA, "provider_c.pdf"), resolve(DATA, "registry.json"), "WB02AB1234", "2020-01-01",
  );
  assert.ok(beforeEffective.quotes.every((quote) => quote.validityStatus === "not_yet_valid"));
});

test("Provider D parses quoted INR/lakh values, expires stale quotes, and flags unknown registrations", async () => {
  const vehicles = await loadVehicles(resolve(DATA, "registry.json"));
  const result = await parseProviderD(
    resolve(DATA, "provider_d.csv"),
    undefined,
    AS_OF,
    new Set(vehicles.keys()),
  );
  assert.equal(result.quotes.length, 10);
  assert.ok(result.warnings.some((warning) => warning.toLowerCase().includes("duplicate")));
  const basic = result.quotes.find((quote) => quote.registration === "WB02AB1234" && quote.planName === "Basic")!;
  assert.equal(basic.totalPremiumInr, 11_670);
  assert.equal(basic.idvInr, 330_000);
  assert.equal(basic.gstInr, null);
  const unknownRegistration = result.quotes.find((quote) => quote.registration === "WB02AB9999")!;
  assert.ok(unknownRegistration.warnings.some((warning) => warning.includes("not present")));
  const expired = result.quotes.find((quote) => quote.registration === "DL3CAB0042" && quote.planName === "Basic")!;
  assert.equal(expired.validityStatus, "expired");
});
