import { z } from 'zod'
import { KNOWLEDGE_LIMITS, knowledgeKindSchema, type KnowledgeEntry } from '@/api/knowledge'

export const entryFormSchema = z.object({
  kind: knowledgeKindSchema,
  title: z
    .string()
    .trim()
    .min(1, 'Give this entry a title')
    .max(
      KNOWLEDGE_LIMITS.title,
      `Keep the title under ${String(KNOWLEDGE_LIMITS.title)} characters`,
    ),
  content: z
    .string()
    .trim()
    .min(1, 'Add the information the assistant should use')
    .max(
      KNOWLEDGE_LIMITS.content,
      `Keep this under ${String(KNOWLEDGE_LIMITS.content)} characters; split long text into several entries`,
    ),
})
export type EntryFormValues = z.infer<typeof entryFormSchema>

export const EMPTY_ENTRY: EntryFormValues = { kind: 'faq', title: '', content: '' }

export type EntryFormErrors = Partial<Record<keyof EntryFormValues, string>>

export function validateEntry(
  values: EntryFormValues,
): { ok: true; values: EntryFormValues } | { ok: false; errors: EntryFormErrors } {
  const result = entryFormSchema.safeParse(values)
  if (result.success) return { ok: true, values: result.data }
  const errors: EntryFormErrors = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if (field === 'kind' || field === 'title' || field === 'content')
      errors[field] ??= issue.message
  }
  return { ok: false, errors }
}

/** Only what changed, so an untouched entry sends nothing (the server rejects an empty update). */
export function changedFields(
  entry: Pick<KnowledgeEntry, 'kind' | 'title' | 'content'>,
  values: EntryFormValues,
): Partial<EntryFormValues> {
  const patch: Partial<EntryFormValues> = {}
  if (values.kind !== entry.kind) patch.kind = values.kind
  if (values.title !== entry.title) patch.title = values.title
  if (values.content !== entry.content) patch.content = values.content
  return patch
}
