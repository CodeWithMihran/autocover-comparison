# Data source investigation and normalization

This note records what the supplied files contain and how the parser/API layer handles them. The local reference date is `2026-11-10`, as specified by the assignment. `AUTOCOVER_REFERENCE_DATE` can override it.

## Source findings

| Source | Investigation result | Handling |
| --- | --- | --- |
| `data/registry.json` | 12 vehicles. Registration strings need canonicalization. `WB20PQ0909` has no fuel type and uses `15/12/2026` for expiry; `GJ01RS2211` has no current expiry. | `loadVehicles` normalizes registrations, parses both date formats, and preserves missing fuel/expiry as `null`. Provider C calculations use the supplied ex-showroom price, registration date, engine capacity, and NCB. |
| `data/provider_a.json` | 31 entries: 29 quotes and 2 declines. One exact duplicate. Most records give a base premium and GST rate, but one has an empty tax list, one has no tax field, and one gives only a GST-inclusive total. | Valid tax rates are added to the base; GST is reported only for rows explicitly labeled GST/CGST/SGST/IGST. Empty/missing taxes leave the total unknown while retaining the base. Inclusive total stays available with unknown GST. Declines are kept separately; exact repeats are removed. |
| `data/provider_b.html` | Twelve vehicle sections, 26 quote cards, and two age-related unavailability notices. Card markup has IDs and benefits, but prices and cover amounts are populated by JavaScript from `window.__QUOTE_DATA__`. | Parse the HTML and embedded JSON separately, join on plan ID, then normalize price, cover/IDV, add-ons, and validity. No browser execution is needed because the complete quote payload is embedded in the supplied page. Tax is included but the GST amount is unavailable. Coverage type is not stated, so it stays `unknown`. |
| `data/provider_c.pdf` | Three-page rate card, not quote rows. It defines IDV depreciation, model groups, own-damage rates by vehicle age, third-party prices by engine size, add-on charges, GST and eligibility limits. | Extract the rate card with Mozilla PDF.js; calculate indicative plans from the card plus registry data. Label them as calculated, keep the source rate-card expiry, and return explicit declines for ineligible vehicles/plans. |
| `data/provider_d.csv` | 11 rows, including one exact duplicate. Prices include GST; GST amount is not split out. IDV appears as numbers or lakh strings. Registration spacing/case varies; `WB02AB9999` is absent from the registry; one quote expired before the reference date. | Parse comma-formatted INR and lakh IDV, normalize registration and add-ons, retain the inclusive total with unknown GST, remove exact duplicates, and warn when the caller supplies a registry allow-list and a record is not found there. |
| `data/test_customers.json` | Five test registrations use mixed casing, spaces and hyphens. It also supplies an unknown registration and invalid short value. | Use as lookup/normalization cases for vehicle lookup and API validation. Customer records are not required to create prices. |

### Cross-source observations

- Provider A has 28 unique quoted plans after removing its repeated Swift quote, plus two declines.
- Provider B exposes 26 priced cards. Quote `B-113` is valid only through 8 November 2026, so it is expired on the assignment reference date.
- Provider A's KL quote is valid only through 5 November 2026. Provider D's Creta Basic row is valid only through 15 October 2026. These remain in results but are marked expired.
- Provider D has a quote for `WB02AB9999`, which does not appear in the supplied registry. Preserve and flag the source row; don't silently attach it to another vehicle.
- IDV differs by provider for the same vehicle. Keep each provider's IDV as supplied or calculated and make the source/basis visible; do not replace it with a cross-provider value.

## Normalized contract

The TypeScript `NormalizedQuote` in `backend/src/domain.ts` matches the camelCase contract in `frontend/src/types/insurance.ts`.

