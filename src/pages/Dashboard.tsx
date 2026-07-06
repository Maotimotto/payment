import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getLLMConfig, saveLLMConfig } from '../db/db'
import { useApp } from '../store/app'
import { useAiTag } from '../store/aiTag'
import {
  PLATFORM_LABELS,
  parseBuiltin,
  parseGenericRows,
  readFileSmart,
  type BuiltinPlatform,
} from '../lib/csv'
import { detectDuplicates, detectRefundOffsets, type DuplicatePair, type RefundPair } from '../lib/dedup'
import { formatDate, formatMoney, monthKey, monthLabel, monthRange } from '../lib/format'
import { ingestDrafts, updateTransactionTag } from '../lib/ingest'
import { parseCsvWithLLM, parseImage, testConnection } from '../lib/llm'
import { buildTagTree, rootTagId, tagFullName, type TagNode } from '../lib/tags'
import { BrandLockup } from '../components/BrandMark'
import {
  LIFE_CHAPTER_MEDIA,
  LIFE_HERO_MEDIA,
  getBrowserConnection,
  getChapterVideoPlaylist,
  getMediaLoadingPolicy,
  markVideoSourcePlayed,
  resolveLifeVideoSource,
  shouldWarmNextAsset,
  type LifeChapterMedia,
  type MediaLoadingPolicy,
} from '../lib/lifeMedia'
import type { Direction, DraftTransaction, Ledger, LLMConfig, Tag, Transaction } from '../types'

const StateTrendChart = lazy(() => import('../components/StateTrendChart'))

const VIDEO_PLAYBACK_RATE = 1
const HERO_VIDEO_FADE_MS = 1800
const HERO_VIDEO_MIN_MS = 5200
const HERO_VIDEO_MAX_MS = 14000
const HERO_VIDEO_PROMOTION_OFFSET_SECONDS = (HERO_VIDEO_FADE_MS / 1000) * VIDEO_PLAYBACK_RATE
const SECTION_VIDEO_FADE_MS = 1800
const SECTION_VIDEO_MIN_MS = 6200
const SECTION_VIDEO_MAX_MS = 16000
const SECTION_VIDEO_PROMOTION_OFFSET_SECONDS = (SECTION_VIDEO_FADE_MS / 1000) * VIDEO_PLAYBACK_RATE

type Status = { kind: 'idle' | 'working' | 'done' | 'error'; msg: string }
type ViewKey = 'current' | 'uncategorized' | 'excluded' | 'merged' | 'combo' | 'large' | 'all'

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

type SectionVariant = 'manifest' | 'route' | 'review' | 'bench' | 'taxonomy' | 'control'
type SectionLead = {
  label: string
  value: string
}

const STORY_NAV_ITEMS = [
  { id: 'state-flow', label: '状态' },
  { id: 'import-flow', label: '导入' },
  { id: 'review-flow', label: '复核' },
  { id: 'ledger-flow', label: '流水' },
  { id: 'tags-flow', label: '标签' },
  { id: 'settings-flow', label: '控制' },
] as const

function scrollToStorySection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function setLifeVideoPlaybackRate(video: HTMLVideoElement) {
  video.defaultPlaybackRate = VIDEO_PLAYBACK_RATE
  video.playbackRate = VIDEO_PLAYBACK_RATE
}

function splitLeadSegments(value: string) {
  return value
    .split(/[／/、，,]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export default function Dashboard() {
  const { ledgerId, setLedgerId, theme, toggleTheme } = useApp()
  const heroImportInputRef = useRef<HTMLInputElement | null>(null)
  const tags = useLiveQuery(() => db.tags.toArray(), [])
  const ledgers = useLiveQuery(() => db.ledgers.toArray(), [])
  const llmCfg = useLiveQuery(() => getLLMConfig(), [])
  const activeLedgerId = ledgers
    ? (ledgers.some((ledger) => ledger.id === ledgerId) ? ledgerId : ledgers[0]?.id ?? null)
    : ledgerId
  const allTx = useLiveQuery(
    () =>
      activeLedgerId != null
        ? db.transactions.where('ledgerId').equals(activeLedgerId).toArray()
        : Promise.resolve([] as Transaction[]),
    [activeLedgerId],
  )

  useEffect(() => {
    if (activeLedgerId != null && activeLedgerId !== ledgerId) {
      setLedgerId(activeLedgerId)
    }
  }, [activeLedgerId, ledgerId, setLedgerId])

  useEffect(() => {
    document.title = '汐账 · Dashboard'
  }, [])

  const stats = useMemo<DashboardStats | null>(() => {
    if (!allTx || !tags) return null
    const counted = allTx.filter((t) => t.countInStats && t.dedupStatus !== 'merged')
    const now = new Date()
    const { start, end } = monthRange(now)
    const prev = monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1))

    const inRange = (t: Transaction, s: number, e: number) => t.occurredAt >= s && t.occurredAt < e
    const sum = (arr: Transaction[], dir: Direction) =>
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
      .slice(0, 8)

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
      .slice(0, 8)

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

  const llmReady = !!llmCfg?.enabled && !!llmCfg?.apiKey
  const importController = useImportController(activeLedgerId, llmReady)

  const requestImportPicker = useCallback(() => {
    heroImportInputRef.current?.click()
    window.setTimeout(() => {
      scrollToStorySection('import-flow')
    }, 0)
  }, [])

  if (!stats || !tags || !allTx || !ledgers || ledgers.length === 0 || !llmCfg) {
    return <div className="grid min-h-screen place-items-center text-[var(--muted)]">加载中…</div>
  }

  const hasEntries = allTx.length > 0
  const queueCount = stats.uncategorized + stats.duplicateCandidates + stats.refundCandidates
  const currentLedger = ledgers.find((l) => l.id === activeLedgerId) ?? ledgers[0]

  return (
    <div className="immersive-dashboard">
      <input
        ref={heroImportInputRef}
        type="file"
        accept=".csv,text/csv,.pdf,application/pdf"
        className="sr-only-file-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          if (e.target.files?.[0]) importController.handleFile(e.target.files[0])
          e.target.value = ''
        }}
      />

      <LifeHero
        stats={stats}
        hasEntries={hasEntries}
        queueCount={queueCount}
        onRequestImport={requestImportPicker}
      />

      <main id="dashboard" className="scroll-story">
        <RevealSection
          id="state-flow"
          index="01"
          variant="manifest"
          chapter={LIFE_CHAPTER_MEDIA[0]}
          nextChapter={LIFE_CHAPTER_MEDIA[1]}
          eyebrow="State feedback"
          titleLines={['先看', '状态']}
          note="Feedback before fixation"
          lead={{
            label: 'State brief',
            value: '工作回报、能量消耗、待处理事项。先合成一眼能懂的当下，再决定要不要处理账单。',
          }}
          copy="账单只负责把工作回报、能量消耗和待复盘事项摆到一条长视线里。你看见它，校准它，然后离开它。"
        >
          <StateFlow stats={stats} hasEntries={hasEntries} />
        </RevealSection>

        <RevealSection
          id="import-flow"
          index="02"
          variant="route"
          chapter={LIFE_CHAPTER_MEDIA[1]}
          nextChapter={LIFE_CHAPTER_MEDIA[2]}
          eyebrow="Bring records in"
          titleLines={['记录', '归流']}
          note="Gather without breaking the mood"
          lead={{
            label: 'Source path',
            value: '微信 / 支付宝 / 银行 / 截图 / 手动录入',
          }}
          copy="微信、支付宝、银行 CSV/PDF、截图和手动录入都在这里。能用本地规则解决的就留在本地，需要大模型时再打开。"
        >
          <ImportFlow
            ledgerId={activeLedgerId}
            llmReady={llmReady}
            controller={importController}
          />
        </RevealSection>

        <RevealSection
          id="review-flow"
          index="03"
          variant="review"
          chapter={LIFE_CHAPTER_MEDIA[2]}
          nextChapter={LIFE_CHAPTER_MEDIA[3]}
          eyebrow="Clean only what matters"
          titleLines={['只留', '关键处']}
          note="Review once, then move on"
          lead={{
            label: 'Review desk',
            value: '未分类、重复、退款、统计排除，只要会影响判断，就摆上台面。',
          }}
          copy="未分类、疑似重复、退款抵消和不计统计项被放在同一个复核段落。处理完，就把注意力还给工作和生活。"
        >
          <ReviewFlow stats={stats} transactions={allTx} />
        </RevealSection>

        <RevealSection
          id="ledger-flow"
          index="04"
          variant="bench"
          chapter={LIFE_CHAPTER_MEDIA[3]}
          nextChapter={LIFE_CHAPTER_MEDIA[4]}
          eyebrow="Ledger workbench"
          titleLines={['校准', '流水']}
          note="The tool lives inside the story"
          lead={{
            label: 'Workbench',
            value: '筛选、改标签、导出、AI 辅助，放在同一张工作台上。',
          }}
          copy="筛选、改标签、删除、导出、AI 打标签都在这里。它是工具，不再是另一个需要切换进去的旧页面。"
        >
          <LedgerWorkbench
            ledger={currentLedger}
            transactions={allTx}
            tags={tags}
            llmReady={llmReady}
          />
        </RevealSection>

        <RevealSection
          id="tags-flow"
          index="05"
          variant="taxonomy"
          chapter={LIFE_CHAPTER_MEDIA[4]}
          nextChapter={LIFE_CHAPTER_MEDIA[5]}
          eyebrow="Taxonomy"
          titleLines={['口径', '清楚']}
          note="Taxonomy that stays useful"
          lead={{
            label: 'Category logic',
            value: '标签不是越多越好。它只需要让真实状态浮出来。',
          }}
          copy="统计口径只需要足够清楚，不需要过度精细。把转账、投资、还款这些资金搬运单独收好，避免它们掩盖真实状态。"
        >
          <TagFlow tags={tags} />
        </RevealSection>

        <RevealSection
          id="settings-flow"
          index="06"
          variant="control"
          chapter={LIFE_CHAPTER_MEDIA[5]}
          eyebrow="Local controls"
          titleLines={['需要', '再开']}
          note="Quiet by default, powerful on demand"
          lead={{
            label: 'Control room',
            value: '默认安静，本地优先。真的需要能力时，再把开关点亮。',
          }}
          copy="大模型、账本、主题和数据管理被收进最后一段。默认仍然是纯本地账本，敏感配置只保存在当前浏览器。"
        >
          <ControlFlow
            cfg={llmCfg}
            ledgers={ledgers}
            ledgerId={activeLedgerId}
            setLedgerId={setLedgerId}
            theme={theme}
            toggleTheme={toggleTheme}
          />
        </RevealSection>
      </main>
    </div>
  )
}

