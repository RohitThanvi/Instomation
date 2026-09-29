import { beforeEach, describe, expect, it } from 'vitest'
import { loadDraft } from './draft'
import { STORAGE_KEYS } from '@/config/constants'

const key = (id: string) => `${STORAGE_KEYS.onboardingDraftPrefix}${id}`

describe('loadDraft', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns an empty draft when nothing was saved', () => {
    expect(loadDraft('org-1')).toEqual({})
  })

  it('discards corrupt JSON instead of throwing', () => {
    window.localStorage.setItem(key('org-1'), '{not json')
    expect(loadDraft('org-1')).toEqual({})
  })

  it('discards data that no longer matches the schema', () => {
    window.localStorage.setItem(
      key('org-1'),
      JSON.stringify({ style: { tone: 'shouty', notes: '' } }),
    )
    expect(loadDraft('org-1')).toEqual({})
  })

  it('keeps drafts separate per workspace', () => {
    const style = { tone: 'friendly', notes: '' }
    window.localStorage.setItem(key('org-1'), JSON.stringify({ style }))
    expect(loadDraft('org-1').style).toEqual(style)
    expect(loadDraft('org-2')).toEqual({})
  })
})
