import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from routes import logs, analyze, categories, notes, auth, shares

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Activity Tracker API", redirect_slashes=False)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8081,http://localhost:19006")
_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(shares.router, prefix="/shares", tags=["shares"])
app.include_router(logs.router, prefix="/logs", tags=["logs"])
app.include_router(analyze.router, prefix="/analyze", tags=["analyze"])
app.include_router(categories.router, prefix="/categories", tags=["categories"])
app.include_router(notes.router, prefix="/notes", tags=["notes"])


@app.get("/health")
def health_check():
    return {"status": "ok"}
