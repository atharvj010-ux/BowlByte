"""Pure forecasting and planning maths.

Nothing here reads the database or the clock. Callers pass history whose dates
are already before the forecast origin, so a future sale cannot become a feature.
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

FEATURE_NAMES = (
    "dow",
    "weekend",
    "month",
    "lag1",
    "lag7",
    "roll_mean7",
    "roll_median7",
)
# ML must beat the baseline by this fraction on the validation origins.
# The final holdout is reported and is not used to pick the winner.
ML_IMPROVEMENT = 0.97


@dataclass(frozen=True)
class Observation:
    item_id: str
    day: date
    qty: int
    censored: bool = False
    closed: bool = False


@dataclass(frozen=True)
class Score:
    mae: float
    wape: float | None
    bias: float
    rmse: float
    n_points: int
    n_days: int
    n_items: int


def score_forecasts(pairs: list[tuple[float, float, str, date]]) -> Score | None:
    """pairs are (prediction, actual, item_id, day). WAPE is None when actuals sum to 0."""

    if not pairs:
        return None
    errors = [pred - actual for pred, actual, _, _ in pairs]
    absolute = [abs(error) for error in errors]
    denominator = sum(abs(actual) for _, actual, _, _ in pairs)
    count = len(pairs)
    return Score(
        mae=sum(absolute) / count,
        wape=(sum(absolute) / denominator) if denominator else None,
        bias=sum(errors) / count,
        rmse=math.sqrt(sum(error * error for error in errors) / count),
        n_points=count,
        n_days=len({day for *_, day in pairs}),
        n_items=len({item for _, _, item, _ in pairs}),
    )


def as_millis(value: float | None) -> int | None:
    if value is None:
        return None
    return int(round(value * 1000))


def portions(value: float) -> int:
    return max(0, int(round(value)))


def trainable(rows: list[Observation]) -> list[Observation]:
    """Open days with a trustworthy observed quantity. Closed and stockout days are out."""

    return [row for row in rows if not row.closed and not row.censored and row.qty >= 0]


def history_before(rows: list[Observation], item_id: str, origin: date) -> list[tuple[date, int]]:
    return sorted(
        (row.day, row.qty)
        for row in rows
        if row.item_id == item_id and row.day < origin and not row.closed and not row.censored
    )


def baseline_quantity(
    history: list[tuple[date, int]], target: date, minimum_days: int
) -> int | None:
    """Median of the same weekday, or of the recent open days when that weekday is thin."""

    prior = [(day, qty) for day, qty in history if day < target]
    if len(prior) < minimum_days:
        return None
    same = [qty for day, qty in prior if day.weekday() == target.weekday()]
    chosen = same if len(same) >= 2 else [qty for _, qty in prior[-28:]]
    return portions(statistics.median(chosen))


def feature_row(
    history: list[tuple[date, int]], target: date, minimum_days: int
) -> list[float] | None:
    prior = [qty for day, qty in history if day < target]
    if len(prior) < minimum_days:
        return None
    window = prior[-7:]
    return [
        float(target.weekday()),
        1.0 if target.weekday() >= 5 else 0.0,
        float(target.month),
        float(prior[-1]),
        float(prior[-7]),
        statistics.fmean(window),
        float(statistics.median(window)),
    ]


def lag_matches_past(history: list[tuple[date, int]], target: date, minimum_days: int = 7) -> bool:
    """True when lag features equal the open history strictly before the target date."""

    row = feature_row(history, target, minimum_days)
    past = [qty for day, qty in history if day < target]
    if row is None:
        return len(past) < minimum_days
    return row[3] == float(past[-1]) and row[4] == float(past[-7])


def next_open_days(start: date, closed: set[date], count: int, limit: int = 60) -> list[date]:
    found: list[date] = []
    cursor = start
    for _ in range(limit):
        if cursor not in closed:
            found.append(cursor)
        if len(found) == count:
            return found
        cursor += timedelta(days=1)
    return found


def residual_band(
    predictions: list[int],
    residuals: list[float],
    *,
    known_spread: float | None = None,
    known_n: int = 0,
) -> tuple[list[int], list[int], str]:
    """A planning band from validation residuals. Not a calibrated confidence interval."""

    if known_spread is not None and known_n >= 14:
        width = portions(known_spread)
        return (
            [max(0, qty - width) for qty in predictions],
            [qty + width for qty in predictions],
            "RESIDUAL",
        )
    if len(residuals) < 14:
        lowers = [max(0, qty - max(1, portions(qty * 0.25))) for qty in predictions]
        uppers = [qty + max(1, portions(qty * 0.25)) for qty in predictions]
        return lowers, uppers, "UNCALIBRATED"
    spread = statistics.pstdev(residuals) if len(residuals) > 1 else abs(residuals[0])
    width = portions(spread)
    return (
        [max(0, qty - width) for qty in predictions],
        [qty + width for qty in predictions],
        "RESIDUAL",
    )


@dataclass(frozen=True)
class ItemNeed:
    item_id: str
    name: str
    forecast_qty: int | None
    confirmed: int
    usable: int
    scheduled: int
    buffer_ratio: float
    prep_seconds: int
    station_id: str | None
    station_name: str
    station_capacity: int
    station_active: bool
    workload_seconds: int
    window_seconds: int


@dataclass(frozen=True)
class ItemPlan:
    item_id: str
    forecast_qty: int | None
    confirmed: int
    usable: int
    scheduled: int
    buffer_qty: int
    target_qty: int
    raw_additional: int
    recommended: int
    feasible: int
    unmet: int
    station_id: str | None
    duration_seconds: int
    capacity_limited: bool
    explanation: str


def target_quantity(item: ItemNeed) -> tuple[int, int]:
    """max(forecast, confirmed orders) plus a buffer. The forecast is total demand."""

    base = item.confirmed if item.forecast_qty is None else max(item.forecast_qty, item.confirmed)
    buffer = portions((item.forecast_qty or 0) * item.buffer_ratio)
    return base + buffer, buffer


def allocate(items: list[ItemNeed], *, deadline_hit: bool = False) -> tuple[list[ItemPlan], str]:
    """Greedy fill of station-minutes. Confirmed orders are served before forecast-only items.

    The result is feasible by construction: a station never receives more portions than
    its free minutes allow. OR-Tools is not used. A deadline returns the same greedy
    result only when it still fits; otherwise the caller passes deadline_hit and every
    item is reported unmet with an explanation, which is not a fake feasible plan.
    """

    if deadline_hit:
        blocked = [
            _row(
                item,
                recommended=0,
                limited=True,
                note=(
                    "The planner stopped before it could finish. "
                    "No quantity from this run should be cooked."
                ),
            )
            for item in items
        ]
        return blocked, "TIMEOUT"
    grouped: dict[str | None, list[ItemNeed]] = defaultdict(list)
    for item in items:
        grouped[item.station_id].append(item)
    plans: list[ItemPlan] = []
    for _station_id, group in grouped.items():
        sample = group[0]
        active = sample.station_active and sample.station_capacity > 0 and sample.window_seconds > 0
        free = (
            max(0, sample.station_capacity * sample.window_seconds - sample.workload_seconds)
            if active
            else 0
        )
        ordered = sorted(
            group,
            key=lambda row: (-row.confirmed, -(row.forecast_qty or 0), row.item_id),
        )
        for item in ordered:
            target, buffer = target_quantity(item)
            raw = max(0, target - item.usable - item.scheduled)
            portion_seconds = max(item.prep_seconds, 1)
            room = free // portion_seconds if active else 0
            recommended = min(raw, room)
            free -= recommended * portion_seconds
            limited = recommended < raw
            plans.append(
                _row(
                    item,
                    recommended=recommended,
                    limited=limited,
                    note=_explain(item, target, buffer, raw, recommended, room),
                    target=target,
                    buffer=buffer,
                    raw=raw,
                )
            )
    plans.sort(key=lambda row: row.item_id)
    return plans, "GREEDY"


def _explain(
    item: ItemNeed, target: int, buffer: int, raw: int, recommended: int, room: int
) -> str:
    forecast = "no forecast" if item.forecast_qty is None else f"{item.forecast_qty} forecast"
    parts = [
        f"{item.name}: {forecast}",
        f"{item.confirmed} confirmed and not yet collected",
        f"target {target} after a buffer of {buffer}",
        f"{item.usable} portions still usable",
        f"{item.scheduled} already scheduled",
        f"{raw} more would meet the target",
        f"the station can take {room} more in this window",
        f"recommend preparing {recommended}",
    ]
    if recommended < raw:
        parts.append(f"{raw - recommended} portions do not fit")
    if item.forecast_qty is not None and item.confirmed:
        parts.append("confirmed orders are a floor, not an addition on top of the forecast")
    return ". ".join(parts) + "."


def _row(
    item: ItemNeed,
    *,
    recommended: int,
    limited: bool,
    note: str,
    target: int | None = None,
    buffer: int | None = None,
    raw: int | None = None,
) -> ItemPlan:
    if target is None or buffer is None or raw is None:
        target, buffer = target_quantity(item)
        raw = max(0, target - item.usable - item.scheduled)
    return ItemPlan(
        item_id=item.item_id,
        forecast_qty=item.forecast_qty,
        confirmed=item.confirmed,
        usable=item.usable,
        scheduled=item.scheduled,
        buffer_qty=buffer,
        target_qty=target,
        raw_additional=raw,
        recommended=recommended,
        feasible=recommended,
        unmet=max(0, raw - recommended),
        station_id=item.station_id,
        duration_seconds=item.prep_seconds,
        capacity_limited=limited,
        explanation=note,
    )
