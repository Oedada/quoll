"""Заглушки интеграций (LMS, сайт): статистика, сопоставления, очередь
несопоставленных, журнал запусков, предложения по LMS (К, план integrations-plan.md)"""

from datetime import date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Date,
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

from quoll.core.mixins import IdMixin
from quoll.db import Base, created_at_dt, str_255


class StatsSource(StrEnum):
    LMS = "LMS"
    FILE = "FILE"


class EnrollmentSource(StrEnum):
    SITE = "SITE"
    FILE = "FILE"


class MappingKind(StrEnum):
    COURSE = "COURSE"
    UNIVERSITY = "UNIVERSITY"
    PROGRAM = "PROGRAM"


class UnmatchedFlow(StrEnum):
    B1 = "B1"
    B2 = "B2"


class UnmatchedStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class RunFlow(StrEnum):
    I2 = "I2"
    I1 = "I1"
    B1 = "B1"
    B2 = "B2"
    EXPORT = "EXPORT"


class RunTrigger(StrEnum):
    SCHEDULE = "SCHEDULE"
    MANUAL = "MANUAL"
    FILE = "FILE"


class RunStatus(StrEnum):
    DONE = "DONE"
    FAILED = "FAILED"


class ProposalKind(StrEnum):
    CREATE_INTERACTION = "CREATE_INTERACTION"
    ADD_PROGRAM = "ADD_PROGRAM"


class ProposalStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class LmsStats(Base, IdMixin):
    """статистика LMS по паре вуз+программа - последняя принятая (В2)"""

    __tablename__ = "lms_stats"
    __table_args__ = (
        Index("uq_lms_stats_pair", "university_id", "program_id", unique=True),
        CheckConstraint("students >= 0", name="chk_lms_stats_students"),
        CheckConstraint("streams >= 0", name="chk_lms_stats_streams"),
        CheckConstraint(
            "teachers_trained IS NULL OR teachers_trained >= 0",
            name="chk_lms_stats_teachers",
        ),
        CheckConstraint("source IN ('LMS', 'FILE')", name="chk_lms_stats_source"),
    )

    # индекс по вузу не нужен - его покрывает uq_lms_stats_pair
    university_id: Mapped[int] = mapped_column(
        ForeignKey("universities.id", ondelete="CASCADE")
    )
    program_id: Mapped[int] = mapped_column(
        ForeignKey("it_programs.id", ondelete="CASCADE"), index=True
    )
    students: Mapped[int] = mapped_column(Integer)
    streams: Mapped[int] = mapped_column(Integer)
    teachers_trained: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(String(10))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), onupdate=text("now()")
    )


class SiteEnrollment(Base, IdMixin):
    """записи на обучение с сайта (Р1) - справочно, на воркфлоу не влияют.
    ПДн не хранятся - только отпечаток email"""

    __tablename__ = "site_enrollments"
    __table_args__ = (
        CheckConstraint(
            "source IN ('SITE', 'FILE')", name="chk_site_enrollment_source"
        ),
        CheckConstraint("stream >= 0", name="chk_site_enrollment_stream"),
    )

    order_number: Mapped[str_255] = mapped_column(unique=True)
    program_id: Mapped[int] = mapped_column(
        ForeignKey("it_programs.id", ondelete="CASCADE"), index=True
    )
    stream: Mapped[int] = mapped_column(Integer)
    # дата загрузки - в записи сайта своей даты нет (К §2.1)
    enrolled_on: Mapped[date] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(10))
    email_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[created_at_dt]
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), onupdate=text("now()")
    )


class IntegrationMapping(Base, IdMixin):
    """ручное сопоставление внешнего ключа заглушки с записью базы"""

    __tablename__ = "integration_mappings"
    __table_args__ = (
        Index("uq_integration_mappings_key", "kind", "external_key", unique=True),
        CheckConstraint(
            "kind IN ('COURSE', 'UNIVERSITY', 'PROGRAM')",
            name="chk_integration_mapping_kind",
        ),
    )

    kind: Mapped[str] = mapped_column(String(20))
    external_key: Mapped[str_255]
    target_id: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[created_at_dt]


