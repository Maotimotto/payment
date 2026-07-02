import type { Tag } from '../types'

export interface TagNode extends Tag {
  children: TagNode[]
}

/** 把扁平标签列表构建成多级树 */
export function buildTagTree(tags: Tag[]): TagNode[] {
  const map = new Map<number, TagNode>()
  const roots: TagNode[] = []
  for (const t of tags) {
    if (t.id != null) map.set(t.id, { ...t, children: [] })
  }
  for (const node of map.values()) {
    if (node.parentId != null && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/** 标签全路径名，如 餐饮 / 外卖 */
export function tagFullName(tagId: number | null, tags: Tag[]): string {
  if (tagId == null) return '未分类'
  const byId = new Map(tags.map((t) => [t.id!, t]))
  const parts: string[] = []
  let cur = byId.get(tagId)
  let guard = 0
  while (cur && guard++ < 10) {
    parts.unshift(cur.name)
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined
  }
  return parts.join(' / ') || '未分类'
}

/** 找到标签的一级根标签 id（用于按一级聚合饼图） */
export function rootTagId(tagId: number | null, tags: Tag[]): number | null {
  if (tagId == null) return null
  const byId = new Map(tags.map((t) => [t.id!, t]))
  let cur = byId.get(tagId)
  let guard = 0
  while (cur && cur.parentId != null && guard++ < 10) {
    cur = byId.get(cur.parentId)
  }
  return cur?.id ?? null
}

/** 判断该标签是否应排除在收支统计之外（资金搬运 / 信用卡还款 / 投资理财） */
export function isExcludedFromStats(tagId: number | null, tags: Tag[]): boolean {
  if (tagId == null) return false
  const byId = new Map(tags.map((t) => [t.id!, t]))
  let cur = byId.get(tagId)
  let guard = 0
  while (cur && guard++ < 10) {
    if (cur.special === 'credit_repay' || cur.special === 'transfer' || cur.special === 'investment') return true
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined
  }
  return false
}

/** @deprecated 改用 isExcludedFromStats */
export const isTransferLike = isExcludedFromStats
