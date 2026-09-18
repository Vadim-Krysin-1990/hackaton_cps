"""Разбор транскрипта на реплики.

Транскрипты приходят «как записал интервьюер»: с подписями «Интервьюер:» и
«Сотрудник:», с тире в начале строк или сплошным текстом, где вопросы отделены
многоточием. Разбор нужен, чтобы дальше считать настроение по ходу разговора
и отличать слова интервьюера от слов сотрудника.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

INTERVIEWER_HINTS = ("интервьюер", "hr", "эйчар", "рекрутер", "и:", "в:", "вопрос")
EMPLOYEE_HINTS = ("сотрудник", "работник", "с:", "о:", "ответ", "респондент")

_label_re = re.compile(r"^\s*[-–—]?\s*([A-Za-zА-Яа-яЁё ]{1,20}):\s*(.*)$")
_question_re = re.compile(r"[^.!?…]*\?")


@dataclass
class Utterance:
    idx: int
    speaker: str          # interviewer | employee | unknown
    text: str
    start: int            # смещение в исходном тексте, чтобы подсвечивать
    end: int


def _speaker_of(label: str) -> str:
    low = label.strip().lower()
    if any(h in low for h in INTERVIEWER_HINTS):
        return "interviewer"
    if any(h in low for h in EMPLOYEE_HINTS):
        return "employee"
    return "unknown"


def _split_plain(text: str) -> list[tuple[str, int, int]]:
    """Сплошной текст: режем по многоточию «...» и по границам вопросов."""
    parts: list[tuple[str, int, int]] = []
    for m in re.finditer(r"[^…]+?(?=\.\.\.|…|$)", text):
        chunk = m.group(0)
        if not chunk.strip():
            continue
        start = m.start()
        # внутри куска: вопрос интервьюера и ответ
        q = _question_re.match(chunk.lstrip(". "))
        if q:
            offset = len(chunk) - len(chunk.lstrip(". "))
            q_start, q_end = start + offset, start + offset + q.end()
            parts.append((chunk[offset:offset + q.end()], q_start, q_end))
            rest = chunk[offset + q.end():]
            if rest.strip():
                parts.append((rest, q_end, m.end()))
        else:
            parts.append((chunk, start, m.end()))
    return parts


_sentence_re = re.compile(r"[^.!?…]+[.!?…]+(?:\s*[»)])?|[^.!?…]+$")


def _split_monologue(text: str) -> list[tuple[str, int, int]]:
    """Сплошной монолог сотрудника без вопросов интервьюера: реплика = предложение,
    чтобы график настроения показывал ход рассказа, а не одну точку."""
    return [(m.group(0), m.start(), m.end()) for m in _sentence_re.finditer(text) if m.group(0).strip()]


def split_utterances(text: str) -> list[Utterance]:
    lines = text.splitlines(keepends=True)
    labeled = sum(1 for ln in lines if _label_re.match(ln))
    result: list[Utterance] = []
    pos = 0
    dialog_markers = ("..." in text) or ("…" in text and text.count("…") >= 2)
    if labeled < 2 and not dialog_markers:
        # монолог: всё говорит сотрудник; короткий вопрос в начале («Уходишь?») — интервьюер
        for i, (chunk, start, end) in enumerate(_split_monologue(text)):
            stripped = chunk.strip(" \n\t—–-")
            lead = chunk.index(stripped) if stripped else 0
            if not stripped:
                continue
            is_q = stripped.endswith("?") and len(stripped.split()) <= 3 and i == 0
            result.append(Utterance(len(result), "interviewer" if is_q else "employee",
                                    stripped, start + lead, start + lead + len(stripped)))
        return result
    if labeled >= 2:
        for ln in lines:
            m = _label_re.match(ln)
            body = ln.strip()
            if body:
                if m:
                    speaker = _speaker_of(m.group(1))
                    body_text = m.group(2).strip()
                    start = pos + ln.index(m.group(2)) if m.group(2) else pos
                else:
                    speaker = result[-1].speaker if result else "unknown"
                    body_text = body
                    start = pos + ln.index(body)
                if body_text:
                    result.append(Utterance(len(result), speaker, body_text, start, start + len(body_text)))
            pos += len(ln)
    else:
        for chunk, start, end in _split_plain(text):
            stripped = chunk.strip()
            lead = len(chunk) - len(chunk.lstrip())
            speaker = "interviewer" if stripped.endswith("?") else "employee"
            result.append(Utterance(len(result), speaker, stripped, start + lead, start + lead + len(stripped)))
    # если подписей не было, чередуем: вопрос → ответ
    if result and all(u.speaker == "unknown" for u in result):
        for u in result:
            u.speaker = "interviewer" if u.text.rstrip().endswith("?") else "employee"
    return result


def employee_text(utts: list[Utterance]) -> str:
    return "\n".join(u.text for u in utts if u.speaker != "interviewer")
