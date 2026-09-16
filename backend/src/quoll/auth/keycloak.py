from fastapi import FastAPI
from pydantic import BaseModel

from quoll.config import settings


class AccessToken(BaseModel):
    access_token: str


class ClientSecret(BaseModel):
    value: str


class Client(BaseModel):
    id: str


class User(BaseModel):
    id: str


class Role(BaseModel):
    id: str
    name: str


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "content-type": "application/json",
    }


async def get_admin_token(app: FastAPI) -> AccessToken:
    client = app.state.keycloak_http_client
    resp = await client.post(
        url=f"{settings.keycloak_root_url}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": "admin",
            "password": settings.keycloak_admin_password,
        },
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    resp.raise_for_status()
    return AccessToken.model_validate(resp.json())


async def create_realm(app: FastAPI, token: str) -> None:
    client = app.state.keycloak_http_client
    resp = await client.post(
        url=f"{settings.keycloak_root_url}/admin/realms",
        json={"realm": settings.keycloak_realm_name, "enabled": True},
        headers=_headers(token),
    )
    resp.raise_for_status()


async def create_client(app: FastAPI, token: str) -> str:
    client = app.state.keycloak_http_client
    resp = await client.post(
        url=f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/clients",
        json={
            "clientId": settings.keycloak_client_id,
            "protocol": "openid-connect",
            "publicClient": False,
            "serviceAccountsEnabled": True,
            "standardFlowEnabled": False,
            "directAccessGrantsEnabled": False,
            "authorizationServicesEnabled": False,
        },
        headers=_headers(token),
    )
    resp.raise_for_status()
    location = resp.headers["Location"]
    return location.rstrip("/").rsplit("/", 1)[1]


async def get_client_secret(app: FastAPI, token: str, client_id: str) -> str:
    client = app.state.keycloak_http_client
    resp = await client.get(
        url=f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/clients/{client_id}/client-secret",
        headers=_headers(token),
    )
    resp.raise_for_status()
    return ClientSecret.model_validate(resp.json()).value


async def get_realm_management_client_id(app: FastAPI, token: str) -> str:
    client = app.state.keycloak_http_client
    resp = await client.get(
        url=f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/clients?clientId=realm-management",
        headers=_headers(token),
    )
    resp.raise_for_status()
    clients = [Client.model_validate(c) for c in resp.json()]
    return clients[0].id


async def get_service_account_user_id(app: FastAPI, token: str, client_id: str) -> str:
    client = app.state.keycloak_http_client
    resp = await client.get(
        url=f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/clients/{client_id}/service-account-user",
        headers=_headers(token),
    )
    resp.raise_for_status()
    return User.model_validate(resp.json()).id


async def get_manage_users_role(app: FastAPI, token: str, realm_management_client_id: str) -> Role:
    client = app.state.keycloak_http_client
    resp = await client.get(
        url=f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/clients/{realm_management_client_id}/roles/manage-users",
        headers=_headers(token),
    )
    resp.raise_for_status()
    return Role.model_validate(resp.json())


async def assign_role(app: FastAPI, token: str, user_id: str, realm_management_client_id: str, role: Role) -> None:
    client = app.state.keycloak_http_client
    resp = await client.post(
        url=f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/users/{user_id}/role-mappings/clients/{realm_management_client_id}",
        json=[role.model_dump()],
        headers=_headers(token),
    )
    resp.raise_for_status()


async def init_admin_account(app: FastAPI) -> str:
    token = (await get_admin_token(app)).access_token

    await create_realm(app, token)

    client_id = await create_client(app, token)
    client_secret = await get_client_secret(app, token, client_id)

    app.state.keycloak_client_id = client_id

    realm_management_client_id = await get_realm_management_client_id(app, token)
    user_id = await get_service_account_user_id(app, token, client_id)
    role = await get_manage_users_role(app, token, realm_management_client_id)
    await assign_role(app, token, user_id, realm_management_client_id, role)

    return client_secret
