import csv
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import (
    dummy_password_hash,
    hash_password,
    hash_secret,
    new_secret,
    password_needs_rehash,
    secrets_match,
    verify_password,
)
from app.models.identity import (
    ACTIVE,
    CANTEEN_MANAGER,
    DISABLED,
    INVITE_ROLES,
    MEMBERSHIP_ACTIVE,
    MEMBERSHIP_INACTIVE,
    PENDING_VERIFICATION,
    STUDENT,
    AuditLog,
    Canteen,
    College,
    EmailVerificationToken,
    StaffInvitation,
    StaffMembership,
    StudentProfile,
    StudentRosterEntry,
    User,
)
from app.models.identity import (
    Session as SessionRow,
)
from app.services.email_templates import branded_message
from app.services.mailer import EmailDeliveryError, send_email
from app.services.rate_limit import assert_allowance, record_attempt

INVALID_CREDENTIALS = "Email or password is incorrect."
ELIGIBILITY_MESSAGE = "College eligibility could not be confirmed."
VERIFICATION_MESSAGE = "This verification link is invalid or has expired."
INVITATION_MESSAGE = "This invitation is invalid or has expired."
REGISTRATION_ACCEPTED = (
    "If those details meet the college rules, a verification message has been sent."
)


class BootstrapError(Exception):
    """The first-manager command cannot continue."""


@dataclass
class Principal:
    user: User
    session: SessionRow
    canteen_id: UUID | None


def utcnow() -> datetime:
    return datetime.now(UTC)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_roll(roll_number: str) -> str:
    return "".join(roll_number.strip().upper().split())


def user_view(user: User, canteen_id: UUID | None) -> dict[str, object]:
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "canteen_id": canteen_id,
    }


def ensure_college(db: Session) -> College:
    settings = get_settings()
    college = db.scalar(select(College).where(College.slug == settings.college_slug))
    if college is None:
        college = College(name=settings.college_name, slug=settings.college_slug)
        db.add(college)
        db.flush()
    return college


def ensure_canteen(db: Session, college: College, *, name: str, slug: str) -> Canteen:
    canteen = db.scalar(select(Canteen).where(Canteen.slug == slug))
    if canteen is None:
        canteen = Canteen(college_id=college.id, name=name, slug=slug)
        db.add(canteen)
        db.flush()
    return canteen


def _audit(
    db: Session,
    *,
    action: str,
    actor_user_id: UUID | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    canteen_id: UUID | None = None,
    metadata: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            canteen_id=canteen_id,
            metadata_json=metadata or {},
        )
    )


def _public_url(path: str) -> str:
    return f"{get_settings().public_app_url.rstrip('/')}{path}"


def _verification_minutes() -> int:
    return max(1, get_settings().verification_ttl_seconds // 60)


def _send_verification(user: User, raw_token: str) -> None:
    link = _public_url(f"/student/verify-email#token={raw_token}")
    text, html = branded_message(
        heading="Confirm your email",
        intro=f"Hello {user.full_name}. Confirm your BowlByte student account.",
        action_label="Confirm email",
        action_url=link,
        note=(
            f"The link expires in {_verification_minutes()} minutes and works once. "
            "If you did not register, you can ignore this message."
        ),
    )
    send_email(
        recipient=user.email,
        subject="Confirm your BowlByte account",
        body=text,
        html=html,
    )


def _send_existing_account_notice(user: User) -> None:
    if user.status == PENDING_VERIFICATION:
        return
    send_email(
        recipient=user.email,
        subject="BowlByte sign-in",
        body=(
            "A registration was requested for this email address.\n\n"
            "If you already have a BowlByte account, sign in. "
            "If you did not request this, you can ignore this message.\n"
        ),
    )


def _issue_verification(db: Session, user: User) -> str:
    now = utcnow()
    db.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    raw = new_secret()
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=hash_secret(raw),
            expires_at=now + timedelta(seconds=get_settings().verification_ttl_seconds),
        )
    )
    return raw


def _email_domain(email: str) -> str:
    return email.rsplit("@", 1)[1]


