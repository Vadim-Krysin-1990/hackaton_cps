"""Конвейер «транскрипт → паспорт проблемы».

Шаги фиксированы и видны в журнале:
  1. parse      — реплики и говорящие
  2. sentiment  — настроение по репликам (словарь, без модели)
  3. extract    — паспорт по JSON-схеме: моделью, либо запасным путём без неё
  4. verify     — каждая цитата ищется в источнике; не найденные отбрасываются
  5. done

Промпты читаются из /prompts/*.txt при каждом запуске: HR правит текст файла,
и следующий анализ уже идёт по новым правилам, без перезапуска сервиса.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from ...config import PROJECT_ROOT, settings
from ...llm import client
from . import fallback, sentiment, verify
from .parsing import split_utterances

PROMPTS_DIR = PROJECT_ROOT / "prompts"

REQUIRED = ("exit_reason", "pain_points", "best_practices", "risk_zone", "improvement_suggestions")
REASONS = {"деньги", "карьера", "микроклимат", "нереализованность", "другое"}
RISKS = {"High", "Medium", "Low"}


def load_prompt(name: str) -> str:
    path = PROMPTS_DIR / f"{name}.txt"
    if not path.exists():
        raise FileNotFoundError(f"Нет файла промпта {path}. Восстановите его из репозитория.")
    return path.read_text(encoding="utf-8")


def _extract_json(raw: str) -> dict:
    """Модели любят оборачивать JSON в ```json … ``` или добавлять фразу перед ним."""
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    start, end = raw.find("{"), raw.rfind("}")
    if start >= 0 and end > start:
        return json.loads(raw[start:end + 1])
    raise ValueError("в ответе модели нет JSON-объекта")


def _normalize(p: dict) -> dict:
    """Приводит ответ модели к схеме: недостающее — пустое, лишнее — отбрасывается."""
    out = {
        "exit_reason": str(p.get("exit_reason") or "другое").strip().lower(),
        "exit_reason_quote": str(p.get("exit_reason_quote") or ""),
        "says": str(p.get("says") or ""),
        "feels": str(p.get("feels") or ""),
        "pain_points": [],
        "best_practices": [],
        "risk_zone": str(p.get("risk_zone") or "Medium").strip().capitalize(),
        "risk_rationale": str(p.get("risk_rationale") or ""),
        "top_problem": str(p.get("top_problem") or ""),
        "improvement_suggestions": [str(s) for s in (p.get("improvement_suggestions") or []) if str(s).strip()][:5],
        "summary": str(p.get("summary") or ""),
    }
    if out["exit_reason"] not in REASONS:
        out["exit_reason"] = "другое"
    if out["risk_zone"] not in RISKS:
        out["risk_zone"] = "Medium"
    for item in p.get("pain_points") or []:
        if not isinstance(item, dict):
            continue
        quotes = item.get("quotes") or ([item["quote"]] if item.get("quote") else [])
        out["pain_points"].append({
            "label": str(item.get("label") or item.get("category") or "проблема"),
            "category": str(item.get("category") or "другое"),
            "mentions": int(item.get("mentions") or 1) if str(item.get("mentions") or "1").isdigit() else 1,
            "quotes": [str(q) for q in quotes if str(q).strip()],
        })
    for item in p.get("best_practices") or []:
        if isinstance(item, dict) and item.get("quote"):
            out["best_practices"].append({"label": str(item.get("label") or "работает хорошо"),
                                          "quote": str(item["quote"])})
    if not out["top_problem"] and out["pain_points"]:
        out["top_problem"] = out["pain_points"][0]["category"]
    return out


def _llm_passport(transcript: str, hints: dict, model: str | None = None,
                  attempts: int = 2) -> tuple[dict, list[str]]:
    """Запрос к модели с повтором при невалидном JSON. Возвращает (паспорт, заметки)."""
    system = load_prompt("passport_system")
    user = load_prompt("passport_user")
    for key, value in {"transcript": transcript, **hints}.items():
        user = user.replace("{" + key + "}", str(value))
    notes: list[str] = []
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    last_error = ""
    for attempt in range(1, attempts + 1):
        raw = client.chat(messages, temperature=0.1, max_tokens=1800, model=model)
        try:
            data = _extract_json(raw)
            missing = [k for k in REQUIRED if k not in data]
            if missing:
                raise ValueError(f"нет полей {', '.join(missing)}")
            if attempt > 1:
                notes.append(f"JSON получен со второй попытки ({last_error})")
            return _normalize(data), notes
        except (ValueError, json.JSONDecodeError) as e:
            last_error = str(e)
            notes.append(f"попытка {attempt}: ответ модели не разобран ({last_error})")
            messages.append({"role": "assistant", "content": raw[:2000]})
            messages.append({"role": "user", "content":
                             "Ответ не является корректным JSON по схеме. Верни только JSON-объект, "
                             f"без текста вокруг. Ошибка: {last_error}"})
    raise ValueError(f"модель не вернула корректный JSON: {last_error}")


def run(source: str, use_llm: bool | None = None, model: str | None = None) -> dict:
    """Полный проход. Никогда не бросает исключение из-за модели: при любой
    проблеме переключается на запасной путь и пишет причину в steps."""
    steps: list[dict] = []
    t0 = time.perf_counter()

    def step(name: str, detail: str = "") -> None:
        steps.append({"step": name, "ms": int((time.perf_counter() - t0) * 1000), "detail": detail})

    utts = split_utterances(source)
    n_emp = sum(1 for u in utts if u.speaker != "interviewer")
    step("parse", f"реплик: {len(utts)}, из них сотрудника: {n_emp}")

    points = sentiment.timeline(utts)
    sent = sentiment.summary(points)
    lowest = next((p for p in points if p["idx"] == sent["min_idx"]), None)
    step("sentiment", f"средний тон {sent['mean']:+.2f}, {sent['trend']}")

    hints = {"lowest_snippet": lowest["snippet"] if lowest else "", "trend": sent["trend"]}
    engine = "fallback"
    notes: list[str] = []
    want_llm = client.llm_available() if use_llm is None else use_llm
    passport: dict | None = None
    if want_llm:
        try:
            passport, notes = _llm_passport(source, hints, model=model)
            engine = f"llm:{model or settings.llm_model}"
        except Exception as e:  # модель недоступна, таймаут, мусор в ответе
            notes.append(f"модель не справилась: {type(e).__name__}: {str(e)[:160]}; включён запасной путь")
    if passport is None:
        passport = fallback.analyze(source, utts)
    step("extract", f"движок {engine}; болей {len(passport['pain_points'])}, "
                    f"сильных сторон {len(passport['best_practices'])}")

    clean, report = verify.check_passport(passport, source)
    step("verify", f"цитат проверено {report['checked']}, принято {report['accepted']}, "
                   f"отклонено {len(report['rejected'])}")
    if len(clean["improvement_suggestions"]) < 3:
        clean["improvement_suggestions"] += fallback.SUGGESTIONS.get(
            clean.get("top_problem", ""), fallback.DEFAULT_SUGGESTIONS)
        clean["improvement_suggestions"] = clean["improvement_suggestions"][:5]
        notes.append("гипотез было меньше трёх, добавлены типовые")
    step("done")
    return {
        "passport": clean,
        "sentiment": {"points": points, **sent},
        "verification": report,
        "utterances": [{"idx": u.idx, "speaker": u.speaker, "text": u.text,
                        "start": u.start, "end": u.end} for u in utts],
        "engine": engine,
        "steps": steps,
        "notes": notes,
        "duration_ms": int((time.perf_counter() - t0) * 1000),
    }


def prompts_status() -> list[dict]:
    """Для экрана «О сервисе»: какие промпты есть и когда правились."""
    out = []
    for p in sorted(Path(PROMPTS_DIR).glob("*.txt")):
        out.append({"name": p.stem, "size": p.stat().st_size, "modified": time.strftime(
            "%d.%m.%Y %H:%M", time.localtime(p.stat().st_mtime))})
    return out
