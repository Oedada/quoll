"""Комментарии: заблокировать заявку -> проверить место -> изменить -> аудит
-> уведомить (§4 design).

своей блокировки у комментария нет - все изменения сериализует блокировка
заявки (lock_interaction_scope)
"""

from dataclasses import dataclass

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.attachments.models import Attachment
from quoll.attachments.service import AttachmentService
from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.models import User, UserRole
from quoll.comments.errors import com_error
from quoll.comments.models import Comment, CommentAttachment
from quoll.core.exceptions import DomainRuleException
from quoll.core.people import person
from quoll.interactions import step_place
from quoll.interactions.access_policy import can_change, can_read
from quoll.interactions.notify import notify
from quoll.interactions.repository import InteractionRepository
from quoll.interactions.scope import InteractionScope, lock_interaction_scope
from quoll.notifications import kinds
from quoll.workflows.models import Stage

MAX_FILES = 10
PREVIEW_LENGTH = 200


@dataclass(frozen=True)
class CommentFields:
    text: str
    stage_id: int
    branch_id: int | None = None
    side_pointer_id: int | None = None
    reply_to_id: int | None = None
    notify_supervisor: bool = False


def check_open(place: step_place.Place) -> None:
    if place.branch is not None and place.branch.closed_at is not None:
        raise DomainRuleException(409, "Branch is closed")


async def _check_stage_shape(
    session: AsyncSession, workflow_id: int | None, stage_id: int, branch_id: int | None
) -> None:
    """только структура - до сети и до блокировки, как у документов"""
    if workflow_id is None:
        raise DomainRuleException(
            409, "Interaction has no workflow yet, no stages to attach to"
        )
    stage = await session.get(Stage, stage_id)
    if stage is None or stage.workflow_id != workflow_id:
        raise DomainRuleException(400, "Stage belongs to another workflow")
    if stage.is_branch_stage != (branch_id is not None):
        raise DomainRuleException(400, "Branch stages are filled per branch")


async def create(
    session: AsyncSession,
    attachments: AttachmentService,
    *,
    interaction_id: int,
    actor: User,
    fields: CommentFields,
    files: list[UploadFile],
) -> Comment:
    text = fields.text.strip()
    if not text:
        raise com_error("COM-006")
    if len(text) > 4000:
        raise com_error("COM-007")
    if len(files) > MAX_FILES:
        raise com_error("COM-009")

    repo = InteractionRepository(session)
    interaction = await repo.get(interaction_id)
    if not can_change(actor, await repo.ownership(interaction)):
        raise com_error("COM-002")
    await _check_stage_shape(
        session, interaction.workflow_id, fields.stage_id, fields.branch_id
    )

    uploaded: list[Attachment] = []
    try:
        for file in files:
            uploaded.append(await attachments.upload_attachment(file))

        scope = await lock_interaction_scope(session, interaction_id, actor.id)
        if not can_change(scope.actor, scope.ownership):
            raise com_error("COM-002")
        place = await step_place.resolve(
            session,
            scope.interaction,
            stage_id=fields.stage_id,
            branch_id=fields.branch_id,
            side_pointer_id=fields.side_pointer_id,
        )
        check_open(place)

        parent = None
        if fields.reply_to_id is not None:
            parent = await session.get(Comment, fields.reply_to_id)
            place_key = (
                interaction_id,
                fields.stage_id,
                fields.branch_id,
                fields.side_pointer_id,
            )
            if (
                parent is None
                or (
                    parent.interaction_id,
                    parent.stage_id,
                    parent.branch_id,
                    parent.side_pointer_id,
                )
                != place_key
            ):
                raise com_error("COM-008")

        comment = Comment(
            interaction_id=interaction_id,
            stage_id=fields.stage_id,
            branch_id=fields.branch_id,
            side_pointer_id=fields.side_pointer_id,
            author_id=actor.id,
            author_name=person(actor),
            reply_to_id=fields.reply_to_id,
            text=text,
        )
        session.add(comment)
        await session.flush()
        for attachment in uploaded:
            session.add(
                CommentAttachment(comment_id=comment.id, attachment_id=attachment.id)
            )
        record(
            session,
            actor_id=actor.id,
            event_type=AuditEventType.COMMENT_CREATED,
            target_type=TargetType.COMMENT,
            target_id=comment.id,
            new_value={
                "stage_id": fields.stage_id,
                "branch_id": fields.branch_id,
                "side_pointer_id": fields.side_pointer_id,
                "reply_to_id": fields.reply_to_id,
                "files": len(uploaded),
            },
        )
        await _notify_about(
            session, scope, comment, parent, fields.notify_supervisor, place.stage.name
        )
        await session.flush()
        await session.refresh(comment)
        return comment
    except Exception:
        # осиротевший файл безвреден, но и держать его незачем
        for attachment in uploaded:
            await attachments.s3.delete(attachment.storage_key)
        raise


