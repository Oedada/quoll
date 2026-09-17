import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from quoll.auth import KeyCloakData, auth_router
from quoll.config import settings
from quoll.core import read_storage
from quoll.core.storage import write_storage

logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.debug("Creating database engine")
    app.state.db_engine = create_async_engine(
        f"postgresql+asyncpg://postgres:{settings.postgres_password}@{settings.postgres_host}:{settings.postgres_port}/{settings.postgres_path}"
    )
    logger.debug("Creating async session maker")
    app.state.db_session_maker = async_sessionmaker(bind=app.state.db_engine)
    logger.debug("Reading storage")
    storage = read_storage()
    logger.debug("Initializing KeyCloakData from storage")
    app.state.keycloak = await KeyCloakData.from_storage(
        storage, AsyncClient(base_url="http://127.0.0.1:8081", timeout=10)
    )
    logger.info("Application started")

    yield

    logger.debug("Disposing database engine")
    await app.state.db_engine.dispose()
    logger.debug("Closing Keycloak HTTP client")
    await app.state.keycloak.http_client.aclose()
    logger.debug("Writing storage")
    app.state.keycloak.write_to_storage(storage)
    write_storage(storage)
    logger.info("Application stopped")


app = FastAPI(lifespan=lifespan)
app.include_router(auth_router, prefix="/auth")


@app.get("/")
async def root():
    return JSONResponse(content={"ok": True})
