import Papa from 'papaparse'
import type { DraftTransaction, Direction } from '../types'
import { parseTime } from './format'

/** 智能读取文件文本：优先 UTF-8，乱码则回退 GBK（微信/支付宝导出常为 GBK） */
export async function readFileSmart(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buf)
  const badCount = (utf8.match(/\uFFFD/g) || []).length
  if (badCount > 3) {
    try {
      return new TextDecoder('gbk').decode(buf)
    } catch {
      return utf8
    }
  }
  return utf8
}

export type BuiltinPlatform = 'wechat' | 'alipay' | 'cmb' | 'boc'

/** 平台展示名（用于状态提示等） */
export const PLATFORM_LABELS: Record<BuiltinPlatform, string> = {
  wechat: '微信',
  alipay: '支付宝',
  cmb: '招商银行',
  boc: '中国银行',
}

export function detectPlatform(text: string): BuiltinPlatform | null {
  // 仅依据“表头那一行”的列名判断平台：平台名/银行名常作为交易对方出现在数据里，
  // 用整段文本做关键词匹配会被数据内容误判（如支付宝账单里出现“中国银行/余额”）。
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const line = lines[i]
    const has = (s: string) => line.includes(s)
    // 中国银行：表头含「记账日期」+「对方账户名」
    if (has('记账日期') && has('对方账户名')) return 'boc'
    // 支付宝：表头含「商品说明」（区别于微信的「商品」）+「收/支」
    if (has('商品说明') && has('收/支')) return 'alipay'
    // 微信：表头含「交易对方」+「商品」+「收/支」
    if (has('交易对方') && has('商品') && has('收/支')) return 'wechat'
    // 招商银行：表头含「交易摘要」+「余额」
    if (has('交易摘要') && has('余额')) return 'cmb'
  }
  // 兜底：仅扫描文件最前部（600 字内）的平台名，降低被交易数据误判的概率
  const head = text.slice(0, 600)
  if (head.includes('微信支付账单') || head.includes('微信')) return 'wechat'
  if (head.includes('支付宝')) return 'alipay'
  if (head.includes('招商银行') || head.includes('招行')) return 'cmb'
  if (head.includes('中国银行') || head.includes('中行')) return 'boc'
  return null
}

/** 在原始文本中定位真正的表头行（账单文件前面常有若干说明行） */
function locateHeader(text: string, headerKeywords: string[]): string {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const hit = headerKeywords.filter((k) => line.includes(k)).length
    if (hit >= 2) {
      return lines.slice(i).join('\n')
    }
  }
  return text
}

/** 银行明细里常用一串 "-----" 作为空占位，这类值视为无效 */
function isPlaceholder(v: string): boolean {
  return v === '' || /^-+$/.test(v)
}

function pick(row: Record<string, string>, candidates: string[]): string {
  for (const key of Object.keys(row)) {
    const cleanKey = key.trim()
    if (candidates.some((c) => cleanKey.includes(c))) {
      const v = row[key]
      if (v != null) {
        const s = String(v).trim()
        if (!isPlaceholder(s)) return s
      }
    }
  }
  return ''
}

function parseAmount(s: string): number {
  if (!s) return NaN
  const cleaned = s.replace(/[¥￥,\s]/g, '').replace(/元/g, '')
  return Math.abs(parseFloat(cleaned))
}

function mapDirection(s: string): Direction {
  if (s.includes('收入') || s.includes('收')) return 'income'
  return 'expense'
}

interface FieldMap {
  time: string[]
  /** 单独的时间列（部分银行把日期与时间拆成两列） */
  clock?: string[]
  merchant: string[]
  product: string[]
  direction: string[]
  amount: string[]
  payment: string[]
  status?: string[]
}

const WECHAT_MAP: FieldMap = {
  time: ['交易时间'],
  merchant: ['交易对方'],
  product: ['商品'],
  direction: ['收/支', '收支'],
  amount: ['金额'],
  payment: ['支付方式'],
}

const ALIPAY_MAP: FieldMap = {
  time: ['交易时间', '交易创建时间', '付款时间'],
  merchant: ['交易对方', '对方'],
  product: ['商品说明', '商品名称', '商品'],
  direction: ['收/支', '收支'],
  amount: ['金额'],
  payment: ['收/付款方式', '付款方式', '收付款方式'],
}

