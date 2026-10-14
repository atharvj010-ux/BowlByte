import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.security import hash_secret
from app.db.session import SessionLocal
from app.models.identity import PENDING_VERIFICATION, EmailVerificationToken, User
from app.services.identity import (
    BootstrapError,
    bootstrap_first_manager,
    create_manager,
    import_roster,
)
from app.services.rate_limit import clear_counters

pytestmark = pytest.mark.integration

PASSWORD = "correct-horse-battery"
MAILPIT = os.environ.get("MAILPIT_URL", "http://127.0.0.1:8025")


@pytest.fixture(scope="module", autouse=True)
def reset_identity_tables() -> None:
    database = get_settings().database_url.rsplit("/", 1)[-1].split("?")[0]
    if database != "bowlbyte_test":
        pytest.fail("Auth integration tests must use the bowlbyte_test database.")
    db = SessionLocal()
    db.execute(
        text(
            "TRUNCATE order_idempotency_records, inventory_adjustments, order_payments, "
            "order_events, order_items, orders, daily_stock, menu_item_station_assignments, "
            "menu_items, kitchen_stations, menu_categories, "
            "audit_log, sessions, staff_invitations, email_verification_tokens, "
            "student_roster_entries, staff_memberships, student_profiles, "
            "users, canteens, colleges "
            "RESTART IDENTITY CASCADE"
        )
    )
    db.commit()
    db.close()
    yield


@pytest.fixture(autouse=True)
def reset_rate_limits() -> None:
    clear_counters()
    yield
    clear_counters()


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@student.bowlbyte.edu"


def _csrf(client: TestClient) -> dict[str, str]:
    token = client.cookies.get("bowlbyte_csrf")
    assert token
    return {"x-csrf-token": token}


def _mail_text(recipient: str) -> str:
    query = quote(f"to:{recipient}")
    for _ in range(30):
        with urlopen(f"{MAILPIT}/api/v1/search?query={query}", timeout=3) as response:
            payload = json.load(response)
        messages = payload.get("messages") or []
        if messages:
            message_id = messages[0]["ID"]
            with urlopen(f"{MAILPIT}/api/v1/message/{message_id}", timeout=3) as response:
                body = json.load(response)
            return body.get("Text") or ""
        time.sleep(0.2)
    raise AssertionError(f"No Mailpit message for {recipient}")


def _token_from_mail(recipient: str) -> str:
    body = _mail_text(recipient)
    match = re.search(r"#token=([A-Za-z0-9_\-]+)", body)
    assert match, body
    return match.group(1)


def _register(client: TestClient, email: str, roll: str, code: str | None = None) -> object:
    payload = {
        "full_name": "Asha Rao",
        "email": email,
        "roll_number": roll,
        "password": PASSWORD,
        "confirm_password": PASSWORD,
    }
    if code is not None:
        payload["enrollment_code"] = code
    return client.post("/api/v1/auth/student/register", json=payload)


def _login(client: TestClient, email: str):
    logged_in = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert logged_in.status_code == 200, logged_in.text
    return logged_in


def _verify_and_login(client: TestClient, email: str) -> None:
    token = _token_from_mail(email)
    verified = client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verified.status_code == 200, verified.text
    _login(client, email)


