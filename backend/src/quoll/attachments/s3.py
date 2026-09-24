import logging
from collections.abc import AsyncIterator
from typing import Any

import aioboto3
from botocore.exceptions import ClientError

from quoll.core.exceptions import StorageException

logger = logging.getLogger(__name__)


class S3StorageService:
    """Асинхронный сервис для взаимодействия с S3-совместимым хранилищем (Garage, AWS S3)"""

    def __init__(
        self,
        endpoint_url: str,
        access_key: str,
        secret_key: str,
        bucket_name: str,
        region_name: str = "auto",
    ):
        self.endpoint_url = endpoint_url
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket_name = bucket_name
        self.region_name = region_name
        self._session = aioboto3.Session()

    def _get_client(self):
        return self._session.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            region_name=self.region_name,
        )

    async def ensure_bucket(self) -> None:
        """Проверить существование бакета, создать если нет"""
        logger.debug(f"Ensuring S3 bucket '{self.bucket_name}' exists")
        try:
            async with self._get_client() as s3:
                try:
                    await s3.head_bucket(Bucket=self.bucket_name)
                    logger.debug(f"Bucket '{self.bucket_name}' already exists")
                except ClientError as err:
                    code = err.response.get("Error", {}).get("Code")
                    if code in ("404", "NoSuchBucket"):
                        logger.info(f"Creating bucket '{self.bucket_name}'")
                        if self.region_name in ("us-east-1", "auto", "default", ""):
                            await s3.create_bucket(Bucket=self.bucket_name)
                        else:
                            await s3.create_bucket(
                                Bucket=self.bucket_name,
                                CreateBucketConfiguration={
                                    "LocationConstraint": self.region_name
                                },
                            )
                    else:
                        logger.warning(f"head_bucket check failed: {err}")
        except Exception as e:  # noqa: BLE001
            logger.error(f"Failed to ensure bucket '{self.bucket_name}': {e}")
            # Не прерывать запуск, если S3 недоступен

    async def upload_bytes(
        self,
        data: bytes,
        key: str,
        content_type: str = "application/octet-stream",
    ) -> int:
        """Загрузить байты в S3 и вернуть количество записанных байт"""
        logger.debug(f"Uploading {len(data)} bytes to S3 key '{key}'")
        try:
            async with self._get_client() as s3:
                await s3.put_object(
                    Bucket=self.bucket_name,
                    Key=key,
                    Body=data,
                    ContentType=content_type,
                )
            return len(data)
        except Exception as e:
            logger.exception(f"Error uploading to S3 key '{key}'")
            raise StorageException(f"Failed to upload file to storage: {e}") from e

    async def upload_stream(
        self,
        stream_reader: Any,
        key: str,
        content_type: str = "application/octet-stream",
    ) -> int:
        """Загрузить данные из асинхронного потока в S3"""
        chunks: list[bytes] = []
        chunk_size = 64 * 1024  # 64 КБ

        while True:
            chunk = await stream_reader.read(chunk_size)
            if not chunk:
                break
            chunks.append(chunk)

        full_data = b"".join(chunks)
        return await self.upload_bytes(full_data, key=key, content_type=content_type)

    async def download_stream(
        self,
        key: str,
    ) -> tuple[AsyncIterator[bytes], str, int]:
        """Скачать файл из S3 в виде потокового генератора

        (chunk_generator, content_type, content_length).
        """
        logger.debug(f"Streaming file from S3 key '{key}'")
        try:
            client_ctx = self._get_client()
            s3 = await client_ctx.__aenter__()
            try:
                response = await s3.get_object(Bucket=self.bucket_name, Key=key)
            except Exception as err:
                await client_ctx.__aexit__(None, None, None)
                if isinstance(err, ClientError):
                    code = err.response.get("Error", {}).get("Code")
                    if code in ("NoSuchKey", "404"):
                        raise StorageException(
                            f"Object '{key}' not found in storage"
                        ) from err
                raise StorageException(f"Storage error: {err}") from err

            body_stream = response["Body"]
            content_type = response.get("ContentType", "application/octet-stream")
            content_length = response.get("ContentLength", 0)

            async def chunk_generator() -> AsyncIterator[bytes]:
                try:
                    async for chunk in body_stream:
                        yield chunk
                finally:
                    await client_ctx.__aexit__(None, None, None)

            return chunk_generator(), content_type, content_length

        except StorageException:
            raise
        except Exception as e:
            logger.exception(f"Failed to stream S3 key '{key}'")
            raise StorageException(f"Failed to download object: {e}") from e

    async def generate_presigned_url(
        self,
        key: str,
        expires_in: int = 3600,
        client_method: str = "get_object",
    ) -> str:
        """Сгенерировать временный presigned URL для прямого скачивания клиентом из S3"""
        logger.debug(f"Generating presigned URL for key '{key}'")
        try:
            async with self._get_client() as s3:
                url = await s3.generate_presigned_url(
                    ClientMethod=client_method,
                    Params={"Bucket": self.bucket_name, "Key": key},
                    ExpiresIn=expires_in,
                )
            return url
        except Exception as e:
            logger.exception(f"Error generating presigned URL for '{key}'")
            raise StorageException(f"Could not generate presigned URL: {e}") from e

    async def delete(self, key: str) -> bool:
        """Удалить объект из S3"""
        logger.debug(f"Deleting S3 key '{key}'")
        try:
            async with self._get_client() as s3:
                await s3.delete_object(Bucket=self.bucket_name, Key=key)
            return True
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Could not delete S3 key '{key}': {e}")
            return False

    async def exists(self, key: str) -> bool:
        """Проверить существование объекта в S3"""
        try:
            async with self._get_client() as s3:
                await s3.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError:
            return False
