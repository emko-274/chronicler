"""
Run once to migrate an existing database to the multi-user schema.

Safe to re-run — uses IF NOT EXISTS / IF EXISTS guards where possible.
WARNING: hidden_categories and category_configs are dropped and recreated
         (they gain a composite PK). Any data in those two tables will be lost.
"""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/activitytracker")
engine = create_engine(DATABASE_URL)

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            google_sub VARCHAR(255) UNIQUE NOT NULL,
            email VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """))

    conn.execute(text("""
        ALTER TABLE activity_logs
        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)
    """))

    conn.execute(text("""
        ALTER TABLE notes
        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)
    """))

    conn.execute(text("DROP TABLE IF EXISTS hidden_categories"))
    conn.execute(text("""
        CREATE TABLE hidden_categories (
            user_id UUID NOT NULL REFERENCES users(id),
            name VARCHAR(100) NOT NULL,
            PRIMARY KEY (user_id, name)
        )
    """))

    conn.execute(text("DROP TABLE IF EXISTS category_configs"))
    conn.execute(text("""
        CREATE TABLE category_configs (
            user_id UUID NOT NULL REFERENCES users(id),
            name VARCHAR(100) NOT NULL,
            data_type VARCHAR(20) NOT NULL DEFAULT 'duration',
            unit VARCHAR(50),
            PRIMARY KEY (user_id, name)
        )
    """))

print("Migration complete.")
