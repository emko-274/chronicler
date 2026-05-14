from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import uuid

from database import get_db
from models import Note, ActivityLog, User
from auth import get_current_user

router = APIRouter()


class NoteCreate(BaseModel):
    note_type: str
    date: Optional[str] = None
    content: str = ""
    linked_log_ids: list[str] = []


class NoteUpdate(BaseModel):
    content: Optional[str] = None
    linked_log_ids: Optional[list[str]] = None


def _serialize_log(log: ActivityLog) -> dict:
    return {
        "id": str(log.id),
        "activity_type": log.activity_type,
        "started_at": log.started_at.isoformat(),
        "ended_at": log.ended_at.isoformat() if log.ended_at else None,
        "duration_minutes": log.duration_minutes,
        "notes": log.notes,
        "extra_data": log.extra_data,
    }


def _serialize(note: Note, db: Session, user_id=None) -> dict:
    linked_logs = []
    if note.linked_log_ids:
        ids = [uuid.UUID(lid) for lid in note.linked_log_ids if lid]
        q = db.query(ActivityLog).filter(ActivityLog.id.in_(ids))
        if user_id:
            q = q.filter(ActivityLog.user_id == user_id)
        linked_logs = [_serialize_log(l) for l in q.all()]
    return {
        "id": str(note.id),
        "note_type": note.note_type,
        "date": note.date,
        "content": note.content,
        "linked_log_ids": note.linked_log_ids or [],
        "linked_logs": linked_logs,
        "created_at": note.created_at.isoformat(),
        "updated_at": note.updated_at.isoformat(),
    }


@router.get("/")
def list_notes(
    note_type: Optional[str] = None,
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Note).filter(Note.user_id == current_user.id)
    if note_type:
        q = q.filter(Note.note_type == note_type)
    if date:
        q = q.filter(Note.date == date)
    return [_serialize(n, db, current_user.id) for n in q.order_by(Note.updated_at.desc()).all()]


@router.get("/daily/{date}/logs")
def get_daily_logs(
    date: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import cast
    from sqlalchemy.dialects.postgresql import DATE
    logs = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.user_id == current_user.id,
            cast(ActivityLog.started_at, DATE) == date,
        )
        .order_by(ActivityLog.started_at)
        .all()
    )
    return [_serialize_log(l) for l in logs]


@router.post("/")
def create_note(
    body: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = Note(
        user_id=current_user.id,
        note_type=body.note_type,
        date=body.date,
        content=body.content,
        linked_log_ids=body.linked_log_ids,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _serialize(note, db, current_user.id)


@router.put("/{note_id}")
def update_note(
    note_id: str,
    body: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = db.query(Note).filter(
        Note.id == uuid.UUID(note_id),
        Note.user_id == current_user.id,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if body.content is not None:
        note.content = body.content
    if body.linked_log_ids is not None:
        note.linked_log_ids = body.linked_log_ids
    note.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(note)
    return _serialize(note, db, current_user.id)


@router.delete("/{note_id}")
def delete_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = db.query(Note).filter(
        Note.id == uuid.UUID(note_id),
        Note.user_id == current_user.id,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    return {"deleted": 1}
