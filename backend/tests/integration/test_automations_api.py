import asyncio
import uuid
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import get_settings
from app.models.business import AutomationRule
from app.models.enums import MemberRole
from app.models.ops import AuditLog
from tests.integration import test_knowledge_api as knowledge_api
from tests.integration.test_knowledge_api import Org, _make_org

BASE = "/api/v1/automations"

# The knowledge tests' organization, app and client fixtures, reused as they are.
app = knowledge_api.app
client = knowledge_api.client
org = knowledge_api.org


def rule_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "Delivery",
        "applies_to": "dm",
        "keywords": ["delivery", "shipping"],
        "action": "reply",
        "reply_text": "We deliver within Jaipur in 45 minutes.",
    }
    return body | overrides


async def create(client: httpx.AsyncClient, org: Org, **overrides: Any) -> dict[str, Any]:
    response = await client.post(BASE, headers=org.headers(), json=rule_body(**overrides))
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


# ---- CRUD -------------------------------------------------------------------------------------
async def test_create_list_replace_delete_roundtrip(client: httpx.AsyncClient, org: Org) -> None:
    created = await create(client, org)
    assert created["name"] == "Delivery"
    assert created["enabled"] is True and created["priority"] == 0
    assert created["keyword_match"] == "any" and created["handoff_reason"] is None
    url = f"{BASE}/{created['id']}"

    listed = (await client.get(BASE, headers=org.headers())).json()
    assert [rule["id"] for rule in listed["items"]] == [created["id"]]
    assert listed["next_cursor"] is None

    replaced = await client.put(
        url,
        headers=org.headers(),
        json=rule_body(
            name="  Refunds  ",
            action="handoff",
            reply_text=None,
            handoff_reason="refund_dispute",
            keywords=["refund"],
            enabled=False,
        ),
    )
    assert replaced.status_code == 200, replaced.text
    body = replaced.json()
    assert body["id"] == created["id"] and body["priority"] == 0
    assert body["name"] == "Refunds" and body["enabled"] is False
    assert body["action"] == "handoff" and body["reply_text"] is None
    assert body["handoff_reason"] == "refund_dispute" and body["keywords"] == ["refund"]
    assert body["updated_at"] >= created["updated_at"]

    assert (await client.delete(url, headers=org.headers())).status_code == 204
    assert (await client.get(BASE, headers=org.headers())).json()["items"] == []
    assert (await client.delete(url, headers=org.headers())).status_code == 404
    assert (await client.put(url, headers=org.headers(), json=rule_body())).status_code == 404


async def test_delete_is_soft_so_what_a_rule_sent_stays_traceable(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    created = await create(client, org)
    await client.delete(f"{BASE}/{created['id']}", headers=org.headers())
    async with session_factory() as session:
        rule = await session.get(AutomationRule, uuid.UUID(created["id"]))
        assert rule is not None and rule.deleted_at is not None


async def test_new_rules_go_to_the_end_and_each_field_round_trips(
    client: httpx.AsyncClient, org: Org
) -> None:
    first = await create(client, org, name="a")
    second = await create(
        client,
        org,
        name="b",
        applies_to="both",
        keyword_match="all",
        keywords=["Opening  Hours", "weekend"],
        private_reply_text="Details by message.",
    )
    assert (first["priority"], second["priority"]) == (0, 1)
    assert second["applies_to"] == "both" and second["keyword_match"] == "all"
    assert second["keywords"] == ["Opening Hours", "weekend"]  # tidied, case kept
    assert second["private_reply_text"] == "Details by message."


# ---- who may ----------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("role", "allowed"),
    [
        (MemberRole.OWNER, True),
        (MemberRole.ADMIN, True),
        (MemberRole.MANAGER, True),
        (MemberRole.STAFF, False),
    ],
)
async def test_staff_cannot_manage_rules(
    client: httpx.AsyncClient, org: Org, role: MemberRole, allowed: bool
) -> None:
    existing = await create(client, org)
    headers = org.headers(role)
    url = f"{BASE}/{existing['id']}"
    responses = [
        await client.get(BASE, headers=headers),
        await client.put(f"{BASE}/order", headers=headers, json={"ids": [existing["id"]]}),
        await client.post(BASE, headers=headers, json=rule_body()),
        await client.put(url, headers=headers, json=rule_body(name="x")),
        await client.post(f"{BASE}/preview", headers=headers, json={"scope": "dm", "text": "hi"}),
        await client.delete(url, headers=headers),
    ]
    codes = {r.status_code for r in responses}
    if allowed:
        assert codes <= {200, 201, 204}
    else:
        assert codes == {403}
        intact = (await client.get(BASE, headers=org.headers())).json()["items"]
        assert [rule["name"] for rule in intact] == ["Delivery"]


