import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createRule,
  deleteRule,
  fetchRules,
  previewRule,
  reorderRules,
  replaceRule,
  type Rule,
  type RuleInput,
} from '@/api/automations'
import { tenantKey } from '@/api/keys'
import { useRequiredOrganization, useSession } from '@/auth/session-context'
import { useToast } from '@/components/ui/toast-context'
import { ruleToInput } from './rule-form'

function useRulesKey() {
  const organization = useRequiredOrganization()
  return tenantKey(organization.id, 'automations', 'rules')
}

// Read fresh on every visit: another member may have changed the rules, and the order shown must be
// the order the server will really try them in.
export function useRules(enabled: boolean) {
  const { client } = useSession()
  const queryKey = useRulesKey()
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchRules(client, signal),
    enabled,
    refetchOnMount: 'always',
  })
}

/** Create a rule, or replace the one named by `id`. */
export function useSaveRule() {
  const { client } = useSession()
  const queryKey = useRulesKey()
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ id, rule }: { id: string | null; rule: RuleInput }) =>
      id === null ? createRule(client, rule) : replaceRule(client, id, rule),
    onSuccess: (saved, { id }) => {
      queryClient.setQueryData<Rule[]>(queryKey, (rules = []) =>
        id === null ? [...rules, saved] : rules.map((rule) => (rule.id === id ? saved : rule)),
      )
      toast({ title: id === null ? 'Rule added' : 'Rule saved', variant: 'success' })
    },
  })
}

export function useDeleteRule() {
  const { client } = useSession()
  const queryKey = useRulesKey()
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (id: string) => deleteRule(client, id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Rule[]>(queryKey, (rules = []) =>
        rules.filter((rule) => rule.id !== id),
      )
      toast({ title: 'Rule deleted', variant: 'success' })
    },
  })
}

/** Pause a rule or turn it back on: the same replace, with only `enabled` flipped. */
export function useToggleRule() {
  const { client } = useSession()
  const queryKey = useRulesKey()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rule: Rule) =>
      replaceRule(client, rule.id, { ...ruleToInput(rule), enabled: !rule.enabled }),
    onSuccess: (saved) => {
      queryClient.setQueryData<Rule[]>(queryKey, (rules = []) =>
        rules.map((rule) => (rule.id === saved.id ? saved : rule)),
      )
    },
  })
}

export function useReorderRules() {
  const { client } = useSession()
  const queryKey = useRulesKey()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: readonly string[]) => reorderRules(client, ids),
    onSuccess: (rules) => {
      queryClient.setQueryData<Rule[]>(queryKey, rules)
    },
    // A stale list means someone changed the rules meanwhile: show what is really there.
    onError: () => void queryClient.invalidateQueries({ queryKey }),
  })
}

export function usePreviewRule() {
  const { client } = useSession()
  return useMutation({
    mutationFn: ({ scope, text }: { scope: 'dm' | 'comment'; text: string }) =>
      previewRule(client, scope, text),
  })
}
