"""Тесты гоняются на отдельной базе во временной папке — рабочие данные
не трогаются. Запуск: APP_DATA_DIR=/tmp/app-test pytest backend/tests -q
"""
from __future__ import annotations

import os
import shutil
import tempfile

import pytest

TEST_DIR = tempfile.mkdtemp(prefix="hackathon-test-")
os.environ["APP_DATA_DIR"] = TEST_DIR
os.environ["APP_DATABASE_URL"] = ""
os.environ["APP_SECRET_KEY"] = "test-secret"
os.environ["APP_LLM_BASE_URL"] = "http://127.0.0.1:1"  # заведомо недоступна: проверяем фоллбэк


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
    shutil.rmtree(TEST_DIR, ignore_errors=True)


@pytest.fixture(scope="session")
def logged(client):
    from app.seed import DEMO_PASSWORD

    r = client.post("/api/auth/login", json={"username": "ana", "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return client
