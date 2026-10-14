from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_principal
from app.core.errors import ApiError
from app.db.session import get_db
from app.schemas.kitchen import (
    DelayRequest,
    KitchenOverviewResponse,
    KitchenQueueResponse,
    ReadyRequest,
    RejectRequest,
    StationWorkloadResponse,
    TaskResponse,
    TrackedOrderResponse,
)
from app.services.identity import Principal
from app.services.kitchen import (
    accept_order,
    complete_task,
    delay_task,
    kitchen_queue,
    manager_overview,
    mark_ready,
    preparation_tasks,
    refresh_after_station_change,
    reject_order,
    start_task,
    station_board,
    student_tracking,
)

router = APIRouter(tags=["kitchen"])


def _kitchen(principal: Principal) -> Principal:
    if principal.user.role != "KITCHEN_STAFF":
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    return principal


def _student(principal: Principal) -> Principal:
    if principal.user.role != "STUDENT":
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    return principal


def _manager(principal: Principal) -> Principal:
    if principal.user.role != "CANTEEN_MANAGER":
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    return principal


@router.get("/staff/queue", response_model=KitchenQueueResponse)
def staff_queue(
    limit: int = Query(default=50, ge=1, le=100),
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> KitchenQueueResponse:
    _kitchen(principal)
    return KitchenQueueResponse.model_validate(kitchen_queue(db, staff=principal.user, limit=limit))


@router.get("/staff/stations", response_model=list[StationWorkloadResponse])
def staff_stations(
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> list[StationWorkloadResponse]:
    _kitchen(principal)
    return [
        StationWorkloadResponse.model_validate(row)
        for row in station_board(db, staff=principal.user)
    ]


@router.post("/staff/orders/{order_id}/accept", response_model=TrackedOrderResponse)
def accept(
    order_id: UUID,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TrackedOrderResponse:
    _kitchen(principal)
    return TrackedOrderResponse.model_validate(
        accept_order(db, staff=principal.user, order_id=order_id)
    )


@router.post("/staff/orders/{order_id}/reject", response_model=TrackedOrderResponse)
def reject(
    order_id: UUID,
    body: RejectRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TrackedOrderResponse:
    _kitchen(principal)
    return TrackedOrderResponse.model_validate(
        reject_order(db, staff=principal.user, order_id=order_id, reason=body.reason)
    )


@router.get("/staff/preparation-tasks", response_model=list[TaskResponse])
def tasks(
    limit: int = Query(default=100, ge=1, le=200),
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> list[TaskResponse]:
    _kitchen(principal)
    return [
        TaskResponse.model_validate(row)
        for row in preparation_tasks(db, staff=principal.user, limit=limit)
    ]


@router.post("/staff/preparation-tasks/{task_id}/start", response_model=TrackedOrderResponse)
def start(
    task_id: UUID,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TrackedOrderResponse:
    _kitchen(principal)
    return TrackedOrderResponse.model_validate(
        start_task(db, staff=principal.user, task_id=task_id)
    )


@router.post("/staff/preparation-tasks/{task_id}/complete", response_model=TrackedOrderResponse)
def complete(
    task_id: UUID,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TrackedOrderResponse:
    _kitchen(principal)
    return TrackedOrderResponse.model_validate(
        complete_task(db, staff=principal.user, task_id=task_id)
    )


@router.post("/staff/preparation-tasks/{task_id}/delay", response_model=TrackedOrderResponse)
def delay(
    task_id: UUID,
    body: DelayRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TrackedOrderResponse:
    _kitchen(principal)
    return TrackedOrderResponse.model_validate(
        delay_task(
            db,
            staff=principal.user,
            task_id=task_id,
            extra_seconds=body.extra_seconds,
            reason=body.reason,
        )
    )


@router.post("/staff/orders/{order_id}/ready", response_model=TrackedOrderResponse)
def ready(
    order_id: UUID,
    body: ReadyRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TrackedOrderResponse:
    _kitchen(principal)
    if not body.packed:
        raise ApiError(
            code="VALIDATION_ERROR", message="Confirm that the order is packed.", status_code=422
        )
    return TrackedOrderResponse.model_validate(
        mark_ready(db, staff=principal.user, order_id=order_id)
    )


@router.get("/orders/{order_id}/tracking", response_model=TrackedOrderResponse)
def tracking(
    order_id: UUID,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> TrackedOrderResponse:
    _student(principal)
    return TrackedOrderResponse.model_validate(
        student_tracking(db, student=principal.user, order_id=order_id)
    )


@router.get("/admin/kitchen/overview", response_model=KitchenOverviewResponse)
def overview(
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> KitchenOverviewResponse:
    _manager(principal)
    return KitchenOverviewResponse.model_validate(manager_overview(db, manager=principal.user))


def refresh_station_estimates(db: Session, canteen_id: UUID) -> None:
    refresh_after_station_change(db, canteen_id=canteen_id)
