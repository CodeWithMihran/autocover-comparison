import type { AddonConcept, NormalizedQuote, Vehicle } from "./domain.js";
import { parseIsoDate, referenceDateFromEnv } from "./normalization.js";

export interface PolicyRequest {
  vehicle: Vehicle;
  quote: NormalizedQuote;
}

const addonConcepts: AddonConcept[] = [
  "zero_depreciation", "roadside_assistance", "engine_protection", "consumables", "key_replacement", "unknown",
];

function isDateOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try { return parseIsoDate(value) === value; }
  catch { return false; }
}

export function isNormalizedQuote(value: unknown): value is NormalizedQuote {
  if (!value || typeof value !== "object") return false;
  const quote = value as Partial<NormalizedQuote>;
  const isNonEmpty = (candidate: unknown): candidate is string => typeof candidate === "string" && Boolean(candidate.trim());
  const isMoney = (amount: unknown): amount is number | null =>
    amount === null || (typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0);
  const addonsAreValid = Array.isArray(quote.addons) && quote.addons.every((addon) =>
    addon && typeof addon === "object"
    && addonConcepts.includes(addon.concept)
    && isNonEmpty(addon.sourceLabel));
  return isNonEmpty(quote.provider)
    && isNonEmpty(quote.registration)
    && (quote.sourceQuoteId === null || typeof quote.sourceQuoteId === "string")
    && isNonEmpty(quote.planName)
    && isMoney(quote.totalPremiumInr) && isMoney(quote.gstInr) && isMoney(quote.basePremiumInr) && isMoney(quote.idvInr)
    && ["comprehensive", "third_party", "unknown"].includes(quote.coverageType ?? "")
    && addonsAreValid
    && Array.isArray(quote.benefits) && quote.benefits.every((item) => typeof item === "string")
    && isDateOrNull(quote.validUntil)
    && ["valid", "expired", "not_yet_valid", "unknown"].includes(quote.validityStatus ?? "")
    && (quote.taxIncluded === null || typeof quote.taxIncluded === "boolean")
    && ["source_quote", "calculated_from_rate_card"].includes(quote.priceBasis ?? "")
    && Array.isArray(quote.warnings) && quote.warnings.every((item) => typeof item === "string");
}

export function isVehicleRecord(value: unknown, referenceDate = referenceDateFromEnv()): value is Vehicle {
  if (!value || typeof value !== "object") return false;
  const vehicle = value as Partial<Vehicle>;
  const isNonEmpty = (candidate: unknown): candidate is string => typeof candidate === "string" && candidate.trim().length > 0;
  const isDateOnly = (candidate: unknown): candidate is string => {
    if (typeof candidate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
    try { return parseIsoDate(candidate) === candidate; }
    catch { return false; }
  };
  const registrationDate = vehicle.registrationDate;
  const registrationDateIsValid = isDateOnly(registrationDate);
  const currentPolicyExpiry = vehicle.currentPolicyExpiry;
  const expiryIsValid = currentPolicyExpiry === null
    || (isDateOnly(currentPolicyExpiry) && registrationDateIsValid && currentPolicyExpiry >= registrationDate);
  return isNonEmpty(vehicle.registration) && isNonEmpty(vehicle.make) && isNonEmpty(vehicle.model)
    && isNonEmpty(vehicle.variant) && isNonEmpty(vehicle.rto)
    && (vehicle.fuelType === null || isNonEmpty(vehicle.fuelType))
    && registrationDateIsValid && typeof registrationDate === "string" && registrationDate <= referenceDate && expiryIsValid
    && typeof vehicle.engineCc === "number" && Number.isSafeInteger(vehicle.engineCc) && vehicle.engineCc > 0
    && typeof vehicle.exShowroomPriceInr === "number" && Number.isSafeInteger(vehicle.exShowroomPriceInr) && vehicle.exShowroomPriceInr > 0
    && typeof vehicle.ncbPercent === "number" && Number.isFinite(vehicle.ncbPercent) && vehicle.ncbPercent >= 0 && vehicle.ncbPercent <= 100
    && typeof vehicle.claimsLastYear === "number" && Number.isSafeInteger(vehicle.claimsLastYear) && vehicle.claimsLastYear >= 0;
}

export function isPolicyRequest(value: unknown): value is PolicyRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PolicyRequest>;
  const vehicle = candidate.vehicle;
  const quote = candidate.quote;
  if (!vehicle || !isVehicleRecord(vehicle) || !isNormalizedQuote(quote)) return false;
  const isNonEmpty = (candidate: unknown): candidate is string => typeof candidate === "string" && candidate.trim().length > 0;
  return isNonEmpty(quote.provider) && isNonEmpty(quote.planName)
    && isNonEmpty(quote.registration) && typeof quote.totalPremiumInr === "number"
    && Number.isSafeInteger(quote.totalPremiumInr)
    && quote.totalPremiumInr >= 0 && Array.isArray(quote.addons) && Array.isArray(quote.warnings);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mockPolicyDates(vehicle: Vehicle, referenceDate: string): { start: string; end: string } {
  const start = vehicle.currentPolicyExpiry && vehicle.currentPolicyExpiry >= referenceDate
    ? addDays(vehicle.currentPolicyExpiry, 1)
    : referenceDate;
  const [year, month, day] = start.split("-").map(Number);
  const anniversary = new Date(Date.UTC(year + 1, month - 1, day));
  if (anniversary.getUTCMonth() !== month - 1) anniversary.setUTCDate(0);
  const end = addDays(anniversary.toISOString().slice(0, 10), -1);
  return { start, end };
}

export type PolicyExpiryStatus = "active" | "expiring_soon" | "expired";

export function policyExpiryStatus(policyEnd: string, referenceDate: string): PolicyExpiryStatus {
  if (policyEnd < referenceDate) return "expired";
  return policyEnd <= addDays(referenceDate, 15) ? "expiring_soon" : "active";
}
