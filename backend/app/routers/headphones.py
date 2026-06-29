"""API routes for managing headphones models."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..crud import (
    create_headphones,
    delete_headphones,
    get_all_headphones,
    get_headphones_categories,
    get_headphones,
    update_headphones,
    update_headphones_file,
    UPLOADS_DIR,
)
from ..database import get_db
from ..schemas import (
    HeadphonesCategoryResponse,
    HeadphonesCreate,
    HeadphonesListResponse,
    HeadphonesResponse,
    HeadphonesUpdate,
)

router = APIRouter(prefix="/api/headphones", tags=["headphones"])


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

@router.post("/upload", response_model=HeadphonesResponse, status_code=201)
def upload_headphones(
    file: UploadFile = File(..., description="GLB 3D-model file"),
    metadata: str = Form(
        '{}', description="JSON string with headphones metadata fields"
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
        meta_dict["name"] = Path(file.filename or "Unnamed Headphones").parent.name or "Unnamed Headphones"
        if meta_dict["name"] == "":
            meta_dict["name"] = Path(file.filename or "Unnamed Headphones").stem

    try:
        headphones_data = HeadphonesCreate(**meta_dict)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    db_headphones = create_headphones(db, headphones_data, file)
    return db_headphones


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("/", response_model=HeadphonesListResponse)
def list_headphones(
    category: Optional[str] = Query(None, description="Filter by category"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Return a paginated list of active headphones, optionally filtered by category."""
    items, total = get_all_headphones(db, category=category, skip=skip, limit=limit)
    return HeadphonesListResponse(
        items=[HeadphonesResponse.model_validate(g) for g in items],
        total=total,
    )


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

@router.get("/categories", response_model=list[HeadphonesCategoryResponse])
def list_categories(db: Session = Depends(get_db)):
    """Return distinct categories with the count of active headphones in each."""
    rows = get_headphones_categories(db)
    return [HeadphonesCategoryResponse(category=cat, count=cnt) for cat, cnt in rows]


# ---------------------------------------------------------------------------
# Single item
# ---------------------------------------------------------------------------

@router.get("/{headphones_id}", response_model=HeadphonesResponse)
def read_headphones(headphones_id: int, db: Session = Depends(get_db)):
    """Fetch a single headphones entry by ID."""
    db_headphones = get_headphones(db, headphones_id)
    if db_headphones is None:
        raise HTTPException(status_code=404, detail="Headphones item not found")
    return db_headphones


# ---------------------------------------------------------------------------
# Update metadata
# ---------------------------------------------------------------------------

@router.put("/{headphones_id}", response_model=HeadphonesResponse)
def update_headphones_metadata(
    headphones_id: int,
    update_data: HeadphonesUpdate,
    db: Session = Depends(get_db),
):
    """Partially update headphones metadata (does not replace the GLB file)."""
    db_headphones = update_headphones(db, headphones_id, update_data)
    if db_headphones is None:
        raise HTTPException(status_code=404, detail="Headphones item not found")
    return db_headphones


# ---------------------------------------------------------------------------
# Replace GLB file
# ---------------------------------------------------------------------------

@router.put("/{headphones_id}/file", response_model=HeadphonesResponse)
def replace_headphones_file(
    headphones_id: int,
    file: UploadFile = File(..., description="New GLB file"),
    db: Session = Depends(get_db),
):
    """Replace the GLB model file for an existing headphones entry."""
    _validate_glb(file)
    db_headphones = update_headphones_file(db, headphones_id, file)
    if db_headphones is None:
        raise HTTPException(status_code=404, detail="Headphones item not found")
    return db_headphones


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/{headphones_id}", status_code=204)
def remove_headphones(headphones_id: int, db: Session = Depends(get_db)):
    """Delete a headphones entry and its associated GLB file."""
    deleted = delete_headphones(db, headphones_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Headphones item not found")
    return None


# ---------------------------------------------------------------------------
# Serve GLB model
# ---------------------------------------------------------------------------

@router.get("/{headphones_id}/model")
def serve_headphones_model(headphones_id: int, db: Session = Depends(get_db)):
    """Stream the GLB model file with the correct MIME type."""
    db_headphones = get_headphones(db, headphones_id)
    if db_headphones is None:
        raise HTTPException(status_code=404, detail="Headphones item not found")

    file_path = UPLOADS_DIR / db_headphones.glb_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Model file not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type="model/gltf-binary",
        filename=db_headphones.original_filename,
    )


# ---------------------------------------------------------------------------
# Serve Thumbnail
# ---------------------------------------------------------------------------

@router.get("/{headphones_id}/thumbnail")
def serve_headphones_thumbnail(
    headphones_id: int,
    db: Session = Depends(get_db)
):
    """Serve a standard themed SVG thumbnail depending on headphones category."""
    db_headphones = get_headphones(db, headphones_id)
    if db_headphones is None:
        raise HTTPException(status_code=404, detail="Headphones item not found")

    emoji = "🎧" if db_headphones.category == "headphone" else "✨"

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect width="100" height="100" fill="#08080a" rx="15" stroke="#00b4d8" stroke-width="1"/>
        <text x="50" y="65" font-size="50" text-anchor="middle">{emoji}</text>
    </svg>"""

    from fastapi.responses import Response
    return Response(content=svg_content, media_type="image/svg+xml")
