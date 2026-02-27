"""API-key management router."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from web.backend.db import get_api_keys, set_api_key

router = APIRouter()


class SetKeyRequest(BaseModel):
    api_key: str


@router.get("/users/{username}/api-keys")
async def list_api_keys(username: str):
    return {"keys": get_api_keys(username)}


@router.put("/users/{username}/api-keys/{service}")
async def upsert_api_key(username: str, service: str, req: SetKeyRequest):
    set_api_key(username, service, req.api_key)
    return {"updated": True}
