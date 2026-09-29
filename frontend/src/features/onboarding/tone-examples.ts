import type { CommunicationTone } from '@/api/business'
import type { RadioCardOption } from '@/components/ui/radio-cards'

export const EXAMPLE_QUESTION = 'Hi! Do you ship internationally?'

export const TONE_OPTIONS: readonly (RadioCardOption & {
  value: CommunicationTone
  example: string
})[] = [
  {
    value: 'strict_business',
    label: 'Strict business',
    description: 'Formal, concise, no small talk.',
    example:
      'Good afternoon. Yes, we ship internationally. Delivery times and fees are listed on our shipping page.',
  },
  {
    value: 'professional',
    label: 'Professional',
    description: 'Polite and clear, with a warm edge.',
    example:
      'Hello, and thank you for your message. Yes, we ship internationally. You can find delivery times and costs on our shipping page.',
  },
  {
    value: 'moderately_casual',
    label: 'Moderately casual',
    description: 'Relaxed and approachable, still tidy.',
    example:
      'Hi there! Yes, we do ship internationally. Delivery times and costs are on our shipping page, and I’m happy to help with anything else.',
  },
  {
    value: 'friendly',
    label: 'Friendly',
    description: 'Warm, conversational, light emoji.',
    example:
      'Hey, thanks for asking! Yes, we ship internationally 😊 You’ll find delivery times and costs on our shipping page. Just shout if you need anything!',
  },
]