def test_bootstrap_creates_one_manager_and_rejects_another(tmp_path: Path) -> None:
    email = f"manager-{uuid.uuid4().hex[:8]}@staff.bowlbyte.edu"
    db = SessionLocal()
    try:
        user = bootstrap_first_manager(
            db,
            email=email,
            full_name="Pilot Manager",
            password=PASSWORD,
        )
        assert user.role == "CANTEEN_MANAGER"
        assert user.password_hash != PASSWORD
        assert user.password_hash.startswith("$argon2id$")
        with pytest.raises(BootstrapError):
            bootstrap_first_manager(
                db,
                email="second@staff.bowlbyte.edu",
                full_name="Second",
                password=PASSWORD,
            )
    finally:
        db.close()

    rejected = subprocess.run(
        [sys.executable, "-m", "app.cli.bootstrap_manager", "--password", "not-a-real-secret"],
        check=False,
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    assert rejected.returncode == 2
    assert "not-a-real-secret" not in rejected.stdout
    assert "not-a-real-secret" not in rejected.stderr


def test_student_cannot_choose_a_role(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/student/register",
        json={
            "full_name": "Asha Rao",
            "email": _email("role"),
            "roll_number": "CS100",
            "password": PASSWORD,
            "confirm_password": PASSWORD,
            "role": "CANTEEN_MANAGER",
        },
    )

    assert response.status_code == 422
    assert "CANTEEN_MANAGER" not in response.text
    db = SessionLocal()
    try:
        assert (
            db.scalar(select(User).where(User.role == "CANTEEN_MANAGER", User.email.like("role-%")))
            is None
        )
    finally:
        db.close()


def test_registration_requires_the_college_domain(client: TestClient) -> None:
    response = _register(client, "person@gmail.com", "CS101")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ELIGIBILITY_REJECTED"
    db = SessionLocal()
    try:
        assert db.scalar(select(User).where(User.email == "person@gmail.com")) is None
    finally:
        db.close()


def test_register_verify_and_reject_expired_or_reused_tokens(client: TestClient) -> None:
    email = _email("verify")
    created = _register(client, email, "CS102")
    assert created.status_code == 202, created.text
    token = _token_from_mail(email)
    assert token not in created.text

    first = client.post("/api/v1/auth/verify-email", json={"token": token})
    assert first.status_code == 200
    assert first.json()["user"]["role"] == "STUDENT"
    assert first.json()["user"]["status"] == "ACTIVE"
    reused = client.post("/api/v1/auth/verify-email", json={"token": token})
    assert reused.status_code == 400

    pending = _email("expired")
    assert _register(client, pending, "CS103").status_code == 202
    expired_token = _token_from_mail(pending)
    db = SessionLocal()
    try:
        row = db.scalar(
            select(EmailVerificationToken).where(
                EmailVerificationToken.token_hash == hash_secret(expired_token)
            )
        )
        assert row is not None
        row.expires_at = row.created_at
        db.commit()
    finally:
        db.close()
    rejected = client.post("/api/v1/auth/verify-email", json={"token": expired_token})
    assert rejected.status_code == 400
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == pending))
        assert user is not None
        assert user.status == PENDING_VERIFICATION
        assert user.email_verified_at is None
    finally:
        db.close()


def test_unverified_and_invalid_passwords_do_not_create_sessions(
    client: TestClient, caplog
) -> None:
    email = _email("pending")
    assert _register(client, email, "CS104").status_code == 202
    pending = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert pending.status_code == 401
    assert pending.json()["error"]["message"] == "Email or password is incorrect."
    assert "bowlbyte_session" not in pending.cookies

    missing = client.post(
        "/api/v1/auth/login",
        json={"email": "missing@student.bowlbyte.edu", "password": "missing-password-value"},
    )
    assert missing.status_code == 401
    assert missing.json()["error"]["message"] == pending.json()["error"]["message"]
    assert "missing-password-value" not in caplog.text
    assert "missing-password-value" not in missing.text


def test_login_survives_until_logout_or_expiry(client: TestClient) -> None:
    email = _email("session")
    assert _register(client, email, "CS105").status_code == 202
    _verify_and_login(client, email)
    first_cookie = client.cookies.get("bowlbyte_session")
    assert first_cookie
    assert client.get("/api/v1/auth/me").status_code == 200

    again = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert again.status_code == 200
    client.cookies.set("bowlbyte_session", first_cookie)
    assert client.get("/api/v1/auth/me").status_code == 401

    client.cookies.clear()
    _login(client, email)
    me = client.get("/api/v1/auth/me")
    assert me.json()["user"]["email"] == email
    session_cookie = client.cookies.get("bowlbyte_session")
    csrf_cookie = client.cookies.get("bowlbyte_csrf")
    assert session_cookie and csrf_cookie
    logged_out = client.post("/api/v1/auth/logout", headers={"x-csrf-token": csrf_cookie})
    assert logged_out.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.set("bowlbyte_session", session_cookie)
    client.cookies.set("bowlbyte_csrf", csrf_cookie)
    replay = client.post("/api/v1/auth/logout", headers={"x-csrf-token": csrf_cookie})
    assert replay.status_code == 401


