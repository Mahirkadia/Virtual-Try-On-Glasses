"""API routes for managing glasses models."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..crud import (
    create_glasses,
    delete_glasses,
    get_all_glasses,
    get_categories,
    get_glasses,
    update_glasses,
    update_glasses_file,
    UPLOADS_DIR,
)
from ..database import get_db
from ..schemas import (
    CategoryResponse,
    GlassesCreate,
    GlassesListResponse,
    GlassesResponse,
    GlassesUpdate,
)

router = APIRouter(prefix="/api/glasses", tags=["glasses"])

# Allowed GLB MIME types (browsers may send different values)
_ALLOWED_CONTENT_TYPES = {
    "model/gltf-binary",
    "application/octet-stream",
    "application/x-glb",
}


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

@router.post("/upload", response_model=GlassesResponse, status_code=201)
def upload_glasses(
    file: UploadFile = File(..., description="GLB 3D-model file"),
    metadata: str = Form(
        '{}', description="JSON string with glasses metadata fields"
    ),
    db: Session = Depends(get_db),
):
    """Upload a GLB file together with metadata (as a JSON string in a form field).

    The *metadata* form field should be a JSON object whose keys match the
    ``GlassesCreate`` schema (name, category, brand, description, transform
    fields, lens_opacity, frame_color, …).
    """
    _validate_glb(file)

    # Parse the JSON metadata string
    try:
        meta_dict = json.loads(metadata)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid JSON in 'metadata' field: {exc}",
        )

    # Ensure a name is provided — fall back to the original filename stem
    if "name" not in meta_dict or not meta_dict["name"]:
        meta_dict["name"] = Path(file.filename or "Unnamed Glasses").stem

    try:
        glasses_data = GlassesCreate(**meta_dict)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    db_glasses = create_glasses(db, glasses_data, file)
    return db_glasses


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("/", response_model=GlassesListResponse)
def list_glasses(
    category: Optional[str] = Query(None, description="Filter by category"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Return a paginated list of active glasses, optionally filtered by category."""
    items, total = get_all_glasses(db, category=category, skip=skip, limit=limit)
    return GlassesListResponse(
        items=[GlassesResponse.model_validate(g) for g in items],
        total=total,
    )


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

@router.get("/categories", response_model=list[CategoryResponse])
def list_categories(db: Session = Depends(get_db)):
    """Return distinct categories with the count of active glasses in each."""
    rows = get_categories(db)
    return [CategoryResponse(category=cat, count=cnt) for cat, cnt in rows]


# ---------------------------------------------------------------------------
# Single item
# ---------------------------------------------------------------------------

@router.get("/{glasses_id}", response_model=GlassesResponse)
def read_glasses(glasses_id: int, db: Session = Depends(get_db)):
    """Fetch a single glasses entry by ID."""
    db_glasses = get_glasses(db, glasses_id)
    if db_glasses is None:
        raise HTTPException(status_code=404, detail="Glasses not found")
    return db_glasses


# ---------------------------------------------------------------------------
# Update metadata
# ---------------------------------------------------------------------------

@router.put("/{glasses_id}", response_model=GlassesResponse)
def update_glasses_metadata(
    glasses_id: int,
    update_data: GlassesUpdate,
    db: Session = Depends(get_db),
):
    """Partially update glasses metadata (does **not** replace the GLB file)."""
    db_glasses = update_glasses(db, glasses_id, update_data)
    if db_glasses is None:
        raise HTTPException(status_code=404, detail="Glasses not found")
    return db_glasses


# ---------------------------------------------------------------------------
# Replace GLB file
# ---------------------------------------------------------------------------

@router.put("/{glasses_id}/file", response_model=GlassesResponse)
def replace_glasses_file(
    glasses_id: int,
    file: UploadFile = File(..., description="New GLB file"),
    db: Session = Depends(get_db),
):
    """Replace the GLB model file for an existing glasses entry."""
    _validate_glb(file)
    db_glasses = update_glasses_file(db, glasses_id, file)
    if db_glasses is None:
        raise HTTPException(status_code=404, detail="Glasses not found")
    return db_glasses


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/{glasses_id}", status_code=204)
def remove_glasses(glasses_id: int, db: Session = Depends(get_db)):
    """Delete a glasses entry and its associated GLB file."""
    deleted = delete_glasses(db, glasses_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Glasses not found")
    return None


# ---------------------------------------------------------------------------
# Serve GLB model
# ---------------------------------------------------------------------------

@router.get("/{glasses_id}/model")
def serve_glasses_model(glasses_id: int, db: Session = Depends(get_db)):
    """Stream the GLB model file with the correct ``model/gltf-binary`` content type."""
    db_glasses = get_glasses(db, glasses_id)
    if db_glasses is None:
        raise HTTPException(status_code=404, detail="Glasses not found")

    file_path = UPLOADS_DIR / db_glasses.glb_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Model file not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type="model/gltf-binary",
        filename=db_glasses.original_filename,
    )


# ---------------------------------------------------------------------------
# Serve Thumbnail Placeholder
# ---------------------------------------------------------------------------

@router.get("/{glasses_id}/thumbnail")
def serve_glasses_thumbnail(
    glasses_id: int,
    db: Session = Depends(get_db)
):
    """Serve a standard themed SVG thumbnail to prevent console 404 errors."""
    db_glasses = get_glasses(db, glasses_id)
    if db_glasses is None:
        raise HTTPException(status_code=404, detail="Glasses not found")
        
    svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect width="100" height="100" fill="#0f1423" rx="15"/>
        <text x="50" y="65" font-size="50" text-anchor="middle">👓</text>
    </svg>"""
    
    from fastapi.responses import Response
    return Response(content=svg_content, media_type="image/svg+xml")
