"""API routes for managing jewelry models."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..crud import (
    create_jewelry,
    delete_jewelry,
    get_all_jewelry,
    get_jewelry_categories,
    get_jewelry,
    update_jewelry,
    update_jewelry_file,
    UPLOADS_DIR,
)
from ..database import get_db
from ..schemas import (
    JewelryCategoryResponse,
    JewelryCreate,
    JewelryListResponse,
    JewelryResponse,
    JewelryUpdate,
)

router = APIRouter(prefix="/api/jewelry", tags=["jewelry"])


def _validate_glb(file: UploadFile) -> None:
    """Raise 400 if the upload doesn't look like a GLB file."""
    filename = file.filename or ""
    if not filename.lower().endswith(".glb"):
        raise HTTPException(
            status_code=400,
            detail=f"Only .glb files are accepted. Received: '{filename}'",
        )


# ---------------------------------------------------------------------------
# Upload (create)
# ---------------------------------------------------------------------------

@router.post("/upload", response_model=JewelryResponse, status_code=201)
def upload_jewelry(
    file: UploadFile = File(..., description="GLB 3D-model file"),
    metadata: str = Form(
        '{}', description="JSON string with jewelry metadata fields"
    ),
    db: Session = Depends(get_db),
):
    """Upload a GLB file together with metadata (as a JSON string in a form field)."""
    _validate_glb(file)

    try:
        meta_dict = json.loads(metadata)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid JSON in 'metadata' field: {exc}",
        )

    # Fallback name
    if "name" not in meta_dict or not meta_dict["name"]:
        meta_dict["name"] = Path(file.filename or "Unnamed Jewelry").stem

    try:
        jewelry_data = JewelryCreate(**meta_dict)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    db_jewelry = create_jewelry(db, jewelry_data, file)
    return db_jewelry


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("/", response_model=JewelryListResponse)
def list_jewelry(
    category: Optional[str] = Query(None, description="Filter by category"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Return a paginated list of active jewelry, optionally filtered by category."""
    items, total = get_all_jewelry(db, category=category, skip=skip, limit=limit)
    return JewelryListResponse(
        items=[JewelryResponse.model_validate(g) for g in items],
        total=total,
    )


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

@router.get("/categories", response_model=list[JewelryCategoryResponse])
def list_categories(db: Session = Depends(get_db)):
    """Return distinct categories with the count of active jewelry in each."""
    rows = get_jewelry_categories(db)
    return [JewelryCategoryResponse(category=cat, count=cnt) for cat, cnt in rows]


# ---------------------------------------------------------------------------
# Single item
# ---------------------------------------------------------------------------

@router.get("/{jewelry_id}", response_model=JewelryResponse)
def read_jewelry(jewelry_id: int, db: Session = Depends(get_db)):
    """Fetch a single jewelry entry by ID."""
    db_jewelry = get_jewelry(db, jewelry_id)
    if db_jewelry is None:
        raise HTTPException(status_code=404, detail="Jewelry item not found")
    return db_jewelry


# ---------------------------------------------------------------------------
# Update metadata
# ---------------------------------------------------------------------------

@router.put("/{jewelry_id}", response_model=JewelryResponse)
def update_jewelry_metadata(
    jewelry_id: int,
    update_data: JewelryUpdate,
    db: Session = Depends(get_db),
):
    """Partially update jewelry metadata (does not replace the GLB file)."""
    db_jewelry = update_jewelry(db, jewelry_id, update_data)
    if db_jewelry is None:
        raise HTTPException(status_code=404, detail="Jewelry item not found")
    return db_jewelry


# ---------------------------------------------------------------------------
# Replace GLB file
# ---------------------------------------------------------------------------

@router.put("/{jewelry_id}/file", response_model=JewelryResponse)
def replace_jewelry_file(
    jewelry_id: int,
    file: UploadFile = File(..., description="New GLB file"),
    db: Session = Depends(get_db),
):
    """Replace the GLB model file for an existing jewelry entry."""
    _validate_glb(file)
    db_jewelry = update_jewelry_file(db, jewelry_id, file)
    if db_jewelry is None:
        raise HTTPException(status_code=404, detail="Jewelry item not found")
    return db_jewelry


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/{jewelry_id}", status_code=204)
def remove_jewelry(jewelry_id: int, db: Session = Depends(get_db)):
    """Delete a jewelry entry and its associated GLB file."""
    deleted = delete_jewelry(db, jewelry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Jewelry item not found")
    return None


# ---------------------------------------------------------------------------
# Serve GLB model
# ---------------------------------------------------------------------------

@router.get("/{jewelry_id}/model")
def serve_jewelry_model(jewelry_id: int, db: Session = Depends(get_db)):
    """Stream the GLB model file with the correct MIME type."""
    db_jewelry = get_jewelry(db, jewelry_id)
    if db_jewelry is None:
        raise HTTPException(status_code=404, detail="Jewelry item not found")

    file_path = UPLOADS_DIR / db_jewelry.glb_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Model file not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type="model/gltf-binary",
        filename=db_jewelry.original_filename,
    )


# ---------------------------------------------------------------------------
# Serve Thumbnail
# ---------------------------------------------------------------------------

@router.get("/{jewelry_id}/thumbnail")
def serve_jewelry_thumbnail(
    jewelry_id: int,
    db: Session = Depends(get_db)
):
    """Serve a standard themed SVG thumbnail depending on jewelry category."""
    db_jewelry = get_jewelry(db, jewelry_id)
    if db_jewelry is None:
        raise HTTPException(status_code=404, detail="Jewelry item not found")
        
    emoji = "💍"

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect width="100" height="100" fill="#08080a" rx="15" stroke="#c5a880" stroke-width="1"/>
        <text x="50" y="65" font-size="50" text-anchor="middle">{emoji}</text>
    </svg>"""
    
    from fastapi.responses import Response
    return Response(content=svg_content, media_type="image/svg+xml")
