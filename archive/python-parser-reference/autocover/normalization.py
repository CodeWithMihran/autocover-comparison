"""Small shared normalization helpers; deliberately strict about unknown money."""

from __future__ import annotations

import os
import re
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable

from .domain import AddonConcept, NormalizedAddon, ValidityStatus


DEFAULT_REFERENCE_DATE = date(2026, 11, 10)


def reference_date_from_env() -> date:
    value = os.getenv("AUTOCOVER_REFERENCE_DATE")
    return date.fromisoformat(value) if value else DEFAULT_REFERENCE_DATE


def normalize_registration(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def parse_date(value: str | date | None) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    value = value.strip()
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    for pattern in ("%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    raise ValueError(f"Unsupported date value: {value!r}")


def validity_for(valid_until: date | None, reference_date: date) -> ValidityStatus:
    if valid_until is None:
        return ValidityStatus.UNKNOWN
    return ValidityStatus.VALID if valid_until >= reference_date else ValidityStatus.EXPIRED


def round_rupees(value: Decimal | int | float) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def parse_money(value: str | int | float | None) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return round_rupees(value)
    cleaned = value.replace(",", "").replace("₹", "").strip()
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)\s*(lakh|lakhs|l)?", cleaned, re.I)
    if not match:
        raise ValueError(f"Unsupported money value: {value!r}")
    amount = Decimal(match.group(1))
    if match.group(2):
        amount *= 100_000
    return round_rupees(amount)


def parse_idv(value: str | int | float | None) -> int | None:
    result = parse_money(value)
    return result if result is not None and result > 0 else None


_ADDON_ALIASES: tuple[tuple[AddonConcept, tuple[str, ...]], ...] = (
    (AddonConcept.ZERO_DEPRECIATION, ("zero dep", "zero depreciation", "nil depreciation", "bumper to bumper")),
    (AddonConcept.ROADSIDE_ASSISTANCE, ("rsa", "roadside assistance", "24x7 roadside")),
    (AddonConcept.ENGINE_PROTECTION, ("engine protect", "engine protection", "engine & gearbox protection")),
    (AddonConcept.CONSUMABLES, ("consumables",)),
    (AddonConcept.KEY_REPLACEMENT, ("key replacement", "key protect")),
)


def normalize_addon(label: str) -> NormalizedAddon:
    normalized = " ".join(label.lower().split())
    for concept, aliases in _ADDON_ALIASES:
        if any(alias in normalized for alias in aliases):
            return NormalizedAddon(concept=concept, source_label=label.strip())
    return NormalizedAddon(concept=AddonConcept.UNKNOWN, source_label=label.strip())


def dedupe_quotes(quotes: Iterable, warnings: list[str]):
    """Remove exact repeated source offers while preserving distinct prices/terms."""
    unique = []
    seen = set()
    for quote in quotes:
        key = (
            quote.provider,
            quote.registration,
            quote.source_quote_id or quote.plan_name,
            quote.total_premium_inr,
            quote.gst_inr,
            quote.base_premium_inr,
            quote.idv_inr,
            tuple((addon.concept.value, addon.source_label.lower()) for addon in quote.addons),
            quote.valid_until,
        )
        if key in seen:
            warnings.append(f"Removed exact duplicate quote for {quote.registration} / {quote.plan_name}.")
            continue
        seen.add(key)
        unique.append(quote)
    return unique
