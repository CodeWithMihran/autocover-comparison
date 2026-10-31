import { AddonConcept, NormalizedAddon, NormalizedQuote, ValidityStatus } from "./domain.js";

export const DEFAULT_REFERENCE_DATE = "2026-11-10";

export function referenceDateFromEnv(): string {
  const value = process.env.AUTOCOVER_REFERENCE_DATE ?? DEFAULT_REFERENCE_DATE;
  let parsed: string | null;
  try { parsed = parseIsoDate(value); }
  catch { throw new Error("AUTOCOVER_REFERENCE_DATE must be a valid YYYY-MM-DD date."); }
  if (parsed !== value) throw new Error("AUTOCOVER_REFERENCE_DATE must be a valid YYYY-MM-DD date.");
  return value;
}

export function normalizeRegistration(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function parseIsoDate(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const input = value.trim();
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(.+))?$/);
  if (iso) {
    const [, year, month, day, time] = iso;
    const normalized = `${year}-${month}-${day}`;
    const parsedDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    const dateIsValid = parsedDate.getUTCFullYear() === Number(year)
      && parsedDate.getUTCMonth() === Number(month) - 1
      && parsedDate.getUTCDate() === Number(day);
    if (dateIsValid && (!time || Number.isFinite(Date.parse(input)))) return normalized;
  }
  const dayFirst = input.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    return parseIsoDate(`${year}-${month}-${day}`);
  }
  throw new Error(`Unsupported date value: ${JSON.stringify(value)}`);
}

export function validityFor(validUntil: string | null, referenceDate: string): ValidityStatus {
  if (!validUntil) return "unknown";
  return validUntil >= referenceDate ? "valid" : "expired";
}

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function parseMoney(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  let amount: number;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Unsupported money value: ${JSON.stringify(value)}`);
    amount = value;
  } else {
    const match = value.replace(/₹/g, "").trim().match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*(lakh|lakhs|l)?$/i);
    if (!match) throw new Error(`Unsupported money value: ${JSON.stringify(value)}`);
    const numeric = match[1];
    if (numeric.includes(",")
      && !/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d+)?$/.test(numeric)) {
      throw new Error(`Unsupported money grouping: ${JSON.stringify(value)}`);
    }
    amount = Number(numeric.replace(/,/g, "")) * (match[2] ? 100_000 : 1);
  }
  const rounded = roundHalfUp(amount);
  if (!Number.isSafeInteger(rounded)) throw new Error(`Money value exceeds the supported INR precision: ${JSON.stringify(value)}`);
  return rounded;
}

export function parseIdv(value: string | number | null | undefined): number | null {
  const amount = parseMoney(value);
  return amount !== null && amount > 0 ? amount : null;
}

export function parseMoneySafely(
  value: string | number | null | undefined,
  warnings: string[],
  fieldLabel: string,
): number | null {
  try { return parseMoney(value); }
  catch { warnings.push(`${fieldLabel} could not be parsed; its normalized value is unknown.`); return null; }
}

export function parseIdvSafely(
  value: string | number | null | undefined,
  warnings: string[],
): number | null {
  try { return parseIdv(value); }
  catch { warnings.push("IDV could not be parsed; its normalized value is unknown."); return null; }
}

export function parseDateSafely(
  value: string | null | undefined,
  warnings: string[],
  fieldLabel: string,
): string | null {
  try { return parseIsoDate(value); }
  catch { warnings.push(`${fieldLabel} could not be parsed; date validity is unknown.`); return null; }
}

const ADDON_ALIASES: Array<[AddonConcept, string[]]> = [
  ["zero_depreciation", ["zero dep", "zero depreciation", "nil depreciation", "bumper to bumper"]],
  ["roadside_assistance", ["rsa", "roadside assistance", "24x7 roadside"]],
  ["engine_protection", ["engine protect", "engine protection", "engine & gearbox protection"]],
  ["consumables", ["consumables"]],
  ["key_replacement", ["key replacement", "key protect"]],
];

export function normalizeAddon(label: string): NormalizedAddon {
  const lower = label.toLowerCase().replace(/\s+/g, " ").trim();
  const found = ADDON_ALIASES.find(([, aliases]) => aliases.some((alias) =>
    alias === "rsa" ? /\brsa\b/.test(lower) : lower.includes(alias)));
  return { concept: found?.[0] ?? "unknown", sourceLabel: label.trim() };
}

export function dedupeQuotes(quotes: NormalizedQuote[], warnings: string[]): NormalizedQuote[] {
  const seen = new Set<string>();
  return quotes.filter((quote) => {
    const key = JSON.stringify(quote);
    if (seen.has(key)) {
      warnings.push(`Removed exact duplicate quote for ${quote.registration} / ${quote.planName}.`);
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function addQuoteValidity(
  quote: Omit<NormalizedQuote, "validityStatus">,
  referenceDate: string,
): NormalizedQuote {
  return { ...quote, validityStatus: validityFor(quote.validUntil, referenceDate) };
}
