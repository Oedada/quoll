from datetime import date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
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
from sqlalchemy.dialects.postgresql import JSONB
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
    """вуз; ключ - ИНН + КПП, а не название. Филиал со своим договором -
    отдельный вуз с тем же ИНН и своим КПП (М 3.1)"""

    __table_args__ = (
        Index(
            "uq_universities_inn_kpp",
            "inn",
            "kpp",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
    )

    # как в ЕГРЮЛ - для договора
    full_name: Mapped[str] = mapped_column(Text)
    # для интерфейса, отчётов и поиска
    short_name: Mapped[str_255] = mapped_column(index=True)
    inn: Mapped[str] = mapped_column(String(10))
    kpp: Mapped[str | None] = mapped_column(String(9), nullable=True)
    site: Mapped[str | None] = mapped_column(String(255), nullable=True)
    region: Mapped[str_255]
    city: Mapped[str_255]

    interactions: Mapped[list["Interaction"]] = relationship(
        back_populates="university"
    )


class Vendor(Base, IdMixin, TimestampMixin):
    """компания, выпускающая продукт; контакты - в общем справочнике"""

    name: Mapped[str_255] = mapped_column(unique=True, index=True)
    site: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # «Дочерняя», «ПАО (материнская)» - свободная пометка
    kind: Mapped[str | None] = mapped_column(String(255), nullable=True)


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
        # у вуза не больше одной незакрытой заявки (М 4)
        Index(
            "uq_interactions_open_per_university",
            "university_id",
            unique=True,
            postgresql_where=text("closed_at IS NULL"),
        ),
    )

    university_id: Mapped[int] = mapped_column(
        ForeignKey("universities.id", ondelete="RESTRICT"), index=True
    )

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

    # единственный признак закрытой: терминальная стадия или отменённый черновик
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    # проход точки невозврата или импорт подписанного договора
    signed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    planned_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # у досрочного закрытия и отмены; штатное завершение по ребру - без причины
    close_reason_id: Mapped[int | None] = mapped_column(
        ForeignKey("close_reasons.id", ondelete="RESTRICT"), nullable=True
    )

    # Relationships
    university: Mapped[University] = relationship(back_populates="interactions")
    workflow: Mapped[Workflow | None] = relationship()
    # viewonly, иначе эта связь и workflow спорят за право писать workflow_id
    state: Mapped[Stage | None] = relationship(viewonly=True)


class StageChangeKind(StrEnum):
    """как заявка попала на стадию"""

    TRANSITION = "TRANSITION"  # по ребру графа
    CLOSE = "CLOSE"  # досрочное закрытие, без ребра
    REOPEN = "REOPEN"  # переоткрытие закрытой
    RELOCATION = "RELOCATION"  # перенос при архивации стадии
    REJECTION = "REJECTION"  # отказ в аппруве увёл на доработку
    ROLLBACK = "ROLLBACK"  # откат руководителем на несколько шагов
    CANCEL = "CANCEL"  # отмена черновика, стадии нет
    PAUSE = "PAUSE"
    UNPAUSE = "UNPAUSE"
    BRANCH_ADDED = "BRANCH_ADDED"
    BRANCH_REMOVED = "BRANCH_REMOVED"
    SA_OPENED = "SA_OPENED"
    SA_APPROVED = "SA_APPROVED"
    SA_REJECTED = "SA_REJECTED"
    LICENSE_EXTENDED = "LICENSE_EXTENDED"
    CONTRACT_EXTENDED = "CONTRACT_EXTENDED"
    IMPORT = "IMPORT"
    COMMENT = "COMMENT"