async def test_unauthenticated_is_rejected(client: httpx.AsyncClient) -> None:
    assert (await client.get(BASE)).status_code == 401
    assert (await client.post(BASE, json=rule_body())).status_code == 401


async def test_other_organizations_cannot_see_or_touch_rules(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    other = await _make_org(session_factory)
    mine = await create(client, org, name="Mine", keywords=["secret"])
    url = f"{BASE}/{mine['id']}"

    assert (await client.get(BASE, headers=other.headers())).json()["items"] == []
    assert (
        await client.put(url, headers=other.headers(), json=rule_body(name="hacked"))
    ).status_code == 404
    assert (await client.delete(url, headers=other.headers())).status_code == 404
    reorder = await client.put(f"{BASE}/order", headers=other.headers(), json={"ids": [mine["id"]]})
    assert reorder.status_code == 409
    preview = await client.post(
        f"{BASE}/preview", headers=other.headers(), json={"scope": "dm", "text": "a secret"}
    )
    assert preview.json() == {"rule": None}  # another organization's rules never answer

    intact = (await client.get(BASE, headers=org.headers())).json()["items"]
    assert [rule["name"] for rule in intact] == ["Mine"]


async def test_a_user_cannot_act_in_an_organization_they_do_not_belong_to(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    other = await _make_org(session_factory)
    stranger = {
        "Authorization": f"Bearer {other.users[MemberRole.OWNER]}",
        "X-Organization-ID": str(org.id),
    }
    response = await client.post(BASE, headers=stranger, json=rule_body())
    assert response.status_code in {403, 404}
    async with session_factory() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(AutomationRule)
            .where(AutomationRule.organization_id == org.id)
        )
        assert count == 0


# ---- validation -------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("what", "change"),
    [
        ("a blank name", {"name": "   "}),
        ("no keywords", {"keywords": []}),
        ("a blank keyword", {"keywords": ["delivery", "   "]}),
        ("a keyword over the limit", {"keywords": ["k" * 61]}),
        ("too many keywords", {"keywords": [f"kw{i}" for i in range(21)]}),
        ("a reply rule without text", {"reply_text": None}),
        ("a reply rule with blank text", {"reply_text": "   "}),
        ("a reply rule with a handoff reason", {"handoff_reason": "complaint"}),
        ("a handoff rule without a reason", {"action": "handoff", "reply_text": None}),
        (
            "a handoff rule with text",
            {"action": "handoff", "handoff_reason": "complaint"},
        ),
        ("a skip rule with text", {"action": "skip"}),
        (
            "a skip rule with a reason",
            {"action": "skip", "reply_text": None, "handoff_reason": "complaint"},
        ),
        ("a private message on a DM rule", {"private_reply_text": "Hi"}),
        ("an unknown channel", {"applies_to": "story"}),
        ("an unknown action", {"action": "like"}),
        (
            "an unknown handoff reason",
            {"action": "handoff", "reply_text": None, "handoff_reason": "x"},
        ),
        ("an unknown field", {"priority": 1}),
        ("a name over the limit", {"name": "n" * 201}),
        ("a keyword match mode that does not exist", {"keyword_match": "most"}),
    ],
)
async def test_an_incoherent_rule_is_refused_and_nothing_is_stored(
    client: httpx.AsyncClient,
    org: Org,
    session_factory: async_sessionmaker[AsyncSession],
    what: str,
    change: dict[str, Any],
) -> None:
    response = await client.post(BASE, headers=org.headers(), json=rule_body(**change))
    assert response.status_code == 422, what
    async with session_factory() as session:
        stored = await session.scalar(
            select(func.count())
            .select_from(AutomationRule)
            .where(AutomationRule.organization_id == org.id)
        )
        assert stored == 0


