import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/activitytracker")
engine = create_engine(DATABASE_URL)

with engine.begin() as conn:
    conn.execute(text("""
        ALTER TABLE public_links
        ADD COLUMN IF NOT EXISTS include_notes BOOLEAN NOT NULL DEFAULT FALSE
    """))

print("Migration complete: include_notes added to public_links.")
