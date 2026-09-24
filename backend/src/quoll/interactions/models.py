from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from quoll.core.mixins import IdMixin, TimestampMixin
from quoll.db import Base, created_at_dt, str_255
from quoll.workflows.models import Stage, Workflow


class PauseState(StrEnum):
    """состояния паузы заявки"""

    ACTIVE = "ACTIVE"
    PAUSED_MANUAL = "PAUSED_MANUAL"
    PAUSED_TIMED = "PAUSED_TIMED"
    EXPIRED_WAITING_CAPACITY = "EXPIRED_WAITING_CAPACITY"


class University(Base, IdMixin, TimestampMixin):
    name: Mapped[str_255] = mapped_column(unique=True, index=True)
    contacts: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    interactions: Mapped[list["Interaction"]] = relationship(
        back_populates="university"
    )


class Vendor(Base, IdMixin, TimestampMixin):
    name: Mapped[str_255] = mapped_column(unique=True, index=True)
    contacts: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    interactions: Mapped[list["Interaction"]] = relationship(back_populates="vendor")


class Interaction(Base, IdMixin, TimestampMixin):
    __table_args__ = (
        # стадия должна быть из того же воркфлоу, что и заявка.
        # составной ключ с NULL не проверяется, поэтому пару
        # "стадия есть, воркфлоу нет" ловит CHECK ниже
        ForeignKeyConstraint(
            ["state_id", "workflow_id"],
            ["stages.id", "stages.workflow_id"],
            ondelete="RESTRICT",
            name="fk_interactions_state_id_workflow_id_stages",
        ),
        CheckConstraint(
            "state_id IS NULL OR workflow_id IS NOT NULL",
            name="chk_interaction_stage_requires_workflow",
        ),
        CheckConstraint(
            "(pause_state = 'ACTIVE' AND is_paused = FALSE AND paused_until IS NULL) OR "
            "(pause_state = 'PAUSED_MANUAL' AND is_paused = TRUE AND paused_until IS NULL) OR "
            "(pause_state = 'PAUSED_TIMED' AND is_paused = TRUE AND paused_until IS NOT NULL) OR "
            "(pause_state = 'EXPIRED_WAITING_CAPACITY' AND is_paused = TRUE AND paused_until IS NULL)",
            name="chk_interaction_pause_state",
        ),
    )

    university_id: Mapped[int] = mapped_column(
        ForeignKey("universities.id", ondelete="RESTRICT"), index=True
    )
    vendor_id: Mapped[int] = mapped_column(
        ForeignKey("vendors.id", ondelete="RESTRICT"), index=True
    )

    it_program: Mapped[str | None] = mapped_column(String(255), nullable=True)
    it_product: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # RESTRICT, а не SET NULL - иначе обнуление порвёт составной ключ и CHECK
    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    state_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    # только на managers, владельцем заявки может быть лишь менеджер,
    # а RESTRICT не даёт удалить менеджера с заявками
    owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("managers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # руководитель, создавший заявку. Пока владельца нет, это его черновик
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # кто владел раньше - авторство переживает смену роли менеджера
    last_owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    is_paused: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", index=True
    )
    pause_state: Mapped[str] = mapped_column(
        String(30),
        default=PauseState.ACTIVE,
        server_default=PauseState.ACTIVE,
        index=True,
    )
    paused_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    # причина текущей паузы, история пауз - в журнале
    pause_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    university: Mapped[University] = relationship(back_populates="interactions")
    vendor: Mapped[Vendor] = relationship(back_populates="interactions")
    workflow: Mapped[Workflow | None] = relationship()
    # viewonly, иначе эта связь и workflow спорят за право писать workflow_id
    state: Mapped[Stage | None] = relationship(viewonly=True)


class StageChangeKind(StrEnum):
    """как заявка попала на стадию"""

    TRANSITION = "TRANSITION"  # по ребру графа
    CLOSE = "CLOSE"  # досрочное закрытие, без ребра
    REOPEN = "REOPEN"  # переоткрытие закрытой
    RELOCATION = "RELOCATION"  # перенос при архивации стадии


