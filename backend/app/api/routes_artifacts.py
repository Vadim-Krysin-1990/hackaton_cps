from __future__ import annotations

import re
import urllib.parse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..llm.artifacts import generate, to_docx
from ..models import User
from .deps import audit, get_current_user

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class ArtifactRequest(BaseModel):
    kind: str
    record_id: int | None = None
    instructions: str = ""


@router.post("")
def make_artifact(body: ArtifactRequest, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    try:
        result = generate(db, user, body.kind, body.record_id, body.instructions)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    audit(db, user, "artifact", {"kind": body.kind, "record_id": body.record_id,
                                 "llm_used": result["llm_used"]})
    return result


class DocxRequest(BaseModel):
    title: str
    text: str


@router.post("/docx")
def download_docx(body: DocxRequest, user: User = Depends(get_current_user)):
    buf = to_docx(body.title, body.text)
    slug = re.sub(r"[^\wа-яА-ЯёЁ-]+", "_", body.title)[:60] or "artifact"
    quoted = urllib.parse.quote(f"{slug}.docx")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
    )
