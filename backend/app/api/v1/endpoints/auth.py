import secrets

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.cookies import apply_auth_cookies, clear_auth_cookies
from app.api.deps import client_key, require_csrf, require_principal
from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.session import get_db
from app.schemas.auth import (
    AcceptInvitationRequest,
    CsrfResponse,
    EmailOtpRequest,
    EmailOtpVerifyRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegistrationPolicyResponse,
    ResendVerificationRequest,
    ResetPasswordRequest,
    StudentRegisterRequest,
    UserEnvelope,
    UserResponse,
    VerifyEmailCodeRequest,
    VerifyEmailRequest,
)
from app.services.identity import (
    REGISTRATION_ACCEPTED,
    Principal,
    accept_invitation,
    active_canteen_id,
    authenticate,
    login_with_email_otp,
    refresh_auth_session,
    register_student,
    registration_policy,
    request_email_otp,
    resend_verification,
    revoke_session,
    rotate_csrf,
    user_view,
    verify_email,
    verify_signup_code,
)
from app.services.password_recovery import (
    RESET_ACCEPTED,
    request_password_reset,
    reset_password,
)
from app.services.supabase_auth import SupabaseAuthClient, SupabaseAuthError, supabase_auth_enabled

router = APIRouter(prefix="/auth", tags=["auth"])


def _envelope(db: Session, principal: Principal) -> UserEnvelope:
    return UserEnvelope(
        user=UserResponse.model_validate(user_view(principal.user, principal.canteen_id))
    )


@router.get("/registration-policy", response_model=RegistrationPolicyResponse)
def get_registration_policy() -> RegistrationPolicyResponse:
    return RegistrationPolicyResponse.model_validate(registration_policy())


@router.post("/student/register", response_model=MessageResponse, status_code=202)
def student_register(
    body: StudentRegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> MessageResponse:
    register_student(
        db,
        full_name=body.full_name,
        email=str(body.email),
        roll_number=body.roll_number,
        enrollment_code=body.enrollment_code,
        password=body.password,
        client_key=client_key(request),
    )
    return MessageResponse(message=REGISTRATION_ACCEPTED)


@router.post("/verify-email-code", response_model=UserEnvelope)
def post_verify_email_code(
    body: VerifyEmailCodeRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> UserEnvelope:
    user = verify_signup_code(
        db,
        email=str(body.email),
        code=body.code,
        client_key=client_key(request),
    )
    return UserEnvelope(
        user=UserResponse.model_validate(user_view(user, active_canteen_id(db, user)))
    )


@router.post("/verify-email", response_model=UserEnvelope)
def post_verify_email(body: VerifyEmailRequest, db: Session = Depends(get_db)) -> UserEnvelope:
    user = verify_email(db, body.token)
    return UserEnvelope(
        user=UserResponse.model_validate(user_view(user, active_canteen_id(db, user)))
    )


@router.post("/resend-verification", response_model=MessageResponse, status_code=202)
def post_resend(
    body: ResendVerificationRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> MessageResponse:
    resend_verification(db, str(body.email), client_key(request))
    return MessageResponse(message="If an unverified account exists, a new message has been sent.")


@router.post("/forgot-password", response_model=MessageResponse, status_code=202)
def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> MessageResponse:
    request_password_reset(db, email=str(body.email), client_key=client_key(request))
    return MessageResponse(message=RESET_ACCEPTED)


@router.post("/reset-password", response_model=MessageResponse)
def post_reset_password(
    body: ResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> MessageResponse:
    reset_password(
        db,
        token=body.token,
        password=body.password,
        client_key=client_key(request),
    )
    return MessageResponse(message="Your password has been changed. Sign in with the new password.")


@router.post("/login", response_model=UserEnvelope)
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> UserEnvelope:
    user, raw_session, raw_csrf, refresh = authenticate(
        db,
        email=str(body.email),
        password=body.password,
        client_key=client_key(request),
    )
    apply_auth_cookies(response, raw_session, raw_csrf, refresh)
    return UserEnvelope(
        user=UserResponse.model_validate(user_view(user, active_canteen_id(db, user)))
    )


@router.post("/email-otp", response_model=MessageResponse, status_code=202)
def post_email_otp(
    body: EmailOtpRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> MessageResponse:
    request_email_otp(db, str(body.email), client_key(request))
    return MessageResponse(message="If an eligible account exists, a sign-in code has been sent.")


@router.post("/email-otp/verify", response_model=UserEnvelope)
def post_email_otp_verify(
    body: EmailOtpVerifyRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> UserEnvelope:
    user, raw_session, raw_csrf, refresh = login_with_email_otp(
        db,
        email=str(body.email),
        code=body.code,
        client_key=client_key(request),
    )
    apply_auth_cookies(response, raw_session, raw_csrf, refresh)
    return UserEnvelope(
        user=UserResponse.model_validate(user_view(user, active_canteen_id(db, user)))
    )


@router.post("/refresh", response_model=UserEnvelope)
def post_refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> UserEnvelope:
    settings = get_settings()
    header = request.headers.get("x-csrf-token")
    cookie = request.cookies.get(settings.csrf_cookie_name)
    if (
        not header
        or not cookie
        or len(header) != len(cookie)
        or not secrets.compare_digest(header, cookie)
    ):
        raise ApiError(code="CSRF_REJECTED", message="Request was rejected.", status_code=403)
    refresh = request.cookies.get(settings.refresh_cookie_name) or ""
    user, raw_session, raw_csrf, new_refresh = refresh_auth_session(db, refresh)
    apply_auth_cookies(response, raw_session, raw_csrf, new_refresh)
    return UserEnvelope(
        user=UserResponse.model_validate(user_view(user, active_canteen_id(db, user)))
    )


@router.post("/logout", response_model=MessageResponse)
def logout(
    request: Request,
    response: Response,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> MessageResponse:
    settings = get_settings()
    access = request.cookies.get(settings.session_cookie_name) or ""
    if supabase_auth_enabled(settings) and access:
        try:
            SupabaseAuthClient(settings).logout(access)
        except SupabaseAuthError:
            pass
    revoke_session(db, principal)
    clear_auth_cookies(response)
    return MessageResponse(message="Signed out.")


@router.get("/me", response_model=UserEnvelope)
def me(principal: Principal = Depends(require_principal)) -> UserEnvelope:
    return UserEnvelope(
        user=UserResponse.model_validate(user_view(principal.user, principal.canteen_id))
    )


@router.get("/csrf", response_model=CsrfResponse)
def csrf(
    request: Request,
    response: Response,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> CsrfResponse:
    settings = get_settings()
    presented = request.cookies.get(settings.csrf_cookie_name)
    token = rotate_csrf(db, principal, presented)
    raw_session = request.cookies.get(settings.session_cookie_name)
    if not raw_session:
        raise ApiError(code="AUTH_REQUIRED", message="Sign in to continue.", status_code=401)
    apply_auth_cookies(response, raw_session, token)
    return CsrfResponse(csrf_token=token)


@router.post("/accept-invitation", response_model=UserEnvelope, status_code=201)
def post_accept_invitation(
    body: AcceptInvitationRequest,
    db: Session = Depends(get_db),
) -> UserEnvelope:
    user = accept_invitation(
        db,
        token=body.token,
        full_name=body.full_name,
        password=body.password,
    )
    return UserEnvelope(
        user=UserResponse.model_validate(user_view(user, active_canteen_id(db, user)))
    )
