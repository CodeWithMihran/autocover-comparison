from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from .domain import CoverageType, NormalizedQuote, ParseResult
from .normalization import (
    dedupe_quotes,
    normalize_addon,
    normalize_registration,
    parse_date,
    parse_idv,
    parse_money,
    reference_date_from_env,
    validity_for,
)


def parse_provider_d(
    path: str | Path,
    registration: str | None = None,
    reference_date: date | None = None,
    known_registrations: set[str] | None = None,
) -> ParseResult:
    ref_date = reference_date or reference_date_from_env()
    requested = normalize_registration(registration) if registration else None
    output = ParseResult(provider="Provider D")

    with Path(path).open("r", encoding="utf-8-sig", newline="") as source:
        rows = csv.DictReader(source)
        required = {"reg_no", "vehicle", "plan", "premium_incl_gst", "idv", "addons", "valid_till"}
        if not required.issubset(set(rows.fieldnames or [])):
            raise ValueError(f"Provider D CSV is missing columns: {sorted(required - set(rows.fieldnames or []))}")
        for row in rows:
            reg = normalize_registration(row["reg_no"])
            if requested and reg != requested:
                continue
            total = parse_money(row["premium_incl_gst"])
            valid_until = parse_date(row["valid_till"])
            addons = [normalize_addon(value.strip()) for value in row["addons"].split("|") if value.strip()]
            warnings = ["Price includes GST, but the source does not provide the GST amount.",
                        "Coverage type is not explicitly stated in the source."]
            if known_registrations is not None and reg not in known_registrations:
                warnings.append("Registration is not present in the supplied vehicle registry.")
            output.quotes.append(
                NormalizedQuote(
                    provider="Provider D",
                    registration=reg,
                    source_quote_id=None,
                    plan_name=row["plan"].strip(),
                    total_premium_inr=total,
                    gst_inr=None,
                    base_premium_inr=None,
                    idv_inr=parse_idv(row["idv"]),
                    coverage_type=CoverageType.UNKNOWN,
                    addons=addons,
                    valid_until=valid_until,
                    validity_status=validity_for(valid_until, ref_date),
                    tax_included=True,
                    warnings=warnings,
                )
            )
    output.quotes = dedupe_quotes(output.quotes, output.warnings)
    return output
