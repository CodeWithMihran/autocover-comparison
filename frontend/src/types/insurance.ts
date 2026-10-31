/** API contract shared with backend/src/domain.ts. Currency values are whole INR. */
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
  /** Null when the source does not provide enough tax data to calculate a total. */
  totalPremiumInr: number | null;
  /** Null when the source omits the GST amount or tax rate. */
  gstInr: number | null;
  /** Known pre-tax subtotal, when supplied or calculated. */
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

export interface SavedComparison {
  id: string;
  registration: string;
  vehicle: Vehicle;
  plans: NormalizedQuote[];
  createdAt: string;
}
