import json
import logging
import os
from pathlib import Path

from pydantic import BaseModel, ValidationError

from quoll.config import settings

logger = logging.getLogger(__name__)


class Storage(BaseModel):
    keycloak_client_secret: str | None = None


def _write_secure(path: Path, data: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(data)


def read_storage() -> Storage:
    path: Path = Path(settings.storage_path)
    if not path.exists():
        return Storage()

    try:
        raw = path.read_text()
    except OSError:
        logger.error(f"Os error while reading file {settings.storage_path}")
        return Storage()
    try:
        return Storage.model_validate_json(raw)
    except ValidationError:
        return Storage()
    except json.JSONDecodeError:
        return Storage()


def write_storage(storage: Storage) -> None:
    try:
        _write_secure(Path(settings.storage_path), storage.model_dump_json(indent=2))
    except OSError:
        logger.error(f"Os error while writing file {settings.storage_path}")
