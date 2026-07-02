import { db, getLLMConfig } from '../db/db'
import type { DraftTransaction, LLMConfig, Tag, Transaction } from '../types'
import { classifyBatch, classifyOpenBatch } from './llm'
import { isExcludedFromStats } from './tags'
import { normalizeMerchant, resolveTagIdByName, ruleClassifyName } from './classify'

export interface IngestProgress {
  stage: string
  done: number
  total: number
}

const BATCH = 50

/**
 * 把草稿条目归类并入库。
 * 分类优先级：商户记忆 -> （可用时）LLM 分批 -> 本地规则。
 */
export async function ingestDrafts(
  ledgerId: number,
  drafts: DraftTransaction[],
  opts: { useLLM: boolean; onProgress?: (p: IngestProgress) => void } = { useLLM: false },
): Promise<number> {
  const tags = await db.tags.toArray()
  const memory = await db.merchantMemory.toArray()
  const memMap = new Map(memory.map((m) => [m.merchant, m.tagId]))
  const cfg = await getLLMConfig()
  const canLLM = opts.useLLM && cfg.enabled && !!cfg.apiKey

  const tagNames = tags.map((t) => t.name)
  const tagIds: (number | null)[] = new Array(drafts.length).fill(null)

  // 1) 商户记忆 + 规则预分类
  const needLLMIndex: number[] = []
  drafts.forEach((d, i) => {
    const memHit = memMap.get(normalizeMerchant(d.merchant))
    if (memHit != null) {
      tagIds[i] = memHit
      return
    }
    const ruleName = ruleClassifyName(d)
    if (ruleName) {
      tagIds[i] = resolveTagIdByName(ruleName, tags)
    } else if (canLLM) {
      needLLMIndex.push(i)
    } else {
      tagIds[i] = resolveTagIdByName('其他', tags)
    }
  })

  // 2) LLM 分批分类（仅对规则未命中的条目）
  if (canLLM && needLLMIndex.length > 0) {
    for (let start = 0; start < needLLMIndex.length; start += BATCH) {
      const slice = needLLMIndex.slice(start, start + BATCH)
      opts.onProgress?.({
        stage: 'LLM 分类中',
        done: start,
        total: needLLMIndex.length,
      })
      try {
        const items = slice.map((idx) => ({
          merchant: drafts[idx].merchant,
          amount: drafts[idx].amount,
          direction: drafts[idx].direction,
        }))
        const names = await classifyBatch(cfg, items, tagNames)
        slice.forEach((idx, k) => {
          const name = names[k]
          tagIds[idx] = resolveTagIdByName(name, tags) ?? resolveTagIdByName('其他', tags)
        })
      } catch {
        // LLM 失败：降级到本地规则/其他
        slice.forEach((idx) => {
          const ruleName = ruleClassifyName(drafts[idx])
          tagIds[idx] = resolveTagIdByName(ruleName ?? '其他', tags)
        })
      }
    }
  }

  // 3) 组装并入库
  const now = Date.now()
  const records: Transaction[] = drafts.map((d, i) => {
    const tagId = tagIds[i]
    const excluded = isExcludedFromStats(tagId, tags)
    const countInStats = !excluded && d.note !== '不计收支'
    return {
      ledgerId,
      amount: d.amount,
      direction: d.direction,
      occurredAt: d.occurredAt,
      merchant: d.merchant,
      source: d.source,
      paymentMethod: d.paymentMethod,
      tagId,
      note: d.note,
      countInStats,
      comboGroupId: d.comboGroupId ?? null,
      dedupStatus: 'none',
      dedupGroupId: null,
      raw: d.raw,
      createdAt: now,
    }
  })

  await db.transactions.bulkAdd(records)
  opts.onProgress?.({ stage: '完成', done: drafts.length, total: drafts.length })
  return records.length
}

/** 用户手动修改标签时记忆该商户分类，并同步是否计入统计 */
export async function updateTransactionTag(
  txId: number,
  tagId: number | null,
  tags: Tag[],
): Promise<void> {
  const tx = await db.transactions.get(txId)
  if (!tx) return
  const excluded = isExcludedFromStats(tagId, tags)
  await db.transactions.update(txId, {
    tagId,
    countInStats: !excluded && tx.note !== '不计收支',
  })
  if (tagId != null && tx.merchant) {
    const key = normalizeMerchant(tx.merchant)
    if (key) {
      const existing = await db.merchantMemory.where('merchant').equals(key).first()
      if (existing?.id != null) await db.merchantMemory.update(existing.id, { tagId })
      else await db.merchantMemory.add({ merchant: key, tagId })
    }
  }
}

/** 取得标签 id：命中现有标签直接返回，否则新建一级标签并写库（投资自动带 investment 语义） */
async function resolveOrCreateTagId(
  name: string,
  tags: Tag[],
  created: string[],
): Promise<number | null> {
  const existing = resolveTagIdByName(name, tags)
  if (existing != null) return existing
  const special = name === '投资' ? 'investment' : null
  const id = await db.tags.add({ name, parentId: null, preset: false, special })
  tags.push({ id, name, parentId: null, preset: false, special })
  created.push(name)
  return id
}

export interface AiTagResult {
  tagged: number
  created: string[]
}

/**
 * 用大模型根据「商户/描述」为给定交易打标签：
 * 命中现有标签直接套用，未命中则新建标签并写入标签列表；自动区分“投资”。
 */
export async function aiTagTransactions(
  cfg: LLMConfig,
  txs: Transaction[],
  onProgress?: (p: IngestProgress) => void,
): Promise<AiTagResult> {
  if (txs.length === 0) return { tagged: 0, created: [] }
  const tags = await db.tags.toArray()
  const created: string[] = []
  let tagged = 0

  const AI_BATCH = 25
  const batchCount = Math.ceil(txs.length / AI_BATCH)
  for (let start = 0; start < txs.length; start += AI_BATCH) {
    const slice = txs.slice(start, start + AI_BATCH)
    const batchNo = Math.floor(start / AI_BATCH) + 1
    onProgress?.({ stage: `正在请求大模型（第 ${batchNo}/${batchCount} 批）`, done: start, total: txs.length })
    const names = await classifyOpenBatch(
      cfg,
      slice.map((t) => ({ merchant: t.merchant, note: t.note, amount: t.amount, direction: t.direction })),
      tags.map((t) => t.name),
    )
    onProgress?.({ stage: '正在写入标签', done: start, total: txs.length })
    for (let k = 0; k < slice.length; k++) {
      const t = slice[k]
      const name = names[k]
      if (!name) continue
      const tagId = await resolveOrCreateTagId(name, tags, created)
      if (tagId == null) continue
      const excluded = isExcludedFromStats(tagId, tags)
      await db.transactions.update(t.id!, { tagId, countInStats: !excluded && t.note !== '不计收支' })
      const key = normalizeMerchant(t.merchant)
      if (key) {
        const existing = await db.merchantMemory.where('merchant').equals(key).first()
        if (existing?.id != null) await db.merchantMemory.update(existing.id, { tagId })
        else await db.merchantMemory.add({ merchant: key, tagId })
      }
      tagged++
    }
    onProgress?.({ stage: '正在写入标签', done: Math.min(start + slice.length, txs.length), total: txs.length })
  }
  onProgress?.({ stage: '完成', done: txs.length, total: txs.length })
  return { tagged, created: [...new Set(created)] }
}
