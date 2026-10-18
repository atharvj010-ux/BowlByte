# P014 Redis and Celery

## Why this Redis

WSL Ubuntu Redis is not the broker. In P014.1, Windows-to-WSL connections dropped, Ubuntu Redis restarted under systemd while bound only inside the VM, and WSL later reported `Wsl/Service/E_UNEXPECTED`. Docker Desktop also uses WSL, so this phase did not run `wsl --shutdown`, unregister Ubuntu, or delete a WSL disk.

The live broker is the Windows-native Redis 8.10.2 build installed for the current user (`taizod1024.redis-windows-fork`). `scripts/redis/bowlbyte.conf` binds `127.0.0.1:6379` with protected mode on and no public authentication, because the port is not reachable off this machine. The config path is relative to `%LOCALAPPDATA%\BowlByte\redis` so the msys2 build does not rewrite the path.

`REDIS_URL` for the live processes is `redis://127.0.0.1:6379/0`. FastAPI, the worker, and Beat use that same URL. Disposable tests use database `/1` on the same local server. Numeric databases are supported by this build.

## Celery

Windows Celery is not an upstream-supported production pool. The native worker uses `--pool=solo`. Tasks run one at a time in that process. A long forecast blocks the outbox drain until it finishes. That is acceptable for this local runtime and is not a prefork deployment.

Beat is a separate process. `start-dev.ps1` starts exactly one. Its schedule is `bowlbyte.drain_outbox` every 15 seconds and `bowlbyte.sweep_pickup_holds` every 60 seconds. Do not start a Docker Beat against the same queue.

Broker sockets use a 5 second connect timeout, a 30 second socket timeout, retry on timeout, and a 25 second health check. The earlier 2 second timeout made a normal `BRPOP` look like a dropped broker.

`task_ignore_result` is true. A successful task is confirmed in the worker log, not by `AsyncResult.get()`.
