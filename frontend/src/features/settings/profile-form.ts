import { z } from 'zod'
import {
  optionalHttpUrl,
  PROFILE_LIMITS,
  type BusinessProfile,
  type CommunicationTone,
} from '@/api/business'

export interface PairRow {
  key: string
  value: string
}

/** The profile as the form edits it: text is never null, the two maps are lists of rows. */
export interface ProfileForm {
  brand_name: string
  industry: string
  location: string
  website: string
  description: string
  communication_style: CommunicationTone
  custom_instructions: string
  contact: PairRow[]
  policies: PairRow[]
}

export type ProfileTextField = keyof Pick<
  ProfileForm,
  'brand_name' | 'industry' | 'location' | 'website' | 'description' | 'custom_instructions'
>

export interface ProfileErrors {
  fields: Partial<Record<ProfileTextField, string>>
  /** Errors by row index. */
  contact: Record<number, string>
  policies: Record<number, string>
  contactList?: string | undefined
  policiesList?: string | undefined
}

export type ProfileResult =
  { ok: true; profile: BusinessProfile } | { ok: false; errors: ProfileErrors }

const tooLong = (max: number) => `Keep this under ${String(max)} characters`
const text = (max: number) => z.string().trim().max(max, tooLong(max))

const textFieldsSchema = z.object({
  brand_name: text(PROFILE_LIMITS.brandName),
  industry: text(PROFILE_LIMITS.industry),
  location: text(PROFILE_LIMITS.location),
  website: optionalHttpUrl.pipe(text(PROFILE_LIMITS.website)),
  description: text(PROFILE_LIMITS.description),
  custom_instructions: text(PROFILE_LIMITS.instructions),
})

export function profileToForm(profile: BusinessProfile): ProfileForm {
  const rows = (map: Record<string, string>): PairRow[] =>
    Object.entries(map).map(([key, value]) => ({ key, value }))
  return {
    brand_name: profile.brand_name ?? '',
    industry: profile.industry ?? '',
    location: profile.location ?? '',
    website: profile.website ?? '',
    description: profile.description ?? '',
    communication_style: profile.communication_style,
    custom_instructions: profile.custom_instructions ?? '',
    contact: rows(profile.contact_info),
    policies: rows(profile.policies),
  }
}

interface RowRules {
  maxItems: number
  maxValue: number
  noun: string
}

interface RowsResult {
  entries: Record<string, string>
  errors: Record<number, string>
  listError?: string | undefined
}

/** Rows left entirely blank are ignored, so an empty line never blocks saving. */
function readRows(rows: readonly PairRow[], rules: RowRules): RowsResult {
  const entries: Record<string, string> = {}
  const errors: Record<number, string> = {}
  let used = 0
  rows.forEach((row, index) => {
    const key = row.key.trim()
    const value = row.value.trim()
    if (key === '' && value === '') return
    used += 1
    if (key === '') errors[index] = 'Add a name for this'
    else if (value === '') errors[index] = 'Add a value'
    else if (key.length > PROFILE_LIMITS.mapKey) {
      errors[index] = `Names can be up to ${String(PROFILE_LIMITS.mapKey)} characters`
    } else if (value.length > rules.maxValue) errors[index] = tooLong(rules.maxValue)
    else if (Object.hasOwn(entries, key)) errors[index] = 'This name is already used above'
    else entries[key] = value
  })
  const listError =
    used > rules.maxItems ? `You can add up to ${String(rules.maxItems)} ${rules.noun}` : undefined
  return { entries, errors, listError }
}

/** Mirrors `BusinessProfileIn`: the same limits, so the server never has to say no. */
export function validateProfile(form: ProfileForm): ProfileResult {
  const fields: ProfileErrors['fields'] = {}
  const parsed = textFieldsSchema.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as ProfileTextField
      fields[field] ??= issue.message
    }
  }
  const contact = readRows(form.contact, {
    maxItems: PROFILE_LIMITS.contactItems,
    maxValue: PROFILE_LIMITS.contactValue,
    noun: 'contact details',
  })
  const policies = readRows(form.policies, {
    maxItems: PROFILE_LIMITS.policyItems,
    maxValue: PROFILE_LIMITS.policyValue,
    noun: 'policies',
  })
  if (
    !parsed.success ||
    Object.keys(contact.errors).length > 0 ||
    Object.keys(policies.errors).length > 0 ||
    contact.listError !== undefined ||
    policies.listError !== undefined
  ) {
    return {
      ok: false,
      errors: {
        fields,
        contact: contact.errors,
        policies: policies.errors,
        contactList: contact.listError,
        policiesList: policies.listError,
      },
    }
  }
  const values = parsed.data
  const orNull = (value: string) => (value === '' ? null : value)
  return {
    ok: true,
    profile: {
      brand_name: orNull(values.brand_name),
      industry: orNull(values.industry),
      location: orNull(values.location),
      website: orNull(values.website),
      description: orNull(values.description),
      custom_instructions: orNull(values.custom_instructions),
      communication_style: form.communication_style,
      contact_info: contact.entries,
      policies: policies.entries,
    },
  }
}

const sortedEntries = (map: Record<string, string>) =>
  JSON.stringify(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))

/** Whether saving would change nothing (the order of contact details and policies is irrelevant). */
export function sameProfile(a: BusinessProfile, b: BusinessProfile): boolean {
  return (
    a.brand_name === b.brand_name &&
    a.industry === b.industry &&
    a.location === b.location &&
    a.website === b.website &&
    a.description === b.description &&
    a.custom_instructions === b.custom_instructions &&
    a.communication_style === b.communication_style &&
    sortedEntries(a.contact_info) === sortedEntries(b.contact_info) &&
    sortedEntries(a.policies) === sortedEntries(b.policies)
  )
}
