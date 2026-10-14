from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_principal
from app.core.errors import ApiError
from app.db.session import get_db
from app.models.ordering import ORDER_STATUSES
from app.schemas.ordering import (
    CategoryCreateRequest,
    CategoryResponse,
    CategoryUpdateRequest,
    ImageUploadRequest,
    ManagerOrderListResponse,
    MenuItemResponse,
    MenuItemUpdateRequest,
    MenuItemWrite,
    MenuListResponse,
    StationCreateRequest,
    StationResponse,
    StationUpdateRequest,
    StockListResponse,
    StockRowResponse,
    StockUpdateRequest,
)
from app.services.identity import Principal
from app.services.ordering import (
    create_category,
    create_menu_item,
    create_station,
    get_menu_item,
    list_categories,
    list_manager_orders,
    list_menu_items,
    list_stations,
    list_stock,
    manager_canteen_id,
    service_today,
    set_available_stock,
    set_item_image,
    update_category,
    update_menu_item,
    update_station,
)

router = APIRouter(prefix="/admin", tags=["catalog"])


def _manager(principal: Principal) -> Principal:
    if principal.user.role != "CANTEEN_MANAGER":
        raise ApiError(
            code="FORBIDDEN",
            message="You cannot manage this canteen.",
            status_code=403,
        )
    return principal


def _page(limit: int, offset: int) -> tuple[int, int]:
    return min(max(limit, 1), 50), max(offset, 0)