def test_expired_and_disabled_sessions_are_rejected(client: TestClient) -> None:
    email = _email("disable")
    assert _register(client, email, "CS106").status_code == 202
    _verify_and_login(client, email)
    db = SessionLocal()
    try:
        from app.models.identity import Session as SessionRow

        row = db.scalar(
            select(SessionRow).where(
                SessionRow.user_id == db.scalar(select(User.id).where(User.email == email))
            )
        )
        assert row is not None
        row.expires_at = row.created_at
        db.commit()
    finally:
        db.close()
    assert client.get("/api/v1/auth/me").status_code == 401

    _login(client, email)
    cookie = client.cookies.get("bowlbyte_session")
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        user.status = "DISABLED"
        db.commit()
    finally:
        db.close()
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.set("bowlbyte_session", cookie)
    assert client.get("/api/v1/auth/me").status_code == 401


def test_csrf_and_login_rate_limit(client: TestClient) -> None:
    bare = TestClient(client.app)
    rejected = bare.post(
        "/api/v1/auth/login",
        json={"email": "rate@student.bowlbyte.edu", "password": PASSWORD},
    )
    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "CSRF_REJECTED"

    email = _email("rate")
    assert _register(client, email, "CS107").status_code == 202
    _verify_and_login(client, email)
    missing_token = client.post("/api/v1/auth/logout")
    assert missing_token.status_code == 403
    assert missing_token.json()["error"]["code"] == "CSRF_REJECTED"

    client.cookies.clear()
    for _ in range(5):
        failed = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "wrong-password-value"},
        )
        assert failed.status_code == 401
    blocked = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"


def test_roster_code_is_required_and_a_roll_number_is_not_enough(
    client: TestClient, tmp_path: Path
) -> None:
    settings = get_settings()
    previous = settings.college_eligibility_mode
    settings.college_eligibility_mode = "roster"
    try:
        roster = tmp_path / "roster.csv"
        code = "enrollment-code-with-enough-length"
        roster.write_text(f"roll_number,enrollment_code\nME201,{code}\n", encoding="utf-8")
        db = SessionLocal()
        try:
            counts = import_roster(db, str(roster))
        finally:
            db.close()
        assert counts["imported"] == 1

        missing = _register(client, _email("roster"), "ME201")
        assert missing.status_code == 403
        wrong = _register(client, _email("roster"), "ME201", "short-code")
        assert wrong.status_code == 403
        guessed = _register(client, _email("roster"), "ME201", "roll-number-is-not-the-secret")
        assert guessed.status_code == 403
        accepted = _register(client, _email("rosterok"), "ME201", code)
        assert accepted.status_code == 202, accepted.text
    finally:
        settings.college_eligibility_mode = previous


