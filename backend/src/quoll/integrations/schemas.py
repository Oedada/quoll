from datetime import datetime
from typing import Any, Literal

from pydantic import ConfigDict

from quoll.core.schemas import AppBaseModel

# потоки, которые запускаются кнопкой; В1/В2 ещё и загрузкой файла
RunnableFlow = Literal["I2", "I1", "B1", "B2"]
UploadFlow = Literal["B1", "B2"]
StubFlow = Literal["I2", "I1"]


class RunRead(AppBaseModel):
    id: int
    flow: str
    trigger: str
    status: str
    started_at: datetime
    finished_at: datetime
    # код К §6 -> число записей
    counters: dict[str, int]
    error: str | None
    actor_id: str | None


class StubRead(AppBaseModel):
    flow: str
    received_at: datetime | None
    payload: list[dict[str, Any]] | None


class UnmatchedRead(AppBaseModel):
    id: int
    flow: str
    record_key: str
    code: str
    mapping_kind: str
    external_key: str
    record: dict[str, Any]
    candidates: list[int]
    status: str
    decided_by: str | None
    decided_at: datetime | None
    created_at: datetime


class UnmatchedResolve(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    # программа у COURSE и PROGRAM, вуз у UNIVERSITY
    target_id: int


class LmsStatsBrief(AppBaseModel):
    students: int
    streams: int
    teachers_trained: int | None
    updated_at: datetime


class LmsStatsRead(LmsStatsBrief):
    university_id: int
    program_id: int
    source: str


class ProposalRead(AppBaseModel):
    id: int
    kind: str
    university_id: int
    program_id: int
    reason: str
    status: str
    decided_by: str | None
    decided_at: datetime | None
    decision_comment: str | None
    workflow_id: int | None
    result_interaction_id: int | None
    created_at: datetime


class ProposalApprove(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    # обязателен у CREATE_INTERACTION (Р4)
    workflow_id: int | None = None
    comment: str | None = None


class ProposalReject(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    comment: str
