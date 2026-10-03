import { describe, expect, it } from 'vitest'
import { can, PERMISSIONS } from './permissions'
import { MEMBER_ROLES } from '@/api/schemas'

describe('can (mirrors backend/app/core/rbac.py)', () => {
  it('owner has every permission', () => {
    for (const permission of PERMISSIONS) expect(can('owner', permission)).toBe(true)
  })

  it('admin has everything except org and billing management', () => {
    expect(can('admin', 'settings_manage')).toBe(true)
    expect(can('admin', 'members_manage')).toBe(true)
    expect(can('admin', 'org_manage')).toBe(false)
    expect(can('admin', 'billing_manage')).toBe(false)
  })

  it('manager runs conversations, analytics and automation but not settings', () => {
    expect(can('manager', 'automation_manage')).toBe(true)
    expect(can('manager', 'conversations_all')).toBe(true)
    expect(can('manager', 'settings_manage')).toBe(false)
    expect(can('manager', 'members_manage')).toBe(false)
  })

  it('staff can only work assigned conversations', () => {
    const allowed = PERMISSIONS.filter((permission) => can('staff', permission))
    expect(allowed).toEqual(['conversations_assigned'])
  })

  it('covers every role the backend can send (lowercase)', () => {
    expect(MEMBER_ROLES).toEqual(['owner', 'admin', 'manager', 'staff'])
  })
})
