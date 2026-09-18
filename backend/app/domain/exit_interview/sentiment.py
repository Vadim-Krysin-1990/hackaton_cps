"""Настроение по репликам: словарный метод, без модели и без сети.

Зачем словарь, а не модель: график настроения должен строиться за миллисекунды
и одинаково на любой машине. Точность словаря ниже, чем у модели, зато результат
воспроизводим, а модель тратим на то, что словарю не по силам: паспорт проблемы.

Оценка от −1 до 1. Отдельно считаем «говорят» (факты, нейтральные слова) и
«чувствуют» (эмоциональные маркеры): по ТЗ жюри смотрит на это различие.
"""
from __future__ import annotations

import re

from .parsing import Utterance

NEGATIVE = {
    "ад": 3, "невыносим": 3, "война": 3, "бездар": 3, "унижен": 3, "токсич": 3,
    "убива": 2, "терпел": 2, "придирк": 2, "конфликт": 2, "виноват": 2, "осадок": 2,
    "перестал": 2, "тонет": 2, "не смог": 1, "не могу": 2, "надоел": 2, "устал": 2,
    "плохо": 2, "хуже": 2, "сложн": 1, "проблем": 1, "жалоб": 1, "ушёл": 1, "уход": 1,
    "переработ": 2, "задержива": 1, "срочно": 1, "сдвига": 1, "переделыва": 2,
    "не меня": 1, "обещали": 1, "перестали": 1, "потолок": 2, "нет вообще": 2,
    "никто": 1, "ничего": 1, "не знаешь": 1, "в стол": 2, "бессмысл": 3, "смысл": 1,
    "молчал": 1, "накопилось": 2, "не хочу": 1, "нет": 0.5, "никогда": 1, "вручную": 1,
    "не понимает": 2, "не видел": 1, "разбор": 1, "при всех": 2, "группировк": 2,
}
POSITIVE = {
    "нравится": 3, "спасибо": 3, "отличн": 3, "классн": 2, "хорош": 2, "ценно": 2,
    "плюс": 2, "помога": 2, "друз": 2, "сильн": 1, "научил": 2, "свобод": 2,
    "прикрыва": 2, "без вопросов": 1, "нормальн": 1, "остался": 1, "вернул": 1,
    "подумал": 0.5, "люб": 1, "уваж": 2, "рад": 2, "прикольн": 1, "здорово": 2,
}
# маркеры того, что человек говорит о переживании, а не о факте
FEELING = ("чувств", "честно", "серьёзно", "надоел", "устал", "невыносим", "как на войн",
           "осадок", "терпел", "не хочу", "хочется", "смысл", "нравится", "спасибо",
           "рад", "боль", "обид", "страшно", "ад")


def _hit(key: str, low: str) -> bool:
    """Короткие маркеры («ад», «нет») ищем как слова, основы — как подстроки."""
    if len(key) <= 4 and " " not in key:
        return re.search(rf"(?<![а-яё]){key}(?![а-яё])", low) is not None
    return key in low


def _score(text: str) -> tuple[float, float, list[str]]:
    low = text.lower()
    neg = sum(w for k, w in NEGATIVE.items() if _hit(k, low))
    pos = sum(w for k, w in POSITIVE.items() if _hit(k, low))
    total = neg + pos
    if total == 0:
        return 0.0, 0.0, []
    score = (pos - neg) / (total + 2.0)          # +2 сглаживает единичные слова
    feeling = sum(1 for f in FEELING if f in low)
    markers = [k for k in NEGATIVE if _hit(k, low)][:4] + [k for k in POSITIVE if _hit(k, low)][:4]
    return round(max(-1.0, min(1.0, score)), 2), min(1.0, feeling / 3), markers


def timeline(utts: list[Utterance]) -> list[dict]:
    """Точка на графике за каждую реплику сотрудника."""
    points = []
    for u in utts:
        if u.speaker == "interviewer":
            continue
        score, feeling, markers = _score(u.text)
        points.append({
            "idx": u.idx,
            "score": score,
            "feeling": feeling,           # 0 — говорит о фактах, 1 — о переживаниях
            "markers": markers,
            "snippet": re.sub(r"\s+", " ", u.text)[:90],
        })
    return points


def summary(points: list[dict]) -> dict:
    if not points:
        return {"mean": 0.0, "min": 0.0, "min_idx": None, "trend": "ровный"}
    scores = [p["score"] for p in points]
    mean = round(sum(scores) / len(scores), 2)
    low = min(points, key=lambda p: p["score"])
    half = max(1, len(scores) // 2)
    first, second = sum(scores[:half]) / half, sum(scores[half:]) / max(1, len(scores) - half)
    trend = "теплеет к концу" if second - first > 0.15 else "остывает к концу" if first - second > 0.15 else "ровный"
    return {"mean": mean, "min": low["score"], "min_idx": low["idx"], "trend": trend}
