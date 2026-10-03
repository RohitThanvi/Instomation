from decimal import Decimal

# USD per 1,000 tokens. Source: each provider's published pricing page; review periodically — these
# are business data, not configuration a human should need to touch per environment. An unknown
# (provider, model) pair prices at zero rather than raising, so usage is never lost over a pricing
# gap; it is logged so the gap gets noticed and this table gets updated.
_PRICE_PER_1K_TOKENS: dict[tuple[str, str], tuple[Decimal, Decimal]] = {
    ("groq", "llama-3.3-70b-versatile"): (Decimal("0.00059"), Decimal("0.00079")),
    ("groq", "llama-3.1-8b-instant"): (Decimal("0.00005"), Decimal("0.00008")),
    ("openai", "gpt-4o-mini"): (Decimal("0.00015"), Decimal("0.0006")),
    ("openai", "gpt-4o"): (Decimal("0.0025"), Decimal("0.01")),
}


def estimate_cost(provider: str, model: str, input_tokens: int, output_tokens: int) -> Decimal:
    prices = _PRICE_PER_1K_TOKENS.get((provider, model))
    if prices is None:
        return Decimal("0")
    input_price, output_price = prices
    return (Decimal(input_tokens) * input_price + Decimal(output_tokens) * output_price) / Decimal(
        1000
    )
