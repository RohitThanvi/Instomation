import { z } from 'zod'
import type { ApiClient } from './client'
import { NotYetAvailableError } from './unavailable'

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

export const automationPreferencesSchema = z.object({
  reply_to_comments: z.boolean(),
  reply_to_dms: z.boolean(),
  private_reply_from_comments: z.boolean(),
  handoff_on_request: z.boolean(),
  handoff_on_complaint: z.boolean(),
  handoff_on_low_confidence: z.boolean(),
})
export type AutomationPreferences = z.infer<typeof automationPreferencesSchema>

export const businessSetupSchema = z.object({
  profile: profileSchema,
  products: productsSchema,
  style: styleSchema,
  automation: automationPreferencesSchema,
})
export type BusinessSetup = z.infer<typeof businessSetupSchema>

/**
 * Persists the onboarding answers. There is no backend endpoint yet
 * (planned: `/api/v1/business`, `/api/v1/settings`), so this never touches the
 * network and never reports success.
 */
export function saveBusinessSetup(_client: ApiClient, _setup: BusinessSetup): Promise<never> {
  return Promise.reject(new NotYetAvailableError('Saving your business setup'))
}
