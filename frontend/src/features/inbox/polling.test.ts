import { describe, expect, it } from 'vitest'
import { messageSchema } from '@/api/conversations'
import { PENDING_MESSAGE_REFETCH_MS, THREAD_REFETCH_MS } from '@/config/constants'
import { messageWire } from '@/test/fixtures'
import { threadPollInterval } from './polling'

const message = (status: string) => messageSchema.parse(messageWire({ status }))

describe('threadPollInterval', () => {
  it('polls quickly while a message is still being delivered', () => {
    expect(threadPollInterval([message('sent'), message('pending')])).toBe(
      PENDING_MESSAGE_REFETCH_MS,
    )
  })

  it('polls at the normal pace otherwise, including before anything has loaded', () => {
    expect(threadPollInterval([message('sent'), message('failed')])).toBe(THREAD_REFETCH_MS)
    expect(threadPollInterval([])).toBe(THREAD_REFETCH_MS)
    expect(threadPollInterval(undefined)).toBe(THREAD_REFETCH_MS)
    expect(PENDING_MESSAGE_REFETCH_MS).toBeLessThan(THREAD_REFETCH_MS)
  })
})
