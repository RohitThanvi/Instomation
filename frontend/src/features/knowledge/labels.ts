import type { KnowledgeKind } from '@/api/knowledge'

export const KIND_LABELS: Record<KnowledgeKind, string> = {
  faq: 'FAQ',
  product: 'Product',
  service: 'Service',
  policy: 'Policy',
  website: 'Website',
  custom: 'Other',
}
