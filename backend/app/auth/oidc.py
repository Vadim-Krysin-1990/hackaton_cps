"""Вход через OIDC-провайдера (Keycloak и совместимые).

Зачем в заготовке: требования по безопасности есть почти на каждом хакатоне,
и «у нас свой логин с паролем в SQLite» там выглядит слабо. Keycloak закрывает
вопрос типовым способом: единый вход, роли на стороне провайдера, отзыв доступа
без правок кода.

Как устроено:
  * Authorization Code Flow с PKCE — секрет клиента не обязателен;
  * id_token проверяется по JWKS провайдера (подпись, срок, issuer, audience) —
    без валидации подписи вход подделывается подбором тела токена;
  * роли берутся из realm_access.roles и маппятся в роли приложения;
  * пользователь заводится в локальной базе при первом входе, дальше живёт
    обычная cookie-сессия — остальной код о OIDC ничего не знает.

Выключено по умолчанию (APP_OIDC_ENABLED=false): демо обязано подниматься и без
внешнего сервиса. Включайте, когда Keycloak поднят, — локальный вход при этом
можно оставить запасным путём (APP_LOCAL_LOGIN_ENABLED).
"""
from __future__ import annotations

import base64
import hashlib
import secrets
import time
from typing import Any

import requests

from ..config import settings

_meta_cache: tuple[float, dict] | None = None
_jwks_cache: tuple[float, dict] | None = None
_CACHE_TTL = 600


class OidcError(RuntimeError):
    """Провайдер недоступен или ответил отказом — показывается пользователю."""


def enabled() -> bool:
    return bool(settings.oidc_enabled and settings.oidc_issuer and settings.oidc_client_id)


def _discovery_url() -> str:
    return settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration"


def metadata() -> dict:
    """Конфигурация провайдера. Кэш на 10 минут: Keycloak на слабой машине
    поднимается долго, дёргать discovery на каждый вход незачем."""
    global _meta_cache
    now = time.monotonic()
    if _meta_cache and now - _meta_cache[0] < _CACHE_TTL:
        return _meta_cache[1]
    try:
        r = requests.get(_discovery_url(), timeout=settings.oidc_timeout)
        r.raise_for_status()
    except requests.RequestException as e:
        raise OidcError(f"Провайдер недоступен: {type(e).__name__}") from e
    meta = r.json()
    _meta_cache = (now, meta)
    return meta


def _jwks() -> dict:
    global _jwks_cache
    now = time.monotonic()
    if _jwks_cache and now - _jwks_cache[0] < _CACHE_TTL:
        return _jwks_cache[1]
    try:
        r = requests.get(metadata()["jwks_uri"], timeout=settings.oidc_timeout)
        r.raise_for_status()
    except requests.RequestException as e:
        raise OidcError(f"Не удалось получить ключи провайдера: {type(e).__name__}") from e
    jwks = r.json()
    _jwks_cache = (now, jwks)
    return jwks


def make_pkce() -> tuple[str, str]:
    """(verifier, challenge) по S256."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).decode().rstrip("=")
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return verifier, challenge


def authorization_url(state: str, challenge: str) -> str:
    from urllib.parse import urlencode

    params = {
        "client_id": settings.oidc_client_id,
        "response_type": "code",
        "scope": settings.oidc_scope,
        "redirect_uri": settings.oidc_redirect_url,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return f"{metadata()['authorization_endpoint']}?{urlencode(params)}"


def exchange_code(code: str, verifier: str) -> dict:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.oidc_redirect_url,
        "client_id": settings.oidc_client_id,
        "code_verifier": verifier,
    }
    if settings.oidc_client_secret:
        data["client_secret"] = settings.oidc_client_secret
    try:
        r = requests.post(metadata()["token_endpoint"], data=data, timeout=settings.oidc_timeout)
    except requests.RequestException as e:
        raise OidcError(f"Провайдер не ответил на обмен кода: {type(e).__name__}") from e
    if r.status_code != 200:
        raise OidcError(f"Провайдер отклонил код авторизации (HTTP {r.status_code})")
    return r.json()


def verify_id_token(id_token: str) -> dict:
    """Проверка подписи и обязательных полей. Без неё токен можно подделать."""
    try:
        import jwt
        from jwt import PyJWKClient
    except ImportError as e:  # pragma: no cover — зависимость есть в requirements.txt
        raise OidcError("Не установлен пакет PyJWT — поставьте backend/requirements.txt") from e

    try:
        signing_key = PyJWKClient(metadata()["jwks_uri"]).get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=settings.oidc_algorithms.split(","),
            audience=settings.oidc_client_id,
            issuer=metadata()["issuer"],
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except Exception as e:  # истёк, чужая подпись, не тот issuer — вход не даём
        raise OidcError(f"Токен не прошёл проверку: {type(e).__name__}: {e}") from e
    return claims


def map_role(claims: dict[str, Any]) -> str:
    """Роль провайдера -> роль приложения.

    Соответствие задаётся APP_OIDC_ROLE_MAP («kc-роль:роль-приложения» через
    запятую). Если совпадений нет — APP_OIDC_DEFAULT_ROLE: пускаем с минимальными
    правами, а не отказываем, иначе демо встанет из-за опечатки в realm.
    """
    provider_roles = set(claims.get("realm_access", {}).get("roles", []))
    resource = claims.get("resource_access", {}).get(settings.oidc_client_id, {})
    provider_roles |= set(resource.get("roles", []))

    for pair in settings.oidc_role_map.split(","):
        if ":" not in pair:
            continue
        kc_role, app_role = (p.strip() for p in pair.split(":", 1))
        if kc_role and kc_role in provider_roles:
            return app_role
    return settings.oidc_default_role


def user_fields(claims: dict[str, Any]) -> dict[str, str]:
    """Что берём из токена для локальной учётной записи."""
    username = (claims.get("preferred_username") or claims.get("email")
                or f"oidc-{claims['sub'][:12]}")
    full_name = (claims.get("name") or " ".join(
        filter(None, [claims.get("given_name"), claims.get("family_name")]))).strip()
    return {
        "username": username.lower()[:64],
        "full_name": (full_name or username)[:128],
        "role": map_role(claims),
        "subject": claims["sub"],
    }
