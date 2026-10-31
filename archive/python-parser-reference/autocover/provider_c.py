from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

import pdfplumber

from .domain import (
    CoverageType,
    NormalizedQuote,
    ParseResult,
    ProviderDecline,
    Vehicle,
)
from .normalization import (
    normalize_addon,
    normalize_registration,
    parse_date,
    reference_date_from_env,
    round_rupees,
    validity_for,
)
from .vehicles import load_vehicles


@dataclass(frozen=True, slots=True)
class _RateCard:
    effective_from: date
    valid_until: date
    depreciation: tuple[int, ...]
    od_rates: dict[int, tuple[Decimal, Decimal, Decimal]]
    tp_rates: tuple[int, int, int]
    model_groups: dict[str, int]
    nil_dep_rate: Decimal
    roadside_fee: int
    consumables_fee: int
    gst_rate: Decimal
    max_vehicle_age_months: int = 96


def _extract_rate_card(pdf_path: str | Path) -> _RateCard:
    with pdfplumber.open(pdf_path) as document:
        text = "\n".join(page.extract_text() or "" for page in document.pages)

    if "PROVIDER C" not in text.upper() or "PRIVATE CAR PACKAGE POLICY" not in text.upper():
        raise ValueError("PDF does not look like the supplied Provider C private-car rate card.")

    effective = re.search(r"Effective\s+(\d{2}-\d{2}-\d{4})", text)
    valid = re.search(r"Rates valid until\s+(\d{2}-\d{2}-\d{4})", text)
    gst = re.search(r"GST at\s+(\d+(?:\.\d+)?)%", text)
    if not (effective and valid and gst):
        raise ValueError("Provider C rate card is missing its effective date, expiry, or GST rate.")

    depreciation = [
        round(float(value))
        for value in re.findall(r"(?:Not exceeding 6 months|6 months to 1 year|1 to 2 years|2 to 3 years|3 to 4 years|4 to 5 years)\s+(\d+)%", text)
    ]
    if len(depreciation) != 6:
        raise ValueError("Could not extract all six IDV depreciation rates from Provider C PDF.")
    depreciation.append(50)  # The 5-to-8-year band has an additional per-year rule.

    od_rates: dict[int, tuple[Decimal, Decimal, Decimal]] = {}
    for match in re.finditer(r"Group\s+(\d)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%", text):
        od_rates[int(match.group(1))] = tuple(Decimal(match.group(i)) / 100 for i in (2, 3, 4))
    if set(od_rates) != {1, 2, 3}:
        raise ValueError("Could not extract all three Provider C own-damage rate groups.")

    tp_rows = (
        re.search(r"Not exceeding 1000 cc\s+([\d,]+)", text),
        re.search(r"1000 cc to 1500 cc\s+([\d,]+)", text),
        re.search(r"Exceeding 1500 cc\s+([\d,]+)", text),
    )
    if not all(tp_rows):
        raise ValueError("Could not extract the Provider C third-party rates.")
    tp_rates = tuple(int(row.group(1).replace(",", "")) for row in tp_rows)

    model_groups: dict[str, int] = {}
    for model, group in re.findall(
        r"(?m)^\s*(SWIFT \(ALL VARIANTS\)|I20|BALENO|ALTO K10|TIAGO|NEXON|CITY|SONET|CRETA|XUV700|INNOVA CRYSTA)\s+(\d)\s*$",
        text,
        re.I,
    ):
        model_groups[" ".join(model.upper().replace(" (ALL VARIANTS)", "").split())] = int(group)
    if len(model_groups) != 11:
        raise ValueError(f"Expected 11 Provider C model groups, extracted {len(model_groups)}.")

    nil_dep = re.search(r"Nil Depreciation\s+(\d+)% of OD premium", text)
    roadside = re.search(r"Roadside Assistance\s+([\d,]+) flat", text)
    consumables = re.search(r"Consumables\s+([\d,]+) flat", text)
    if not (nil_dep and roadside and consumables):
        raise ValueError("Could not extract Provider C add-on charges.")

    return _RateCard(
        effective_from=parse_date(effective.group(1)),
        valid_until=parse_date(valid.group(1)),
        depreciation=tuple(depreciation),
        od_rates=od_rates,
        tp_rates=tp_rates,
        model_groups=model_groups,
        nil_dep_rate=Decimal(nil_dep.group(1)) / 100,
        roadside_fee=int(roadside.group(1).replace(",", "")),
        consumables_fee=int(consumables.group(1).replace(",", "")),
        gst_rate=Decimal(gst.group(1)) / 100,
    )


def _completed_months(start: date, end: date) -> int:
    months = (end.year - start.year) * 12 + end.month - start.month
    if end.day < start.day:
        months -= 1
    return max(months, 0)


def _age_in_months(vehicle: Vehicle, reference_date: date) -> int:
    return _completed_months(vehicle.registration_date, reference_date)


