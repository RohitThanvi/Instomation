import { useState } from 'react'
import { PROFILE_LIMITS, type BusinessProfile } from '@/api/business'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Notice } from '@/components/ui/notice'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { TextAreaField, TextField } from '@/components/ui/text-field'
import { TONE_OPTIONS } from '@/features/onboarding/tone-examples'
import { PairEditor } from './pair-editor'
import {
  profileToForm,
  sameProfile,
  validateProfile,
  type ProfileErrors,
  type ProfileForm,
} from './profile-form'
import { useBusinessProfile, useSaveProfile } from './use-settings'
import { useReportDirty, type DirtyReporter } from './use-report-dirty'

export function ProfileSection({ onDirtyChange }: { onDirtyChange: DirtyReporter }) {
  const profile = useBusinessProfile()
  let body
  if (profile.isPending) {
    body = <Skeleton className="h-96 w-full" />
  } else if (profile.isError) {
    body = (
      <ErrorState
        error={profile.error}
        title="We could not load your business profile"
        onRetry={() => void profile.refetch()}
      />
    )
  } else {
    // Remounting on the saved profile resets the form to what the server now holds.
    body = (
      <ProfileEditor
        key={JSON.stringify(profile.data)}
        profile={profile.data}
        onDirtyChange={onDirtyChange}
      />
    )
  }
  return (
    <section aria-labelledby="profile-heading">
      <Card>
        <CardHeader>
          <CardTitle id="profile-heading">Business profile</CardTitle>
          <CardDescription>
            The assistant reads this before every reply. Anything it should not say, leave out.
          </CardDescription>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </section>
  )
}

const NO_ERRORS: ProfileErrors = { fields: {}, contact: {}, policies: {} }

function ProfileEditor({
  profile,
  onDirtyChange,
}: {
  profile: BusinessProfile
  onDirtyChange: DirtyReporter
}) {
  const [values, setValues] = useState<ProfileForm>(() => profileToForm(profile))
  const [errors, setErrors] = useState<ProfileErrors>(NO_ERRORS)
  const save = useSaveProfile()
  const set = (change: Partial<ProfileForm>) => {
    save.reset()
    setValues((current) => ({ ...current, ...change }))
  }

  const result = validateProfile(values)
  // A form that cannot be read yet counts as changed, so Save stays available to show why.
  const changed = !result.ok || !sameProfile(profile, result.profile)
  useReportDirty(changed, onDirtyChange)

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!result.ok) {
          setErrors(result.errors)
          return
        }
        setErrors(NO_ERRORS)
        save.mutate(result.profile)
      }}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Brand name"
          autoComplete="organization"
          value={values.brand_name}
          error={errors.fields.brand_name}
          onChange={(event) => {
            set({ brand_name: event.target.value })
          }}
        />
        <TextField
          label="Industry or category"
          hint="For example “Skincare” or “Fitness coaching”."
          value={values.industry}
          error={errors.fields.industry}
          onChange={(event) => {
            set({ industry: event.target.value })
          }}
        />
        <TextField
          label="Location"
          value={values.location}
          error={errors.fields.location}
          onChange={(event) => {
            set({ location: event.target.value })
          }}
        />
        <TextField
          label="Website"
          type="url"
          inputMode="url"
          placeholder="https://"
          hint="The assistant may share this link in replies."
          value={values.website}
          error={errors.fields.website}
          onChange={(event) => {
            set({ website: event.target.value })
          }}
        />
      </div>

      <TextAreaField
        label="What you do"
        rows={4}
        hint={`Up to ${String(PROFILE_LIMITS.description)} characters.`}
        value={values.description}
        error={errors.fields.description}
        onChange={(event) => {
          set({ description: event.target.value })
        }}
      />

      <SelectField
        label="How the assistant sounds"
        value={values.communication_style}
        onChange={(event) => {
          const tone = TONE_OPTIONS.find((option) => option.value === event.target.value)
          if (tone !== undefined) set({ communication_style: tone.value })
        }}
      >
        {TONE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}: {option.description}
          </option>
        ))}
      </SelectField>

      <TextAreaField
        label="Special instructions"
        rows={4}
        hint="Anything else the assistant must always do or never do. Up to 2,000 characters."
        value={values.custom_instructions}
        error={errors.fields.custom_instructions}
        onChange={(event) => {
          set({ custom_instructions: event.target.value })
        }}
      />

      <PairEditor
        title="Contact details"
        description="How customers can reach you. The assistant may share these."
        itemLabel="Contact detail"
        addLabel="Add a contact detail"
        namePlaceholder="Email"
        valuePlaceholder="hello@example.com"
        maxItems={PROFILE_LIMITS.contactItems}
        rows={values.contact}
        onChange={(contact) => {
          set({ contact })
        }}
        rowErrors={errors.contact}
        listError={errors.contactList}
      />
      <PairEditor
        title="Policies"
        description="Returns, shipping, bookings, anything customers ask about the rules."
        itemLabel="Policy"
        addLabel="Add a policy"
        namePlaceholder="Returns"
        valuePlaceholder="Free returns within 30 days"
        maxItems={PROFILE_LIMITS.policyItems}
        rows={values.policies}
        onChange={(policies) => {
          set({ policies })
        }}
        rowErrors={errors.policies}
        listError={errors.policiesList}
      />

      {save.isError && (
        <Notice tone="danger" title="We could not save your changes">
          {errorMessage(save.error)}
        </Notice>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={!changed} loading={save.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}
