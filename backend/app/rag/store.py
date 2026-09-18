"""Qdrant-хранилище чанков. Два режима по APP_QDRANT_URL:
пусто — встроенный (файлы в data/qdrant, сервер не нужен), url — сервер.
Payload чанка: doc_id, title, page, chunk, text — из него собирается Evidence.
"""
from __future__ import annotations

import uuid

from ..config import settings
from . import embedder

_client = None


def client():
    global _client
    if _client is None:
        from qdrant_client import QdrantClient

        if settings.qdrant_url:
            _client = QdrantClient(url=settings.qdrant_url)
        else:
            _client = QdrantClient(path=settings.qdrant_local_path)
    return _client


def ensure_collection() -> None:
    from qdrant_client.models import Distance, VectorParams

    c = client()
    name = settings.qdrant_collection
    if c.collection_exists(name):
        info = c.get_collection(name)
        current_dim = info.config.params.vectors.size
        if current_dim != embedder.dim():
            c.delete_collection(name)
        else:
            return
    c.create_collection(
        collection_name=name,
        vectors_config=VectorParams(size=embedder.dim(), distance=Distance.COSINE),
    )


def delete_document(doc_id: int) -> None:
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    if not client().collection_exists(settings.qdrant_collection):
        return
    client().delete(
        collection_name=settings.qdrant_collection,
        points_selector=Filter(must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))]),
    )


def upsert_chunks(doc_id: int, title: str, chunks: list[dict],
                  category: str = "", source_url: str | None = None) -> int:
    from qdrant_client.models import PointStruct

    if not chunks:
        return 0
    ensure_collection()
    vectors = embedder.embed_passages([c["text"] for c in chunks])
    points = [
        PointStruct(
            id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"doc/{doc_id}/{i}")),
            vector=v,
            payload={"doc_id": doc_id, "title": title, "page": c.get("page"), "chunk": i,
                     "text": c["text"], "category": category, "source_url": source_url},
        )
        for i, (c, v) in enumerate(zip(chunks, vectors))
    ]
    client().upsert(collection_name=settings.qdrant_collection, points=points)
    return len(points)


def search(query: str, k: int = 4, category: str = "") -> list[dict]:
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    if not client().collection_exists(settings.qdrant_collection):
        return []
    vec = embedder.embed_query(query)
    flt = (Filter(must=[FieldCondition(key="category", match=MatchValue(value=category))])
           if category else None)
    hits = client().query_points(
        collection_name=settings.qdrant_collection, query=vec, limit=k, query_filter=flt
    ).points
    return [{"score": round(h.score, 3), **(h.payload or {})} for h in hits]


def count_points() -> int:
    if not client().collection_exists(settings.qdrant_collection):
        return 0
    return client().count(collection_name=settings.qdrant_collection, exact=True).count
