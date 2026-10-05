import { z } from 'zod'
import { MAX_TAG_LENGTH } from '@/config/constants'

export const tagFormSchema = z.object({
  tag: z
    .string()
    .trim()
    .min(1, 'Enter a tag.')
    .max(MAX_TAG_LENGTH, `Tags can be up to ${MAX_TAG_LENGTH} characters.`),
})
export type TagForm = z.infer<typeof tagFormSchema>

/** Tags are compared without regard to case, so "VIP" and "vip" cannot both be added. */
export function isDuplicateTag(existing: readonly string[], tag: string): boolean {
  const needle = tag.toLocaleLowerCase()
  return existing.some((candidate) => candidate.toLocaleLowerCase() === needle)
}
