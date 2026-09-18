"""Проверка цитат по источнику.

Главное правило конвейера: факт без цитаты, найденной в тексте беседы, в
паспорт не попадает. Модель склонна «улучшать» цитаты (менять порядок слов,
сокращать), поэтому ищем не точным совпадением, а лучшим окном в тексте с
порогом схожести. Результат проверки виден в интерфейсе: что принято, что
отклонено и почему.
"""
from __future__ import annotations

import difflib
import re

THRESHOLD = 0.82          # ниже — цитата считается выдуманной или переписанной
MIN_QUOTE_CHARS = 12

_ws = re.compile(r"\s+")


def _norm(s: str) -> str:
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[«»\"'“”„]", "", s)
    return _ws.sub(" ", s).strip(" .…-–—")


def locate(quote: str, source: str) -> dict:
    """Возвращает {found, ratio, start, end, matched} для цитаты в тексте."""
    q = _norm(quote)
    if len(q) < MIN_QUOTE_CHARS:
        return {"found": False, "ratio": 0.0, "start": None, "end": None,
                "matched": "", "reason": "слишком короткая цитата"}
    src_low = source.lower().replace("ё", "е")
    # быстрый путь: точное вхождение
    pos = src_low.find(q)
    if pos >= 0:
        return {"found": True, "ratio": 1.0, "start": pos, "end": pos + len(q),
                "matched": source[pos:pos + len(q)], "reason": ""}
    # медленный путь: лучшее окно длиной ±25% от цитаты, шаг по словам
    best = (0.0, None, None)
    words = [(m.start(), m.end()) for m in re.finditer(r"\S+", source)]
    q_words = len(q.split())
    for w0 in range(len(words)):
        for span in (q_words, q_words + max(1, q_words // 4), max(1, q_words - max(1, q_words // 4))):
            w1 = min(len(words), w0 + span)
            if w1 <= w0:
                continue
            s, e = words[w0][0], words[w1 - 1][1]
            cand = _norm(source[s:e])
            ratio = difflib.SequenceMatcher(None, q, cand).ratio()
            if ratio > best[0]:
                best = (ratio, s, e)
        if w0 + q_words > len(words) + 2:
            break
    ratio, s, e = best
    found = ratio >= THRESHOLD
    return {
        "found": found, "ratio": round(ratio, 2), "start": s if found else None,
        "end": e if found else None, "matched": source[s:e] if found and s is not None else "",
        "reason": "" if found else f"в тексте нет такой фразы (схожесть {ratio:.0%})",
    }


def check_passport(passport: dict, source: str) -> tuple[dict, dict]:
    """Проходит по всем цитатам паспорта, отклонённые убирает из полей.

    Возвращает (очищенный паспорт, отчёт проверки).
    """
    report = {"checked": 0, "accepted": 0, "rejected": [], "anchors": []}

    def _check(quote: str, field: str) -> bool:
        report["checked"] += 1
        loc = locate(quote, source)
        if loc["found"]:
            report["accepted"] += 1
            report["anchors"].append({"field": field, "quote": quote, "start": loc["start"],
                                      "end": loc["end"], "ratio": loc["ratio"]})
            return True
        report["rejected"].append({"field": field, "quote": quote, "reason": loc["reason"]})
        return False

    clean = dict(passport)
    pains = []
    for p in passport.get("pain_points", []) or []:
        quotes = [q for q in (p.get("quotes") or []) if isinstance(q, str) and _check(q, "боль: " + str(p.get("label", "")))]
        if quotes:
            pains.append({**p, "quotes": quotes, "mentions": max(int(p.get("mentions") or 1), len(quotes))})
    clean["pain_points"] = pains

    practices = []
    for b in passport.get("best_practices", []) or []:
        q = b.get("quote") if isinstance(b, dict) else None
        if isinstance(q, str) and _check(q, "сильная сторона: " + str(b.get("label", ""))):
            practices.append(b)
    clean["best_practices"] = practices

    rq = passport.get("exit_reason_quote")
    if isinstance(rq, str) and rq.strip():
        if not _check(rq, "причина ухода"):
            clean["exit_reason_quote"] = ""
    return clean, report