const CMB_MAP: FieldMap = {
  time: ['交易日期', '记账日期', '交易时间', '日期'],
  merchant: ['交易摘要', '摘要', '交易地点', '对方'],
  product: ['交易摘要', '摘要'],
  direction: ['收/支', '借贷', '方向'],
  amount: ['金额', '交易金额', '人民币金额'],
  payment: ['卡号', '账户'],
}

// 中国银行借记卡明细：日期/时间分两列，收支以金额正负表示，无独立"收/支"列
const BOC_MAP: FieldMap = {
  time: ['记账日期', '交易日期'],
  clock: ['记账时间', '交易时间'],
  merchant: ['对方账户名', '对方户名'],
  product: ['交易名称', '摘要', '附言'],
  direction: [],
  amount: ['金额', '交易金额'],
  payment: [],
}

interface PlatformConfig {
  map: FieldMap
  headerKeywords: string[]
  pay: string
  /** 收支方向由金额正负号决定（无独立收/支列时使用） */
  directionFromSign?: boolean
  /** 商户为空时用 product 兜底，而非拼接（避免重复/噪声） */
  productAsFallback?: boolean
}

const MAPS: Record<BuiltinPlatform, PlatformConfig> = {
  wechat: { map: WECHAT_MAP, headerKeywords: ['交易时间', '交易对方', '收/支'], pay: '微信' },
  alipay: { map: ALIPAY_MAP, headerKeywords: ['交易时间', '商品说明', '收/支'], pay: '支付宝' },
  cmb: { map: CMB_MAP, headerKeywords: ['交易摘要', '余额'], pay: '招商银行' },
  boc: {
    map: BOC_MAP,
    headerKeywords: ['记账日期', '余额', '对方账户名'],
    pay: '中国银行',
    directionFromSign: true,
    productAsFallback: true,
  },
}

function rowsToDrafts(
  rows: Record<string, string>[],
  platform: BuiltinPlatform,
  cfg: PlatformConfig,
): DraftTransaction[] {
  const { map, pay: defaultPay } = cfg
  const drafts: DraftTransaction[] = []
  for (const row of rows) {
    const amountRaw = pick(row, map.amount)
    const amount = parseAmount(amountRaw)
    const dateStr = pick(row, map.time)
    const clockStr = map.clock ? pick(row, map.clock) : ''
    const ts = parseTime(clockStr ? `${dateStr} ${clockStr}` : dateStr)
    if (!Number.isFinite(amount) || amount <= 0 || Number.isNaN(ts)) continue

    const merchantMain = pick(row, map.merchant)
    const productPart = pick(row, map.product)
    const merchant = cfg.productAsFallback
      ? merchantMain || productPart
      : [merchantMain, productPart].filter(Boolean).join(' - ')

    const dirRaw = pick(row, map.direction)
    const direction: Direction = cfg.directionFromSign
      ? /^-/.test(amountRaw.trim())
        ? 'expense'
        : 'income'
      : mapDirection(dirRaw)
    const payment = pick(row, map.payment) || defaultPay

    drafts.push({
      amount,
      direction,
      occurredAt: ts,
      merchant: merchant || '未知商户',
      source: platform,
      paymentMethod: payment,
      note: dirRaw.includes('不计收支') ? '不计收支' : '',
      raw: JSON.stringify(row),
    })
  }
  return drafts
}

function parseTable(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })
  return result.data.filter((r) => r && Object.keys(r).length > 1)
}

/**
 * 用内置规则解析账单。
 * - 传入 forced 时按指定平台解析（跳过自动识别，准确率更高）；
 * - 不传时自动识别，识别不到返回 null（交由 LLM 或手动）。
 */
export function parseBuiltin(
  text: string,
  forced?: BuiltinPlatform,
): { platform: BuiltinPlatform; drafts: DraftTransaction[] } | null {
  const platform = forced ?? detectPlatform(text)
  if (!platform) return null
  const cfg = MAPS[platform]
  const body = locateHeader(text, cfg.headerKeywords)
  const rows = parseTable(body)
  const drafts = rowsToDrafts(rows, platform, cfg)
  if (drafts.length === 0) return null
  return { platform, drafts }
}

/** 通用 CSV 解析为原始行（供 LLM 分批分类时复用结构化字段） */
export function parseGenericRows(text: string): Record<string, string>[] {
  return parseTable(text)
}
