from datetime import datetime
from typing import ClassVar, Literal

from pydantic import ConfigDict, Field, model_validator

from quoll.core.schemas import AppBaseModel


class _Write(AppBaseModel):
    model_config = ConfigDict(extra="forbid")


class _Patch(_Write):
    # явный null в NOT NULL ушёл бы в базу и вернулся 409 вместо 422
    required: ClassVar[tuple[str, ...]] = ()

    @model_validator(mode="after")
    def _no_nulls(self):
        for field in self.required:
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class DirectionWrite(_Write):
    name: str = Field(min_length=1, max_length=255)


class DirectionPatch(_Patch):
    required = ("name",)
    name: str | None = Field(default=None, min_length=1, max_length=255)


class DirectionRead(AppBaseModel):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime


class Ref(AppBaseModel):
    id: int
    name: str


class ProductRef(Ref):
    vendor_id: int


class ProductWrite(_Write):
    name: str = Field(min_length=1, max_length=255)
    vendor_id: int
    # у продукта минимум одно направление
    direction_ids: list[int] = Field(min_length=1)
    description: str | None = None
    url: str | None = Field(default=None, max_length=500)
    is_active: bool = True


class ProductPatch(_Patch):
    required = ("name", "vendor_id", "direction_ids", "is_active")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    vendor_id: int | None = None
    direction_ids: list[int] | None = Field(default=None, min_length=1)
    description: str | None = None
    url: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class ProductRead(AppBaseModel):
    id: int
    name: str
    vendor_id: int
    directions: list[Ref]
    description: str | None
    url: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ProgramWrite(_Write):
    name: str = Field(min_length=1, max_length=255)
    direction_id: int
    # пусто - программа продуктонезависимая
    product_ids: list[int] = Field(default_factory=list)
    description: str | None = None
    url: str | None = Field(default=None, max_length=500)
    site_course_id: str | None = Field(default=None, max_length=255)
    is_active: bool = True


class ProgramPatch(_Patch):
    required = ("name", "direction_id", "product_ids", "is_active")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    direction_id: int | None = None
    product_ids: list[int] | None = None
    description: str | None = None
    url: str | None = Field(default=None, max_length=500)
    site_course_id: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None


class PriorityWrite(_Write):
    # 1 - самая востребованная; null - снять приоритет
    priority: int | None = Field(ge=1, le=1000)


class ProgramRead(AppBaseModel):
    id: int
    name: str
    direction_id: int
    products: list[ProductRef]
    description: str | None
    url: str | None
    priority: int | None
    site_course_id: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class SpecialtyWrite(_Write):
    code: str = Field(pattern=r"^\d{2}\.\d{2}\.\d{2}$")
    name: str = Field(min_length=1, max_length=255)
    level: Literal["BACHELOR", "SPECIALIST", "MASTER"]
    direction_ids: list[int] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class SpecialtyPatch(_Patch):
    required = ("code", "name", "level", "direction_ids", "tags")
    code: str | None = Field(default=None, pattern=r"^\d{2}\.\d{2}\.\d{2}$")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    level: Literal["BACHELOR", "SPECIALIST", "MASTER"] | None = None
    direction_ids: list[int] | None = None
    tags: list[str] | None = None


class SpecialtyRead(AppBaseModel):
    id: int
    code: str
    name: str
    level: str
    directions: list[Ref]
    tags: list[str]
    created_at: datetime
    updated_at: datetime


class UniversitySpecialtiesWrite(_Write):
    specialty_ids: list[int]


class ContactWrite(_Write):
    university_id: int
    full_name: str = Field(min_length=1, max_length=255)
    position: str | None = None
    department: str | None = None
    email: str | None = None
    phone: str | None = Field(default=None, max_length=50)
    is_primary: bool = False
    is_actual: bool = True


class ContactPatch(_Patch):
    required = ("full_name", "is_primary", "is_actual")
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    position: str | None = None
    department: str | None = None
    email: str | None = None
    phone: str | None = Field(default=None, max_length=50)
    is_primary: bool | None = None
    is_actual: bool | None = None


class ContactRead(AppBaseModel):
    id: int
    university_id: int
    full_name: str
    position: str | None
    department: str | None
    email: str | None
    phone: str | None
    is_primary: bool
    is_actual: bool
    created_at: datetime
    updated_at: datetime
