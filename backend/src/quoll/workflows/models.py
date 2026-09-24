from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from quoll.core.mixins import IdMixin, TimestampMixin
from quoll.db import Base, str_255

if TYPE_CHECKING:
    from quoll.attachments.models import Attachment


class Workflow(Base, IdMixin, TimestampMixin):
    name: Mapped[str_255] = mapped_column(unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # после публикации стадии менять нельзя - по ним уже едут заявки
    is_published: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", index=True
    )

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
    __table_args__ = (
        CheckConstraint(
            "NOT (is_terminal = TRUE AND consumes_capacity = TRUE)",
            name="chk_stage_terminal_no_capacity",
        ),
        # дублирует первичный ключ, но нужна как цель составного ключа
        # из interactions - чтобы стадия не оказалась из чужого воркфлоу
        UniqueConstraint("id", "workflow_id", name="uq_stages_id_workflow_id"),
    )

    workflow_id: Mapped[int] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str_255]
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # заявка закрыта, слот менеджера освобождается
    is_terminal: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", index=True
    )
    # стадия занимает слот менеджера
    consumes_capacity: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", index=True
    )
    # стадию не удаляют, а архивируют: на неё ссылаются история и документы
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    workflow: Mapped[Workflow] = relationship(back_populates="stages")


class TransitionAttachment(Base):
    transition_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_transitions.id", ondelete="CASCADE"), primary_key=True
    )
    attachment_id: Mapped[int] = mapped_column(
        ForeignKey("attachments.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class WorkflowTransition(Base, IdMixin, TimestampMixin):
    __table_args__ = (
        # петля из стадии в неё же бессмысленна и дала бы цикл блокировок
        # с архивацией - см. core/locking.py
        CheckConstraint(
            "from_stage_id IS DISTINCT FROM to_stage_id", name="chk_transition_no_loop"
        ),
        # начальная стадия - цель ребра из NULL, и она одна (П3)
        Index(
            "uq_transitions_one_start",
            "workflow_id",
            unique=True,
            postgresql_where=text("from_stage_id IS NULL AND is_active"),
        ),
        Index(
            "uq_transitions_active_edge",
            "workflow_id",
            "from_stage_id",
            "to_stage_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )

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
