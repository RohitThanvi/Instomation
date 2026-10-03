import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnalyticsView } from './analytics-view'
import { formatCount, formatPercent } from '@/lib/format'
import { DASHBOARD_OVERVIEW } from '@/test/fixtures'

const valueOf = (label: string) => screen.getByText(label).nextElementSibling?.textContent

describe('AnalyticsView', () => {
  it('shows each total with its label and the period', () => {
    render(<AnalyticsView overview={DASHBOARD_OVERVIEW} />)
    expect(screen.getByText('Last 30 days')).toBeInTheDocument()
    expect(valueOf('Messages received')).toBe(formatCount(1240))
    expect(valueOf('Replies sent by AI')).toBe(formatCount(880))
    expect(valueOf('Open conversations')).toBe(formatCount(37))
    expect(valueOf('Leads captured')).toBe(formatCount(52))
    expect(valueOf('Handled without a person')).toBe(formatPercent(0.62))
  })

  it('gives the chart a text alternative: a labelled image plus a data table', async () => {
    render(<AnalyticsView overview={DASHBOARD_OVERVIEW} />)
    expect(
      await screen.findByRole('img', { name: /line chart of messages per day/i }),
    ).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'Messages per day' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(1 + DASHBOARD_OVERVIEW.messages_over_time.length)
    expect(
      within(rows[2] ?? table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['55', '41', '9'])
  })

  it('breaks conversations down by state with their counts', () => {
    render(<AnalyticsView overview={DASHBOARD_OVERVIEW} />)
    for (const [label, count] of [
      ['Handled by AI', 20],
      ['Needs a person', 5],
      ['With a person', 12],
      ['Resolved', 60],
    ] as const) {
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent(String(count))
    }
  })

  it('says so, rather than drawing an empty chart, when there is no activity', async () => {
    render(
      <AnalyticsView
        overview={{
          ...DASHBOARD_OVERVIEW,
          messages_over_time: [],
          conversations_by_state: { ai_active: 0, human_required: 0, human_active: 0, resolved: 0 },
        }}
      />,
    )
    expect(await screen.findByText('No messages in this period.')).toBeInTheDocument()
    expect(screen.getByText('No conversations in this period.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
