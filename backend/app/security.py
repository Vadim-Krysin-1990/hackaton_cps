"""Пароли (PBKDF2, stdlib) и подписанные cookie-сессии (itsdangerous).
Заготовка: без LDAP/SSO, роли задаются при создании пользователя. Для боевого
контура это место переписывается первым.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets

from itsdangerous import BadSignature, URLSafeTimedSerializer

from .config import settings

_ITERATIONS = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITERATIONS).hex()
    return f"pbkdf2${_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt, digest = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters)).hex()
        return hmac.compare_digest(calc, digest)
    except (ValueError, TypeError):
        return False


_serializer = URLSafeTimedSerializer(settings.secret_key, salt="app-session")

# Отдельная соль для промежуточного состояния входа через OIDC: подписанное
# значение одного назначения не должно приниматься в другом.
state_serializer = URLSafeTimedSerializer(settings.secret_key, salt="app-oidc-state")

SESSION_COOKIE = "app_session"


def make_state_token() -> str:
    """Одноразовая метка запроса авторизации (параметр state)."""
    return secrets.token_urlsafe(24)


def make_session_token(user_id: int) -> str:
    return _serializer.dumps({"uid": user_id})


def read_session_token(token: str) -> int | None:
    try:
        data = _serializer.loads(token, max_age=settings.session_max_age)
        return int(data["uid"])
    except (BadSignature, KeyError, ValueError):
        return None
