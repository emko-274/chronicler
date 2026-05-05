from sqlalchemy import Column, String, DateTime, Integer, Text, JSON
from sqlalchemy.dialects.postgresql import UUID
from database import Base
import uuid
from datetime import datetime, timezone


class HiddenCategory(Base):
    __tablename__ = "hidden_categories"

    name = Column(String(100), primary_key=True)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_type = Column(String(100), nullable=False)  # e.g. "sleep", "exercise", "work"
    started_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    extra_data = Column(JSON, nullable=True)  # flexible field for extra data
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
