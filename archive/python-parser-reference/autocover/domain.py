"""Shared, frontend-friendly quote types used by every provider parser."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from typing import Any


class CoverageType(StrEnum):
    COMPREHENSIVE = "comprehensive"
    THIRD_PARTY = "third_party"
    UNKNOWN = "unknown"


class AddonConcept(StrEnum):
    ZERO_DEPRECIATION = "zero_depreciation"
    ROADSIDE_ASSISTANCE = "roadside_assistance"
    ENGINE_PROTECTION = "engine_protection"
    CONSUMABLES = "consumables"
    KEY_REPLACEMENT = "key_replacement"
    UNKNOWN = "unknown"


class ValidityStatus(StrEnum):
    VALID = "valid"
    EXPIRED = "expired"
    UNKNOWN = "unknown"


@dataclass(slots=True)
class NormalizedAddon:
    concept: AddonConcept
    source_label: str


@dataclass(slots=True)
class NormalizedQuote:
    provider: str
    registration: str
    source_quote_id: str | None
    plan_name: str
    total_premium_inr: int | None
    gst_inr: int | None
    base_premium_inr: int | None
    idv_inr: int | None
    coverage_type: CoverageType
    addons: list[NormalizedAddon] = field(default_factory=list)
    benefits: list[str] = field(default_factory=list)
    valid_until: date | None = None
    validity_status: ValidityStatus = ValidityStatus.UNKNOWN
    tax_included: bool | None = None
    price_basis: str = "source_quote"
    warnings: list[str] = field(default_factory=list)

    def to_api_dict(self) -> dict[str, Any]:
        """Serialize to camelCase JSON for direct use by a React/TypeScript client."""
        return {
            "provider": self.provider,
            "registration": self.registration,
            "sourceQuoteId": self.source_quote_id,
            "planName": self.plan_name,
            "totalPremiumInr": self.total_premium_inr,
            "gstInr": self.gst_inr,
            "basePremiumInr": self.base_premium_inr,
            "idvInr": self.idv_inr,
            "coverageType": self.coverage_type.value,
            "addons": [
                {"concept": addon.concept.value, "sourceLabel": addon.source_label}
                for addon in self.addons
            ],
            "benefits": self.benefits,
            "validUntil": self.valid_until.isoformat() if self.valid_until else None,
            "validityStatus": self.validity_status.value,
            "taxIncluded": self.tax_included,
            "priceBasis": self.price_basis,
            "warnings": self.warnings,
        }


@dataclass(slots=True)
class ProviderDecline:
    provider: str
    registration: str
    reason: str
    plan_name: str | None = None


@dataclass(slots=True)
class ParseResult:
    provider: str
    quotes: list[NormalizedQuote] = field(default_factory=list)
    declines: list[ProviderDecline] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class Vehicle:
    registration: str
    make: str
    model: str
    variant: str
    fuel_type: str | None
    engine_cc: int
    registration_date: date
    rto: str
    ex_showroom_price_inr: int
    ncb_percent: int

    @property
    def model_key(self) -> str:
        return " ".join(f"{self.make} {self.model}".upper().split())


def result_to_api_dict(result: ParseResult) -> dict[str, Any]:
    return {
        "provider": result.provider,
        "quotes": [quote.to_api_dict() for quote in result.quotes],
        "declines": [
            {
                "provider": item.provider,
                "registration": item.registration,
                "planName": item.plan_name,
                "reason": item.reason,
            }
            for item in result.declines
        ],
        "warnings": result.warnings,
    }
