import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useForm } from 'react-hook-form'
import { StepFooter, StepFrame } from '../step-frame'
import {
  BUSINESS_LIMITS,
  productsSchema,
  type ProductItem,
  type ProductsValues,
} from '@/api/business'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SelectField } from '@/components/ui/select-field'
import { TextAreaField, TextField } from '@/components/ui/text-field'

const NEW_ITEM: ProductItem = { kind: 'product', name: '', description: '', price: '', url: '' }

interface Props {
  defaults: ProductsValues | undefined
  onSubmit: (values: ProductsValues) => void
  onBack: () => void
}

export function OfferingsStep({ defaults, onSubmit, onBack }: Props) {
  const form = useForm<ProductsValues>({
    resolver: zodResolver(productsSchema),
    defaultValues: defaults ?? { items: [] },
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' })
  const submit = form.handleSubmit(onSubmit)
  const atLimit = fields.length >= BUSINESS_LIMITS.maxProducts

  const addButton = (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={atLimit}
      onClick={() => {
        append(NEW_ITEM)
      }}
    >
      <Plus className="size-4" aria-hidden />
      Add a product or service
    </Button>
  )

  return (
    <StepFrame
      title="Products and services"
      description="What do people ask about? Add the main things you offer. You can skip this now and add them later."
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-6">
        {fields.length === 0 ? (
          <EmptyState
            title="Nothing added yet"
            description="Adding your offers helps the assistant answer questions about what you sell."
            action={addButton}
          />
        ) : (
          <div className="space-y-4">
            {fields.map((field, index) => {
              const errors = form.formState.errors.items?.[index]
              return (
                <fieldset
                  key={field.id}
                  className="border-line bg-surface shadow-card space-y-4 rounded-lg border p-5"
                >
                  <legend className="sr-only">Item {index + 1}</legend>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-ink text-sm font-medium">Item {index + 1}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove item ${index + 1}`}
                      onClick={() => {
                        remove(index)
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                    <SelectField label="Type" {...form.register(`items.${index}.kind`)}>
                      <option value="product">Product</option>
                      <option value="service">Service</option>
                    </SelectField>
                    <TextField
                      label="Name"
                      maxLength={BUSINESS_LIMITS.productName}
                      error={errors?.name?.message}
                      {...form.register(`items.${index}.name`)}
                    />
                  </div>
                  <TextAreaField
                    label="Description (optional)"
                    className="min-h-20"
                    maxLength={BUSINESS_LIMITS.productDescription}
                    error={errors?.description?.message}
                    {...form.register(`items.${index}.description`)}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label="Price (optional)"
                      hint="Written as you would say it, for example “From $25”."
                      maxLength={BUSINESS_LIMITS.price}
                      error={errors?.price?.message}
                      {...form.register(`items.${index}.price`)}
                    />
                    <TextField
                      label="Link (optional)"
                      type="url"
                      inputMode="url"
                      placeholder="https://"
                      error={errors?.url?.message}
                      {...form.register(`items.${index}.url`)}
                    />
                  </div>
                </fieldset>
              )
            })}
            <div>{addButton}</div>
          </div>
        )}
        <StepFooter
          onBack={onBack}
          submitLabel={fields.length === 0 ? 'Skip for now' : 'Continue'}
          submitVariant={fields.length === 0 ? 'secondary' : 'primary'}
        />
      </form>
    </StepFrame>
  )
}
