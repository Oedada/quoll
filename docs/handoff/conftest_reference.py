# ОБРАЗЕЦ из тестов основной команды (они живут в отдельной ветке, которой у тебя нет).
# Скопируй в backend/tests_catalog/conftest.py (factories.py) и поправь импорты
# tests_stage1 -> tests_catalog. Каталог backend/tests/ занят .gitignore - не используй его.
# Запуск из backend/: uv run pytest tests_catalog -q  (нужен docker compose up -d)

import asyncio
import os
import secrets
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import quoll
from quoll.auth.crypto import TokenCipher
from quoll.auth.keycloak_client import keycloak_client
from quoll.auth.dependencies import SESSION_COOKIE
from quoll.auth.session_store import SessionStore, hash_session_key
from quoll.config import settings
from quoll.db import get_db_session
from quoll.main import app

# каталог backend берём от установленного пакета, а не от расположения тестов:
# тесты лежат в отдельной ветке и запускаются из другого каталога
BACKEND_DIR = Path(quoll.__file__).resolve().parents[2]
TEST_DB = "quoll_test_db"


def _url(database: str) -> str:
    return (
        f"postgresql+asyncpg://{settings.postgres_user}:{settings.postgres_password}"
        f"@{settings.postgres_host}:{settings.postgres_port}/{database}"
    )


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def test_engine():
    """Отдельная тестовая база, накатанная теми же миграциями, что и боевая"""
    admin_engine = create_async_engine(_url("postgres"), isolation_level="AUTOCOMMIT")
    async with admin_engine.connect() as conn:
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)'))
        await conn.execute(text(f'CREATE DATABASE "{TEST_DB}"'))
    await admin_engine.dispose()

    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "alembic",
        "upgrade",
        "head",
        cwd=BACKEND_DIR,
        env={**os.environ, "POSTGRES_PATH": TEST_DB},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output, _ = await proc.communicate()
    assert proc.returncode == 0, output.decode()

    engine = create_async_engine(_url(TEST_DB))
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_connection(test_engine):
    """Внешняя транзакция теста: всё, что внутри, откатывается в конце"""
    conn = await test_engine.connect()
    trans = await conn.begin()
    yield conn
    await trans.rollback()
    await conn.close()


@pytest_asyncio.fixture
def session_maker(db_connection):
    """Фабрика сессий на том же соединении: вложенные commit() работают как
    релиз савпойнта, поэтому хранилище сессий с его собственными транзакциями
    тоже откатывается вместе с тестом"""
    return async_sessionmaker(
        bind=db_connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )


@pytest_asyncio.fixture
async def session(session_maker):
    db_session = session_maker()
    yield db_session
    await db_session.close()


@pytest_asyncio.fixture
async def client(session, session_maker):
    async def _get_test_session():
        # как в приложении: отказ откатывает всё, что запрос успел сделать.
        # Без savepoint упавший запрос оставлял свои изменения в сессии теста
        async with session.begin_nested():
            yield session

    app.dependency_overrides[get_db_session] = _get_test_session
    app.state.db_session_maker = session_maker
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as http_client:
        yield http_client
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
def login_as(session_maker):
    """завести пользователю серверную сессию и вернуть заголовок с кукой.

    сессия свежая, так что до Keycloak дело не доходит
    """
    store = SessionStore(session_maker)
    cipher = TokenCipher(settings.session_secret_key)

    async def _login(user) -> dict[str, str]:
        raw_key = secrets.token_urlsafe(32)
        await store.create(
            key_hash=hash_session_key(raw_key),
            user_id=user.id,
            refresh_token=cipher.encrypt("refresh"),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        return {"Cookie": f"{SESSION_COOKIE}={raw_key}"}

    return _login


@pytest.fixture
def keycloak_stub(monkeypatch):
    """подменяем только внешний провайдер, всё остальное настоящее.

    handler(url, data) -> httpx.Response; возвращает список сделанных вызовов
    """
    calls = []

    def _install(handler):
        async def _post(url, *args, **kwargs):
            calls.append((url, kwargs.get("data", {})))
            response = handler(url, kwargs.get("data", {}))
            # без привязанного запроса httpx не даёт вызвать raise_for_status
            response.request = httpx.Request("POST", url)
            return response

        monkeypatch.setattr(keycloak_client.oidc_client, "post", _post)
        return calls

    return _install


class KeycloakDirectory:
    """Admin API Keycloak как справочник: кто включён и с какими ролями"""

    def __init__(self):
        self.users: dict[str, tuple[bool, list[str]]] = {}
        self.down = False

    def add(self, user, *, enabled=True, roles=None):
        self.users[user.id] = (enabled, roles or [user.role.value])

    async def get(self, url, *args, **kwargs):
        if self.down:
            raise httpx.ConnectError("keycloak is down")
        user_id, *rest = url.split("/users/", 1)[1].split("/")
        request = httpx.Request("GET", url)
        if user_id not in self.users:
            return httpx.Response(404, request=request)
        enabled, roles = self.users[user_id]
        if not rest:
            return httpx.Response(200, json={"id": user_id, "enabled": enabled}, request=request)
        return httpx.Response(200, json=[{"name": r} for r in roles], request=request)


@pytest.fixture
def keycloak_directory(monkeypatch):
    directory = KeycloakDirectory()
    monkeypatch.setattr(keycloak_client.http_client, "get", directory.get)
    return directory
