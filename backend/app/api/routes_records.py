"""Просмотр загруженных данных: список с фильтрами и карточка строки.

Заменяется предметными маршрутами, когда появится своя модель, — но до тех пор
даёт рабочий экран «данные в системе есть и их видно».
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Record, User
from .deps import audit, get_current_user

router = APIRouter(prefix="/records", tags=["records"])


def _row(r: Record) -> dict:
    return {
        "id": r.id, "key": r.key, "title": r.title, "category": r.category,
        "status": r.status, "amount": r.amount,
    }


@router.get("")
def list_records(
    q: str = "",
    category: str = "",
    status: str = "",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Record)
    if q.strip():
        # ищем по нормализованному полю: см. комментарий к Record.search_text
        query = query.filter(Record.search_text.like(f"%{q.strip().lower()}%"))
    if category:
        query = query.filter(Record.category == category)
    if status:
        query = query.filter(Record.status == status)
    total = query.count()
    rows = query.order_by(Record.id.desc()).offset(offset).limit(limit).all()
    return {"items": [_row(r) for r in rows], "total": total, "offset": offset, "limit": limit}


@router.get("/facets")
def facets(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Значения фильтров и сводка — заодно показывает, что данные вообще загружены."""
    by_category = (
        db.query(Record.category, func.count(Record.id))
        .group_by(Record.category).order_by(func.count(Record.id).desc()).limit(50).all()
    )
    by_status = (
        db.query(Record.status, func.count(Record.id))
        .group_by(Record.status).order_by(func.count(Record.id).desc()).limit(50).all()
    )
    return {
        "total": db.query(func.count(Record.id)).scalar() or 0,
        "amount_sum": db.query(func.coalesce(func.sum(Record.amount), 0.0)).scalar() or 0.0,
        "by_category": [{"value": c or "не указано", "count": n} for c, n in by_category],
        "by_status": [{"value": s or "не указан", "count": n} for s, n in by_status],
    }


@router.get("/{record_id}")
def get_record(record_id: int, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    rec = db.get(Record, record_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    audit(db, user, "record_view", {"id": record_id})
    return {**_row(rec), "payload": rec.payload or {}}
