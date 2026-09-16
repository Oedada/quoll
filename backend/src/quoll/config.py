from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    keycloak_root_url: str
    keycloak_realm_name: str
    keycloak_client_id: str
    keycloak_admin_password: str
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings() # pyright: ignore [reportCallIssue]
