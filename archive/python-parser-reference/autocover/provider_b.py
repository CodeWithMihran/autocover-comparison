from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

from .domain import CoverageType, NormalizedQuote, ParseResult, ProviderDecline
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


@dataclass
class _Node:
    tag: str
    attrs: dict[str, str]
    children: list["_Node"] = field(default_factory=list)
    text: list[str] = field(default_factory=list)

    def descendants(self, tag: str | None = None, class_name: str | None = None) -> list["_Node"]:
        found: list[_Node] = []
        for child in self.children:
            classes = child.attrs.get("class", "").split()
            if (tag is None or child.tag == tag) and (class_name is None or class_name in classes):
                found.append(child)
            found.extend(child.descendants(tag, class_name))
        return found

    def text_content(self) -> str:
        return " ".join([*self.text, *(child.text_content() for child in self.children)]).strip()


class _TreeParser(HTMLParser):
    _VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _Node("document", {})
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = _Node(tag, {key: value or "" for key, value in attrs})
        self.stack[-1].children.append(node)
        if tag not in self._VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.stack[-1].children.append(_Node(tag, {key: value or "" for key, value in attrs}))

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.stack[-1].text.append(data.strip())


def _embedded_quote_data(html: str) -> dict[str, dict[str, str]]:
    match = re.search(r"window\.__QUOTE_DATA__\s*=\s*(\{.*?\})\s*;\s*document\.", html, re.S)
    if not match:
        raise ValueError("Provider B HTML did not contain its embedded __QUOTE_DATA__ object.")
    return json.loads(match.group(1))


def parse_provider_b(
    path: str | Path,
    registration: str | None = None,
    reference_date: date | None = None,
) -> ParseResult:
    """Parse static HTML plus its embedded JS quote payload; no browser is needed."""
    ref_date = reference_date or reference_date_from_env()
    html = Path(path).read_text(encoding="utf-8")
    tree = _TreeParser()
    tree.feed(html)
    prices = _embedded_quote_data(html)
    output = ParseResult(provider="Provider B")
    requested = normalize_registration(registration) if registration else None

    for vehicle in tree.root.descendants(tag="section", class_name="vehicle"):
        reg = normalize_registration(vehicle.attrs.get("data-reg", ""))
        if not reg:
            output.warnings.append("Skipped Provider B vehicle section with no registration.")
            continue
        if requested and reg != requested:
            continue
        cards = vehicle.descendants(tag="div", class_name="plan-card")
        for card in cards:
            plan_id = card.attrs.get("data-plan-id")
            if not plan_id:
                message = card.text_content()
                if "not available" in message.lower():
                    output.declines.append(ProviderDecline("Provider B", reg, message))
                continue

            warnings: list[str] = []
            plan_headings = card.descendants(tag="h3")
            plan_name = plan_headings[0].text_content() if plan_headings else plan_id
            payload = prices.get(plan_id)
            if payload is None:
                output.warnings.append(f"No embedded price data for {plan_id} ({reg}).")
                continue
            total = parse_money(payload.get("total"))
            valid_until = parse_date(payload.get("valid_till"))
            cover = parse_idv(payload.get("cover"))
            addon_lists = card.descendants(tag="ul", class_name="addons")
            source_addons = [
                li.text_content()
                for addon_list in addon_lists
                for li in addon_list.descendants(tag="li")
            ]
            mapped = [normalize_addon(label) for label in source_addons]
            benefits = [label for label in source_addons if normalize_addon(label).concept.value == "unknown"]
            warnings.extend(
                [
                    "Price includes taxes, but the source does not provide a GST breakdown.",
                    "Coverage type is not explicitly stated in the source.",
                ]
            )
            if cover is None:
                warnings.append("Provider B cover/IDV could not be parsed.")
            output.quotes.append(
                NormalizedQuote(
                    provider="Provider B",
                    registration=reg,
                    source_quote_id=plan_id,
                    plan_name=plan_name,
                    total_premium_inr=total,
                    gst_inr=None,
                    base_premium_inr=None,
                    idv_inr=cover,
                    coverage_type=CoverageType.UNKNOWN,
                    addons=mapped,
                    benefits=benefits,
                    valid_until=valid_until,
                    validity_status=validity_for(valid_until, ref_date),
                    tax_included=True,
                    warnings=warnings,
                )
            )

    output.quotes = dedupe_quotes(output.quotes, output.warnings)
    return output
