from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .domain import Vehicle
from .normalization import normalize_registration, parse_date


def load_vehicles(path: str | Path) -> dict[str, Vehicle]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    vehicles: dict[str, Vehicle] = {}
    for item in raw["vehicles"]:
        registration = normalize_registration(item["registration_number"])
        vehicles[registration] = Vehicle(
            registration=registration,
            make=item["make"],
            model=item["model"],
            variant=item["variant"],
            fuel_type=item.get("fuel_type"),
            engine_cc=int(item["engine_cc"]),
            registration_date=parse_date(item["registration_date"]),
            rto=item["rto"],
            ex_showroom_price_inr=int(item["ex_showroom_price"]),
            ncb_percent=int(item["ncb_percent"]),
        )
    return vehicles
