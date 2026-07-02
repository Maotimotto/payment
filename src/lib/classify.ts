import type { DraftTransaction, Tag } from '../types'

/** 基于关键词的本地规则分类，返回一级标签名或 null */
const RULES: Array<{ tag: string; keywords: string[] }> = [
  { tag: '信用卡还款', keywords: ['还款', '信用卡还'] },
  {
    tag: '投资',
    keywords: ['理财', '基金', '股票', '证券', '余额宝', '零钱通', '蚂蚁财富', '赎回', '申购', '定投', '国债', '黄金'],
  },
  { tag: '转账', keywords: ['转账', '转入', '转出', '零钱提现', '提现'] },
  {
    tag: '餐饮',
    keywords: ['美团', '饿了么', '星巴克', '瑞幸', '餐', '饭', '食堂', '肯德基', '麦当劳', '咖啡', '奶茶', '茶'],
  },
  {
    tag: '交通',
    keywords: ['滴滴', '出行', '地铁', '公交', '加油', '中石化', '中石油', '停车', '高铁', '12306', '打车', '出租', '航空', '机票'],
  },
  { tag: '住宿', keywords: ['酒店', '如家', '汉庭', '房租', '物业', '住宿', '民宿'] },
  { tag: '医疗', keywords: ['医院', '药', '药店', '体检', '诊所', '挂号', '医疗'] },
  { tag: '教育', keywords: ['学费', '课', '图书', '书店', '培训', '教育', '学校'] },
  {
    tag: '购物',
    keywords: ['淘宝', '京东', '天猫', '拼多多', '超市', '商场', '服饰', '优衣库', '商城'],
  },
  { tag: '娱乐', keywords: ['电影', '游戏', 'steam', '旅游', '景区', 'ktv', '影院', '视频会员'] },
  {
    tag: '居家',
    keywords: ['电费', '水费', '燃气', '话费', '移动', '联通', '电信', '宽带', '物业费'],
  },
  { tag: '收入', keywords: ['工资', '报销', '红包', '收益', '退款', '利息'] },
]

export function ruleClassifyName(draft: DraftTransaction): string | null {
  const text = `${draft.merchant} ${draft.note} ${draft.paymentMethod}`
  for (const rule of RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.tag
  }
  return null
}

/** 把标签名映射到标签 id：优先精确匹配（含子级），其次根级 */
export function resolveTagIdByName(name: string, tags: Tag[]): number | null {
  if (!name) return null
  const exact = tags.find((t) => t.name === name)
  if (exact?.id != null) return exact.id
  const fuzzy = tags.find((t) => name.includes(t.name) || t.name.includes(name))
  return fuzzy?.id ?? null
}

/** 归一化商户用于记忆匹配（取前若干字符，去除金额/数字噪声） */
export function normalizeMerchant(merchant: string): string {
  return merchant.replace(/[0-9]/g, '').trim().slice(0, 12)
}
