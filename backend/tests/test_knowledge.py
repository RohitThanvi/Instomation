import unicodedata

import pytest
from pydantic import ValidationError

from app.models.enums import KnowledgeKind
from app.schemas.knowledge import (
    ATTRIBUTE_KEY_MAX,
    ATTRIBUTE_VALUE_MAX,
    ATTRIBUTES_MAX_KEYS,
    CONTENT_MAX,
    TITLE_MAX,
    EntryCreate,
    EntryUpdate,
)
from app.services.knowledge.search import extract_terms


def _terms(text: str, min_length: int = 3, max_terms: int = 12) -> list[str]:
    return extract_terms(text, min_length=min_length, max_terms=max_terms)


# ---- term extraction: the only text that may reach to_tsquery ----
def test_terms_are_lowercased_distinct_and_in_order() -> None:
    assert _terms("Shipping SHIPPING to Canada, shipping!") == ["shipping", "canada"]


def test_short_words_are_dropped() -> None:
    assert _terms("do you ship to US or EU") == ["you", "ship"]


def test_term_count_is_capped() -> None:
    assert _terms("alpha bravo charlie delta echo", max_terms=3) == ["alpha", "bravo", "charlie"]


@pytest.mark.parametrize(
    "hostile",
    ["a & b | c", "!(x)", "foo:*bar", "<->", "it's", "x\\y", "'); drop table t; --", "a\x00b"],
)
def test_tsquery_syntax_never_survives_extraction(hostile: str) -> None:
    for term in _terms(hostile, min_length=1):
        assert all(unicodedata.category(c)[0] in "LMN" for c in term), term


def test_unicode_words_survive() -> None:
    assert "café" in _terms("Café menu")


def test_indic_words_keep_their_combining_marks() -> None:
    # \w+ would split these into fragments at every vowel sign.
    assert _terms("क्या डिलीवरी उपलब्ध है", min_length=2) == ["क्या", "डिलीवरी", "उपलब्ध", "है"]


def test_underscore_and_punctuation_separate_words() -> None:
    assert _terms("foo_bar e-mail 3.5kg") == ["foo", "bar", "mail", "5kg"]


def test_nothing_usable_gives_no_terms() -> None:
    assert _terms("?! .. a is") == []


# ---- schemas ----
def _create(**overrides: object) -> EntryCreate:
    data: dict[str, object] = {"kind": "faq", "title": "T", "content": "C"} | overrides
    return EntryCreate.model_validate(data)


def test_title_and_content_are_stripped() -> None:
    entry = _create(title="  Hours  ", content="\n Open 9-5 \n")
    assert (entry.title, entry.content) == ("Hours", "Open 9-5")


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": "   "},
        {"content": ""},
        {"title": "x" * (TITLE_MAX + 1)},
        {"content": "x" * (CONTENT_MAX + 1)},
        {"kind": "blog"},
        {"attributes": {str(i): i for i in range(ATTRIBUTES_MAX_KEYS + 1)}},
        {"attributes": {"": 1}},
        {"attributes": {"k" * (ATTRIBUTE_KEY_MAX + 1): 1}},
        {"attributes": {"k": "v" * (ATTRIBUTE_VALUE_MAX + 1)}},
        {"attributes": {"nested": {"a": 1}}},
        {"attributes": {"list": [1, 2]}},
    ],
)
def test_invalid_create_is_rejected(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        _create(**overrides)


def test_limits_are_inclusive() -> None:
    entry = _create(title="x" * TITLE_MAX, content="y" * CONTENT_MAX, attributes={"k": "v" * 500})
    assert entry.kind is KnowledgeKind.FAQ


@pytest.mark.parametrize("payload", [{}, {"title": None}, {"content": None, "kind": None}])
def test_update_needs_at_least_one_real_value(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        EntryUpdate.model_validate(payload)


def test_update_allows_clearing_attributes_with_an_empty_object() -> None:
    assert EntryUpdate.model_validate({"attributes": {}}).attributes == {}
