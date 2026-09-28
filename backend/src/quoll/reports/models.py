"""Задания выгрузки отчётов - очередь с арендой (reports-design §4.1, §9)"""

from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from quoll.db import Base, created_at_dt


class ExportStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"
    TIMED_OUT = "TIMED_OUT"
    EXPIRED = "EXPIRED"


class ReportExport(Base):
    __tablename__ = "report_exports"
    __table_args__ = (
        CheckConstraint(
            "format IN ('xlsx', 'xls', 'pdf')", name="chk_report_export_format"
        ),
        CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'TIMED_OUT', 'EXPIRED')",
            name="chk_report_export_status",
        ),
        # аренда есть только у строящегося - иначе жнец и CAS спорили бы
        CheckConstraint(
            "(status = 'RUNNING') = (lease_until IS NOT NULL AND worker_id IS NOT NULL)",
            name="chk_report_export_running",
        ),
        # у просроченного ключ остаётся для следа; DONE без файла не бывает (IR5)
        CheckConstraint(
            "(status IN ('DONE', 'EXPIRED')) = (storage_key IS NOT NULL)",
            name="chk_report_export_done",
        ),
        CheckConstraint(
            "(status IN ('FAILED', 'TIMED_OUT')) = (error_code IS NOT NULL)",
            name="chk_report_export_error",
        ),
        # очередь и позиция в ней
        Index("ix_report_exports_queue", "status", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # пользователей не удаляют - RESTRICT
    requested_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    format: Mapped[str] = mapped_column(String(10))
    # снимок параметров: файл строится по тем же, что предпросмотр (IR2)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(
        String(20), default=ExportStatus.QUEUED, server_default=ExportStatus.QUEUED
    )
    error_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    worker_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_version: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0")
    )
    lease_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[created_at_dt] = mapped_column(index=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
