# P006 forecasting methodology

## Target

Expected portions of one menu item on one open service day (`ALL_DAY`). Orders do not carry a meal period, so the forecast is not split by breakfast or lunch.

The horizon is the next 1 or 7 dates that are not in `canteen_closures`, starting the day after the last usable observation. A future Sunday is forecast unless a manager records a closure. Demo history marks Sundays closed so they are not training targets.

## Baseline

Seasonal naive. If at least two earlier open observations fall on the same weekday, the forecast is their median. Otherwise it is the median of the last 28 open days. Fewer than `FORECAST_MIN_BASELINE_DAYS` (7) earlier open days returns no number for that item. The run status is `INSUFFICIENT_DATA` when no item receives a number.

## Machine learning

`HistGradientBoostingRegressor` from scikit-learn 1.8.0 (`max_iter=80`, `learning_rate=0.08`, `max_depth=4`, `random_state` from `FORECAST_SEED`, default 7). It is trained only when there are at least 28 usable open days and both the validation block and the holdout block have at least four days.

Features, built only from dates strictly before the target:

- weekday, weekend indicator, month
- lag 1 and lag 7 of observed portions
- rolling mean and median of the last seven open observations

Closed and censored rows are excluded. The target quantity is not a feature. Confirmed preorders are not a model feature; the planner applies them later as a floor.

## Selection

The last seven usable days are the holdout. The seven before that are validation. The model that scores validation was fit only on earlier days. Holdout scores are stored and are not used to pick a winner.

The gradient-boosting candidate is marked recommended only when its validation MAE is below the baseline validation MAE multiplied by 0.97. Otherwise the baseline is recommended. Nothing is activated automatically. A manager can activate a candidate. Generation uses an active gradient-boosting artifact when one exists and its checksum matches. Otherwise it uses the baseline function.

## Uncertainty

If the active model has a holdout evaluation with at least 14 points, the planning band is plus or minus the rounded holdout RMSE. That band is labelled `RESIDUAL`. It is not a calibrated confidence interval. With fewer points the band is plus or minus the larger of 1 and 25 percent of the prediction, labelled `UNCALIBRATED`.

## Artifacts

The worker writes a joblib dict `{"estimator", "features"}` under `var/forecast_artifacts`. Load checks the parent directory and the SHA-256 stored on the model row. A client cannot supply a path. Untrusted pickle loading can execute code; this loader does not accept uploads.

Training that raises is stored as `FAILED` with a generic message. The exception text is not returned to the client.
