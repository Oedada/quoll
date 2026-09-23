import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from quoll.db import Base, created_at_dt


class PendingActionType(StrEnum):
    OFFBOARDING_MANAGER = "OFFBOARDING_MANAGER"
    OFFBOARDING_SUPERVISER = "OFFBOARDING_SUPERVISER"
    ROLE_TRANSITION = "ROLE_TRANSITION"


class PendingActionStatus(StrEnum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


ACTIVE_ACTION_STATUSES = (PendingActionStatus.PENDING, PendingActionStatus.IN_PROGRESS)
_ACTIVE_STATUS_SQL = "status IN ('PENDING', 'IN_PROGRESS')"

DEFAULT_MAX_ATTEMPTS = 5
LEASE_DURATION_SECONDS = 60


class PendingOrgAction(Base):
    """Задача оргструктуры, которую нельзя выполнить прямо сейчас.

    Берёт её фоновый воркер, поэтому есть аренда: lease_until - до какого момента
    задача за воркером, lease_version отсекает запись уснувшего. Списки заявок и
    подчинённых в payload не храним, они перечитываются под блокировкой
    """

    __table_args__ = (
        CheckConstraint(
            "action_type IN ('OFFBOARDING_MANAGER', 'OFFBOARDING_SUPERVISER', "
            "'ROLE_TRANSITION')",
            name="chk_pending_org_action_type",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FAILED')",
            name="chk_pending_org_action_status",
        ),
        # Уникальность только среди активных задач: завершённые циклы не мешают
        # поставить задачу того же типа повторно
        Index(
            "uq_active_pending_org_action",
            "action_type",
            "target_id",
            unique=True,
            postgresql_where=text(_ACTIVE_STATUS_SQL),
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    action_type: Mapped[str] = mapped_column(String(50), index=True)
    # Очередь задач, а не история: без пользователя задача бессмысленна, поэтому
    # CASCADE. Историю переходов хранит audit_logs, он удалению не подвержен
    target_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Нужен только для скоупинга видимости задач руководителем
    origin_supervisor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(30),
        default=PendingActionStatus.PENDING,
        server_default=PendingActionStatus.PENDING,
        index=True,
    )
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    worker_id: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True
    )
    lease_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    lease_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    retry_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    max_attempts: Mapped[int] = mapped_column(
        Integer,
        default=DEFAULT_MAX_ATTEMPTS,
        server_default=str(DEFAULT_MAX_ATTEMPTS),
    )
    next_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[created_at_dt] = mapped_column(index=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
