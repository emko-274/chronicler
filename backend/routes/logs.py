from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from database import get_db
from models import ActivityLog, HiddenCategory

router = APIRouter()


class ActivityLogCreate(BaseModel):
    activity_type: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None
    extra_data: Optional[dict] = None


class ActivityLogUpdate(BaseModel):
    activity_type: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    notes: Optional[str] = None


class ActivityLogResponse(BaseModel):
    id: str
    activity_type: str
    started_at: datetime
    ended_at: Optional[datetime]
    duration_minutes: Optional[int]
    notes: Optional[str]
    extra_data: Optional[dict]
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/", response_model=ActivityLogResponse)
def create_log(log: ActivityLogCreate, db: Session = Depends(get_db)):
    # Auto-calculate duration if start and end are provided and duration wasn't explicitly set
    if log.ended_at and log.duration_minutes is None:
        delta = log.ended_at - log.started_at
        log.duration_minutes = int(delta.total_seconds() / 60)

    db_log = ActivityLog(**log.model_dump())
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    db_log.id = str(db_log.id)
    return db_log


@router.get("/", response_model=list[ActivityLogResponse])
def get_logs(
    activity_type: Optional[str] = None,
    limit: int = 100,
    include_hidden: bool = False,
    db: Session = Depends(get_db),
):
    query = db.query(ActivityLog)
    if activity_type:
        query = query.filter(ActivityLog.activity_type == activity_type)
    if not include_hidden:
        hidden = {h.name for h in db.query(HiddenCategory).all()}
        if hidden:
            query = query.filter(ActivityLog.activity_type.notin_(hidden))
    results = query.order_by(ActivityLog.started_at.desc()).limit(limit).all()
    for log in results:
        log.id = str(log.id)
    return results


@router.put("/{log_id}", response_model=ActivityLogResponse)
def update_log(log_id: str, update: ActivityLogUpdate, db: Session = Depends(get_db)):
    log = db.query(ActivityLog).filter(ActivityLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")

    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(log, field, value)

    # Recalculate duration whenever start/end change
    if log.started_at and log.ended_at:
        delta = log.ended_at - log.started_at
        log.duration_minutes = int(delta.total_seconds() / 60)
    else:
        log.duration_minutes = None

    db.commit()
    db.refresh(log)
    log.id = str(log.id)
    return log


@router.delete("/by-type/{activity_type}")
def delete_logs_by_type(activity_type: str, db: Session = Depends(get_db)):
    deleted = db.query(ActivityLog).filter(ActivityLog.activity_type == activity_type).delete()
    db.commit()
    return {"deleted": deleted}


@router.delete("/{log_id}")
def delete_log(log_id: str, db: Session = Depends(get_db)):
    log = db.query(ActivityLog).filter(ActivityLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    db.delete(log)
    db.commit()
    return {"message": "Deleted"}
