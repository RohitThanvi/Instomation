from fastapi import APIRouter

from app.api.v1 import auth, conversations, instagram, knowledge, organizations, webhooks

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(organizations.router)
api_router.include_router(instagram.router)
api_router.include_router(webhooks.router)
api_router.include_router(conversations.router)
api_router.include_router(knowledge.router)
