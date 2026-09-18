"""LLM-клиент: нативный Ollama (/api/chat) или любой OpenAI-совместимый API
(/chat/completions) — автодетект по базовому URL, переопределение через
APP_LLM_PROVIDER. Всё на requests, без SDK.
"""
from __future__ import annotations

import time

import requests

from ..config import settings


def provider() -> str:
    if settings.llm_provider:
        return settings.llm_provider
    url = settings.llm_base_url.lower()
    if "11434" in url or "api.ollama.com" in url or "ollama" in url:
        return "ollama"
    return "openai"


_avail_cache: tuple[float, bool, str] | None = None


def _probe() -> tuple[bool, str]:
    """Проверка подключения. Возвращает (доступна, причина недоступности)."""
    timeout = 10 if settings.llm_base_url.startswith("https") else 3
    try:
        if provider() == "ollama":
            base = settings.llm_base_url.rstrip("/").removesuffix("/v1")
            r = requests.get(f"{base}/api/tags", timeout=timeout, headers=_auth_headers())
        else:
            r = requests.get(f"{settings.llm_base_url.rstrip('/')}/models", timeout=timeout,
                             headers=_auth_headers())
        # проверку ключа делаем до «мягкого» правила <500, иначе 401 сойдёт за успех
        if r.status_code in (401, 403):
            return False, ("ключ отклонён сервисом — проверьте APP_LLM_API_KEY"
                           if settings.llm_api_key else
                           "сервис требует ключ, а APP_LLM_API_KEY не задан")
        if r.status_code == 200 or (provider() == "openai" and r.status_code < 500):
            return True, ""
        return False, f"сервис ответил кодом {r.status_code}"
    except requests.Timeout:
        return False, "сервис не ответил вовремя"
    except requests.RequestException as e:
        return False, f"нет соединения: {type(e).__name__}"


def llm_available() -> bool:
    """Быстрая проверка доступности (кэш 60 сек), чтобы UI и фоллбэки не ждали таймаут."""
    global _avail_cache
    now = time.monotonic()
    if _avail_cache and now - _avail_cache[0] < 60:
        return _avail_cache[1]
    ok, reason = _probe()
    _avail_cache = (now, ok, reason)
    return ok


def last_error() -> str:
    """Причина, по которой модель недоступна — показывается в /api/health."""
    llm_available()
    return _avail_cache[2] if _avail_cache else ""


def endpoint() -> str:
    """Адрес подключения без ключа — для диагностики."""
    return settings.llm_base_url


def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {settings.llm_api_key}"} if settings.llm_api_key else {}


def chat(messages: list[dict], temperature: float = 0.2, max_tokens: int = 2000,
         model: str | None = None) -> str:
    """model — переопределение модели на один вызов: переключатель в интерфейсе
    позволяет прогнать один и тот же текст через разные модели Ollama."""
    model = model or settings.llm_model
    if provider() == "ollama":
        return _chat_ollama(messages, temperature, max_tokens, model)
    return _chat_openai(messages, temperature, max_tokens, model)


def list_models() -> list[str]:
    """Модели, доступные у провайдера. Для Ollama — то, что скачано локально."""
    try:
        if provider() == "ollama":
            base = settings.llm_base_url.rstrip("/").removesuffix("/v1")
            r = requests.get(f"{base}/api/tags", timeout=3, headers=_auth_headers())
            r.raise_for_status()
            names = [m["name"] for m in r.json().get("models", [])]
        else:
            r = requests.get(f"{settings.llm_base_url.rstrip('/')}/models", timeout=5,
                             headers=_auth_headers())
            r.raise_for_status()
            names = [m["id"] for m in r.json().get("data", [])]
    except Exception:
        names = []
    if settings.llm_model not in names:
        names.insert(0, settings.llm_model)
    return names


def _chat_ollama(messages, temperature, max_tokens, model) -> str:
    base = settings.llm_base_url.rstrip("/").removesuffix("/v1")
    resp = requests.post(
        f"{base}/api/chat",
        json={
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        },
        headers=_auth_headers(),
        timeout=settings.llm_timeout,
    )
    resp.raise_for_status()
    return resp.json()["message"]["content"]


def _chat_openai(messages, temperature, max_tokens, model) -> str:
    resp = requests.post(
        f"{settings.llm_base_url.rstrip('/')}/chat/completions",
        json={
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        },
        headers={"Content-Type": "application/json", **_auth_headers()},
        timeout=settings.llm_timeout,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"] or ""
