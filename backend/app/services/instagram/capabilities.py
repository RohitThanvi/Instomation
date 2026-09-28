from dataclasses import dataclass
from enum import StrEnum

from app.config.settings import Settings


class Feature(StrEnum):
    COMMENT_REPLY = "FEATURE_COMMENT_REPLY"
    COMMENT_LIKE = "FEATURE_COMMENT_LIKE"
    DM_REPLY = "FEATURE_DM_REPLY"
    PRIVATE_REPLY = "FEATURE_PRIVATE_REPLY"
    PROFILE_BIO_UPDATE = "FEATURE_PROFILE_BIO_UPDATE"
    PROFILE_PHOTO_UPDATE = "FEATURE_PROFILE_PHOTO_UPDATE"


_NOT_OFFERED = "Not exposed by Meta's official Instagram API."
# Verified against Meta's Instagram Platform docs: no endpoint exists for these. They cannot be
# switched on by configuration; enabling one requires an adapter method plus a code change here.
_UNSUPPORTED = frozenset(
    {Feature.COMMENT_LIKE, Feature.PROFILE_BIO_UPDATE, Feature.PROFILE_PHOTO_UPDATE}
)


@dataclass(frozen=True, slots=True)
class Capability:
    feature: Feature
    enabled: bool
    reason: str | None = None


class Capabilities:
    def __init__(self, settings: Settings) -> None:
        toggles = {
            Feature.COMMENT_REPLY: settings.feature_comment_reply,
            Feature.DM_REPLY: settings.feature_dm_reply,
            Feature.PRIVATE_REPLY: settings.feature_private_reply,
        }
        self._items: dict[Feature, Capability] = {}
        for feature in Feature:
            if feature in _UNSUPPORTED:
                self._items[feature] = Capability(feature, False, _NOT_OFFERED)
            elif toggles[feature]:
                self._items[feature] = Capability(feature, True)
            else:
                self._items[feature] = Capability(feature, False, "Disabled for this environment.")

    def is_enabled(self, feature: Feature) -> bool:
        return self._items[feature].enabled

    def all(self) -> list[Capability]:
        return list(self._items.values())
