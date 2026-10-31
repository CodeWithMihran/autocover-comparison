from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

from .domain import CoverageType, NormalizedQuote, ParseResult, ProviderDecline
from .normalization import (
    dedupe_quotes,
    normalize_addon,
    normalize_registration,
    parse_date,
    parse_idv,
    reference_date_from_env,
    round_rupees,
    validity_for,
)


def parse_provider_a(
    path: str | Path,
    registration: str | None = None,
    reference_date: date | None = None,
) -> ParseResult:
    """Parse Provider A's JSON quote response without hiding incomplete tax data."""
    ref_date = reference_date or reference_date_from_env()
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    output = ParseResult(provider="Provider A")
    requested = normalize_registration(registration) if registration else None

    for row in raw.get("quotes", []):
        reg = normalize_registration(row["registration"])
        if requested and reg != requested:
            continue
        if row.get("status", "").upper() == "DECLINED":
            output.declines.append(
                ProviderDecline("Provider A", reg, row.get("reason") or "Provider declined this vehicle.")
            )
            continue
        if row.get("status", "").upper() != "QUOTED":
            output.warnings.append(f"Ignored unsupported status {row.get('status')!r} for {reg}.")
            continue

        warnings: list[str] = []
        tax_included: bool | None = None
        base: int | None = None
        gst: int | None = None
        total: int | None = None
        taxes = row.get("taxes")

        if "premium" in row and row.get("premium_includes_gst") is True:
            total = round_rupees(row["premium"])
            tax_included = True
            warnings.append("Provider supplied a GST-inclusive total but no GST/base-premium breakdown.")
        elif "base_premium" in row:
            base = round_rupees(row["base_premium"])
            if taxes:
                tax_amount = Decimal("0")
                for tax in taxes:
                    rate = Decimal(str(tax.get("rate", 0)))
                    tax_amount += Decimal(base) * rate
                gst = round_rupees(tax_amount)
                total = base + gst
                tax_included = False
            else:
                reason = "taxes field is empty" if taxes == [] else "taxes field is missing"
                warnings.append(f"Total premium and GST are unknown because the {reason}; base premium is retained.")
                tax_included = None
        else:
            warnings.append("No recognized premium field was supplied.")

        coverage_raw = row.get("coverage", "").upper()
        coverage = {
            "COMPREHENSIVE": CoverageType.COMPREHENSIVE,
            "THIRD_PARTY": CoverageType.THIRD_PARTY,
        }.get(coverage_raw, CoverageType.UNKNOWN)
        if coverage is CoverageType.UNKNOWN:
            warnings.append(f"Unrecognized coverage value: {coverage_raw or 'missing'}.")

        valid_until = parse_date(row.get("valid_until"))
        output.quotes.append(
            NormalizedQuote(
                provider="Provider A",
                registration=reg,
                source_quote_id=None,
                plan_name=row.get("plan") or "Unnamed plan",
                total_premium_inr=total,
                gst_inr=gst,
                base_premium_inr=base,
                idv_inr=parse_idv(row.get("idv")),
                coverage_type=coverage,
                addons=[normalize_addon(value) for value in row.get("addons", [])],
                valid_until=valid_until,
                validity_status=validity_for(valid_until, ref_date),
                tax_included=tax_included,
                warnings=warnings,
            )
        )

    output.quotes = dedupe_quotes(output.quotes, output.warnings)
    return output
