import { Loader2 } from 'lucide-react'
import type { Message } from '@/api/conversations'
import { ChatBubble } from '@/components/ui/chat-bubble'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { formatMessageTime } from '@/lib/format'
import { channelCaption, confidenceLabel, deliveryNotice, INTENT_LABELS } from './labels'

function SenderLabel({ message }: { message: Message }) {
  if (message.origin === 'ai') return <span>Assistant</span>
  if (message.origin === 'human') return <span>Team member</span>
  return null
}

function MessageFooter({ message }: { message: Message }) {
  const notice = message.direction === 'outbound' ? deliveryNotice(message.status) : null
  const confidence = message.origin === 'ai' ? confidenceLabel(message.ai_confidence) : null
  const channel = channelCaption(message)
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SenderLabel message={message} />
        {channel !== null && <span>{channel}</span>}
        <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
        {message.intent !== null && <span>{INTENT_LABELS[message.intent]}</span>}
        {confidence !== null && <span>{confidence}</span>}
        {notice !== null && (
          <span className="inline-flex items-center gap-1">
            {message.status === 'pending' && (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            )}
            <StatusIndicator tone={notice.tone} label={notice.label} />
          </span>
        )}
      </p>
      {notice?.detail !== undefined && (
        <p role="alert" className="text-ink-muted">
          {notice.detail}
        </p>
      )}
    </div>
  )
}

function InternalNote({ message }: { message: Message }) {
  return (
    <div className="border-warning-600/30 bg-warning-50 space-y-1.5 rounded-lg border border-dashed p-3">
      <p className="text-warning-600 text-xs font-medium">
        Internal note · only your team can see this
      </p>
      <p className="text-ink text-sm break-words whitespace-pre-wrap">{message.body}</p>
      <p className="text-ink-subtle text-xs">
        <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
      </p>
    </div>
  )
}

export function MessageItem({ message }: { message: Message }) {
  if (message.origin === 'internal_note') return <InternalNote message={message} />
  const side =
    message.origin === 'customer' ? 'customer' : message.origin === 'ai' ? 'assistant' : 'team'
  return (
    <ChatBubble side={side} footer={<MessageFooter message={message} />}>
      {message.body}
    </ChatBubble>
  )
}
