import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { CoverageType, ProviderParseResult, emptyResult } from "../domain.js";
import {
  dedupeQuotes,
  normalizeAddon,
  normalizeRegistration,
  parseDateSafely,
  parseIdvSafely,
  parseMoneySafely,
  referenceDateFromEnv,
  validityFor,
} from "../normalization.js";

interface EmbeddedQuote {
  total: string;
  tax_note?: string;
  cover: string;
  valid_till: string;
}

function parseEmbeddedQuotes(html: string): Record<string, EmbeddedQuote> {
  const body = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .find((text) => text.includes("window.__QUOTE_DATA__"));
  const match = body?.match(/window\.__QUOTE_DATA__\s*=\s*(\{.*?\})\s*;\s*document\./s);
  if (!match) throw new Error("Provider B HTML did not contain its embedded __QUOTE_DATA__ object.");
  return JSON.parse(match[1]) as Record<string, EmbeddedQuote>;
}

export async function parseProviderB(
  path: string,
  registration?: string,
  referenceDate = referenceDateFromEnv(),
): Promise<ProviderParseResult> {
  const html = await readFile(path, "utf8");
  const $ = load(html);
  const embeddedQuotes = parseEmbeddedQuotes(html);
  const result = emptyResult("Provider B");
  const requested = registration ? normalizeRegistration(registration) : null;

  $("section.vehicle").each((_, section) => {
    const vehicle = $(section);
    const reg = normalizeRegistration(vehicle.attr("data-reg") ?? "");
    if (!reg) {
      result.warnings.push("Skipped Provider B vehicle section with no registration.");
      return;
    }
    if (requested && reg !== requested) return;

    vehicle.find("div.plan-card").each((_, card) => {
      const plan = $(card);
      const planId = plan.attr("data-plan-id");
      if (!planId) {
        const message = plan.text().replace(/\s+/g, " ").trim();
        if (/not available/i.test(message)) {
          result.declines.push({ provider: result.provider, registration: reg, planName: null, reason: message });
        }
        return;
      }

      const payload = embeddedQuotes[planId];
      if (!payload) {
        result.warnings.push(`No embedded price data for ${planId} (${reg}).`);
        return;
      }
      const planName = plan.find("h3").first().text().trim() || planId;
      const sourceAddons = plan.find("ul.addons li").toArray().map((item) => $(item).text().trim());
      const addons = sourceAddons.map(normalizeAddon);
      const benefits = sourceAddons.filter((_, index) => addons[index].concept === "unknown");
      const warnings: string[] = [];
      const validUntil = parseDateSafely(payload.valid_till, warnings, "Quote expiry");
      const cover = parseIdvSafely(payload.cover, warnings);
      const taxNote = typeof payload.tax_note === "string" ? payload.tax_note.trim() : "";
      const isTaxInclusive = /\b(?:incl\.?|included|inclusive)\b/i.test(taxNote);
      const isTaxExclusive = /\b(?:excl\.?|excluded|exclusive|excluding)\b/i.test(taxNote);
      const sourceAmount = parseMoneySafely(payload.total, warnings, "Provider B premium");
      const taxBasis = isTaxInclusive === isTaxExclusive ? null : isTaxInclusive;
      const totalPremiumInr = taxBasis === true ? sourceAmount : null;
      if (sourceAmount === null) warnings.push("Provider B did not provide a usable premium amount.");
      warnings.push(taxBasis === true
        ? `Price includes taxes (${taxNote}), but the source does not provide a GST breakdown.`
        : taxBasis === false
          ? `The source amount excludes taxes (${taxNote}); total premium cannot be calculated because no tax breakdown is provided.`
          : isTaxInclusive && isTaxExclusive
            ? `The tax note is contradictory (${taxNote}); the source amount is not treated as a total.`
            : `Tax inclusion is unclear in the source${taxNote ? ` (${taxNote})` : ""}; the source amount is not treated as a total.`);
      if (sourceAmount !== null && taxBasis === null) {
        warnings.push(`Source amount ${sourceAmount} INR is retained in this note but is not represented as the total premium.`);
      }
      warnings.push("Coverage type is not explicitly stated in the source.");
      if (cover === null) warnings.push("Provider B cover/IDV was not provided or could not be parsed.");

      result.quotes.push({
        provider: result.provider,
        registration: reg,
        sourceQuoteId: planId,
        planName,
        totalPremiumInr,
        gstInr: null,
        basePremiumInr: taxBasis === false ? sourceAmount : null,
        idvInr: cover,
        coverageType: "unknown" satisfies CoverageType,
        addons,
        benefits,
        validUntil,
        validityStatus: validityFor(validUntil, referenceDate),
        taxIncluded: taxBasis,
        priceBasis: "source_quote",
        warnings,
      });
    });
  });

  result.quotes = dedupeQuotes(result.quotes, result.warnings);
  return result;
}