class InteractionStageHistory(Base):
    """история движения заявки по стадиям - бизнес-история, не журнал.

    ссылки на стадии и ребро RESTRICT: стадии не удаляются, а архивируются,
    и история не должна терять, откуда и куда шла заявка
    """

    __tablename__ = "interaction_stage_history"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('TRANSITION', 'CLOSE', 'REOPEN', 'RELOCATION')",
            name="chk_stage_history_kind",
        ),
        Index("ix_stage_history_interaction_created", "interaction_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    interaction_id: Mapped[int] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE")
    )
    # NULL - заявка встала на первую стадию из черновика
    from_stage_id: Mapped[int | None] = mapped_column(
        ForeignKey("stages.id", ondelete="RESTRICT"), nullable=True
    )
    to_stage_id: Mapped[int] = mapped_column(
        ForeignKey("stages.id", ondelete="RESTRICT")
    )
    # NULL у закрытия, переоткрытия и переноса - они идут не по ребру
    transition_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_transitions.id", ondelete="RESTRICT"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[created_at_dt]


class InteractionAssignment(Base):
    """кто и когда вёл заявку. Нужна, чтобы менеджер видел бывшие свои -
    last_owner_id помнит только один шаг назад"""

    __table_args__ = (
        # открытая запись одна - та, что совпадает с текущим владельцем
        Index(
            "uq_interaction_assignments_open",
            "interaction_id",
            unique=True,
            postgresql_where=text("released_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    interaction_id: Mapped[int] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE"), index=True
    )
    manager_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assigned_at: Mapped[created_at_dt]
    released_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class RequestKind(StrEnum):
    TRANSFER = "TRANSFER"
    CLOSE = "CLOSE"


class RequestStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class InteractionRequest(Base):
    """просьба менеджера руководителю: передать проект или закрыть досрочно.
    Решает руководитель - кому передать и закрывать ли (П8)"""

    __table_args__ = (
        CheckConstraint("kind IN ('TRANSFER', 'CLOSE')", name="chk_request_kind"),
        CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')",
            name="chk_request_status",
        ),
        # у закрытия цель - стадия, у передачи - предложение менеджера, не стадия
        CheckConstraint(
            "kind <> 'CLOSE' OR (target_stage_id IS NOT NULL "
            "AND target_manager_id IS NULL)",
            name="chk_request_close_target",
        ),
        CheckConstraint(
            "kind <> 'TRANSFER' OR target_stage_id IS NULL",
            name="chk_request_transfer_target",
        ),
        # решено ровно тогда, когда не ждёт. По времени, а не по decided_by -
        # его обнулит удаление пользователя
        CheckConstraint(
            "(status = 'PENDING') = (decided_at IS NULL)",
            name="chk_request_decided",
        ),
        Index(
            "uq_interaction_requests_pending",
            "interaction_id",
            "kind",
            unique=True,
            postgresql_where=text("status = 'PENDING'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    interaction_id: Mapped[int] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(20))
    requested_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # владелец на момент подачи - сменился, и просьба устарела
    from_owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    target_manager_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    target_stage_id: Mapped[int | None] = mapped_column(
        ForeignKey("stages.id", ondelete="RESTRICT"), nullable=True
    )
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(20), default=RequestStatus.PENDING, server_default="PENDING"
    )
    decided_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[created_at_dt]


class InteractionDocument(Base):
    """файл проекта, приложенный на стадии заявки. Новая версия ссылается на
    прежнюю, прежняя остаётся - «уходит вниз и сереет»"""

    __table_args__ = (
        # цель составного ключа ниже: версия - только из той же заявки
        UniqueConstraint("id", "interaction_id", name="uq_documents_id_interaction"),
        ForeignKeyConstraint(
            ["replaces_document_id", "interaction_id"],
            ["interaction_documents.id", "interaction_documents.interaction_id"],
            # только ссылку: interaction_id обнулять нельзя
            ondelete="SET NULL (replaces_document_id)",
            name="fk_documents_replaces_same_interaction",
        ),
        # у версии один преемник - иначе цепочка раздвоится
        Index(
            "uq_documents_replaces",
            "replaces_document_id",
            unique=True,
            postgresql_where=text("replaces_document_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    interaction_id: Mapped[int] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE"), index=True
    )
    # документ без файла бессмыслен, и одно вложение - один документ
    attachment_id: Mapped[int] = mapped_column(
        ForeignKey("attachments.id", ondelete="CASCADE"), unique=True
    )
    stage_id: Mapped[int] = mapped_column(ForeignKey("stages.id", ondelete="RESTRICT"))
    uploaded_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    replaces_document_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[created_at_dt]