def _eligibility_error() -> ApiError:
    return ApiError(
        code="ELIGIBILITY_REJECTED",
        message=ELIGIBILITY_MESSAGE,
        status_code=403,
    )


def _assert_eligible(
    db: Session,
    college: College,
    *,
    email: str,
    roll_number: str,
    enrollment_code: str | None,
) -> StudentRosterEntry | None:
    settings = get_settings()
    mode = settings.college_eligibility_mode
    if mode == "disabled":
        raise ApiError(
            code="REGISTRATION_CLOSED",
            message=(
                "Student registration is not open. The college has not finished eligibility setup."
            ),
            status_code=403,
        )
    if mode == "institutional_domain":
        expected = settings.college_email_domain.strip().lower()
        if not expected or _email_domain(email) != expected:
            raise _eligibility_error()
        return None
    code = (enrollment_code or "").strip()
    if len(code) < settings.enrollment_code_min_length:
        verify_password(code or "missing", dummy_password_hash())
        raise _eligibility_error()
    entry = db.scalar(
        select(StudentRosterEntry)
        .where(
            StudentRosterEntry.college_id == college.id,
            StudentRosterEntry.roll_number == roll_number,
        )
        .with_for_update()
    )
    if entry is None or entry.claimed_user_id is not None:
        verify_password(code, dummy_password_hash())
        raise _eligibility_error()
    if not verify_password(code, entry.enrollment_code_hash):
        raise _eligibility_error()
    return entry


def _deliver_or_503(callback) -> None:
    try:
        callback()
    except EmailDeliveryError as exc:
        raise ApiError(
            code="EMAIL_DELIVERY_FAILED",
            message="The message could not be sent. Try again shortly.",
            status_code=503,
        ) from exc


