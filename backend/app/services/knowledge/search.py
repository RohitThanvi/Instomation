import unicodedata
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import Settings
from app.models.business import KnowledgeEntry


def _words(text: str) -> Iterator[str]:
    """Maximal runs of letters, combining marks and digits.

    Python's `\\w` omits combining marks (categories Mc/Mn), which would shred Indic words such as
    "डिलीवरी" into fragments, so the character categories are checked directly. Everything else,
    including "_", separates words, matching how PostgreSQL's parser splits text for the index.
    """
    word: list[str] = []
    for char in text:
        if unicodedata.category(char)[0] in "LMN":
            word.append(char)
        elif word:
            yield "".join(word)
            word = []
    if word:
        yield "".join(word)


@dataclass(frozen=True, slots=True)
class KnowledgeHit:
    entry: KnowledgeEntry
    score: float


def extract_terms(text: str, *, min_length: int, max_terms: int) -> list[str]:
    """Distinct lower-cased word tokens, in order of appearance.

    This is the only thing that ever reaches `to_tsquery`: letters, marks and digits cannot be
    tsquery operators or quotes, so untrusted customer text cannot alter the query's structure.
    """
    seen: dict[str, None] = {}
    for word in _words(text.lower()):
        if len(word) >= min_length:
            seen.setdefault(word)
        if len(seen) == max_terms:
            break
    return list(seen)


async def search_entries(
    session: AsyncSession,
    settings: Settings,
    organization_id: uuid.UUID,
    query: str,
    limit: int,
) -> list[KnowledgeHit]:
    """Full-text retrieval over one organization's active entries, best match first.

    Words are OR-ed (a natural-language question rarely contains every word of the right entry)
    and ranked by cover density. Lexical only: the 'simple' configuration does no stemming, so
    "shipping" does not match "ships". Semantic retrieval can replace this behind the same call.
    """
    terms = extract_terms(
        query,
        min_length=settings.knowledge_search_min_term_length,
        max_terms=settings.knowledge_search_max_terms,
    )
    if not terms:
        return []
    tsquery = func.to_tsquery("simple", " | ".join(terms))
    score = func.ts_rank_cd(KnowledgeEntry.search_vector, tsquery).label("score")
    rows = await session.execute(
        select(KnowledgeEntry, score)
        .where(
            KnowledgeEntry.organization_id == organization_id,
            KnowledgeEntry.deleted_at.is_(None),
            KnowledgeEntry.search_vector.op("@@")(tsquery),
        )
        .order_by(score.desc(), KnowledgeEntry.id)
        .limit(limit)
    )
    return [KnowledgeHit(entry, float(rank)) for entry, rank in rows.all()]
