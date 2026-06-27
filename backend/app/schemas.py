from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Base / shared fields
# ---------------------------------------------------------------------------

class GlassesBase(BaseModel):
    """Fields shared across create, update, and response schemas."""

    name: str = Field(..., min_length=1, max_length=200, description="Display name")
    category: str = Field(
        "eyeglasses", max_length=100, description="Category (eyeglasses, sunglasses, …)"
    )
    brand: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None

    # 3D Transform — Scale
    scale_x: float = Field(1.0, description="X-axis scale factor")
    scale_y: float = Field(1.0, description="Y-axis scale factor")
    scale_z: float = Field(1.0, description="Z-axis scale factor")

    # 3D Transform — Position offset
    position_offset_x: float = Field(0.0, description="X position offset")
    position_offset_y: float = Field(0.0, description="Y position offset")
    position_offset_z: float = Field(0.0, description="Z position offset")

    # 3D Transform — Rotation offset
    rotation_offset_x: float = Field(0.0, description="X rotation offset (radians)")
    rotation_offset_y: float = Field(0.0, description="Y rotation offset (radians)")
    rotation_offset_z: float = Field(0.0, description="Z rotation offset (radians)")

    # Physical / visual
    bridge_width: float = Field(0.04, ge=0, description="Bridge width in metres")
    temple_length: float = Field(0.12, ge=0, description="Temple length in metres")
    lens_opacity: float = Field(0.3, ge=0, le=1, description="Lens opacity (0–1)")
    frame_color: Optional[str] = Field(None, max_length=50)


# ---------------------------------------------------------------------------
# Creation
# ---------------------------------------------------------------------------

class GlassesCreate(GlassesBase):
    """Schema used when creating a new glasses entry.

    The GLB file is sent as a multipart form field; metadata arrives as a JSON
    string parsed into this model.
    """
    pass


# ---------------------------------------------------------------------------
# Partial update
# ---------------------------------------------------------------------------

class GlassesUpdate(BaseModel):
    """All-optional schema for PATCH-style updates."""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[str] = Field(None, max_length=100)
    brand: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None

    scale_x: Optional[float] = None
    scale_y: Optional[float] = None
    scale_z: Optional[float] = None

    position_offset_x: Optional[float] = None
    position_offset_y: Optional[float] = None
    position_offset_z: Optional[float] = None

    rotation_offset_x: Optional[float] = None
    rotation_offset_y: Optional[float] = None
    rotation_offset_z: Optional[float] = None

    bridge_width: Optional[float] = Field(None, ge=0)
    temple_length: Optional[float] = Field(None, ge=0)
    lens_opacity: Optional[float] = Field(None, ge=0, le=1)
    frame_color: Optional[str] = Field(None, max_length=50)

    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------

class GlassesResponse(GlassesBase):
    """Full glasses representation returned to the client."""

    id: int
    glb_filename: str
    original_filename: str
    file_size: Optional[int] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# List / aggregate responses
# ---------------------------------------------------------------------------

class GlassesListResponse(BaseModel):
    """Wrapper for paginated glasses lists."""

    items: List[GlassesResponse]
    total: int


class CategoryResponse(BaseModel):
    """Category name with the number of glasses in that category."""

    category: str
    count: int


# ---------------------------------------------------------------------------
# Jewelry Schemas
# ---------------------------------------------------------------------------

class JewelryBase(BaseModel):
    """Fields shared across jewelry create, update, and response schemas."""

    name: str = Field(..., min_length=1, max_length=200, description="Display name")
    category: str = Field(
        "ring", max_length=100, description="Category (ring)"
    )
    brand: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None

    # 3D Transform — Scale
    scale_x: float = Field(1.0, description="X-axis scale factor")
    scale_y: float = Field(1.0, description="Y-axis scale factor")
    scale_z: float = Field(1.0, description="Z-axis scale factor")

    # 3D Transform — Position offset
    position_offset_x: float = Field(0.0, description="X position offset")
    position_offset_y: float = Field(0.0, description="Y position offset")
    position_offset_z: float = Field(0.0, description="Z position offset")

    # 3D Transform — Rotation offset
    rotation_offset_x: float = Field(0.0, description="X rotation offset (degrees)")
    rotation_offset_y: float = Field(0.0, description="Y rotation offset (degrees)")
    rotation_offset_z: float = Field(0.0, description="Z rotation offset (degrees)")


class JewelryCreate(JewelryBase):
    """Schema used when creating a new jewelry entry."""
    pass


class JewelryUpdate(BaseModel):
    """All-optional schema for PATCH-style updates."""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[str] = Field(None, max_length=100)
    brand: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None

    scale_x: Optional[float] = None
    scale_y: Optional[float] = None
    scale_z: Optional[float] = None

    position_offset_x: Optional[float] = None
    position_offset_y: Optional[float] = None
    position_offset_z: Optional[float] = None

    rotation_offset_x: Optional[float] = None
    rotation_offset_y: Optional[float] = None
    rotation_offset_z: Optional[float] = None

    is_active: Optional[bool] = None


class JewelryResponse(JewelryBase):
    """Full jewelry representation returned to the client."""

    id: int
    glb_filename: str
    original_filename: str
    file_size: Optional[int] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class JewelryListResponse(BaseModel):
    """Wrapper for paginated jewelry lists."""

    items: List[JewelryResponse]
    total: int


class JewelryCategoryResponse(BaseModel):
    """Category name with the number of jewelry items in that category."""

    category: str
    count: int

