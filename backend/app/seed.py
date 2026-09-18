"""Демо-пользователи. На хакатоне вход нужен не ради безопасности, а чтобы
показать роли и заполнить журнал событий: жюри видит, кто что делал.

Пароль задаётся через APP_DEMO_PASSWORD, роли — здесь и в llm/prompts.py.
"""
from __future__ import annotations

import os

from sqlalchemy.orm import Session

from .models import User
from .security import hash_password

DEMO_PASSWORD = os.getenv("APP_DEMO_PASSWORD", "demo2026")

DEMO_USERS = [
    ("ruk", "Демо: руководитель", "leader"),
    ("exp", "Демо: профильный специалист", "expert"),
    ("ana", "Демо: аналитик", "analyst"),
]


def ensure_demo_users(db: Session) -> None:
    if db.query(User).count() > 0:
        return
    for username, full_name, role in DEMO_USERS:
        db.add(User(username=username, password_hash=hash_password(DEMO_PASSWORD),
                    full_name=full_name, role=role))
    db.commit()
    creds = ", ".join(f"{u} ({r})" for u, _, r in DEMO_USERS)
    print(f"[seed] Созданы демо-пользователи: {creds}; пароль: {DEMO_PASSWORD}")