async def test_repeated_keywords_are_kept_once(client: httpx.AsyncClient, org: Org) -> None:
    created = await create(
        client, org, keywords=["Price", "price", "ＰＲＩＣＥ", " PRICE ", "cost"]
    )
    assert created["keywords"] == ["Price", "cost"]


async def test_a_private_message_is_allowed_on_comment_and_both_rules(
    client: httpx.AsyncClient, org: Org
) -> None:
    for scope in ("comment", "both"):
        created = await create(client, org, applies_to=scope, private_reply_text="Details soon")
        assert created["private_reply_text"] == "Details soon"


# ---- text limits ------------------------------------------------------------------------------
async def test_a_comment_reply_must_fit_a_comment(client: httpx.AsyncClient, org: Org) -> None:
    limit = get_settings().comment_reply_max_chars
    ok = await client.post(
        BASE, headers=org.headers(), json=rule_body(applies_to="comment", reply_text="x" * limit)
    )
    assert ok.status_code == 201
    too_long = await client.post(
        BASE,
        headers=org.headers(),
        json=rule_body(applies_to="comment", reply_text="x" * (limit + 1)),
    )
    assert too_long.status_code == 422
    assert too_long.json()["error"]["code"] == "AUTOMATION_RULE_INVALID"
    assert str(limit) in too_long.json()["error"]["message"]
    # A rule for both channels is held to the stricter one.
    both = await client.post(
        BASE, headers=org.headers(), json=rule_body(applies_to="both", reply_text="x" * (limit + 1))
    )
    assert both.status_code == 422
    # A DM rule is not held to the comment limit.
    dm = await client.post(
        BASE, headers=org.headers(), json=rule_body(applies_to="dm", reply_text="x" * (limit + 1))
    )
    assert dm.status_code == 201


