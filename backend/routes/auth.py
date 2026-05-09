from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import httpx

from database import get_db
from models import User
from auth import create_access_token, get_current_user

router = APIRouter()


class GoogleAuthRequest(BaseModel):
    access_token: str


@router.post("/google")
async def google_login(body: GoogleAuthRequest, db: Session = Depends(get_db)):
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {body.access_token}"},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google token")

    info = r.json()
    google_sub = info.get("sub")
    if not google_sub:
        raise HTTPException(status_code=401, detail="Missing Google user ID")

    user = db.query(User).filter(User.google_sub == google_sub).first()
    if not user:
        user = User(
            google_sub=google_sub,
            email=info.get("email", ""),
            name=info.get("name", ""),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return {
        "token": create_access_token(user.id),
        "user": {"id": str(user.id), "email": user.email, "name": user.name},
    }


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {"id": str(current_user.id), "email": current_user.email, "name": current_user.name}
