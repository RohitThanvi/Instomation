import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyMessages } from '@/api/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCount, formatShortDate } from '@/lib/format'

const CHART_HEIGHT = 280
const SERIES = [
  { key: 'inbound', label: 'Received', color: 'var(--color-ink-subtle)' },
  { key: 'outbound', label: 'Outgoing', color: 'var(--color-accent-600)' },
] as const

const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  stroke: 'var(--color-ink-subtle)',
  fontSize: 12,
} as const

export function MessagesChart({ points }: { points: readonly DailyMessages[] }) {
  // The API zero-fills every day in the period, so "no activity" means all zeros, not no points.
  const hasActivity = points.some((point) => point.inbound > 0 || point.outbound > 0)
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Messages over time</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasActivity ? (
          <p className="text-ink-muted text-sm">No messages in this period.</p>
        ) : (
          <>
            <div
              role="img"
              aria-label="Line chart of messages per day: received and outgoing, including any that failed to deliver. The same data is available in the table that follows."
            >
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <LineChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis
                    dataKey="date"
                    minTickGap={24}
                    tickFormatter={(value: string) => formatShortDate(value)}
                    {...AXIS_PROPS}
                  />
                  <YAxis allowDecimals={false} {...AXIS_PROPS} />
                  <Tooltip
                    labelFormatter={(label) =>
                      typeof label === 'string' ? formatShortDate(label) : label
                    }
                    contentStyle={{
                      border: '1px solid var(--color-line)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-raised)',
                    }}
                  />
                  <Legend iconType="plainline" />
                  {SERIES.map(({ key, label, color }) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={label}
                      stroke={color}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <table className="sr-only">
              <caption>Messages per day</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  {SERIES.map(({ key, label }) => (
                    <th key={key} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.date}>
                    <th scope="row">{formatShortDate(point.date)}</th>
                    {SERIES.map(({ key }) => (
                      <td key={key}>{formatCount(point[key])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  )
}
