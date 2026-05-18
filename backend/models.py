from sqlalchemy import Column, String, DateTime, Integer, Text, JSON, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from database import Base
import uuid
from datetime import datetime, timezone


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    google_sub = Column(String(255), unique=True, nullable=False)
    email = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class HiddenCategory(Base):
    __tablename__ = "hidden_categories"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    name = Column(String(100), primary_key=True)


class CategoryConfig(Base):
    __tablename__ = "category_configs"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    name = Column(String(100), primary_key=True)
    data_type = Column(String(20), nullable=False, default='duration')
    unit = Column(String(50), nullable=True)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    activity_type = Column(String(100), nullable=False)
    started_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    extra_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class PrivateCategory(Base):
    __tablename__ = "private_categories"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    name = Column(String(100), primary_key=True)


class Share(Base):
    __tablename__ = "shares"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    viewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(20), nullable=False, default='pending')  # pending | accepted | declined
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (UniqueConstraint('owner_id', 'viewer_id', name='uq_share_pair'),)


class PublicLink(Base):
    __tablename__ = "public_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token = Column(String(32), unique=True, nullable=False, index=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, unique=True)
    include_notes = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Note(Base):
    __tablename__ = "notes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    note_type = Column(String(20), nullable=False)
    date = Column(String(10), nullable=True)
    content = Column(Text, nullable=False, default="")
    linked_log_ids = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