def test_staff_invitation_is_single_use_and_canteen_scoped(client: TestClient) -> None:
    db = SessionLocal()
    try:
        manager = create_manager(
            db,
            email=f"manager-{uuid.uuid4().hex[:8]}@staff.bowlbyte.edu",
            full_name="North Manager",
            password=PASSWORD,
            canteen_name="North Canteen",
            canteen_slug=f"north-{uuid.uuid4().hex[:6]}",
        )
        other = create_manager(
            db,
            email=f"manager-{uuid.uuid4().hex[:8]}@staff.bowlbyte.edu",
            full_name="South Manager",
            password=PASSWORD,
            canteen_name="South Canteen",
            canteen_slug=f"south-{uuid.uuid4().hex[:6]}",
        )
        manager_email = manager.email
        other_email = other.email
    finally:
        db.close()

    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": manager_email, "password": PASSWORD},
        ).status_code
        == 200
    )
    denied_role = client.post(
        "/api/v1/admin/staff/invitations",
        headers=_csrf(client),
        json={"email": _email("invite"), "role": "CANTEEN_MANAGER"},
    )
    assert denied_role.status_code == 422

    kitchen_email = f"kitchen-{uuid.uuid4().hex[:8]}@staff.bowlbyte.edu"
    invited = client.post(
        "/api/v1/admin/staff/invitations",
        headers=_csrf(client),
        json={"email": kitchen_email, "role": "KITCHEN_STAFF"},
    )
    assert invited.status_code == 201, invited.text
    assert "token" not in invited.text
    token = _token_from_mail(kitchen_email)
    accepted = client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "token": token,
            "full_name": "Kitchen Lead",
            "password": PASSWORD,
            "confirm_password": PASSWORD,
        },
    )
    assert accepted.status_code == 201
    assert accepted.json()["user"]["role"] == "KITCHEN_STAFF"
    assert "bowlbyte_session" not in accepted.cookies
    reused = client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "token": token,
            "full_name": "Kitchen Lead",
            "password": PASSWORD,
            "confirm_password": PASSWORD,
        },
    )
    assert reused.status_code == 400

    kitchen_login = client.post(
        "/api/v1/auth/login",
        json={"email": kitchen_email, "password": PASSWORD},
    )
    assert kitchen_login.status_code == 200
    assert client.get("/api/v1/staff/session").status_code == 200
    assert client.get("/api/v1/cashier/session").status_code == 403
    assert client.get("/api/v1/admin/session").status_code == 403
    assert client.get("/api/v1/admin/staff").status_code == 403

    client.cookies.clear()
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": other_email, "password": PASSWORD},
        ).status_code
        == 200
    )
    staff_id = accepted.json()["user"]["id"]
    cross = client.patch(
        f"/api/v1/admin/staff/{staff_id}/status",
        headers=_csrf(client),
        json={"status": "inactive"},
    )
    assert cross.status_code == 403

    client.cookies.clear()
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": manager_email, "password": PASSWORD},
        ).status_code
        == 200
    )
    cashier_email = f"cashier-{uuid.uuid4().hex[:8]}@staff.bowlbyte.edu"
    cashier_invite = client.post(
        "/api/v1/admin/staff/invitations",
        headers=_csrf(client),
        json={"email": cashier_email, "role": "CASHIER"},
    )
    assert cashier_invite.status_code == 201
    cashier_token = _token_from_mail(cashier_email)
    cashier = client.post(
        "/api/v1/auth/accept-invitation",
        json={
            "token": cashier_token,
            "full_name": "Cash Desk",
            "password": PASSWORD,
            "confirm_password": PASSWORD,
        },
    )
    assert cashier.status_code == 201
    client.cookies.clear()
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": cashier_email, "password": PASSWORD},
        ).status_code
        == 200
    )
    assert client.get("/api/v1/cashier/session").status_code == 200
    assert client.get("/api/v1/staff/session").status_code == 403
    forbidden = client.patch(
        f"/api/v1/admin/staff/{staff_id}/status",
        headers=_csrf(client),
        json={"status": "inactive"},
    )
    assert forbidden.status_code == 403

    client.cookies.clear()
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": kitchen_email, "password": PASSWORD},
        ).status_code
        == 200
    )
    kitchen_cookie = client.cookies.get("bowlbyte_session")
    client.cookies.clear()
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": manager_email, "password": PASSWORD},
        ).status_code
        == 200
    )
    disabled = client.patch(
        f"/api/v1/admin/staff/{staff_id}/status",
        headers=_csrf(client),
        json={"status": "inactive"},
    )
    assert disabled.status_code == 200
    client.cookies.clear()
    client.cookies.set("bowlbyte_session", kitchen_cookie)
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/staff/session").status_code == 401


def test_student_cannot_call_manager_or_staff_routes(client: TestClient) -> None:
    email = _email("student")
    assert _register(client, email, "CS108").status_code == 202
    _verify_and_login(client, email)
    assert client.get("/api/v1/student/session").status_code == 200
    assert client.get("/api/v1/admin/staff").status_code == 403
    assert client.get("/api/v1/admin/session").status_code == 403
    assert client.get("/api/v1/cashier/session").status_code == 403
    assert (
        client.post(
            "/api/v1/admin/staff/invitations",
            headers=_csrf(client),
            json={"email": "new@staff.bowlbyte.edu", "role": "CASHIER"},
        ).status_code
        == 403
    )
