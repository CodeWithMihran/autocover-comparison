import type { NormalizedQuote, Vehicle } from "./domain.js";
import { isNormalizedQuote, isVehicleRecord } from "./policyLogic.js";

export interface SavedComparisonRequest {
  vehicle: Vehicle;
  plans: NormalizedQuote[];
}

export function isSavedComparisonRequest(value: unknown): value is SavedComparisonRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedComparisonRequest>;
  return isVehicleRecord(candidate.vehicle)
    && Array.isArray(candidate.plans)
    && candidate.plans.length >= 2
    && candidate.plans.length <= 3
    && candidate.plans.every(isNormalizedQuote);
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

export function hasDuplicatePlans(plans: NormalizedQuote[]): boolean {
  return plans.some((plan, index) => plans.slice(0, index).some((previous) => matchesSourceQuote(previous, plan)));
}

