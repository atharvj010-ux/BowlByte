# P015 bug fixes

## Order create returned 500 after commit

The create path called `Session.refresh` on the same pooled connection immediately after `commit`. The idempotent retry does not. A session-pooler disconnect at commit leaves the order, payment, stock reservation, and idempotency row saved, then raises a database error while building the response. FastAPI reports that as HTTP 500. The next request with the same key loads the row on a new connection and returns 201.

`place_order` now reloads the committed order if that read fails, and the engine disables named prepared statements (`prepare_threshold=None`) for the pooler. `tests/test_ordering_unit.py` covers the reload. This phase did not place another live order to reproduce the original 500.

## Hydration

`data-cursor-ref` is injected by the Cursor browser and is not application HTML.

These render-time `window` branches changed markup or called `setState` during render. They now run in effects, so the first client render matches the server:

- `frontend/src/components/auth/login-form.tsx`
- `frontend/src/components/auth/token-confirm.tsx`
- `frontend/src/components/auth/recovery-forms.tsx`

## Menu images

No image bytes are stored. The menu already labels missing photos as illustrative. No food photo was invented.
