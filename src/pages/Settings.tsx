import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getLLMConfig, saveLLMConfig } from '../db/db'
import { testConnection } from '../lib/llm'
import type { LLMConfig } from '../types'

const PRESET_MODELS = ['gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet', 'deepseek-chat', 'qwen-plus', 'glm-4-flash']

/** 根据“已保存”的配置推导大模型实际可用状态 */
type LLMState = 'off' | 'incomplete' | 'ready'
function deriveState(cfg: LLMConfig | undefined): LLMState {
  if (!cfg || !cfg.enabled) return 'off'
  if (!cfg.apiKey.trim()) return 'incomplete'
  return 'ready'
}

export default function Settings() {
  const stored = useLiveQuery(() => getLLMConfig(), [])
  const [cfg, setCfg] = useState<LLMConfig | null>(null)
  const [test, setTest] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'fail'; msg: string }>({ kind: 'idle', msg: '' })
  const [saved, setSaved] = useState(false)
  const [customModel, setCustomModel] = useState(false)

  useEffect(() => {
    if (stored && !cfg) {
      setCfg(stored)
      setCustomModel(!PRESET_MODELS.includes(stored.model))
    }
  }, [stored, cfg])

  // 草稿与已保存配置的差异（用于“未保存更改”提示）
  const dirty = useMemo(() => {
    if (!cfg || !stored) return false
    return JSON.stringify({ ...cfg, id: undefined }) !== JSON.stringify({ ...stored, id: undefined })
  }, [cfg, stored])

  if (!cfg) return <div className="text-[var(--muted)]">加载中…</div>

  const savedState = deriveState(stored)
  const draftKeyMissing = cfg.enabled && !cfg.apiKey.trim()

  const update = (patch: Partial<LLMConfig>) => {
    setCfg({ ...cfg, ...patch })
    setSaved(false)
  }

  const save = async () => {
    await saveLLMConfig(cfg)
    setSaved(true)
    setTest({ kind: 'idle', msg: '' })
  }

  const doTest = async () => {
    setTest({ kind: 'testing', msg: '测试中…' })
    const r = await testConnection(cfg)
    setTest({ kind: r.ok ? 'ok' : 'fail', msg: r.message })
  }

  return (
    <div className="space-y-7">
      <header className="surface p-6 md:p-8">
        <div className="eyebrow">Controls</div>
        <h1 className="page-title mt-3">只打开你需要的能力。</h1>
        <p className="page-lede mt-5">默认状态下它就是一个纯本地账本。大模型、导出和数据清理都放在这里，避免在日常记账界面里持续打扰。</p>
      </header>

      <section className="surface max-w-3xl space-y-5 p-5">
        {/* 标题 + 状态徽章 + 开关 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="display text-2xl">大模型</span>
              <StateBadge state={savedState} />
            </div>
            <div className="mt-2 text-sm leading-6 text-[var(--muted)]">可选功能。接入后解锁：账单截图识别、非内置格式 CSV 解析、交易智能分类。</div>
          </div>
          <Toggle checked={cfg.enabled} onChange={(v) => update({ enabled: v })} />
        </div>

        {/* 关闭时折叠配置，避免干扰 */}
        {cfg.enabled && (
          <div className="space-y-4 border-t border-[var(--line)] pt-4">
            <Field label="API Key">
              <input
                type="password"
                value={cfg.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder="sk-..."
                className={`${inputCls} ${draftKeyMissing ? 'border-[var(--brass)]' : ''}`}
              />
              {draftKeyMissing && (
                <span className="mt-2 block text-xs text-[var(--brass)]">
                  启用大模型需要填写 API Key，否则相关功能不会生效。
                </span>
              )}
            </Field>
            <Field label="Base URL">
              <input value={cfg.baseURL} onChange={(e) => update({ baseURL: e.target.value })} placeholder="https://api.openai.com/v1" className={inputCls} />
            </Field>
            <Field label="模型">
              <div className="flex gap-2">
                {!customModel ? (
                  <select value={cfg.model} onChange={(e) => update({ model: e.target.value })} className={inputCls}>
                    {PRESET_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={cfg.model} onChange={(e) => update({ model: e.target.value })} placeholder="自定义模型名" className={inputCls} />
                )}
                <button
                  onClick={() => setCustomModel((v) => !v)}
                  className="btn btn-ghost whitespace-nowrap"
                >
                  {customModel ? '选预设' : '自定义'}
                </button>
              </div>
            </Field>

            <button
              onClick={doTest}
              disabled={test.kind === 'testing'}
              className="btn btn-ghost disabled:opacity-50"
            >
              测试连接
            </button>
            {test.kind !== 'idle' && (
              <span className={`ml-3 text-sm ${test.kind === 'ok' ? 'text-[var(--jade)]' : test.kind === 'fail' ? 'text-[var(--rose)]' : 'text-[var(--muted)]'}`}>
                {test.msg}
              </span>
            )}
          </div>
        )}

        {/* 底部操作栏：未保存提示 + 保存 */}
        <div className="flex items-center justify-between border-t border-[var(--line)] pt-4">
          <span className="text-xs">
            {dirty ? (
              <span className="text-[var(--brass)]">● 有未保存的更改</span>
            ) : saved ? (
              <span className="text-[var(--jade)]">✓ 已保存</span>
            ) : (
              <span className="text-[var(--muted)]">配置已是最新</span>
            )}
          </span>
          <button
            onClick={save}
            disabled={!dirty}
            className="btn btn-primary disabled:opacity-40"
          >
            保存
          </button>
        </div>

        <p className="rounded-[8px] border border-[var(--line)] bg-[var(--surface-solid)] p-3 text-xs leading-5 text-[var(--muted)]">
          API Key 仅保存在你当前浏览器的本地数据库（IndexedDB）中，不会上传到任何服务器，也未加密。请勿在公共电脑上保存。
        </p>
      </section>

      <LedgerManager />

      <DataManager />
    </div>
  )
}

function StateBadge({ state }: { state: LLMState }) {
  const map: Record<LLMState, { label: string; cls: string }> = {
    off: { label: '未启用', cls: 'text-[var(--muted)]' },
    incomplete: { label: '待填写 Key', cls: 'text-[var(--brass)]' },
    ready: { label: '已启用', cls: 'text-[var(--jade)]' },
  }
  const { label, cls } = map[state]
  return <span className={`pill ${cls}`}>{label}</span>
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
        checked ? 'border-[var(--tide)] bg-[var(--tide)]' : 'border-[var(--line)] bg-[var(--paper-deep)]'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-[var(--surface-raised)] shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function LedgerManager() {
  const ledgers = useLiveQuery(() => db.ledgers.toArray(), [])
  const [name, setName] = useState('')

  const add = async () => {
    const n = name.trim()
    if (!n) return
    await db.ledgers.add({ name: n, currency: 'CNY', createdAt: Date.now() })
    setName('')
  }
  const rename = async (id: number) => {
    const n = prompt('新的账本名称？')
    if (n?.trim()) await db.ledgers.update(id, { name: n.trim() })
  }
  const remove = async (id: number) => {
    if ((ledgers?.length ?? 0) <= 1) {
      alert('至少保留一个账本。')
      return
    }
    if (!confirm('删除该账本及其全部账单？此操作不可恢复。')) return
    await db.transactions.where('ledgerId').equals(id).delete()
    await db.ledgers.delete(id)
  }

  return (
    <section className="surface max-w-3xl space-y-4 p-5">
      <div>
        <div className="eyebrow">Ledgers</div>
        <h2 className="display mt-1 text-2xl">账本管理</h2>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新建账本名称" className={inputCls} />
        <button onClick={add} className="btn btn-primary">
          新建
        </button>
      </div>
      <div className="space-y-2">
        {ledgers?.map((l) => (
          <div key={l.id} className="surface-flat flex items-center justify-between px-3 py-2 text-sm">
            <span>{l.name}</span>
            <div className="flex gap-3">
              <button onClick={() => rename(l.id!)} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
                重命名
              </button>
              <button onClick={() => remove(l.id!)} className="text-xs text-[var(--muted)] hover:text-[var(--rose)]">
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function DataManager() {
  const clearAll = async () => {
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

  return (
    <section className="surface max-w-3xl space-y-3 border-[color-mix(in_oklch,var(--rose)_36%,transparent)] p-5">
      <div>
        <div className="eyebrow text-[var(--rose)]">Danger zone</div>
        <h2 className="display mt-1 text-2xl text-[var(--rose)]">数据管理</h2>
      </div>
      <p className="text-xs leading-5 text-[var(--muted)]">所有数据均存储在本地浏览器中。清除浏览器数据会导致账单丢失，重要数据请定期导出 Excel。</p>
      <button onClick={clearAll} className="btn btn-danger">
        清空全部数据
      </button>
    </section>
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
