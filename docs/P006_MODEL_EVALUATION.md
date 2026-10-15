# P006 model evaluation

Splits are chronological. There is no random shuffle. The holdout is not used to choose the model. WAPE is `sum(|error|) / sum(|actual|)` and is null when the actuals sum to zero.

## DEMO run

One local run on 15 October 2026, seed 7, 60 demo rows, one menu item, 50 open days (Sundays closed, about 5 percent of open days censored). Machine: 12th Gen Intel Core i7-12650H, Windows, the project virtualenv, database `bowlbyte_test` on PostgreSQL 16. This is not a pilot measurement.

| Model | Role | MAE | WAPE | Bias | RMSE | Points |
| --- | --- | --- | --- | --- | --- | --- |
| Seasonal naive | Validation | 2.143 | 0.134 | 0.429 | 2.478 | 7 |
| Seasonal naive | Holdout | 1.143 | 0.071 | 0.286 | 1.512 | 7 |
| HistGradientBoosting | Validation | 3.000 | 0.188 | 1.000 | 3.761 | 7 |
| HistGradientBoosting | Holdout | 2.286 | 0.142 | 0.857 | 2.726 | 7 |

Validation MAE for the gradient-boosting model (3.000) did not fall below 97 percent of the baseline validation MAE (2.143). The baseline stayed the preferred method. The holdout, which also favoured the baseline, was not used for that decision. These scores describe the seeded series. They are not accuracy on a real canteen.

## REAL run

An empty recorded history produces a `SEASONAL_NAIVE` candidate whose metrics status is `INSUFFICIENT_DATA`, and a forecast run with status `INSUFFICIENT_DATA`. No real-canteen MAE is claimed because the pilot database does not contain 28 open service days of trustworthy demand.

## Timings from the same demo run

| Step | Seconds |
| --- | --- |
| Seed 60 demo rows | 0.059 |
| Train both candidates in process | 1.273 |
| Generate a 7-day forecast | 0.066 |
| Generate a draft plan | 0.120 |

These are single runs, not a benchmark suite.
