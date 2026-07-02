import Dexie, { type Table } from 'dexie'
import type {
  Ledger,
  Tag,
  Transaction,
  MerchantMemory,
  LLMConfig,
} from '../types'

export class PaymentDB extends Dexie {
  ledgers!: Table<Ledger, number>
  tags!: Table<Tag, number>
  transactions!: Table<Transaction, number>
  merchantMemory!: Table<MerchantMemory, number>
  llmConfig!: Table<LLMConfig, number>

  constructor() {
    super('payment-db')
    this.version(1).stores({
      ledgers: '++id, name',
      tags: '++id, parentId, name, special',
      transactions:
        '++id, ledgerId, occurredAt, direction, tagId, amount, dedupStatus, comboGroupId',
      merchantMemory: '++id, merchant',
      llmConfig: '++id',
    })
  }
}

export const db = new PaymentDB()

/** 预设标签（多级：一级 -> 子级）。special 用于资金搬运类的统计排除。 */
const PRESET_TAGS: Array<{ name: string; special?: Tag['special']; children?: string[] }> = [
  { name: '餐饮', children: ['外卖', '堂食', '饮品', '食材'] },
  { name: '交通', children: ['公共交通', '打车', '加油', '停车'] },
  { name: '住宿', children: ['酒店', '房租', '物业'] },
  { name: '医疗', children: ['门诊', '药品', '体检'] },
  { name: '教育', children: ['课程', '书籍', '培训'] },
  { name: '购物', children: ['日用', '服饰', '数码', '美妆'] },
  { name: '娱乐', children: ['影音', '游戏', '旅游'] },
  { name: '居家', children: ['水电燃气', '通讯', '家政'] },
  { name: '收入', children: ['工资', '红包', '报销', '利息'] },
  { name: '投资', special: 'investment', children: ['基金', '股票', '余额宝', '理财'] },
  { name: '信用卡还款', special: 'credit_repay' },
  { name: '转账', special: 'transfer' },
  { name: '其他' },
]

/** 首次启动时初始化默认账本与预设标签 */
export async function ensureSeed(): Promise<void> {
  const ledgerCount = await db.ledgers.count()
  if (ledgerCount === 0) {
    await db.ledgers.add({
      name: '默认账本',
      currency: 'CNY',
      createdAt: Date.now(),
    })
  }

  const tagCount = await db.tags.count()
  if (tagCount === 0) {
    for (const t of PRESET_TAGS) {
      const parentId = await db.tags.add({
        name: t.name,
        parentId: null,
        preset: true,
        special: t.special ?? null,
      })
      if (t.children) {
        for (const c of t.children) {
          await db.tags.add({
            name: c,
            parentId,
            preset: true,
            special: null,
          })
        }
      }
    }
  }

  // 迁移：为已存在的旧账本补上「投资」标签（投资既不计收入也不计支出）
  const hasInvestment = await db.tags.where('name').equals('投资').first()
  if (!hasInvestment) {
    const invId = await db.tags.add({ name: '投资', parentId: null, preset: true, special: 'investment' })
    for (const c of ['基金', '股票', '余额宝', '理财']) {
      await db.tags.add({ name: c, parentId: invId, preset: true, special: null })
    }
  }

  const cfg = await db.llmConfig.count()
  if (cfg === 0) {
    await db.llmConfig.add({
      enabled: false,
      apiKey: '',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })
  }
}

export async function getLLMConfig(): Promise<LLMConfig> {
  const cfg = await db.llmConfig.toCollection().first()
  return (
    cfg ?? { enabled: false, apiKey: '', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
  )
}

export async function saveLLMConfig(cfg: LLMConfig): Promise<void> {
  if (cfg.id != null) {
    await db.llmConfig.put(cfg)
  } else {
    const existing = await db.llmConfig.toCollection().first()
    if (existing?.id != null) await db.llmConfig.put({ ...cfg, id: existing.id })
    else await db.llmConfig.add(cfg)
  }
}
