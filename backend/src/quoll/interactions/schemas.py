from datetime import datetime
from typing import Any, Literal

from pydantic import ConfigDict, Field, ValidationError, model_validator

from quoll.attachments.schemas import AttachmentRead
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


class AcceptRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    # начальная стадия воркфлоу - у заявки без воркфлоу она его и задаёт
    to_stage_id: int
    comment: str | None = None


class DocumentDecision(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    comment: str | None = None


class RollbackRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    to_stage_id: int
    expected_state_id: int
    comment: str = Field(min_length=1)


class DeclineRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    comment: str = Field(min_length=1)


class TransitionRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    to_stage_id: int
    # обязательно, для черновика - null, как expected_owner_id у назначения
    expected_state_id: int | None
    comment: str | None = None


class ReopenRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    manager_id: str
    to_stage_id: int
    expected_owner_id: str | None
    comment: str = Field(min_length=1)


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
    # ход ветки продукта; null - ход самого взаимодействия
    branch_id: int | None
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


class RequestCreate(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["TRANSFER", "CLOSE", "TRANSITION"]
    # аппрув шага ветки продукта
    branch_id: int | None = None
    # у закрытия - куда закрыть; у передачи - кому, но это лишь предложение
    target_stage_id: int | None = None
    target_manager_id: str | None = None
    reason: str = Field(min_length=1)

    @model_validator(mode="after")
    def _targets_fit_kind(self):
        if self.kind == "CLOSE" and (
            self.target_stage_id is None or self.target_manager_id
        ):
            raise ValueError("CLOSE needs target_stage_id and no target_manager_id")
        if self.kind == "TRANSFER" and self.target_stage_id is not None:
            raise ValueError("TRANSFER has no target_stage_id")
        if self.kind == "TRANSITION" and (
            self.target_stage_id is None or self.target_manager_id
        ):
            raise ValueError(
                "TRANSITION needs target_stage_id and no target_manager_id"
            )
        return self


class RequestApprove(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    # у передачи обязателен: решает руководитель, а не предложение менеджера
    target_manager_id: str | None = None
    comment: str | None = None


class RequestReject(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    comment: str = Field(min_length=1)


class RequestRead(AppBaseModel):
    id: int
    interaction_id: int
    kind: str
    status: str
    requested_by: str | None
    from_owner_id: str | None
    target_stage_id: int | None
    target_manager_id: str | None
    transition_id: int | None
    branch_id: int | None
    reason: str
    decided_by: str | None
    decided_at: datetime | None
    decision_comment: str | None
    created_at: datetime


class DocumentRead(AppBaseModel):
    id: int
    interaction_id: int
    stage_id: int
    uploaded_by: str | None
    branch_id: int | None
    replaces_document_id: int | None
    title: str
    kind: str | None
    metadata: dict[str, Any]
    # прежние версии не пропадают, а перестают быть актуальными
    is_current: bool
    # ACTIVE, PENDING - ждёт руководителя, REJECTED
    status: str
    created_at: datetime
    attachment: AttachmentRead


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


class StageValuesWrite(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    # целиком, не слиянием: убрать поле - прислать без него
    values: dict[str, Any]


class StageValuesRead(AppBaseModel):
    stage_id: int
    branch_id: int | None
    values: dict[str, Any]
    updated_by: str | None
    updated_at: datetime
    # правка пройденного шага на одобрении у руководителя
    pending_values: dict[str, Any] | None
    pending_by: str | None


class ContractProductAdd(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: int


class ContractProductStatusWrite(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["PROPOSED", "APPROVED", "REJECTED"]


class ContractProductRead(AppBaseModel):
    id: int
    interaction_id: int
    product_id: int
    status: str
    added_by: str | None
    created_at: datetime


class BranchRead(AppBaseModel):
    id: int
    interaction_id: int
    interaction_product_id: int
    state_id: int
    created_at: datetime
    closed_at: datetime | None
