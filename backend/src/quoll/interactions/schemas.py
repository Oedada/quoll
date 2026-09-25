from datetime import datetime
from typing import Any

from pydantic import ConfigDict, Field, ValidationError

from quoll.core.schemas import AppBaseModel
from quoll.workflows.schemas import StageRead, WorkflowRead


# University
class UniversityBase(AppBaseModel):
    name: str
    contacts: dict[str, Any] = Field(default_factory=dict)


class UniversityCreate(UniversityBase):
    pass


class UniversityUpdate(AppBaseModel):
    name: str | None = None
    contacts: dict[str, Any] | None = None


class UniversityRead(UniversityBase):
    id: int
    created_at: datetime
    updated_at: datetime


# Vendor
class VendorBase(AppBaseModel):
    name: str
    contacts: dict[str, Any] = Field(default_factory=dict)


class VendorCreate(VendorBase):
    pass


class VendorUpdate(AppBaseModel):
    name: str | None = None
    contacts: dict[str, Any] | None = None


class VendorRead(VendorBase):
    id: int
    created_at: datetime
    updated_at: datetime


# Interaction
class InteractionCreate(AppBaseModel):
    # лишнее поле - 422, а не молчаливый игнор: иначе PATCH с owner_id
    # ответит 200 и ничего не сделает
    model_config = ConfigDict(extra="forbid")

    university_id: int
    vendor_id: int
    it_program: str | None = None
    it_product: str | None = None
    # только опубликованный - по черновику графа заявке ехать нельзя
    workflow_id: int | None = None


class InteractionUpdate(AppBaseModel):
    """владелец, стадия и воркфлоу меняются только операциями над заявкой"""

    model_config = ConfigDict(extra="forbid")

    university_id: int | None = None
    vendor_id: int | None = None
    it_program: str | None = None
    it_product: str | None = None


class AssignRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    manager_id: str
    # обязательно, но может быть null - «ожидаю, что владельца нет».
    # Отсутствие поля - 422, чтобы «забыл передать» не стало «владельца нет»
    expected_owner_id: str | None
    reason: str | None = None


class TransitionRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    to_stage_id: int
    # обязательно, для черновика - null, как expected_owner_id у назначения
    expected_state_id: int | None
    comment: str | None = None


class CloseRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    to_stage_id: int
    expected_state_id: int | None
    # досрочное закрытие - всегда с объяснением
    comment: str = Field(min_length=1)


class PauseRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    # до какого момента; null - бессрочно
    until: datetime | None = None
    comment: str = Field(min_length=1)


class InteractionRead(AppBaseModel):
    id: int
    university_id: int
    vendor_id: int
    it_program: str | None
    it_product: str | None
    workflow_id: int | None
    state_id: int | None
    owner_id: str | None
    created_by: str | None
    pause_state: str
    paused_until: datetime | None
    pause_comment: str | None
    created_at: datetime
    updated_at: datetime


class InteractionDetailRead(InteractionRead):
    university: UniversityRead
    vendor: VendorRead
    workflow: WorkflowRead | None = None
    state: StageRead | None = None


class StageHistoryRead(AppBaseModel):
    from_stage_id: int | None
    to_stage_id: int
    transition_id: int | None
    kind: str
    actor_id: str | None
    comment: str | None
    created_at: datetime


class AssignmentRead(AppBaseModel):
    manager_id: str | None
    assigned_at: datetime
    released_at: datetime | None
    reason: str | None


class InteractionHistoryRead(AppBaseModel):
    """два списка, а не одна лента: у записей разные поля, по времени их
    сливает клиент"""

    stages: list[StageHistoryRead]
    assignments: list[AssignmentRead]

class InteractionImport(AppBaseModel):
    university_name: str
    vendor_name: str
    it_program: str
    it_product: str
    contract_number: str
    license_singed: bool
    license_expired_at: int
    manager_full_name: str
    comment: str

class InteractionImportError(AppBaseModel):
    """одна ошибка валидации строки импорта: колонка + понятный текст"""

    column: str
    message: str


class InteractionImportValidationError(AppBaseModel):
    """человекочитаемый результат pydantic ValidationError"""

    errors: list[InteractionImportError]

    @classmethod
    def from_validation_error(
        cls, exc: ValidationError
    ) -> "InteractionImportValidationError":
        return cls(
            errors=[
                InteractionImportError(
                    column=".".join(str(part) for part in err["loc"]),
                    message=err["msg"],
                )
                for err in exc.errors()
            ]
        )

class InteractionImportRow(AppBaseModel):
    error: InteractionImportValidationError | None = None
    interaction_import: InteractionImport | None

class InteractionImportAction(InteractionImportRow):
    action: str | None


class InteractionImportResult(AppBaseModel):
    """результат импорта: ошибки и удавшиеся операции, по номеру строки"""

    errors: dict[int, InteractionImportValidationError]
    imported: dict[int, InteractionImportAction]
