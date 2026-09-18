"""Ассистент: вопрос -> контекст (факты из базы + фрагменты документов) -> ответ
LLM со ссылками на источники.

Главное свойство — контур живёт без модели: если Ollama не поднята и ключа нет,
ассистент отвечает подобранными фактами. На демо это спасает, когда у жюри нет
интернета, а на ноутбуке не осталось памяти под модель.

Под свою задачу меняются три функции: project_stats (что считать сводкой),
find_records (как искать по вопросу) и record_facts (что показывать моделью как
факт). Остальное переиспользуется как есть.
"""
from __future__ import annotations

import re

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..models import ChatMessage, Record, User
from ..rag import store
from . import client
from .prompts import ROLE_LABELS, SYSTEM_ASSISTANT

MAX_CONTEXT_RECORDS = 5
MAX_CONTEXT_CHUNKS = 5


def fmt_num(v: float | None) -> str:
    if v is None:
        return "н/д"
    return f"{v:,.2f}".replace(",", " ").replace(".", ",")


def project_stats(db: Session) -> dict:
    total = db.query(func.count(Record.id)).scalar() or 0
    amount_sum = db.query(func.coalesce(func.sum(Record.amount), 0.0)).scalar() or 0.0
    by_status = (
        db.query(Record.status, func.count(Record.id))
        .group_by(Record.status).order_by(func.count(Record.id).desc()).limit(6).all()
    )
    by_category = (
        db.query(Record.category, func.count(Record.id))
        .group_by(Record.category).order_by(func.count(Record.id).desc()).limit(6).all()
    )
    return {
        "total": total,
        "amount_sum": amount_sum,
        "by_status": [(s or "не указан", c) for s, c in by_status],
        "by_category": [(c or "не указана", n) for c, n in by_category],
    }


_num_re = re.compile(r"[\w\d][\w\d/.\-]{3,}", re.UNICODE)


def _stem(word: str) -> str:
    """Грубое усечение окончания: «объекту» и «объекты» ищутся как «объек».

    Полноценная морфология (pymorphy) здесь не нужна и тянет словари; для
    подбора контекста хватает совпадения по основе. Если поиск станет узким
    местом задачи — меняйте это место на полнотекстовый индекс СУБД.
    """
    return word[:-2] if len(word) > 5 else word


def find_records(db: Session, question: str, limit: int = MAX_CONTEXT_RECORDS) -> list[Record]:
    """Поиск записей по вопросу: сначала по номерам и кодам, потом по словам."""
    tokens = [t for t in _num_re.findall(question) if any(ch.isdigit() for ch in t)]
    words = re.findall(r"[а-яёА-ЯЁa-zA-Z]{4,}", question)[:6]
    needles = [t.lower() for t in tokens[:4]] + [_stem(w.lower()) for w in words]
    if not needles:
        return []
    conds = [Record.search_text.like(f"%{n}%") for n in needles]
    return db.query(Record).filter(or_(*conds)).limit(limit).all()


def record_facts(r: Record) -> str:
    lines = [f"Запись {r.key}: {r.title or 'без названия'}"]
    parts = []
    if r.category:
        parts.append(f"категория: {r.category}")
    if r.status:
        parts.append(f"статус: {r.status}")
    if r.amount is not None:
        parts.append(f"сумма: {fmt_num(r.amount)}")
    if parts:
        lines.append("  " + "; ".join(parts))
    # пара полей из payload — модели полезнее сырые значения, чем их отсутствие
    extra = [(k, v) for k, v in (r.payload or {}).items() if v][:6]
    if extra:
        lines.append("  " + "; ".join(f"{k}: {str(v)[:80]}" for k, v in extra))
    return "\n".join(lines)


def build_context(db: Session, question: str) -> tuple[str, list[dict]]:
    evidence: list[dict] = []
    blocks: list[str] = []

    st = project_stats(db)
    if st["total"]:
        status_line = "; ".join(f"{s} — {c}" for s, c in st["by_status"]) or "нет данных"
        blocks.append(
            "СВОДКА ПО ДАННЫМ:\n"
            f"Всего записей: {st['total']}; сумма по полю amount: {fmt_num(st['amount_sum'])}.\n"
            f"По статусам: {status_line}."
        )

    matched = find_records(db, question)
    if matched:
        blocks.append("НАЙДЕННЫЕ ПО ВОПРОСУ ЗАПИСИ (выборка из базы):\n"
                      + "\n".join(record_facts(r) for r in matched))
        for r in matched:
            evidence.append({"type": "record", "id": r.id,
                             "label": f"Запись {r.key}", "snippet": (r.title or "")[:160]})

    for hit in store.search(question, k=MAX_CONTEXT_CHUNKS):
        page = f", стр. {hit['page']}" if hit.get("page") else ""
        section = f" [{hit['category']}]" if hit.get("category") else ""
        blocks.append(
            f"ДОКУМЕНТ «{hit.get('title', 'без названия')}»{page}{section}:\n{hit['text'][:700]}"
        )
        evidence.append({"type": "document", "doc_id": hit.get("doc_id"), "title": hit.get("title"),
                         "page": hit.get("page"), "snippet": hit["text"][:200],
                         "score": hit.get("score"), "category": hit.get("category"),
                         "source_url": hit.get("source_url")})

    if not blocks:
        blocks.append("ДАННЫХ В БАЗЕ ПОКА НЕТ: датасет не загружен, документы не проиндексированы.")
    return "\n\n".join(blocks), evidence


def _fallback_answer(context: str) -> str:
    return (
        "Языковая модель сейчас недоступна, поэтому отвечаю подобранными фактами из базы "
        "и документов (поднимите Ollama или задайте ключ API, чтобы получать связные "
        "ответы):\n\n" + context
    )


def answer_question(db: Session, user: User, question: str) -> dict:
    context, evidence = build_context(db, question)
    role = ROLE_LABELS.get(user.role, user.role)
    llm_used = False
    if client.llm_available():
        try:
            answer = client.chat([
                {"role": "system", "content": SYSTEM_ASSISTANT.format(role=role)},
                {"role": "user", "content": f"ДАННЫЕ:\n{context}\n\nВОПРОС ({role}): {question}"},
            ])
            llm_used = True
        except Exception as e:  # сеть, таймаут, чужой формат ответа — демо не должно падать
            answer = _fallback_answer(context) + f"\n\n(Ошибка обращения к модели: {type(e).__name__})"
    else:
        answer = _fallback_answer(context)

    db.add(ChatMessage(user_id=user.id, role="user", content=question))
    db.add(ChatMessage(user_id=user.id, role="assistant", content=answer, evidence=evidence))
    db.commit()
    return {"answer": answer, "evidence": evidence, "llm_used": llm_used}


def get_history(db: Session, user: User, limit: int = 60) -> list[dict]:
    msgs = (
        db.query(ChatMessage).filter(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc()).limit(limit).all()
    )
    return [
        {"role": m.role, "content": m.content, "evidence": m.evidence,
         "at": m.created_at.isoformat() if m.created_at else None}
        for m in reversed(msgs)
    ]
