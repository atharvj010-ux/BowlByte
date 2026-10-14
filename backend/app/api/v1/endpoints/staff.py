from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_manager, require_manager_session
from app.db.session import get_db
from app.schemas.auth import (
    InvitationCreateRequest,
    InvitationResponse,
    StaffListResponse,
    StaffMemberResponse,
    StaffStatusRequest,
    UserEnvelope,
    UserResponse,
)
from app.services.identity import (
    Principal,
    active_canteen_id,
    invite_staff,
    list_staff,
    set_staff_status,
    user_view,
)

router = APIRouter(prefix="/admin/staff", tags=["staff"])


@router.post("/invitations", response_model=InvitationResponse, status_code=201)
def create_invitation(
    body: InvitationCreateRequest,
    principal: Principal = Depends(require_manager),
    db: Session = Depends(get_db),
) -> InvitationResponse:
    invitation = invite_staff(
        db,
        manager=principal.user,
        email=str(body.email),
        role=body.role,
    )
    return InvitationResponse(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        expires_at=invitation.expires_at,
    )


@router.get("", response_model=StaffListResponse)
def get_staff(
    principal: Principal = Depends(require_manager_session),
    db: Session = Depends(get_db),
) -> StaffListResponse:
    rows = list_staff(db, principal.user)
    return StaffListResponse(staff=[StaffMemberResponse.model_validate(row) for row in rows])


@router.patch("/{user_id}/status", response_model=UserEnvelope)
def patch_staff_status(
    user_id: UUID,
    body: StaffStatusRequest,
    principal: Principal = Depends(require_manager),
    db: Session = Depends(get_db),
) -> UserEnvelope:
    user = set_staff_status(
        db,
        manager=principal.user,
        user_id=user_id,
        active=body.status == "active",
    )
    return UserEnvelope(
        user=UserResponse.model_validate(user_view(user, active_canteen_id(db, user)))
    )
