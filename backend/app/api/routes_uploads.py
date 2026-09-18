from __future__ import annotations

import re
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..ingest.loader import load_dataset
from ..models import Upload, User
from .deps import audit, get_current_user, timed

router = APIRouter(prefix="/uploads", tags=["uploads"])

ALLOWED_EXT = {".xlsx", ".xlsm", ".xls", ".csv"}


def _safe_name(name: str) -> str:
    return re.sub(r"[^\w.\-]+", "_", name, flags=re.UNICODE)[:120]


def _upload_payload(u: Upload) -> dict:
    return {
        "id": u.id, "filename": u.filename, "kind": u.kind, "status": u.status,
        "rows_total": u.rows_total, "records_new": u.records_new,
        "records_updated": u.records_updated, "columns": u.columns,
        "quality": u.quality, "error": u.error,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.post("")
def upload_dataset(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Формат {ext or 'без расширения'} не поддерживается. Загрузите XLSX или CSV.",
        )
    stored = settings.uploads_path / f"{int(time.time())}_{_safe_name(file.filename or 'upload')}"
    stored.write_bytes(file.file.read())

    upload = Upload(filename=file.filename or stored.name, stored_path=str(stored),
                    kind="dataset", uploaded_by=user.id)
    db.add(upload)
    db.commit()

    try:
        with timed() as t:
            result = load_dataset(db, upload, stored)
    except Exception as e:  # разбор чужой выгрузки падает чаще всего — показываем причину
        upload.status = "error"
        upload.error = f"{type(e).__name__}: {e}"
        db.commit()
        audit(db, user, "upload_failed", {"filename": upload.filename, "error": upload.error})
        raise HTTPException(status_code=422, detail=f"Не удалось разобрать файл: {e}")

    audit(db, user, "upload_dataset", {
        "filename": upload.filename, "new": result["new"], "updated": result["updated"],
    }, duration_ms=t.ms)
    return _upload_payload(upload)


@router.get("")
def list_uploads(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    uploads = db.query(Upload).order_by(Upload.created_at.desc(), Upload.id.desc()).limit(100).all()
    return [_upload_payload(u) for u in uploads]
