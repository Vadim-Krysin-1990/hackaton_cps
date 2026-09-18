"""Дымовые тесты каркаса: вход, загрузка датасета, просмотр, чат без модели,
журнал и метрика. Держите их зелёными — это страховка перед сдачей.
"""
from __future__ import annotations

import io

import pandas as pd


def test_health_open(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["db"] is True
    assert body["llm_available"] is False  # модель намеренно недоступна в тестах


def test_auth_required(client):
    assert client.get("/api/records").status_code == 401


def test_login_bad_password(client):
    r = client.post("/api/auth/login", json={"username": "ana", "password": "неверный"})
    assert r.status_code == 401


def test_me(logged):
    body = logged.get("/api/auth/me").json()
    assert body["username"] == "ana"
    assert body["role_label"]


def _make_xlsx() -> bytes:
    df = pd.DataFrame({
        "Номер": [f"ID-{i}" for i in range(1, 21)],
        "Наименование": [f"Объект {i}" for i in range(1, 21)],
        "Категория": ["А", "Б"] * 10,
        "Статус": ["в работе", "завершено"] * 10,
        "Сумма, руб": [1000.5 * i for i in range(1, 21)],
    })
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return buf.getvalue()


def test_upload_and_records(logged):
    files = {"file": ("demo.xlsx", _make_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    body = logged.post("/api/uploads", files=files).json()
    assert body["status"] == "done"
    assert body["rows_total"] == 20
    assert body["records_new"] == 20
    # роли распознаны по заголовкам
    roles = body["quality"]["roles"]
    assert roles["key"] == "Номер" and roles["amount"] == "Сумма, руб"

    # повторная загрузка того же файла не плодит дубли
    body2 = logged.post("/api/uploads", files={
        "file": ("demo.xlsx", _make_xlsx(),
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}).json()
    assert body2["records_new"] == 0 and body2["records_updated"] == 20

    lst = logged.get("/api/records", params={"q": "Объект 3"}).json()
    assert lst["total"] >= 1
    rec = logged.get(f"/api/records/{lst['items'][0]['id']}").json()
    assert rec["payload"]

    facets = logged.get("/api/records/facets").json()
    assert facets["total"] == 20
    assert facets["amount_sum"] > 0


def test_upload_rejects_bad_format(logged):
    r = logged.post("/api/uploads", files={"file": ("readme.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_chat_without_llm(logged):
    """Без модели ассистент обязан отвечать фактами, а не падать."""
    r = logged.post("/api/chat", json={"message": "Что в данных по объекту 3?"})
    assert r.status_code == 200
    body = r.json()
    assert body["llm_used"] is False
    assert "Объект 3" in body["answer"] or "ЗАПИСИ" in body["answer"]
    assert logged.get("/api/chat/history").json()


def test_artifact_fallback(logged):
    r = logged.post("/api/artifacts", json={"kind": "summary"})
    assert r.status_code == 200
    assert "[указать]" in r.json()["text"]
    docx = logged.post("/api/artifacts/docx", json={"title": "Справка", "text": "Текст"})
    assert docx.status_code == 200
    assert len(docx.content) > 1000


def test_audit_and_metrics(logged):
    stats = logged.get("/api/audit/stats").json()
    actions = {a["action"] for a in stats["by_action"]}
    assert {"login", "upload_dataset", "chat"} <= actions

    journal = logged.get("/api/audit", params={"action": "chat"}).json()
    assert journal["total"] >= 1
    assert journal["items"][0]["duration_ms"] is not None  # длительность замеряется

    m = logged.get("/api/metrics").json()
    assert m["manual_minutes"] > 0
    assert any(o["action"] == "chat" for o in m["operations"])


def test_auth_config_without_oidc(client):
    """По умолчанию единый вход выключен — демо поднимается без Keycloak."""
    cfg = client.get("/api/auth/config").json()
    assert cfg["local_login"] is True
    assert cfg["oidc"] is False


def test_oidc_routes_disabled(client):
    assert client.get("/api/auth/oidc/login", follow_redirects=False).status_code == 404
    assert client.get("/api/auth/oidc/callback", params={"code": "x", "state": "y"}).status_code == 404


def test_role_mapping():
    """Роль Keycloak -> роль приложения, и безопасный запасной вариант."""
    from app.auth import oidc

    assert oidc.map_role({"realm_access": {"roles": ["app-leader", "offline_access"]}}) == "leader"
    assert oidc.map_role({"realm_access": {"roles": ["app-analyst"]}}) == "analyst"
    # незнакомая роль не пускает с повышенными правами и не ломает вход
    assert oidc.map_role({"realm_access": {"roles": ["нечто"]}}) == "analyst"


def test_oidc_user_fields():
    from app.auth import oidc

    fields = oidc.user_fields({
        "sub": "abc-123", "preferred_username": "Иванов",
        "given_name": "Иван", "family_name": "Иванов",
        "realm_access": {"roles": ["app-expert"]},
    })
    assert fields["username"] == "иванов"
    assert fields["full_name"] == "Иван Иванов"
    assert fields["role"] == "expert"
    assert fields["subject"] == "abc-123"


def test_pkce_pair():
    from app.auth import oidc

    verifier, challenge = oidc.make_pkce()
    assert 43 <= len(verifier) <= 128
    assert challenge and challenge != verifier
    assert "=" not in challenge  # base64url без набивки, как требует RFC 7636
