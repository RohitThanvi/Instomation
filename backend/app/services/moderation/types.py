from dataclasses import dataclass
from enum import StrEnum

from app.models.enums import HandoffReason, Intent


class ModerationCategory(StrEnum):
    CLEAN = "clean"
    SPAM = "spam"
    SEXUAL = "sexual"
    OFFENSIVE = "offensive"
    THREAT = "threat"


class ModerationAction(StrEnum):
    """What the pipeline may do next. Only ALLOW lets reply generation proceed."""

    ALLOW = "allow"
    BLOCK = "block"  # no AI reply, no human needed (spam, sexual, offensive)
    ESCALATE = "escalate"  # no AI reply; a human must look (threats, unclassifiable input)


class VerdictSource(StrEnum):
    RULES = "rules"
    MODEL = "model"
    FAIL_SAFE = "fail_safe"  # model output unusable or input unclassifiable


@dataclass(frozen=True, slots=True)
class Verdict:
    category: ModerationCategory | None  # None when nothing could be determined
    confidence: float
    source: VerdictSource


@dataclass(frozen=True, slots=True)
class Decision:
    action: ModerationAction
    category: ModerationCategory | None
    source: VerdictSource
    confidence: float
    intent: Intent | None
    handoff_reason: HandoffReason | None

    def as_record(self) -> dict[str, object]:
        """Persisted on message.moderation. Reply generation must require action == "allow"."""
        return {
            "action": self.action.value,
            "category": self.category.value if self.category else None,
            "source": self.source.value,
            "confidence": round(self.confidence, 3),
        }
