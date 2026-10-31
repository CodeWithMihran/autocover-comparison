import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedQuote, Vehicle } from "../src/domain.js";
import { isSavedComparisonRequest, matchesSourceQuote } from "../src/comparisonLogic.js";

const vehicle: Vehicle = {
  registration: "WB02AB1234",
  make: "Maruti Suzuki",
  model: "Swift",
  variant: "VXi",
  fuelType: "Petrol",
  engineCc: 1197,
  registrationDate: "2022-08-14",
  rto: "Kolkata",
  exShowroomPriceInr: 650000,
  ncbPercent: 35,
  claimsLastYear: 0,
  currentPolicyExpiry: "2026-11-20",
};

const quote = (provider: string, planName: string, sourceQuoteId: string | null): NormalizedQuote => ({
  provider,
  registration: vehicle.registration,
  sourceQuoteId,
  planName,
  totalPremiumInr: 11759,
  gstInr: 1794,
  basePremiumInr: 9965,
  idvInr: 325000,
  coverageType: "comprehensive",
  addons: [{ concept: "roadside_assistance", sourceLabel: "RSA" }],
  benefits: [],
  validUntil: "2026-11-30",
  validityStatus: "valid",
  taxIncluded: false,
  priceBasis: "source_quote",
  warnings: [],
});

test("saved comparison validation requires two or three structurally valid plans and a vehicle", () => {
  const first = quote("Provider A", "Essential", null);
  const second = quote("Provider B", "Saver", "B-101");
  assert.equal(isSavedComparisonRequest({ vehicle, plans: [first, second] }), true);
  assert.equal(isSavedComparisonRequest({ vehicle, plans: [first] }), false);
  assert.equal(isSavedComparisonRequest({ vehicle, plans: [first, second, quote("Provider C", "Third", "C-1"), quote("Provider D", "Fourth", null)] }), false);
  assert.equal(isSavedComparisonRequest({ vehicle: { ...vehicle, currentPolicyExpiry: "2026-02-30" }, plans: [first, second] }), false);
  assert.equal(isSavedComparisonRequest({ vehicle, plans: [first, { ...second, addons: [null] }] }), false);
});

test("source quote comparison rejects changes to normalized price and benefit fields", () => {
  const supplied = quote("Provider B", "Saver", "B-101");
  assert.equal(matchesSourceQuote(supplied, { ...supplied }), true);
  assert.equal(matchesSourceQuote(supplied, { ...supplied, totalPremiumInr: 1 }), false);
  assert.equal(matchesSourceQuote(supplied, { ...supplied, addons: [{ concept: "unknown", sourceLabel: "RSA" }] }), false);
  assert.equal(matchesSourceQuote(supplied, { ...supplied, warnings: ["altered"] }), false);
});
