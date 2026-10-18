"""Supabase Auth admin client for identity import.

Roles are never sent. Responses that contain secrets are not logged.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request


class AuthAdminError(RuntimeError):
    def __init__(self, status: int) -> None:
        super().__init__(f"Supabase Auth admin request failed with HTTP {status}.")
        self.status = status


class SupabaseAuthAdmin:
    def __init__(self, base_url: str, secret: str) -> None:
        self._base = base_url.rstrip("/")
        self._secret = secret
        self._by_email: dict[str, str] | None = None

    def find_user_id(self, email: str) -> str | None:
        if self._by_email is None:
            self._by_email = self._load_users()
        return self._by_email.get(email.strip().lower())

    def create_user(self, email: str, password_hash: str, *, email_confirm: bool) -> str:
        status, body = self._request(
            "POST",
            "/auth/v1/admin/users",
            {"email": email, "password_hash": password_hash, "email_confirm": email_confirm},
        )
        if status in {200, 201}:
            user_id = str(body.get("id") or "")
            if not user_id:
                raise AuthAdminError(status)
            if self._by_email is not None:
                self._by_email[email.strip().lower()] = user_id
            return user_id
        if status in {409, 422}:
            self._by_email = None
            existing = self.find_user_id(email)
            if existing:
                return existing
        raise AuthAdminError(status)

    def _load_users(self) -> dict[str, str]:
        found: dict[str, str] = {}
        page = 1
        while page <= 20:
            status, body = self._request(
                "GET",
                f"/auth/v1/admin/users?page={page}&per_page=200",
                None,
            )
            if status != 200:
                raise AuthAdminError(status)
            users = body.get("users", [])
            if not isinstance(users, list) or not users:
                break
            for user in users:
                email = str(user.get("email") or "").strip().lower()
                user_id = str(user.get("id") or "")
                if email and user_id:
                    found[email] = user_id
            if len(users) < 200:
                break
            page += 1
        return found

    def _request(self, method: str, path: str, body: dict | None) -> tuple[int, dict]:
        for attempt in range(5):
            data = None if body is None else json.dumps(body).encode()
            call = urllib.request.Request(
                f"{self._base}{path}",
                data=data,
                headers={
                    "apikey": self._secret,
                    "authorization": f"Bearer {self._secret}",
                    "content-type": "application/json",
                },
                method=method,
            )
            try:
                with urllib.request.urlopen(call, timeout=30) as response:
                    raw = response.read().decode()
                    return response.status, json.loads(raw) if raw else {}
            except urllib.error.HTTPError as error:
                if error.code == 429 and attempt < 4:
                    time.sleep(2 * (attempt + 1))
                    continue
                raw = error.read().decode()
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    payload = {}
                return error.code, payload if isinstance(payload, dict) else {}
        raise AuthAdminError(429)