function RevealSection({
  id,
  index,
  variant,
  chapter,
  nextChapter,
  eyebrow,
  titleLines,
  note,
  lead,
  copy,
  children,
}: {
  id: string
  index: string
  variant: SectionVariant
  chapter: LifeChapterMedia
  nextChapter?: LifeChapterMedia
  eyebrow: string
  titleLines: [string, string] | string[]
  note: string
  lead: SectionLead
  copy: string
  children: ReactNode
}) {
  const ref = useRef<HTMLElement | null>(null)
  const startedRef = useRef(false)
  const [hydrated, setHydrated] = useState(false)
  const [isInViewport, setIsInViewport] = useState(false)
  const [activeVideo, setActiveVideo] = useState(0)
  const [incomingVideo, setIncomingVideo] = useState<number | null>(null)
  const [activeStartAt, setActiveStartAt] = useState(0)
  const [mediaPolicy, setMediaPolicy] = useState<MediaLoadingPolicy>(() => getMediaLoadingPolicy())
  const transitionTimer = useRef<number | null>(null)
  const settleTimer = useRef<number | null>(null)
  const transitioning = useRef(false)
  const sectionVideos = useMemo(() => getChapterVideoPlaylist(chapter), [chapter])
  const currentVideo = sectionVideos[activeVideo] ?? sectionVideos[0] ?? chapter
  const nextVideo = incomingVideo == null ? null : sectionVideos[incomingVideo]
  const currentVideoSrc = hydrated ? resolveLifeVideoSource(currentVideo, mediaPolicy) : null
  const nextVideoSrc = nextVideo ? resolveLifeVideoSource(nextVideo, mediaPolicy) : null
  const shouldRenderVideo = hydrated && Boolean(currentVideoSrc) && mediaPolicy !== 'still'
  const shouldAdvanceVideo = shouldRenderVideo && isInViewport
  const prewarmIndex = shouldRenderVideo && shouldWarmNextAsset(mediaPolicy) && sectionVideos.length > 1 && incomingVideo == null
    ? (activeVideo + 1) % sectionVideos.length
    : null
  const prewarmVideo = prewarmIndex == null ? null : sectionVideos[prewarmIndex]
  const prewarmVideoSrc = prewarmVideo ? resolveLifeVideoSource(prewarmVideo, mediaPolicy) : null
  const nextChapterFirstVideo = nextChapter ? getChapterVideoPlaylist(nextChapter)[0] : null
  const nextChapterVideoSrc = shouldRenderVideo && nextChapterFirstVideo
    ? resolveLifeVideoSource(nextChapterFirstVideo, mediaPolicy)
    : null

  const handleVideoPlay = useCallback(() => {
    if (currentVideoSrc) markVideoSourcePlayed(currentVideoSrc)
  }, [currentVideoSrc])

  const clearSectionTimers = useCallback(() => {
    if (transitionTimer.current != null) window.clearTimeout(transitionTimer.current)
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current)
    transitionTimer.current = null
    settleTimer.current = null
  }, [])

  const beginSectionVideoTransition = useCallback(() => {
    if (!shouldAdvanceVideo || sectionVideos.length < 2) return
    if (transitioning.current) return
    transitioning.current = true
    if (transitionTimer.current != null) window.clearTimeout(transitionTimer.current)
    transitionTimer.current = null

    const next = (activeVideo + 1) % sectionVideos.length
    setIncomingVideo(next)
    settleTimer.current = window.setTimeout(() => {
      setActiveStartAt(SECTION_VIDEO_PROMOTION_OFFSET_SECONDS)
      setActiveVideo(next)
      setIncomingVideo(null)
      settleTimer.current = null
      transitioning.current = false
    }, SECTION_VIDEO_FADE_MS)
  }, [activeVideo, sectionVideos.length, shouldAdvanceVideo])

  const scheduleSectionVideoAdvance = useCallback(
    (video: HTMLVideoElement) => {
      if (!shouldAdvanceVideo || sectionVideos.length < 2) return
      if (transitionTimer.current != null) window.clearTimeout(transitionTimer.current)
      const durationMs = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : SECTION_VIDEO_MAX_MS
      const remainingMediaMs = Math.max(0, durationMs - video.currentTime * 1000)
      const remainingWallMs = remainingMediaMs / VIDEO_PLAYBACK_RATE
      const delay = Math.max(SECTION_VIDEO_MIN_MS, Math.min(remainingWallMs - SECTION_VIDEO_FADE_MS, SECTION_VIDEO_MAX_MS))
      transitionTimer.current = window.setTimeout(beginSectionVideoTransition, delay)
    },
    [beginSectionVideoTransition, sectionVideos.length, shouldAdvanceVideo],
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInViewport(entry.isIntersecting)
        if (!entry.isIntersecting || startedRef.current) return
        startedRef.current = true
        setHydrated(true)
      },
      { threshold: 0.08, rootMargin: '35% 0px -8% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const updatePolicy = () => setMediaPolicy(getMediaLoadingPolicy())
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const connection = getBrowserConnection()
    motionQuery.addEventListener('change', updatePolicy)
    connection?.addEventListener?.('change', updatePolicy)
    return () => {
      motionQuery.removeEventListener('change', updatePolicy)
      connection?.removeEventListener?.('change', updatePolicy)
    }
  }, [])

  useEffect(() => {
    if (!shouldAdvanceVideo) {
      clearSectionTimers()
      transitioning.current = false
      setIncomingVideo(null)
    }
  }, [clearSectionTimers, shouldAdvanceVideo])

  useEffect(() => {
    return () => {
      clearSectionTimers()
    }
  }, [clearSectionTimers])

  const handleSectionLoadedMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    setLifeVideoPlaybackRate(video)
    if (activeStartAt > 0 && Number.isFinite(video.duration)) {
      video.currentTime = Math.min(activeStartAt, Math.max(0, video.duration - 0.2))
      setActiveStartAt(0)
    }
    scheduleSectionVideoAdvance(video)
  }, [activeStartAt, scheduleSectionVideoAdvance])

  return (
    <section
      id={id}
      ref={ref}
      className={`story-section story-section-cinematic story-section-${chapter.align ?? 'left'} story-section-${variant} ${hydrated ? 'is-live' : ''} ${incomingVideo != null ? 'is-section-cutting' : ''}`}
    >
      <div className="story-section-media" aria-hidden="true">
        {shouldRenderVideo && currentVideoSrc && (
          <video
            key={`${chapter.id}-${currentVideo.id}-${currentVideoSrc}`}
            className="story-section-video story-section-video-active"
            src={currentVideoSrc}
            autoPlay
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={handleSectionLoadedMetadata}
            onPlay={(event) => {
              setLifeVideoPlaybackRate(event.currentTarget)
              handleVideoPlay()
            }}
            onEnded={beginSectionVideoTransition}
            onError={beginSectionVideoTransition}
          />
        )}
        {shouldRenderVideo && nextVideo && nextVideoSrc && (
          <video
            key={`${chapter.id}-incoming-${nextVideo.id}-${nextVideoSrc}`}
            className="story-section-video story-section-video-incoming"
            src={nextVideoSrc}
            autoPlay
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => setLifeVideoPlaybackRate(event.currentTarget)}
            onPlay={(event) => {
              setLifeVideoPlaybackRate(event.currentTarget)
              markVideoSourcePlayed(nextVideoSrc)
            }}
          />
        )}
        {prewarmVideo && prewarmVideoSrc && (
          <video
            key={`preload-${chapter.id}-${prewarmVideo.id}-${prewarmVideoSrc}`}
            className="life-video-preloader"
            src={prewarmVideoSrc}
            muted
            playsInline
            preload="metadata"
          />
        )}
        {nextChapterVideoSrc && (
          <video
            key={`preload-next-${nextChapter!.id}-${nextChapterVideoSrc}`}
            className="life-video-preloader"
            src={nextChapterVideoSrc}
            muted
            playsInline
            preload="metadata"
          />
        )}
      </div>
      <div className="story-section-shade" />
      <div className="story-section-grid">
        <StoryCopy
          index={index}
          chapterLabel={chapter.label}
          eyebrow={eyebrow}
          titleLines={titleLines}
          note={note}
          lead={lead}
          copy={copy}
          variant={variant}
        />
        <div className="story-body">
          {hydrated ? children : <div className="story-placeholder" aria-hidden="true" />}
        </div>
      </div>
    </section>
  )
}

