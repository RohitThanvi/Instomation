import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from app.models.enums import KnowledgeKind

TITLE_MAX = 300  # matches knowledge_entries.title String(300)
CONTENT_MAX = 4000
ATTRIBUTES_MAX_KEYS = 20
ATTRIBUTE_KEY_MAX = 50
ATTRIBUTE_VALUE_MAX = 500
SEARCH_QUERY_MAX = 500
SEARCH_MAX_LIMIT = 20

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TITLE_MAX)]
Content = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=CONTENT_MAX)
]
AttributeValue = str | int | float | bool | None
Attributes = dict[str, AttributeValue]


def _check_attributes(value: Attributes) -> Attributes:
    """Free-form but bounded: attributes are rendered into prompts, so size is a safety limit."""
    if len(value) > ATTRIBUTES_MAX_KEYS:
        raise ValueError(f"at most {ATTRIBUTES_MAX_KEYS} attributes are allowed")
    for key, item in value.items():
        if not 1 <= len(key) <= ATTRIBUTE_KEY_MAX:
            raise ValueError(f"attribute names must be 1-{ATTRIBUTE_KEY_MAX} characters")
        if isinstance(item, str) and len(item) > ATTRIBUTE_VALUE_MAX:
            raise ValueError(f"attribute values must be at most {ATTRIBUTE_VALUE_MAX} characters")
    return value


class EntryCreate(BaseModel):
    kind: KnowledgeKind
    title: Title
    content: Content
    attributes: Attributes = Field(default_factory=dict)

    _validate_attributes = field_validator("attributes")(_check_attributes)


class EntryUpdate(BaseModel):
    """Partial update: omitted fields are unchanged, and null is not a way to clear a field."""

    kind: KnowledgeKind | None = None
    title: Title | None = None
    content: Content | None = None
    attributes: Attributes | None = None

    @field_validator("attributes")
    @classmethod
    def _validate_attributes(cls, value: Attributes | None) -> Attributes | None:
        return None if value is None else _check_attributes(value)

    @model_validator(mode="after")
    def _at_least_one_value(self) -> Self:
        if not any(
            getattr(self, name) is not None for name in ("kind", "title", "content", "attributes")
        ):
            raise ValueError("provide at least one field to update")
        return self


class EntryOut(BaseModel):
    id: uuid.UUID
    kind: KnowledgeKind
    title: str
    content: str
    attributes: Attributes
    created_at: datetime
    updated_at: datetime


class SearchIn(BaseModel):
    query: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=SEARCH_QUERY_MAX)
    ]
    limit: int = Field(default=5, ge=1, le=SEARCH_MAX_LIMIT)


class SearchHit(BaseModel):
    entry: EntryOut
    score: float
