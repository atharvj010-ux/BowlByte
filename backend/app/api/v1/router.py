from fastapi import APIRouter

from app.api.v1.endpoints import areas, auth, health, staff

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(staff.router)
api_router.include_router(areas.router)
