import pytest
import httpx
from tests.helpers.session import get_authenticated_client, get_admin_cookie

BASE_URL = "http://127.0.0.1:8000"


@pytest.fixture
async def client():
    """Anonymous httpx AsyncClient."""
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        yield c


@pytest.fixture
async def admin_client():
    """Authenticated httpx AsyncClient with admin session cookie."""
    client = await get_authenticated_client()
    try:
        yield client
    finally:
        await client.aclose()


@pytest.fixture
async def admin_cookie():
    """Admin session cookie string."""
    cookie = await get_admin_cookie()
    yield cookie