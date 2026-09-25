"""Документы взаимодействия: файлы проекта, привязанные к стадии, с версиями.

стадию задаёт вызывающий - к любой стадии воркфлоу этого взаимодействия, не
только к текущей. Что на каком шаге обязательно, решает слой выше, здесь -
только структура. Новая версия ссылается на прежнюю, прежняя остаётся -
«уходит вниз и сереет». Удаляет только админ - единственное исключение из
запрета доменных операций
"""

from dataclasses import dataclass
from typing import Any

from fastapi import UploadFile
from sqlalchemy import delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from quoll.attachments.models import Attachment
from quoll.attachments.service import AttachmentService
from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.models import User, UserRole
from quoll.core.exceptions import (
    DomainRuleException,
    IdNotExistsException,
    OperationForbiddenException,
)
from quoll.interactions.access_policy import can_change, can_close, can_read
from quoll.interactions.models import DocumentStatus, InteractionDocument
from quoll.interactions.notify import notify
from quoll.interactions.repository import InteractionRepository
from quoll.interactions.scope import lock_interaction_scope
from quoll.workflows.models import Stage, TransitionAttachment


@dataclass(frozen=True)
class DocumentView:
    document: InteractionDocument
    attachment: Attachment
    is_current: bool


async def upload(
    session: AsyncSession,
    attachments: AttachmentService,
    *,
    interaction_id: int,
    actor: User,
    file: UploadFile,
    stage_id: int,
    replaces_document_id: int | None,
    title: str | None,
    kind: str | None,
    meta: dict[str, Any],
) -> DocumentView:
    """право - дважды: без блокировок до загрузки, чтобы не держать строки на
    время сети, и под блокировкой перед вставкой"""
    repo = InteractionRepository(session)
    interaction = await repo.get(interaction_id)
    if not can_change(actor, await repo.ownership(interaction)):
        raise OperationForbiddenException("attach documents to this interaction")
    await _check_stage(session, interaction.workflow_id, stage_id)

    attachment = await attachments.upload_attachment(file)
    try:
        scope = await lock_interaction_scope(session, interaction_id, actor.id)
        if not can_change(scope.actor, scope.ownership):
            raise OperationForbiddenException("attach documents to this interaction")
        previous = None
        if replaces_document_id is not None:
            previous = await _check_replaceable(
                session, interaction_id, replaces_document_id
            )
        # правка файла пройденного шага - с аппрувом руководителя (AS IS)
        pending = (
            actor.role == UserRole.MANAGER and stage_id != scope.interaction.state_id
        )
        document = InteractionDocument(
            status=DocumentStatus.PENDING if pending else DocumentStatus.ACTIVE,
            interaction_id=interaction_id,
            attachment_id=attachment.id,
            stage_id=stage_id,
            uploaded_by=actor.id,
            replaces_document_id=replaces_document_id,
            # новая версия того же документа - то же название и тип
            title=title or (previous.title if previous else attachment.filename),
            kind=kind or (previous.kind if previous else None),
            meta=meta,
        )
        session.add(document)
        await session.flush()
    except Exception:
        # осиротевший файл безвреден, но и держать его незачем
        await attachments.s3.delete(attachment.storage_key)
        raise

    if pending and scope.owner is not None:
        notify(
            session,
            scope.owner.superviser_id,
            "Файл ждёт одобрения",
            f"Взаимодействие {interaction_id}: «{document.title}» на пройденный шаг",
            {"interaction_id": interaction_id, "document_id": document.id},
        )
    record(
        session,
        actor_id=actor.id,
        event_type=AuditEventType.DOCUMENT_ATTACHED,
        target_type=TargetType.DOCUMENT,
        target_id=document.id,
        new_value={
            "interaction_id": interaction_id,
            "stage_id": stage_id,
            "title": document.title,
            "kind": document.kind,
            "filename": attachment.filename,
            "replaces_document_id": replaces_document_id,
        },
    )
    await session.refresh(document)
    return DocumentView(document, attachment, is_current=not pending)


async def _check_stage(
    session: AsyncSession, workflow_id: int | None, stage_id: int
) -> None:
    """только структура: стадия из воркфлоу этого взаимодействия и живая"""
    if workflow_id is None:
        raise DomainRuleException(
            409, "Interaction has no workflow yet, no stages to attach to"
        )
    stage = await session.get(Stage, stage_id)
    if stage is None or stage.workflow_id != workflow_id:
        raise DomainRuleException(400, "Stage belongs to another workflow")
    if stage.archived_at is not None:
        raise DomainRuleException(409, f"Stage '{stage_id}' is archived")


async def _check_replaceable(
    session: AsyncSession, interaction_id: int, document_id: int
) -> InteractionDocument:
    previous = await session.get(InteractionDocument, document_id)
    if previous is None or previous.interaction_id != interaction_id:
        raise DomainRuleException(
            409, "Replaced document belongs to another interaction"
        )
    successor = await session.scalar(
        select(InteractionDocument.id).where(
            InteractionDocument.replaces_document_id == document_id
        )
    )
    if successor is not None:
        raise DomainRuleException(
            409, f"Document is already replaced by '{successor}', replace that one"
        )
    return previous


