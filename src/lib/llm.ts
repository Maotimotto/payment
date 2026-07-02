import type { DraftTransaction, Direction, LLMConfig } from '../types'
import { parseTime } from './format'

function endpoint(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/chat/completions`
}

async function chat(
  cfg: LLMConfig,
  messages: unknown[],
  opts: { maxTokens?: number } = {},
): Promise<string> {
  const res = await fetch(endpoint(cfg.baseURL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0,
      max_tokens: opts.maxTokens ?? 1500,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText} ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

/** 测试连通性：成功返回 {ok:true}，失败返回错误信息 */
export async function testConnection(
  cfg: LLMConfig,
): Promise<{ ok: boolean; message: string }> {
  try {
    const reply = await chat(
      cfg,
      [{ role: 'user', content: '回复一个字：好' }],
      { maxTokens: 5 },
    )
    return { ok: true, message: `连接成功，模型回复：${reply.trim().slice(0, 20)}` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

function snippet(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length === 0 ? '（空回复，可能是 max_tokens 不足或模型未输出）' : s.slice(0, 160)
}

function extractJson(text: string): unknown {
  // 去掉推理模型的思考块，避免其中的非 JSON 内容干扰
  let raw = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) raw = fence[1]
  const start = raw.search(/[[{]/)
  if (start === -1) throw new Error(`未找到 JSON（模型回复：${snippet(text)}）`)

  const open = raw[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inStr = false
  let esc = false
  let end = -1
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const slice = end !== -1 ? raw.slice(start, end + 1) : raw.slice(start)
  try {
    return JSON.parse(slice)
  } catch {
    // 截断救援：数组场景下抽取所有完整的带引号字符串
    if (open === '[') {
      const tokens = slice.match(/"(?:[^"\\]|\\.)*"/g)
      if (tokens && tokens.length > 0) {
        try {
          return JSON.parse(`[${tokens.join(',')}]`)
        } catch {
          /* 落到下面统一报错 */
        }
      }
    }
    throw new Error(`JSON 解析失败（模型回复：${snippet(text)}）`)
  }
}

/**
 * 分类打标签：仅让 LLM 做语义分类（金额/时间已由规则解析）。
 * 返回与输入等长的标签名数组。
 */
export async function classifyBatch(
  cfg: LLMConfig,
  items: { merchant: string; amount: number; direction: Direction }[],
  tagNames: string[],
): Promise<string[]> {
  if (items.length === 0) return []
  const system = `你是记账分类助手。请把每一笔交易归类到给定标签之一。只能从以下标签中选择：${tagNames.join(
    '、',
  )}。投资理财类（基金、股票、证券、余额宝/零钱通转入赎回、理财申购等）归为"投资"（投资既不是消费也不是收入）。无法判断时归为"其他"。只输出 JSON 数组，每个元素为字符串标签名，顺序与输入一致，不要任何解释。`
  const user = JSON.stringify(
    items.map((it, i) => ({
      i,
      商户: it.merchant,
      金额: it.amount,
      方向: it.direction === 'income' ? '收入' : '支出',
    })),
  )
  const reply = await chat(
    cfg,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { maxTokens: 3000 },
  )
  const parsed = extractJson(reply)
  if (!Array.isArray(parsed)) throw new Error('返回格式非数组')
  return parsed.map((x) => String(x))
}

/**
 * 开放式分类：优先复用现有标签，必要时允许 LLM 给出新标签名（由调用方负责落库）。
 * 强制区分“投资”（既非消费也非收入）。返回与输入等长的标签名数组。
 */
export async function classifyOpenBatch(
  cfg: LLMConfig,
  items: { merchant: string; note: string; amount: number; direction: Direction }[],
  existingTagNames: string[],
): Promise<string[]> {
  if (items.length === 0) return []
  const system = `你是记账分类助手，请根据「商户/描述」为每笔交易判断一个最合适的标签。
规则：
1. 优先从现有标签中选择：${existingTagNames.join('、')}。
2. 若现有标签都不合适，可创建一个新的简洁标签（2-6个汉字，例如"宠物""话费""母婴"），不要使用"其他"敷衍。
3. 投资理财类（基金、股票、证券、余额宝/零钱通转入赎回、理财申购定投等）必须归为"投资"；投资既不是消费也不是收入，切勿归为"收入"或某个消费类目。
4. 工资、报销、利息、收益、收红包等真实进账归为"收入"。
只输出 JSON 数组，每个元素为字符串标签名，顺序与输入严格一致，不要任何解释。`
  const user = JSON.stringify(
    items.map((it, i) => ({
      i,
      商户: it.merchant,
      描述: it.note || '',
      金额: it.amount,
      方向: it.direction === 'income' ? '收入' : '支出',
    })),
  )
  const reply = await chat(
    cfg,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { maxTokens: 3000 },
  )
  const parsed = extractJson(reply)
  if (!Array.isArray(parsed)) throw new Error('返回格式非数组')
  // 保持与输入等长；过长/异常的标签名置空，交由调用方跳过
  return parsed.map((x) => {
    const s = String(x).trim()
    return s.length > 0 && s.length <= 10 ? s : ''
  })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** 截图识别：多模态解析账单截图为草稿条目（需 LLM） */
export async function parseImage(
  cfg: LLMConfig,
  file: File,
): Promise<DraftTransaction[]> {
  const dataUrl = await fileToDataUrl(file)
  const system = `你是账单识别助手。请从账单截图中提取所有交易，输出 JSON 数组，每个元素字段：amount(正数), direction("income"或"expense"), time(尽量完整的日期时间字符串), merchant(商户或描述), paymentMethod(支付方式)。只输出 JSON，不要解释。`
  const reply = await chat(
    cfg,
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张账单截图中的所有交易。' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    { maxTokens: 2000 },
  )
  const parsed = extractJson(reply)
  if (!Array.isArray(parsed)) throw new Error('返回格式非数组')
  const drafts: DraftTransaction[] = []
  for (const item of parsed as Record<string, unknown>[]) {
    const amount = Math.abs(Number(item.amount))
    const ts = parseTime(String(item.time ?? ''))
    if (!Number.isFinite(amount) || amount <= 0) continue
    drafts.push({
      amount,
      direction: item.direction === 'income' ? 'income' : 'expense',
      occurredAt: Number.isNaN(ts) ? Date.now() : ts,
      merchant: String(item.merchant ?? '未知商户'),
      source: 'llm',
      paymentMethod: String(item.paymentMethod ?? '截图导入'),
      note: '',
      raw: JSON.stringify(item),
    })
  }
  return drafts
}

/** 通用 CSV 经 LLM 解析为结构化草稿（未匹配内置模板时使用） */
export async function parseCsvWithLLM(
  cfg: LLMConfig,
  rows: Record<string, string>[],
): Promise<DraftTransaction[]> {
  const system = `你是账单解析助手。下面是 CSV 表格的若干行（JSON）。请提取每一笔交易，输出 JSON 数组，字段：amount(正数), direction("income"或"expense"), time(日期时间字符串), merchant(商户或描述), paymentMethod(支付方式)。忽略非交易行。只输出 JSON。`
  const user = JSON.stringify(rows.slice(0, 50))
  const reply = await chat(
    cfg,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { maxTokens: 3000 },
  )
  const parsed = extractJson(reply)
  if (!Array.isArray(parsed)) throw new Error('返回格式非数组')
  const drafts: DraftTransaction[] = []
  for (const item of parsed as Record<string, unknown>[]) {
    const amount = Math.abs(Number(item.amount))
    const ts = parseTime(String(item.time ?? ''))
    if (!Number.isFinite(amount) || amount <= 0) continue
    drafts.push({
      amount,
      direction: item.direction === 'income' ? 'income' : 'expense',
      occurredAt: Number.isNaN(ts) ? Date.now() : ts,
      merchant: String(item.merchant ?? '未知商户'),
      source: 'llm',
      paymentMethod: String(item.paymentMethod ?? 'CSV导入'),
      note: '',
      raw: JSON.stringify(item),
    })
  }
  return drafts
}
