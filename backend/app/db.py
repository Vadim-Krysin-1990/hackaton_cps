from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    url = settings.effective_database_url
    kwargs = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    eng = create_engine(url, pool_pre_ping=True, **kwargs)
    if url.startswith("sqlite"):
        # без этого ON DELETE CASCADE не работает: при passive_deletes=True
        # дочерние строки осиротеют и прицепятся к переиспользованным id
        @event.listens_for(eng, "connect")
        def _fk_on(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
    return eng


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_columns() -> None:
    """Лёгкая миграция вместо Alembic: добавляет недостающие колонки в существующие
    таблицы (прототип разворачивается поверх уже созданной базы)."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                col_type = column.type.compile(engine.dialect)
                default = ""
                if column.default is not None and getattr(column.default, "is_scalar", False):
                    value = column.default.arg
                    default = f" DEFAULT {value!r}" if isinstance(value, str) else f" DEFAULT {value}"
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{column.name}" {col_type}{default}'))
                print(f"[db] добавлена колонка {table.name}.{column.name}")


def init_db() -> None:
    from . import models  # noqa: F401 — регистрация моделей

    Base.metadata.create_all(engine)
    _ensure_columns()
