import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnalyticsView } from './analytics-view'
import { formatCount } from '@/lib/format'
import { ANALYTICS_OVERVIEW } from '@/test/fixtures'

const valueOf = (label: string) => screen.getByText(label).nextElementSibling?.textContent

describe('AnalyticsView', () => {
  it('shows each total with its label and the exact period', () => {
    render(<AnalyticsView overview={ANALYTICS_OVERVIEW} />)
    expect(screen.getByText('Sep 1 to Sep 3 (UTC days)')).toBeInTheDocument()
    expect(valueOf('Messages received')).toBe(formatCount(126))
    expect(valueOf('Replies sent by AI')).toBe(formatCount(91))
    expect(valueOf('New conversations')).toBe(formatCount(18))
    expect(valueOf('New leads')).toBe(formatCount(7))
    expect(valueOf('Handoffs to a person')).toBe(formatCount(9))
  })

  it('does not invent a rate the API does not provide', () => {
    render(<AnalyticsView overview={ANALYTICS_OVERVIEW} />)
    expect(document.body.textContent).not.toMatch(/%|handled without/i)
  })

  it('gives the chart a text alternative: a labelled image plus a data table', async () => {
    render(<AnalyticsView overview={ANALYTICS_OVERVIEW} />)
    expect(
      await screen.findByRole('img', { name: /line chart of messages per day/i }),
    ).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'Messages per day' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(1 + ANALYTICS_OVERVIEW.daily.length)
    expect(
      within(rows[2] ?? table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['55', '50'])
  })

  it('breaks conversations down by their current state', () => {
    render(<AnalyticsView overview={ANALYTICS_OVERVIEW} />)
    expect(screen.getByText('Conversations right now')).toBeInTheDocument()
    for (const [label, count] of [
      ['Handled by AI', 20],
      ['Needs a person', 5],
      ['With a person', 12],
      ['Resolved', 60],
    ] as const) {
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent(String(count))
    }
  })

  it('says so, rather than drawing a flat chart, when every day is zero', async () => {
    render(
      <AnalyticsView
        overview={{
          ...ANALYTICS_OVERVIEW,
          // The API zero-fills each day, so an idle period still has one point per day.
          daily: ANALYTICS_OVERVIEW.daily.map((day) => ({ ...day, inbound: 0, outbound: 0 })),
          conversations: {
            ...ANALYTICS_OVERVIEW.conversations,
            by_state: { ai_active: 0, human_required: 0, human_active: 0, resolved: 0 },
          },
        }}
      />,
    )
    expect(await screen.findByText('No messages in this period.')).toBeInTheDocument()
    expect(screen.getByText('No conversations yet.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
