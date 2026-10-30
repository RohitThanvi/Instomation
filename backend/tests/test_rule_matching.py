from dataclasses import dataclass, field

import pytest

from app.models.enums import KeywordMatch, RuleScope
from app.services.automation.matching import first_match, normalize, rule_matches


@dataclass
class Rule:
    applies_to: RuleScope = RuleScope.BOTH
    keywords: list[str] = field(default_factory=list)
    keyword_match: KeywordMatch = KeywordMatch.ANY
    name: str = "rule"


DM, COMMENT = RuleScope.DM, RuleScope.COMMENT


class TestNormalize:
    def test_case_and_spacing_do_not_matter(self) -> None:
        assert normalize("  Price \n\t LIST  ") == "price list"

    def test_full_width_and_styled_letters_fold_to_plain_ones(self) -> None:
        assert normalize("ＰＲＩＣＥ") == "price"
        assert normalize("ｐｒｉｃｅ １２３") == "price 123"

    def test_non_latin_case_folding(self) -> None:
        assert normalize("STRASSE") == normalize("straße") == "strasse"
        assert normalize("ΣΊΣΥΦΟΣ") == normalize("σίσυφος")

    def test_empty_stays_empty(self) -> None:
        assert normalize("  \n ") == ""


class TestKeywords:
    def test_any_needs_one_keyword(self) -> None:
        rule = Rule(keywords=["price", "cost"])
        assert rule_matches(rule, DM, "What's the PRICE?")
        assert rule_matches(rule, DM, "how much does it cost")
        assert not rule_matches(rule, DM, "hello there")

    def test_all_needs_every_keyword(self) -> None:
        rule = Rule(keywords=["price", "delivery"], keyword_match=KeywordMatch.ALL)
        assert rule_matches(rule, DM, "price and delivery please")
        assert not rule_matches(rule, DM, "just the price")

    def test_a_phrase_matches_across_any_whitespace(self) -> None:
        rule = Rule(keywords=["opening hours"])
        assert rule_matches(rule, DM, "what are your Opening   Hours?")
        assert rule_matches(rule, DM, "opening\nhours?")
        assert not rule_matches(rule, DM, "hours of opening")

    def test_matching_is_by_substring_so_scripts_without_spaces_work(self) -> None:
        assert rule_matches(Rule(keywords=["价格"]), DM, "请问价格多少")
        assert rule_matches(Rule(keywords=["कीमत"]), DM, "इसकी कीमत क्या है")

    def test_a_substring_inside_a_longer_word_does_match(self) -> None:
        # Documented behaviour: keywords are substrings. The rule author picks specific ones.
        assert rule_matches(Rule(keywords=["price"]), DM, "priceless")

    def test_a_blank_keyword_never_matches_everything(self) -> None:
        assert not rule_matches(Rule(keywords=["   "]), DM, "anything at all")
        assert not rule_matches(Rule(keywords=[""]), DM, "anything at all")
        all_rule = Rule(keywords=["price", " "], keyword_match=KeywordMatch.ALL)
        assert not rule_matches(all_rule, DM, "price")

    def test_full_width_text_matches_a_plain_keyword(self) -> None:
        assert rule_matches(Rule(keywords=["price"]), DM, "ＰＲＩＣＥ?")


class TestScope:
    @pytest.mark.parametrize(
        ("applies_to", "scope", "expected"),
        [
            (RuleScope.DM, DM, True),
            (RuleScope.DM, COMMENT, False),
            (RuleScope.COMMENT, COMMENT, True),
            (RuleScope.COMMENT, DM, False),
            (RuleScope.BOTH, DM, True),
            (RuleScope.BOTH, COMMENT, True),
        ],
    )
    def test_a_rule_only_applies_to_its_channels(
        self, applies_to: RuleScope, scope: RuleScope, expected: bool
    ) -> None:
        assert rule_matches(Rule(applies_to=applies_to, keywords=["hi"]), scope, "hi") is expected

    def test_a_message_is_never_on_both_channels(self) -> None:
        with pytest.raises(ValueError, match="BOTH"):
            rule_matches(Rule(keywords=["hi"]), RuleScope.BOTH, "hi")


@pytest.mark.parametrize("mode", list(KeywordMatch))
def test_a_rule_with_no_keywords_never_fires_in_either_mode(mode: KeywordMatch) -> None:
    # all([]) is true, so "every keyword appears" would otherwise match every message.
    assert not rule_matches(Rule(keyword_match=mode), DM, "anything")


class TestFirstMatch:
    def test_the_first_matching_rule_in_the_order_given_wins(self) -> None:
        rules = [
            Rule(name="a", keywords=["refund"]),
            Rule(name="b", keywords=["price"]),
            Rule(name="c", keywords=["price", "refund"]),
        ]
        assert first_match(rules, DM, "price and refund").name == "a"  # type: ignore[union-attr]
        assert first_match(rules, DM, "the price").name == "b"  # type: ignore[union-attr]

    def test_no_match_is_none(self) -> None:
        assert first_match([Rule(keywords=["x"])], DM, "y") is None
        assert first_match([], DM, "y") is None

    def test_a_rule_for_another_channel_is_skipped_not_chosen(self) -> None:
        rules = [
            Rule(name="dm only", applies_to=DM, keywords=["hi"]),
            Rule(name="any", keywords=["hi"]),
        ]
        assert first_match(rules, COMMENT, "hi").name == "any"  # type: ignore[union-attr]
