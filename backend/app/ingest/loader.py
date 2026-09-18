"""Универсальный приём табличного датасета (XLSX/CSV) в таблицу Record.

Зачем: в первый час хакатона датасет заказчика надо просто увидеть — со всеми
кривыми заголовками, склейками и пустотами. Загрузчик ничего не знает о
предметной области: сам находит строку заголовков, кладёт строку целиком в
payload и считает отчёт о качестве (что пустое, что дублируется, какие типы).

Когда структура данных станет понятной, замените выбор полей в ROLE_HINTS —
или перепишите модуль под предметные таблицы, это одноразовый код.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from ..models import Record, Upload

# Подсказки: какой заголовок во что кладём. Первое совпадение выигрывает.
# Правьте под свой датасет — это единственное место, где заготовка «угадывает».
ROLE_HINTS: dict[str, tuple[str, ...]] = {
    "key": ("id", "код", "номер", "ключ", "key", "uid"),
    "title": ("наимен", "назван", "предмет", "тема", "описан", "title", "name"),
    "category": ("категор", "тип", "вид", "группа", "class", "category"),
    "status": ("статус", "состояние", "этап", "status", "state"),
    "amount": ("сумма", "стоим", "цена", "нмц", "amount", "price", "value", "объём"),
}

MAX_ROWS = 100_000  # предохранитель: 1 ядро и 3,8 ГБ на демо-сервере


def _read_csv(path: Path) -> pd.DataFrame:
    """CSV в дикой природе: cp1251, разделитель «;» или таб, BOM."""
    raw = path.read_bytes()
    text = None
    for enc in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw.decode("utf-8", errors="replace")
    sample = "\n".join(text.splitlines()[:20])
    try:
        sep = csv.Sniffer().sniff(sample, delimiters=";\t,").delimiter
    except csv.Error:
        sep = ";" if sample.count(";") >= sample.count("\t") else "\t"
    return pd.read_csv(io.StringIO(text), sep=sep, header=None, dtype=object)


def read_table(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    if path.suffix.lower() in (".xlsx", ".xlsm", ".xls"):
        return pd.read_excel(path, header=None, dtype=object)
    return _read_csv(path)


def is_empty(v: Any) -> bool:
    return v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == ""


def find_header_row(df: pd.DataFrame) -> int:
    """Шапка — первая строка, где хотя бы две непустые текстовые ячейки и нет
    чисел: над таблицей часто висит строка-титул («Реестр за 2026 год»)."""
    best, best_score = 0, -1.0
    for idx in range(min(15, len(df))):
        cells = [c for c in df.iloc[idx].tolist() if not is_empty(c)]
        if len(cells) < 2:
            continue
        texts = [c for c in cells if isinstance(c, str) and not c.strip().replace(".", "").isdigit()]
        score = len(texts) - 0.5 * (len(cells) - len(texts))
        if score > best_score:
            best, best_score = idx, score
    return best


def _norm(h: Any, i: int) -> str:
    s = re.sub(r"\s+", " ", str(h).strip()) if not is_empty(h) else ""
    return s or f"Колонка {i + 1}"


def guess_roles(headers: list[str]) -> dict[str, str]:
    """Сопоставление заголовков ролям key/title/category/status/amount."""
    roles: dict[str, str] = {}
    for role, hints in ROLE_HINTS.items():
        for h in headers:
            low = h.lower()
            if any(hint in low for hint in hints) and h not in roles.values():
                roles[role] = h
                break
    return roles


def _as_float(v: Any) -> float | None:
    if is_empty(v):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v)).replace(",", ".")
    # «1.234.567.89» — разделители тысяч точками
    if s.count(".") > 1:
        head, _, tail = s.rpartition(".")
        s = head.replace(".", "") + "." + tail
    try:
        return float(s)
    except ValueError:
        return None


def _as_text(v: Any) -> str | None:
    return None if is_empty(v) else re.sub(r"\s+", " ", str(v).strip())


def parse_table(path: str | Path) -> dict[str, Any]:
    df = read_table(path)
    if df.empty:
        raise ValueError("Файл пустой")
    header_idx = find_header_row(df)
    headers = [_norm(h, i) for i, h in enumerate(df.iloc[header_idx].tolist())]

    rows: list[dict[str, Any]] = []
    empty_rows = 0
    for row_i in range(header_idx + 1, min(len(df), header_idx + 1 + MAX_ROWS)):
        values = df.iloc[row_i].tolist()
        if all(is_empty(v) for v in values):
            empty_rows += 1
            continue
        rows.append({h: (None if is_empty(v) else v) for h, v in zip(headers, values)})

    return {
        "headers": headers,
        "rows": rows,
        "empty_rows": empty_rows,
        "roles": guess_roles(headers),
        "truncated": len(df) - header_idx - 1 > MAX_ROWS,
    }


def quality_report(parsed: dict[str, Any]) -> dict[str, Any]:
    """Отчёт о качестве: заполненность и уникальность по колонкам. Показывается
    после загрузки — на разборе ТЗ это первое, что спрашивают у данных."""
    rows, headers = parsed["rows"], parsed["headers"]
    total = len(rows) or 1
    columns = []
    for h in headers:
        values = [r.get(h) for r in rows]
        filled = sum(1 for v in values if v is not None)
        distinct = len({str(v) for v in values if v is not None})
        columns.append({
            "name": h,
            "filled": filled,
            "filled_pct": round(100 * filled / total),
            "distinct": distinct,
            "example": next((str(v)[:80] for v in values if v is not None), None),
        })
    return {
        "rows_total": len(rows),
        "empty_rows": parsed["empty_rows"],
        "columns_total": len(headers),
        "columns": columns,
        "roles": parsed["roles"],
        "truncated": parsed["truncated"],
    }


def _make_key(row: dict[str, Any], roles: dict[str, str], seed: str) -> str:
    """Бизнес-ключ строки: нужен, чтобы повторная загрузка файла не плодила
    дубли, а обновляла записи."""
    key_col = roles.get("key")
    if key_col and row.get(key_col) is not None:
        return str(row[key_col]).strip()[:200]
    payload = "|".join(f"{k}={v}" for k, v in sorted(row.items()) if v is not None)
    return hashlib.sha1((payload or seed).encode()).hexdigest()[:32]


def load_dataset(db: Session, upload: Upload, path: str | Path) -> dict[str, Any]:
    """Разбирает файл и идемпотентно заливает строки в Record."""
    parsed = parse_table(path)
    roles = parsed["roles"]
    stats = {"new": 0, "updated": 0}

    for i, row in enumerate(parsed["rows"]):
        key = _make_key(row, roles, seed=f"{upload.id}:{i}")
        rec = db.query(Record).filter(Record.key == key).one_or_none()
        if rec is None:
            rec = Record(key=key)
            db.add(rec)
            stats["new"] += 1
        else:
            stats["updated"] += 1
        rec.upload_id = upload.id
        rec.title = _as_text(row.get(roles.get("title", ""))) or rec.title
        rec.category = _as_text(row.get(roles.get("category", ""))) or rec.category
        rec.status = _as_text(row.get(roles.get("status", ""))) or rec.status
        amount = _as_float(row.get(roles.get("amount", "")))
        if amount is not None:
            rec.amount = amount
        rec.payload = {k: (None if v is None else str(v)) for k, v in row.items()}
        rec.search_text = " ".join(
            str(v).lower() for v in (rec.key, rec.title, rec.category, rec.status) if v
        )

    quality = quality_report(parsed)
    upload.rows_total = quality["rows_total"]
    upload.records_new = stats["new"]
    upload.records_updated = stats["updated"]
    upload.columns = parsed["headers"]
    upload.quality = quality
    upload.status = "done"
    db.commit()
    return {**stats, "quality": quality}
