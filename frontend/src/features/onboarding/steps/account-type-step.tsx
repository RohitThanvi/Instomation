import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { StepFooter, StepFrame } from '../step-frame'
import {
  createOrganization,
  createOrganizationSchema,
  type CreateOrganizationInput,
  type Organization,
} from '@/api/organizations'
import { queryKeys } from '@/api/keys'
import { useSession } from '@/auth/session-context'
import { Button } from '@/components/ui/button'
import { RadioCards, type RadioCardOption } from '@/components/ui/radio-cards'
import { TextField } from '@/components/ui/text-field'

const ACCOUNT_TYPE_OPTIONS: readonly RadioCardOption[] = [
  { value: 'creator', label: 'Creator', description: 'You are an influencer or content creator.' },
  {
    value: 'business',
    label: 'Business',
    description: 'You sell products or services to customers.',
  },
  { value: 'agency', label: 'Agency', description: 'You manage Instagram for other brands.' },
]

const ACCOUNT_TYPE_LABELS: Record<Organization['account_type'], string> = {
  creator: 'Creator',
  business: 'Business',
  agency: 'Agency',
  personal_brand: 'Personal brand',
  other: 'Other',
}

interface Props {
  organization: Organization | null
  onNext: () => void
  onBack: () => void
}

function ExistingWorkspace({
  organization,
  onNext,
  onBack,
}: Props & { organization: Organization }) {
  return (
    <StepFrame
      title="Your workspace"
      description="Your workspace is already created, so there is nothing to change here."
    >
      <dl className="border-line bg-surface shadow-card grid gap-4 rounded-lg border p-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-subtle">Workspace</dt>
          <dd className="text-ink font-medium">{organization.name}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Account type</dt>
          <dd className="text-ink font-medium">{ACCOUNT_TYPE_LABELS[organization.account_type]}</dd>
        </div>
      </dl>
      <div className="border-line flex items-center justify-between border-t pt-6">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Continue</Button>
      </div>
    </StepFrame>
  )
}

function CreateWorkspaceForm({ onNext, onBack }: Pick<Props, 'onNext' | 'onBack'>) {
  const { client, selectOrganization } = useSession()
  const queryClient = useQueryClient()
  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: '' },
  })

  const create = useMutation({
    mutationFn: (input: CreateOrganizationInput) => createOrganization(client, input),
    // Wait for the list to refresh, or the next step's guard would still see "no workspace".
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.organizations })
      selectOrganization(created.id)
    },
  })

  const submit = form.handleSubmit((values) => {
    create.mutate(values, { onSuccess: onNext })
  })

  return (
    <StepFrame
      title="What kind of account is this?"
      description="This shapes the wording in the next steps. You can name your workspace after your brand."
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-8">
        <TextField
          label="Workspace name"
          hint="Usually your brand or business name."
          autoComplete="organization"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <RadioCards
          legend="Account type"
          options={ACCOUNT_TYPE_OPTIONS}
          registration={form.register('account_type')}
          error={
            form.formState.errors.account_type ? 'Choose the option that fits best' : undefined
          }
        />
        <StepFooter onBack={onBack} submitLabel="Create workspace" submitting={create.isPending} />
      </form>
    </StepFrame>
  )
}

export function AccountTypeStep({ organization, onNext, onBack }: Props) {
  if (organization !== null)
    return <ExistingWorkspace organization={organization} onNext={onNext} onBack={onBack} />
  return <CreateWorkspaceForm onNext={onNext} onBack={onBack} />
}