def _idv_for(vehicle: Vehicle, rate_card: _RateCard, age_months: int) -> int:
    if age_months <= 6:
        depreciation_percent = rate_card.depreciation[0]
    elif age_months <= 12:
        depreciation_percent = rate_card.depreciation[1]
    elif age_months <= 24:
        depreciation_percent = rate_card.depreciation[2]
    elif age_months <= 36:
        depreciation_percent = rate_card.depreciation[3]
    elif age_months <= 48:
        depreciation_percent = rate_card.depreciation[4]
    elif age_months <= 60:
        depreciation_percent = rate_card.depreciation[5]
    else:
        # The rate card says 5% for each year above 5. We use completed years.
        completed_years = age_months // 12
        depreciation_percent = 50 + 5 * max(completed_years - 5, 0)
    depreciated = Decimal(vehicle.ex_showroom_price_inr) * (Decimal(100 - depreciation_percent) / 100)
    return round_rupees(depreciated / 1000) * 1000


def _tp_rate(vehicle: Vehicle, rate_card: _RateCard) -> int:
    if vehicle.engine_cc <= 1000:
        return rate_card.tp_rates[0]
    if vehicle.engine_cc <= 1500:
        return rate_card.tp_rates[1]
    return rate_card.tp_rates[2]


def _od_rate(model_group: int, age_months: int, rate_card: _RateCard) -> Decimal:
    completed_years = age_months // 12
    band = 0 if completed_years < 3 else (1 if completed_years < 5 else 2)
    return rate_card.od_rates[model_group][band]


def _make_quote(
    vehicle: Vehicle,
    rate_card: _RateCard,
    reference_date: date,
    age_months: int,
    model_group: int,
    shield: bool,
) -> NormalizedQuote:
    idv = _idv_for(vehicle, rate_card, age_months)
    od_before_ncb = round_rupees(Decimal(idv) * _od_rate(model_group, age_months, rate_card))
    ncb_discount = round_rupees(Decimal(od_before_ncb) * Decimal(vehicle.ncb_percent) / 100)
    od_after_ncb = od_before_ncb - ncb_discount
    tp = _tp_rate(vehicle, rate_card)
    addons = []
    addon_cost = 0
    if shield:
        nil_dep = round_rupees(Decimal(od_after_ncb) * rate_card.nil_dep_rate)
        addon_cost = nil_dep + rate_card.roadside_fee + rate_card.consumables_fee
        addons = [
            normalize_addon("Nil Depreciation"),
            normalize_addon("Roadside Assistance"),
            normalize_addon("Consumables"),
        ]
    base = od_after_ncb + tp + addon_cost
    gst = round_rupees(Decimal(base) * rate_card.gst_rate)
    return NormalizedQuote(
        provider="Provider C",
        registration=vehicle.registration,
        source_quote_id=f"C-{'SHIELD' if shield else 'STANDARD'}-{vehicle.registration}",
        plan_name="C-Shield" if shield else "C-Standard",
        total_premium_inr=base + gst,
        gst_inr=gst,
        base_premium_inr=base,
        idv_inr=idv,
        coverage_type=CoverageType.COMPREHENSIVE,
        addons=addons,
        benefits=["Own-damage and third-party cover"],
        valid_until=rate_card.valid_until,
        validity_status=validity_for(rate_card.valid_until, reference_date),
        tax_included=False,
        price_basis="calculated_from_rate_card",
        warnings=[
            "Calculated from the supplied rate card and registry; this is not a provider-issued personalized quote.",
            "NCB is applied to own-damage premium only, as stated in the rate card.",
        ],
    )


def parse_provider_c(
    pdf_path: str | Path,
    registry_path: str | Path,
    registration: str | None = None,
    reference_date: date | None = None,
) -> ParseResult:
    """Read Provider C's rate card and calculate indicative quotes from registry data."""
    ref_date = reference_date or reference_date_from_env()
    rate_card = _extract_rate_card(pdf_path)
    vehicles = load_vehicles(registry_path)
    requested = normalize_registration(registration) if registration else None
    output = ParseResult(provider="Provider C")

    if ref_date < rate_card.effective_from:
        output.warnings.append("Reference date is before Provider C rate-card effective date.")
    if ref_date > rate_card.valid_until:
        output.warnings.append("Provider C rate card is expired for the configured reference date.")

    for reg, vehicle in vehicles.items():
        if requested and reg != requested:
            continue
        age_months = _age_in_months(vehicle, ref_date)
        if age_months > rate_card.max_vehicle_age_months:
            output.declines.append(
                ProviderDecline("Provider C", reg, "Vehicles older than 8 years are not covered.")
            )
            continue
        model_key = " ".join(vehicle.model.upper().split())
        model_group = rate_card.model_groups.get(model_key)
        if model_group is None:
            output.declines.append(
                ProviderDecline("Provider C", reg, f"Model {vehicle.model!r} is not listed; refer to underwriting.")
            )
            continue

        output.quotes.append(_make_quote(vehicle, rate_card, ref_date, age_months, model_group, shield=False))
        if age_months <= 60:
            output.quotes.append(_make_quote(vehicle, rate_card, ref_date, age_months, model_group, shield=True))
        else:
            output.declines.append(
                ProviderDecline(
                    "Provider C",
                    reg,
                    "C-Shield is offered only for vehicles up to 5 years old.",
                    plan_name="C-Shield",
                )
            )
    return output
