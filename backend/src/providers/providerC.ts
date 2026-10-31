import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { NormalizedQuote, ProviderParseResult, Vehicle, emptyResult } from "../domain.js";
import {
  normalizeAddon,
  normalizeRegistration,
  parseIsoDate,
  referenceDateFromEnv,
  roundHalfUp,
  validityFor,
} from "../normalization.js";
import { loadVehicles } from "../vehicles.js";

interface RateCard {
  effectiveFrom: string;
  validUntil: string;
  depreciation: number[];
  odRates: Map<number, [number, number, number]>;
  tpRates: [number, number, number];
  modelGroups: Map<string, number>;
  nilDepRate: number;
  roadsideFee: number;
  consumablesFee: number;
  gstRate: number;
}

async function extractPdfText(path: string): Promise<string> {
  const bytes = new Uint8Array(await readFile(path));
  const loadingTask = getDocument({ data: bytes });
  try {
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      } finally {
        page.cleanup();
      }
    }
    return pages.join("\n");
  } finally {
    await loadingTask.destroy();
  }
}

function requiredMatch(text: string, expression: RegExp, description: string): RegExpMatchArray {
  const match = text.match(expression);
  if (!match) throw new Error(`Could not extract ${description} from Provider C PDF.`);
  return match;
}

async function extractRateCard(pdfPath: string): Promise<RateCard> {
  const text = await extractPdfText(pdfPath);
  if (!/PROVIDER\s+C/i.test(text) || !/PRIVATE CAR PACKAGE POLICY/i.test(text)) {
    throw new Error("PDF does not look like the supplied Provider C private-car rate card.");
  }
  const effectiveFrom = parseIsoDate(requiredMatch(text, /Effective\s+(\d{2}-\d{2}-\d{4})/i, "effective date")[1])!;
  const validUntil = parseIsoDate(requiredMatch(text, /Rates valid until\s+(\d{2}-\d{2}-\d{4})/i, "rate-card expiry")[1])!;
  const gstRate = Number(requiredMatch(text, /GST at\s+(\d+(?:\.\d+)?)%/i, "GST rate")[1]) / 100;
  const depreciationRows = [
    /Not exceeding 6 months\s+(\d+)%/i,
    /6 months to 1 year\s+(\d+)%/i,
    /1 to 2 years\s+(\d+)%/i,
    /2 to 3 years\s+(\d+)%/i,
    /3 to 4 years\s+(\d+)%/i,
    /4 to 5 years\s+(\d+)%/i,
  ];
  const depreciation = depreciationRows.map((row, index) => Number(requiredMatch(text, row, `IDV depreciation row ${index + 1}`)[1]));
  depreciation.push(50); // The final band adds 5% for each completed year above five.

  const odRates = new Map<number, [number, number, number]>();
  for (const row of text.matchAll(/Group\s+(\d)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/gi)) {
    odRates.set(Number(row[1]), [Number(row[2]) / 100, Number(row[3]) / 100, Number(row[4]) / 100]);
  }
  if ([...odRates.keys()].sort().join(",") !== "1,2,3") {
    throw new Error("Could not extract all three Provider C own-damage rate groups.");
  }

  const tpRates = [
    Number(requiredMatch(text, /Not exceeding 1000 cc\s+([\d,]+)/i, "TP rate for <=1000 cc")[1].replaceAll(",", "")),
    Number(requiredMatch(text, /1000 cc to 1500 cc\s+([\d,]+)/i, "TP rate for 1000-1500 cc")[1].replaceAll(",", "")),
    Number(requiredMatch(text, /Exceeding 1500 cc\s+([\d,]+)/i, "TP rate for >1500 cc")[1].replaceAll(",", "")),
  ] as [number, number, number];

  const modelGroups = new Map<string, number>();
  const modelNames = ["SWIFT(?: \\(ALL VARIANTS\\))?", "I20", "BALENO", "ALTO K10", "TIAGO", "NEXON", "CITY", "SONET", "CRETA", "XUV700", "INNOVA CRYSTA"];
  for (const model of modelNames) {
    const match = text.match(new RegExp(`\\b(${model})\\s+([123])\\b`, "i"));
    if (match) modelGroups.set(match[1].toUpperCase().replace(/\s+\(ALL VARIANTS\)/i, "").replace(/\s+/g, " "), Number(match[2]));
  }
  if (modelGroups.size !== 11) throw new Error(`Expected 11 Provider C model groups, extracted ${modelGroups.size}.`);

  const nilDepRate = Number(requiredMatch(text, /Nil Depreciation\s+(\d+)% of OD premium/i, "nil-depreciation charge")[1]) / 100;
  const roadsideFee = Number(requiredMatch(text, /Roadside Assistance\s+([\d,]+) flat/i, "roadside assistance fee")[1].replaceAll(",", ""));
  const consumablesFee = Number(requiredMatch(text, /Consumables\s+([\d,]+) flat/i, "consumables fee")[1].replaceAll(",", ""));
  if (!/C-Standard:\s*OD\s*\+\s*TP/i.test(text) || !/C-Shield:\s*OD\s*\+\s*TP/i.test(text)) {
    throw new Error("Provider C plan definitions were not found in the rate card.");
  }
  return { effectiveFrom, validUntil, depreciation, odRates, tpRates, modelGroups, nilDepRate, roadsideFee, consumablesFee, gstRate };
}

