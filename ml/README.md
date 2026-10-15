# Machine learning

Forecasting lives in the API image so the existing backend container can train it.

| Piece | Location |
| --- | --- |
| Feature maths, metrics, and the greedy planner | `backend/app/foodintel/core.py` |
| Dataset extraction | `backend/app/services/demand.py` |
| Training, artifacts, and forecast runs | `backend/app/services/forecasting.py` |
| Preparation plans | `backend/app/services/planning.py` |

Training is the Celery task `bowlbyte.train_forecast`. It does not run inside the HTTP request. Artifacts are joblib files under `backend/var/forecast_artifacts`, which is gitignored. Loading checks that the path stays in that directory and that the SHA-256 matches the row written at training time. An untrusted pickle can execute code, so a client cannot upload or choose an artifact.

The demo dataset is seeded and labelled `DEMO`. A score from that dataset is not real canteen accuracy. See `docs/P006_FORECASTING_METHODOLOGY.md` and `docs/P006_MODEL_EVALUATION.md`.