def replaced_expression():
    """версию сменила одобренная преемница - ждущая ещё не сменила"""
    successor = aliased(InteractionDocument)
    return exists().where(
        successor.replaces_document_id == InteractionDocument.id,
        successor.status == DocumentStatus.ACTIVE,
    )


async def documents(session: AsyncSession, interaction_id: int) -> list[DocumentView]:
    current = (
        InteractionDocument.status == DocumentStatus.ACTIVE
    ) & ~replaced_expression()
    rows = await session.execute(
        select(InteractionDocument, Attachment, current)
        .join(Attachment, Attachment.id == InteractionDocument.attachment_id)
        .where(InteractionDocument.interaction_id == interaction_id)
        .order_by(InteractionDocument.created_at, InteractionDocument.id)
    )
    return [DocumentView(doc, attachment, current) for doc, attachment, current in rows]


async def delete_document(
    session: AsyncSession, *, document_id: int, actor_id: str
) -> str:
    """удаляется вложение, документ уходит каскадом. Возвращает ключ файла:
    из хранилища его убирают после коммита - строка без файла хуже, чем файл
    без строки"""
    found = await session.get(InteractionDocument, document_id)
    if found is None:
        raise IdNotExistsException(InteractionDocument.__name__)
    # под захватом области: иначе параллельная замена раздвоила бы цепочку
    await lock_interaction_scope(session, found.interaction_id, actor_id)
    document = await session.get(
        InteractionDocument, document_id, populate_existing=True
    )
    if document is None:
        # удалили параллельно, пока ждали блокировку
        raise IdNotExistsException(InteractionDocument.__name__)
    attachment = await session.get(Attachment, document.attachment_id)
    successor = await session.scalar(
        select(InteractionDocument).where(
            InteractionDocument.replaces_document_id == document_id
        )
    )
    predecessor_id = document.replaces_document_id

    # сначала удалить, потом перевесить: иначе преемник и удаляемый на миг
    # заменяли бы одного предшественника, а индекс это запрещает
    await session.execute(delete(Attachment).where(Attachment.id == attachment.id))
    session.expunge(document)
    if successor is not None:
        await session.refresh(successor)
        successor.replaces_document_id = predecessor_id
    await session.flush()

    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.DOCUMENT_DELETED,
        target_type=TargetType.DOCUMENT,
        target_id=document_id,
        old_value={
            "interaction_id": document.interaction_id,
            "filename": attachment.filename,
            "replaces_document_id": predecessor_id,
        },
    )
    return attachment.storage_key


async def decide(
    session: AsyncSession,
    *,
    document_id: int,
    actor_id: str,
    approve: bool,
    comment: str | None,
) -> DocumentView:
    """руководитель владельца одобряет или отклоняет файл на пройденный шаг"""
    found = await session.get(InteractionDocument, document_id)
    if found is None:
        raise IdNotExistsException(InteractionDocument.__name__)
    scope = await lock_interaction_scope(session, found.interaction_id, actor_id)
    if not can_close(scope.actor, scope.ownership):
        raise OperationForbiddenException("decide on this document")
    document = await session.get(
        InteractionDocument, document_id, populate_existing=True
    )
    if document.status != DocumentStatus.PENDING:
        raise DomainRuleException(409, f"Document is already {document.status}")
    if approve:
        document.status = DocumentStatus.ACTIVE
    else:
        document.status = DocumentStatus.REJECTED
        # отклонённая выходит из цепочки: иначе заняла бы место преемницы
        document.replaces_document_id = None
    await session.flush()
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.DOCUMENT_APPROVED
        if approve
        else AuditEventType.DOCUMENT_REJECTED,
        target_type=TargetType.DOCUMENT,
        target_id=document.id,
        new_value={"comment": comment},
    )
    notify(
        session,
        document.uploaded_by,
        "Файл одобрен" if approve else "Файл отклонён",
        f"«{document.title}»" + (f": {comment}" if comment else ""),
        {"interaction_id": document.interaction_id, "document_id": document.id},
    )
    attachment = await session.get(Attachment, document.attachment_id)
    await session.refresh(document)
    return DocumentView(document, attachment, is_current=approve)


async def check_attachment_readable(
    session: AsyncSession, user: User, attachment_id: int
) -> None:
    """файл заявки - по её политике чтения, шаблон ребра - любому вошедшему,
    ни к чему не привязанный - только админу: иначе он стал бы «шаблоном» для
    всех, как только от него отвязали документ"""
    if await session.get(Attachment, attachment_id) is None:
        raise IdNotExistsException(Attachment.__name__)
    document = await session.scalar(
        select(InteractionDocument).where(
            InteractionDocument.attachment_id == attachment_id
        )
    )
    if document is not None:
        repo = InteractionRepository(session)
        interaction = await repo.get(document.interaction_id)
        if not can_read(user, await repo.ownership(interaction)):
            raise OperationForbiddenException("read this file")
        return
    template = await session.scalar(
        select(exists().where(TransitionAttachment.attachment_id == attachment_id))
    )
    if not template and user.role != UserRole.ADMIN:
        raise OperationForbiddenException("read this file")


async def is_interaction_document(session: AsyncSession, attachment_id: int) -> bool:
    return bool(
        await session.scalar(
            select(exists().where(InteractionDocument.attachment_id == attachment_id))
        )
    )
