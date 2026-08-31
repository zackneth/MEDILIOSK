from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    bey_api_key: str = ""
    groq_api_key: str = ""
    bey_avatar_id: str = "default"
    his_mock_endpoint: str = "http://localhost:8000/mock-his/fhir"
    app_env: str = "development"
    allowed_origins: str = "http://localhost:5173"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
