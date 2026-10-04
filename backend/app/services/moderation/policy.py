from app.models.enums import HandoffReason, Intent
from app.services.moderation.types import (
    Decision,
    ModerationAction,
    ModerationCategory,
    Verdict,
    VerdictSource,
)

_BLOCKED_INTENT = {
    ModerationCategory.SPAM: Intent.SPAM,
    ModerationCategory.SEXUAL: Intent.SEXUAL,
    ModerationCategory.OFFENSIVE: Intent.OFFENSIVE,
}


def decide(verdict: Verdict, min_confidence: float) -> Decision:
    """Fail closed: the only path to ALLOW is a confident 'clean'.

    A threat is escalated at any confidence, because a false alarm costs a human a glance while a
    missed threat is the failure moderation exists to prevent.
    """
    category, confidence, source = verdict.category, verdict.confidence, verdict.source

    def make(
        action: ModerationAction, intent: Intent | None, reason: HandoffReason | None
    ) -> Decision:
        return Decision(action, category, source, confidence, intent, reason)

    if category is ModerationCategory.THREAT:
        return make(ModerationAction.ESCALATE, Intent.HUMAN_REQUIRED, HandoffReason.THREAT)
    if category is None or source is VerdictSource.FAIL_SAFE or confidence < min_confidence:
        return make(ModerationAction.ESCALATE, Intent.UNCERTAIN, HandoffReason.LOW_CONFIDENCE)
    if category is ModerationCategory.CLEAN:
        return make(ModerationAction.ALLOW, None, None)
    return make(ModerationAction.BLOCK, _BLOCKED_INTENT[category], None)
