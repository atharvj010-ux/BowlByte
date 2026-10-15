"""Pure forecast and planning checks. No database and no clock."""

from datetime import date, timedelta

import pytest

from app.core.errors import ApiError
from app.foodintel.core import (
    ItemNeed,
    Observation,
    allocate,
    baseline_quantity,
    feature_row,
    history_before,
    lag_matches_past,
    next_open_days,
    residual_band,
    score_forecasts,
    target_quantity,
    trainable,
)
from app.services.forecasting import _load_artifact


def _days(start: date, quantities: list[int], item: str = "sandwich") -> list[Observation]:
    return [
        Observation(item, start + timedelta(days=offset), qty)
        for offset, qty in enumerate(quantities)
    ]


def test_empty_and_sparse_history_have_no_baseline() -> None:
    assert baseline_quantity([], date(2026, 10, 15), 7) is None
    short = [(date(2026, 10, 1) + timedelta(days=index), 4) for index in range(3)]
    assert baseline_quantity(short, date(2026, 10, 15), 7) is None


def test_same_weekday_median() -> None:
    start = date(2026, 9, 7)  # Monday
    history = [(start + timedelta(days=index), 10 if index % 7 == 0 else 2) for index in range(21)]
    target = start + timedelta(days=28)  # also Monday
    assert baseline_quantity(history, target, 7) == 10


def test_closed_and_censored_days_are_not_training_targets() -> None:
    day = date(2026, 10, 1)
    rows = [
        Observation("a", day, 0, closed=True),
        Observation("a", day + timedelta(days=1), 3, censored=True),
        Observation("a", day + timedelta(days=2), 8),
    ]
    assert [row.qty for row in trainable(rows)] == [8]
    assert history_before(rows, "a", day + timedelta(days=3)) == [(day + timedelta(days=2), 8)]


def test_features_ignore_the_target_day_and_later_days() -> None:
    start = date(2026, 1, 1)
    history = [(start + timedelta(days=index), index + 1) for index in range(14)]
    target = start + timedelta(days=10)
    leaked = history + [(target, 999), (target + timedelta(days=1), 1000)]
    assert feature_row(leaked, target, 7) == feature_row(history, target, 7)
    assert lag_matches_past(leaked, target)


def test_new_item_and_rename_do_not_share_history() -> None:
    start = date(2026, 3, 1)
    rows = _days(start, [5] * 10, "old-id")
    history = history_before(
        [Observation(row.item_id, row.day, row.qty) for row in rows],
        "new-id",
        start + timedelta(days=20),
    )
    assert history == []
    assert baseline_quantity(history, start + timedelta(days=20), 7) is None


def test_closed_days_are_skipped_in_the_horizon() -> None:
    start = date(2026, 10, 12)
    closed = {start + timedelta(days=1)}
    assert next_open_days(start, closed, 2) == [start, start + timedelta(days=2)]


def test_zero_demand_makes_wape_undefined() -> None:
    score = score_forecasts([(2, 0, "a", date(2026, 1, 1)), (3, 0, "a", date(2026, 1, 2))])
    assert score is not None
    assert score.wape is None
    assert score.mae == 2.5
    assert score.bias == 2.5


def test_metrics_use_the_supplied_pairs_only() -> None:
    day = date(2026, 2, 1)
    score = score_forecasts([(10, 8, "a", day), (4, 6, "b", day)])
    assert score is not None
    assert score.mae == 2
    assert score.wape == 4 / 14
    assert score.n_items == 2
    assert score.n_days == 1


def test_planning_range_is_labelled() -> None:
    _, _, thin = residual_band([10], [], known_spread=2, known_n=3)
    assert thin == "UNCALIBRATED"
    lowers, uppers, kind = residual_band([10, 20], [], known_spread=1.2, known_n=14)
    assert kind == "RESIDUAL"
    assert lowers[0] <= 10 <= uppers[0]


def test_confirmed_orders_are_a_floor_not_an_addition() -> None:
    item = ItemNeed(
        item_id="a",
        name="Sandwich",
        forecast_qty=80,
        confirmed=10,
        usable=20,
        scheduled=15,
        buffer_ratio=0,
        prep_seconds=60,
        station_id="s",
        station_name="Hot",
        station_capacity=4,
        station_active=True,
        workload_seconds=0,
        window_seconds=3600,
    )
    target, buffer = target_quantity(item)
    assert target == 80
    assert buffer == 0
    plans, solver = allocate([item])
    assert solver == "GREEDY"
    assert plans[0].recommended == 45


def test_capacity_and_inactive_station_limit_the_plan() -> None:
    def need(item_id: str, confirmed: int, active: bool) -> ItemNeed:
        return ItemNeed(
            item_id=item_id,
            name=item_id,
            forecast_qty=10,
            confirmed=confirmed,
            usable=0,
            scheduled=0,
            buffer_ratio=0,
            prep_seconds=60,
            station_id="s",
            station_name="Hot",
            station_capacity=1 if active else 0,
            station_active=active,
            workload_seconds=0,
            window_seconds=60,
        )

    plans, _ = allocate([need("later", 0, True), need("first", 4, True)])
    by_id = {row.item_id: row for row in plans}
    assert by_id["first"].recommended == 1
    assert by_id["later"].recommended == 0
    assert by_id["later"].unmet == 10
    blocked, solver = allocate([need("later", 0, False)], deadline_hit=False)
    assert blocked[0].recommended == 0
    stopped, name = allocate([need("later", 1, True)], deadline_hit=True)
    assert name == "TIMEOUT"
    assert solver == "GREEDY"
    assert stopped[0].recommended == 0
    assert "should be cooked" in stopped[0].explanation


def test_untrusted_artifact_path_is_rejected(tmp_path) -> None:
    rogue = tmp_path / "model.joblib"
    rogue.write_bytes(b"not-a-model")
    with pytest.raises(ApiError) as caught:
        _load_artifact(str(rogue), "abc")
    assert caught.value.status_code == 409
