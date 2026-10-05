import { z } from 'zod'
import { MAX_MESSAGE_LENGTH } from '@/config/constants'

export const draftSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a message first.')
    .max(
      MAX_MESSAGE_LENGTH,
      `Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString('en-US')} characters.`,
    ),
})
export type Draft = z.infer<typeof draftSchema>
