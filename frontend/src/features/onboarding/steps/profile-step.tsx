import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { StepFooter, StepFrame } from '../step-frame'
import { BUSINESS_LIMITS, profileSchema, type ProfileValues } from '@/api/business'
import type { AccountType } from '@/api/schemas'
import { TextAreaField, TextField } from '@/components/ui/text-field'

const CREATOR_TYPES: readonly AccountType[] = ['creator', 'personal_brand']

function copyFor(accountType: AccountType) {
  return CREATOR_TYPES.includes(accountType)
    ? {
        title: 'Your creator profile',
        description:
          'Tell the assistant who you are, so it sounds like you and knows what you are about.',
        nameLabel: 'Your name or brand',
        categoryLabel: 'What you create',
        categoryHint: 'For example “Travel photography” or “Fitness coaching”.',
        descriptionLabel: 'About you',
      }
    : {
        title: 'Your business profile',
        description:
          'The assistant uses this to introduce your business accurately and answer general questions.',
        nameLabel: 'Business name',
        categoryLabel: 'Industry or category',
        categoryHint: 'For example “Skincare” or “Boutique hotel”.',
        descriptionLabel: 'What your business does',
      }
}

interface Props {
  accountType: AccountType
  organizationName: string
  defaults: ProfileValues | undefined
  onSubmit: (values: ProfileValues) => void
  onBack: () => void
}

export function ProfileStep({ accountType, organizationName, defaults, onSubmit, onBack }: Props) {
  const copy = copyFor(accountType)
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: defaults ?? {
      brand_name: organizationName,
      category: '',
      description: '',
      website: '',
    },
  })
  const { errors } = form.formState
  const submit = form.handleSubmit(onSubmit)

  return (
    <StepFrame title={copy.title} description={copy.description}>
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-6">
        <TextField
          label={copy.nameLabel}
          maxLength={BUSINESS_LIMITS.name}
          error={errors.brand_name?.message}
          {...form.register('brand_name')}
        />
        <TextField
          label={copy.categoryLabel}
          hint={copy.categoryHint}
          maxLength={BUSINESS_LIMITS.category}
          error={errors.category?.message}
          {...form.register('category')}
        />
        <TextAreaField
          label={copy.descriptionLabel}
          maxLength={BUSINESS_LIMITS.description}
          error={errors.description?.message}
          {...form.register('description')}
        />
        <TextField
          label="Website (optional)"
          type="url"
          inputMode="url"
          placeholder="https://"
          error={errors.website?.message}
          {...form.register('website')}
        />
        <StepFooter onBack={onBack} submitLabel="Continue" />
      </form>
    </StepFrame>
  )
}
