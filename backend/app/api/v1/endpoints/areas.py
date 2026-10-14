from fastapi import APIRouter, Depends

from app.api.deps import require_roles
from app.models.identity import CANTEEN_MANAGER, CASHIER, KITCHEN_STAFF, STUDENT
from app.schemas.auth import UserEnvelope, UserResponse
from app.services.identity import Principal, user_view

router = APIRouter(tags=["areas"])


def _envelope(principal: Principal) -> UserEnvelope:
    return UserEnvelope(
        user=UserResponse.model_validate(user_view(principal.user, principal.canteen_id))
    )


@router.get("/student/session", response_model=UserEnvelope)
def student_session(principal: Principal = Depends(require_roles(STUDENT))) -> UserEnvelope:
    return _envelope(principal)


@router.get("/staff/session", response_model=UserEnvelope)
def staff_session(principal: Principal = Depends(require_roles(KITCHEN_STAFF))) -> UserEnvelope:
    return _envelope(principal)


@router.get("/cashier/session", response_model=UserEnvelope)
def cashier_session(principal: Principal = Depends(require_roles(CASHIER))) -> UserEnvelope:
    return _envelope(principal)


@router.get("/admin/session", response_model=UserEnvelope)
def admin_session(principal: Principal = Depends(require_roles(CANTEEN_MANAGER))) -> UserEnvelope:
    return _envelope(principal)
