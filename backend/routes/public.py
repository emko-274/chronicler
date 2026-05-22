import secrets
from typing import Dict, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import PublicLink, ActivityLog, Note, PrivateCategory, HiddenCategory, User
from auth import get_current_user

router = APIRouter()


class LinkSettings(BaseModel):
    include_notes: Optional[bool] = None
    colors: Optional[Dict[str, str]] = None


@router.post("/link")
def generate_link(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    existing = db.query(PublicLink).filter(PublicLink.owner_id == current_user.id).first()
    if existing:
        token = existing.token
    else:
        token = secrets.token_urlsafe(12)
        db.add(PublicLink(token=token, owner_id=current_user.id))
        db.commit()
    return {"token": token}


@router.patch("/link")
def update_link_settings(settings: LinkSettings, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    link = db.query(PublicLink).filter(PublicLink.owner_id == current_user.id).first()
    if not link:
        raise HTTPException(status_code=404, detail="No public link")
    if settings.include_notes is not None:
        link.include_notes = settings.include_notes
    if settings.colors is not None:
        link.colors = settings.colors
    db.commit()
    return {"include_notes": link.include_notes, "colors": link.colors or {}}


@router.delete("/link")
def revoke_link(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(PublicLink).filter(PublicLink.owner_id == current_user.id).delete()
    db.commit()
    return {"revoked": True}


@router.get("/link")
def get_link(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    link = db.query(PublicLink).filter(PublicLink.owner_id == current_user.id).first()
    return {"token": link.token if link else None, "include_notes": link.include_notes if link else False}


@router.get("/{token}/info")
def public_info(token: str, db: Session = Depends(get_db)):
    link = db.query(PublicLink).filter(PublicLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    owner = db.query(User).filter(User.id == link.owner_id).first()
    return {"name": owner.name, "include_notes": link.include_notes, "colors": link.colors or {}}


@router.get("/{token}/notes")
def public_notes(token: str, db: Session = Depends(get_db)):
    link = db.query(PublicLink).filter(PublicLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    if not link.include_notes:
        raise HTTPException(status_code=403, detail="Notes not shared")
    notes = db.query(Note).filter(Note.user_id == link.owner_id).order_by(Note.date.desc()).all()
    for n in notes:
        n.id = str(n.id)
        n.user_id = str(n.user_id)
    return notes


@router.get("/{token}/logs")
def public_logs(token: str, db: Session = Depends(get_db)):
    link = db.query(PublicLink).filter(PublicLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    excluded = (
        {p.name for p in db.query(PrivateCategory).filter(PrivateCategory.user_id == link.owner_id).all()}
        | {h.name for h in db.query(HiddenCategory).filter(HiddenCategory.user_id == link.owner_id).all()}
    )
    query = db.query(ActivityLog).filter(ActivityLog.user_id == link.owner_id)
    if excluded:
        query = query.filter(ActivityLog.activity_type.notin_(excluded))
    results = query.order_by(ActivityLog.started_at.desc()).limit(500).all()
    for log in results:
        log.id = str(log.id)
    return results
