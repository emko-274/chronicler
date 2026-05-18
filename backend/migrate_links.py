import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/activitytracker")
engine = create_engine(DATABASE_URL)

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS public_links (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            token VARCHAR(32) UNIQUE NOT NULL,
            owner_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_public_links_token ON public_links(token)"))

print("Migration complete.")
