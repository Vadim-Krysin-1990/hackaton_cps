"""Индексация документа базы знаний: парсинг -> чанки -> эмбеддинги -> Qdrant."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from ..models import Document
from . import chunker, pdfparse, store


def index_document(db: Session, doc: Document, commit: bool = True) -> None:
    try:
        pages = pdfparse.parse_document(doc.stored_path)
        doc.title = doc.title or pdfparse.guess_title(pages, Path(doc.filename).stem)
        chunks = chunker.chunk_pages(pages)
        store.delete_document(doc.id)
        n = store.upsert_chunks(doc.id, doc.title or doc.filename, chunks,
                                category=doc.category, source_url=doc.source_url)
        doc.pages = len(pages)
        doc.chunks = n
        doc.status = "done"
        doc.error = None
    except Exception as e:
        doc.status = "error"
        doc.error = f"{type(e).__name__}: {e}"
    if commit:
        db.commit()
