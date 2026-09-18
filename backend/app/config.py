"""Конфигурация приложения. Все значения переопределяются через env (префикс APP_)
или файл .env в корне проекта.

Заготовка работает без внешних сервисов: SQLite вместо PostgreSQL, встроенный
Qdrant (папка data/qdrant) вместо сервера, hash-фоллбэк вместо sentence-transformers,
фактические ответы вместо LLM. Это осознанный принцип: на хакатоне демо обязано
подняться на чужой машине без интернета и без GPU.
"""
from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=(PROJECT_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Бренд: меняется под конкретный хакатон одной правкой .env ---
    # Явные alias-ы: иначе из-за префикса APP_ переменные назывались бы
    # APP_APP_TITLE и APP_APP_SUBTITLE.
    app_title: str = Field("ИИ-помощник", validation_alias="APP_TITLE")
    app_subtitle: str = Field("демонстрационный контур", validation_alias="APP_SUBTITLE")
    brand_color: str = "#0079c2"

    secret_key: str = "dev-secret-change-me"
    session_max_age: int = 12 * 3600

    # --- Вход через Keycloak (OIDC) ---
    # Выключено по умолчанию: заготовка обязана подниматься без внешних сервисов.
    # Включайте, когда Keycloak поднят, — требования по безопасности на хакатонах
    # закрываются именно этим, а не самописной проверкой пароля.
    oidc_enabled: bool = False
    # Локальный вход логином и паролем. Держите включённым как запасной путь:
    # если на защите Keycloak не поднимется, демо не должно умереть вместе с ним.
    local_login_enabled: bool = True
    oidc_issuer: str = ""          # http://localhost:8080/realms/hackathon
    oidc_client_id: str = "app"
    oidc_client_secret: str = ""   # пусто для public-клиента с PKCE
    oidc_redirect_url: str = "http://localhost:8000/api/auth/oidc/callback"
    oidc_post_logout_url: str = "http://localhost:8000/login"
    oidc_scope: str = "openid profile email"
    oidc_algorithms: str = "RS256"
    oidc_timeout: int = 10
    # «роль в Keycloak:роль в приложении», первое совпадение выигрывает
    oidc_role_map: str = "app-leader:leader,app-expert:expert,app-analyst:analyst"
    oidc_default_role: str = "analyst"

    data_dir: str = str(PROJECT_ROOT / "data")
    database_url: str = ""

    # --- RAG ---
    qdrant_url: str = ""
    qdrant_collection: str = "docs"
    embed_model: str = "intfloat/multilingual-e5-small"
    embed_fallback_dim: int = 384

    # --- Языковая модель ---
    llm_base_url: str = "http://localhost:11434"
    llm_model: str = "qwen2.5:7b-instruct"
    llm_api_key: str = ""
    llm_provider: str = ""  # "" = автодетект, иначе openai|ollama
    llm_timeout: int = 180
    # Список моделей для переключателя в интерфейсе (через запятую). Пусто —
    # берётся то, что отдаёт провайдер; в облаке там есть и платные модели.
    llm_models: str = ""

    # --- Метрика «было/стало»: сколько минут задача занимает у человека вручную ---
    baseline_manual_minutes: int = 120

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    frontend_dist: str = str(PROJECT_ROOT / "frontend" / "dist")

    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def uploads_path(self) -> Path:
        p = self.data_path / "uploads"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def docs_path(self) -> Path:
        p = self.data_path / "docs"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def effective_database_url(self) -> str:
        return self.database_url or f"sqlite:///{self.data_path / 'app.db'}"

    @property
    def qdrant_local_path(self) -> str:
        return str(self.data_path / "qdrant")


settings = Settings()
