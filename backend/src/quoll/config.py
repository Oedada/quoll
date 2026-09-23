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
    s3_endpoint_url: str
    s3_access_key: str
    s3_secret_key: str
    s3_bucket_name: str
    s3_region_name: str
    max_upload_size_mb: int
    # ключ шифрования refresh-токенов, несколько через запятую = ротация
    session_secret_key: str
    # выключать только для локальной разработки по http
    session_cookie_secure: bool = True
    session_revalidate_seconds: int = 300
    session_revalidate_hard_limit_seconds: int = 900

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()  # pyright: ignore [reportCallIssue]
