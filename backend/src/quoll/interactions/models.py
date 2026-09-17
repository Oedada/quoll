from typing import Any

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from quoll.core.mixins import IdMixin, TimestampMixin
from quoll.db import Base, str_255
from quoll.workflows.models import Stage, Workflow


class University(Base, IdMixin, TimestampMixin):
    name: Mapped[str_255] = mapped_column(unique=True, index=True)
    contacts: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    interactions: Mapped[list["Interaction"]] = relationship(
        back_populates="university"
    )


class Vendor(Base, IdMixin, TimestampMixin):
    name: Mapped[str_255] = mapped_column(unique=True, index=True)
    contacts: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    interactions: Mapped[list["Interaction"]] = relationship(
        back_populates="vendor"
    )


class Interaction(Base, IdMixin, TimestampMixin):
    university_id: Mapped[int] = mapped_column(
        ForeignKey("universities.id", ondelete="RESTRICT"), index=True
    )
    vendor_id: Mapped[int] = mapped_column(
        ForeignKey("vendors.id", ondelete="RESTRICT"), index=True
    )

    it_program: Mapped[str | None] = mapped_column(String(255), nullable=True)
    it_product: Mapped[str | None] = mapped_column(String(255), nullable=True)

    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="SET NULL"), nullable=True, index=True
    )
    state_id: Mapped[int | None] = mapped_column(
        ForeignKey("stages.id", ondelete="SET NULL"), nullable=True, index=True
    )

    history: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    owner_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # Relationships
    university: Mapped[University] = relationship(back_populates="interactions")
    vendor: Mapped[Vendor] = relationship(back_populates="interactions")
    workflow: Mapped[Workflow | None] = relationship()
    state: Mapped[Stage | None] = relationship()
