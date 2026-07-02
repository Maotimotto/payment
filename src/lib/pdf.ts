import * as pdfjsLib from 'pdfjs-dist'
// Vite 方式加载 worker（保持纯本地、不依赖 CDN）
import PdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorkerUrl

/** PDF 需要密码（或密码错误）时抛出，供 UI 弹出密码输入 */
export class PdfPasswordError extends Error {
  constructor(public wrong: boolean) {
    super(wrong ? 'PDF 密码错误' : 'PDF 已加密，需要密码')
    this.name = 'PdfPasswordError'
  }
}

/** 中国银行借记卡明细的列（与内置 BOC 模板一致） */
const BOC_HEADERS = [
  '记账日期', '记账时间', '币别', '金额', '余额', '交易名称',
  '渠道', '网点名称', '附言', '对方账户名', '对方卡号/账号', '对方开户行',
]

interface Item {
  x: number
  str: string
}

async function loadDocument(data: Uint8Array, password?: string) {
  try {
    return await pdfjsLib.getDocument({ data, password }).promise
  } catch (e: unknown) {
    const err = e as { name?: string; code?: number }
    if (err?.name === 'PasswordException') {
      // code 1 = 需要密码，code 2 = 密码错误
      throw new PdfPasswordError(err.code === 2)
    }
    throw e
  }
}

/** CSV 字段转义 */
function csvCell(v: string): string {
  const s = v.replace(/\r?\n/g, '').trim()
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim())

/**
 * 解析中国银行加密/明文 PDF，还原交易表格并转成内置 BOC 模板可识别的 CSV 文本。
 * - 加密且未提供/密码错误时抛出 PdfPasswordError。
 * - 非中国银行结构的 PDF 抛出普通 Error。
 */
export async function bocPdfToCsv(file: File, password?: string): Promise<string> {
  const buf = await file.arrayBuffer()
  const doc = await loadDocument(new Uint8Array(buf), password)

  // 1) 先用任意一页的表头确定各列 x 坐标
  let colXs: number[] | null = null
  for (let p = 1; p <= doc.numPages && !colXs; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const rows = groupRows(tc.items as unknown as RawItem[])
    for (const items of rows) {
      const joined = items.map((i) => i.str).join('')
      if (joined.includes('记账日期') && joined.includes('对方账户名')) {
        colXs = BOC_HEADERS.map((h) => {
          const hit = items.find((i) => i.str.includes(h) || h.includes(i.str.replace(/\s/g, '')))
          return hit ? hit.x : 0
        })
        break
      }
    }
  }
  if (!colXs || colXs.some((x) => x === 0)) {
    throw new Error('未在 PDF 中识别到中国银行交易明细表格，请确认文件来源。')
  }

  const bounds = colXs.slice(0, -1).map((x, i) => (x + colXs![i + 1]) / 2)
  const colIndex = (x: number) => {
    for (let i = 0; i < bounds.length; i++) if (x < bounds[i]) return i
    return bounds.length
  }

  // 2) 逐页还原数据行（含换行续行合并）
  const records: string[][] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const rows = groupRows(tc.items as unknown as RawItem[])
    let cur: string[] | null = null
    for (const items of rows) {
      const joined = items.map((i) => i.str).join('')
      if (joined.includes('记账日期') && joined.includes('对方账户名')) continue
      if (joined.includes('END') || joined.includes('温馨提示') || /第\s*\d+\s*页/.test(joined)) {
        cur = null
        continue
      }
      const first = items[0]?.str.trim() ?? ''
      if (isDate(first)) {
        cur = Array.from({ length: BOC_HEADERS.length }, () => '')
        for (const it of items) cur[colIndex(it.x)] += it.str
        records.push(cur)
      } else if (cur) {
        for (const it of items) cur[colIndex(it.x)] += it.str
      }
    }
  }

  if (records.length === 0) {
    throw new Error('未从 PDF 中解析到交易记录。')
  }

  const lines = [BOC_HEADERS.join(',')]
  for (const r of records) lines.push(r.map(csvCell).join(','))
  return lines.join('\n')
}

interface RawItem {
  str: string
  transform: number[]
}

/** 按 y 坐标把文本项分组为行，行内按 x 升序 */
function groupRows(items: RawItem[]): Item[][] {
  const map = new Map<number, Item[]>()
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue
    const y = Math.round(it.transform[5])
    if (!map.has(y)) map.set(y, [])
    map.get(y)!.push({ x: it.transform[4], str: it.str })
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, arr]) => arr.sort((a, b) => a.x - b.x))
}

/** 提取 PDF 全文（供大模型兜底解析非内置格式 PDF 使用） */
export async function extractPdfText(file: File, password?: string): Promise<string> {
  const buf = await file.arrayBuffer()
  const doc = await loadDocument(new Uint8Array(buf), password)
  const parts: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const rows = groupRows(tc.items as unknown as RawItem[])
    for (const items of rows) parts.push(items.map((i) => i.str).join(' '))
  }
  return parts.join('\n')
}
