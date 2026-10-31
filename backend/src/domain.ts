export type CoverageType = "comprehensive" | "third_party" | "unknown";
export type ValidityStatus = "valid" | "expired" | "not_yet_valid" | "unknown";
export type AddonConcept =
  | "zero_depreciation"
  | "roadside_assistance"
  | "engine_protection"
  | "consumables"
  | "key_replacement"
  | "unknown";

export interface NormalizedAddon {
  concept: AddonConcept;
  sourceLabel: string;
}

export interface NormalizedQuote {
  provider: string;
  registration: string;
  sourceQuoteId: string | null;
  planName: string;
  totalPremiumInr: number | null;
  gstInr: number | null;
  basePremiumInr: number | null;
  idvInr: number | null;
  coverageType: CoverageType;
  addons: NormalizedAddon[];
  benefits: string[];
  validUntil: string | null;
  validityStatus: ValidityStatus;
  taxIncluded: boolean | null;
  priceBasis: "source_quote" | "calculated_from_rate_card";
  warnings: string[];
}

export interface ProviderDecline {
  provider: string;
  registration: string;
  planName: string | null;
  reason: string;
}

export interface ProviderParseResult {
  provider: string;
  quotes: NormalizedQuote[];
  declines: ProviderDecline[];
  warnings: string[];
}

export interface Vehicle {
  registration: string;
  make: string;
  model: string;
  variant: string;
  fuelType: string | null;
  engineCc: number;
  registrationDate: string;
  rto: string;
  exShowroomPriceInr: number;
  ncbPercent: number;
  claimsLastYear: number;
  currentPolicyExpiry: string | null;
}

export function emptyResult(provider: string): ProviderParseResult {
  return { provider, quotes: [], declines: [], warnings: [] };
}
