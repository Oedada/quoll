"""Справочники: ИТ-направления, продукты, ИТ-программы, специальности, контакты"""

from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from quoll.core.mixins import IdMixin, TimestampMixin
from quoll.core.pii import EncryptedString
from quoll.db import Base, str_255


def _json_list() -> Any:
    return mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))


product_directions = Table(
    "product_directions",
    Base.metadata,
    Column(
        "product_id", ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    ),
    Column(
        "direction_id",
        ForeignKey("it_directions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)
program_products = Table(
    "program_products",
    Base.metadata,
    Column(
        "program_id", ForeignKey("it_programs.id", ondelete="CASCADE"), primary_key=True
    ),
    # продукт, который ведут ветки, не удаляется - RESTRICT в самой ветке
    Column(
        "product_id", ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    ),
)
specialty_directions = Table(
    "specialty_directions",
    Base.metadata,
    Column(
        "specialty_id",
        ForeignKey("specialties.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "direction_id",
        ForeignKey("it_directions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)
university_specialties = Table(
    "university_specialties",
    Base.metadata,
    Column(
        "university_id",
        ForeignKey("universities.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "specialty_id",
        ForeignKey("specialties.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class ItDirection(Base, IdMixin, TimestampMixin):
    __tablename__ = "it_directions"

    name: Mapped[str_255] = mapped_column(unique=True)


class Product(Base, IdMixin, TimestampMixin):
    """ПО из каталога. Вендор есть всегда: у своих - «ПАО «Ростелеком»»"""

    __tablename__ = "products"
    __table_args__ = (
        Index("uq_products_name_vendor", "name", "vendor_id", unique=True),
    )

    name: Mapped[str_255]
    vendor_id: Mapped[int] = mapped_column(
        ForeignKey("vendors.id", ondelete="RESTRICT"), index=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
    # кто отвечает за продукт, если это не основной контакт вендора
    contact_id: Mapped[int | None] = mapped_column(
        ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True
    )

    # минимум одно - проверка в сервисе
    directions: Mapped[list[ItDirection]] = relationship(
        secondary=product_directions, lazy="selectin", order_by=ItDirection.id
    )


class ItProgram(Base, IdMixin, TimestampMixin):
    """ИТ-программа (курс) ИТ Школы: одно направление, продукты могут
    отсутствовать - тогда программа продуктонезависимая (Q43)"""

    __tablename__ = "it_programs"

    name: Mapped[str_255] = mapped_column(unique=True)
    direction_id: Mapped[int] = mapped_column(
        ForeignKey("it_directions.id", ondelete="RESTRICT"), index=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # ручной приоритет (Q19): 1 - самая востребованная, пусто - не задан
    priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ключ сопоставления с сайтом и LMS
    site_course_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )

    products: Mapped[list[Product]] = relationship(
        secondary=program_products, lazy="selectin", order_by=Product.id
    )


class Specialty(Base, IdMixin, TimestampMixin):
    """специальность ОКСО - только для подсказки на шаге 0"""

    __tablename__ = "specialties"

    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str_255]
    level: Mapped[str] = mapped_column(String(20))
    tags: Mapped[list[str]] = _json_list()

    directions: Mapped[list[ItDirection]] = relationship(
        secondary=specialty_directions, lazy="selectin", order_by=ItDirection.id
    )


class Contact(Base, IdMixin, TimestampMixin):
    """контактное лицо вуза или вендора. ФИО, телефон и почта - ПДн,
    в базе зашифрованы (М 9); искать по ним нельзя"""

    __tablename__ = "contacts"
    __table_args__ = (
        CheckConstraint(
            "(university_id IS NULL) <> (vendor_id IS NULL)",
            name="chk_contact_one_owner",
        ),
    )

    university_id: Mapped[int | None] = mapped_column(
        ForeignKey("universities.id", ondelete="CASCADE"), nullable=True, index=True
    )
    vendor_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors.id", ondelete="CASCADE"), nullable=True, index=True
    )
    full_name: Mapped[str] = mapped_column(EncryptedString)
    phone: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    email: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    position: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # «Почта», «Чат в ТГ» - может быть несколько
    contact_methods: Mapped[list[str]] = _json_list()
    is_actual: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
