from fastapi import APIRouter

from app.api.v1 import auth, instagram, organizations

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(organizations.router)
api_router.include_router(instagram.router)
