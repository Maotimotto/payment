import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatMoney } from '../lib/format'

export type StateTrendPoint = {
  month: string
  支出: number
  收入: number
}

export default function StateTrendChart({ data }: { data: StateTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 18, right: 18, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="1 10" vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={58} />
        <Tooltip formatter={(value) => `¥ ${formatMoney(Number(value))}`} />
        <Line type="monotone" dataKey="支出" stroke="var(--coral)" strokeWidth={3} dot={false} />
        <Line type="monotone" dataKey="收入" stroke="var(--jade)" strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
