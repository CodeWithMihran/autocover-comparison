import { readFile } from "node:fs/promises";
import { CoverageType, NormalizedQuote, ProviderParseResult, emptyResult } from "../domain.js";
import {
  dedupeQuotes,
  normalizeAddon,
  normalizeRegistration,
  parseDateSafely,
  parseIdvSafely,
  referenceDateFromEnv,
  roundHalfUp,
  validityFor,
} from "../normalization.js";

interface TaxRow {
  name?: string;
  rate?: number;
}

interface ProviderARecord {
  registration: string;
  status: string;
  reason?: string;
  vehicle?: string;
  plan?: string;
  coverage?: string;
  idv?: number;
  base_premium?: number;
  taxes?: TaxRow[];
  addons?: string[];
  valid_until?: string;
  premium?: number;
  premium_includes_gst?: boolean;
}

export async function parseProviderA(
  path: string,
  registration?: string,
  referenceDate = referenceDateFromEnv(),
): Promise<ProviderParseResult> {
  const source = JSON.parse(await readFile(path, "utf8")) as { quotes?: unknown };
  if (!source || typeof source !== "object" || !Array.isArray(source.quotes)) {
    throw new Error("Provider A JSON must contain a quotes array.");
  }
  const result = emptyResult("Provider A");
  const requested = registration ? normalizeRegistration(registration) : null;

  for (const value of source.quotes) {
    const row = value as ProviderARecord | null;
    if (!row || typeof row.registration !== "string" || !row.registration.trim()) {
      result.warnings.push("Skipped a Provider A record with no registration number.");
      continue;
    }
    const reg = normalizeRegistration(row.registration);
    if (requested && reg !== requested) continue;
    const status = typeof row.status === "string" ? row.status.trim().toUpperCase() : "";
    if (status === "DECLINED") {
      result.declines.push({
        provider: result.provider,
        registration: reg,
        planName: null,
        reason: typeof row.reason === "string" && row.reason.trim() ? row.reason.trim() : "Provider declined this vehicle.",
      });
      continue;
    }
    if (status !== "QUOTED") {
      result.warnings.push(`Ignored unsupported status ${JSON.stringify(row.status ?? "missing")} for ${reg}.`);
      continue;
    }

    const warnings: string[] = [];
    let basePremiumInr: number | null = null;
    let gstInr: number | null = null;
    let totalPremiumInr: number | null = null;
    let taxIncluded: boolean | null = null;

    if (row.premium !== undefined && row.premium_includes_gst === true) {
      if (!Number.isFinite(row.premium) || row.premium < 0) {
        warnings.push("Provider supplied an invalid GST-inclusive premium; total is unknown.");
      } else {
        const roundedPremium = roundHalfUp(row.premium);
        if (!Number.isSafeInteger(roundedPremium)) {
          warnings.push("Provider supplied a GST-inclusive premium outside the supported INR range; total is unknown.");
        } else {
          totalPremiumInr = roundedPremium;
          taxIncluded = true;
          warnings.push("Provider supplied a GST-inclusive total but no GST/base-premium breakdown.");
        }
      }
    } else if (row.base_premium !== undefined) {
      if (!Number.isFinite(row.base_premium) || row.base_premium < 0) {
        warnings.push("Provider supplied an invalid base premium; price breakdown is unknown.");
      } else {
        const roundedBase = roundHalfUp(row.base_premium);
        if (!Number.isSafeInteger(roundedBase)) {
          warnings.push("Provider supplied a base premium outside the supported INR range; price breakdown is unknown.");
        } else {
          basePremiumInr = roundedBase;
        }
        if (Array.isArray(row.taxes) && row.taxes.length) {
          const rates = row.taxes.map((item) => item?.rate);
          if (rates.some((rate) => typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1)) {
            warnings.push("One or more tax rates are invalid; total premium and GST are unknown.");
          } else {
            const totalTaxInr = roundHalfUp((basePremiumInr ?? 0) * rates.reduce<number>((sum, rate) => sum + Number(rate), 0));
            const totalWithTaxes = (basePremiumInr ?? 0) + totalTaxInr;
            const gstRate = row.taxes.reduce((sum, item) => {
              const name = typeof item?.name === "string" ? item.name.trim().toUpperCase() : "";
              return name && /^(GST|CGST|SGST|IGST)$/.test(name) ? sum + (item?.rate ?? 0) : sum;
            }, 0);
            taxIncluded = false;
            if (basePremiumInr !== null && Number.isSafeInteger(totalTaxInr) && Number.isSafeInteger(totalWithTaxes)) {
              totalPremiumInr = totalWithTaxes;
            } else {
              warnings.push("Tax calculation exceeded the supported INR range; total premium is unknown.");
            }
            const hasGstLabel = row.taxes.some((item) => typeof item?.name === "string" && /^(GST|CGST|SGST|IGST)$/i.test(item.name.trim()));
            const roundedGst = roundHalfUp((basePremiumInr ?? 0) * gstRate);
            if (basePremiumInr !== null && (gstRate > 0 || hasGstLabel) && Number.isSafeInteger(roundedGst)) {
              gstInr = roundedGst;
            } else if (hasGstLabel || gstRate > 0) {
              warnings.push("GST calculation exceeded the supported INR range; GST is unknown.");
            } else {
              warnings.push("Taxes were added to the total, but the source did not identify GST separately.");
            }
          }
        } else {
          const taxState = row.taxes === undefined ? "missing" : Array.isArray(row.taxes) ? "empty" : "invalid";
          warnings.push(`Total premium and GST are unknown because the taxes field is ${taxState}; base premium is retained.`);
        }
      }
    } else if (row.premium !== undefined) {
      warnings.push("Provider supplied a premium amount without a confirmed GST-inclusive flag or usable base/tax breakdown; total is unknown.");
    } else {
      warnings.push("No recognized premium field was supplied.");
    }

    const coverage = typeof row.coverage === "string" ? row.coverage.trim().toUpperCase().replace(/[\s-]+/g, "_") : "";
    if (row.coverage !== undefined && typeof row.coverage !== "string") warnings.push("Provider supplied coverage in an unsupported format.");
    const coverageType: CoverageType = coverage === "COMPREHENSIVE"
      ? "comprehensive"
      : coverage === "THIRD_PARTY"
        ? "third_party"
        : "unknown";
    if (coverageType === "unknown") warnings.push(`Unrecognized coverage value: ${row.coverage ?? "missing"}.`);
    const validUntil = parseDateSafely(row.valid_until, warnings, "Quote expiry");
    const idvInr = parseIdvSafely(row.idv, warnings);

    const sourceAddons = Array.isArray(row.addons) ? row.addons : [];
    if (row.addons !== undefined && !Array.isArray(row.addons)) warnings.push("Provider supplied add-ons in an unsupported format; none were mapped.");
    const quote: NormalizedQuote = {
      provider: result.provider,
      registration: reg,
      sourceQuoteId: null,
      planName: typeof row.plan === "string" && row.plan.trim() ? row.plan.trim() : "Unnamed plan",
      totalPremiumInr,
      gstInr,
      basePremiumInr,
      idvInr,
      coverageType,
      addons: sourceAddons.filter((addon): addon is string => typeof addon === "string" && Boolean(addon.trim())).map(normalizeAddon),
      benefits: [],
      validUntil,
      validityStatus: validityFor(validUntil, referenceDate),
      taxIncluded,
      priceBasis: "source_quote",
      warnings,
    };
    result.quotes.push(quote);
  }

  result.quotes = dedupeQuotes(result.quotes, result.warnings);
  return result;
}
