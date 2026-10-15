from fastapi import APIRouter

from app.api.v1.endpoints import (
    areas,
    auth,
    catalog,
    fulfillment,
    health,
    intelligence,
    kitchen,
    live,
    menu,
    orders,
    staff,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(staff.router)
api_router.include_router(menu.router)
api_router.include_router(orders.router)
api_router.include_router(kitchen.router)
api_router.include_router(fulfillment.router)
api_router.include_router(intelligence.router)
api_router.include_router(live.router)
api_router.include_router(catalog.router)
api_router.include_router(areas.router)
