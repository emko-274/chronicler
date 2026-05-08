from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from database import get_db
from models import ActivityLog, HiddenCategory, User
from auth import get_current_user

router = APIRouter()

BUILTIN_TYPES = ['sleep']


class CategoryResponse(BaseModel):
    name: str
    is_hidden: bool
    log_count: int


@router.get("/", response_model=List[CategoryResponse])
def get_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.query(ActivityLog.activity_type).filter(ActivityLog.user_id == current_user.id).distinct().all()
    from_logs = {r[0] for r in rows}

    hidden = {
        h.name for h in db.query(HiddenCategory).filter(HiddenCategory.user_id == current_user.id).all()
    }

    all_names = sorted(set(BUILTIN_TYPES) | from_logs | hidden)

    counts = {}
    for row in db.query(ActivityLog.activity_type).filter(ActivityLog.user_id == current_user.id).all():
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
