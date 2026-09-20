from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    keycloak_root_url: str
    keycloak_realm_name: str
    keycloak_client_id: str
    keycloak_admin_password: str
    keycloak_redirect_uri: str
    postgres_password: str
    postgres_port: int
    postgres_path: str
    postgres_host: str
    storage_path: str
    s3_endpoint_url: str
    s3_access_key: str
    s3_secret_key: str
    s3_bucket_name: str
    s3_region_name: str
    max_upload_size_mb: int

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()  # pyright: ignore [reportCallIssue]
