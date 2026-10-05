import type { Conversation } from '@/api/conversations'
import { Button } from '@/components/ui/button'
import { ACTION_COPY, actionLabel, availableActions, type ConversationAction } from './labels'
import { useConversationActions } from './use-inbox'

export function ConversationActions({ conversation }: { conversation: Conversation }) {
  const actions = useConversationActions(conversation.id)
  const mutations: Record<ConversationAction, typeof actions.takeOver> = {
    takeover: actions.takeOver,
    hand_back: actions.handBack,
    resolve: actions.resolve,
  }
  const busy = Object.values(mutations).some((mutation) => mutation.isPending)

  return (
    <div className="flex flex-wrap gap-2">
      {availableActions(conversation.state).map((action, index) => {
        const mutation = mutations[action]
        return (
          <Button
            key={action}
            size="sm"
            variant={index === 0 && action === 'takeover' ? 'primary' : 'secondary'}
            loading={mutation.isPending}
            disabled={busy}
            onClick={() => {
              mutation.mutate()
            }}
          >
            {mutation.isPending
              ? `${ACTION_COPY[action].pending}…`
              : actionLabel(action, conversation.state)}
          </Button>
        )
      })}
    </div>
  )
}