async def _notify_about(
    session: AsyncSession,
    scope: InteractionScope,
    comment: Comment,
    parent: Comment | None,
    notify_supervisor: bool,
    stage_name: str,
) -> None:
    context = {"stage": stage_name, "text": comment.text[:PREVIEW_LENGTH]}
    payload = {
        "comment_id": comment.id,
        "stage_id": comment.stage_id,
        "branch_id": comment.branch_id,
    }
    got = {scope.actor.id}
    if (
        parent is not None
        and parent.author_id
        and parent.author_id not in got
        and parent.deleted_at is None
    ):
        author = await session.get(User, parent.author_id)
        # недееспособного emit отбросит - тогда он не «получил»
        if author is not None and can_read(author, scope.ownership):
            sent = await notify(
                session,
                kinds.COMMENT_REPLY,
                scope,
                context=context,
                payload=payload,
                users=(author.id,),
            )
            if sent is not None:
                got.add(author.id)
    if (
        scope.actor.role == UserRole.SUPERVISER
        and scope.interaction.owner_id
        and scope.interaction.owner_id not in got
    ):
        await notify(
            session, kinds.COMMENT_TO_OWNER, scope, context=context, payload=payload
        )
    if scope.actor.role == UserRole.MANAGER and notify_supervisor:
        supervisor_id = scope.owner.superviser_id if scope.owner else None
        if supervisor_id not in got:
            await notify(
                session,
                kinds.COMMENT_TO_SUPERVISOR,
                scope,
                context=context,
                payload=payload,
            )


async def update(
    session: AsyncSession,
    *,
    interaction_id: int,
    comment_id: int,
    actor: User,
    text: str,
) -> Comment:
    text = text.strip()
    if not text:
        raise com_error("COM-006")
    if len(text) > 4000:
        raise com_error("COM-007")
    scope = await lock_interaction_scope(session, interaction_id, actor.id)
    comment = await session.get(Comment, comment_id, populate_existing=True)
    if comment is None or comment.interaction_id != interaction_id:
        raise com_error("COM-001")
    if comment.deleted_at is not None:
        raise com_error("COM-005")
    if comment.author_id != actor.id or not can_change(scope.actor, scope.ownership):
        raise com_error("COM-003")
    # то же место, что при создании - шаг был текущим или пройденным и остаётся
    place = await step_place.resolve(
        session,
        scope.interaction,
        stage_id=comment.stage_id,
        branch_id=comment.branch_id,
        side_pointer_id=comment.side_pointer_id,
    )
    check_open(place)
    if text == comment.text:
        return comment
    old_text = comment.text
    comment.text = text
    comment.edited_at = func.now()
    record(
        session,
        actor_id=actor.id,
        event_type=AuditEventType.COMMENT_UPDATED,
        target_type=TargetType.COMMENT,
        target_id=comment.id,
        old_value={"text": old_text},
        new_value={"text": text},
    )
    await session.flush()
    await session.refresh(comment)
    return comment


async def delete(
    session: AsyncSession, *, interaction_id: int, comment_id: int, actor: User
) -> None:
    admin = actor.role == UserRole.ADMIN
    scope = await lock_interaction_scope(
        session, interaction_id, actor.id, allow_closed=admin
    )
    comment = await session.get(Comment, comment_id, populate_existing=True)
    if comment is None or comment.interaction_id != interaction_id:
        raise com_error("COM-001")
    if comment.deleted_at is not None:
        raise com_error("COM-005")
    if not admin:
        if comment.author_id != actor.id or not can_change(
            scope.actor, scope.ownership
        ):
            raise com_error("COM-004")
        place = await step_place.resolve(
            session,
            scope.interaction,
            stage_id=comment.stage_id,
            branch_id=comment.branch_id,
            side_pointer_id=comment.side_pointer_id,
        )
        check_open(place)
    comment.deleted_at = func.now()
    comment.deleted_by = actor.id
    record(
        session,
        actor_id=actor.id,
        event_type=AuditEventType.COMMENT_DELETED,
        target_type=TargetType.COMMENT,
        target_id=comment.id,
        old_value={"author_id": comment.author_id},
    )
    await session.flush()


