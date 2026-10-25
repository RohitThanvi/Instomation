import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DailyUsage } from '@/api/usage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCount, formatShortDate, formatUsd } from '@/lib/format'

const CHART_HEIGHT = 260
const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  stroke: 'var(--color-ink-subtle)',
  fontSize: 12,
} as const

/** Requests per day. They are exact integers, so they are what is drawn; cost is in the table. */
export function RequestsChart({ points }: { points: readonly DailyUsage[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI requests per day</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          role="img"
          aria-label="Bar chart of AI requests per day. The same data, with each day's estimated cost, is in the table that follows."
        >
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
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
                formatter={(value) => [formatCount(Number(value)), 'Requests']}
                contentStyle={{
                  border: '1px solid var(--color-line)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-raised)',
                }}
              />
              <Bar
                dataKey="requests"
                name="Requests"
                fill="var(--color-accent-600)"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>AI requests and estimated cost per day</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Requests</th>
              <th scope="col">Estimated cost</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <th scope="row">{formatShortDate(point.date)}</th>
                <td>{formatCount(point.requests)}</td>
                <td>{formatUsd(point.estimated_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
