import uuid

import pytest

from app.core.errors import AppError
from app.core.pagination import decode_cursor, encode_cursor
from app.core.rbac import Permission, can_change_role, has_permission
from app.models.base import utcnow
from app.models.enums import MemberRole as R


def test_owner_has_every_permission() -> None:
    assert all(has_permission(R.OWNER, p) for p in Permission)


def test_admin_lacks_billing_and_ownership() -> None:
    assert not has_permission(R.ADMIN, Permission.BILLING_MANAGE)
    assert not has_permission(R.ADMIN, Permission.ORG_MANAGE)
    assert has_permission(R.ADMIN, Permission.MEMBERS_MANAGE)


def test_manager_and_staff_scopes() -> None:
    assert has_permission(R.MANAGER, Permission.AUTOMATION_MANAGE)
    assert has_permission(R.MANAGER, Permission.ANALYTICS_VIEW)
    assert not has_permission(R.MANAGER, Permission.SETTINGS_MANAGE)
    assert has_permission(R.STAFF, Permission.CONVERSATIONS_ASSIGNED)
    assert not has_permission(R.STAFF, Permission.CONVERSATIONS_ALL)


@pytest.mark.parametrize(
    ("actor", "current", "new", "allowed"),
    [
        (R.OWNER, R.STAFF, R.OWNER, True),
        (R.ADMIN, R.STAFF, R.OWNER, False),
        (R.ADMIN, R.OWNER, R.STAFF, False),
        (R.ADMIN, R.STAFF, R.MANAGER, True),
        (R.MANAGER, R.STAFF, R.MANAGER, False),
    ],
)
def test_role_change_rules(actor: R, current: R, new: R, allowed: bool) -> None:
    assert can_change_role(actor, current, new) is allowed


def test_cursor_round_trip_and_rejection() -> None:
    created, row_id = utcnow(), uuid.uuid4()
    assert decode_cursor(encode_cursor(created, row_id)) == (created, row_id)
    with pytest.raises(AppError) as exc:
        decode_cursor("not-a-cursor")
    assert exc.value.code == "INVALID_CURSOR"
