import assert from "node:assert/strict";
import test from "node:test";
import type { Vehicle } from "../src/domain.js";
import { isPolicyRequest, mockPolicyDates, policyExpiryStatus } from "../src/policyLogic.js";

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

test("mock policy begins after a future current policy and covers one year minus one day", () => {
  assert.deepEqual(mockPolicyDates(vehicle, "2026-11-10"), {
    start: "2026-11-21",
    end: "2027-11-20",
  });
});

test("mock policy starts on the reference date when the current policy has expired", () => {
  assert.deepEqual(mockPolicyDates({ ...vehicle, currentPolicyExpiry: "2026-11-09" }, "2026-11-10"), {
    start: "2026-11-10",
    end: "2027-11-09",
  });
});

test("policy expiry labels include the 15-day boundary", () => {
  assert.equal(policyExpiryStatus("2026-11-09", "2026-11-10"), "expired");
  assert.equal(policyExpiryStatus("2026-11-10", "2026-11-10"), "expiring_soon");
  assert.equal(policyExpiryStatus("2026-11-25", "2026-11-10"), "expiring_soon");
  assert.equal(policyExpiryStatus("2026-11-26", "2026-11-10"), "active");
});

test("one-year mock dates handle a leap-day start", () => {
  assert.deepEqual(mockPolicyDates({ ...vehicle, currentPolicyExpiry: null }, "2024-02-29"), {
    start: "2024-02-29",
    end: "2025-02-27",
  });
});

test("policy request validation rejects malformed vehicle dates and out-of-range values", () => {
  const validRequest = {
    vehicle,
    quote: {
      provider: "Provider A",
      registration: "WB02AB1234",
      sourceQuoteId: null,
      planName: "Essential",
      totalPremiumInr: 11759,
      gstInr: 1794,
      basePremiumInr: 9965,
      idvInr: 325000,
      coverageType: "comprehensive",
      addons: [],
      benefits: [],
      validUntil: "2026-11-30",
      validityStatus: "valid",
      taxIncluded: false,
      priceBasis: "source_quote",
      warnings: [],
    },
  };
  assert.equal(isPolicyRequest(validRequest), true);
  assert.equal(isPolicyRequest({ ...validRequest, vehicle: { ...vehicle, registrationDate: "2026-02-30" } }), false);
  assert.equal(isPolicyRequest({ ...validRequest, vehicle: { ...vehicle, registrationDate: "2026-11-21" } }), false);
  assert.equal(isPolicyRequest({ ...validRequest, vehicle: { ...vehicle, ncbPercent: 101 } }), false);
  assert.equal(isPolicyRequest({ ...validRequest, quote: { ...validRequest.quote, totalPremiumInr: 11_759.5 } }), false);
});
