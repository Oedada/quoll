from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    keycloak_root_url: str
    keycloak_realm_name: str
    keycloak_client_id: str
    keycloak_client_secret: str
    keycloak_admin_password: str
    keycloak_redirect_uri: str
    postgres_password: str
    postgres_port: int
    postgres_path: str
    postgres_host: str
    postgres_user: str
    storage_path: str
    app_admin_username: str
    app_admin_email: str
    app_admin_password: str

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()  # pyright: ignore [reportCallIssue]
