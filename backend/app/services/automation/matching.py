"""Whether an automation rule applies to a message. Pure: no database, no clock, no model call, so
the same answer comes back for the same message every time and it can be tested exhaustively."""

import unicodedata
from collections.abc import Iterable, Sequence
from typing import Protocol

from app.models.enums import KeywordMatch, RuleScope


class RuleConditions(Protocol):
    # Read-only, so a model whose columns are plain attributes satisfies it.
    @property
    def applies_to(self) -> RuleScope: ...
    @property
    def keywords(self) -> Sequence[str]: ...
    @property
    def keyword_match(self) -> KeywordMatch: ...


def normalize(text: str) -> str:
    """The form text is compared in: compatibility-folded (so full-width and styled letters match
    their plain forms), case-folded, with every run of whitespace collapsed to one space."""
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def rule_matches[R: RuleConditions](rule: R, scope: RuleScope, text: str) -> bool:
    """`scope` is the channel the message arrived on (DM or COMMENT, never BOTH).

    The rule's keywords are looked for as substrings of the normalized text: any one of them, or
    every one, per `keyword_match`. A rule without a keyword never fires, so a half-saved rule
    cannot answer everything.
    """
    if scope is RuleScope.BOTH:
        raise ValueError("a message arrives on one channel; scope cannot be BOTH")
    if rule.applies_to not in (scope, RuleScope.BOTH) or not rule.keywords:
        return False
    haystack = normalize(text)
    found = []
    for keyword in rule.keywords:
        needle = normalize(keyword)
        found.append(bool(needle) and needle in haystack)
    return any(found) if rule.keyword_match is KeywordMatch.ANY else all(found)


def first_match[R: RuleConditions](rules: Iterable[R], scope: RuleScope, text: str) -> R | None:
    """The first rule, in the order given, that matches. Callers pass rules in priority order."""
    for rule in rules:
        if rule_matches(rule, scope, text):
            return rule
    return None