async def list_comments(
    session: AsyncSession,
    *,
    interaction_id: int,
    stage_id: int | None,
    branch_id: int | None,
    side_pointer_id: int | None,
    main_only: bool,
    limit: int,
    offset: int,
) -> tuple[int, list[Comment]]:
    conditions = [Comment.interaction_id == interaction_id]
    if stage_id is not None:
        conditions.append(Comment.stage_id == stage_id)
    if branch_id is not None:
        conditions.append(Comment.branch_id == branch_id)
    if side_pointer_id is not None:
        conditions.append(Comment.side_pointer_id == side_pointer_id)
    if main_only:
        conditions.append(Comment.side_pointer_id.is_(None))
    total = await session.scalar(
        select(func.count()).select_from(Comment).where(*conditions)
    )
    rows = await session.scalars(
        select(Comment)
        .where(*conditions)
        .order_by(Comment.id)
        .limit(limit)
        .offset(offset)
    )
    return total or 0, list(rows)


async def _attachments_by_comment(
    session: AsyncSession, comment_ids: list[int]
) -> dict[int, list[Attachment]]:
    if not comment_ids:
        return {}
    rows = await session.execute(
        select(CommentAttachment.comment_id, Attachment)
        .join(Attachment, Attachment.id == CommentAttachment.attachment_id)
        .where(CommentAttachment.comment_id.in_(comment_ids))
    )
    by_comment: dict[int, list[Attachment]] = {}
    for comment_id, attachment in rows:
        by_comment.setdefault(comment_id, []).append(attachment)
    return by_comment


def _view_one(
    comment: Comment,
    *,
    viewer: User,
    reply: Comment | None,
    attachments: list[Attachment],
) -> dict:
    visible = comment.deleted_at is None or viewer.role == UserRole.ADMIN
    reply_to = None
    if comment.reply_to_id is not None:
        reply_visible = reply is not None and (
            reply.deleted_at is None or viewer.role == UserRole.ADMIN
        )
        reply_to = {
            "id": comment.reply_to_id,
            "author_name": reply.author_name if reply else "",
            "text_preview": (
                reply.text[:PREVIEW_LENGTH] if reply and reply_visible else None
            ),
            "deleted": reply is None or reply.deleted_at is not None,
        }
    return {
        "id": comment.id,
        "interaction_id": comment.interaction_id,
        "stage_id": comment.stage_id,
        "branch_id": comment.branch_id,
        "side_pointer_id": comment.side_pointer_id,
        "author": {"id": comment.author_id, "name": comment.author_name},
        "text": comment.text if visible else None,
        "reply_to": reply_to,
        "attachments": attachments if visible else [],
        "edited_at": comment.edited_at,
        "deleted_at": comment.deleted_at,
        "created_at": comment.created_at,
        "deleted": comment.deleted_at is not None,
    }


async def view(session: AsyncSession, comment: Comment, *, viewer: User) -> dict:
    reply = (
        await session.get(Comment, comment.reply_to_id)
        if comment.reply_to_id is not None
        else None
    )
    attachments = (await _attachments_by_comment(session, [comment.id])).get(
        comment.id, []
    )
    return _view_one(comment, viewer=viewer, reply=reply, attachments=attachments)


async def view_many(
    session: AsyncSession, comments: list[Comment], *, viewer: User
) -> list[dict]:
    reply_ids = {c.reply_to_id for c in comments if c.reply_to_id is not None}
    replies: dict[int, Comment] = {}
    if reply_ids:
        replies = {
            r.id: r
            for r in await session.scalars(
                select(Comment).where(Comment.id.in_(reply_ids))
            )
        }
    attachments = await _attachments_by_comment(session, [c.id for c in comments])
    return [
        _view_one(
            c,
            viewer=viewer,
            reply=replies.get(c.reply_to_id) if c.reply_to_id else None,
            attachments=attachments.get(c.id, []),
        )
        for c in comments
    ]
