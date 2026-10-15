# P008 deployment guide

BowlByte stays one Next.js application, one FastAPI process, PostgreSQL 16, Redis, a Celery worker, and Celery Beat. Staging does not add a new service beyond the Caddy TLS proxy already planned in P007.

## Development, unchanged

The running project is `bowlbyte` from `docker-compose.yml`.

| Surface | Address |
| --- | --- |
| Frontend | http://127.0.0.1:3010 |
| API | http://127.0.0.1:8010 |
| PostgreSQL | 127.0.0.1:5433 |
| Redis | 127.0.0.1:6379 |
| Mailpit | http://127.0.0.1:8025 |

`COOKIE_SECURE` is false on this HTTP origin. Session cookies are `bowlbyte_session` and `bowlbyte_csrf`. When `COOKIE_SECURE=true`, both names become `__Host-` cookies, HttpOnly on the session cookie, SameSite `lax`, path `/`.

## Isolated staging

`docker-compose.staging.yml` is a separate Compose project named `bowlbyte-staging`. It has its own network and named volumes. It does not publish PostgreSQL, Redis, or Mailpit. Do not pass `docker-compose.yml` on the same command. Do not reuse the development `.env`.

```powershell
docker compose --env-file deploy/staging.env.example -f docker-compose.staging.yml config --quiet
```

That command checks the file. It does not start containers. P008 did not run `up`. The example file contains placeholders. Production startup rejects `replace-with` keys, the default database password, `COOKIE_SECURE=false`, test push endpoints, and a short proxy secret.

Copy `deploy/staging.env.example` to a gitignored file, replace every placeholder, then start only that file:

```powershell
docker compose --env-file path\to\staging.env -f docker-compose.staging.yml up -d
```

## HTTPS

| Mode | File | Meaning |
| --- | --- | --- |
| Local internal certificate | `deploy/Caddyfile` | `tls internal`. Not a public certificate |
| Public name | `deploy/Caddyfile.public` | Caddy requests a publicly trusted certificate for `BOWLBYTE_SITE_ADDRESS` |

Caddy publishes `127.0.0.1:8443` by default. The browser origin is HTTPS. The Next.js server proxies `/api/v1` and WebSocket upgrades to the API on the Docker network, so cookies and sockets stay same-origin. `TRUST_PROXY=true` lets the Next server use the rightmost `X-Forwarded-For` hop. The API still ignores raw `X-Forwarded-For` unless the proxy shared secret matches.

Verify a public certificate without disabling verification:

```powershell
curl.exe --ssl-reqd --fail https://canteen.example.edu/api/v1/health
```

Do not use `curl -k`. A Caddy internal certificate on 127.0.0.1 is not that check. P008 status: **NOT DEPLOYED**. No hostname or hosting account was available.

## What each process may see

| Secret | API | Worker | Beat | Frontend |
| --- | --- | --- | --- | --- |
| Database password | yes | yes | yes | no |
| `PROXY_SHARED_SECRET` | yes | no | no | yes, so it can stamp the client IP |
| `VAPID_PRIVATE_KEY` | no | yes | no | no |
| Pickup hash and push encryption keys | yes | yes | yes, via the shared env block | no |

Menu images live in PostgreSQL. Forecast files for staging live on the `bowlbyte-staging-forecasts` volume. Notification state lives in PostgreSQL, so a worker restart does not drop the outbox. Caddy certificates live on `bowlbyte-staging-caddy`.

## Secret rotation

Generate pickup, push, and proxy values outside the repo. Generate VAPID with `python -m app.cli.generate_vapid` and store the private key only on the worker. Restart API and worker after a proxy or pickup key change. A pickup key change invalidates outstanding QR codes. A VAPID key change requires browsers to subscribe again. Do not commit the generated values.
