import { db, ensureSeed } from '../db/db'

type Direction = 'income' | 'expense'
type DedupStatus = 'none' | 'suspected' | 'merged' | 'ignored'

const MERCHANTS: Record<string, string[]> = {
  餐饮: ['美团外卖', '饿了么', '海底捞火锅', '瑞幸咖啡', '盒马鲜生', '肯德基', '麦当劳', '喜茶', '太二酸菜鱼', '西贝莜面村'],
  交通: ['滴滴出行', '曹操出行', '中国石化', '北京地铁', '高德打车', 'T3出行', 'ETC充值'],
  购物: ['京东', '淘宝', '拼多多', '优衣库', '小米商城', 'Apple Store', '山姆会员店', '名创优品'],
  娱乐: ['猫眼电影', '网易云音乐', 'Steam', '迪士尼乐园', '爱奇艺', '腾讯视频', '大麦网'],
  居家: ['国家电网', '中国移动', '中国联通', '燃气费', '自来水公司', '物业费'],
  医疗: ['阿里健康', '丁香医生', '瑞尔齿科', '同仁堂'],
  教育: ['得到', '极客时间', '京东图书', '微信读书'],
  收入: ['工资', '项目奖金', '理财收益', '报销款', '红包'],
}

const SOURCES = ['wechat', 'alipay', 'cmb', 'manual']
const PAYMENT_METHODS: Record<string, string[]> = {
  wechat: ['微信零钱', '微信零钱通'],
  alipay: ['支付宝余额', '花呗', '余额宝'],
  cmb: ['招商银行储蓄卡', '招商银行信用卡'],
  manual: ['现金', '其他'],
}

const DEMO_LEDGER_NAME = '演示账本'

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0)
  let r = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

const DAY = 24 * 3600 * 1000
const HOUR = 3600 * 1000

