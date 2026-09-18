import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from quoll.auth import auth_router
from quoll.config import settings
from quoll.core import AppException
from quoll.db import Base
from quoll.interactions import (
    interactions_router,
    universities_router,
    vendors_router,
)
from quoll.workflows import (
    stages_router,
    transitions_router,
    workflows_router,
)

logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
for logger_name in ["httpcore", "httpx"]:
    logging.getLogger(logger_name).setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.debug("Creating database engine")
    app.state.db_engine = create_async_engine(
        f"postgresql+asyncpg://{settings.postgres_user}:{settings.postgres_password}@{settings.postgres_host}:{settings.postgres_port}/{settings.postgres_path}"
    )
    logger.debug("Creating async session maker")
    app.state.db_session_maker = async_sessionmaker(
        bind=app.state.db_engine, expire_on_commit=False
    )
    logger.debug("Creating database tables")
    async with app.state.db_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.debug("Reading storage")
    logger.info("Application started")

    yield

    logger.debug("Disposing database engine")
    await app.state.db_engine.dispose()
    logger.info("Application stopped")


app = FastAPI(
    title="Quoll API",
    version="0.1.0",
    lifespan=lifespan,
)


@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    logger.warning(
        f"Domain exception on {request.method} {request.url.path}: {exc.message} (HTTP {exc.status_code})"
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(
        f"Unhandled server error on {request.method} {request.url.path}: {exc}"
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# Routers
app.include_router(auth_router, prefix="/auth")
app.include_router(workflows_router)
app.include_router(stages_router)
app.include_router(transitions_router)
app.include_router(universities_router)
app.include_router(vendors_router)
app.include_router(interactions_router)


@app.get("/", tags=["Health"])
async def root():
    return JSONResponse(content={"ok": True})
