from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status

from quoll.attachments.dependencies import AttachmentServiceDep
from quoll.auth.dependencies import CurrentUser, get_current_user
from quoll.comments import service as comment_service
from quoll.comments.schemas import CommentListRead, CommentRead, CommentUpdate
from quoll.db import SessionDep
from quoll.interactions.dependencies import InteractionId, ReadableInteraction

comments_router = APIRouter(
    prefix="/api/v1/interactions/{id}/comments",
    tags=["Comments"],
    dependencies=[Depends(get_current_user)],
)


@comments_router.get("", response_model=CommentListRead)
async def list_comments(
    interaction: ReadableInteraction,
    user: CurrentUser,
    session: SessionDep,
    stage_id: int | None = None,
    branch_id: int | None = None,
    side_pointer_id: int | None = None,
    main_only: bool = False,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    total, rows = await comment_service.list_comments(
        session,
        interaction_id=interaction.id,
        stage_id=stage_id,
        branch_id=branch_id,
        side_pointer_id=side_pointer_id,
        main_only=main_only,
        limit=limit,
        offset=offset,
    )
    items = await comment_service.view_many(session, rows, viewer=user)
    return {"total": total, "items": items}


@comments_router.post(
    "", response_model=CommentRead, status_code=status.HTTP_201_CREATED
)
async def create_comment(
    id: InteractionId,
    user: CurrentUser,
    session: SessionDep,
    attachments: AttachmentServiceDep,
    stage_id: Annotated[int, Form()],
    text: Annotated[str, Form()],
    branch_id: Annotated[int | None, Form()] = None,
    side_pointer_id: Annotated[int | None, Form()] = None,
    reply_to_id: Annotated[int | None, Form()] = None,
    notify_supervisor: Annotated[bool, Form()] = False,
    files: Annotated[list[UploadFile], File()] = [],  # noqa: B006 - FastAPI обрабатывает как форму
):
    comment = await comment_service.create(
        session,
        attachments,
        interaction_id=id,
        actor=user,
        fields=comment_service.CommentFields(
            text=text,
            stage_id=stage_id,
            branch_id=branch_id,
            side_pointer_id=side_pointer_id,
            reply_to_id=reply_to_id,
            notify_supervisor=notify_supervisor,
        ),
        files=files,
    )
    return await comment_service.view(session, comment, viewer=user)


@comments_router.patch("/{comment_id}", response_model=CommentRead)
async def update_comment(
    id: InteractionId,
    comment_id: int,
    body: CommentUpdate,
    user: CurrentUser,
    session: SessionDep,
):
    comment = await comment_service.update(
        session,
        interaction_id=id,
        comment_id=comment_id,
        actor=user,
        text=body.text,
    )
    return await comment_service.view(session, comment, viewer=user)


@comments_router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    id: InteractionId, comment_id: int, user: CurrentUser, session: SessionDep
):
    await comment_service.delete(
        session, interaction_id=id, comment_id=comment_id, actor=user
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
