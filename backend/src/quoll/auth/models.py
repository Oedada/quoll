from __future__ import annotations

import logging
from datetime import datetime
from enum import Enum, StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from quoll.core.mixins import TimestampMixin
from quoll.core.system_defaults import SystemDefaults
from quoll.db import Base, created_at_dt, str_255

logger = logging.getLogger(__name__)


class UserRole(Enum):
    MANAGER = "manager"
    SUPERVISER = "superviser"
    ADMIN = "admin"


class RoleTransitionStatus(StrEnum):
    """Статус смены роли: жизненный цикл строго бинарен NONE <-> PENDING"""

    NONE = "NONE"
    PENDING = "PENDING"


class IdentitySyncStatus(StrEnum):
    """Статус синхронизации локальной проекции пользователя с Keycloak"""

    OK = "OK"
    ROLE_MAPPING_CONFLICT = "ROLE_MAPPING_CONFLICT"


class ManualWorkloadStatus(StrEnum):
    """Ручной статус готовности менеджера брать новые проекты"""

    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"


class Session(Base):
    """Серверная сессия. В куке лежит случайный ключ, здесь только его хеш

    Access-токен не хранится. Refresh-токен хранится зашифрованным
    он нужен для выхода из Keycloak и для периодического чека
    """

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(255), index=True)
    refresh_token: Mapped[str] = mapped_column(Text)
    created_at: Mapped[created_at_dt]
    # Срок берётся из refresh_expires_in Keycloak и продлевается при сверке
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_validated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class User(Base, TimestampMixin):
    """проекция учетной записи из Keycloak

    поля профиля и is_active синхронизируются из Keycloak в фоне
    """

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role_transition_status IN ('NONE', 'PENDING')",
            name="chk_user_role_transition_status",
        ),
        CheckConstraint(
            "identity_sync_status IN ('OK', 'ROLE_MAPPING_CONFLICT')",
            name="chk_user_identity_sync_status",
        ),
    )

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(
            UserRole,
            name="userrole",
            values_callable=lambda enum: [member.value for member in enum],
        ),
        index=True,
    )
    role_transition_status: Mapped[str] = mapped_column(
        String(20),
        default=RoleTransitionStatus.NONE,
        server_default=RoleTransitionStatus.NONE,
        index=True,
    )
    identity_sync_status: Mapped[str] = mapped_column(
        String(50),
        default=IdentitySyncStatus.OK,
        server_default=IdentitySyncStatus.OK,
        index=True,
    )
    username: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    first_name: Mapped[str_255]
    last_name: Mapped[str_255]
    # новая запись неактивна, пока Keycloak не подтвердит enabled
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", index=True
    )

    __mapper_args__ = {"polymorphic_on": "role"}  # noqa: RUF012


class Superviser(User):
    __tablename__ = "supervisers"
    __table_args__ = (
        CheckConstraint(
            f"max_subordinates BETWEEN {SystemDefaults.MIN_CAPACITY_LIMIT} "
            f"AND {SystemDefaults.MAX_CAPACITY_LIMIT}",
            name="chk_superviser_max_subordinates",
        ),
    )

    id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    max_subordinates: Mapped[int] = mapped_column(
        Integer,
        default=SystemDefaults.DEFAULT_MAX_SUBORDINATES,
        server_default=str(SystemDefaults.DEFAULT_MAX_SUBORDINATES),
    )

    __mapper_args__ = {  # noqa: RUF012
        "polymorphic_identity": UserRole.SUPERVISER,
        "polymorphic_load": "selectin",
    }

    managers: Mapped[list[Manager]] = relationship(
        back_populates="superviser",
        foreign_keys="Manager.superviser_id",
        passive_deletes=True,
    )


class Manager(User):
    __tablename__ = "managers"
    __table_args__ = (
        CheckConstraint(
            "manual_workload_status IN ('available', 'unavailable')",
            name="chk_manager_manual_workload_status",
        ),
        CheckConstraint(
            f"max_active_projects BETWEEN {SystemDefaults.MIN_CAPACITY_LIMIT} "
            f"AND {SystemDefaults.MAX_CAPACITY_LIMIT}",
            name="chk_manager_max_active_projects",
        ),
    )

    id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    superviser_id: Mapped[str | None] = mapped_column(
        ForeignKey("supervisers.id", ondelete="RESTRICT"), index=True
    )
    manual_workload_status: Mapped[str] = mapped_column(
        String(50),
        default=ManualWorkloadStatus.AVAILABLE,
        server_default=ManualWorkloadStatus.AVAILABLE,
        index=True,
    )
    max_active_projects: Mapped[int] = mapped_column(
        Integer,
        default=SystemDefaults.DEFAULT_MAX_ACTIVE_PROJECTS,
        server_default=str(SystemDefaults.DEFAULT_MAX_ACTIVE_PROJECTS),
    )

    __mapper_args__ = {  # noqa: RUF012
        "polymorphic_identity": UserRole.MANAGER,
        "polymorphic_load": "selectin",
    }

    superviser: Mapped[Superviser | None] = relationship(
        back_populates="managers",
        foreign_keys=[superviser_id],
    )


class Admin(User):
    __tablename__ = "admins"

    id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )

    __mapper_args__ = {  # noqa: RUF012
        "polymorphic_identity": UserRole.ADMIN,
        "polymorphic_load": "selectin",
    }


def user_class_for_role(role: UserRole) -> type[User]:
    """подтип для роли, создавать базовый User нельзя, иначе строка
    ляжет в users без пары в managers/supervisers/admins"""
    return {
        UserRole.MANAGER: Manager,
        UserRole.SUPERVISER: Superviser,
        UserRole.ADMIN: Admin,
    }[role]
