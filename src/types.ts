export type Direction = 'income' | 'expense'

export type DedupStatus = 'none' | 'suspected' | 'merged' | 'ignored'

/** 标签的特殊语义类型，用于收支统计排除等逻辑（投资既不计收入也不计支出） */
export type TagSpecial = 'credit_repay' | 'transfer' | 'investment' | null

export interface Ledger {
  id?: number
  name: string
  currency: string
  createdAt: number
}

export interface Tag {
  id?: number
  name: string
  parentId: number | null
  preset: boolean
  /** 特殊语义：信用卡还款 / 转账等，命中后默认不计入收支统计 */
  special: TagSpecial
}

export interface Transaction {
  id?: number
  ledgerId: number
  /** 正数金额，方向由 direction 决定 */
  amount: number
  direction: Direction
  /** 发生时间（毫秒时间戳） */
  occurredAt: number
  /** 商户 / 描述 */
  merchant: string
  /** 来源平台：wechat | alipay | cmb | manual | llm | other */
  source: string
  /** 支付方式，如 微信 / 支付宝 / 招商银行储蓄卡 */
  paymentMethod: string
  /** 主标签 id */
  tagId: number | null
  note: string
  /** 是否计入收支统计（资金搬运类为 false） */
  countInStats: boolean
  /** 组合支付分组 id（同一订单多笔支付） */
  comboGroupId: string | null
  dedupStatus: DedupStatus
  /** 去重确认后归并到的主条目分组 id */
  dedupGroupId: string | null
  /** 原始数据快照 */
  raw: string
  createdAt: number
}

/** 商户 -> 标签 的本地记忆，用于稳定分类、节省 token（风险项 R3） */
export interface MerchantMemory {
  id?: number
  /** 商户关键词（归一化后） */
  merchant: string
  tagId: number
}

export interface LLMConfig {
  id?: number
  enabled: boolean
  apiKey: string
  baseURL: string
  model: string
}

/** 解析得到的草稿条目（尚未入库、尚未去重确认） */
export interface DraftTransaction {
  amount: number
  direction: Direction
  occurredAt: number
  merchant: string
  source: string
  paymentMethod: string
  note: string
  raw: string
  comboGroupId?: string | null
}
