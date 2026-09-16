from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from quoll.auth import auth_router

DB_PASSWORD = "1223334444"
DB_PATH = "quoll_db"
DB_PORT = "5432"
# TODO: убрать все секреты в .env
SECRET_KEY = "dkssfjalas"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_engine = create_async_engine(f"postgresql+asyncpg://postgres:{DB_PASSWORD}@localhost:{DB_PORT}/{DB_PATH}")
    app.state.db_session_maker = async_sessionmaker(bind=app.state.db_engine)

    yield

    await app.state.db_engine.dispose()



app = FastAPI(lifespan=lifespan)
# создать свой роутер с помощью APIouter
app.include_router(auth_router, prefix="/auth")


@app.get("/")
async def root():
    return JSONResponse(content={"ok": True})
