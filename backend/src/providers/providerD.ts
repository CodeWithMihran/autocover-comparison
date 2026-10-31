import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { ProviderParseResult, emptyResult } from "../domain.js";
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

interface CsvQuote {
  reg_no: string;
  vehicle: string;
  plan: string;
  premium_incl_gst: string;
  idv: string;
  addons: string;
  valid_till: string;
}

const REQUIRED_COLUMNS = ["reg_no", "vehicle", "plan", "premium_incl_gst", "idv", "addons", "valid_till"];

export async function parseProviderD(
  path: string,
  registration?: string,
  referenceDate = referenceDateFromEnv(),
  knownRegistrations?: Set<string>,
): Promise<ProviderParseResult> {
  const source = await readFile(path, "utf8");
  const rows = parse(source, { columns: true, bom: true, skip_empty_lines: true, trim: true }) as CsvQuote[];
  const columns = Object.keys(rows[0] ?? {});
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length) throw new Error(`Provider D CSV is missing columns: ${missing.join(", ")}`);
  const result = emptyResult("Provider D");
  const requested = registration ? normalizeRegistration(registration) : null;

  for (const row of rows) {
    if (!row || typeof row.reg_no !== "string" || !row.reg_no.trim()) {
      result.warnings.push("Skipped a Provider D row with no registration number.");
      continue;
    }
    const reg = normalizeRegistration(row.reg_no);
    if (requested && reg !== requested) continue;
    const warnings = [
      "Price includes GST, but the source does not provide the GST amount.",
      "Coverage type is not explicitly stated in the source.",
    ];
    const parsedValidUntil = parseDateSafely(row.valid_till, warnings, "Quote expiry");
    const totalPremiumInr = parseMoneySafely(row.premium_incl_gst, warnings, "Provider D premium");
    const idvInr = parseIdvSafely(row.idv, warnings);
    if (totalPremiumInr === null) warnings.push("The source did not provide a usable premium amount.");
    if (idvInr === null) warnings.push("The source did not provide a usable IDV amount.");
    if (knownRegistrations && !knownRegistrations.has(reg)) {
      warnings.push("Registration is not present in the supplied vehicle registry.");
    }
    result.quotes.push({
      provider: result.provider,
      registration: reg,
      sourceQuoteId: null,
      planName: typeof row.plan === "string" && row.plan.trim() ? row.plan.trim() : "Unnamed plan",
      totalPremiumInr,
      gstInr: null,
      basePremiumInr: null,
      idvInr,
      coverageType: "unknown",
      addons: (typeof row.addons === "string" ? row.addons : "").split("|").map((item) => item.trim()).filter(Boolean).map(normalizeAddon),
      benefits: [],
      validUntil: parsedValidUntil,
      validityStatus: validityFor(parsedValidUntil, referenceDate),
      taxIncluded: true,
      priceBasis: "source_quote",
      warnings,
    });
  }
  result.quotes = dedupeQuotes(result.quotes, result.warnings);
  return result;
}
