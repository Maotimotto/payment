import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
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
import { db } from '../db/db'
import { useApp } from '../store/app'
import { formatDate, formatMoney, monthKey, monthLabel, monthRange } from '../lib/format'
import { rootTagId, tagFullName } from '../lib/tags'
import { detectDuplicates, detectRefundOffsets } from '../lib/dedup'
import { FlowMotion } from '../components/FlowMotion'
import type { Transaction } from '../types'

function CashFigure({
  label,
  value,
  tone,
  detail,
}: {
  label: string
  value: string
  tone?: 'income' | 'expense' | 'neutral'
  detail?: string
}) {
  const toneClass = tone === 'income' ? 'amount-income' : tone === 'expense' ? 'amount-expense' : ''
  return (
    <div className="cash-figure">
      <div className="eyebrow">{label}</div>
      <div className={`metric-value mt-3 ${toneClass}`}>{value}</div>
      {detail && <div className="mt-2 text-xs leading-5 text-[var(--muted)]">{detail}</div>}
    </div>
  )
}

function Panel({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  return (
    <section className="surface p-5">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 className="display mt-1 text-2xl">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  )
}

export default function Dashboard() {
  const { ledgerId } = useApp()
  const tags = useLiveQuery(() => db.tags.toArray(), [])
  const allTx = useLiveQuery(
    () =>
      ledgerId != null
        ? db.transactions.where('ledgerId').equals(ledgerId).toArray()
        : Promise.resolve([] as Transaction[]),
    [ledgerId],
  )

  const stats = useMemo(() => {
    if (!allTx || !tags) return null
    const counted = allTx.filter((t) => t.countInStats && t.dedupStatus !== 'merged')
    const now = new Date()
    const { start, end } = monthRange(now)
    const prev = monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1))

    const inRange = (t: Transaction, s: number, e: number) => t.occurredAt >= s && t.occurredAt < e
    const sum = (arr: Transaction[], dir: 'income' | 'expense') =>
      arr.filter((t) => t.direction === dir).reduce((a, b) => a + b.amount, 0)

    const cur = counted.filter((t) => inRange(t, start, end))
    const pre = counted.filter((t) => inRange(t, prev.start, prev.end))
    const income = sum(cur, 'income')
    const expense = sum(cur, 'expense')
    const preExpense = sum(pre, 'expense')
    const mom = preExpense > 0 ? ((expense - preExpense) / preExpense) * 100 : 0

    const catMap = new Map<string, number>()
    for (const t of cur.filter((x) => x.direction === 'expense')) {
      const root = rootTagId(t.tagId, tags)
      const name = tagFullName(root, tags)
      catMap.set(name, (catMap.get(name) ?? 0) + t.amount)
    }
    const categories = [...catMap.entries()]
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7)

    const trend: { month: string; 支出: number; 收入: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const r = monthRange(d)
      const m = counted.filter((t) => inRange(t, r.start, r.end))
      trend.push({
        month: monthLabel(monthKey(d.getTime())),
        支出: Number(sum(m, 'expense').toFixed(2)),
        收入: Number(sum(m, 'income').toFixed(2)),
      })
    }

    const top = cur
      .filter((t) => t.direction === 'expense')
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 7)

    const reviewable = allTx.filter((t) => t.dedupStatus === 'none')
    const duplicateCandidates = detectDuplicates(reviewable).length
    const refundCandidates = detectRefundOffsets(reviewable).length
    const uncategorized = allTx.filter((t) => t.tagId == null && t.dedupStatus !== 'merged').length
    const excluded = allTx.filter((t) => !t.countInStats && t.dedupStatus !== 'merged').length

    return {
      income,
      expense,
      balance: income - expense,
      mom,
      categories,
      trend,
      top,
      uncategorized,
      duplicateCandidates,
      refundCandidates,
      excluded,
      curCount: cur.length,
      monthName: monthLabel(monthKey(now.getTime())),
    }
  }, [allTx, tags])

  if (!stats || !tags) return <div className="text-[var(--muted)]">加载中…</div>

  if (allTx && allTx.length === 0) {
    return (
      <div className="grid min-h-[72vh] place-items-center">
        <div className="surface empty-ledger-grid w-full max-w-5xl overflow-hidden p-5 md:p-8">
          <FlowMotion variant="empty" />
          <div className="empty-ledger-copy">
            <div className="eyebrow">汐账 · Tide ledger</div>
            <h1 className="page-title mt-4">让分散流水归潮。</h1>
            <p className="page-lede mt-5">
              先导入微信、支付宝、银行 CSV/PDF，或者手动录入一笔。汐账会把账单变成状态反馈：看见工作回报、消耗节奏和少量待复盘事项。
            </p>
            <Link to="/import" className="btn btn-primary mt-7">
              进入导入
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      <header className="dashboard-hero">
        <div className="dashboard-hero-main">
          <div className="eyebrow">Monthly tide · {stats.monthName}</div>
          <h1 className="page-title mt-3">本月潮位</h1>
          <div className={`tide-balance mt-7 ${stats.balance >= 0 ? 'amount-income' : 'amount-expense'}`}>
            ¥ {formatMoney(stats.balance)}
          </div>
          <p className="page-lede mt-4">
            这不是生活的成绩单，只是一面安静的状态镜。看见本月工作回报与消耗节奏，再处理右侧少量队列即可。
          </p>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <CashFigure label="收入" value={`¥ ${formatMoney(stats.income)}`} tone="income" detail={`${stats.curCount} 笔本月记录`} />
            <CashFigure label="支出" value={`¥ ${formatMoney(stats.expense)}`} tone="expense" detail={`${stats.mom >= 0 ? '+' : ''}${stats.mom.toFixed(1)}% 较上月支出`} />
            <CashFigure label="净流入" value={`¥ ${formatMoney(stats.balance)}`} detail={stats.balance >= 0 ? '现金流为正。' : '支出超过收入。'} />
          </div>
        </div>
        <aside className="review-panel">
          <div>
            <div className="eyebrow">Clean queue</div>
            <h2 className="display mt-2 text-2xl">待校准</h2>
          </div>
          <div className="mt-5 grid gap-3">
            <QueueRow label="未分类" value={stats.uncategorized} to="/transactions" />
            <QueueRow label="疑似重复" value={stats.duplicateCandidates} to="/transactions" />
            <QueueRow label="退款抵消" value={stats.refundCandidates} to="/transactions" />
            <QueueRow label="不计统计复核" value={stats.excluded} to="/transactions" />
          </div>
        </aside>
      </header>

      <StateReflection
        balance={stats.balance}
        income={stats.income}
        expense={stats.expense}
        topCategory={stats.categories[0]?.name}
        queueCount={stats.uncategorized + stats.duplicateCandidates + stats.refundCandidates}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Panel title="近 6 月潮汐" eyebrow="Trend">
          <div className="chart-shell h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.trend} margin={{ top: 12, right: 18, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="1 8" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={58} />
                <Tooltip formatter={(v) => `¥ ${formatMoney(Number(v))}`} />
                <Legend />
                <Line type="monotone" dataKey="支出" stroke="var(--coral)" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="收入" stroke="var(--jade)" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="支出去向" eyebrow="This month">
          <CategoryBars items={stats.categories} />
        </Panel>
      </section>

      <Panel title="本月大额 / 异常" eyebrow="Top spend">
        {stats.top.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted)]">本月暂无支出</div>
        ) : (
          <div className="ledger-list">
            {stats.top.map((t, index) => (
              <div key={t.id} className="ledger-row">
                <span className="display w-8 text-xl text-[var(--brass)]">{String(index + 1).padStart(2, '0')}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{t.merchant}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{formatDate(t.occurredAt)}</div>
                </div>
                <div className="font-[var(--font-num)] text-lg amount-expense">¥ {formatMoney(t.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

function StateReflection({
  balance,
  income,
  expense,
  topCategory,
  queueCount,
}: {
  balance: number
  income: number
  expense: number
  topCategory?: string
  queueCount: number
}) {
  return (
    <section className="reflection-strip">
      <div>
        <div className="eyebrow">Work return</div>
        <p>{income > 0 ? '收入记录是工作回报的回声，用来确认方向，不用每天盯着它。' : '还没有收入记录，先完成导入，再看这段时间的回报。'}</p>
      </div>
      <div>
        <div className="eyebrow">Energy cost</div>
        <p>{expense > 0 ? `本月主要消耗在「${topCategory ?? '未分类'}」，适合做一次轻量复盘。` : '暂时没有支出压力，保持现在的节奏。'}</p>
      </div>
      <div>
        <div className="eyebrow">Step away</div>
        <p>{queueCount > 0 ? `先处理 ${queueCount} 个待校准项，然后把注意力还给工作和生活。` : balance >= 0 ? '口径干净，状态稳定。看见它，然后继续生活。' : '看见状态就够了，下一步只需要找一个可调整的消耗点。'}</p>
      </div>
    </section>
  )
}

function CategoryBars({ items }: { items: { name: string; value: number }[] }) {
  const max = Math.max(...items.map((item) => item.value), 0)
  if (items.length === 0) {
    return <div className="grid min-h-[320px] place-items-center text-sm text-[var(--muted)]">本月暂无支出分类</div>
  }
  return (
    <div className="ledger-list">
      {items.map((item, index) => (
        <div key={item.name} className="category-row">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{item.name}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">#{String(index + 1).padStart(2, '0')}</div>
            </div>
            <div className="font-[var(--font-num)] text-sm amount-expense">¥ {formatMoney(item.value)}</div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--line-strong)_34%,transparent)]">
            <div
              className="h-full rounded-full bg-[color-mix(in_oklch,var(--coral)_78%,var(--brass))]"
              style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function QueueRow({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link to={to} className={`queue-row ${value === 0 ? 'queue-row-quiet' : ''}`}>
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="font-[var(--font-num)] text-lg">{value}</span>
    </Link>
  )
}
