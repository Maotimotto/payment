import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getLLMConfig } from '../db/db'
import { useApp } from '../store/app'
import {
  readFileSmart,
  parseBuiltin,
  parseGenericRows,
  PLATFORM_LABELS,
  type BuiltinPlatform,
} from '../lib/csv'
import { parseImage, parseCsvWithLLM } from '../lib/llm'
import { bocPdfToCsv, PdfPasswordError } from '../lib/pdf'
import { ingestDrafts } from '../lib/ingest'
import { detectDuplicates, detectRefundOffsets, type DuplicatePair, type RefundPair } from '../lib/dedup'
import { RefundOffsetPanel } from '../components/RefundOffsetPanel'
import { FlowMotion } from '../components/FlowMotion'
import { ThemedIcon } from '../components/ThemedIcon'
import { formatDate, formatMoney } from '../lib/format'
import type { DraftTransaction, Direction } from '../types'

type Status = { kind: 'idle' | 'working' | 'done' | 'error'; msg: string }

export default function ImportPage() {
  const { ledgerId } = useApp()
  const llmCfg = useLiveQuery(() => getLLMConfig(), [])
  const [status, setStatus] = useState<Status>({ kind: 'idle', msg: '' })
  const [pairs, setPairs] = useState<DuplicatePair[]>([])
  const [refunds, setRefunds] = useState<RefundPair[]>([])
  const [source, setSource] = useState<'auto' | BuiltinPlatform>('auto')
  // 加密 PDF 待输入密码的状态
  const [pendingPdf, setPendingPdf] = useState<File | null>(null)
  const [pdfPwd, setPdfPwd] = useState('')
  const [pdfWrong, setPdfWrong] = useState(false)

  const llmReady = !!llmCfg?.enabled && !!llmCfg?.apiKey

  async function afterIngest(count: number) {
    if (ledgerId == null) return
    const all = await db.transactions
      .where('ledgerId')
      .equals(ledgerId)
      .filter((t) => t.dedupStatus === 'none')
      .toArray()
    const found = detectDuplicates(all)
    setPairs(found)
    const refundFound = detectRefundOffsets(all)
    setRefunds(refundFound)
    const extras = [
      found.length > 0 ? `${found.length} 组疑似重复` : '',
      refundFound.length > 0 ? `${refundFound.length} 组退款抵消` : '',
    ].filter(Boolean)
    setStatus({
      kind: 'done',
      msg: `已导入 ${count} 笔${extras.length > 0 ? `，检测到 ${extras.join('、')}，请在下方确认` : '，未发现疑似重复或退款抵消'}`,
    })
  }

  /** 文本（CSV）→ 解析 → 入库。forced 指定来源平台时跳过自动识别 */
  async function runImport(text: string, forced?: BuiltinPlatform) {
    if (ledgerId == null) return
    const builtin = parseBuiltin(text, forced)
    let drafts: DraftTransaction[]
    let useLLM = false
    if (builtin) {
      drafts = builtin.drafts
      setStatus({ kind: 'working', msg: `识别为${PLATFORM_LABELS[builtin.platform]}账单，解析到 ${drafts.length} 笔，分类中…` })
    } else if (forced) {
      setStatus({
        kind: 'error',
        msg: `按「${PLATFORM_LABELS[forced]}」模板未解析到有效记录。请确认所选来源与文件是否一致，或改用「自动识别」。`,
      })
      return
    } else if (llmReady) {
      const cfg = await getLLMConfig()
      const rows = parseGenericRows(text)
      setStatus({ kind: 'working', msg: '未匹配内置模板，使用大模型解析中…' })
      drafts = await parseCsvWithLLM(cfg, rows)
      useLLM = true
    } else {
      setStatus({
        kind: 'error',
        msg: '未能识别该账单格式，且未启用大模型。请改用微信/支付宝/招行/中国银行账单，或在设置中接入大模型，或手动录入。',
      })
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
  }

  /** 入口：按文件类型分流（CSV / PDF） */
  function handleFile(file: File) {
    if (/\.pdf$/i.test(file.name)) processPdf(file)
    else handleCsv(file)
  }

  async function handleCsv(file: File) {
    if (ledgerId == null) return
    setStatus({ kind: 'working', msg: '正在解析 CSV…' })
    try {
      const text = await readFileSmart(file)
      await runImport(text, source === 'auto' ? undefined : source)
    } catch (e) {
      setStatus({ kind: 'error', msg: `解析失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }

  /** 解析中国银行 PDF（含加密）。密码缺失/错误时弹出输入框 */
  async function processPdf(file: File, password?: string) {
    if (ledgerId == null) return
    setStatus({ kind: 'working', msg: '正在解析 PDF…' })
    try {
      const csv = await bocPdfToCsv(file, password)
      setPendingPdf(null)
      setPdfPwd('')
      setPdfWrong(false)
      await runImport(csv, 'boc')
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setPendingPdf(file)
        setPdfWrong(e.wrong)
        setStatus({ kind: 'idle', msg: '' })
        return
      }
      setStatus({ kind: 'error', msg: `解析失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }

  async function handleImage(file: File) {
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
  }

  async function mergePair(pair: DuplicatePair, action: 'merge' | 'ignore') {
    const groupId = `dg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    if (action === 'merge') {
      // 保留较早的一条，另一条标记为已合并且不计入统计
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
    setPairs((prev) => prev.filter((p) => p !== pair))
  }

  return (
    <div className="space-y-7">
      <header className="surface p-6 md:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-center">
          <div>
            <div className="eyebrow">Import deck</div>
            <h1 className="page-title mt-3">把账单带回本地。</h1>
            <p className="page-lede mt-5">
              归集只是第一步。汐账会把零散流水整理成可复盘的状态反馈，帮助你看见工作回报和消耗节奏，而不是把账单变成新的负担。
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {llmReady ? (
                <span className="pill text-[var(--jade)]">
                  <span className="dot" />
                  LLM ready
                </span>
              ) : (
                <Link to="/settings" className="pill transition hover:border-[var(--brass)]">
                  <span className="dot" />
                  LLM optional
                </Link>
              )}
              <span className="pill">Local vault</span>
            </div>
          </div>
          <FlowMotion variant="import" status={status.kind} className="justify-self-end" />
        </div>
      </header>

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="import-pipeline">
          <div className="dropzone-panel">
            <div className="flex items-start justify-between gap-5">
              <div>
                <div className="eyebrow">Primary path</div>
                <h2 className="display mt-2 text-3xl">选择账单文件</h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted)]">
                  微信、支付宝、银行 CSV/PDF 会先走本地规则。导入的意义不是把生活塞进表格，而是让一段时间的工作回报和消耗节奏变得可复盘。
                </p>
              </div>
              <ThemedIcon name="bank" className="source-glyph" />
            </div>

            <div className="mt-6 grid gap-3 lg:grid-cols-[220px_auto] lg:items-end">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-[var(--muted)]">来源模板</span>
                <select value={source} onChange={(e) => setSource(e.target.value as 'auto' | BuiltinPlatform)} className="select-field">
                  <option value="auto">自动识别</option>
                  <option value="wechat">{PLATFORM_LABELS.wechat}</option>
                  <option value="alipay">{PLATFORM_LABELS.alipay}</option>
                  <option value="cmb">{PLATFORM_LABELS.cmb}</option>
                  <option value="boc">{PLATFORM_LABELS.boc}</option>
                </select>
              </label>
              <label className="btn btn-primary lg:justify-self-start">
                选择 CSV / PDF
                <input
                  type="file"
                  accept=".csv,text/csv,.pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFile(e.target.files[0])
                    e.target.value = ''
                  }}
                />
              </label>
            </div>

            <div className="pipeline-steps mt-7">
              <span>识别来源</span>
              <span>解析流水</span>
              <span>分类入账</span>
              <span>待你复核</span>
            </div>

            {pendingPdf && (
              <div className="mt-5 rounded-[8px] border border-[var(--brass)] bg-[color-mix(in_oklch,var(--brass)_10%,var(--surface-solid))] p-3">
                <div className="text-xs font-semibold text-[var(--ink)]">「{pendingPdf.name}」已加密，请输入 PDF 密码</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    type="password"
                    autoFocus
                    value={pdfPwd}
                    onChange={(e) => setPdfPwd(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && pdfPwd && processPdf(pendingPdf, pdfPwd)}
                    placeholder="账单密码"
                    className="field"
                  />
                  <button onClick={() => pdfPwd && processPdf(pendingPdf, pdfPwd)} className="btn btn-primary">
                    解锁
                  </button>
                  <button
                    onClick={() => {
                      setPendingPdf(null)
                      setPdfPwd('')
                      setPdfWrong(false)
                    }}
                    className="btn btn-ghost"
                  >
                    取消
                  </button>
                </div>
                {pdfWrong && <div className="mt-2 text-xs text-[var(--rose)]">密码错误，请重试。</div>}
              </div>
            )}

            {status.kind !== 'idle' && <div className={`mt-5 rounded-[8px] border p-4 text-sm ${statusClass(status.kind)}`}>{status.msg}</div>}
          </div>

          <div className="support-sources">
            <div className="source-strip">
              <ThemedIcon name="image" className="source-glyph" />
              <div className="min-w-0 flex-1">
                <div className="eyebrow">Screenshot</div>
                <div className="display mt-1 text-xl">临时截图补录</div>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  {llmReady ? '适合临时账单截图，识别后仍进入复核。' : '需启用大模型后才能使用。'}
                </p>
              </div>
              <label className={`btn ${llmReady ? 'btn-ghost' : 'btn-ghost opacity-50'}`}>
                图片
                <input
                  type="file"
                  accept="image/*"
                  disabled={!llmReady}
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleImage(e.target.files[0])}
                />
              </label>
            </div>
          </div>
        </div>

        <ManualEntry onDone={(c) => afterIngest(c)} />
      </section>

      {pairs.length > 0 && (
        <section className="surface p-5">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <div className="eyebrow">Review required</div>
              <h2 className="display mt-1 text-2xl">疑似重复 {pairs.length} 组</h2>
            </div>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {pairs.map((p, i) => (
              <div key={i} className="surface-flat p-3 text-sm">
                <DupRow label="A" t={p.a} />
                <DupRow label="B" t={p.b} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => mergePair(p, 'merge')} className="btn btn-primary !min-h-0 !py-1.5 text-xs">
                    合并较早一条
                  </button>
                  <button onClick={() => mergePair(p, 'ignore')} className="btn btn-ghost !min-h-0 !py-1.5 text-xs">
                    不是重复
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {refunds.length > 0 && <RefundOffsetPanel pairs={refunds} onUpdate={setRefunds} />}
    </div>
  )
}

function statusClass(kind: Status['kind']) {
  if (kind === 'error') return 'border-[color-mix(in_oklch,var(--rose)_48%,transparent)] bg-[color-mix(in_oklch,var(--rose)_9%,var(--surface-solid))] text-[var(--rose)]'
  if (kind === 'done') return 'border-[color-mix(in_oklch,var(--jade)_48%,transparent)] bg-[color-mix(in_oklch,var(--jade)_9%,var(--surface-solid))] text-[var(--tide)]'
  return 'border-[var(--line)] bg-[var(--surface-solid)] text-[var(--muted)]'
}

function DupRow({ label, t }: { label: string; t: DuplicatePair['a'] }) {
  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 py-1">
      <span className="display text-lg text-[var(--brass)]">{label}</span>
      <div className="min-w-0">
        <div className="truncate font-semibold">{t.merchant}</div>
        <div className="mt-0.5 text-xs text-[var(--muted)]">
          {formatDate(t.occurredAt)} · {t.source}
        </div>
      </div>
      <span className="font-[var(--font-num)] text-base">¥ {formatMoney(t.amount)}</span>
    </div>
  )
}

function ManualEntry({ onDone }: { onDone: (count: number) => void }) {
  const { ledgerId } = useApp()
  const tags = useLiveQuery(() => db.tags.toArray(), [])
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<Direction>('expense')
  const [datetime, setDatetime] = useState(() => new Date().toISOString().slice(0, 16))
  const [merchant, setMerchant] = useState('')
  const [payment, setPayment] = useState('')
  const [note, setNote] = useState('')

  const sortedTags = useMemo(() => tags ?? [], [tags])

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
    setNote('')
    onDone(count)
  }

  return (
    <div className="surface p-5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="flex items-start gap-3">
          <ThemedIcon name="manual" className="source-glyph mt-1" />
          <span>
            <span className="eyebrow">Manual</span>
            <span className="display mt-1 block text-2xl">手动录入</span>
          </span>
        </span>
        <span className="text-xl text-[var(--brass)]">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-5 grid grid-cols-1 gap-3">
          <Field label="金额">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="0.00" />
          </Field>
          <Field label="方向">
            <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)} className={inputCls}>
              <option value="expense">支出</option>
              <option value="income">收入</option>
            </select>
          </Field>
          <Field label="时间">
            <input type="datetime-local" value={datetime} onChange={(e) => setDatetime(e.target.value)} className={inputCls} />
          </Field>
          <Field label="商户 / 描述">
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className={inputCls} list="tag-hint" />
          </Field>
          <Field label="支付方式">
            <input value={payment} onChange={(e) => setPayment(e.target.value)} className={inputCls} placeholder="微信 / 支付宝 / 现金" />
          </Field>
          <Field label="备注">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </Field>
          <div>
            <button onClick={submit} className="btn btn-primary w-full">
              添加记录
              <span className="text-current/60">/{sortedTags.length} tags</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls = 'field'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold text-[var(--muted)]">{label}</span>
      {children}
    </label>
  )
}