function completedMonths(startIso: string, endIso: string): number {
  const [startYear, startMonth, startDay] = startIso.split("-").map(Number);
  const [endYear, endMonth, endDay] = endIso.split("-").map(Number);
  return Math.max((endYear - startYear) * 12 + endMonth - startMonth - Number(endDay < startDay), 0);
}

function idvFor(vehicle: Vehicle, card: RateCard, ageMonths: number): number {
  let percentage: number;
  if (ageMonths <= 6) percentage = card.depreciation[0];
  else if (ageMonths <= 12) percentage = card.depreciation[1];
  else if (ageMonths <= 24) percentage = card.depreciation[2];
  else if (ageMonths <= 36) percentage = card.depreciation[3];
  else if (ageMonths <= 48) percentage = card.depreciation[4];
  else if (ageMonths <= 60) percentage = card.depreciation[5];
  else percentage = 50 + 5 * Math.max(Math.floor(ageMonths / 12) - 5, 0);
  return roundHalfUp((vehicle.exShowroomPriceInr * (100 - percentage)) / 100 / 1000) * 1000;
}

function thirdPartyRate(vehicle: Vehicle, card: RateCard): number {
  return vehicle.engineCc <= 1000 ? card.tpRates[0] : vehicle.engineCc <= 1500 ? card.tpRates[1] : card.tpRates[2];
}

function ownDamageRate(modelGroup: number, ageMonths: number, card: RateCard): number {
  const fullYears = Math.floor(ageMonths / 12);
  const band = fullYears < 3 ? 0 : fullYears < 5 ? 1 : 2;
  const rates = card.odRates.get(modelGroup);
  if (!rates) throw new Error(`Missing own-damage rate for model group ${modelGroup}.`);
  return rates[band];
}

function calculateQuote(
  vehicle: Vehicle,
  card: RateCard,
  referenceDate: string,
  ageMonths: number,
  modelGroup: number,
  shield: boolean,
): NormalizedQuote {
  const idvInr = idvFor(vehicle, card, ageMonths);
  const odBeforeNcb = roundHalfUp(idvInr * ownDamageRate(modelGroup, ageMonths, card));
  const ncbDiscount = roundHalfUp(odBeforeNcb * vehicle.ncbPercent / 100);
  const odAfterNcb = odBeforeNcb - ncbDiscount;
  const tp = thirdPartyRate(vehicle, card);
  let addons: NormalizedQuote["addons"] = [];
  let addonTotal = 0;
  if (shield) {
    const nilDep = roundHalfUp(odAfterNcb * card.nilDepRate);
    addonTotal = nilDep + card.roadsideFee + card.consumablesFee;
    addons = ["Nil Depreciation", "Roadside Assistance", "Consumables"].map(normalizeAddon);
  }
  const basePremiumInr = odAfterNcb + tp + addonTotal;
  const gstInr = roundHalfUp(basePremiumInr * card.gstRate);
  const planName = shield ? "C-Shield" : "C-Standard";
  return {
    provider: "Provider C",
    registration: vehicle.registration,
    sourceQuoteId: `C-${shield ? "SHIELD" : "STANDARD"}-${vehicle.registration}`,
    planName,
    totalPremiumInr: basePremiumInr + gstInr,
    gstInr,
    basePremiumInr,
    idvInr,
    coverageType: "comprehensive",
    addons,
    benefits: ["Own-damage and third-party cover"],
    validUntil: card.validUntil,
    validityStatus: referenceDate < card.effectiveFrom ? "not_yet_valid" : validityFor(card.validUntil, referenceDate),
    taxIncluded: false,
    priceBasis: "calculated_from_rate_card",
    warnings: [
      "Calculated from the supplied rate card and registry; this is not a provider-issued personalized quote.",
      "NCB is applied to own-damage premium only, as stated in the rate card.",
    ],
  };
}

export async function parseProviderC(
  pdfPath: string,
  registryPath: string,
  registration?: string,
  referenceDate = referenceDateFromEnv(),
): Promise<ProviderParseResult> {
  const card = await extractRateCard(pdfPath);
  const vehicles = await loadVehicles(registryPath);
  const requested = registration ? normalizeRegistration(registration) : null;
  const result = emptyResult("Provider C");
  if (referenceDate < card.effectiveFrom) result.warnings.push("Reference date is before Provider C rate-card effective date.");
  if (referenceDate > card.validUntil) result.warnings.push("Provider C rate card is expired for the configured reference date.");

  for (const [reg, vehicle] of vehicles) {
    if (requested && requested !== reg) continue;
    const ageMonths = completedMonths(vehicle.registrationDate, referenceDate);
    if (ageMonths > 96) {
      result.declines.push({ provider: result.provider, registration: reg, planName: null, reason: "Vehicles older than 8 years are not covered." });
      continue;
    }
    const modelGroup = card.modelGroups.get(vehicle.model.toUpperCase().replace(/\s+/g, " "));
    if (!modelGroup) {
      result.declines.push({ provider: result.provider, registration: reg, planName: null, reason: `Model ${JSON.stringify(vehicle.model)} is not listed; refer to underwriting.` });
      continue;
    }

    result.quotes.push(calculateQuote(vehicle, card, referenceDate, ageMonths, modelGroup, false));
    if (ageMonths <= 60) {
      result.quotes.push(calculateQuote(vehicle, card, referenceDate, ageMonths, modelGroup, true));
    } else {
      result.declines.push({ provider: result.provider, registration: reg, planName: "C-Shield", reason: "C-Shield is offered only for vehicles up to 5 years old." });
    }
  }
  return result;
}
