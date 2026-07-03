import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
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
import { BrandLockup } from '../components/BrandMark'
import type { Transaction } from '../types'

const LIFE_VIDEOS = [
  { src: '/video/sea-city.mov', label: 'Sea city' },
  { src: '/video/city-dusk.mov', label: 'City dusk' },
  { src: '/video/mountain-drive.mov', label: 'Mountain road' },
  { src: '/video/rural-aerial.mov', label: 'Rural aerial' },
  { src: '/video/wild-aerial.mov', label: 'Wild horizon' },
] as const

const HERO_VIDEO_FADE_MS = 1400
const HERO_VIDEO_MIN_MS = 1800
const HERO_VIDEO_MAX_MS = 7600
const HERO_VIDEO_PROMOTION_OFFSET_SECONDS = HERO_VIDEO_FADE_MS / 1000

type DashboardStats = {
  income: number
  expense: number
  balance: number
  mom: number
  categories: { name: string; value: number }[]
  trend: { month: string; 支出: number; 收入: number }[]
  top: Transaction[]
  uncategorized: number
  duplicateCandidates: number
  refundCandidates: number
  excluded: number
  curCount: number
  monthName: string
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

  const stats = useMemo<DashboardStats | null>(() => {
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

  const hasEntries = (allTx?.length ?? 0) > 0
  const queueCount = stats.uncategorized + stats.duplicateCandidates + stats.refundCandidates

  return (
    <div className="immersive-dashboard">
      <LifeHero stats={stats} hasEntries={hasEntries} queueCount={queueCount} />

      <main id="life-tools" className="tool-deck">
        <div className="tool-deck-inner">
          <section className="tool-deck-heading">
            <div>
              <div className="eyebrow">Tools after perspective</div>
              <h2 className="display">只留下能帮助行动的部分。</h2>
              <p>
                汐账不要求你围着账单生活。它把多源记录收拢成少量反馈：回报、消耗、待校准，然后让你继续把注意力放回成长本身。
              </p>
            </div>
            <div className="tool-deck-actions" aria-label="常用功能">
              <Link to="/import" className="btn btn-primary">
                多源导入
              </Link>
              <Link to="/transactions" className="btn btn-ghost">
                流水校准
              </Link>
            </div>
          </section>

          <StateReflection
            balance={stats.balance}
            income={stats.income}
            expense={stats.expense}
            topCategory={stats.categories[0]?.name}
            queueCount={queueCount}
          />

          {hasEntries ? (
            <>
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
            </>
          ) : (
            <section className="quiet-start">
              <div>
                <div className="eyebrow">Small tool, wide life</div>
                <h2 className="display mt-2 text-3xl">先不用把账单当成主线。</h2>
                <p className="page-lede mt-4">
                  导入一段记录即可。汐账只负责把回报、消耗和待复盘事项放到你眼前，剩下的时间应该还给真正重要的事。
                </p>
              </div>
              <Link to="/import" className="btn btn-ghost">
                轻量导入
                <span aria-hidden="true">→</span>
              </Link>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function LifeHero({
  stats,
  hasEntries,
  queueCount,
}: {
  stats: DashboardStats
  hasEntries: boolean
  queueCount: number
}) {
  const balanceLabel = hasEntries ? `¥ ${formatMoney(stats.balance)}` : '等待第一段反馈'
  const nextStep = !hasEntries
    ? '导入一段账单'
    : queueCount > 0
      ? `校准 ${queueCount} 项`
      : '看见状态，然后出发'
  const [activeVideo, setActiveVideo] = useState(0)
  const [incomingVideo, setIncomingVideo] = useState<number | null>(null)
  const [activeStartAt, setActiveStartAt] = useState(0)
  const transitionTimer = useRef<number | null>(null)
  const settleTimer = useRef<number | null>(null)
  const transitioning = useRef(false)
  const currentVideo = LIFE_VIDEOS[activeVideo] ?? LIFE_VIDEOS[0]
  const nextVideo = incomingVideo == null ? null : LIFE_VIDEOS[incomingVideo]

  const clearVideoTimers = useCallback(() => {
    if (transitionTimer.current != null) window.clearTimeout(transitionTimer.current)
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current)
    transitionTimer.current = null
    settleTimer.current = null
  }, [])

  const beginVideoTransition = useCallback(() => {
    if (transitioning.current) return
    transitioning.current = true
    if (transitionTimer.current != null) window.clearTimeout(transitionTimer.current)
    transitionTimer.current = null

    const next = (activeVideo + 1) % LIFE_VIDEOS.length
    setIncomingVideo(next)
    settleTimer.current = window.setTimeout(() => {
      setActiveStartAt(HERO_VIDEO_PROMOTION_OFFSET_SECONDS)
      setActiveVideo(next)
      setIncomingVideo(null)
      settleTimer.current = null
      transitioning.current = false
    }, HERO_VIDEO_FADE_MS)
  }, [activeVideo])

  const scheduleVideoAdvance = useCallback(
    (video: HTMLVideoElement) => {
      if (transitionTimer.current != null) window.clearTimeout(transitionTimer.current)
      const durationMs = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : HERO_VIDEO_MAX_MS
      const remainingMs = Math.max(0, durationMs - video.currentTime * 1000)
      const delay = Math.max(HERO_VIDEO_MIN_MS, Math.min(remainingMs - HERO_VIDEO_FADE_MS, HERO_VIDEO_MAX_MS))
      transitionTimer.current = window.setTimeout(beginVideoTransition, delay)
    },
    [beginVideoTransition],
  )

  const handleActiveLoadedMetadata = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget
      if (activeStartAt > 0 && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(activeStartAt, Math.max(0, video.duration - 0.2))
        setActiveStartAt(0)
      }
      scheduleVideoAdvance(video)
    },
    [activeStartAt, scheduleVideoAdvance],
  )

  useEffect(() => {
    return () => {
      clearVideoTimers()
    }
  }, [clearVideoTimers])

  return (
    <header className="life-hero">
      <div className="life-video-stage" aria-hidden="true">
        <video
          key={currentVideo.src}
          className="life-hero-video life-video-active"
          src={currentVideo.src}
          autoPlay
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={handleActiveLoadedMetadata}
          onEnded={beginVideoTransition}
          onError={beginVideoTransition}
        />
        {nextVideo && (
          <video key={nextVideo.src} className="life-hero-video life-video-incoming" src={nextVideo.src} autoPlay muted playsInline preload="auto" />
        )}
      </div>
      <div className="life-hero-shade" />
      <div className="life-hero-grain" />

      <nav className="life-hero-topbar" aria-label="首页导航">
        <BrandLockup compact className="brand-lockup-on-video" />
        <div className="life-hero-nav">
          <a href="#life-tools">功能</a>
          <Link to="/import">导入</Link>
          <Link to="/transactions">流水</Link>
          <Link to="/settings">设置</Link>
        </div>
      </nav>

      <div className="life-hero-content">
        <div className="life-hero-copy">
          <div className="life-hero-meta">
            <span>Life horizon · {stats.monthName}</span>
            <span>{currentVideo.label}</span>
            <span>
              {String(activeVideo + 1).padStart(2, '0')} / {String(LIFE_VIDEOS.length).padStart(2, '0')}
            </span>
          </div>
          <h1 className="life-title display">人生不是账本。</h1>
          <p>
            账单只是回声。汐账把工作回报、能量消耗和少量待复盘事项放进同一片视野，让你确认状态、看见方向，然后继续把人生过大一点。
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/import" className="btn btn-primary">
              {hasEntries ? '补充记录' : '开始导入'}
              <span aria-hidden="true">→</span>
            </Link>
            <Link to="/transactions" className="btn btn-on-video">
              流水校准
            </Link>
          </div>
        </div>

        <aside className="life-status-panel" aria-label="当前状态反馈">
          <div className="life-status-row life-status-primary">
            <span>当前反馈</span>
            <strong className={hasEntries ? (stats.balance >= 0 ? 'amount-income' : 'amount-expense') : ''}>{balanceLabel}</strong>
          </div>
          <div className="life-status-row">
            <span>工作回报</span>
            <strong>{hasEntries ? `¥ ${formatMoney(stats.income)}` : '未导入'}</strong>
          </div>
          <div className="life-status-row">
            <span>能量消耗</span>
            <strong>{hasEntries ? `¥ ${formatMoney(stats.expense)}` : '未导入'}</strong>
          </div>
          <div className="life-status-row">
            <span>下一步</span>
            <strong>{nextStep}</strong>
          </div>
        </aside>
      </div>

      <a className="scroll-cue" href="#life-tools" aria-label="向下展开功能">
        <span>向下展开功能</span>
        <span aria-hidden="true">↓</span>
      </a>
    </header>
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
