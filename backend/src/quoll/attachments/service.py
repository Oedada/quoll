import logging
import mimetypes
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import UploadFile

from quoll.attachments.models import Attachment
from quoll.attachments.s3 import S3StorageService
from quoll.attachments.schemas import AttachmentCreate
from quoll.config import settings
from quoll.core.base_repository import BaseRepository
from quoll.core.exceptions import (
    AppException,
    FileTooLargeException,
    StorageException,
)

logger = logging.getLogger(__name__)


class AttachmentService:
    """Сервис для сохранения вложений в S3 и метаданных в БД"""

    def __init__(
        self,
        repo: BaseRepository[Attachment],
        s3: S3StorageService | None = None,
    ):
        self.repo = repo
        self.s3 = s3

    async def upload_attachment(
        self,
        file: UploadFile,
        preview: str | None = None,
    ) -> Attachment:
        """Потоковая загрузка файла в S3 и сохранение метаданных в БД."""
        # Санитизировать имя файла, извлекая только базовое имя (защита от path traversal)
        clean_name = (
            Path(file.filename.replace("\\", "/")).name if file.filename else ""
        )
        original_filename = clean_name or "attachment"

        # Определить MIME-тип из заголовка или расширения файла
        mime_type = (
            file.content_type
            or mimetypes.guess_type(original_filename)[0]
            or "application/octet-stream"
        )

        # Сгенерировать уникальный ключ для S3
        unique_id = uuid.uuid4().hex
        suffix = Path(original_filename).suffix.lower()
        storage_key = f"attachments/{unique_id}{suffix}"

        # Проверить размер и пустоту файла перед обращением к S3
        max_size_mb = settings.max_upload_size_mb
        max_bytes = max_size_mb * 1024 * 1024

        content = await file.read()
        if len(content) == 0:
            raise AppException(400, "Uploaded file is empty")
        if len(content) > max_bytes:
            raise FileTooLargeException(max_size_mb)

        logger.info(
            f"Uploading attachment '{original_filename}' ({len(content)} bytes) to storage key '{storage_key}'"
        )

        if self.s3 is None:
            raise StorageException("S3 storage service is not configured")

        size_bytes = await self.s3.upload_bytes(
            data=content,
            key=storage_key,
            content_type=mime_type,
        )

        create_schema = AttachmentCreate(
            filename=original_filename,
            storage_key=storage_key,
            mime_type=mime_type,
            size_bytes=size_bytes,
            preview=preview,
        )

        try:
            attachment = await self.repo.create(create_schema)
            logger.info(f"Attachment created successfully with id={attachment.id}")
            return attachment
        except Exception as err:
            logger.error(
                f"Failed to record attachment in DB, rolling back S3 object '{storage_key}': {err}"
            )
            await self.s3.delete(storage_key)
            raise

    async def get_attachment_stream(
        self,
        attachment_id: int,
    ) -> tuple[Attachment, AsyncIterator[bytes], str, int]:
        """Получить запись вложения и поток для скачивания из S3."""
        if self.s3 is None:
            raise StorageException("S3 storage service is not configured")
        attachment = await self.repo.get(attachment_id)
        stream, content_type, length = await self.s3.download_stream(
            attachment.storage_key
        )
        return attachment, stream, content_type, length

    async def get_presigned_url(
        self,
        attachment_id: int,
        expires_in: int = 3600,
    ) -> str:
        """Сгенерировать временный presigned URL для прямого скачивания клиентом."""
        if self.s3 is None:
            raise StorageException("S3 storage service is not configured")
        attachment = await self.repo.get(attachment_id)
        return await self.s3.generate_presigned_url(
            attachment.storage_key,
            expires_in=expires_in,
        )

    async def delete_attachment(self, attachment_id: int) -> str:
        """удалить строку вложения; ключ файла - вызывающему, чтобы убрать
        его из хранилища уже после коммита"""
        attachment = await self.repo.get(attachment_id)
        await self.repo.delete(attachment_id)
        logger.info(f"Attachment id={attachment_id} deleted from DB")
        return attachment.storage_key
