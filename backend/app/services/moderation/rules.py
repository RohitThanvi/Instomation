"""Deterministic, model-free checks. They run first because they are free, cannot be talked out of
their verdict by the message text, and keep spam floods away from the AI quota."""

import re

from app.config.settings import Settings
from app.services.moderation.types import ModerationCategory, Verdict, VerdictSource

_LINK = re.compile(r"(?i)\b(?:https?://|www\.)\S+")
_MENTION = re.compile(r"@\w+")


def check_rules(text: str, settings: Settings) -> Verdict | None:
    """Return a verdict when the structure alone decides the outcome, else None (ask the model)."""
    if len(text) > settings.moderation_max_input_chars:
        # Meta cannot deliver this much text, so it is anomalous. Not truncated: padding in front
        # of a threat would otherwise push the threat past the cut.
        return Verdict(None, 0.0, VerdictSource.FAIL_SAFE)
    if len(_LINK.findall(text)) > settings.moderation_max_links:
        return Verdict(ModerationCategory.SPAM, 1.0, VerdictSource.RULES)
    if len(_MENTION.findall(text)) > settings.moderation_max_mentions:
        return Verdict(ModerationCategory.SPAM, 1.0, VerdictSource.RULES)
    return None
