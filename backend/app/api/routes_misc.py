from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..llm import client as llm_client
from ..models import AuditLog, User
from ..rag import embedder
from .deps import get_current_user

router = APIRouter(tags=["misc"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    """Состояние контура. Открыт без авторизации: этим экраном удобно доказывать
    жюри, что модель действительно подключена, а не подделана скриншотом."""
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return {
        "app_title": settings.app_title,
        "app_subtitle": settings.app_subtitle,
        "db": db_ok,
        "qdrant_mode": "server" if settings.qdrant_url else "embedded",
        "embedder": embedder.name(),
        "llm_provider": llm_client.provider(),
        "llm_model": settings.llm_model,
        "llm_available": llm_client.llm_available(),
        "llm_endpoint": llm_client.endpoint(),
        "llm_key_set": bool(settings.llm_api_key),
        "llm_error": llm_client.last_error(),
    }


# Человеческие названия событий журнала. Добавляйте свои действия сюда —
# экран «Журнал» собирает фильтры из этого словаря.
ACTION_LABELS = {
    "login": "Вход в систему",
    "logout": "Выход из системы",
    "upload_dataset": "Загрузка датасета",
    "upload_failed": "Ошибка загрузки",
    "upload_document": "Загрузка документа",
    "delete_document": "Удаление документа",
    "document_search": "Поиск по библиотеке",
    "chat": "Вопрос ассистенту",
    "chat_cleared": "Очистка диалога",
    "artifact": "Подготовка документа",
    "record_view": "Просмотр записи",
    "interview_analyze": "Анализ интервью",
    "interview_failed": "Ошибка анализа интервью",
    "interview_view": "Просмотр паспорта",
    "interview_delete": "Удаление интервью",
    "interview_export": "Выгрузка паспорта",
    "insight_build": "Вывод ИИ по всем интервью",
}


def _row(r: AuditLog) -> dict:
    return {
        "id": r.id,
        "username": r.username,
        "action": r.action,
        "action_label": ACTION_LABELS.get(r.action, r.action),
        "details": r.details,
        "duration_ms": r.duration_ms,
        "at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("/audit")
def audit_log(
    action: str = "",
    username: str = "",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(AuditLog)
    if action:
        query = query.filter(AuditLog.action == action)
    if username:
        query = query.filter(AuditLog.username == username)
    total = query.count()
    rows = (
        query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset(offset).limit(limit).all()
    )
    return {"items": [_row(r) for r in rows], "total": total, "offset": offset, "limit": limit}


@router.get("/audit/stats")
def audit_stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    by_action = (
        db.query(AuditLog.action, func.count(AuditLog.id))
        .group_by(AuditLog.action).order_by(func.count(AuditLog.id).desc()).all()
    )
    by_user = (
        db.query(AuditLog.username, func.count(AuditLog.id))
        .group_by(AuditLog.username).order_by(func.count(AuditLog.id).desc()).all()
    )
    since = datetime.now() - timedelta(hours=24)
    return {
        "total": db.query(func.count(AuditLog.id)).scalar() or 0,
        "last_24h": db.query(func.count(AuditLog.id)).filter(AuditLog.created_at >= since).scalar() or 0,
        "by_action": [
            {"action": a, "label": ACTION_LABELS.get(a, a), "count": c} for a, c in by_action
        ],
        "by_user": [{"username": u or "—", "count": c} for u, c in by_user],
    }


@router.get("/metrics")
def metrics(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Метрика «было / стало» — измеренная, а не заявленная.

    Заказчики почти всегда оценивают решение по экономии времени специалиста.
    Здесь берётся реальная длительность операций из журнала и сравнивается с
    APP_BASELINE_MANUAL_MINUTES — сколько та же работа занимает вручную.
    Цифру ручного норматива спрашивайте у заказчика прямо, не выдумывайте.
    """
    rows = (
        db.query(AuditLog.action, func.count(AuditLog.id), func.avg(AuditLog.duration_ms),
                 func.max(AuditLog.duration_ms))
        .filter(AuditLog.duration_ms.isnot(None))
        .group_by(AuditLog.action).all()
    )
    manual_minutes = settings.baseline_manual_minutes
    operations = []
    for action, count, avg_ms, max_ms in rows:
        avg_ms = int(avg_ms or 0)
        operations.append({
            "action": action,
            "label": ACTION_LABELS.get(action, action),
            "count": count,
            "avg_ms": avg_ms,
            "max_ms": int(max_ms or 0),
            "speedup": round(manual_minutes * 60_000 / avg_ms, 1) if avg_ms else None,
        })
    operations.sort(key=lambda o: -o["count"])
    measured = [o for o in operations if o["avg_ms"]]
    return {
        "manual_minutes": manual_minutes,
        "operations": operations,
        "saved_minutes_total": round(sum(
            (manual_minutes - o["avg_ms"] / 60_000) * o["count"] for o in measured
        ), 1),
    }
