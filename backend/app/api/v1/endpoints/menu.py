from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import require_principal
from app.core.errors import ApiError
from app.db.session import get_db
from app.schemas.ordering import (
    CategoryResponse,
    MenuItemResponse,
    MenuListResponse,
    PairingListResponse,
)
from app.services.identity import Principal
from app.services.ordering import (
    get_image,
    get_menu_item,
    kitchen_canteen_id,
    list_categories,
    list_menu_items,
    manager_canteen_id,
    pilot_canteen,
)
from app.services.pairings import list_pairings

router = APIRouter(prefix="/menu", tags=["menu"])


def _bounds(limit: int, offset: int) -> tuple[int, int]:
    return min(max(limit, 1), 50), max(offset, 0)


@router.get("/categories", response_model=list[CategoryResponse])
def public_categories(
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> list[CategoryResponse]:
    if principal.user.role == "CANTEEN_MANAGER":
        canteen_id = manager_canteen_id(db, principal.user)
    elif principal.user.role == "KITCHEN_STAFF":
        canteen_id = kitchen_canteen_id(db, principal.user)
    elif principal.user.role == "STUDENT":
        canteen_id = pilot_canteen(db).id
    else:
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    rows = list_categories(db, canteen_id=canteen_id, public=principal.user.role == "STUDENT")
    return [
        CategoryResponse(
            id=row.id,
            name=row.name,
            sort_order=row.sort_order,
            is_active=row.is_active,
            is_demo=row.is_demo,
        )
        for row in rows
    ]


@router.get("/items", response_model=MenuListResponse)
def public_items(
    q: str | None = None,
    category_id: UUID | None = None,
    sort: str = Query(default="recommended", pattern="^(recommended|price_asc|price_desc|name)$"),
    featured: bool = False,
    limit: int = Query(default=20),
    offset: int = Query(default=0),
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> MenuListResponse:
    if principal.user.role != "STUDENT":
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    bounded_limit, bounded_offset = _bounds(limit, offset)
    canteen = pilot_canteen(db)
    items, total = list_menu_items(
        db,
        canteen_id=canteen.id,
        public=True,
        query=q,
        category_id=category_id,
        limit=bounded_limit,
        offset=bounded_offset,
        sort=sort,
        featured=featured,
        include_inactive=False,
    )
    return MenuListResponse(
        items=[MenuItemResponse.model_validate(item) for item in items],
        total=total,
        limit=bounded_limit,
        offset=bounded_offset,
    )


@router.get("/items/{item_id}", response_model=MenuItemResponse)
def public_item(
    item_id: UUID,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> MenuItemResponse:
    if principal.user.role != "STUDENT":
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    canteen = pilot_canteen(db)
    return MenuItemResponse.model_validate(
        get_menu_item(db, canteen_id=canteen.id, item_id=item_id, public=True)
    )


@router.get("/items/{item_id}/pairings", response_model=PairingListResponse)
def public_pairings(
    item_id: UUID,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> PairingListResponse:
    if principal.user.role != "STUDENT":
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    canteen = pilot_canteen(db)
    payload = list_pairings(db, canteen_id=canteen.id, item_id=item_id, public=True)
    return PairingListResponse(
        basis=payload["basis"],
        items=[MenuItemResponse.model_validate(item) for item in payload["items"]],
    )


@router.get("/items/{item_id}/image")
def public_image(
    item_id: UUID,
    db: Session = Depends(get_db),
) -> Response:
    canteen = pilot_canteen(db)
    body, content_type = get_image(db, item_id, canteen_id=canteen.id)
    return Response(
        content=body,
        media_type=content_type,
        headers={"Cache-Control": "private, no-store"},
    )
