from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import (routes_artifacts, routes_auth, routes_chat, routes_documents,
                  routes_interviews, routes_misc, routes_records, routes_uploads)
from .config import settings
from .db import SessionLocal, init_db
from .seed import ensure_demo_users


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as db:
        ensure_demo_users(db)
    yield


app = FastAPI(title=settings.app_title, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (routes_auth, routes_uploads, routes_documents, routes_records,
          routes_chat, routes_artifacts, routes_interviews, routes_misc):
    app.include_router(r.router, prefix="/api")

# Прод-режим: собранный SPA лежит в frontend/dist и раздаётся этим же процессом
# (nginx сверху занимается только TLS/проксированием).
_dist = Path(settings.frontend_dist)
if (_dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = (_dist / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(_dist.resolve()):
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
