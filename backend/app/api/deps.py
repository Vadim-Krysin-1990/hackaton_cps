from __future__ import annotations

import time
from contextlib import contextmanager

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AuditLog, User
from ..security import SESSION_COOKIE, read_session_token


def get_current_user(
    db: Session = Depends(get_db),
    app_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User:
    if not app_session:
        raise HTTPException(status_code=401, detail="Требуется вход в систему")
    user_id = read_session_token(app_session)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Сессия истекла, войдите заново")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    return user


def audit(db: Session, user: User | None, action: str, details: dict | None = None,
          duration_ms: int | None = None) -> None:
    db.add(AuditLog(
        user_id=user.id if user else None,
        username=user.username if user else "",
        action=action,
        details=details,
        duration_ms=duration_ms,
    ))
    db.commit()


@contextmanager
def timed():
    """Замер длительности операции для метрики «было/стало».

        with timed() as t:
            result = long_operation()
        audit(db, user, "action", {...}, duration_ms=t.ms)

    Числа попадают в журнал и в /api/metrics — на питче это ответ на главный
    вопрос заказчика: сколько времени экономит сервис.
    """
    class _T:
        ms = 0
    t = _T()
    start = time.perf_counter()
    try:
        yield t
    finally:
        t.ms = int((time.perf_counter() - start) * 1000)
