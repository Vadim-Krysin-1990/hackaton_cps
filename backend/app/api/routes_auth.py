from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import oidc
from ..config import settings
from ..db import get_db
from ..llm.prompts import ROLE_LABELS
from ..models import User
from ..security import (SESSION_COOKIE, make_session_token, make_state_token,
                        state_serializer, verify_password)
from .deps import audit, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

# Промежуточное состояние между переходом к провайдеру и возвратом.
# Лежит в подписанной cookie, а не в памяти процесса: переживает перезапуск
# и не ломается при нескольких рабочих процессах.
STATE_COOKIE = "app_oidc_state"


class LoginRequest(BaseModel):
    username: str
    password: str


def _user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "role_label": ROLE_LABELS.get(user.role, user.role),
        "via": "oidc" if user.oidc_subject else "local",
    }


def _set_session(response: Response, user: User) -> None:
    response.set_cookie(
        SESSION_COOKIE, make_session_token(user.id),
        httponly=True, samesite="lax", max_age=settings.session_max_age, path="/",
    )


@router.get("/config")
def auth_config():
    """Какие способы входа доступны — интерфейс рисует форму по этому ответу."""
    return {
        "local_login": settings.local_login_enabled,
        "oidc": oidc.enabled(),
        "oidc_label": "Войти через Keycloak",
    }


@router.post("/login")
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    if not settings.local_login_enabled:
        raise HTTPException(status_code=403, detail="Вход по паролю отключён, используйте единый вход")
    user = db.query(User).filter(User.username == body.username.strip().lower()).one_or_none()
    if user is None or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    _set_session(response, user)
    audit(db, user, "login", {"via": "local"})
    return _user_payload(user)


@router.get("/oidc/login")
def oidc_login():
    """Шаг 1: уводим пользователя к провайдеру. state и PKCE-verifier кладём
    в подписанную cookie и сверяем на возврате — защита от подмены ответа."""
    if not oidc.enabled():
        raise HTTPException(status_code=404, detail="Единый вход не настроен")
    try:
        verifier, challenge = oidc.make_pkce()
        state = make_state_token()
        url = oidc.authorization_url(state, challenge)
    except oidc.OidcError as e:
        raise HTTPException(status_code=502, detail=str(e))

    response = RedirectResponse(url, status_code=302)
    response.set_cookie(
        STATE_COOKIE, state_serializer.dumps({"state": state, "verifier": verifier}),
        httponly=True, samesite="lax", max_age=600, path="/",
    )
    return response


@router.get("/oidc/callback")
def oidc_callback(request: Request, code: str = "", state: str = "", error: str = "",
                  db: Session = Depends(get_db)):
    """Шаг 2: возврат от провайдера. Проверяем state, меняем код на токены,
    проверяем подпись id_token, заводим/обновляем пользователя."""
    if not oidc.enabled():
        raise HTTPException(status_code=404, detail="Единый вход не настроен")
    if error:
        raise HTTPException(status_code=401, detail=f"Провайдер отказал во входе: {error}")

    raw = request.cookies.get(STATE_COOKIE)
    if not raw:
        raise HTTPException(status_code=400, detail="Сессия входа истекла, начните заново")
    try:
        saved = state_serializer.loads(raw, max_age=600)
    except Exception:
        raise HTTPException(status_code=400, detail="Не удалось проверить состояние входа")
    if not code or not state or state != saved.get("state"):
        raise HTTPException(status_code=400, detail="Состояние входа не совпало")

    try:
        tokens = oidc.exchange_code(code, saved["verifier"])
        claims = oidc.verify_id_token(tokens["id_token"])
    except oidc.OidcError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except KeyError:
        raise HTTPException(status_code=502, detail="Провайдер не вернул id_token")

    fields = oidc.user_fields(claims)
    user = db.query(User).filter(User.oidc_subject == fields["subject"]).one_or_none()
    if user is None:
        # тот же человек мог уже входить локально — связываем учётные записи
        user = db.query(User).filter(User.username == fields["username"]).one_or_none()
    if user is None:
        user = User(username=fields["username"], password_hash="")
        db.add(user)
    user.oidc_subject = fields["subject"]
    user.full_name = fields["full_name"]
    user.role = fields["role"]  # роль ведётся в Keycloak, локально не правится
    db.commit()

    response = RedirectResponse("/", status_code=302)
    _set_session(response, user)
    response.delete_cookie(STATE_COOKIE, path="/")
    audit(db, user, "login", {"via": "oidc", "role": user.role})
    return response


@router.post("/logout")
def logout(response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    response.delete_cookie(SESSION_COOKIE, path="/")
    audit(db, user, "logout", {})
    # Выход из самого Keycloak — отдельный адрес: сессия провайдера живёт дольше
    # нашей, и без этого следующий вход пройдёт молча, под тем же пользователем.
    end_session = ""
    if user.oidc_subject and oidc.enabled():
        try:
            end_session = oidc.metadata().get("end_session_endpoint", "")
            if end_session:
                from urllib.parse import urlencode
                end_session += "?" + urlencode({
                    "client_id": settings.oidc_client_id,
                    "post_logout_redirect_uri": settings.oidc_post_logout_url,
                })
        except oidc.OidcError:
            end_session = ""
    return {"ok": True, "end_session_url": end_session}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return _user_payload(user)
