"""Разбиение постраничного текста на чанки для векторного индекса."""
from __future__ import annotations

import re

MAX_CHARS = 900
OVERLAP = 150


def _split_long(text: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?;])\s+", text)
    parts, buf = [], ""
    for s in sentences:
        if len(buf) + len(s) + 1 > MAX_CHARS and buf:
            parts.append(buf.strip())
            buf = buf[-OVERLAP:] + " " + s
        else:
            buf = (buf + " " + s).strip()
    if buf.strip():
        parts.append(buf.strip())
    return parts


def chunk_pages(pages: list[tuple[int, str]]) -> list[dict]:
    """[(page, text)] -> [{"text": ..., "page": ...}], чанк не пересекает границу страницы."""
    chunks: list[dict] = []
    for page_no, text in pages:
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
        buf = ""
        for p in paragraphs:
            p = re.sub(r"\s+", " ", p)
            if len(buf) + len(p) + 1 <= MAX_CHARS:
                buf = (buf + "\n" + p).strip()
                continue
            if buf:
                chunks.append({"text": buf, "page": page_no})
            buf = ""
            if len(p) > MAX_CHARS:
                for part in _split_long(p):
                    chunks.append({"text": part, "page": page_no})
            else:
                buf = p
        if buf:
            chunks.append({"text": buf, "page": page_no})
    return [c for c in chunks if len(c["text"]) > 40]
