from datetime import datetime
from typing import ClassVar

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


class ProductWrite(_Write):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    vendor_id: int | None = None
    direction_id: int | None = None
    keywords: list[str] = Field(default_factory=list)
    is_active: bool = True


class ProductPatch(_Patch):
    required = ("name", "keywords", "is_active")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    vendor_id: int | None = None
    direction_id: int | None = None
    keywords: list[str] | None = None
    is_active: bool | None = None


class PriorityWrite(_Write):
    priority: int = Field(ge=-1000, le=1000)


class ProductRead(AppBaseModel):
    id: int
    name: str
    description: str | None
    vendor_id: int | None
    direction_id: int | None
    keywords: list[str]
    is_active: bool
    priority: int
    created_at: datetime
    updated_at: datetime


class ProgramWrite(_Write):
    university_id: int
    name: str = Field(min_length=1, max_length=255)
    code: str | None = Field(default=None, max_length=20)
    faculty: str | None = None
    disciplines: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)


class ProgramPatch(_Patch):
    required = ("name", "disciplines", "keywords")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    code: str | None = Field(default=None, max_length=20)
    faculty: str | None = None
    disciplines: list[str] | None = None
    keywords: list[str] | None = None


class ProgramRead(AppBaseModel):
    id: int
    university_id: int
    name: str
    code: str | None
    faculty: str | None
    disciplines: list[str]
    keywords: list[str]
    created_at: datetime
    updated_at: datetime


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
