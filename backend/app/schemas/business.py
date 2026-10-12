from typing import Annotated, Self

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    field_validator,
    model_validator,
)

from app.models.enums import CommunicationStyle

MAX_MAP_KEY = 50
CONTACT_MAX_ITEMS, CONTACT_MAX_VALUE = 10, 200
POLICY_MAX_ITEMS, POLICY_MAX_VALUE = 10, 500

_Text = Annotated[str, StringConstraints(strip_whitespace=True)]
_Brand = Annotated[_Text, StringConstraints(max_length=200)]
_Description = Annotated[_Text, StringConstraints(max_length=2000)]
_Industry = Annotated[_Text, StringConstraints(max_length=120)]
_Location = Annotated[_Text, StringConstraints(max_length=200)]
_Instructions = Annotated[_Text, StringConstraints(max_length=2000)]
_HTTP_URL = TypeAdapter(AnyHttpUrl)


def _check_map(
    value: dict[str, str], *, max_items: int, max_value: int, label: str
) -> dict[str, str]:
    """These maps are rendered into the model's prompt, so their size is a bound, not a courtesy."""
    if len(value) > max_items:
        raise ValueError(f"at most {max_items} {label} are allowed")
    cleaned: dict[str, str] = {}
    for key, item in value.items():
        key, item = key.strip(), item.strip()
        if not 1 <= len(key) <= MAX_MAP_KEY or not item or len(item) > max_value:
            raise ValueError(
                f"{label}: names are 1-{MAX_MAP_KEY} characters and values 1-{max_value}"
            )
        cleaned[key] = item
    return cleaned


class BusinessProfileIn(BaseModel):
    """Replaces the whole profile: a field left out is cleared, so a form can submit its state."""

    model_config = ConfigDict(extra="forbid")

    brand_name: _Brand | None = None
    description: _Description | None = None
    industry: _Industry | None = None
    location: _Location | None = None
    website: str | None = Field(default=None, max_length=500)
    contact_info: dict[str, str] = Field(default_factory=dict)
    policies: dict[str, str] = Field(default_factory=dict)
    communication_style: CommunicationStyle = CommunicationStyle.PROFESSIONAL
    custom_instructions: _Instructions | None = None

    @field_validator("brand_name", "description", "industry", "location", "custom_instructions")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("website")
    @classmethod
    def _website(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        value = value.strip()
        _HTTP_URL.validate_python(value)  # http(s) only: this URL is later allowed in replies
        return value

    @field_validator("contact_info")
    @classmethod
    def _contact(cls, value: dict[str, str]) -> dict[str, str]:
        return _check_map(
            value, max_items=CONTACT_MAX_ITEMS, max_value=CONTACT_MAX_VALUE, label="contact details"
        )

    @field_validator("policies")
    @classmethod
    def _policies(cls, value: dict[str, str]) -> dict[str, str]:
        return _check_map(
            value, max_items=POLICY_MAX_ITEMS, max_value=POLICY_MAX_VALUE, label="policies"
        )


class BusinessProfileOut(BaseModel):
    brand_name: str | None
    description: str | None
    industry: str | None
    location: str | None
    website: str | None
    contact_info: dict[str, str]
    policies: dict[str, str]
    communication_style: CommunicationStyle
    custom_instructions: str | None


class AiSettingsUpdate(BaseModel):
    """Partial update: only the fields sent change. Only settings the pipeline honors appear."""

    model_config = ConfigDict(extra="forbid")

    dm_automation_enabled: bool | None = None
    comment_automation_enabled: bool | None = None
    confidence_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    max_response_tokens: int | None = Field(default=None, ge=50, le=1000)
    temperature: float | None = Field(default=None, ge=0.0, le=1.0)
    max_replies_per_conversation_per_hour: int | None = Field(default=None, ge=1, le=100)

    @model_validator(mode="after")
    def _at_least_one_value(self) -> Self:
        if not self.model_fields_set or all(
            getattr(self, name) is None for name in self.model_fields_set
        ):
            raise ValueError("provide at least one setting to change")
        return self


class AiSettingsOut(BaseModel):
    dm_automation_enabled: bool
    comment_automation_enabled: bool
    confidence_threshold: float
    max_response_tokens: int
    temperature: float
    max_replies_per_conversation_per_hour: int
