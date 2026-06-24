"""CRUD operations for the Glasses model."""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from fastapi import UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import Glasses
from .schemas import GlassesCreate, GlassesUpdate

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"


def _save_upload(file: UploadFile) -> Tuple[str, str, int]:
    """Persist an uploaded GLB file with a UUID-based filename.

    Returns:
        (uuid_filename, original_filename, file_size_bytes)
    """
    ext = Path(file.filename or "model.glb").suffix or ".glb"
    uuid_filename = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / uuid_filename

    contents = file.file.read()
    file_size = len(contents)
    dest.write_bytes(contents)

    return uuid_filename, file.filename or "unknown.glb", file_size


def _delete_file(glb_filename: str) -> None:
    """Remove a GLB file from the uploads directory (best-effort)."""
    path = UPLOADS_DIR / glb_filename
    if path.exists():
        os.remove(path)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def create_glasses(
    db: Session,
    glasses_data: GlassesCreate,
    glb_file: UploadFile,
) -> Glasses:
    """Save the uploaded GLB file and insert a new Glasses row."""
    uuid_filename, original_filename, file_size = _save_upload(glb_file)

    db_glasses = Glasses(
        **glasses_data.model_dump(),
        glb_filename=uuid_filename,
        original_filename=original_filename,
        file_size=file_size,
    )
    db.add(db_glasses)
    db.commit()
    db.refresh(db_glasses)
    return db_glasses


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def get_glasses(db: Session, glasses_id: int) -> Optional[Glasses]:
    """Return a single Glasses row by primary key, or ``None``."""
    return db.query(Glasses).filter(Glasses.id == glasses_id).first()


def get_all_glasses(
    db: Session,
    category: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
) -> Tuple[List[Glasses], int]:
    """Return a paginated list of glasses with an optional category filter.

    Returns:
        (items, total_count)
    """
    query = db.query(Glasses).filter(Glasses.is_active == True)  # noqa: E712

    if category:
        query = query.filter(Glasses.category == category)

    total = query.count()
    items = query.order_by(Glasses.created_at.desc()).offset(skip).limit(limit).all()
    return items, total


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def update_glasses(
    db: Session,
    glasses_id: int,
    update_data: GlassesUpdate,
) -> Optional[Glasses]:
    """Apply a partial update to an existing Glasses row."""
    db_glasses = get_glasses(db, glasses_id)
    if db_glasses is None:
        return None

    update_dict = update_data.model_dump(exclude_unset=True)
    for field, value in update_dict.items():
        setattr(db_glasses, field, value)

    db.commit()
    db.refresh(db_glasses)
    return db_glasses


# ---------------------------------------------------------------------------
# Replace GLB file
# ---------------------------------------------------------------------------

def update_glasses_file(
    db: Session,
    glasses_id: int,
    new_file: UploadFile,
) -> Optional[Glasses]:
    """Replace the GLB file for an existing glasses entry."""
    db_glasses = get_glasses(db, glasses_id)
    if db_glasses is None:
        return None

    # Remove the old file
    _delete_file(db_glasses.glb_filename)

    # Save the new one
    uuid_filename, original_filename, file_size = _save_upload(new_file)
    db_glasses.glb_filename = uuid_filename
    db_glasses.original_filename = original_filename
    db_glasses.file_size = file_size

    db.commit()
    db.refresh(db_glasses)
    return db_glasses


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def delete_glasses(db: Session, glasses_id: int) -> bool:
    """Delete a Glasses row and its associated GLB file.

    Returns ``True`` if the row existed and was deleted.
    """
    db_glasses = get_glasses(db, glasses_id)
    if db_glasses is None:
        return False

    _delete_file(db_glasses.glb_filename)
    db.delete(db_glasses)
    db.commit()
    return True


# ---------------------------------------------------------------------------
# Aggregates
# ---------------------------------------------------------------------------

def get_categories(db: Session) -> Sequence[Tuple[str, int]]:
    """Return distinct categories with their active-glasses counts."""
    rows = (
        db.query(Glasses.category, func.count(Glasses.id))
        .filter(Glasses.is_active == True)  # noqa: E712
        .group_by(Glasses.category)
        .order_by(Glasses.category)
        .all()
    )
    return rows
