from enum import StrEnum

from app.models.enums import MemberRole


class Permission(StrEnum):
    ORG_MANAGE = "org_manage"  # delete organization, transfer ownership
    BILLING_MANAGE = "billing_manage"
    MEMBERS_MANAGE = "members_manage"
    SETTINGS_MANAGE = "settings_manage"  # Instagram, AI, business profile, knowledge
    AUTOMATION_MANAGE = "automation_manage"
    ANALYTICS_VIEW = "analytics_view"
    CONVERSATIONS_ALL = "conversations_all"
    CONVERSATIONS_ASSIGNED = "conversations_assigned"


_ALL = frozenset(Permission)
_ADMIN = _ALL - {Permission.ORG_MANAGE, Permission.BILLING_MANAGE}
_MANAGER = frozenset(
    {
        Permission.AUTOMATION_MANAGE,
        Permission.ANALYTICS_VIEW,
        Permission.CONVERSATIONS_ALL,
        Permission.CONVERSATIONS_ASSIGNED,
    }
)
_STAFF = frozenset({Permission.CONVERSATIONS_ASSIGNED})

ROLE_PERMISSIONS: dict[MemberRole, frozenset[Permission]] = {
    MemberRole.OWNER: _ALL,
    MemberRole.ADMIN: _ADMIN,
    MemberRole.MANAGER: _MANAGER,
    MemberRole.STAFF: _STAFF,
}


def has_permission(role: MemberRole, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS[role]


def can_change_role(actor: MemberRole, current: MemberRole, new: MemberRole) -> bool:
    """Only owners may grant, revoke or modify the OWNER role; MEMBERS_MANAGE covers the rest."""
    if MemberRole.OWNER in (current, new):
        return has_permission(actor, Permission.ORG_MANAGE)
    return has_permission(actor, Permission.MEMBERS_MANAGE)
