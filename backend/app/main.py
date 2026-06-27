"""FastAPI application entry-point for the Virtual Glasses Try-On API."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .database import Base, engine, SessionLocal
from .models import Jewelry
from .routers import glasses, jewelry

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent  # …/backend
_UPLOADS_DIR = _BACKEND_DIR / "uploads"
_FRONTEND_DIR = _BACKEND_DIR.parent / "frontend"


def seed_jewelry_from_uploads():
    """Seed the database with pre-uploaded GLB models if table is empty."""
    db = SessionLocal()
    try:
        if db.query(Jewelry).count() > 0:
            return
        
        items_to_seed = [
            {
                "file": "Diamond Ring.glb", 
                "name": "Diamond Ring", 
                "category": "ring", 
                "brand": "Luxury", 
                "desc": "Vibrant custom diamond ring.",
                "rot_x": 0.0, "rot_y": -90.0, "rot_z": 0.0,
                "pos_x": 0.0, "pos_y": 0.0, "pos_z": 0.0
            },
            {
                "file": "Diamond Solitaire  Ring.glb", 
                "name": "Diamond Solitaire Ring", 
                "category": "ring", 
                "brand": "Classic", 
                "desc": "Elegant classic solitaire ring.",
                "rot_x": 90.0, "rot_y": 0.0, "rot_z": 0.0,
                "pos_x": 0.0, "pos_y": 0.0, "pos_z": 0.0
            },
            {
                "file": "royal_ring.glb", 
                "name": "Royal Gold Ring", 
                "category": "ring", 
                "brand": "Imperial", 
                "desc": "Majestic imperial design gold ring.",
                "rot_x": 0.0, "rot_y": 0.0, "rot_z": 0.0,
                "pos_x": 0.0, "pos_y": 0.0, "pos_z": 0.0
            },
            {
                "file": "Halo.glb", 
                "name": "Halo Ring", 
                "category": "ring", 
                "brand": "Aurora", 
                "desc": "Sparkling halo cut diamond ring.",
                "rot_x": 0.0, "rot_y": 0.0, "rot_z": 0.0,
                "pos_x": 0.0, "pos_y": 0.0, "pos_z": 0.0
            },
            {
                "file": "Pearl bracelet.glb", 
                "name": "Pearl Bracelet", 
                "category": "bracelet", 
                "brand": "Princess", 
                "desc": "Shining pearl wristlet bracelet.",
                "rot_x": 0.0, "rot_y": 0.0, "rot_z": 0.0,
                "pos_x": 0.0, "pos_y": 0.0, "pos_z": 0.45
            },
            {
                "file": "Watch.glb", 
                "name": "Gold Chrono Watch", 
                "category": "watch", 
                "brand": "Kiksar", 
                "desc": "Premium gold designer chronograph watch.",
                "rot_x": 90.0, "rot_y": 0.0, "rot_z": 0.0,
                "pos_x": 0.0, "pos_y": 0.0, "pos_z": 0.50
            }
        ]
        
        for item in items_to_seed:
            file_path = _UPLOADS_DIR / item["file"]
            if file_path.exists():
                size = file_path.stat().st_size
                db_jewelry = Jewelry(
                    name=item["name"],
                    category=item["category"],
                    brand=item["brand"],
                    description=item["desc"],
                    glb_filename=item["file"],
                    original_filename=item["file"],
                    file_size=size,
                    scale_x=1.0,
                    scale_y=1.0,
                    scale_z=1.0,
                    position_offset_x=item["pos_x"],
                    position_offset_y=item["pos_y"],
                    position_offset_z=item["pos_z"],
                    rotation_offset_x=item["rot_x"],
                    rotation_offset_y=item["rot_y"],
                    rotation_offset_z=item["rot_z"]
                )
                db.add(db_jewelry)
        db.commit()
        print("[Database] Successfully seeded pre-existing jewelry assets.")
    except Exception as exc:
        print(f"[Database] Failed to seed jewelry assets: {exc}")
    finally:
        db.close()


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

    # Seed the jewelry database if empty
    seed_jewelry_from_uploads()

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
app.include_router(jewelry.router)

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


@app.get("/jewelry", include_in_schema=False)
async def jewelry():
    """Serve the jewelry try-on page."""
    jewelry_page = _FRONTEND_DIR / "jewelry.html"
    if jewelry_page.exists():
        return FileResponse(str(jewelry_page))
    return {"message": "Jewelry page not found. Place jewelry.html in the frontend/ directory."}


@app.get("/jewelry-admin", include_in_schema=False)
async def jewelry_admin():
    """Serve the jewelry admin panel page."""
    jewelry_admin_page = _FRONTEND_DIR / "jewelry_admin.html"
    if jewelry_admin_page.exists():
        return FileResponse(str(jewelry_admin_page))
    return {"message": "Jewelry admin page not found. Place jewelry_admin.html in the frontend/ directory."}


