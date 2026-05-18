"""
One-time script: assigns all unowned rows to the single existing user.
Safe to run if there's only one user in the database.
"""
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
import os

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/activitytracker")
engine = create_engine(DATABASE_URL)

with engine.begin() as conn:
    users = conn.execute(text("SELECT id, email FROM users")).fetchall()
    if len(users) != 1:
        print(f"Expected 1 user, found {len(users)}. Aborting.")
        exit(1)

    user_id, email = users[0]
    print(f"Claiming data for: {email} ({user_id})")

    r1 = conn.execute(text("UPDATE activity_logs SET user_id = :uid WHERE user_id IS NULL"), {"uid": user_id})
    r2 = conn.execute(text("UPDATE notes SET user_id = :uid WHERE user_id IS NULL"), {"uid": user_id})
    print(f"Updated {r1.rowcount} activity logs, {r2.rowcount} notes.")
