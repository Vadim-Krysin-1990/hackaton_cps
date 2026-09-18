"""Эмбеддинги: sentence-transformers (multilingual-e5), а при недоступности
модели (нет пакета/нет сети) — детерминированный hash-фоллбэк, чтобы весь
контур работал и без тяжёлых зависимостей. Имя активного эмбеддера видно
в /api/health.
"""
from __future__ import annotations

import hashlib
import math
import re

from ..config import settings

_model = None
_fallback_reason: str | None = None


def _try_load_model():
    global _model, _fallback_reason
    if _model is not None or _fallback_reason is not None:
        return
    try:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(settings.embed_model)
    except Exception as e:  # nolint — любой сбой (импорт/сеть) переводит на фоллбэк
        _fallback_reason = f"{type(e).__name__}: {e}"
        print(f"[embedder] sentence-transformers недоступен, включён hash-фоллбэк ({_fallback_reason})")


def _is_e5() -> bool:
    return "e5" in settings.embed_model.lower()


_token_re = re.compile(r"[а-яa-zё0-9]+")


def _hash_embed(text: str, dim: int) -> list[float]:
    vec = [0.0] * dim
    tokens = _token_re.findall(text.lower())
    grams = tokens + [t[i:i + 3] for t in tokens for i in range(max(1, len(t) - 2))]
    for g in grams:
        h = int(hashlib.md5(g.encode()).hexdigest()[:8], 16)
        vec[h % dim] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def name() -> str:
    _try_load_model()
    return settings.embed_model if _model is not None else "hash-fallback"


def dim() -> int:
    _try_load_model()
    if _model is not None:
        return _model.get_sentence_embedding_dimension()
    return settings.embed_fallback_dim


def embed_passages(texts: list[str]) -> list[list[float]]:
    _try_load_model()
    if _model is not None:
        if _is_e5():
            texts = [f"passage: {t}" for t in texts]
        return _model.encode(texts, normalize_embeddings=True, show_progress_bar=False).tolist()
    return [_hash_embed(t, settings.embed_fallback_dim) for t in texts]


def embed_query(text: str) -> list[float]:
    _try_load_model()
    if _model is not None:
        if _is_e5():
            text = f"query: {text}"
        return _model.encode([text], normalize_embeddings=True, show_progress_bar=False)[0].tolist()
    return _hash_embed(text, settings.embed_fallback_dim)
