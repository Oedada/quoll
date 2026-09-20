from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from quoll.core.mixins import IdMixin, TimestampMixin
from quoll.db import Base, str_255

if TYPE_CHECKING:
    from quoll.attachments.models import Attachment


class Workflow(Base, IdMixin, TimestampMixin):
    name: Mapped[str_255] = mapped_column(unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    stages: Mapped[list["Stage"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        order_by="Stage.position",
    )
    transitions: Mapped[list["WorkflowTransition"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
    )


class Stage(Base, IdMixin, TimestampMixin):
    workflow_id: Mapped[int] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str_255]
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)

    workflow: Mapped[Workflow] = relationship(back_populates="stages")


class TransitionAttachment(Base):
    transition_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_transitions.id", ondelete="CASCADE"), primary_key=True
    )
    attachment_id: Mapped[int] = mapped_column(
        ForeignKey("attachments.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class WorkflowTransition(Base, IdMixin, TimestampMixin):
    workflow_id: Mapped[int] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )
    from_stage_id: Mapped[int | None] = mapped_column(
        ForeignKey("stages.id", ondelete="CASCADE"), nullable=True, index=True
    )
    to_stage_id: Mapped[int] = mapped_column(
        ForeignKey("stages.id", ondelete="CASCADE"), index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    name: Mapped[str_255]
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    required_actions: Mapped[list[str]] = mapped_column(JSON, default=list)

    workflow: Mapped[Workflow] = relationship(back_populates="transitions")
    from_stage: Mapped["Stage | None"] = relationship(foreign_keys=[from_stage_id])
    to_stage: Mapped[Stage] = relationship(foreign_keys=[to_stage_id])
    attachments: Mapped[list["Attachment"]] = relationship(
        "Attachment",
        secondary="transition_attachments",
        lazy="selectin",
    )
