"""Vegetarian / non-veg helpers for menu items."""

from __future__ import annotations

import re

# Whole-word markers for common non-veg canteen dishes.
# Keep SQL backfills in alembic migrations aligned with this list.
NON_VEG_MARKERS = (
    "chicken",
    "mutton",
    "egg",
    "eggs",
    "fish",
    "keema",
    "prawn",
    "prawns",
    "shrimp",
    "seafood",
    "bacon",
    "ham",
    "sausage",
    "lamb",
    "beef",
    "pork",
    "turkey",
    "duck",
    "pepperoni",
    "salami",
    "non veg",
    "non-veg",
    "nonveg",
    "meat",
    "seekh",
    "shawarma",
    "kebab",
    "kabab",
    "murgh",
    "gosht",
    "roe",
    "anchovy",
    "anchovies",
    "tuna",
    "salmon",
)

_NON_VEG = re.compile(
    r"(?<![a-z])("
    + "|".join(re.escape(marker) for marker in sorted(NON_VEG_MARKERS, key=len, reverse=True))
    + r")(?![a-z])",
    re.IGNORECASE,
)


def infer_is_vegetarian(name: str, description: str = "") -> bool:
    """Guess veg from the dish name and description when no flag is supplied."""

    text = f"{name} {description}".strip()
    if not text:
        return True
    return _NON_VEG.search(text) is None


def postgres_non_veg_pattern() -> str:
    """Case-insensitive Postgres regex covering the same markers as Python."""

    parts = []
    for marker in NON_VEG_MARKERS:
        escaped = re.escape(marker).replace(r"\ ", r"[\s\-]*")
        parts.append(escaped)
    return "(?i)(?<![a-z])(" + "|".join(parts) + ")(?![a-z])"
