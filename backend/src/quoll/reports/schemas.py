from datetime import date, datetime
from typing import Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from quoll.core.schemas import AppBaseModel
from quoll.interactions.bindings import BUSINESS_TZ

ColumnKey = Literal[
    "university",
    "direction",
    "program",
    "product",
    "status",
    "responsible",
    "students",
    "streams",
    "teachers_kam",
    "teachers_lms",
    "transitions",
    "contract_number",
    "license_until",
    "transfer_status",
    "region",
]
# порядок колонок в отчёте; перестановки нет (§1.5)
ALL_COLUMNS: tuple[str, ...] = ColumnKey.__args__
DEFAULT_COLUMNS: tuple[str, ...] = ALL_COLUMNS[:11]
StatusKey = int | Literal["AWAITING", "DONE", "REFUSED"]
ExportFormat = Literal["xlsx", "xls", "pdf"]

# защита от огромного запроса, а не бизнес-правило
_MANY = 500


class ReportParams(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    # по умолчанию - с 01.01 года даты "по" по сегодня (спека п.3)
    date_from: date | None = None
    date_to: date | None = None
    university_ids: list[int] = Field(default_factory=list, max_length=_MANY)
    regions: list[str] = Field(default_factory=list, max_length=_MANY)
    direction_ids: list[int] = Field(default_factory=list, max_length=_MANY)
    program_ids: list[int] = Field(default_factory=list, max_length=_MANY)
    # "none" - ветка без продукта или строка заявки без веток
    product_ids: list[int | Literal["none"]] = Field(
        default_factory=list, max_length=_MANY
    )
    responsible_ids: list[str] = Field(default_factory=list, max_length=_MANY)
    statuses: list[StatusKey] = Field(default_factory=list, max_length=_MANY)
    columns: list[ColumnKey] = Field(default_factory=lambda: list(DEFAULT_COLUMNS))

    @model_validator(mode="after")
    def default_period(self):
        if self.date_to is None:
            self.date_to = datetime.now(BUSINESS_TZ).date()
        if self.date_from is None:
            self.date_from = date(self.date_to.year, 1, 1)
        return self

    @field_validator("columns")
    @classmethod
    def canonical_columns(cls, value: list[str]) -> list[str]:
        # "Вуз" обязательна - без неё строка не читается
        chosen = set(value) | {"university"}
        return [key for key in ALL_COLUMNS if key in chosen]


class PreviewRequest(ReportParams):
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=100)


class StatusRead(AppBaseModel):
    kind: Literal["AWAITING", "STEP", "DONE", "REFUSED"]
    stage_id: int | None
    stage_name: str | None
    archived: bool
    paused: bool
    agreement: bool
    label: str


class ResponsibleRead(AppBaseModel):
    id: str | None
    name: str
    earlier_id: str | None
    earlier_name: str | None
    label: str


class MoveRead(AppBaseModel):
    at: date
    kind: Literal["MOVE", "PAUSE", "UNPAUSE", "CLOSE", "REOPEN"]
    from_stage_id: int | None
    to_stage_id: int | None
    label: str


class TransitionsRead(AppBaseModel):
    count: int
    items: list[MoveRead]


class RowRead(AppBaseModel):
    """строка предпросмотра: только выбранные колонки и ключи строки"""

    interaction_id: int
    branch_id: int | None
    university_id: int
    university: str | None = None
    direction: str | None = None
    program: str | None = None
    product: str | None = None
    status: StatusRead | None = None
    responsible: ResponsibleRead | None = None
    # LMS по паре "вуз x программа" ветки; "-" у строки без ветки (план §6)
    students: int | None = None
    streams: int | None = None
    teachers_kam: int | None = None
    teachers_lms: int | None = None
    transitions: TransitionsRead | None = None
    contract_number: str | None = None
    license_until: date | None = None
    transfer_status: str | None = None
    region: str | None = None


class PreviewRead(AppBaseModel):
    total: int
    columns: list[str]
    rows: list[RowRead]


class OptionRead(AppBaseModel):
    id: int | str
    name: str


class PersonOptionRead(OptionRead):
    is_active: bool


class StageOptionRead(OptionRead):
    archived: bool = False


class OptionsRead(AppBaseModel):
    universities: list[OptionRead]
    regions: list[str]
    directions: list[OptionRead]
    programs: list[OptionRead]
    products: list[OptionRead]
    responsible: list[PersonOptionRead]
    statuses: list[StageOptionRead]


class ExportCreate(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    params: ReportParams
    format: ExportFormat


class ExportRead(AppBaseModel):
    id: int
    status: str
    format: str
    row_count: int | None
    created_at: datetime
    finished_at: datetime | None
    file_name: str
    # REP-429 в очереди, код ошибки у упавшего; иначе пусто
    code: str | None
    position: int | None
