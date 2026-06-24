"""FastAPI application entry-point for the Virtual Glasses Try-On API."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .database import Base, engine
from .routers import glasses

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent  # …/backend
_UPLOADS_DIR = _BACKEND_DIR / "uploads"
_FRONTEND_DIR = _BACKEND_DIR.parent / "frontend"


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run one-time setup on startup."""
    # Ensure the uploads directory exists
    _UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    # Create all database tables (safe if they already exist)
    Base.metadata.create_all(bind=engine)

    yield  # Application runs here


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Virtual Glasses Try-On API",
    description="Backend for managing 3D glasses models and serving them for AR try-on.",
    version="1.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — allow everything during development
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(glasses.router)

# ---------------------------------------------------------------------------
# Static file mounts
# ---------------------------------------------------------------------------

# Serve uploaded GLB files at /uploads/<filename>
app.mount("/uploads", StaticFiles(directory=str(_UPLOADS_DIR)), name="uploads")

# Serve frontend assets at /frontend/…
if _FRONTEND_DIR.exists():
    app.mount(
        "/frontend",
        StaticFiles(directory=str(_FRONTEND_DIR), html=True),
        name="frontend",
    )


# ---------------------------------------------------------------------------
# Convenience HTML routes
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
async def root():
    """Serve the main frontend page."""
    index = _FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"message": "Virtual Glasses Try-On API is running. Visit /docs for the API documentation."}


@app.get("/admin", include_in_schema=False)
async def admin():
    """Serve the admin panel page."""
    admin_page = _FRONTEND_DIR / "admin.html"
    if admin_page.exists():
        return FileResponse(str(admin_page))
    return {"message": "Admin page not found. Place admin.html in the frontend/ directory."}
