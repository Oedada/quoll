import json
import secrets
from dataclasses import dataclass

import requests
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

print("http://localhost:8000/auth")

router = APIRouter()


@dataclass
class Tokens:
    access: str
    refresh: str


sessions: dict[str, Tokens] = {}


def get_pbk():
    resp = requests.get(f"{BASE_URL}/certs")
    print(resp.content)


@router.get("/")
def root(req: Request):
    session_id = req.cookies.get("session")
    if session_id is None:
        return RedirectResponse("/auth")
    tokens = sessions.get(session_id)
    if tokens is None:
        return RedirectResponse("/auth")

    get_pbk()
    return "Main page"


@router.get("/auth")
def auth():
    url = (
        f"{BASE_URL}/auth"
        f"?client_id={CLIENT_ID}"
        f"&redirect_uri={REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=openid"
    )
    return RedirectResponse(url)


@router.get("/callback")
def callback(code: str):
    auth_resp = requests.post(
        f"{BASE_URL}/token",
        headers={"content-type": "application/x-www-form-urlencoded"},
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
        },
    )
    auth_data = json.loads(auth_resp.content)
    session_id = secrets.token_urlsafe(64)
    sessions[session_id] = Tokens(auth_data["access_token"], auth_data["refresh_token"])
    resp = requests.get(
        f"{BASE_URL}/userinfo",
        headers={"Authorization": f"Bearer {auth_data['access_token']}"},
    )
    print("\n".join([f"{k}: {v}" for k, v in json.loads(resp.content).items()]))
    response = RedirectResponse("/")
    response.set_cookie("session", session_id, httponly=True)
    return response