def register_student(
    db: Session,
    *,
    full_name: str,
    email: str,
    roll_number: str,
    enrollment_code: str | None,
    password: str,
    client_key: str,
) -> None:
    settings = get_settings()
    assert_allowance(bucket="register-ip", value=client_key, limit=30)
    record_attempt(
        bucket="register-ip",
        value=client_key,
        window_seconds=60 * 60,
    )
    normalized_email = normalize_email(email)
    normalized_roll = normalize_roll(roll_number)
    college = ensure_college(db)
    roster_entry = _assert_eligible(
        db,
        college,
        email=normalized_email,
        roll_number=normalized_roll,
        enrollment_code=enrollment_code,
    )
    existing = db.scalar(select(User).where(User.email == normalized_email))
    if existing is not None:
        _respond_to_existing_registration(db, existing)
        return
    taken = db.scalar(
        select(StudentProfile).where(
            StudentProfile.college_id == college.id,
            StudentProfile.roll_number == normalized_roll,
        )
    )
    if taken is not None:
        raise _eligibility_error()
    user = User(
        college_id=college.id,
        full_name=full_name.strip(),
        email=normalized_email,
        password_hash=hash_password(password),
        role=STUDENT,
        status=PENDING_VERIFICATION,
    )
    db.add(user)
    db.flush()
    db.add(
        StudentProfile(
            user_id=user.id,
            college_id=college.id,
            roll_number=normalized_roll,
        )
    )
    if settings.college_eligibility_mode == "roster":
        if roster_entry is None or roster_entry.claimed_user_id is not None:
            raise _eligibility_error()
        roster_entry.claimed_user_id = user.id
        roster_entry.claimed_at = utcnow()
    raw_token = _issue_verification(db, user)
    _audit(
        db,
        action="student.registered",
        actor_user_id=user.id,
        target_type="user",
        target_id=str(user.id),
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raced = db.scalar(select(User).where(User.email == normalized_email))
        if raced is None:
            raise _eligibility_error() from None
        _respond_to_existing_registration(db, raced)
        return
    db.refresh(user)
    _deliver_or_503(lambda: _send_verification(user, raw_token))


def _respond_to_existing_registration(db: Session, user: User) -> None:
    if user.status == PENDING_VERIFICATION and user.role == STUDENT:
        raw_token = _issue_verification(db, user)
        db.commit()
        db.refresh(user)
        _deliver_or_503(lambda: _send_verification(user, raw_token))
        return
    db.commit()
    _deliver_or_503(lambda: _send_existing_account_notice(user))


def verify_email(db: Session, raw_token: str) -> User:
    now = utcnow()
    row = db.scalar(
        select(EmailVerificationToken)
        .where(EmailVerificationToken.token_hash == hash_secret(raw_token))
        .with_for_update()
    )
    if row is None or row.consumed_at is not None or row.expires_at <= now:
        raise ApiError(
            code="VERIFICATION_REJECTED",
            message=VERIFICATION_MESSAGE,
            status_code=400,
        )
    user = db.get(User, row.user_id)
    if user is None or user.status == DISABLED:
        raise ApiError(
            code="VERIFICATION_REJECTED",
            message=VERIFICATION_MESSAGE,
            status_code=400,
        )
    row.consumed_at = now
    db.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    if user.status == PENDING_VERIFICATION:
        user.status = ACTIVE
    user.email_verified_at = user.email_verified_at or now
    _audit(
        db,
        action="email.verified",
        actor_user_id=user.id,
        target_type="user",
        target_id=str(user.id),
    )
    db.commit()
    db.refresh(user)
    return user


def resend_verification(db: Session, email: str, client_key: str) -> None:
    settings = get_settings()
    normalized = normalize_email(email)
    for bucket, limit, window in (
        ("resend-ip", settings.resend_rate_limit, settings.resend_rate_window_seconds),
        ("resend-email", settings.resend_rate_limit, settings.resend_rate_window_seconds),
    ):
        value = client_key if bucket.endswith("ip") else normalized
        assert_allowance(bucket=bucket, value=value, limit=limit)
        record_attempt(bucket=bucket, value=value, window_seconds=window)
    user = db.scalar(select(User).where(User.email == normalized))
    if user is None or user.role != STUDENT:
        _deliver_or_503(
            lambda: send_email(
                recipient=normalized,
                subject="BowlByte verification",
                body=(
                    "If an unverified BowlByte student account exists for this address, "
                    "a new confirmation link has been sent.\n"
                ),
            )
        )
        return
    if user.status != PENDING_VERIFICATION:
        _deliver_or_503(lambda: _send_existing_account_notice(user))
        return
    raw_token = _issue_verification(db, user)
    db.commit()
    db.refresh(user)
    _deliver_or_503(lambda: _send_verification(user, raw_token))


def _record_login_failure(db: Session, email: str, client_key: str) -> None:
    settings = get_settings()
    record_attempt(
        bucket="login-ip",
        value=client_key,
        window_seconds=settings.login_rate_window_seconds,
    )
    record_attempt(
        bucket="login-email",
        value=email,
        window_seconds=settings.login_rate_window_seconds,
    )
    _audit(
        db,
        action="auth.login_failed",
        metadata={"email_hash": hash_secret(email)},
    )
    db.commit()


def authenticate(
    db: Session, *, email: str, password: str, client_key: str
) -> tuple[User, str, str]:
    settings = get_settings()
    normalized = normalize_email(email)
    assert_allowance(bucket="login-ip", value=client_key, limit=settings.login_ip_rate_limit)
    assert_allowance(bucket="login-email", value=normalized, limit=settings.login_email_rate_limit)
    user = db.scalar(select(User).where(User.email == normalized))
    if user is None:
        verify_password(password, dummy_password_hash())
        password_ok = False
    else:
        password_ok = verify_password(password, user.password_hash)
        if password_ok and password_needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
    if user is None or not password_ok or user.status != ACTIVE:
        _record_login_failure(db, normalized, client_key)
        raise ApiError(
            code="INVALID_CREDENTIALS",
            message=INVALID_CREDENTIALS,
            status_code=401,
        )
    now = utcnow()
    db.execute(delete(SessionRow).where(SessionRow.user_id == user.id))
    raw_session = new_secret()
    raw_csrf = new_secret()
    db.add(
        SessionRow(
            user_id=user.id,
            token_hash=hash_secret(raw_session),
            csrf_token_hash=hash_secret(raw_csrf),
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(seconds=settings.session_absolute_seconds),
        )
    )
    _audit(
        db, action="auth.login", actor_user_id=user.id, target_type="user", target_id=str(user.id)
    )
    db.commit()
    db.refresh(user)
    return user, raw_session, raw_csrf


def load_principal(db: Session, raw_session: str | None) -> Principal | None:
    if not raw_session:
        return None
    row = db.scalar(select(SessionRow).where(SessionRow.token_hash == hash_secret(raw_session)))
    if row is None:
        return None
    now = utcnow()
    settings = get_settings()
    idle_deadline = row.last_seen_at + timedelta(seconds=settings.session_idle_seconds)
    if row.expires_at <= now or idle_deadline <= now:
        db.delete(row)
        db.commit()
        return None
    user = db.get(User, row.user_id)
    if user is None or user.status != ACTIVE:
        db.execute(delete(SessionRow).where(SessionRow.user_id == row.user_id))
        db.commit()
        return None
    row.last_seen_at = now
    db.commit()
    db.refresh(user)
    db.refresh(row)
    return Principal(user=user, session=row, canteen_id=active_canteen_id(db, user))


def active_canteen_id(db: Session, user: User) -> UUID | None:
    if user.role == STUDENT:
        return None
    membership = db.scalar(
        select(StaffMembership).where(
            StaffMembership.user_id == user.id,
            StaffMembership.status == MEMBERSHIP_ACTIVE,
        )
    )
    if membership is None:
        return None
    return membership.canteen_id


def revoke_session(db: Session, principal: Principal) -> None:
    db.execute(delete(SessionRow).where(SessionRow.id == principal.session.id))
    _audit(
        db,
        action="auth.logout",
        actor_user_id=principal.user.id,
        target_type="session",
        target_id=str(principal.session.id),
    )
    db.commit()


def rotate_csrf(db: Session, principal: Principal, presented: str | None) -> str:
    if presented and secrets_match(presented, principal.session.csrf_token_hash):
        return presented
    raw = new_secret()
    principal.session.csrf_token_hash = hash_secret(raw)
    db.commit()
    return raw


def csrf_matches(principal: Principal, header_token: str | None, cookie_token: str | None) -> bool:
    if not header_token or not cookie_token or len(header_token) != len(cookie_token):
        return False
    if not secrets.compare_digest(header_token, cookie_token):
        return False
    return secrets_match(header_token, principal.session.csrf_token_hash)


def registration_policy() -> dict[str, object]:
    settings = get_settings()
    mode = settings.college_eligibility_mode
    return {
        "mode": mode,
        "open": mode != "disabled",
        "college_name": settings.college_name,
        "email_domain": settings.college_email_domain or None,
        "enrollment_code_required": mode == "roster",
    }


def _manager_canteen(db: Session, user: User) -> StaffMembership:
    if user.role != CANTEEN_MANAGER or user.status != ACTIVE:
        raise ApiError(code="FORBIDDEN", message="You cannot manage staff.", status_code=403)
    membership = db.scalar(
        select(StaffMembership).where(
            StaffMembership.user_id == user.id,
            StaffMembership.role == CANTEEN_MANAGER,
            StaffMembership.status == MEMBERSHIP_ACTIVE,
        )
    )
    if membership is None:
        raise ApiError(code="FORBIDDEN", message="You cannot manage staff.", status_code=403)
    return membership


def invite_staff(
    db: Session,
    *,
    manager: User,
    email: str,
    role: str,
) -> StaffInvitation:
    if role not in INVITE_ROLES:
        raise ApiError(
            code="FORBIDDEN",
            message="That role cannot be invited.",
            status_code=403,
        )
    membership = _manager_canteen(db, manager)
    normalized = normalize_email(email)
    existing = db.scalar(select(User).where(User.email == normalized))
    if existing is not None:
        raise ApiError(
            code="ACCOUNT_EXISTS",
            message="That email already has an account.",
            status_code=409,
        )
    now = utcnow()
    db.execute(
        update(StaffInvitation)
        .where(
            StaffInvitation.canteen_id == membership.canteen_id,
            StaffInvitation.email == normalized,
            StaffInvitation.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    raw = new_secret()
    invitation = StaffInvitation(
        canteen_id=membership.canteen_id,
        email=normalized,
        role=role,
        token_hash=hash_secret(raw),
        expires_at=now + timedelta(seconds=get_settings().invitation_ttl_seconds),
        invited_by=manager.id,
    )
    db.add(invitation)
    db.flush()
    _audit(
        db,
        action="staff.invited",
        actor_user_id=manager.id,
        target_type="staff_invitation",
        target_id=str(invitation.id),
        canteen_id=membership.canteen_id,
        metadata={"role": role},
    )
    link = _public_url(f"/invite/accept#token={raw}")
    hours = max(1, get_settings().invitation_ttl_seconds // 3600)
    try:
        send_email(
            recipient=normalized,
            subject="BowlByte staff invitation",
            body=(
                "You have been invited to BowlByte.\n\n"
                f"Open this link to choose a password:\n{link}\n\n"
                f"The link expires in {hours} hours and works once.\n"
            ),
        )
    except EmailDeliveryError as exc:
        db.rollback()
        raise ApiError(
            code="EMAIL_DELIVERY_FAILED",
            message="The invitation could not be sent.",
            status_code=503,
        ) from exc
    db.commit()
    db.refresh(invitation)
    return invitation


def accept_invitation(
    db: Session,
    *,
    token: str,
    full_name: str,
    password: str,
) -> User:
    now = utcnow()
    invitation = db.scalar(
        select(StaffInvitation)
        .where(StaffInvitation.token_hash == hash_secret(token))
        .with_for_update()
    )
    if (
        invitation is None
        or invitation.consumed_at is not None
        or invitation.expires_at <= now
        or invitation.role not in INVITE_ROLES
    ):
        raise ApiError(code="INVITATION_REJECTED", message=INVITATION_MESSAGE, status_code=400)
    if db.scalar(select(User).where(User.email == invitation.email)) is not None:
        raise ApiError(code="INVITATION_REJECTED", message=INVITATION_MESSAGE, status_code=400)
    canteen = db.get(Canteen, invitation.canteen_id)
    if canteen is None:
        raise ApiError(code="INVITATION_REJECTED", message=INVITATION_MESSAGE, status_code=400)
    user = User(
        college_id=canteen.college_id,
        full_name=full_name.strip(),
        email=invitation.email,
        password_hash=hash_password(password),
        role=invitation.role,
        status=ACTIVE,
        email_verified_at=now,
    )
    db.add(user)
    db.flush()
    db.add(
        StaffMembership(
            user_id=user.id,
            canteen_id=canteen.id,
            role=invitation.role,
            status=MEMBERSHIP_ACTIVE,
        )
    )
    invitation.consumed_at = now
    _audit(
        db,
        action="staff.invitation_accepted",
        actor_user_id=user.id,
        target_type="user",
        target_id=str(user.id),
        canteen_id=canteen.id,
        metadata={"role": invitation.role},
    )
    db.commit()
    db.refresh(user)
    return user


def list_staff(db: Session, manager: User) -> list[dict[str, object]]:
    membership = _manager_canteen(db, manager)
    rows = db.execute(
        select(User, StaffMembership)
        .join(StaffMembership, StaffMembership.user_id == User.id)
        .where(
            StaffMembership.canteen_id == membership.canteen_id,
            StaffMembership.role.in_(INVITE_ROLES),
        )
        .order_by(User.full_name)
    ).all()
    return [
        {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": membership_row.role,
            "status": user.status,
            "canteen_id": membership_row.canteen_id,
        }
        for user, membership_row in rows
    ]


def set_staff_status(db: Session, *, manager: User, user_id: UUID, active: bool) -> User:
    membership = _manager_canteen(db, manager)
    target = db.get(User, user_id)
    target_membership = None
    if target is not None:
        target_membership = db.scalar(
            select(StaffMembership).where(
                StaffMembership.user_id == target.id,
                StaffMembership.canteen_id == membership.canteen_id,
            )
        )
    if (
        target is None
        or target_membership is None
        or target.role == CANTEEN_MANAGER
        or target_membership.role not in INVITE_ROLES
    ):
        raise ApiError(code="FORBIDDEN", message="You cannot change that account.", status_code=403)
    if active:
        target.status = ACTIVE
        target_membership.status = MEMBERSHIP_ACTIVE
        action = "staff.reactivated"
    else:
        target.status = DISABLED
        target_membership.status = MEMBERSHIP_INACTIVE
        db.execute(delete(SessionRow).where(SessionRow.user_id == target.id))
        action = "staff.deactivated"
    _audit(
        db,
        action=action,
        actor_user_id=manager.id,
        target_type="user",
        target_id=str(target.id),
        canteen_id=membership.canteen_id,
        metadata={"role": target_membership.role},
    )
    db.commit()
    db.refresh(target)
    return target


def create_manager(
    db: Session,
    *,
    email: str,
    full_name: str,
    password: str,
    canteen_name: str | None = None,
    canteen_slug: str | None = None,
) -> User:
    settings = get_settings()
    college = ensure_college(db)
    canteen = ensure_canteen(
        db,
        college,
        name=canteen_name or settings.canteen_name,
        slug=canteen_slug or settings.canteen_slug,
    )
    now = utcnow()
    user = User(
        college_id=college.id,
        full_name=full_name.strip(),
        email=normalize_email(email),
        password_hash=hash_password(password),
        role=CANTEEN_MANAGER,
        status=ACTIVE,
        email_verified_at=now,
    )
    db.add(user)
    db.flush()
    db.add(
        StaffMembership(
            user_id=user.id,
            canteen_id=canteen.id,
            role=CANTEEN_MANAGER,
            status=MEMBERSHIP_ACTIVE,
        )
    )
    _audit(
        db,
        action="manager.bootstrapped",
        actor_user_id=user.id,
        target_type="user",
        target_id=str(user.id),
        canteen_id=canteen.id,
    )
    db.commit()
    db.refresh(user)
    return user


def bootstrap_first_manager(db: Session, *, email: str, full_name: str, password: str) -> User:
    existing = db.scalar(select(User.id).where(User.role == CANTEEN_MANAGER).limit(1))
    if existing is not None:
        raise BootstrapError("A canteen manager already exists. Refusing to create another.")
    if len(password) < 12 or len(password) > 128:
        raise BootstrapError("Password must be between 12 and 128 characters.")
    return create_manager(db, email=email, full_name=full_name, password=password)


def import_roster(db: Session, path: str) -> dict[str, int]:
    settings = get_settings()
    college = ensure_college(db)
    imported = 0
    updated = 0
    skipped = 0
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or not {"roll_number", "enrollment_code"} <= set(
            reader.fieldnames
        ):
            raise BootstrapError("CSV must include roll_number and enrollment_code columns.")
        for row in reader:
            roll = normalize_roll(row.get("roll_number") or "")
            code = (row.get("enrollment_code") or "").strip()
            if not roll or len(code) < settings.enrollment_code_min_length:
                raise BootstrapError(
                    "Each roster row needs a roll number and a long enrollment code."
                )
            entry = db.scalar(
                select(StudentRosterEntry).where(
                    StudentRosterEntry.college_id == college.id,
                    StudentRosterEntry.roll_number == roll,
                )
            )
            digest = hash_password(code)
            if entry is None:
                db.add(
                    StudentRosterEntry(
                        college_id=college.id,
                        roll_number=roll,
                        enrollment_code_hash=digest,
                    )
                )
                imported += 1
            elif entry.claimed_user_id is not None:
                skipped += 1
            else:
                entry.enrollment_code_hash = digest
                updated += 1
    _audit(
        db,
        action="roster.imported",
        metadata={"imported": imported, "updated": updated, "skipped_claimed": skipped},
    )
    db.commit()
    return {"imported": imported, "updated": updated, "skipped_claimed": skipped}
