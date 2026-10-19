import type { HandoffReason, HandoffStatus } from '@/api/handoffs'
import type { BadgeTone } from '@/components/ui/badge'

export const REASON_LABELS: Record<HandoffReason, string> = {
  customer_requested: 'Asked for a person',
  complaint: 'Complaint',
  refund_dispute: 'Refund or dispute',
  legal: 'Legal matter',
  threat: 'Threat',
  high_value_lead: 'High-value lead',
  collaboration: 'Collaboration request',
  low_confidence: 'Assistant was unsure',
  missing_information: 'Missing information',
  repeated_dissatisfaction: 'Customer still unhappy',
  manual: 'Handed over by your team',
}

/** Reasons that put the business at risk read as danger; the rest are ordinary work. */
export const REASON_TONES: Record<HandoffReason, BadgeTone> = {
  customer_requested: 'info',
  complaint: 'warning',
  refund_dispute: 'danger',
  legal: 'danger',
  threat: 'danger',
  high_value_lead: 'success',
  collaboration: 'success',
  low_confidence: 'neutral',
  missing_information: 'neutral',
  repeated_dissatisfaction: 'warning',
  manual: 'neutral',
}

export const STATUS_LABELS: Record<HandoffStatus, string> = {
  open: 'Waiting for a person',
  assigned: 'Being handled',
  resolved: 'Resolved',
}

export const STATUS_TONES: Record<HandoffStatus, BadgeTone> = {
  open: 'warning',
  assigned: 'info',
  resolved: 'success',
}