function StoryCopy({
  index,
  chapterLabel,
  eyebrow,
  titleLines,
  note,
  lead,
  copy,
  variant,
}: {
  index: string
  chapterLabel: string
  eyebrow: string
  titleLines: string[]
  note: string
  lead: SectionLead
  copy: string
  variant: SectionVariant
}) {
  const leadParts = splitLeadSegments(lead.value)
  const shortLeadParts = leadParts.slice(0, 4)
  const titleText = titleLines.join('')
  const title = (
    <h2 className="display">
      {titleLines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </h2>
  )
  const meta = (
    <div className="story-section-meta">
      <span>{index}</span>
      <span>{chapterLabel}</span>
      <span>{eyebrow}</span>
    </div>
  )

  if (variant === 'manifest') {
    return (
      <div className="story-copy story-copy-manifest">
        {meta}
        <div className="manifest-board">
          <span className="manifest-index" aria-hidden="true">{index}</span>
          <div className="manifest-title">
            <span className="manifest-note">{note}</span>
            {title}
          </div>
        </div>
        <p className="manifest-lead">{lead.value}</p>
        <p className="story-copy-main">{copy}</p>
      </div>
    )
  }

  if (variant === 'route') {
    return (
      <div className="story-copy story-copy-route">
        <div className="route-rail" aria-hidden="true">
          <span>{index}</span>
          <span>Flow</span>
        </div>
        <div className="route-copy-panel">
          {meta}
          {title}
          <div className="route-map">
            {(leadParts.length > 0 ? leadParts : [lead.value]).map((part, partIndex, array) => (
              <div key={`${part}-${partIndex}`} className="route-stop">
                <span>{String(partIndex + 1).padStart(2, '0')}</span>
                <strong>{part}</strong>
                {partIndex < array.length - 1 && <i aria-hidden="true" />}
              </div>
            ))}
          </div>
          <p className="story-copy-main">{copy}</p>
        </div>
      </div>
    )
  }

  if (variant === 'review') {
    return (
      <div className="story-copy story-copy-review">
        <div className="review-slate">
          <span>Review / {index}</span>
          <span>{note}</span>
        </div>
        <div className="review-title-row">
          {title}
          <span className="review-scene-no" aria-hidden="true">{index}</span>
        </div>
        <div className="review-flags">
          {shortLeadParts.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>
        <p className="review-mainline">{lead.value}</p>
        <p className="story-copy-main">{copy}</p>
      </div>
    )
  }

  if (variant === 'bench') {
    return (
      <div className="story-copy story-copy-bench">
        {meta}
        <div className="bench-title-row">
          <div className="bench-title-stack">
            <span className="bench-note">{note}</span>
            {title}
          </div>
          <span className="bench-code">{index}</span>
        </div>
        <div className="bench-command-line">
          {shortLeadParts.map((part, partIndex) => (
            <span key={part}>
              {part}
              {partIndex < shortLeadParts.length - 1 && <i aria-hidden="true" />}
            </span>
          ))}
        </div>
        <div className="bench-brief">
          <span>{lead.label}</span>
          <p>{lead.value}</p>
        </div>
        <p className="story-copy-main">{copy}</p>
      </div>
    )
  }

  if (variant === 'taxonomy') {
    return (
      <div className="story-copy story-copy-taxonomy">
        <div className="taxonomy-label">
          <span>{index}</span>
          <span>{lead.label}</span>
        </div>
        <div className="taxonomy-entry">
          <div className="taxonomy-term">
            {title}
            <span className="taxonomy-term-roman">{eyebrow}</span>
          </div>
          <div className="taxonomy-definition">
            <span>定义</span>
            <p>{lead.value}</p>
          </div>
        </div>
        <p className="story-copy-main">{copy}</p>
      </div>
    )
  }

  return (
    <div className="story-copy story-copy-control">
      <div className="control-title-top">
        <span>{note}</span>
        <span>{index}</span>
      </div>
      <div className="control-header">
        <span className="control-caption">{chapterLabel}</span>
        {title}
      </div>
      <div className="control-lead">
        <span>{lead.label}</span>
        <p>{lead.value}</p>
      </div>
      <div className="control-switchwords">
        {(leadParts.length > 0 ? leadParts : [titleText]).slice(0, 3).map((part) => (
          <span key={part}>{part}</span>
        ))}
      </div>
      <p className="story-copy-main">{copy}</p>
    </div>
  )
}

function LifeHero({
  stats,
  hasEntries,
  queueCount,
  onRequestImport,
}: {
  stats: DashboardStats
  hasEntries: boolean
  queueCount: number
  onRequestImport: () => void
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
  const [activeVideoReady, setActiveVideoReady] = useState(false)
  const [mediaPolicy, setMediaPolicy] = useState<MediaLoadingPolicy>(() => getMediaLoadingPolicy())
  const transitionTimer = useRef<number | null>(null)
  const settleTimer = useRef<number | null>(null)
  const transitioning = useRef(false)
  const currentVideo = LIFE_HERO_MEDIA[activeVideo] ?? LIFE_HERO_MEDIA[0]
  const nextVideo = incomingVideo == null ? null : LIFE_HERO_MEDIA[incomingVideo]
  const currentVideoSrc = currentVideo ? resolveLifeVideoSource(currentVideo, mediaPolicy) : null
  const nextVideoSrc = nextVideo ? resolveLifeVideoSource(nextVideo, mediaPolicy) : null
  const shouldPlayVideo = Boolean(currentVideoSrc) && mediaPolicy !== 'still'
  const prewarmIndex = shouldPlayVideo && shouldWarmNextAsset(mediaPolicy) && LIFE_HERO_MEDIA.length > 1
    ? (activeVideo + 1) % LIFE_HERO_MEDIA.length
    : null
  const prewarmVideo = prewarmIndex == null || incomingVideo != null ? null : LIFE_HERO_MEDIA[prewarmIndex]
  const prewarmVideoSrc = prewarmVideo ? resolveLifeVideoSource(prewarmVideo, mediaPolicy) : null
  const displayedScene = incomingVideo == null ? activeVideo + 1 : incomingVideo + 1
  const displayedSceneLabel = String(displayedScene).padStart(2, '0')

  const clearVideoTimers = useCallback(() => {
    if (transitionTimer.current != null) window.clearTimeout(transitionTimer.current)
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current)
    transitionTimer.current = null
    settleTimer.current = null
  }, [])

  const beginVideoTransition = useCallback(() => {
    if (!shouldPlayVideo || LIFE_HERO_MEDIA.length < 2) return
    if (transitioning.current) return
    transitioning.current = true
    if (transitionTimer.current != null) window.clearTimeout(transitionTimer.current)
    transitionTimer.current = null

    const next = (activeVideo + 1) % LIFE_HERO_MEDIA.length
    setIncomingVideo(next)
    settleTimer.current = window.setTimeout(() => {
      setActiveStartAt(HERO_VIDEO_PROMOTION_OFFSET_SECONDS)
      setActiveVideo(next)
      setIncomingVideo(null)
      settleTimer.current = null
      transitioning.current = false
    }, HERO_VIDEO_FADE_MS)
  }, [activeVideo, shouldPlayVideo])

  const scheduleVideoAdvance = useCallback(
    (video: HTMLVideoElement) => {
      if (!shouldPlayVideo) return
      if (transitionTimer.current != null) window.clearTimeout(transitionTimer.current)
      const durationMs = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : HERO_VIDEO_MAX_MS
      const remainingMediaMs = Math.max(0, durationMs - video.currentTime * 1000)
      const remainingWallMs = remainingMediaMs / VIDEO_PLAYBACK_RATE
      const delay = Math.max(HERO_VIDEO_MIN_MS, Math.min(remainingWallMs - HERO_VIDEO_FADE_MS, HERO_VIDEO_MAX_MS))
      transitionTimer.current = window.setTimeout(beginVideoTransition, delay)
    },
    [beginVideoTransition, shouldPlayVideo],
  )

  const handleActiveLoadedMetadata = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget
      setLifeVideoPlaybackRate(video)
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

  useEffect(() => {
    const updatePolicy = () => setMediaPolicy(getMediaLoadingPolicy())
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const connection = getBrowserConnection()
    motionQuery.addEventListener('change', updatePolicy)
    connection?.addEventListener?.('change', updatePolicy)
    return () => {
      motionQuery.removeEventListener('change', updatePolicy)
      connection?.removeEventListener?.('change', updatePolicy)
    }
  }, [])

  useEffect(() => {
    if (!shouldPlayVideo) {
      setActiveVideoReady(true)
      clearVideoTimers()
    }
  }, [shouldPlayVideo, clearVideoTimers])

  return (
    <header className={`life-hero life-hero-${mediaPolicy} ${activeVideoReady ? 'is-media-ready' : 'is-media-loading'} ${incomingVideo != null ? 'is-video-cutting' : ''}`}>
      <div className="life-video-stage" aria-hidden="true">
        {shouldPlayVideo && currentVideoSrc && (
          <video
            key={`${currentVideo.id}-${currentVideoSrc}`}
            className="life-hero-video life-video-active"
            src={currentVideoSrc}
            autoPlay
            muted
            playsInline
            preload="metadata"
            onCanPlay={() => setActiveVideoReady(true)}
            onLoadedMetadata={handleActiveLoadedMetadata}
            onPlay={(event) => {
              setLifeVideoPlaybackRate(event.currentTarget)
              markVideoSourcePlayed(currentVideoSrc)
            }}
            onEnded={beginVideoTransition}
            onError={beginVideoTransition}
          />
        )}
        {nextVideo && nextVideoSrc && (
          <video
            key={`${nextVideo.id}-${nextVideoSrc}`}
            className="life-hero-video life-video-incoming"
            src={nextVideoSrc}
            autoPlay
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => setLifeVideoPlaybackRate(event.currentTarget)}
            onPlay={(event) => setLifeVideoPlaybackRate(event.currentTarget)}
          />
        )}
        {prewarmVideo && prewarmVideoSrc && (
          <video
            key={`prewarm-${prewarmVideo.id}-${prewarmVideoSrc}`}
            className="life-video-preloader"
            src={prewarmVideoSrc}
            muted
            playsInline
            preload="metadata"
          />
        )}
      </div>
      <div className="life-hero-shade" />
      <div className="life-hero-grain" />
      <div className="life-cut-overlay" aria-hidden="true">
        <span>{incomingVideo != null ? 'Cut to' : 'Now showing'}</span>
        <strong>{incomingVideo != null && nextVideo ? nextVideo.label : currentVideo.label}</strong>
        <span>{displayedSceneLabel} / {String(LIFE_HERO_MEDIA.length).padStart(2, '0')}</span>
      </div>

      <nav className="life-hero-topbar" aria-label="首页导航">
        <BrandLockup compact className="brand-lockup-on-video" />
        <div className="life-hero-nav">
          {STORY_NAV_ITEMS.map((item) => (
            <button key={item.id} type="button" onClick={() => scrollToStorySection(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="life-hero-content">
        <div className="life-hero-copy">
          <div className="life-hero-meta">
            <span>Dashboard · {stats.monthName}</span>
            <span>{currentVideo.label}</span>
            <span>
              {String(activeVideo + 1).padStart(2, '0')} / {String(LIFE_HERO_MEDIA.length).padStart(2, '0')}
            </span>
            {mediaPolicy !== 'cinematic' && <span>轻量加载</span>}
          </div>
          <div className="life-kicker">Bills are feedback, not the theme.</div>
          <h1 className="life-title display">
            <span>看见状态，</span>
            <span>继续向前。</span>
          </h1>
          <div className="life-title-note display">账单只是回声，不是人生的主题。</div>
          <p>
            账单只是回声。汐账把工作回报、能量消耗和少量待复盘事项放进同一片视野，让你确认状态、看见方向，然后继续把人生过大一点。
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" onClick={onRequestImport} className="btn btn-primary">
              {hasEntries ? '补充账单' : '选择账单'}
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" onClick={() => scrollToStorySection('ledger-flow')} className="btn btn-on-video">
              流水校准
            </button>
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

      <button type="button" className="scroll-cue" onClick={() => scrollToStorySection('state-flow')} aria-label="向下展开功能">
        <span>向下展开功能</span>
        <span aria-hidden="true">↓</span>
      </button>
    </header>
  )
}

function StateFlow({ stats, hasEntries }: { stats: DashboardStats; hasEntries: boolean }) {
  return (
    <div className="state-flow">
      <div className="naked-metrics">
        <MetricLine label="工作回报" value={hasEntries ? `¥ ${formatMoney(stats.income)}` : '未导入'} tone="income" detail={`${stats.curCount} 笔本月记录`} />
        <MetricLine label="能量消耗" value={hasEntries ? `¥ ${formatMoney(stats.expense)}` : '未导入'} tone="expense" detail={`${stats.mom >= 0 ? '+' : ''}${stats.mom.toFixed(1)}% 较上月支出`} />
        <MetricLine label="净反馈" value={hasEntries ? `¥ ${formatMoney(stats.balance)}` : '等待数据'} tone={stats.balance >= 0 ? 'income' : 'expense'} detail={stats.balance >= 0 ? '当前现金流为正。' : '先找一个可调整的消耗点。'} />
        <MetricLine label="待处理" value={`${stats.uncategorized + stats.duplicateCandidates + stats.refundCandidates}`} detail="未分类 / 重复 / 退款" />
      </div>

      <div className="naked-chart">
        <Suspense fallback={<div className="chart-skeleton" aria-hidden="true" />}>
          <StateTrendChart data={stats.trend} />
        </Suspense>
      </div>

      <div className="state-columns">
        <div>
          <div className="eyebrow">Where energy went</div>
          <CategoryBars items={stats.categories} />
        </div>
        <div>
          <div className="eyebrow">Large signals</div>
          <LargeSignals items={stats.top} />
        </div>
      </div>
    </div>
  )
}

function MetricLine({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail?: string
  tone?: 'income' | 'expense'
}) {
  const toneClass = tone === 'income' ? 'amount-income' : tone === 'expense' ? 'amount-expense' : ''
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong className={toneClass}>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function CategoryBars({ items }: { items: { name: string; value: number }[] }) {
  const max = Math.max(...items.map((item) => item.value), 0)
  if (items.length === 0) return <div className="empty-line">本月暂无支出分类</div>
  return (
    <div className="naked-list">
      {items.map((item, index) => (
        <div key={item.name} className="naked-row">
          <span className="naked-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="naked-name">{item.name}</span>
          <span className="naked-value amount-expense">¥ {formatMoney(item.value)}</span>
          <span className="naked-bar" aria-hidden="true">
            <span style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}

function LargeSignals({ items }: { items: Transaction[] }) {
  if (items.length === 0) return <div className="empty-line">本月没有大额支出信号</div>
  return (
    <div className="naked-list">
      {items.map((t, index) => (
        <div key={t.id} className="naked-row naked-row-compact">
          <span className="naked-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="naked-name">
            <strong>{t.merchant}</strong>
            <small>{formatDate(t.occurredAt)}</small>
          </span>
          <span className="naked-value amount-expense">¥ {formatMoney(t.amount)}</span>
        </div>
      ))}
    </div>
  )
}

function useImportController(ledgerId: number | null, llmReady: boolean) {
  const [status, setStatus] = useState<Status>({ kind: 'idle', msg: '' })
  const [source, setSource] = useState<'auto' | BuiltinPlatform>('auto')
  const [pendingPdf, setPendingPdf] = useState<File | null>(null)
  const [pdfPwd, setPdfPwd] = useState('')
  const [pdfWrong, setPdfWrong] = useState(false)

  const afterIngest = useCallback(async (count: number) => {
    if (ledgerId == null) return
    const all = await db.transactions
      .where('ledgerId')
      .equals(ledgerId)
      .filter((t) => t.dedupStatus === 'none')
      .toArray()
    const duplicates = detectDuplicates(all).length
    const refunds = detectRefundOffsets(all).length
    const extra = [
      duplicates > 0 ? `${duplicates} 组疑似重复` : '',
      refunds > 0 ? `${refunds} 组退款抵消` : '',
    ].filter(Boolean)
    setStatus({
      kind: 'done',
      msg: `已导入 ${count} 笔${extra.length > 0 ? `，检测到 ${extra.join('、')}` : '，暂未发现需要立刻处理的队列'}`,
    })
  }, [ledgerId])

  const runImport = useCallback(async (text: string, forced?: BuiltinPlatform) => {
    if (ledgerId == null) return
    const builtin = parseBuiltin(text, forced)
    let drafts: DraftTransaction[]
    let useLLM = false
    if (builtin) {
      drafts = builtin.drafts
      setStatus({ kind: 'working', msg: `识别为${PLATFORM_LABELS[builtin.platform]}账单，解析到 ${drafts.length} 笔，正在分类…` })
    } else if (forced) {
      setStatus({
        kind: 'error',
        msg: `按「${PLATFORM_LABELS[forced]}」模板未解析到有效记录。请确认来源与文件一致，或改用自动识别。`,
      })
      return
    } else if (llmReady) {
      const cfg = await getLLMConfig()
      const rows = parseGenericRows(text)
      setStatus({ kind: 'working', msg: '未匹配内置模板，使用大模型解析中…' })
      drafts = await parseCsvWithLLM(cfg, rows)
      useLLM = true
    } else {
      setStatus({ kind: 'error', msg: '未识别该账单格式，且未启用大模型。请换成内置来源，或在底部控制区启用大模型。' })
      return
    }
    if (drafts.length === 0) {
      setStatus({ kind: 'error', msg: '未解析到有效交易记录。' })
      return
    }
    const count = await ingestDrafts(ledgerId, drafts, {
      useLLM: useLLM || llmReady,
      onProgress: (p) => setStatus({ kind: 'working', msg: `${p.stage} ${p.done}/${p.total}` }),
    })
    await afterIngest(count)
  }, [afterIngest, ledgerId, llmReady])

  const handleCsv = useCallback(async (file: File) => {
    setStatus({ kind: 'working', msg: '正在解析 CSV…' })
    try {
      const text = await readFileSmart(file)
      await runImport(text, source === 'auto' ? undefined : source)
    } catch (e) {
      setStatus({ kind: 'error', msg: `解析失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }, [runImport, source])

  const processPdf = useCallback(async (file: File, password?: string) => {
    setStatus({ kind: 'working', msg: '正在解析 PDF…' })
    try {
      const { bocPdfToCsv } = await import('../lib/pdf')
      const csv = await bocPdfToCsv(file, password)
      setPendingPdf(null)
      setPdfPwd('')
      setPdfWrong(false)
      await runImport(csv, 'boc')
    } catch (e) {
      const { PdfPasswordError } = await import('../lib/pdf')
      if (e instanceof PdfPasswordError) {
        setPendingPdf(file)
        setPdfWrong(e.wrong)
        setStatus({ kind: 'idle', msg: '' })
        return
      }
      setStatus({ kind: 'error', msg: `解析失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }, [runImport])

  const handleImage = useCallback(async (file: File) => {
    if (ledgerId == null || !llmReady) return
    setStatus({ kind: 'working', msg: '正在用大模型识别截图…' })
    try {
      const cfg = await getLLMConfig()
      const drafts = await parseImage(cfg, file)
      if (drafts.length === 0) {
        setStatus({ kind: 'error', msg: '未从截图中识别到交易。' })
        return
      }
      const count = await ingestDrafts(ledgerId, drafts, { useLLM: true })
      await afterIngest(count)
    } catch (e) {
      setStatus({ kind: 'error', msg: `识别失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }, [afterIngest, ledgerId, llmReady])

  const handleFile = useCallback((file: File) => {
    if (/\.pdf$/i.test(file.name)) processPdf(file)
    else handleCsv(file)
  }, [handleCsv, processPdf])

  const cancelPendingPdf = useCallback(() => {
    setPendingPdf(null)
    setPdfPwd('')
    setPdfWrong(false)
    setStatus({ kind: 'idle', msg: '' })
  }, [])

  return {
    status,
    source,
    setSource,
    pendingPdf,
    pdfPwd,
    setPdfPwd,
    pdfWrong,
    processPdf,
    cancelPendingPdf,
    handleFile,
    handleImage,
    afterIngest,
  }
}

type ImportController = ReturnType<typeof useImportController>

function ImportFlow({
  ledgerId,
  llmReady,
  controller,
}: {
  ledgerId: number | null
  llmReady: boolean
  controller: ImportController
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="import-flow">
      <div className="flow-line">
        <label>
          <span>来源模板</span>
          <select value={controller.source} onChange={(e) => controller.setSource(e.target.value as 'auto' | BuiltinPlatform)} className="story-input">
            <option value="auto">自动识别</option>
            <option value="wechat">{PLATFORM_LABELS.wechat}</option>
            <option value="alipay">{PLATFORM_LABELS.alipay}</option>
            <option value="cmb">{PLATFORM_LABELS.cmb}</option>
            <option value="boc">{PLATFORM_LABELS.boc}</option>
          </select>
        </label>
        <label className="story-action">
          选择 CSV / PDF
          <input
            type="file"
            accept=".csv,text/csv,.pdf,application/pdf"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files?.[0]) controller.handleFile(e.target.files[0])
              e.target.value = ''
            }}
          />
        </label>
        <label className={`story-action ${llmReady ? '' : 'is-disabled'}`}>
          截图识别
          <input
            type="file"
            accept="image/*"
            disabled={!llmReady}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) controller.handleImage(e.target.files[0])
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {controller.pendingPdf && (
        <div className="inline-notice">
          <strong>「{controller.pendingPdf.name}」已加密</strong>
          <input
            type="password"
            autoFocus
            value={controller.pdfPwd}
            onChange={(e) => controller.setPdfPwd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && controller.pdfPwd && controller.processPdf(controller.pendingPdf!, controller.pdfPwd)}
            placeholder="账单密码"
            className="story-input"
          />
          <button onClick={() => controller.pdfPwd && controller.processPdf(controller.pendingPdf!, controller.pdfPwd)} className="story-action">解锁</button>
          <button onClick={controller.cancelPendingPdf} className="story-action story-action-muted">取消</button>
          {controller.pdfWrong && <span className="amount-expense">密码错误，请重试。</span>}
        </div>
      )}

      {controller.status.kind !== 'idle' && <div className={`inline-status inline-status-${controller.status.kind}`}>{controller.status.msg}</div>}

      <ManualEntryInline ledgerId={ledgerId} onDone={controller.afterIngest} />
    </div>
  )
}

function ManualEntryInline({ ledgerId, onDone }: { ledgerId: number | null; onDone: (count: number) => void }) {
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<Direction>('expense')
  const [datetime, setDatetime] = useState(() => new Date().toISOString().slice(0, 16))
  const [merchant, setMerchant] = useState('')
  const [payment, setPayment] = useState('')
  const [note, setNote] = useState('')

  async function submit() {
    if (ledgerId == null) return
    const amt = Math.abs(parseFloat(amount))
    if (!Number.isFinite(amt) || amt <= 0) return
    const draft: DraftTransaction = {
      amount: amt,
      direction,
      occurredAt: new Date(datetime).getTime(),
      merchant: merchant || '手动录入',
      source: 'manual',
      paymentMethod: payment || '现金',
      note,
      raw: '',
    }
    const count = await ingestDrafts(ledgerId, [draft], { useLLM: false })
    setAmount('')
    setMerchant('')
    setPayment('')
    setNote('')
    onDone(count)
  }

  return (
    <div className="manual-inline">
      <div className="eyebrow">Manual entry</div>
      <div className="manual-grid">
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="story-input" placeholder="金额" />
        <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)} className="story-input">
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
        <input type="datetime-local" value={datetime} onChange={(e) => setDatetime(e.target.value)} className="story-input" />
        <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className="story-input" placeholder="商户 / 描述" />
        <input value={payment} onChange={(e) => setPayment(e.target.value)} className="story-input" placeholder="支付方式" />
        <input value={note} onChange={(e) => setNote(e.target.value)} className="story-input" placeholder="备注" />
        <button onClick={submit} className="story-action">添加记录</button>
      </div>
    </div>
  )
}

function ReviewFlow({ stats, transactions }: { stats: DashboardStats; transactions: Transaction[] }) {
  const duplicatePairs = useMemo(() => detectDuplicates(transactions.filter((t) => t.dedupStatus === 'none')), [transactions])
  const [refundPairs, setRefundPairs] = useState<RefundPair[] | null>(null)

  async function mergePair(pair: DuplicatePair, action: 'merge' | 'ignore') {
    const groupId = `dg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    if (action === 'merge') {
      const [keep, drop] = pair.a.occurredAt <= pair.b.occurredAt ? [pair.a, pair.b] : [pair.b, pair.a]
      await db.transactions.update(keep.id!, { dedupStatus: 'none', dedupGroupId: groupId })
      await db.transactions.update(drop.id!, {
        dedupStatus: 'merged',
        dedupGroupId: groupId,
        countInStats: false,
      })
    } else {
      await db.transactions.update(pair.a.id!, { dedupStatus: 'ignored' })
      await db.transactions.update(pair.b.id!, { dedupStatus: 'ignored' })
    }
  }

  async function deleteRefundPair(pair: RefundPair) {
    await db.transactions.bulkDelete([pair.expense.id!, pair.income.id!])
    setRefundPairs((prev) => (prev ?? []).filter((p) => p !== pair))
  }

  return (
    <div className="review-flow">
      <div className="queue-grid">
        <MetricLine label="未分类" value={`${stats.uncategorized}`} detail="需要标签口径" />
        <MetricLine label="疑似重复" value={`${duplicatePairs.length}`} detail="可合并或忽略" />
        <MetricLine label="退款抵消" value={`${refundPairs?.length ?? stats.refundCandidates}`} detail="消费 + 退款" />
        <MetricLine label="不计统计" value={`${stats.excluded}`} detail="转账 / 投资 / 还款" />
      </div>

      <div className="review-actions">
        <button onClick={() => setRefundPairs(detectRefundOffsets(transactions))} className="story-action">检测退款抵消</button>
        <button type="button" onClick={() => scrollToStorySection('ledger-flow')} className="story-action story-action-muted">进入流水校准</button>
      </div>

      <div className="review-columns">
        <div>
          <div className="eyebrow">Duplicate review</div>
          {duplicatePairs.length === 0 ? (
            <div className="empty-line">没有需要处理的重复项</div>
          ) : (
            <div className="review-list">
              {duplicatePairs.slice(0, 6).map((pair, index) => (
                <div key={`${pair.a.id}-${pair.b.id}`} className="review-pair">
                  <span className="naked-index">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <DupLine label="A" t={pair.a} />
                    <DupLine label="B" t={pair.b} />
                    <div className="review-buttons">
                      <button onClick={() => mergePair(pair, 'merge')} className="story-action">合并较早一条</button>
                      <button onClick={() => mergePair(pair, 'ignore')} className="story-action story-action-muted">不是重复</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="eyebrow">Refund offset</div>
          {refundPairs == null ? (
            <div className="empty-line">点击检测后显示可成对删除的退款抵消</div>
          ) : refundPairs.length === 0 ? (
            <div className="empty-line">未检测到退款抵消对</div>
          ) : (
            <div className="review-list">
              {refundPairs.slice(0, 6).map((pair, index) => (
                <div key={`${pair.expense.id}-${pair.income.id}`} className="review-pair">
                  <span className="naked-index">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <DupLine label="消费" t={pair.expense} />
                    <DupLine label="退款" t={pair.income} />
                    <div className="review-buttons">
                      <button onClick={() => deleteRefundPair(pair)} className="story-action">删除该对</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DupLine({ label, t }: { label: string; t: Transaction }) {
  return (
    <div className="dup-line">
      <span>{label}</span>
      <strong>{t.merchant}</strong>
      <small>{formatDate(t.occurredAt)}</small>
      <em className={t.direction === 'income' ? 'amount-income' : 'amount-expense'}>{t.direction === 'income' ? '+' : '-'}{formatMoney(t.amount)}</em>
    </div>
  )
}

function LedgerWorkbench({
  ledger,
  transactions,
  tags,
  llmReady,
}: {
  ledger?: Ledger
  transactions: Transaction[]
  tags: Tag[]
  llmReady: boolean
}) {
  const [keyword, setKeyword] = useState('')
  const [dir, setDir] = useState<'all' | Direction>('all')
  const [tagFilter, setTagFilter] = useState<number | 'all'>('all')
  const [month, setMonth] = useState<string>('all')
  const [view, setView] = useState<ViewKey>('current')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const { running: aiRunning, progress: aiProgress, message: aiMsg, run: runAiTag } = useAiTag()

  const months = useMemo(() => {
    const set = new Set<string>()
    transactions.forEach((t) => set.add(monthKey(t.occurredAt)))
    return [...set].sort().reverse()
  }, [transactions])

  const filtered = useMemo(() => {
    const currentMonth = monthKey(Date.now())
    return transactions
      .slice()
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .filter((t) => {
        if (view === 'current' && monthKey(t.occurredAt) !== currentMonth) return false
        if (view === 'uncategorized' && t.tagId != null) return false
        if (view === 'excluded' && (t.countInStats || t.dedupStatus === 'merged')) return false
        if (view === 'merged' && t.dedupStatus !== 'merged') return false
        if (view === 'combo' && !t.comboGroupId) return false
        if (view === 'large' && (t.direction !== 'expense' || t.amount < 500)) return false
        if (dir !== 'all' && t.direction !== dir) return false
        if (tagFilter !== 'all' && t.tagId !== tagFilter) return false
        if (month !== 'all' && monthKey(t.occurredAt) !== month) return false
        if (keyword) {
          const k = keyword.toLowerCase()
          const hay = `${t.merchant} ${t.note} ${t.paymentMethod}`.toLowerCase()
          const asNum = parseFloat(keyword)
          if (!hay.includes(k) && !(Number.isFinite(asNum) && Math.abs(t.amount - asNum) < 0.001)) return false
        }
        return true
      })
  }, [transactions, view, dir, tagFilter, month, keyword])

  const viewCounts = useMemo(() => {
    const currentMonth = monthKey(Date.now())
    return {
      all: transactions.length,
      current: transactions.filter((t) => monthKey(t.occurredAt) === currentMonth).length,
      uncategorized: transactions.filter((t) => t.tagId == null).length,
      excluded: transactions.filter((t) => !t.countInStats && t.dedupStatus !== 'merged').length,
      merged: transactions.filter((t) => t.dedupStatus === 'merged').length,
      combo: transactions.filter((t) => t.comboGroupId).length,
      large: transactions.filter((t) => t.direction === 'expense' && t.amount >= 500).length,
    } satisfies Record<ViewKey, number>
  }, [transactions])

  const views: { key: ViewKey; label: string }[] = [
    { key: 'current', label: '本月' },
    { key: 'uncategorized', label: '未分类' },
    { key: 'excluded', label: '不计统计' },
    { key: 'merged', label: '已合并' },
    { key: 'combo', label: '组合支付' },
    { key: 'large', label: '大额' },
    { key: 'all', label: '全部' },
  ]

  const toggleSel = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id!))
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map((t) => t.id!)))
  const selectedRows = filtered.filter((t) => selected.has(t.id!))
  const uncategorized = filtered.filter((t) => t.tagId == null)

  async function batchDelete() {
    if (selected.size === 0) return
    if (!confirm(`确认删除选中的 ${selected.size} 笔？`)) return
    await db.transactions.bulkDelete([...selected])
    setSelected(new Set())
  }

  async function doExport() {
    const { exportTransactionsToExcel } = await import('../lib/export')
    exportTransactionsToExcel(filtered, tags, ledger?.name ?? '账本')
  }

  function runAiBatch() {
    const targets = selectedRows.length > 0 ? selectedRows : uncategorized
    if (!llmReady || targets.length === 0 || aiRunning) return
    setSelected(new Set())
    runAiTag(targets)
  }

  return (
    <div className="ledger-flow">
      <div className="ledger-command-row">
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className="story-input" placeholder="搜索商户、备注、支付方式或金额" />
        <button onClick={doExport} className="story-action">导出 Excel</button>
        <button onClick={runAiBatch} disabled={!llmReady || aiRunning || (selectedRows.length === 0 && uncategorized.length === 0)} className="story-action">
          {aiRunning ? `AI 打标签 ${aiProgress ? `${aiProgress.done}/${aiProgress.total}` : ''}` : selectedRows.length > 0 ? `AI 选中 ${selectedRows.length}` : `AI 未分类 ${uncategorized.length}`}
        </button>
        {selected.size > 0 && <button onClick={batchDelete} className="story-action story-action-danger">删除 {selected.size}</button>}
      </div>

      <div className="view-river">
        {views.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)} className={`view-chip ${view === v.key ? 'view-chip-active' : ''}`}>
            <span>{v.label}</span>
            <span className="font-[var(--font-num)]">{viewCounts[v.key]}</span>
          </button>
        ))}
      </div>

      <div className="ledger-filters">
        <select value={dir} onChange={(e) => setDir(e.target.value as 'all' | Direction)} className="story-input">
          <option value="all">全部收支</option>
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
        <select value={String(tagFilter)} onChange={(e) => setTagFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="story-input">
          <option value="all">全部标签</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {tagFullName(t.id!, tags)}
            </option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="story-input">
          <option value="all">全部月份</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {aiMsg && <div className="inline-status inline-status-done">{aiMsg}</div>}

      <div className="ledger-count-line">
        <label>
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
          选择当前筛选
        </label>
        <span>{filtered.length} / {transactions.length} 笔</span>
      </div>

      <div className="story-table-wrap">
        <table className="story-table">
          <thead>
            <tr>
              <th></th>
              <th>时间</th>
              <th>商户 / 描述</th>
              <th>标签</th>
              <th>支付方式</th>
              <th>金额</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-table">没有符合条件的记录</td>
              </tr>
            )}
            {filtered.slice(0, 80).map((t) => (
              <LedgerRow
                key={t.id}
                t={t}
                tags={tags}
                selected={selected.has(t.id!)}
                onToggle={() => toggleSel(t.id!)}
                llmReady={llmReady}
                aiRunning={aiRunning}
                onAiTag={() => runAiTag([t])}
              />
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > 80 && <div className="empty-line">当前只显示前 80 笔；继续收窄筛选会更适合复核。</div>}
    </div>
  )
}

function LedgerRow({
  t,
  tags,
  selected,
  onToggle,
  llmReady,
  aiRunning,
  onAiTag,
}: {
  t: Transaction
  tags: Tag[]
  selected: boolean
  onToggle: () => void
  llmReady: boolean
  aiRunning: boolean
  onAiTag: () => void
}) {
  const merged = t.dedupStatus === 'merged'
  async function onTagChange(val: string) {
    await updateTransactionTag(t.id!, val === '' ? null : Number(val), tags)
  }
  async function del() {
    if (confirm('删除这笔记录？')) await db.transactions.delete(t.id!)
  }

  return (
    <tr className={merged ? 'is-muted-row' : ''}>
      <td><input type="checkbox" checked={selected} onChange={onToggle} /></td>
      <td>{formatDate(t.occurredAt)}</td>
      <td>
        <strong>{t.merchant}</strong>
        <span>{[t.comboGroupId ? '组合支付' : '', merged ? '已合并' : '', !t.countInStats && !merged ? '不计统计' : ''].filter(Boolean).join(' · ')}</span>
      </td>
      <td>
        <div className="tag-editor">
          <select value={t.tagId ?? ''} onChange={(e) => onTagChange(e.target.value)} className="story-input">
            <option value="">未分类</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tagFullName(tag.id!, tags)}
              </option>
            ))}
          </select>
          {llmReady && (
            <button onClick={onAiTag} disabled={aiRunning} className="mini-action">AI</button>
          )}
        </div>
      </td>
      <td>{t.paymentMethod}</td>
      <td className={t.direction === 'income' ? 'amount-income' : 'amount-expense'}>{t.direction === 'income' ? '+' : '-'} {formatMoney(t.amount)}</td>
      <td><button onClick={del} className="mini-action">删</button></td>
    </tr>
  )
}

function TagFlow({ tags }: { tags: Tag[] }) {
  const [newRoot, setNewRoot] = useState('')
  const tree = useMemo(() => buildTagTree(tags), [tags])

  async function addRoot() {
    const name = newRoot.trim()
    if (!name) return
    await db.tags.add({ name, parentId: null, preset: false, special: null })
    setNewRoot('')
  }

  return (
    <div className="tag-flow">
      <div className="tag-compose">
        <input value={newRoot} onChange={(e) => setNewRoot(e.target.value)} className="story-input" placeholder="新增一级标签" />
        <button onClick={addRoot} className="story-action">添加一级标签</button>
      </div>

      <div className="tag-lines">
        {tree.length === 0 ? (
          <div className="empty-line">当前没有标签，先建立一组足够清楚的统计口径。</div>
        ) : (
          tree.map((node) => <TagBranch key={node.id} node={node} depth={0} />)
        )}
      </div>
    </div>
  )
}

function TagBranch({ node, depth }: { node: TagNode; depth: number }) {
  const [adding, setAdding] = useState(false)
  const [childName, setChildName] = useState('')
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(node.name)

  async function addChild() {
    const next = childName.trim()
    if (!next) return
    await db.tags.add({ name: next, parentId: node.id!, preset: false, special: null })
    setChildName('')
    setAdding(false)
  }

  async function rename() {
    const next = name.trim()
    if (next) await db.tags.update(node.id!, { name: next })
    setEditing(false)
  }

  async function remove() {
    if (!confirm(`删除标签「${node.name}」？其子标签与相关账单将变为未分类。`)) return
    const ids: number[] = []
    const stack: TagNode[] = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.id != null) ids.push(current.id)
      stack.push(...current.children)
    }
    await db.transactions.where('tagId').anyOf(ids).modify({ tagId: null })
    await db.tags.bulkDelete(ids)
  }

  return (
    <div className="tag-branch" style={{ '--tag-depth': depth } as CSSProperties}>
      <div className="tag-row">
        <div className="tag-label">
          <span className="naked-index">{String(depth + 1).padStart(2, '0')}</span>
          {editing ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => e.key === 'Enter' && rename()}
              autoFocus
              className="story-input tag-inline-input"
            />
          ) : (
            <span className="tag-name">
              <strong>{node.name}</strong>
              {node.special && <span className="tag-chip tag-chip-quiet">统计排除</span>}
            </span>
          )}
        </div>
        <div className="tag-actions">
          <button onClick={() => setAdding((value) => !value)} className="story-action story-action-compact">子标签</button>
          <button onClick={() => setEditing((value) => !value)} className="story-action story-action-muted story-action-compact">改名</button>
          <button onClick={remove} className="story-action story-action-danger story-action-compact">删除</button>
        </div>
      </div>

      {adding && (
        <div className="tag-compose tag-compose-nested">
          <input
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addChild()}
            className="story-input"
            placeholder="新增子标签"
            autoFocus
          />
          <button onClick={addChild} className="story-action">添加子标签</button>
        </div>
      )}

      {node.children.length > 0 && (
        <div className="tag-children">
          {node.children.map((child) => (
            <TagBranch key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

const PRESET_MODELS = ['gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet', 'deepseek-chat', 'qwen-plus', 'glm-4-flash']

function ControlFlow({
  cfg,
  ledgers,
  ledgerId,
  setLedgerId,
  theme,
  toggleTheme,
}: {
  cfg: LLMConfig
  ledgers: Ledger[]
  ledgerId: number | null
  setLedgerId: (id: number) => void
  theme: 'light' | 'dark'
  toggleTheme: () => void
}) {
  const [draft, setDraft] = useState<LLMConfig>(cfg)
  const [customModel, setCustomModel] = useState(!PRESET_MODELS.includes(cfg.model))
  const [test, setTest] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'fail'; msg: string }>({ kind: 'idle', msg: '' })
  const [saved, setSaved] = useState(false)
  const [ledgerName, setLedgerName] = useState('')
  const [seedStatus, setSeedStatus] = useState<Status>({ kind: 'idle', msg: '' })

  useEffect(() => {
    setDraft(cfg)
    setCustomModel(!PRESET_MODELS.includes(cfg.model))
  }, [cfg])

  const dirty = useMemo(() => JSON.stringify({ ...draft, id: undefined }) !== JSON.stringify({ ...cfg, id: undefined }), [draft, cfg])

  function update(patch: Partial<LLMConfig>) {
    setDraft((prev) => ({ ...prev, ...patch }))
    setSaved(false)
  }

  async function save() {
    await saveLLMConfig(draft)
    setSaved(true)
    setTest({ kind: 'idle', msg: '' })
  }

  async function doTest() {
    setTest({ kind: 'testing', msg: '测试中…' })
    const result = await testConnection(draft)
    setTest({ kind: result.ok ? 'ok' : 'fail', msg: result.message })
  }

  async function addLedger() {
    const name = ledgerName.trim()
    if (!name) return
    const id = await db.ledgers.add({ name, currency: 'CNY', createdAt: Date.now() })
    setLedgerId(id)
    setLedgerName('')
  }

  async function renameLedger(id: number) {
    const next = prompt('新的账本名称？')
    if (next?.trim()) await db.ledgers.update(id, { name: next.trim() })
  }

  async function removeLedger(id: number) {
    if (ledgers.length <= 1) {
      alert('至少保留一个账本。')
      return
    }
    if (!confirm('删除该账本及其全部账单？此操作不可恢复。')) return
    await db.transactions.where('ledgerId').equals(id).delete()
    await db.ledgers.delete(id)
    const next = ledgers.find((l) => l.id !== id)
    if (next?.id != null) setLedgerId(next.id)
  }

  async function clearAll() {
    if (!confirm('确认清空全部本地数据（账本、账单、标签、配置）？此操作不可恢复。')) return
    await Promise.all([
      db.transactions.clear(),
      db.ledgers.clear(),
      db.tags.clear(),
      db.merchantMemory.clear(),
      db.llmConfig.clear(),
    ])
    location.reload()
  }

  async function seedDemoLedger() {
    setSeedStatus({ kind: 'working', msg: '正在生成演示账本…' })
    try {
      const { seedData } = await import('../lib/seed')
      const result = await seedData()
      setLedgerId(result.ledgerId)
      setSeedStatus({ kind: 'done', msg: `已生成 ${result.total} 条演示流水，可切到复核和流水区验证。` })
    } catch (e) {
      setSeedStatus({ kind: 'error', msg: `生成失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <div className="control-flow">
      <div className="control-columns">
        <div>
          <div className="eyebrow">LLM optional</div>
          <div className="control-line">
            <span>大模型</span>
            <button type="button" onClick={() => update({ enabled: !draft.enabled })} className={`switch-line ${draft.enabled ? 'is-on' : ''}`}>
              {draft.enabled ? '已启用' : '未启用'}
            </button>
          </div>
          {draft.enabled && (
            <div className="control-stack">
              <input type="password" value={draft.apiKey} onChange={(e) => update({ apiKey: e.target.value })} placeholder="API Key" className="story-input" />
              <input value={draft.baseURL} onChange={(e) => update({ baseURL: e.target.value })} placeholder="Base URL" className="story-input" />
              <div className="control-row">
                {!customModel ? (
                  <select value={draft.model} onChange={(e) => update({ model: e.target.value })} className="story-input">
                    {PRESET_MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input value={draft.model} onChange={(e) => update({ model: e.target.value })} placeholder="自定义模型" className="story-input" />
                )}
                <button onClick={() => setCustomModel((v) => !v)} className="story-action story-action-muted">{customModel ? '选预设' : '自定义'}</button>
              </div>
              <div className="control-row">
                <button onClick={doTest} disabled={test.kind === 'testing'} className="story-action">测试连接</button>
                <button onClick={save} disabled={!dirty} className="story-action">保存配置</button>
              </div>
              {test.kind !== 'idle' && <div className={`inline-status inline-status-${test.kind === 'ok' ? 'done' : test.kind === 'fail' ? 'error' : 'working'}`}>{test.msg}</div>}
              {saved && <div className="inline-status inline-status-done">已保存</div>}
            </div>
          )}
        </div>

        <div>
          <div className="eyebrow">Ledgers</div>
          <div className="control-row">
            <input value={ledgerName} onChange={(e) => setLedgerName(e.target.value)} placeholder="新建账本名称" className="story-input" />
            <button onClick={addLedger} className="story-action">新建</button>
          </div>
          <div className="ledger-lines">
            {ledgers.map((ledger) => (
              <div key={ledger.id} className={ledger.id === ledgerId ? 'is-current' : ''}>
                <button onClick={() => ledger.id != null && setLedgerId(ledger.id)}>{ledger.name}</button>
                <span>{ledger.id === ledgerId ? '当前' : '账本'}</span>
                <button onClick={() => renameLedger(ledger.id!)} className="mini-action">改名</button>
                <button onClick={() => removeLedger(ledger.id!)} className="mini-action">删除</button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="eyebrow">Boundaries</div>
          <div className="control-stack">
            {import.meta.env.DEV && (
              <button onClick={seedDemoLedger} disabled={seedStatus.kind === 'working'} className="story-action">
                {seedStatus.kind === 'working' ? '生成中…' : '生成演示数据'}
              </button>
            )}
            <button onClick={toggleTheme} className="story-action">{theme === 'dark' ? '切换浅色' : '切换深色'}</button>
            <button onClick={clearAll} className="story-action story-action-danger">清空全部本地数据</button>
            {seedStatus.kind !== 'idle' && <div className={`inline-status inline-status-${seedStatus.kind}`}>{seedStatus.msg}</div>}
            <p className="privacy-copy">API Key 仅保存在当前浏览器 IndexedDB 中，不上传到服务器，也未加密。公共电脑上不要保存。</p>
          </div>
        </div>
      </div>
    </div>
  )
}
