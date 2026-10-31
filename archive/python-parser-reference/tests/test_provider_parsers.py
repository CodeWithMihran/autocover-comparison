from __future__ import annotations

import unittest
from datetime import date
from pathlib import Path

from backend.autocover.domain import AddonConcept, CoverageType, NormalizedQuote, ParseResult, ValidityStatus, result_to_api_dict
from backend.autocover.normalization import normalize_registration
from backend.autocover.provider_a import parse_provider_a
from backend.autocover.provider_b import parse_provider_b
from backend.autocover.provider_c import parse_provider_c
from backend.autocover.provider_d import parse_provider_d
from backend.autocover.vehicles import load_vehicles


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
AS_OF = date(2026, 11, 10)


class RegistrationNormalizationTests(unittest.TestCase):
    def test_registration_formatting_is_ignored(self) -> None:
        self.assertEqual(normalize_registration(" kl-07-de 3030 "), "KL07DE3030")

    def test_api_contract_serializes_optional_money_as_null_and_uses_camel_case(self) -> None:
        quote = NormalizedQuote(
            provider="Provider B",
            registration="WB02AB1234",
            source_quote_id="B-101",
            plan_name="Smart Shield",
            total_premium_inr=12_830,
            gst_inr=None,
            base_premium_inr=None,
            idv_inr=310_000,
            coverage_type=CoverageType.UNKNOWN,
        )
        payload = result_to_api_dict(ParseResult(provider="Provider B", quotes=[quote]))
        quote_payload = payload["quotes"][0]
        self.assertEqual(quote_payload["totalPremiumInr"], 12_830)
        self.assertIsNone(quote_payload["gstInr"])
        self.assertEqual(quote_payload["sourceQuoteId"], "B-101")
        self.assertNotIn("total_premium_inr", quote_payload)


class ProviderAParserTests(unittest.TestCase):
    def test_quotes_are_normalized_deduplicated_and_expired_quotes_flagged(self) -> None:
        result = parse_provider_a(DATA / "provider_a.json", reference_date=AS_OF)
        self.assertEqual(len(result.quotes), 28)
        self.assertEqual(len(result.declines), 2)
        self.assertTrue(any("duplicate" in warning.lower() for warning in result.warnings))

        swift = parse_provider_a(DATA / "provider_a.json", "WB 02 AB 1234", AS_OF)
        self.assertEqual(len(swift.quotes), 3)
        essential = next(quote for quote in swift.quotes if quote.plan_name == "Essential")
        self.assertEqual(essential.total_premium_inr, 11_759)
        self.assertEqual(essential.gst_inr, 1_794)
        self.assertEqual(essential.registration, "WB02AB1234")

    def test_missing_taxes_do_not_turn_into_zero_gst(self) -> None:
        result = parse_provider_a(DATA / "provider_a.json", "MH12EF4321", AS_OF)
        essential = next(quote for quote in result.quotes if quote.plan_name == "Essential")
        self.assertEqual(essential.base_premium_inr, 19_459)
        self.assertIsNone(essential.total_premium_inr)
        self.assertIsNone(essential.gst_inr)
        self.assertTrue(essential.warnings)

    def test_source_gross_total_is_retained_without_fabricating_tax_split(self) -> None:
        result = parse_provider_a(DATA / "provider_a.json", "DL3CAB0042", AS_OF)
        plus = next(quote for quote in result.quotes if quote.plan_name == "Comprehensive Plus")
        self.assertEqual(plus.total_premium_inr, 34_370)
        self.assertIsNone(plus.gst_inr)
        self.assertEqual(plus.validity_status, ValidityStatus.VALID)

    def test_expired_provider_a_quote_is_identified(self) -> None:
        result = parse_provider_a(DATA / "provider_a.json", "KL07DE3030", AS_OF)
        self.assertTrue(all(q.validity_status is ValidityStatus.EXPIRED for q in result.quotes))


