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
    enabled: Optional[bool] = None
    include_notes: Optional[bool] = None
    colors: Optional[Dict[str, str]] = None


def _link_response(link: PublicLink) -> dict:
    return {
        "token": link.token,
        "enabled": link.enabled,
        "include_notes": link.include_notes,
        "colors": link.colors or {},
    }


@router.post("/link")
def enable_link(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Create the link if it doesn't exist, or re-enable it if it was disabled."""
    existing = db.query(PublicLink).filter(PublicLink.owner_id == current_user.id).first()
    if existing:
        if not existing.enabled:
            existing.enabled = True
            db.commit()
        return _link_response(existing)
    token = secrets.token_urlsafe(12)
    link = PublicLink(token=token, owner_id=current_user.id, enabled=True)
    db.add(link)
    db.commit()
    db.refresh(link)
    return _link_response(link)


@router.patch("/link")
def update_link_settings(settings: LinkSettings, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    link = db.query(PublicLink).filter(PublicLink.owner_id == current_user.id).first()
    if not link:
        raise HTTPException(status_code=404, detail="No public link")
    if settings.enabled is not None:
        link.enabled = settings.enabled
    if settings.include_notes is not None:
        link.include_notes = settings.include_notes
    if settings.colors is not None:
        link.colors = settings.colors
    db.commit()
    return _link_response(link)


@router.delete("/link")
def revoke_link(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Permanently delete the link. Next enable will generate a fresh token."""
    db.query(PublicLink).filter(PublicLink.owner_id == current_user.id).delete()
    db.commit()
    return {"revoked": True}


@router.get("/link")
def get_link(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    link = db.query(PublicLink).filter(PublicLink.owner_id == current_user.id).first()
    if not link:
        return {"token": None, "enabled": False, "include_notes": False, "colors": {}}
    return _link_response(link)


def _get_active_link(token: str, db: Session) -> PublicLink:
    link = db.query(PublicLink).filter(PublicLink.token == token).first()
    if not link or not link.enabled:
        raise HTTPException(status_code=404, detail="Link not found")
    return link


@router.get("/{token}/info")
def public_info(token: str, db: Session = Depends(get_db)):
    link = _get_active_link(token, db)
    owner = db.query(User).filter(User.id == link.owner_id).first()
    return {"name": owner.name, "include_notes": link.include_notes, "colors": link.colors or {}}


@router.get("/{token}/notes")
def public_notes(token: str, db: Session = Depends(get_db)):
    link = _get_active_link(token, db)
    if not link.include_notes:
        raise HTTPException(status_code=403, detail="Notes not shared")
    notes = db.query(Note).filter(Note.user_id == link.owner_id).order_by(Note.date.desc()).all()
    for n in notes:
        n.id = str(n.id)
        n.user_id = str(n.user_id)
    return notes


@router.get("/{token}/logs")
def public_logs(token: str, db: Session = Depends(get_db)):
    link = _get_active_link(token, db)
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
