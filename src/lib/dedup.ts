import type { Transaction } from '../types'

const REPAY_KEYWORDS = [
  '还款',
  '花呗',
  '信用卡',
  '转账',
  '转入',
  '转出',
  '零钱通',
  '余额宝',
  '理财',
  '赎回',
]

const SECONDS_10 = 10 * 1000
const HOURS_24 = 24 * 60 * 60 * 1000

function looksLikeRepayOrTransfer(t: Transaction): boolean {
  const text = `${t.merchant} ${t.note}`
  return REPAY_KEYWORDS.some((k) => text.includes(k))
}

/** 两条记录是否构成"疑似重复"。双窗口：还款/转账类 ≤24h，普通消费 ≤10s */
function isSuspectedPair(a: Transaction, b: Transaction): boolean {
  if (a.id === b.id) return false
  if (a.direction !== b.direction) return false
  if (Math.abs(a.amount - b.amount) > 0.001) return false
  // 同一组合支付内部不互相去重
  if (a.comboGroupId && b.comboGroupId && a.comboGroupId === b.comboGroupId) return false
  // 已合并/忽略的不再参与
  if (a.dedupStatus === 'merged' || b.dedupStatus === 'merged') return false

  const window =
    looksLikeRepayOrTransfer(a) || looksLikeRepayOrTransfer(b) ? HOURS_24 : SECONDS_10
  return Math.abs(a.occurredAt - b.occurredAt) <= window
}

export interface DuplicatePair {
  a: Transaction
  b: Transaction
}

/** 在给定交易集合中检测疑似重复对（两两比较，O(n^2)，本地数据量可接受） */
export function detectDuplicates(transactions: Transaction[]): DuplicatePair[] {
  const sorted = [...transactions].sort((x, y) => x.occurredAt - y.occurredAt)
  const pairs: DuplicatePair[] = []
  const used = new Set<number>()
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    if (a.id != null && used.has(a.id)) continue
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]
      // 已超过最大窗口可提前结束
      if (b.occurredAt - a.occurredAt > HOURS_24) break
      if (b.id != null && used.has(b.id)) continue
      if (isSuspectedPair(a, b)) {
        pairs.push({ a, b })
        if (a.id != null) used.add(a.id)
        if (b.id != null) used.add(b.id)
        break
      }
    }
  }
  return pairs
}

// ---------- 退款抵消检测 ----------

const REFUND_WINDOW = 90 * 24 * 60 * 60 * 1000
const PLATFORM_PREFIX = /^(财付通|支付宝|抖音支付|微信支付|微信|云闪付|京东支付|银联)[-－\s]*/
const REFUND_WORDS = /(退款|退货|退回|返还|售后|退还).*/

/** 提取“对方/商户”核心标识：去掉平台前缀、括号门店/卡号、退款字样，用于判断收支是否同一路径 */
function merchantKey(t: Transaction): string {
  let s = t.merchant || ''
  s = s.replace(PLATFORM_PREFIX, '')
  s = s.replace(/[(（][^)）]*[)）]/g, '')
  s = s.replace(REFUND_WORDS, '')
  return s.replace(/\s+/g, '').trim()
}

/** 同一路径：商户核心标识相等，或一方包含另一方（容忍退款备注差异） */
function samePath(a: Transaction, b: Transaction): boolean {
  const ka = merchantKey(a)
  const kb = merchantKey(b)
  if (!ka || !kb) return false
  return ka === kb || ka.includes(kb) || kb.includes(ka)
}

export interface RefundPair {
  /** 较早的支出 */
  expense: Transaction
  /** 之后金额相同、路径一致的退款收入 */
  income: Transaction
}

/**
 * 检测“消费 + 退款”抵消对：
 * 金额相同、收入发生在支出之后、且收支为同一对方路径（退款原路返回）。
 * 每笔仅配对一次，按时间就近匹配。
 */
export function detectRefundOffsets(transactions: Transaction[]): RefundPair[] {
  const sorted = [...transactions]
    .filter((t) => t.dedupStatus !== 'merged')
    .sort((a, b) => a.occurredAt - b.occurredAt)
  const pairs: RefundPair[] = []
  const used = new Set<number>()

  for (let i = 0; i < sorted.length; i++) {
    const exp = sorted[i]
    if (exp.direction !== 'expense') continue
    if (exp.id != null && used.has(exp.id)) continue
    for (let j = i + 1; j < sorted.length; j++) {
      const inc = sorted[j]
      if (inc.occurredAt - exp.occurredAt > REFUND_WINDOW) break
      if (inc.direction !== 'income') continue
      if (inc.id != null && used.has(inc.id)) continue
      if (Math.abs(exp.amount - inc.amount) > 0.001) continue
      if (!samePath(exp, inc)) continue
      pairs.push({ expense: exp, income: inc })
      if (exp.id != null) used.add(exp.id)
      if (inc.id != null) used.add(inc.id)
      break
    }
  }
  return pairs
}
