import uuid
from datetime import datetime
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import HandoffReason, KeywordMatch, RuleAction, RuleScope
from app.services.automation.matching import normalize

MAX_KEYWORDS = 20
MAX_KEYWORD_CHARS = 60
MAX_NAME_CHARS = 200
# An outer bound only: the real limits depend on the channel and are enforced by the service.
MAX_TEXT_CHARS = 2000
MAX_PREVIEW_CHARS = 2200


class RuleIn(BaseModel):
    """One automation rule. The same shape creates and replaces, so it is always sent whole."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_NAME_CHARS)
    enabled: bool = True
    applies_to: RuleScope
    keywords: list[str] = Field(min_length=1, max_length=MAX_KEYWORDS)
    keyword_match: KeywordMatch = KeywordMatch.ANY
    action: RuleAction
    reply_text: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)
    private_reply_text: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)
    handoff_reason: HandoffReason | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        name = " ".join(value.split())
        if not name:
            raise ValueError("name cannot be blank")
        return name

    @field_validator("keywords")
    @classmethod
    def _keywords(cls, value: list[str]) -> list[str]:
        """Whitespace tidied, blank ones refused, and a keyword that repeats another once folded
        (case, width, spacing) kept only once so the rule stays readable."""
        seen: set[str] = set()
        cleaned: list[str] = []
        for raw in value:
            keyword = " ".join(raw.split())
            folded = normalize(keyword)
            if not folded:
                raise ValueError("a keyword cannot be blank")
            if len(keyword) > MAX_KEYWORD_CHARS:
                raise ValueError(f"a keyword can be at most {MAX_KEYWORD_CHARS} characters")
            if folded not in seen:
                seen.add(folded)
                cleaned.append(keyword)
        return cleaned

    @field_validator("reply_text", "private_reply_text")
    @classmethod
    def _text(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @model_validator(mode="after")
    def _coherent(self) -> Self:
        if self.action is RuleAction.REPLY:
            if self.reply_text is None:
                raise ValueError("a reply rule needs reply_text")
            if self.private_reply_text is not None and self.applies_to is RuleScope.DM:
                raise ValueError("a private reply answers a comment, so it cannot be on a DM rule")
        elif self.reply_text is not None or self.private_reply_text is not None:
            raise ValueError("only a reply rule has reply text")
        if self.action is RuleAction.HANDOFF:
            if self.handoff_reason is None:
                raise ValueError("a handoff rule needs a handoff_reason")
        elif self.handoff_reason is not None:
            raise ValueError("handoff_reason only belongs to a handoff rule")
        return self


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    enabled: bool
    priority: int
    applies_to: RuleScope
    keywords: list[str]
    keyword_match: KeywordMatch
    action: RuleAction
    reply_text: str | None
    private_reply_text: str | None
    handoff_reason: HandoffReason | None
    created_at: datetime
    updated_at: datetime


class RuleOrder(BaseModel):
    """Every rule's id, in the order they should be tried."""

    model_config = ConfigDict(extra="forbid")

    ids: list[uuid.UUID] = Field(max_length=200)


class PreviewIn(BaseModel):
    """A made-up message, to see which rule would answer it."""

    model_config = ConfigDict(extra="forbid")

    scope: RuleScope
    text: str = Field(min_length=1, max_length=MAX_PREVIEW_CHARS)

    @model_validator(mode="after")
    def _one_channel(self) -> Self:
        if self.scope is RuleScope.BOTH:
            raise ValueError("a message arrives on one channel: dm or comment")
        return self


class PreviewOut(BaseModel):
    rule: RuleOut | None
