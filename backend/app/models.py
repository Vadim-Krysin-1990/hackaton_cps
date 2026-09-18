"""Модели заготовки.

Здесь только то, что нужно любому решению: пользователи, журнал событий,
переписка с ассистентом, загрузки, документы библиотеки и универсальная
запись данных Record.

Record — намеренно бесформенная: произвольная строка датасета с несколькими
индексируемыми полями и payload в JSON. Она даёт рабочий путь в первый час
хакатона (загрузили файл — увидели данные), а на второй день заменяется
нормальными предметными таблицами.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (JSON, DateTime, Float, ForeignKey, Integer, String,
                        Text, func)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    full_name: Mapped[str] = mapped_column(String(128), default="")
    # роли задаются в seed.py и prompts.py — переименуйте под свою задачу
    role: Mapped[str] = mapped_column(String(32), default="analyst")
    # sub из OIDC-провайдера: у пользователей Keycloak пароля здесь нет
    oidc_subject: Mapped[str | None] = mapped_column(String(128), nullable=True,
                                                     unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Upload(Base):
    """Загруженный файл: что приняли, сколько строк разобрали, где ошиблись."""
    __tablename__ = "uploads"

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(512))
    stored_path: Mapped[str] = mapped_column(String(1024))
    kind: Mapped[str] = mapped_column(String(32), default="dataset")  # dataset | document
    status: Mapped[str] = mapped_column(String(32), default="processing")  # processing | done | error
    rows_total: Mapped[int] = mapped_column(Integer, default=0)
    records_new: Mapped[int] = mapped_column(Integer, default=0)
    records_updated: Mapped[int] = mapped_column(Integer, default=0)
    columns: Mapped[list | None] = mapped_column(JSON, nullable=True)
    quality: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Record(Base):
    """Универсальная строка датасета. Замените на предметную модель, когда
    поймёте структуру данных задачи, — или оставьте, если данные разнородные."""
    __tablename__ = "records"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    status: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Ключ, название, категория и статус в нижнем регистре одной строкой.
    # Нужен потому, что SQLite приводит регистр только для латиницы: поиск
    # «объект» по полю с «Объект» иначе не находит ничего. Заполняется в
    # ingest/loader.py, ищется простым LIKE — одинаково на SQLite и PostgreSQL.
    search_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    upload_id: Mapped[int | None] = mapped_column(ForeignKey("uploads.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class Document(Base):
    """Документ библиотеки: файл или страница, разобранные для поиска по смыслу."""
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(512))
    stored_path: Mapped[str] = mapped_column(String(1024), unique=True)
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # один и тот же файл нередко лежит под разными URL (…/doc.pdf?v=2)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(128), default="Загружено вручную", index=True)
    doc_type: Mapped[str] = mapped_column(String(32), default="file")  # file | page
    pages: Mapped[int] = mapped_column(Integer, default=0)
    chunks: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="processing")  # processing | done | error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AuditLog(Base):
    """Журнал событий: кто, что и когда сделал. На демо это отдельный экран —
    жюри видит, что система живая, а не набор скриншотов."""
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    username: Mapped[str] = mapped_column(String(64), default="")
    action: Mapped[str] = mapped_column(String(128))
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # длительность операции в миллисекундах — основа метрики «было/стало»
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Insight(Base):
    """Вывод ИИ по всем интервью: что делать с главной проблемой. Кэшируется,
    пересчитывается, когда добавились новые интервью или по кнопке."""
    __tablename__ = "insights"

    id: Mapped[int] = mapped_column(primary_key=True)
    # пусто — вывод по главной проблеме; иначе категория, по которой просили рекомендации
    problem: Mapped[str] = mapped_column(String(128), default="", index=True)
    interviews_count: Mapped[int] = mapped_column(Integer, default=0)
    engine: Mapped[str] = mapped_column(String(64), default="")
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Interview(Base):
    """Exit-интервью: исходный текст, паспорт проблемы и всё, что нужно, чтобы
    показать, откуда паспорт взялся (реплики, настроение, проверка цитат)."""
    __tablename__ = "interviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(512))
    source: Mapped[str] = mapped_column(Text)
    chars: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="done")   # done | error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # индексируемые поля паспорта — для списка, фильтров и дашборда
    exit_reason: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    risk_zone: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    top_problem: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    department: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    manager: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    engine: Mapped[str] = mapped_column(String(64), default="")
    passport: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    analysis: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # sentiment, verification, utterances, steps
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
