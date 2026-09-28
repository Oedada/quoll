"""uv run python -m quoll.seed workflow"""

import asyncio
import sys

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from quoll.config import settings
from quoll.seed.workflow import ensure_reference_workflow


async def _workflow() -> None:
    engine = create_async_engine(
        f"postgresql+asyncpg://{settings.postgres_user}:{settings.postgres_password}"
        f"@{settings.postgres_host}:{settings.postgres_port}/{settings.postgres_path}"
    )
    async with AsyncSession(engine) as session:
        created = await ensure_reference_workflow(session)
        await session.commit()
    await engine.dispose()
    print("created" if created else "already there")


if __name__ == "__main__":
    if sys.argv[1:] != ["workflow"]:
        sys.exit("usage: python -m quoll.seed workflow")
    asyncio.run(_workflow())
