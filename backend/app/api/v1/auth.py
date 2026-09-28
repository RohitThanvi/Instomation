from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import CurrentIdentity

router = APIRouter(prefix="/auth", tags=["auth"])


class IdentityResponse(BaseModel):
    clerk_user_id: str


@router.get("/me", response_model=IdentityResponse)
async def me(identity: CurrentIdentity) -> IdentityResponse:
    return IdentityResponse(clerk_user_id=identity.clerk_user_id)