class IntegrationUnmatched(Base, IdMixin):
    """запись В1/В2, которую не удалось сопоставить. Решение админа - новое
    сопоставление mapping_kind + external_key и повторный разбор всех ждущих
    записей с тем же ключом"""

    __tablename__ = "integration_unmatched"
    __table_args__ = (
        Index(
            "uq_integration_unmatched_pending",
            "flow",
            "record_key",
            unique=True,
            postgresql_where=text("status = 'PENDING'"),
        ),
        Index("ix_integration_unmatched_key", "mapping_kind", "external_key"),
        CheckConstraint("flow IN ('B1', 'B2')", name="chk_integration_unmatched_flow"),
        CheckConstraint(
            "code IN ('INT-404', 'INT-409')", name="chk_integration_unmatched_code"
        ),
        CheckConstraint(
            "mapping_kind IN ('COURSE', 'UNIVERSITY', 'PROGRAM')",
            name="chk_integration_unmatched_mapping_kind",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED')",
            name="chk_integration_unmatched_status",
        ),
        CheckConstraint(
            "(status = 'PENDING') = (decided_at IS NULL)",
            name="chk_integration_unmatched_decided",
        ),
    )

    flow: Mapped[str] = mapped_column(String(5))
    # ключ записи потока: номер заказа у В1, пара ключей вуза и программы у В2
    record_key: Mapped[str_255]
    code: Mapped[str] = mapped_column(String(10))
    # что не нашлось и по какому ключу его запомнить
    mapping_kind: Mapped[str] = mapped_column(String(20))
    external_key: Mapped[str_255]
    # запись без ПДн: у В1 вместо email - отпечаток
    record: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # id подходящих записей при INT-409
    candidates: Mapped[list[int]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    status: Mapped[str] = mapped_column(
        String(20), default=UnmatchedStatus.PENDING, server_default="PENDING"
    )
    decided_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[created_at_dt]


class IntegrationRun(Base, IdMixin):
    """журнал запусков обмена - ручных и ночных; пишется по итогу запуска,
    идущий обмен держит advisory-блокировку потока (flows._hold)"""

    __tablename__ = "integration_runs"
    __table_args__ = (
        Index("ix_integration_runs_flow", "flow", "id"),
        CheckConstraint(
            "flow IN ('I2', 'I1', 'B1', 'B2', 'EXPORT')",
            name="chk_integration_run_flow",
        ),
        CheckConstraint(
            "trigger IN ('SCHEDULE', 'MANUAL', 'FILE')",
            name="chk_integration_run_trigger",
        ),
        CheckConstraint(
            "status IN ('DONE', 'FAILED')", name="chk_integration_run_status"
        ),
    )

    flow: Mapped[str] = mapped_column(String(10))
    trigger: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10))
    started_at: Mapped[created_at_dt]
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    counters: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # что приняла заглушка при И1/И2 - для показа админу
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)


class IntegrationProposal(Base, IdMixin):
    """предложение по итогам В2: завести заявку вузу или добавить программу
    существующей (К §4). Решает руководитель - как обычные просьбы, но своей
    формой: заявки ещё нет, а у ADD_PROGRAM цель - ветка, не шаг"""

    __tablename__ = "integration_proposals"
    __table_args__ = (
        Index(
            "uq_integration_proposals_pending",
            "kind",
            "university_id",
            "program_id",
            unique=True,
            postgresql_where=text("status = 'PENDING'"),
        ),
        CheckConstraint(
            "kind IN ('CREATE_INTERACTION', 'ADD_PROGRAM')",
            name="chk_integration_proposal_kind",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED')",
            name="chk_integration_proposal_status",
        ),
        CheckConstraint(
            "(status = 'PENDING') = (decided_at IS NULL)",
            name="chk_integration_proposal_decided",
        ),
    )

    kind: Mapped[str] = mapped_column(String(20))
    university_id: Mapped[int] = mapped_column(
        ForeignKey("universities.id", ondelete="CASCADE"), index=True
    )
    program_id: Mapped[int] = mapped_column(
        ForeignKey("it_programs.id", ondelete="CASCADE"), index=True
    )
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(20), default=ProposalStatus.PENDING, server_default="PENDING"
    )
    decided_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # выбор воркфлоу и результат - только у CREATE_INTERACTION
    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="RESTRICT"), nullable=True
    )
    result_interaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("interactions.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[created_at_dt]
