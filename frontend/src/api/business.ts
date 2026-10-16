import { z } from 'zod'
import type { ApiClient } from './client'
import {
  createKnowledgeEntry,
  listKnowledgeEntries,
  updateKnowledgeEntry,
  type KnowledgeEntry,
  type NewKnowledgeEntry,
} from './knowledge'
import { API_PREFIX } from '@/config/constants'

const optionalUrl = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || /^https?:\/\/\S+$/i.test(value),
    'Enter a full link starting with https://',
  )

export const BUSINESS_LIMITS = {
  name: 200,
  category: 100,
  description: 500,
  productName: 120,
  productDescription: 500,
  price: 50,
  maxProducts: 50,
  styleNotes: 300,
} as const

export const profileSchema = z.object({
  brand_name: z.string().trim().min(1, 'Tell us what to call your brand').max(BUSINESS_LIMITS.name),
  category: z
    .string()
    .trim()
    .min(1, 'Add a category, for example “Skincare” or “Fitness coaching”')
    .max(BUSINESS_LIMITS.category),
  description: z.string().trim().min(1, 'Add a short description').max(BUSINESS_LIMITS.description),
  website: optionalUrl,
})
export type ProfileValues = z.infer<typeof profileSchema>

export const PRODUCT_KINDS = ['product', 'service'] as const
export const productItemSchema = z.object({
  kind: z.enum(PRODUCT_KINDS),
  name: z.string().trim().min(1, 'Give this item a name').max(BUSINESS_LIMITS.productName),
  description: z.string().trim().max(BUSINESS_LIMITS.productDescription),
  price: z.string().trim().max(BUSINESS_LIMITS.price),
  url: optionalUrl,
})
export type ProductItem = z.infer<typeof productItemSchema>

export const productsSchema = z.object({
  items: z.array(productItemSchema).max(BUSINESS_LIMITS.maxProducts),
})
export type ProductsValues = z.infer<typeof productsSchema>

export const COMMUNICATION_TONES = [
  'strict_business',
  'professional',
  'moderately_casual',
  'friendly',
] as const
export const communicationToneSchema = z.enum(COMMUNICATION_TONES)
export type CommunicationTone = z.infer<typeof communicationToneSchema>

export const styleSchema = z.object({
  tone: communicationToneSchema,
  notes: z.string().trim().max(BUSINESS_LIMITS.styleNotes),
})
export type StyleValues = z.infer<typeof styleSchema>

/**
 * What the backend can store: whether the assistant answers comments, DMs, and also sends a
 * commenter one private message. Handoffs are not a setting; the pipeline always decides them.
 */
export const automationPreferencesSchema = z.object({
  reply_to_comments: z.boolean(),
  reply_to_dms: z.boolean(),
  private_reply_from_comments: z.boolean(),
})
export type AutomationPreferences = z.infer<typeof automationPreferencesSchema>

export const businessSetupSchema = z.object({
  profile: profileSchema,
  products: productsSchema,
  style: styleSchema,
  automation: automationPreferencesSchema,
})
export type BusinessSetup = z.infer<typeof businessSetupSchema>

const nullableText = z.string().nullable()
const textMap = z.record(z.string(), z.string())

/** `BusinessProfileOut` from `backend/app/schemas/business.py`. */
export const businessProfileSchema = z.object({
  brand_name: nullableText,
  description: nullableText,
  industry: nullableText,
  location: nullableText,
  website: nullableText,
  contact_info: textMap,
  policies: textMap,
  communication_style: communicationToneSchema,
  custom_instructions: nullableText,
})
export type BusinessProfile = z.infer<typeof businessProfileSchema>

/** `AiSettingsOut`. */
export const aiSettingsSchema = z.object({
  dm_automation_enabled: z.boolean(),
  comment_automation_enabled: z.boolean(),
  private_reply_enabled: z.boolean(),
  confidence_threshold: z.number(),
  max_response_tokens: z.number().int(),
  temperature: z.number(),
  max_replies_per_conversation_per_hour: z.number().int(),
})
export type AiSettings = z.infer<typeof aiSettingsSchema>

const profilePath = `${API_PREFIX}/business/profile`
const aiSettingsPath = `${API_PREFIX}/settings/ai`

/**
 * `PUT /business/profile` replaces the whole profile, so the answers are laid over what is
 * already stored: location, contact details and policies (not asked in onboarding) survive.
 */
export function profileBody(current: BusinessProfile, setup: BusinessSetup): BusinessProfile {
  return {
    ...current,
    brand_name: setup.profile.brand_name,
    industry: setup.profile.category,
    description: setup.profile.description,
    website: setup.profile.website === '' ? null : setup.profile.website,
    communication_style: setup.style.tone,
    custom_instructions: setup.style.notes === '' ? null : setup.style.notes,
  }
}

/** A product or service as a knowledge entry; the link and price go in the text the AI reads. */
export function productEntry(item: ProductItem): NewKnowledgeEntry {
  const lines = [
    item.description,
    item.price === '' ? '' : `Price: ${item.price}`,
    item.url === '' ? '' : `Link: ${item.url}`,
  ].filter((line) => line !== '')
  return {
    kind: item.kind,
    title: item.name,
    content: lines.length === 0 ? item.name : lines.join('\n'),
  }
}

const entryKey = (entry: Pick<NewKnowledgeEntry, 'kind' | 'title'>) =>
  `${entry.kind}\u0000${entry.title}`

/**
 * Creates each product or service, or updates the entry already holding that kind and name, so
 * saving twice never duplicates and nothing the owner added elsewhere is ever deleted.
 */
async function upsertProducts(client: ApiClient, items: readonly ProductItem[]): Promise<void> {
  if (items.length === 0) return
  const existing = new Map<string, KnowledgeEntry>(
    (await listKnowledgeEntries(client)).map((entry) => [entryKey(entry), entry]),
  )
  for (const item of items) {
    const wanted = productEntry(item)
    const found = existing.get(entryKey(wanted))
    if (found === undefined) {
      existing.set(entryKey(wanted), await createKnowledgeEntry(client, wanted))
    } else if (found.content !== wanted.content) {
      existing.set(
        entryKey(wanted),
        await updateKnowledgeEntry(client, found.id, { content: wanted.content }),
      )
    }
  }
}

/**
 * Saves the onboarding answers. The automation switches go last, so a failure partway can never
 * leave replies turned on over a half-saved business; every step is safe to run again.
 */
export async function saveBusinessSetup(
  client: ApiClient,
  setup: BusinessSetup,
): Promise<AiSettings> {
  const current = await client.request({ path: profilePath, schema: businessProfileSchema })
  await client.request({
    method: 'PUT',
    path: profilePath,
    schema: businessProfileSchema,
    body: profileBody(current, setup),
  })
  await upsertProducts(client, setup.products.items)
  return client.request({
    method: 'PATCH',
    path: aiSettingsPath,
    schema: aiSettingsSchema,
    body: {
      dm_automation_enabled: setup.automation.reply_to_dms,
      comment_automation_enabled: setup.automation.reply_to_comments,
      private_reply_enabled: setup.automation.private_reply_from_comments,
    },
  })
}
