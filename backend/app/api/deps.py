from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import ClerkTokenVerifier, Identity, unauthenticated

_bearer = HTTPBearer(auto_error=False)


def get_verifier(request: Request) -> ClerkTokenVerifier:
    verifier: ClerkTokenVerifier = request.app.state.token_verifier
    return verifier


async def get_identity(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    verifier: Annotated[ClerkTokenVerifier, Depends(get_verifier)],
) -> Identity:
    if credentials is None:
        raise unauthenticated()
    return await verifier.verify(credentials.credentials)


CurrentIdentity = Annotated[Identity, Depends(get_identity)]
