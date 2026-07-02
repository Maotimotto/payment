import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getLLMConfig } from '../db/db'
import { useApp } from '../store/app'
import { useAiTag } from '../store/aiTag'
import { formatDate, formatMoney, monthKey } from '../lib/format'
import { tagFullName } from '../lib/tags'
import { updateTransactionTag } from '../lib/ingest'
import { exportTransactionsToExcel } from '../lib/export'
import { detectRefundOffsets, type RefundPair } from '../lib/dedup'
import { RefundOffsetPanel } from '../components/RefundOffsetPanel'
import { FlowMotion } from '../components/FlowMotion'
import type { Tag, Transaction } from '../types'

type ViewKey = 'all' | 'current' | 'uncategorized' | 'excluded' | 'merged' | 'combo' | 'large'

export default function Transactions() {
  const { ledgerId } = useApp()
  const tags = useLiveQuery(() => db.tags.toArray(), [])
  const ledgers = useLiveQuery(() => db.ledgers.toArray(), [])
  const llmCfg = useLiveQuery(() => getLLMConfig(), [])
  const llmReady = !!llmCfg?.enabled && !!llmCfg?.apiKey
  const txs = useLiveQuery(
    () =>
      ledgerId != null
        ? db.transactions.where('ledgerId').equals(ledgerId).reverse().sortBy('occurredAt')
        : Promise.resolve([] as Transaction[]),
    [ledgerId],
  )

  const [keyword, setKeyword] = useState('')
  const [dir, setDir] = useState<'all' | 'income' | 'expense'>('all')
  const [tagFilter, setTagFilter] = useState<number | 'all'>('all')
  const [month, setMonth] = useState<string>('all')
  const [view, setView] = useState<ViewKey>('current')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [refundPairs, setRefundPairs] = useState<RefundPair[] | null>(null)
  const { running: aiRunning, progress: aiProgress, message: aiMsg, run: runAiTag } = useAiTag()

  const months = useMemo(() => {
    if (!txs) return []
    const set = new Set<string>()
    txs.forEach((t) => set.add(monthKey(t.occurredAt)))
    return [...set].sort().reverse()
  }, [txs])

  const filtered = useMemo(() => {
    if (!txs) return []
    const currentMonth = monthKey(Date.now())
    return txs.filter((t) => {
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
        if (!hay.includes(k)) {
          const asNum = parseFloat(keyword)
          if (!(Number.isFinite(asNum) && Math.abs(t.amount - asNum) < 0.001)) return false
        }
      }
      return true
    })
  }, [txs, view, dir, tagFilter, month, keyword])

  const viewCounts = useMemo(() => {
    const list = txs ?? []
    const currentMonth = monthKey(Date.now())
    return {
      all: list.length,
      current: list.filter((t) => monthKey(t.occurredAt) === currentMonth).length,
      uncategorized: list.filter((t) => t.tagId == null).length,
      excluded: list.filter((t) => !t.countInStats && t.dedupStatus !== 'merged').length,
      merged: list.filter((t) => t.dedupStatus === 'merged').length,
      combo: list.filter((t) => t.comboGroupId).length,
      large: list.filter((t) => t.direction === 'expense' && t.amount >= 500).length,
    } satisfies Record<ViewKey, number>
  }, [txs])

  if (!txs || !tags) return <div className="text-[var(--muted)]">加载中…</div>

  const toggleSel = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const batchDelete = async () => {
    if (selected.size === 0) return
    if (!confirm(`确认删除选中的 ${selected.size} 笔？`)) return
    await db.transactions.bulkDelete([...selected])
    setSelected(new Set())
  }

  const doExport = () => {
    const ledgerName = ledgers?.find((l) => l.id === ledgerId)?.name ?? '账本'
    exportTransactionsToExcel(filtered, tags, ledgerName)
  }

  const scanRefunds = () => setRefundPairs(detectRefundOffsets(txs ?? []))

  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id!))
  const someSelected = selected.size > 0 && !allSelected
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered.map((t) => t.id!)))
  }

  // AI 打标签：有勾选则处理勾选项，否则处理当前筛选下的未分类项
  const uncategorized = filtered.filter((t) => t.tagId == null)
  const startAiTag = (targets: Transaction[]) => {
    if (!llmReady || targets.length === 0 || aiRunning) return
    runAiTag(targets)
  }
  const aiTagBatch = () => {
    const targets = selected.size > 0 ? filtered.filter((t) => selected.has(t.id!)) : uncategorized
    if (!llmReady || targets.length === 0 || aiRunning) return
    setSelected(new Set())
    runAiTag(targets)
  }

  const views: { key: ViewKey; label: string }[] = [
    { key: 'current', label: '本月' },
    { key: 'uncategorized', label: '未分类' },
    { key: 'excluded', label: '不计统计' },
    { key: 'merged', label: '已合并' },
    { key: 'combo', label: '组合支付' },
    { key: 'large', label: '大额' },
    { key: 'all', label: '全部' },
  ]

  return (
    <div className="space-y-6">
      <header className="surface p-6 md:p-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div>
            <div className="eyebrow">Ledger workbench</div>
            <h1 className="page-title mt-3">流水校准台</h1>
            <p className="page-lede mt-5">这里用来校准口径，不用久留。把未分类、重复和大额项处理干净，账单就能回到它该在的位置。</p>
          </div>
          <div className="workbench-counter">
            <span className="eyebrow">Showing</span>
            <strong>{filtered.length}</strong>
            <span> / {txs.length} 笔</span>
          </div>
        </div>
      </header>

      <section className="surface p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_auto] xl:items-center">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索商户、备注、支付方式或金额"
            className="field"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={scanRefunds} className="btn btn-ghost">
              检测退款抵消
            </button>
            <button onClick={doExport} className="btn btn-ghost">
              导出 Excel
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {views.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)} className={`view-chip ${view === v.key ? 'view-chip-active' : ''}`}>
              <span>{v.label}</span>
              <span className="font-[var(--font-num)]">{viewCounts[v.key]}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-2 lg:grid-cols-[160px_220px_180px]">
          <select value={dir} onChange={(e) => setDir(e.target.value as typeof dir)} className={selCls}>
            <option value="all">全部收支</option>
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
          <select value={String(tagFilter)} onChange={(e) => setTagFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} className={selCls}>
            <option value="all">全部标签</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {tagFullName(t.id!, tags)}
              </option>
            ))}
          </select>
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={selCls}>
            <option value="all">全部月份</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </section>

      {selected.size > 0 && (
        <section className="selection-bar">
          <div>
            <span className="eyebrow">Selection</span>
            <span className="ml-3 font-[var(--font-num)] text-lg">{selected.size} 笔</span>
          </div>
          <div className="flex flex-wrap gap-2">
          {selected.size > 0 && (
            <button onClick={batchDelete} className="btn btn-danger">
              删除选中 ({selected.size})
            </button>
          )}
          {llmReady ? (
            <button
              onClick={aiTagBatch}
              disabled={aiRunning || (selected.size === 0 && uncategorized.length === 0)}
              className="btn btn-primary disabled:opacity-40"
            >
              {aiRunning && (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
              )}
              {aiRunning
                ? `AI 打标签中…${aiProgress ? ` ${aiProgress.done}/${aiProgress.total}` : ''}`
                : selected.size > 0
                  ? `AI 打标签（选中 ${selected.size}）`
                  : `AI 打标签（未分类 ${uncategorized.length}）`}
            </button>
          ) : (
            <Link
              to="/settings"
              className="btn btn-ghost"
            >
              AI 打标签（需启用大模型）
            </Link>
          )}
          </div>
      </section>
      )}

      {aiProgress && (
        <div className="surface-flat px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--tide)] border-t-transparent" />
            <span className="font-medium">{aiProgress.stage}</span>
            <span className="ml-auto font-[var(--font-num)]">
              {aiProgress.done}/{aiProgress.total}
              {aiProgress.total > 0 && `（${Math.round((aiProgress.done / aiProgress.total) * 100)}%）`}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--tide)_14%,transparent)]">
            <div
              className="h-full rounded-full bg-[var(--tide)] transition-all duration-300"
              style={{ width: `${aiProgress.total > 0 ? (aiProgress.done / aiProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
      {aiMsg && !aiProgress && (
        <div className="surface-flat px-4 py-2 text-sm text-[var(--muted)]">
          {aiMsg}
        </div>
      )}

      {refundPairs != null && (
        <RefundOffsetPanel pairs={refundPairs} onUpdate={setRefundPairs} onClose={() => setRefundPairs(null)} />
      )}

      {txs.length === 0 ? (
        <section className="surface empty-ledger-grid overflow-hidden p-5 md:p-8">
          <FlowMotion variant="empty" />
          <div>
            <div className="eyebrow">No entries yet</div>
            <h2 className="display mt-3 text-3xl">先归集，再校准。</h2>
            <p className="page-lede mt-4">
              流水校准台只在你需要整理口径时出现价值。先导入一段账单，让它变成可复盘的状态反馈。
            </p>
            <Link to="/import" className="btn btn-primary mt-6">
              去导入
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      ) : (
        <div className="surface overflow-hidden">
          <div className="scrollbar-thin overflow-auto">
            <table className="data-table min-w-[960px] text-sm">
              <thead>
                <tr>
                  <th className="w-10 p-3">
                    <input
                      type="checkbox"
                      aria-label="全选"
                      title={allSelected ? '取消全选' : '全选当前筛选'}
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected
                      }}
                      onChange={toggleSelectAll}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="p-3">时间</th>
                  <th className="p-3">商户 / 描述</th>
                  <th className="p-3">标签</th>
                  <th className="p-3">支付方式</th>
                  <th className="p-3 text-right">金额</th>
                  <th className="w-16 p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-[var(--muted)]">
                      没有符合条件的记录
                    </td>
                  </tr>
                )}
                {filtered.map((t) => (
                  <Row
                    key={t.id}
                    t={t}
                    tags={tags}
                    selected={selected.has(t.id!)}
                    onToggle={() => toggleSel(t.id!)}
                    llmReady={llmReady}
                    aiRunning={aiRunning}
                    onAiTag={() => startAiTag([t])}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="text-xs text-[var(--muted)]">
        共 {filtered.length} 笔（灰色为已合并/不计入统计的重复项）
      </div>
    </div>
  )
}

function Row({
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
  const onTagChange = async (val: string) => {
    await updateTransactionTag(t.id!, val === '' ? null : Number(val), tags)
  }
  const del = async () => {
    if (confirm('删除这笔记录？')) await db.transactions.delete(t.id!)
  }

  return (
    <tr className={`transition hover:bg-[color-mix(in_oklch,var(--tide)_5%,transparent)] ${merged ? 'opacity-40' : ''}`}>
      <td className="p-3">
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </td>
      <td className="whitespace-nowrap p-3 text-[var(--muted)]">{formatDate(t.occurredAt)}</td>
      <td className="p-3">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{t.merchant}</span>
          {t.comboGroupId && (
            <span className="tag-chip">
              组合支付
            </span>
          )}
          {merged && (
            <span className="tag-chip">已合并</span>
          )}
          {!t.countInStats && !merged && (
            <span className="tag-chip text-[var(--brass)]">
              不计统计
            </span>
          )}
        </div>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-1.5">
          <select
            value={t.tagId ?? ''}
            onChange={(e) => onTagChange(e.target.value)}
            className="select-field max-w-[180px] !px-2 !py-1 text-xs"
          >
            <option value="">
              未分类
            </option>
            {tags.map((tag) => (
              <option
                key={tag.id}
                value={tag.id}
              >
                {tagFullName(tag.id!, tags)}
              </option>
            ))}
          </select>
          {llmReady && (
            <button
              onClick={onAiTag}
              disabled={aiRunning}
              title="用大模型按商户/描述自动打标签"
              className="rounded border border-[var(--line)] px-1.5 py-1 text-[10px] font-bold text-[var(--tide)] hover:border-[var(--brass)] disabled:opacity-40"
            >
              AI
            </button>
          )}
        </div>
      </td>
      <td className="p-3 text-[var(--muted)]">{t.paymentMethod}</td>
      <td className={`p-3 text-right font-[var(--font-num)] text-base ${t.direction === 'income' ? 'amount-income' : 'amount-expense'}`}>
        {t.direction === 'income' ? '+' : '-'} {formatMoney(t.amount)}
      </td>
      <td className="p-3 text-right">
        <button onClick={del} className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--rose)]">
          删除
        </button>
      </td>
    </tr>
  )
}

const selCls = 'select-field'
