from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..llm.assistant import answer_question, get_history
from ..models import User
from .deps import audit, get_current_user, timed

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str


@router.post("")
def ask(body: ChatRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question = body.message.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Пустой вопрос")
    with timed() as t:
        result = answer_question(db, user, question)
    audit(db, user, "chat", {"question": question[:200], "llm_used": result["llm_used"]},
          duration_ms=t.ms)
    return result


@router.get("/history")
def history(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_history(db, user)


@router.delete("/history")
def clear_history(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Сброс диалога: удаляет переписку текущего пользователя."""
    from ..models import ChatMessage

    removed = (
        db.query(ChatMessage).filter(ChatMessage.user_id == user.id)
        .delete(synchronize_session=False)
    )
    db.commit()
    audit(db, user, "chat_cleared", {"removed": removed})
    return {"ok": True, "removed": removed}
