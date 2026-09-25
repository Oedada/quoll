"""Документы заявки: файлы проекта, приложенные на её стадии, с версиями.

новая версия ссылается на прежнюю, прежняя остаётся - «уходит вниз и сереет».
Удаляет только админ - единственное исключение из запрета доменных операций
"""

from dataclasses import dataclass

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
from quoll.interactions.access_policy import can_change, can_read
from quoll.interactions.models import InteractionDocument
from quoll.interactions.repository import InteractionRepository
from quoll.interactions.scope import lock_interaction_scope
from quoll.workflows.models import TransitionAttachment


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
    replaces_document_id: int | None,
) -> DocumentView:
    """право - дважды: без блокировок до загрузки, чтобы не держать строки на
    время сети, и под блокировкой перед вставкой"""
    repo = InteractionRepository(session)
    interaction = await repo.get(interaction_id)
    if not can_change(actor, await repo.ownership(interaction)):
        raise OperationForbiddenException("attach documents to this interaction")
    if interaction.state_id is None:
        raise DomainRuleException(409, "Documents are attached from the first stage on")

    attachment = await attachments.upload_attachment(file)
    try:
        scope = await lock_interaction_scope(session, interaction_id, actor.id)
        if not can_change(scope.actor, scope.ownership):
            raise OperationForbiddenException("attach documents to this interaction")
        if replaces_document_id is not None:
            await _check_replaceable(session, interaction_id, replaces_document_id)
        document = InteractionDocument(
            interaction_id=interaction_id,
            attachment_id=attachment.id,
            stage_id=scope.interaction.state_id,
            uploaded_by=actor.id,
            replaces_document_id=replaces_document_id,
        )
        session.add(document)
        await session.flush()
    except Exception:
        # осиротевший файл безвреден, но и держать его незачем
        await attachments.s3.delete(attachment.storage_key)
        raise

    record(
        session,
        actor_id=actor.id,
        event_type=AuditEventType.DOCUMENT_ATTACHED,
        target_type=TargetType.DOCUMENT,
        target_id=document.id,
        new_value={
            "interaction_id": interaction_id,
            "filename": attachment.filename,
            "replaces_document_id": replaces_document_id,
        },
    )
    await session.refresh(document)
    return DocumentView(document, attachment, is_current=True)


async def _check_replaceable(
    session: AsyncSession, interaction_id: int, document_id: int
) -> None:
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


async def documents(session: AsyncSession, interaction_id: int) -> list[DocumentView]:
    successor = aliased(InteractionDocument)
    replaced = exists().where(successor.replaces_document_id == InteractionDocument.id)
    rows = await session.execute(
        select(InteractionDocument, Attachment, ~replaced)
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