class InteractionStageHistory(Base):
    """история движения заявки по стадиям - бизнес-история, не журнал.

    ссылки на стадии и ребро RESTRICT: стадии не удаляются, а архивируются,
    и история не должна терять, откуда и куда шла заявка
    """

    __tablename__ = "interaction_stage_history"
    __table_args__ = (
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{k}'" for k in StageChangeKind) + ")",
            name="chk_stage_history_kind",
        ),
        Index("ix_stage_history_interaction_created", "interaction_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    interaction_id: Mapped[int] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE")
    )
    # NULL - заявка встала на первую стадию из черновика; у событий без
    # движения (отмена черновика, пауза до принятия) пусты обе
    from_stage_id: Mapped[int | None] = mapped_column(
        ForeignKey("stages.id", ondelete="RESTRICT"), nullable=True
    )
    to_stage_id: Mapped[int | None] = mapped_column(
        ForeignKey("stages.id", ondelete="RESTRICT"), nullable=True
    )
    # NULL у закрытия, переоткрытия и переноса - они идут не по ребру
    transition_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_transitions.id", ondelete="RESTRICT"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(30))
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ход ветки продукта; NULL - ход самого взаимодействия
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
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
    # аппрув перехода по ребру с requires_approval
    TRANSITION = "TRANSITION"


class RequestStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class InteractionRequest(Base):
    """просьба менеджера руководителю: передать проект или закрыть досрочно.
    Решает руководитель - кому передать и закрывать ли (П8)"""

    __table_args__ = (
        CheckConstraint(
            "kind IN ('TRANSFER', 'CLOSE', 'TRANSITION')", name="chk_request_kind"
        ),
        # у перехода - ребро и его цель; у остальных ребра нет
        CheckConstraint(
            "(kind = 'TRANSITION') = (transition_id IS NOT NULL)",
            name="chk_request_transition_edge",
        ),
        CheckConstraint(
            "kind <> 'TRANSITION' OR (target_stage_id IS NOT NULL "
            "AND target_manager_id IS NULL)",
            name="chk_request_transition_target",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')",
            name="chk_request_status",
        ),
        # у закрытия цель - стадия, у передачи - предложение менеджера, не стадия
        # закрытие заявки - в терминальную стадию; ветки - без стадии,
        # она остаётся на своём шаге (П6). Причина - всегда
        CheckConstraint(
            "kind <> 'CLOSE' OR (target_manager_id IS NULL "
            "AND close_reason_id IS NOT NULL "
            "AND (branch_id IS NULL) = (target_stage_id IS NOT NULL))",
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
        # аппрувы разных веток ждут параллельно
        Index(
            "uq_interaction_requests_pending",
            "interaction_id",
            "kind",
            "branch_id",
            unique=True,
            postgresql_where=text("status = 'PENDING'"),
            postgresql_nulls_not_distinct=True,
        ),
        CheckConstraint(
            "branch_id IS NULL OR kind IN ('TRANSITION', 'CLOSE')",
            name="chk_request_branch_only_transition",
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
    transition_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_transitions.id", ondelete="RESTRICT"), nullable=True
    )
    # аппрув шага или закрытие ветки
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=True
    )
    close_reason_id: Mapped[int | None] = mapped_column(
        ForeignKey("close_reasons.id", ondelete="RESTRICT"), nullable=True
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
        CheckConstraint(
            "status IN ('ACTIVE', 'PENDING', 'REJECTED')", name="chk_document_status"
        ),
        CheckConstraint(
            "kind <> 'OTHER' OR description IS NOT NULL",
            name="chk_document_other_described",
        ),
        CheckConstraint(
            "kind = 'CONTRACT' OR (contract_number IS NULL AND "
            "contract_signed_at IS NULL AND contract_valid_until IS NULL)",
            name="chk_document_contract_fields",
        ),
        CheckConstraint(
            "kind <> 'CONTRACT' OR contract_number IS NOT NULL",
            name="chk_document_contract_number",
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
    # внутреннее название - не имя файла: «Договор №12» вместо scan_0042.pdf
    title: Mapped[str_255]
    # вид из справочника: по нему переход проверяет нужные файлы
    kind: Mapped[str] = mapped_column(
        ForeignKey("document_kinds.code", ondelete="RESTRICT"),
        index=True,
    )
    # что за файл; обязательно у вида «другое»
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # реквизиты - только у договора; новая версия копирует их, если не заданы
    contract_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contract_signed_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    # metadata в декларативной модели занято самим SQLAlchemy
    meta: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    # файл менеджера не на текущий шаг ждёт руководителя; отклонённый
    # остаётся в списке, но из цепочки версий выходит
    status: Mapped[str] = mapped_column(
        String(20), default="ACTIVE", server_default="ACTIVE"
    )
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[created_at_dt]


class DocumentStatus(StrEnum):
    ACTIVE = "ACTIVE"
    PENDING = "PENDING"
    REJECTED = "REJECTED"


class InteractionStageValues(Base):
    """значения полей шага: одна строка на заявку и стадию. История правок -
    в журнале, поэтому не EAV и не версии"""

    __tablename__ = "interaction_stage_values"
    __table_args__ = (
        Index(
            "uq_stage_values_interaction_stage_branch",
            "interaction_id",
            "stage_id",
            "branch_id",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    interaction_id: Mapped[int] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE"), index=True
    )
    stage_id: Mapped[int] = mapped_column(ForeignKey("stages.id", ondelete="RESTRICT"))
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=True
    )
    values: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    updated_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), onupdate=text("now()")
    )
    # правка пройденного шага, ждущая руководителя; действуют values
    pending_values: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    pending_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class ContractStatus(StrEnum):
    """ветка в составе договора до подписания"""

    PROPOSED = "PROPOSED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class BranchOrigin(StrEnum):
    CONTRACT = "CONTRACT"
    SUPPLEMENTARY_AGREEMENT = "SUPPLEMENTARY_AGREEMENT"


class TransferStatus(StrEnum):
    NOT_TRANSFERRED = "NOT_TRANSFERRED"
    TRANSFERRED = "TRANSFERRED"


class Branch(Base):
    """ветка = ИТ-программа и не больше одного её продукта (М 3.12).

    до подписания - черновик состава (стадии нет), при подписании одобренные
    встают на начало шагов веток, и шаги 5-8 идут по каждой отдельно.
    Своих блокировок нет - всё под блокировкой взаимодействия
    """

    __tablename__ = "branches"
    __table_args__ = (
        Index(
            "uq_branches_interaction_program_product",
            "interaction_id",
            "program_id",
            "product_id",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
        CheckConstraint(
            "contract_status IN ('PROPOSED', 'APPROVED', 'REJECTED')",
            name="chk_branch_contract_status",
        ),
        CheckConstraint(
            "state_id IS NULL OR contract_status = 'APPROVED'",
            name="chk_branch_on_stage_is_approved",
        ),
        CheckConstraint(
            "transfer_status IN ('NOT_TRANSFERRED', 'TRANSFERRED')",
            name="chk_branch_transfer_status",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    interaction_id: Mapped[int] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE"), index=True
    )
    # пусто только у импорта (М 3.12)
    program_id: Mapped[int | None] = mapped_column(
        ForeignKey("it_programs.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    contract_status: Mapped[str] = mapped_column(
        String(20),
        default=ContractStatus.PROPOSED,
        server_default=ContractStatus.PROPOSED,
    )
    origin: Mapped[str] = mapped_column(
        String(30), default=BranchOrigin.CONTRACT, server_default=BranchOrigin.CONTRACT
    )
    state_id: Mapped[int | None] = mapped_column(
        ForeignKey("stages.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # подписание договора или одобрение допсоглашения - от него считается жизнь ветки
    opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    close_reason_id: Mapped[int | None] = mapped_column(
        ForeignKey("close_reasons.id", ondelete="RESTRICT"), nullable=True
    )
    # лицензия: until = подписание + срок, продление меняет только until
    license_signed_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    license_term_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    license_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    transfer_status: Mapped[str] = mapped_column(
        String(20),
        default=TransferStatus.NOT_TRANSFERRED,
        server_default=TransferStatus.NOT_TRANSFERRED,
    )
    teachers_trained: Mapped[int | None] = mapped_column(Integer, nullable=True)
    added_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[created_at_dt]
