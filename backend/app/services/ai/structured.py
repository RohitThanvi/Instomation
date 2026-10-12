import re

from pydantic import BaseModel, ValidationError

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")


def parse_model[M: BaseModel](raw: str, model: type[M]) -> M | None:
    """Strictly validate a model's JSON answer; None for anything that is not exactly that shape
    (prose, extra text, wrong types, out-of-range values). Callers must fail closed on None."""
    try:
        return model.model_validate_json(_FENCE.sub("", raw.strip()))
    except ValidationError:
        return None