| Field | Meaning and missing-data rule |
| --- | --- |
| `provider`, `registration`, `sourceQuoteId`, `planName` | Provider label, canonical uppercase registration, provider quote ID when present, and plan label. Provider A/D have no quote ID in their files. |
| `totalPremiumInr` | Whole INR, GST-inclusive when known. `null` when the only provided number is a pre-tax base and tax is absent. |
| `gstInr` | Whole INR when the source gives enough information to calculate it. `null` for inclusive-only totals and missing tax data; never treat missing GST as zero. |
| `basePremiumInr` | Pre-tax subtotal when directly provided or calculated. Null for providers that only disclose an inclusive total. |
| `idvInr` | Whole INR; zero/missing IDV becomes `null` (e.g. third-party-only policy). Provider B's `cover` amount is parsed as its displayed IDV. |
| `coverageType` | `comprehensive`, `third_party`, or `unknown`. Do not infer coverage from a plan name alone. |
| `addons` | Common concept plus original provider label. Unknown terms are retained with concept `unknown`. |
| `benefits` | Source benefits that are not safely identifiable as an add-on, such as Provider B's ambiguous “Total Cover”. |
| `validUntil`, `validityStatus` | ISO date and `valid`/`expired`/`not_yet_valid`/`unknown`, evaluated against the configurable reference date. A quote expiring on the reference date is treated as valid for that day; Provider C is not-yet-valid before the rate card's effective date. |
| `taxIncluded` | `true`, `false`, or `null`, according to source evidence. |
| `priceBasis`, `warnings` | Distinguish provider-supplied premiums from rate-card calculations and carry source caveats to the UI. |

Provider declines are represented separately in `ProviderParseResult.declines`, because a decline is not a selectable plan. Collector-level timeouts or intermittent service failures should be represented separately by the API as provider errors, not as declined insurance.

## Add-on normalization from the supplied data

| Common concept | Supplied labels |
| --- | --- |
| `zero_depreciation` | `ZERO_DEP`, `Zero Dep`, `Nil Depreciation`, `Bumper to Bumper` |
| `roadside_assistance` | `RSA`, `Roadside Assistance`, `24x7 Roadside Assistance` |
| `engine_protection` | `Engine Protect`, `Engine & Gearbox Protection` |
| `consumables` | `Consumables` |
| `key_replacement` | `Key Replacement` |
| `unknown` (preserved) | Any label not confidently mapped. Provider B's `Total Cover` is kept as a benefit until its meaning is verified. |

These mappings are derived from the supplied labels. The required public-insurer research, source URLs, review date, and limits on interpreting similar add-ons are documented in [addon-glossary.md](addon-glossary.md). No quote forms, logins, or OTPs were used.

## Provider C calculation rules and assumptions

The parser extracts the effective/expiry dates, rates, model groups, TP prices, add-on charges, and GST from the PDF rather than embedding those values in calculation code.

1. Vehicle age is calculated in completed months/years as of the configured reference date.
2. IDV is ex-showroom price less the card's age depreciation, rounded to the nearest INR 1,000 using half-up rounding. For the 5–8 year band, “5% for each year above 5” is interpreted as each **completed** year above five.
3. Own-damage rate band uses completed years: 0–2, 3–4, or 5–8. NCB from the registry reduces only own-damage premium.
4. TP rate uses registry engine CC. C-Standard is OD + TP. C-Shield adds Nil Depreciation (15% of OD after NCB), Roadside Assistance, and Consumables, and is available through five completed years.
5. Each calculated amount and GST is rounded to the nearest rupee, halves up. GST is charged at the rate in the PDF on OD + TP + add-ons.
6. Vehicles over eight years are declined. Models absent from Annexure A are sent to underwriting and are not assigned a guessed rate.

The file calls these rates indicative. Therefore Provider C results are labeled as calculations from the supplied rate card and registry, not as personalized provider-issued quotes. The parser returns plan-level declines where C-Shield is unavailable but C-Standard can still be quoted.

## Parser layout and verification

- `backend/src/providers/providerA.ts` — JSON response and tax handling.
- `backend/src/providers/providerB.ts` — HTML structure plus JavaScript-embedded JSON.
- `backend/src/providers/providerC.ts` — PDF rate extraction and calculations.
- `backend/src/providers/providerD.ts` — CSV and locale/value normalization.
- `backend/src/domain.ts` and `normalization.ts` — shared response types and canonical rules.
- `frontend/src/types/insurance.ts` — matching React/TypeScript API types.

The app code is TypeScript end-to-end: React + TypeScript in the frontend and Node.js + TypeScript for the API/parser layer. Provider C PDF text is extracted with Mozilla PDF.js, which documents Node.js usage and a Node example ([PDF.js examples](https://mozilla.github.io/pdf.js/examples/), [Node example](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs)).

Focused parser tests are in `backend/tests/parsers.test.ts`. Run them with `npm test` after `npm install`; run `npm run typecheck` to check the TypeScript source. Both commands have been run successfully against the supplied files.
