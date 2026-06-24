from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Float,
    Boolean,
    DateTime,
    func,
)

from .database import Base


class Glasses(Base):
    """ORM model representing a glasses item with its 3D model metadata."""

    __tablename__ = "glasses"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(200), nullable=False, index=True)
    category = Column(String(100), nullable=False, default="eyeglasses", index=True)
    brand = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)

    # File storage
    glb_filename = Column(String(255), nullable=False, unique=True)
    original_filename = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=True)  # Size in bytes

    # 3D Transform — Scale
    scale_x = Column(Float, nullable=False, default=1.0)
    scale_y = Column(Float, nullable=False, default=1.0)
    scale_z = Column(Float, nullable=False, default=1.0)

    # 3D Transform — Position offset
    position_offset_x = Column(Float, nullable=False, default=0.0)
    position_offset_y = Column(Float, nullable=False, default=0.0)
    position_offset_z = Column(Float, nullable=False, default=0.0)

    # 3D Transform — Rotation offset (radians)
    rotation_offset_x = Column(Float, nullable=False, default=0.0)
    rotation_offset_y = Column(Float, nullable=False, default=0.0)
    rotation_offset_z = Column(Float, nullable=False, default=0.0)

    # Physical attributes
    bridge_width = Column(Float, nullable=False, default=0.04)
    temple_length = Column(Float, nullable=False, default=0.12)
    lens_opacity = Column(Float, nullable=False, default=0.3)
    frame_color = Column(String(50), nullable=True)

    # Status
    is_active = Column(Boolean, nullable=False, default=True)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    def __repr__(self) -> str:
        return f"<Glasses(id={self.id}, name='{self.name}', category='{self.category}')>"
