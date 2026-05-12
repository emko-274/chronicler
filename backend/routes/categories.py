from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from database import get_db
from models import ActivityLog, HiddenCategory, Share, User
from auth import get_current_user

router = APIRouter()

BUILTIN_TYPES = ['sleep']


class CategoryResponse(BaseModel):
    name: str
    is_hidden: bool
    log_count: int


class RenameRequest(BaseModel):
    new_name: str


@router.get("/", response_model=List[CategoryResponse])
def get_categories(
    owner_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if owner_id and owner_id != str(current_user.id):
        share = db.query(Share).filter(
            Share.owner_id == owner_id,
            Share.viewer_id == current_user.id,
            Share.status == 'accepted',
        ).first()
        if not share:
            raise HTTPException(status_code=403, detail="No access to this user's data")
        target_id = owner_id
    else:
        target_id = str(current_user.id)

    rows = db.query(ActivityLog.activity_type).filter(ActivityLog.user_id == target_id).distinct().all()
    from_logs = {r[0] for r in rows}

    hidden = {
        h.name for h in db.query(HiddenCategory).filter(HiddenCategory.user_id == target_id).all()
    }

    all_names = sorted(set(BUILTIN_TYPES) | from_logs | hidden)

    counts = {}
    for row in db.query(ActivityLog.activity_type).filter(ActivityLog.user_id == target_id).all():
        counts[row[0]] = counts.get(row[0], 0) + 1

    return [
        CategoryResponse(name=name, is_hidden=name in hidden, log_count=counts.get(name, 0))
        for name in all_names
    ]


@router.delete("/{name}")
def hide_category(
    name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = db.query(HiddenCategory).filter(
        HiddenCategory.user_id == current_user.id,
        HiddenCategory.name == name,
    ).first()
    if not existing:
        db.add(HiddenCategory(user_id=current_user.id, name=name))
        db.commit()
    return {"hidden": name}


@router.delete("/{name}/data")
def delete_category_data(
    name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = db.query(ActivityLog).filter(
        ActivityLog.activity_type == name,
        ActivityLog.user_id == current_user.id,
    ).delete()
    if name in BUILTIN_TYPES:
        existing = db.query(HiddenCategory).filter(
            HiddenCategory.user_id == current_user.id,
            HiddenCategory.name == name,
        ).first()
        if not existing:
            db.add(HiddenCategory(user_id=current_user.id, name=name))
    else:
        db.query(HiddenCategory).filter(
            HiddenCategory.user_id == current_user.id,
            HiddenCategory.name == name,
        ).delete()
    db.commit()
    return {"deleted": deleted}


@router.post("/{name}/rename")
def rename_category(
    name: str,
    body: RenameRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    new_name = body.new_name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required")
    if new_name == name:
        return {"renamed": new_name}
    db.query(ActivityLog).filter(
        ActivityLog.activity_type == name,
        ActivityLog.user_id == current_user.id,
    ).update({"activity_type": new_name})
    hidden = db.query(HiddenCategory).filter(
        HiddenCategory.user_id == current_user.id,
        HiddenCategory.name == name,
    ).first()
    if hidden:
        hidden.name = new_name
    db.commit()
    return {"renamed": new_name}


@router.post("/{name}/restore")
def restore_category(
    name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(HiddenCategory).filter(
        HiddenCategory.user_id == current_user.id,
        HiddenCategory.name == name,
    ).delete()
    db.commit()
    return {"restored": name}