async def test_a_dm_is_limited_by_bytes_not_characters(client: httpx.AsyncClient, org: Org) -> None:
    limit = get_settings().dm_reply_max_bytes
    assert (
        await client.post(
            BASE, headers=org.headers(), json=rule_body(reply_text="é" * (limit // 2))
        )
    ).status_code == 201  # exactly at the limit
    over = await client.post(
        BASE, headers=org.headers(), json=rule_body(reply_text="é" * (limit // 2 + 1))
    )
    assert over.status_code == 422  # fewer characters than the limit, but over it in bytes
    assert over.json()["error"]["code"] == "AUTOMATION_RULE_INVALID"


async def test_a_private_message_is_limited_like_a_dm(client: httpx.AsyncClient, org: Org) -> None:
    limit = get_settings().dm_reply_max_bytes
    ok = await client.post(
        BASE,
        headers=org.headers(),
        json=rule_body(applies_to="comment", private_reply_text="x" * limit),
    )
    assert ok.status_code == 201
    over = await client.post(
        BASE,
        headers=org.headers(),
        json=rule_body(applies_to="comment", private_reply_text="x" * (limit + 1)),
    )
    assert over.status_code == 422


async def test_replacing_a_rule_holds_it_to_the_same_limits(
    client: httpx.AsyncClient, org: Org
) -> None:
    created = await create(client, org, applies_to="comment")
    limit = get_settings().comment_reply_max_chars
    response = await client.put(
        f"{BASE}/{created['id']}",
        headers=org.headers(),
        json=rule_body(applies_to="comment", reply_text="x" * (limit + 1)),
    )
    assert response.status_code == 422
    unchanged = (await client.get(BASE, headers=org.headers())).json()["items"][0]
    assert unchanged["reply_text"] == created["reply_text"]


# ---- the cap ----------------------------------------------------------------------------------
async def test_the_cap_blocks_creation_and_deleting_frees_a_slot(
    app: FastAPI, client: httpx.AsyncClient, org: Org
) -> None:
    app.dependency_overrides[get_settings] = lambda: get_settings().model_copy(
        update={"automation_max_rules": 2}
    )
    first = await create(client, org, name="a")
    await create(client, org, name="b")
    blocked = await client.post(BASE, headers=org.headers(), json=rule_body(name="c"))
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "AUTOMATION_RULE_LIMIT"
    await client.delete(f"{BASE}/{first['id']}", headers=org.headers())
    assert (
        await client.post(BASE, headers=org.headers(), json=rule_body(name="c"))
    ).status_code == 201


async def test_the_cap_holds_under_concurrent_creates(
    app: FastAPI,
    client: httpx.AsyncClient,
    org: Org,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    cap = 3
    app.dependency_overrides[get_settings] = lambda: get_settings().model_copy(
        update={"automation_max_rules": cap}
    )
    responses = await asyncio.gather(
        *(client.post(BASE, headers=org.headers(), json=rule_body(name=f"r{i}")) for i in range(10))
    )
    assert sorted(r.status_code for r in responses) == [201] * cap + [409] * (10 - cap)
    async with session_factory() as session:
        stored = await session.scalar(
            select(func.count())
            .select_from(AutomationRule)
            .where(AutomationRule.organization_id == org.id, AutomationRule.deleted_at.is_(None))
        )
        assert stored == cap
    listed = (await client.get(BASE, headers=org.headers())).json()["items"]
    assert sorted(rule["priority"] for rule in listed) == [0, 1, 2]  # no two share a place


# ---- order ------------------------------------------------------------------------------------
async def test_reordering_sets_the_order_rules_are_tried_in(
    client: httpx.AsyncClient, org: Org
) -> None:
    ids = [(await create(client, org, name=f"r{i}"))["id"] for i in range(3)]
    wanted = [ids[2], ids[0], ids[1]]
    response = await client.put(f"{BASE}/order", headers=org.headers(), json={"ids": wanted})
    assert response.status_code == 200
    assert [rule["id"] for rule in response.json()["items"]] == wanted
    listed = (await client.get(BASE, headers=org.headers())).json()["items"]
    assert [rule["id"] for rule in listed] == wanted
    assert [rule["priority"] for rule in listed] == [0, 1, 2]
    appended = await create(client, org, name="last")
    assert appended["priority"] == 3


@pytest.mark.parametrize("shape", ["partial", "duplicate", "unknown", "deleted"])
async def test_a_stale_or_partial_order_is_refused_and_changes_nothing(
    client: httpx.AsyncClient, org: Org, shape: str
) -> None:
    a, b, c = [(await create(client, org, name=n))["id"] for n in "abc"]
    await client.delete(f"{BASE}/{c}", headers=org.headers())
    candidates = {
        "partial": [a],
        "duplicate": [a, b, a],  # the right set of ids, one of them twice
        "unknown": [a, b, "00000000-0000-4000-8000-000000000000"],
        "deleted": [a, b, c],
    }
    response = await client.put(
        f"{BASE}/order", headers=org.headers(), json={"ids": candidates[shape]}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "AUTOMATION_RULE_ORDER_STALE"
    listed = (await client.get(BASE, headers=org.headers())).json()["items"]
    assert [rule["id"] for rule in listed] == [a, b]


async def test_order_is_not_confused_with_a_rule_id(client: httpx.AsyncClient, org: Org) -> None:
    only = await create(client, org)
    response = await client.put(f"{BASE}/order", headers=org.headers(), json={"ids": [only["id"]]})
    assert response.status_code == 200


# ---- preview ----------------------------------------------------------------------------------
async def test_preview_names_the_rule_that_would_answer(
    client: httpx.AsyncClient, org: Org
) -> None:
    first = await create(
        client, org, name="refunds", keywords=["refund"], action="skip", reply_text=None
    )
    second = await create(client, org, name="delivery", keywords=["delivery"])

    async def which(scope: str, text: str) -> str | None:
        response = await client.post(
            f"{BASE}/preview", headers=org.headers(), json={"scope": scope, "text": text}
        )
        assert response.status_code == 200
        rule = response.json()["rule"]
        return None if rule is None else str(rule["id"])

    assert await which("dm", "Is DELIVERY free?") == second["id"]
    assert await which("dm", "I want a refund for the delivery") == first["id"]  # first in order
    assert await which("dm", "hello") is None
    await client.put(
        f"{BASE}/order", headers=org.headers(), json={"ids": [second["id"], first["id"]]}
    )
    assert await which("dm", "I want a refund for the delivery") == second["id"]


async def test_preview_ignores_disabled_rules_and_other_channels(
    client: httpx.AsyncClient, org: Org
) -> None:
    await create(client, org, name="off", enabled=False)
    await create(client, org, name="comments only", applies_to="comment")
    both = await create(client, org, name="both", applies_to="both")

    async def which(scope: str) -> str | None:
        response = await client.post(
            f"{BASE}/preview", headers=org.headers(), json={"scope": scope, "text": "delivery?"}
        )
        rule = response.json()["rule"]
        return None if rule is None else str(rule["name"])

    assert await which("dm") == "both"
    assert await which("comment") == "comments only"
    await client.delete(f"{BASE}/{both['id']}", headers=org.headers())
    assert await which("dm") is None  # deleted rules never answer


async def test_preview_input_bounds(client: httpx.AsyncClient, org: Org) -> None:
    for body in (
        {"scope": "both", "text": "hi"},
        {"scope": "dm", "text": ""},
        {"scope": "dm", "text": "x" * 2201},
        {"scope": "dm", "text": "hi", "intent": "price_query"},
        {"scope": "story", "text": "hi"},
    ):
        response = await client.post(f"{BASE}/preview", headers=org.headers(), json=body)
        assert response.status_code == 422, body


# ---- audit ------------------------------------------------------------------------------------
async def test_changes_are_audited_without_the_rule_text(
    client: httpx.AsyncClient, org: Org, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    created = await create(client, org, reply_text="Private promo text SECRET")
    other = await create(client, org, name="other")
    await client.put(
        f"{BASE}/{created['id']}", headers=org.headers(), json=rule_body(name="renamed")
    )
    await client.put(
        f"{BASE}/order", headers=org.headers(), json={"ids": [other["id"], created["id"]]}
    )
    await client.delete(f"{BASE}/{created['id']}", headers=org.headers())
    async with session_factory() as session:
        rows = (
            (
                await session.execute(
                    select(AuditLog)
                    .where(
                        AuditLog.organization_id == org.id,
                        AuditLog.action.like("automation.rule.%"),
                    )
                    .order_by(AuditLog.created_at, AuditLog.id)
                )
            )
            .scalars()
            .all()
        )
    assert [row.action for row in rows] == [
        "automation.rule.created",
        "automation.rule.created",
        "automation.rule.updated",
        "automation.rule.reordered",
        "automation.rule.deleted",
    ]
    assert rows[0].metadata_json == {"rule_id": created["id"], "action": "reply"}
    assert rows[3].metadata_json == {"count": 2}
    assert all(row.user_id is not None for row in rows)
    assert "SECRET" not in str([row.metadata_json for row in rows])
