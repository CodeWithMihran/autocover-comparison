# Public add-on glossary research

Reviewed on **31 October 2026**. This research uses public insurer product information only; no quote forms, accounts, OTPs, or insurer prices were accessed.

## Public sources

| Insurer | Public page | Evidence used |
| --- | --- | --- |
| ICICI Lombard | [Comprehensive car insurance and add-on covers](https://www.icicilombard.com/motor-insurance/car-insurance/comprehensive-car-insurance) | Describes zero depreciation, engine protection, roadside assistance and return to invoice as optional add-ons. |
| Tata AIG | [Car insurance add-on covers](https://www.tataaig.com/motor-insurance/car-insurance/add-on-covers) | Explains zero depreciation, roadside assistance, consumables and return-to-invoice coverage. |
| HDFC ERGO | [Emergency assistance cover](https://www.hdfcergo.com/car-insurance/emergency-assistance-cover) | Describes emergency/roadside assistance and references zero depreciation and no-claim-bonus protection as separate add-ons. |

## Mapping rules

| Shared concept | Source labels in supplied files | Why these labels map |
| --- | --- | --- |
| `zero_depreciation` | `ZERO_DEP`, `Zero Dep`, `Nil Depreciation`, `Bumper to Bumper` | The insurer pages describe zero/nil depreciation as an add-on that limits depreciation deductions on replaced parts. “Bumper to Bumper” is a common label for that cover in the sample data. |
| `roadside_assistance` | `RSA`, `24x7 Roadside Assistance`, `Roadside Assistance` | The insurer pages describe emergency assistance/roadside support for breakdowns. |
| `engine_protection` | `Engine Protect`, `Engine & Gearbox Protection` | Product pages identify engine and gearbox protection as a distinct optional cover. |
| `consumables` | `Consumables` | Tata AIG and HDFC ERGO describe a separate consumables cover for eligible repair items. |
| `key_replacement` | `Key Replacement` | Retained as a distinct concept; do not combine with roadside or engine cover. |
| `unknown` | `Total Cover` | The supplied HTML gives no definition. Do not infer its meaning from a broad marketing label. Preserve the original text as a benefit. |

These pages establish broad product meaning, not identical policy wording or eligibility across insurers. AutoCover keeps each provider's original label alongside the shared concept and does not imply that two similarly named add-ons have identical terms. Only aliases supported by the supplied labels are normalized.
