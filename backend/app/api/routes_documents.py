from __future__ import annotations

import re
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Document, User
from ..rag import store
from ..rag.indexer import index_document
from .deps import audit, get_current_user

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_EXT = {".pdf", ".docx", ".docm", ".xlsx", ".xlsm", ".txt", ".md", ".html", ".htm"}


def _doc_payload(d: Document) -> dict:
    return {
        "id": d.id, "filename": d.filename, "title": d.title, "pages": d.pages,
        "chunks": d.chunks, "status": d.status, "error": d.error,
        "source_url": d.source_url, "category": d.category, "doc_type": d.doc_type,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


@router.post("")
def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400,
                            detail=f"Формат {ext or 'без расширения'} не поддерживается "
                                   f"(pdf, docx, xlsx, txt, md, html).")
    safe = re.sub(r"[^\w.\-]+", "_", file.filename or "document", flags=re.UNICODE)[:120]
    stored = settings.docs_path / f"{int(time.time())}_{safe}"
    stored.write_bytes(file.file.read())

    doc = Document(filename=file.filename or stored.name, stored_path=str(stored),
                   category="Загружено вручную", doc_type="file", uploaded_by=user.id)
    db.add(doc)
    db.commit()
    index_document(db, doc)
    audit(db, user, "upload_document", {"filename": doc.filename, "status": doc.status,
                                        "chunks": doc.chunks})
    if doc.status == "error":
        raise HTTPException(status_code=422, detail=f"Документ сохранён, но не проиндексирован: {doc.error}")
    return _doc_payload(doc)


@router.get("")
def list_documents(
    category: str = "",
    q: str = "",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Document)
    if category:
        query = query.filter(Document.category == category)
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(Document.title.ilike(like) | Document.filename.ilike(like))
    docs = query.order_by(Document.category, Document.id.desc()).limit(1000).all()
    return [_doc_payload(d) for d in docs]


@router.get("/stats")
def library_stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(Document.category, func.count(Document.id), func.coalesce(func.sum(Document.chunks), 0))
        .group_by(Document.category).all()
    )
    categories = [{"name": c or "Прочее", "documents": n, "chunks": int(ch)} for c, n, ch in rows]
    categories.sort(key=lambda x: -x["documents"])
    return {
        "categories": categories,
        "documents_total": sum(c["documents"] for c in categories),
        "chunks_total": sum(c["chunks"] for c in categories),
        "vector_points": store.count_points(),
        "errors": db.query(func.count(Document.id)).filter(Document.status == "error").scalar() or 0,
    }


class SearchRequest(BaseModel):
    query: str
    category: str = ""
    k: int = 8


@router.post("/search")
def semantic_search(body: SearchRequest, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    q = body.query.strip()
    if not q:
        raise HTTPException(status_code=400, detail="Пустой запрос")
    hits = store.search(q, k=min(max(body.k, 1), 30), category=body.category)
    doc_ids = {h.get("doc_id") for h in hits if h.get("doc_id") is not None}
    docs = {d.id: d for d in db.query(Document).filter(Document.id.in_(doc_ids)).all()} if doc_ids else {}
    results = []
    for h in hits:
        d = docs.get(h.get("doc_id"))
        results.append({
            "doc_id": h.get("doc_id"),
            "title": (d.title if d else None) or h.get("title"),
            "category": (d.category if d else None) or h.get("category"),
            "source_url": (d.source_url if d else None) or h.get("source_url"),
            "page": h.get("page"),
            "score": h.get("score"),
            "text": h.get("text", ""),
        })
    audit(db, user, "document_search", {"query": q[:200], "hits": len(results)})
    return {"results": results}


@router.get("/{doc_id}/file")
def download_document(doc_id: int, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    doc = db.get(Document, doc_id)
    if doc is None or not Path(doc.stored_path).exists():
        raise HTTPException(status_code=404, detail="Файл документа не найден")
    return FileResponse(doc.stored_path, filename=doc.filename)


@router.delete("/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Документ не найден")
    store.delete_document(doc.id)
    db.delete(doc)
    db.commit()
    audit(db, user, "delete_document", {"id": doc_id, "filename": doc.filename})
    return {"ok": True}
