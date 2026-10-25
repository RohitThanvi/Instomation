import type { UsageLine } from '@/api/usage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCount, formatUsd } from '@/lib/format'

export interface UsageRow {
  key: string
  label: string
  detail?: string
  line: UsageLine
}

interface UsageTableProps {
  title: string
  firstColumn: string
  rows: readonly UsageRow[]
}

export function UsageTable({ title, firstColumn, rows }: UsageTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-ink-muted border-line border-b text-left">
              <th scope="col" className="py-2 pr-4 font-medium">
                {firstColumn}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Requests
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Tokens in / out
              </th>
              <th scope="col" className="py-2 pl-4 text-right font-medium">
                Estimated cost
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, detail, line }) => (
              <tr key={key} className="border-line border-b last:border-b-0">
                <th scope="row" className="py-2.5 pr-4 text-left font-medium">
                  <span className="text-ink block">{label}</span>
                  {detail !== undefined && (
                    <span className="text-ink-subtle block text-xs font-normal">{detail}</span>
                  )}
                </th>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatCount(line.requests)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatCount(line.input_tokens)} / {formatCount(line.output_tokens)}
                </td>
                <td className="py-2.5 pl-4 text-right tabular-nums">
                  {formatUsd(line.estimated_cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
