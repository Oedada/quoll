"""Справочники: ИТ-направления, продукты, программы и контакты вузов"""

from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from quoll.core.mixins import IdMixin, TimestampMixin
from quoll.db import Base, str_255


def _json_list() -> Any:
    return mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))


class ItDirection(Base, IdMixin, TimestampMixin):
    __tablename__ = "it_directions"

    name: Mapped[str_255] = mapped_column(unique=True)


class Product(Base, IdMixin, TimestampMixin):
    __tablename__ = "products"
    __table_args__ = (
        # у своего продукта вендора нет - NULLS NOT DISTINCT, иначе два
        # одноимённых «своих» прошли бы
        Index(
            "uq_products_name_vendor",
            "name",
            "vendor_id",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
    )

    name: Mapped[str_255]
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # продукт Ростелекома - без вендора
    vendor_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    direction_id: Mapped[int | None] = mapped_column(
        ForeignKey("it_directions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    keywords: Mapped[list[str]] = _json_list()
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
    # ручная приоритизация курсов менеджерами и админом (Q19); больше - выше
    priority: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class UniversityProgram(Base, IdMixin, TimestampMixin):
    __tablename__ = "university_programs"
    __table_args__ = (
        Index(
            "uq_university_programs",
            "university_id",
            "code",
            "name",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
    )

    university_id: Mapped[int] = mapped_column(
        ForeignKey("universities.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str_255]
    # код специальности, например 09.03.02
    code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    faculty: Mapped[str | None] = mapped_column(String(255), nullable=True)
    disciplines: Mapped[list[str]] = _json_list()
    keywords: Mapped[list[str]] = _json_list()


class UniversityContact(Base, IdMixin, TimestampMixin):
    __tablename__ = "university_contacts"
    __table_args__ = (
        # основной контакт у вуза один среди актуальных
        Index(
            "uq_university_contacts_primary",
            "university_id",
            unique=True,
            postgresql_where=text("is_primary AND is_actual"),
        ),
    )

    university_id: Mapped[int] = mapped_column(
        ForeignKey("universities.id", ondelete="CASCADE"), index=True
    )
    full_name: Mapped[str_255]
    position: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_primary: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    is_actual: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
