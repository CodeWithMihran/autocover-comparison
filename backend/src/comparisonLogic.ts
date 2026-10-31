import type { NormalizedQuote, Vehicle } from "./domain.js";
import { isVehicleRecord } from "./policyLogic.js";
import { parseIsoDate } from "./normalization.js";

export interface SavedComparisonRequest {
  vehicle: Vehicle;
  plans: NormalizedQuote[];
}

function isDateOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try { return parseIsoDate(value) === value; }
  catch { return false; }
}

function isQuote(value: unknown): value is NormalizedQuote {
  if (!value || typeof value !== "object") return false;
  const quote = value as Partial<NormalizedQuote>;
  const money = (amount: unknown): amount is number | null =>
    amount === null || (typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0);
  const addonsAreValid = Array.isArray(quote.addons) && quote.addons.every((addon) =>
    addon && typeof addon === "object"
    && ["zero_depreciation", "roadside_assistance", "engine_protection", "consumables", "key_replacement", "unknown"].includes(addon.concept)
    && typeof addon.sourceLabel === "string" && Boolean(addon.sourceLabel.trim()));
  return typeof quote.provider === "string" && Boolean(quote.provider.trim())
    && typeof quote.registration === "string" && Boolean(quote.registration.trim())
    && (quote.sourceQuoteId === null || typeof quote.sourceQuoteId === "string")
    && typeof quote.planName === "string" && Boolean(quote.planName.trim())
    && money(quote.totalPremiumInr) && money(quote.gstInr) && money(quote.basePremiumInr) && money(quote.idvInr)
    && ["comprehensive", "third_party", "unknown"].includes(quote.coverageType ?? "")
    && addonsAreValid
    && Array.isArray(quote.benefits) && quote.benefits.every((item) => typeof item === "string")
    && isDateOrNull(quote.validUntil)
    && ["valid", "expired", "not_yet_valid", "unknown"].includes(quote.validityStatus ?? "")
    && (quote.taxIncluded === null || typeof quote.taxIncluded === "boolean")
    && ["source_quote", "calculated_from_rate_card"].includes(quote.priceBasis ?? "")
    && Array.isArray(quote.warnings) && quote.warnings.every((item) => typeof item === "string");
}

export function isSavedComparisonRequest(value: unknown): value is SavedComparisonRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedComparisonRequest>;
  return isVehicleRecord(candidate.vehicle)
    && Array.isArray(candidate.plans)
    && candidate.plans.length >= 2
    && candidate.plans.length <= 3
    && candidate.plans.every(isQuote);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function matchesSourceQuote(source: NormalizedQuote, candidate: NormalizedQuote): boolean {
  return source.provider === candidate.provider
    && source.registration === candidate.registration
    && source.sourceQuoteId === candidate.sourceQuoteId
    && source.planName === candidate.planName
    && source.totalPremiumInr === candidate.totalPremiumInr
    && source.gstInr === candidate.gstInr
    && source.basePremiumInr === candidate.basePremiumInr
    && source.idvInr === candidate.idvInr
    && source.coverageType === candidate.coverageType
    && source.addons.length === candidate.addons.length
    && source.addons.every((addon, index) =>
      addon.concept === candidate.addons[index]?.concept && addon.sourceLabel === candidate.addons[index]?.sourceLabel)
    && sameStringArray(source.benefits, candidate.benefits)
    && source.validUntil === candidate.validUntil
    && source.validityStatus === candidate.validityStatus
    && source.taxIncluded === candidate.taxIncluded
    && source.priceBasis === candidate.priceBasis
    && sameStringArray(source.warnings, candidate.warnings);
}

