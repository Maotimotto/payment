export function formatMoney(n: number): string {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatDay(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function monthKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(key: string): string {
  const [, m] = key.split('-')
  return `${Number(m)}月`
}

/** 当月起止时间戳 */
export function monthRange(base = new Date()): { start: number; end: number } {
  const start = new Date(base.getFullYear(), base.getMonth(), 1).getTime()
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 1).getTime()
  return { start, end }
}

/** 解析多种常见时间格式为时间戳，失败返回 NaN */
export function parseTime(s: string): number {
  if (!s) return NaN
  const trimmed = s.trim()
  // 兼容 2024/01/02 与 2024-01-02
  const normalized = trimmed.replace(/\//g, '-').replace(/\./g, '-')
  const t = Date.parse(normalized)
  if (!Number.isNaN(t)) return t
  return Date.parse(trimmed)
}
