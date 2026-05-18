from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel
from datetime import datetime, timezone
import uuid

from database import get_db
from models import Share, User
from auth import get_current_user

router = APIRouter()


class ShareInviteRequest(BaseModel):
    viewer_email: str


def _other_user(share: Share, my_id, db: Session) -> dict:
    other_id = share.viewer_id if share.owner_id == my_id else share.owner_id
    u = db.query(User).filter(User.id == other_id).first()
    return {"id": str(u.id), "email": u.email, "name": u.name}


def _serialize(share: Share, my_id, db: Session) -> dict:
    return {
        "id": str(share.id),
        "status": share.status,
        "user": _other_user(share, my_id, db),
        "created_at": share.created_at.isoformat(),
    }


@router.post("")
def send_invite(
    body: ShareInviteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    viewer = db.query(User).filter(User.email == body.viewer_email).first()
    if not viewer:
        raise HTTPException(status_code=404, detail="No account found with that email")
    if viewer.id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't share with yourself")

    existing = db.query(Share).filter(
        Share.owner_id == current_user.id,
        Share.viewer_id == viewer.id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Invite already sent to that user")

    share = Share(owner_id=current_user.id, viewer_id=viewer.id)
    db.add(share)
    db.commit()
    db.refresh(share)
    return _serialize(share, current_user.id, db)


@router.get("/sent")
def get_sent(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    shares = db.query(Share).filter(Share.owner_id == current_user.id).all()
    return [_serialize(s, current_user.id, db) for s in shares]


@router.get("/received")
def get_received(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    shares = db.query(Share).filter(
        Share.viewer_id == current_user.id,
        Share.status == 'pending',
    ).all()
    return [_serialize(s, current_user.id, db) for s in shares]


@router.get("/accepted")
def get_accepted_shared_with_me(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dashboards others have shared with the current user (accepted)."""
    shares = db.query(Share).filter(
        Share.viewer_id == current_user.id,
        Share.status == 'accepted',
    ).all()
    return [_serialize(s, current_user.id, db) for s in shares]


@router.post("/{share_id}/accept")
def accept(
    share_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    share = db.query(Share).filter(
        Share.id == uuid.UUID(share_id),
        Share.viewer_id == current_user.id,
        Share.status == 'pending',
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Invite not found")
    share.status = 'accepted'
    share.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(share)
    return _serialize(share, current_user.id, db)


@router.post("/{share_id}/decline")
def decline(
    share_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    share = db.query(Share).filter(
        Share.id == uuid.UUID(share_id),
        Share.viewer_id == current_user.id,
        Share.status == 'pending',
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Invite not found")
    share.status = 'declined'
    share.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"declined": True}


@router.delete("/{share_id}")
def remove(
    share_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    share = db.query(Share).filter(
        Share.id == uuid.UUID(share_id),
        or_(Share.owner_id == current_user.id, Share.viewer_id == current_user.id),
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    db.delete(share)
    db.commit()
    return {"removed": True}