class ProviderBParserTests(unittest.TestCase):
    def test_embedded_script_prices_and_dom_plans_are_joined(self) -> None:
        result = parse_provider_b(DATA / "provider_b.html", reference_date=AS_OF)
        self.assertEqual(len(result.quotes), 26)
        self.assertEqual(len(result.declines), 2)
        quote = next(item for item in result.quotes if item.source_quote_id == "B-101")
        self.assertEqual(quote.total_premium_inr, 12_830)
        self.assertEqual(quote.idv_inr, 310_000)
        self.assertIsNone(quote.gst_inr)
        self.assertEqual(quote.addons[0].concept, AddonConcept.ZERO_DEPRECIATION)
        self.assertEqual(quote.addons[1].concept, AddonConcept.ROADSIDE_ASSISTANCE)
        self.assertEqual(quote.benefits, [])

    def test_unknown_html_benefits_are_preserved_and_expired_price_is_flagged(self) -> None:
        result = parse_provider_b(DATA / "provider_b.html", "TN09XY3456", AS_OF)
        quote = result.quotes[0]
        self.assertEqual(quote.source_quote_id, "B-113")
        self.assertEqual(quote.validity_status, ValidityStatus.EXPIRED)

        shield = parse_provider_b(DATA / "provider_b.html", "WB02AB1234", AS_OF)
        max_plan = next(q for q in shield.quotes if q.plan_name == "Smart Shield Max")
        self.assertIn("Total Cover", max_plan.benefits)
        self.assertTrue(any(a.concept is AddonConcept.KEY_REPLACEMENT for a in max_plan.addons))


class ProviderCParserTests(unittest.TestCase):
    def test_rate_card_is_extracted_and_indicative_quotes_are_calculated(self) -> None:
        result = parse_provider_c(
            DATA / "provider_c.pdf", DATA / "registry.json", reference_date=AS_OF
        )
        self.assertEqual(len(result.quotes), 18)
        self.assertEqual(len(result.declines), 4)

        swift_standard = next(
            quote for quote in result.quotes
            if quote.registration == "WB02AB1234" and quote.plan_name == "C-Standard"
        )
        self.assertEqual(swift_standard.idv_inr, 325_000)
        self.assertEqual(swift_standard.base_premium_inr, 9_965)
        self.assertEqual(swift_standard.gst_inr, 1_794)
        self.assertEqual(swift_standard.total_premium_inr, 11_759)
        self.assertEqual(swift_standard.price_basis, "calculated_from_rate_card")

        swift_shield = next(
            quote for quote in result.quotes
            if quote.registration == "WB02AB1234" and quote.plan_name == "C-Shield"
        )
        self.assertEqual(swift_shield.total_premium_inr, 14_038)
        self.assertEqual(
            {addon.concept for addon in swift_shield.addons},
            {AddonConcept.ZERO_DEPRECIATION, AddonConcept.ROADSIDE_ASSISTANCE, AddonConcept.CONSUMABLES},
        )

    def test_pdf_age_restrictions_are_reported_as_plan_level_declines(self) -> None:
        result = parse_provider_c(DATA / "provider_c.pdf", DATA / "registry.json", reference_date=AS_OF)
        self.assertTrue(any(item.registration == "TN09XY3456" and item.plan_name == "C-Shield" for item in result.declines))
        self.assertTrue(any(item.registration == "WB06CD5678" and item.plan_name is None for item in result.declines))


class ProviderDParserTests(unittest.TestCase):
    def test_inclusive_tax_csv_formats_and_duplicates_are_handled(self) -> None:
        vehicles = load_vehicles(DATA / "registry.json")
        result = parse_provider_d(
            DATA / "provider_d.csv",
            reference_date=AS_OF,
            known_registrations=set(vehicles),
        )
        self.assertEqual(len(result.quotes), 10)
        self.assertTrue(any("duplicate" in warning.lower() for warning in result.warnings))

        quote = next(q for q in result.quotes if q.registration == "WB02AB1234" and q.plan_name == "Basic")
        self.assertEqual(quote.total_premium_inr, 11_670)
        self.assertEqual(quote.idv_inr, 330_000)
        self.assertIsNone(quote.gst_inr)
        self.assertEqual(quote.validity_status, ValidityStatus.VALID)

    def test_unregistered_row_and_expired_row_are_visible(self) -> None:
        vehicles = load_vehicles(DATA / "registry.json")
        result = parse_provider_d(
            DATA / "provider_d.csv",
            reference_date=AS_OF,
            known_registrations=set(vehicles),
        )
        unknown = next(q for q in result.quotes if q.registration == "WB02AB9999")
        self.assertTrue(any("not present" in warning for warning in unknown.warnings))
        expired = next(q for q in result.quotes if q.registration == "DL3CAB0042" and q.plan_name == "Basic")
        self.assertEqual(expired.validity_status, ValidityStatus.EXPIRED)


if __name__ == "__main__":
    unittest.main()