export async function seedData() {
  await ensureSeed()

  const existingDemoLedger = await db.ledgers.where('name').equals(DEMO_LEDGER_NAME).first()
  const ledgerId = existingDemoLedger?.id ?? (await db.ledgers.add({ name: DEMO_LEDGER_NAME, currency: 'CNY', createdAt: Date.now() }))

  const allTags = await db.tags.toArray()
  const tagMap = new Map<string, number>()
  for (const t of allTags) {
    if (t.id != null) tagMap.set(t.name, t.id)
  }

  await db.transactions.where('ledgerId').equals(ledgerId).delete()

  const transactions: Array<{
    ledgerId: number
    amount: number
    direction: Direction
    occurredAt: number
    merchant: string
    source: string
    paymentMethod: string
    tagId: number | null
    note: string
    countInStats: boolean
    comboGroupId: string | null
    dedupStatus: DedupStatus
    dedupGroupId: string | null
    raw: string
    createdAt: number
  }> = []

  const now = Date.now()
  const SIX_MONTHS = 180 * 24 * 3600 * 1000

  // --- 日常消费：每月 12-18 条，6 个月 ---
  const expenseCategories = ['餐饮', '交通', '购物', '娱乐', '居家', '医疗', '教育']
  const categoryWeights = [28, 16, 18, 8, 10, 5, 5] // 权重

  for (let month = 0; month < 6; month++) {
    const count = rand(12, 18)
    const monthStart = now - SIX_MONTHS + month * 30 * 24 * 3600 * 1000

    for (let i = 0; i < count; i++) {
      const cat = pickWeighted(expenseCategories, categoryWeights)
      const merchant = pick(MERCHANTS[cat] ?? ['其他'])
      const source = pick(SOURCES)
      const methods = PAYMENT_METHODS[source] ?? ['其他']
      const tagId = tagMap.get(cat) ?? null

      transactions.push({
        ledgerId,
        amount: cat === '医疗' || cat === '购物' ? rand(80, 2000) : rand(5, 500),
        direction: 'expense',
        occurredAt: monthStart + rand(1, 28) * 24 * 3600 * 1000 + rand(0, 23) * 3600 * 1000,
        merchant,
        source,
        paymentMethod: pick(methods),
        tagId,
        note: '',
        countInStats: true,
        comboGroupId: null,
        dedupStatus: 'none',
        dedupGroupId: null,
        raw: `${merchant},消费`,
        createdAt: Date.now(),
      })
    }
  }

  // --- 收入：每月 1-3 条 ---
  for (let month = 0; month < 6; month++) {
    const count = rand(1, 3)
    const monthStart = now - SIX_MONTHS + month * 30 * 24 * 3600 * 1000
    const incomeTagId = tagMap.get('收入')
    const salaryTagId = tagMap.get('工资')

    for (let i = 0; i < count; i++) {
      const isSalary = i === 0
      const merchant = isSalary ? '工资' : pick(['项目奖金', '理财收益', '报销款', '红包', '兼职收入'])
      const source = isSalary ? 'cmb' : pick(['wechat', 'alipay'])

      transactions.push({
        ledgerId,
        amount: isSalary ? rand(15000, 35000) : rand(50, 5000),
        direction: 'income',
        occurredAt: monthStart + rand(1, 15) * 24 * 3600 * 1000,
        merchant,
        source,
        paymentMethod: isSalary ? '招商银行储蓄卡' : pick(['微信零钱', '支付宝余额']),
        tagId: isSalary ? (salaryTagId ?? null) : (incomeTagId ?? null),
        note: '',
        countInStats: true,
        comboGroupId: null,
        dedupStatus: 'none',
        dedupGroupId: null,
        raw: `${merchant},收入`,
        createdAt: Date.now(),
      })
    }
  }

  // --- 资金搬运类（不计入统计）---
  const creditRepayTagId = tagMap.get('信用卡还款')
  const transferTagId = tagMap.get('转账')
  for (let month = 0; month < 6; month++) {
    const monthStart = now - SIX_MONTHS + month * 30 * 24 * 3600 * 1000
    // 信用卡还款
    transactions.push({
      ledgerId,
      amount: rand(2000, 8000),
      direction: 'expense',
      occurredAt: monthStart + rand(20, 28) * 24 * 3600 * 1000,
      merchant: '招商银行信用卡还款',
      source: 'cmb',
      paymentMethod: '招商银行储蓄卡',
      tagId: creditRepayTagId ?? null,
      note: '',
      countInStats: false,
      comboGroupId: null,
      dedupStatus: 'none',
      dedupGroupId: null,
      raw: '信用卡还款',
      createdAt: Date.now(),
    })
    // 转账（偶尔）
    if (Math.random() > 0.4) {
      transactions.push({
        ledgerId,
        amount: rand(500, 3000),
        direction: 'expense',
        occurredAt: monthStart + rand(10, 20) * 24 * 3600 * 1000,
        merchant: '转账-朋友',
        source: 'wechat',
        paymentMethod: '微信零钱',
        tagId: transferTagId ?? null,
        note: '',
        countInStats: false,
        comboGroupId: null,
        dedupStatus: 'none',
        dedupGroupId: null,
        raw: '微信转账',
        createdAt: Date.now(),
      })
    }
  }

  // --- 本月状态锚点：保证首页当月有收入和可感知的成长投入 ---
  const currentSalaryTagId = tagMap.get('工资') ?? tagMap.get('收入') ?? null
  const currentEducationTagId = tagMap.get('教育') ?? null
  transactions.push({
    ledgerId,
    amount: 26000,
    direction: 'income',
    occurredAt: now - 3 * DAY,
    merchant: '本月工资',
    source: 'cmb',
    paymentMethod: '招商银行储蓄卡',
    tagId: currentSalaryTagId,
    note: '演示：本月工作回报',
    countInStats: true,
    comboGroupId: null,
    dedupStatus: 'none',
    dedupGroupId: null,
    raw: '本月工资,+26000',
    createdAt: Date.now(),
  })
  transactions.push({
    ledgerId,
    amount: 1299,
    direction: 'expense',
    occurredAt: now - 2 * DAY,
    merchant: '年度课程订阅',
    source: 'alipay',
    paymentMethod: '支付宝余额',
    tagId: currentEducationTagId,
    note: '演示：成长投入',
    countInStats: true,
    comboGroupId: null,
    dedupStatus: 'none',
    dedupGroupId: null,
    raw: '年度课程订阅,-1299',
    createdAt: Date.now(),
  })

  // --- 重复/疑似重复：保持待检测状态，用于验证复核区合并/忽略功能 ---
  const duplicateBaseTime = now - 4 * DAY + 9 * HOUR
  const dedupEntries = [
    { merchant: '美团外卖', amount: 35.8, source: 'wechat', paymentMethod: '微信零钱', occurredAt: duplicateBaseTime },
    { merchant: '美团外卖', amount: 35.8, source: 'alipay', paymentMethod: '花呗', occurredAt: duplicateBaseTime + 6 * 1000 },
    { merchant: '滴滴出行', amount: 24.5, source: 'wechat', paymentMethod: '微信零钱', occurredAt: duplicateBaseTime + 2 * HOUR },
    { merchant: '滴滴出行', amount: 24.5, source: 'alipay', paymentMethod: '支付宝余额', occurredAt: duplicateBaseTime + 2 * HOUR + 5 * 1000 },
  ]
  for (let i = 0; i < dedupEntries.length; i++) {
    const e = dedupEntries[i]
    const tagId = tagMap.get(i < 2 ? '餐饮' : '交通') ?? null
    transactions.push({
      ledgerId,
      amount: e.amount,
      direction: 'expense',
      occurredAt: e.occurredAt,
      merchant: e.merchant,
      source: e.source,
      paymentMethod: e.paymentMethod,
      tagId,
      note: '演示：跨来源重复候选',
      countInStats: true,
      comboGroupId: null,
      dedupStatus: 'none',
      dedupGroupId: null,
      raw: `${e.merchant},-${e.amount}`,
      createdAt: Date.now(),
    })
  }

  // --- 退款抵消：点击“检测退款抵消”后应成对出现 ---
  const refundTagId = tagMap.get('娱乐') ?? null
  const refundTime = now - 8 * DAY + 20 * HOUR
  transactions.push({
    ledgerId,
    amount: 268,
    direction: 'expense',
    occurredAt: refundTime,
    merchant: '猫眼电影',
    source: 'alipay',
    paymentMethod: '支付宝余额',
    tagId: refundTagId,
    note: '演示：电影票消费',
    countInStats: true,
    comboGroupId: null,
    dedupStatus: 'none',
    dedupGroupId: null,
    raw: '猫眼电影,-268',
    createdAt: Date.now(),
  })
  transactions.push({
    ledgerId,
    amount: 268,
    direction: 'income',
    occurredAt: refundTime + 2 * DAY,
    merchant: '猫眼电影退款',
    source: 'alipay',
    paymentMethod: '支付宝余额',
    tagId: refundTagId,
    note: '演示：原路退回',
    countInStats: true,
    comboGroupId: null,
    dedupStatus: 'none',
    dedupGroupId: null,
    raw: '猫眼电影退款,+268',
    createdAt: Date.now(),
  })

  // --- 组合支付 ---
  const comboId = `combo-${Date.now()}`
  const comboTagId = tagMap.get('购物') ?? null
  for (let i = 0; i < 3; i++) {
    transactions.push({
      ledgerId,
      amount: [420, 180, 0.5][i],
      direction: 'expense',
      occurredAt: now - rand(1, 7) * 24 * 3600 * 1000,
      merchant: '京东',
      source: i === 2 ? 'wechat' : 'alipay',
      paymentMethod: ['花呗', '支付宝余额', '微信零钱'][i],
      tagId: comboTagId,
      note: i === 0 ? '京东订单#JD2026 部分支付' : '',
      countInStats: true,
      comboGroupId: comboId,
      dedupStatus: 'none',
      dedupGroupId: null,
      raw: '京东订单',
      createdAt: Date.now(),
    })
  }

  // --- 未分类（近 7 天，5-8 条）---
  for (let i = 0; i < rand(5, 8); i++) {
    const source = pick(SOURCES)
    const methods = PAYMENT_METHODS[source] ?? ['其他']
    transactions.push({
      ledgerId,
      amount: rand(3, 200),
      direction: 'expense',
      occurredAt: now - rand(0, 7) * 24 * 3600 * 1000,
      merchant: pick(['未知商户', '快捷支付', '银联在线', 'POS消费-', '聚合支付']),
      source,
      paymentMethod: pick(methods),
      tagId: null, // 未分类
      note: '',
      countInStats: true,
      comboGroupId: null,
      dedupStatus: 'none',
      dedupGroupId: null,
      raw: '未识别交易',
      createdAt: Date.now(),
    })
  }

  // --- 大额单笔（近 3 月）---
  const bigTagId = tagMap.get('购物') ?? null
  const bigItems = [
    { merchant: 'Apple Store', amount: 8999, note: 'MacBook Air M4' },
    { merchant: '京东', amount: 4299, note: '戴森吸尘器' },
  ]
  for (const item of bigItems) {
    transactions.push({
      ledgerId,
      amount: item.amount,
      direction: 'expense',
      occurredAt: now - rand(30, 90) * 24 * 3600 * 1000,
      merchant: item.merchant,
      source: 'alipay',
      paymentMethod: '花呗',
      tagId: bigTagId,
      note: item.note,
      countInStats: true,
      comboGroupId: null,
      dedupStatus: 'none',
      dedupGroupId: null,
      raw: `${item.merchant},-${item.amount}`,
      createdAt: Date.now(),
    })
  }

  await db.transactions.bulkAdd(transactions)

  // --- 商户记忆（稳定分类）---
  const memCount = await db.merchantMemory.count()
  if (memCount === 0) {
    const memories = [
      { merchant: '美团外卖', tagId: tagMap.get('外卖') ?? tagMap.get('餐饮')! },
      { merchant: '滴滴出行', tagId: tagMap.get('打车') ?? tagMap.get('交通')! },
      { merchant: '海底捞火锅', tagId: tagMap.get('堂食') ?? tagMap.get('餐饮')! },
      { merchant: '瑞幸咖啡', tagId: tagMap.get('饮品') ?? tagMap.get('餐饮')! },
      { merchant: 'Apple Store', tagId: tagMap.get('数码') ?? tagMap.get('购物')! },
      { merchant: '中国石化', tagId: tagMap.get('加油') ?? tagMap.get('交通')! },
    ]
    await db.merchantMemory.bulkAdd(memories)
  }

  const total = await db.transactions.where('ledgerId').equals(ledgerId).count()
  const byMonth: Record<string, number> = {}
  const allTx = await db.transactions.where('ledgerId').equals(ledgerId).toArray()
  for (const tx of allTx) {
    const key = new Date(tx.occurredAt).toISOString().slice(0, 7)
    byMonth[key] = (byMonth[key] ?? 0) + 1
  }

  console.log(`✅ 已生成 ${total} 条假数据`, byMonth)
  localStorage.setItem('payment-ledger', String(ledgerId))
  return { ledgerId, total, byMonth }
}

// dev 模式下暴露到 window
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as any).__seedData = seedData
}
