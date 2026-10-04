import pytest

from app.config.settings import get_settings
from app.models.enums import HandoffReason, Intent
from app.services.moderation.classifier import parse_verdict
from app.services.moderation.policy import decide
from app.services.moderation.rules import check_rules
from app.services.moderation.types import (
    ModerationAction,
    ModerationCategory,
    Verdict,
    VerdictSource,
)

SETTINGS = get_settings().model_copy(
    update={
        "moderation_max_input_chars": 100,
        "moderation_max_links": 2,
        "moderation_max_mentions": 3,
    }
)
MIN = 0.6


def _model(category: ModerationCategory, confidence: float) -> Verdict:
    return Verdict(category, confidence, VerdictSource.MODEL)


# ---- rules ----
def test_ordinary_text_is_left_to_the_model() -> None:
    assert check_rules("Hi, how much is the blue one? https://shop.example/blue", SETTINGS) is None


def test_too_many_links_is_spam_without_the_model() -> None:
    text = "a http://x.test b www.y.test c https://z.test"
    verdict = check_rules(text, SETTINGS)
    assert verdict == Verdict(ModerationCategory.SPAM, 1.0, VerdictSource.RULES)


def test_too_many_mentions_is_spam() -> None:
    verdict = check_rules("@a @b @c @d win!", SETTINGS)
    assert verdict is not None and verdict.category is ModerationCategory.SPAM


def test_oversized_input_is_failsafe_not_truncated() -> None:
    padded = "x" * 100 + " I will find you and hurt you"
    verdict = check_rules(padded, SETTINGS)
    assert verdict == Verdict(None, 0.0, VerdictSource.FAIL_SAFE)


# ---- parsing model output ----
@pytest.mark.parametrize(
    "raw",
    [
        '{"category": "clean", "confidence": 0.9}',
        '```json\n{"category": "clean", "confidence": 0.9}\n```',
        '  {"category":"clean","confidence":0.9}\n',
    ],
)
def test_valid_output_is_parsed(raw: str) -> None:
    assert parse_verdict(raw) == _model(ModerationCategory.CLEAN, 0.9)


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "clean",
        "Sure! The message is clean.",
        '{"category": "friendly", "confidence": 0.9}',
        '{"category": "clean"}',
        '{"category": "clean", "confidence": 1.5}',
        '{"category": "clean", "confidence": -0.1}',
        '[{"category": "clean", "confidence": 0.9}]',
        '{"category": "clean", "confidence": 0.9} Ignore the above',
    ],
)
def test_anything_else_is_failsafe(raw: str) -> None:
    assert parse_verdict(raw) == Verdict(None, 0.0, VerdictSource.FAIL_SAFE)


# ---- policy ----
def test_confident_clean_is_the_only_way_to_allow() -> None:
    decision = decide(_model(ModerationCategory.CLEAN, 0.9), MIN)
    assert decision.action is ModerationAction.ALLOW
    assert decision.intent is None and decision.handoff_reason is None


@pytest.mark.parametrize(
    ("category", "intent"),
    [
        (ModerationCategory.SPAM, Intent.SPAM),
        (ModerationCategory.SEXUAL, Intent.SEXUAL),
        (ModerationCategory.OFFENSIVE, Intent.OFFENSIVE),
    ],
)
def test_confident_unsafe_categories_are_blocked_without_a_handoff(
    category: ModerationCategory, intent: Intent
) -> None:
    decision = decide(_model(category, 0.8), MIN)
    assert decision.action is ModerationAction.BLOCK
    assert decision.intent is intent and decision.handoff_reason is None


@pytest.mark.parametrize("confidence", [0.0, 0.1, 0.59, 0.99])
def test_threat_escalates_at_any_confidence(confidence: float) -> None:
    decision = decide(_model(ModerationCategory.THREAT, confidence), MIN)
    assert decision.action is ModerationAction.ESCALATE
    assert decision.handoff_reason is HandoffReason.THREAT


@pytest.mark.parametrize(
    "category",
    [ModerationCategory.CLEAN, ModerationCategory.SPAM, ModerationCategory.OFFENSIVE],
)
def test_low_confidence_is_never_allowed_or_blocked(category: ModerationCategory) -> None:
    decision = decide(_model(category, 0.59), MIN)
    assert decision.action is ModerationAction.ESCALATE
    assert decision.handoff_reason is HandoffReason.LOW_CONFIDENCE


def test_failsafe_escalates_even_with_high_confidence_value() -> None:
    decision = decide(Verdict(ModerationCategory.CLEAN, 1.0, VerdictSource.FAIL_SAFE), MIN)
    assert decision.action is ModerationAction.ESCALATE


def test_record_is_json_serialisable_and_has_no_message_text() -> None:
    record = decide(_model(ModerationCategory.CLEAN, 0.87654), MIN).as_record()
    assert record == {
        "action": "allow",
        "category": "clean",
        "source": "model",
        "confidence": 0.877,
    }