@router.get("/categories", response_model=list[CategoryResponse])
def admin_categories(
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> list[CategoryResponse]:
    _manager(principal)
    canteen_id = manager_canteen_id(db, principal.user)
    return [
        CategoryResponse(id=row.id, name=row.name, sort_order=row.sort_order, is_demo=row.is_demo)
        for row in list_categories(db, canteen_id=canteen_id, public=False)
    ]


@router.post("/categories", response_model=CategoryResponse, status_code=201)
def add_category(
    body: CategoryCreateRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> CategoryResponse:
    _manager(principal)
    row = create_category(db, manager=principal.user, name=body.name, sort_order=body.sort_order)
    return CategoryResponse(
        id=row.id, name=row.name, sort_order=row.sort_order, is_demo=row.is_demo
    )


@router.patch("/categories/{category_id}", response_model=CategoryResponse)
def edit_category(
    category_id: UUID,
    body: CategoryUpdateRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> CategoryResponse:
    _manager(principal)
    row = update_category(
        db,
        manager=principal.user,
        category_id=category_id,
        name=body.name,
        sort_order=body.sort_order,
    )
    return CategoryResponse(
        id=row.id, name=row.name, sort_order=row.sort_order, is_demo=row.is_demo
    )


@router.get("/stations", response_model=list[StationResponse])
def admin_stations(
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> list[StationResponse]:
    _manager(principal)
    canteen_id = manager_canteen_id(db, principal.user)
    return [
        StationResponse(
            id=row.id,
            name=row.name,
            parallel_capacity=row.parallel_capacity,
            is_active=row.is_active,
            is_demo=row.is_demo,
        )
        for row in list_stations(db, canteen_id=canteen_id)
    ]


@router.post("/stations", response_model=StationResponse, status_code=201)
def add_station(
    body: StationCreateRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> StationResponse:
    _manager(principal)
    row = create_station(
        db,
        manager=principal.user,
        name=body.name,
        parallel_capacity=body.parallel_capacity,
    )
    return StationResponse(
        id=row.id,
        name=row.name,
        parallel_capacity=row.parallel_capacity,
        is_active=row.is_active,
        is_demo=row.is_demo,
    )


@router.patch("/stations/{station_id}", response_model=StationResponse)
def edit_station(
    station_id: UUID,
    body: StationUpdateRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> StationResponse:
    _manager(principal)
    row = update_station(
        db,
        manager=principal.user,
        station_id=station_id,
        name=body.name,
        parallel_capacity=body.parallel_capacity,
        is_active=body.is_active,
    )
    return StationResponse(
        id=row.id,
        name=row.name,
        parallel_capacity=row.parallel_capacity,
        is_active=row.is_active,
        is_demo=row.is_demo,
    )


@router.get("/menu", response_model=MenuListResponse)
def admin_menu(
    q: str | None = None,
    category_id: UUID | None = None,
    limit: int = Query(default=20),
    offset: int = Query(default=0),
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> MenuListResponse:
    _manager(principal)
    bounded_limit, bounded_offset = _page(limit, offset)
    items, total = list_menu_items(
        db,
        canteen_id=manager_canteen_id(db, principal.user),
        public=False,
        query=q,
        category_id=category_id,
        limit=bounded_limit,
        offset=bounded_offset,
    )
    return MenuListResponse(
        items=[MenuItemResponse.model_validate(item) for item in items],
        total=total,
        limit=bounded_limit,
        offset=bounded_offset,
    )


@router.get("/menu/{item_id}", response_model=MenuItemResponse)
def admin_menu_item(
    item_id: UUID,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> MenuItemResponse:
    _manager(principal)
    return MenuItemResponse.model_validate(
        get_menu_item(
            db,
            canteen_id=manager_canteen_id(db, principal.user),
            item_id=item_id,
            public=False,
        )
    )


@router.post("/menu", response_model=MenuItemResponse, status_code=201)
def add_menu_item(
    body: MenuItemWrite,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> MenuItemResponse:
    _manager(principal)
    item = create_menu_item(db, manager=principal.user, fields=body.model_dump())
    return MenuItemResponse.model_validate(
        get_menu_item(
            db,
            canteen_id=item.canteen_id,
            item_id=item.id,
            public=False,
        )
    )


@router.patch("/menu/{item_id}", response_model=MenuItemResponse)
def edit_menu_item(
    item_id: UUID,
    body: MenuItemUpdateRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> MenuItemResponse:
    _manager(principal)
    fields = body.model_dump(exclude_unset=True)
    item = update_menu_item(db, manager=principal.user, item_id=item_id, fields=fields)
    return MenuItemResponse.model_validate(
        get_menu_item(db, canteen_id=item.canteen_id, item_id=item.id, public=False)
    )


@router.post("/menu/{item_id}/image", response_model=MenuItemResponse)
def upload_menu_image(
    item_id: UUID,
    body: ImageUploadRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> MenuItemResponse:
    _manager(principal)
    item = set_item_image(
        db,
        manager=principal.user,
        item_id=item_id,
        content_base64=body.content_base64,
        content_type=body.content_type,
    )
    return MenuItemResponse.model_validate(
        get_menu_item(db, canteen_id=item.canteen_id, item_id=item.id, public=False)
    )


@router.get("/stock", response_model=StockListResponse)
def admin_stock(
    on: date | None = None,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> StockListResponse:
    _manager(principal)
    day = on or service_today()
    rows = list_stock(db, canteen_id=manager_canteen_id(db, principal.user), day=day)
    return StockListResponse(
        service_date=day,
        rows=[StockRowResponse.model_validate(row) for row in rows],
    )


@router.patch("/stock/{item_id}", response_model=StockRowResponse)
def edit_stock(
    item_id: UUID,
    body: StockUpdateRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> StockRowResponse:
    _manager(principal)
    set_available_stock(
        db,
        manager=principal.user,
        item_id=item_id,
        available_qty=body.available_qty,
        reason=body.reason,
    )
    rows = list_stock(
        db,
        canteen_id=manager_canteen_id(db, principal.user),
        day=service_today(),
    )
    match = next((row for row in rows if row["menu_item_id"] == item_id), None)
    if match is None:
        raise ApiError(code="NOT_FOUND", message="Menu item not found.", status_code=404)
    return StockRowResponse.model_validate(match)


@router.get("/orders", response_model=ManagerOrderListResponse)
def admin_orders(
    status: str | None = None,
    on: date | None = None,
    limit: int = Query(default=20),
    offset: int = Query(default=0),
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> ManagerOrderListResponse:
    _manager(principal)
    if status is not None and status not in ORDER_STATUSES:
        raise ApiError(code="VALIDATION_ERROR", message="Unknown order status.", status_code=422)
    bounded_limit, bounded_offset = _page(limit, offset)
    orders, total, totals = list_manager_orders(
        db,
        manager=principal.user,
        status=status,
        on=on,
        limit=bounded_limit,
        offset=bounded_offset,
    )
    return ManagerOrderListResponse.model_validate(
        {
            "orders": orders,
            "total": total,
            "limit": bounded_limit,
            "offset": bounded_offset,
            "totals": totals,
        }
    )
