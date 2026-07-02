import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { buildTagTree, type TagNode } from '../lib/tags'

export default function TagsPage() {
  const tags = useLiveQuery(() => db.tags.toArray(), [])
  const [newRoot, setNewRoot] = useState('')

  if (!tags) return <div className="text-[var(--muted)]">加载中…</div>
  const tree = buildTagTree(tags)

  const addRoot = async () => {
    const name = newRoot.trim()
    if (!name) return
    await db.tags.add({ name, parentId: null, preset: false, special: null })
    setNewRoot('')
  }

  return (
    <div className="space-y-6">
      <header className="surface p-6 md:p-8">
        <div className="eyebrow">Taxonomy</div>
        <h1 className="page-title mt-3">整理统计口径。</h1>
        <p className="page-lede mt-5">标签只服务于复盘，不需要过度精细。把资金搬运类排除在收支统计之外，避免把还款、转账看成真实消费。</p>
      </header>

      <section className="surface max-w-3xl p-5">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          value={newRoot}
          onChange={(e) => setNewRoot(e.target.value)}
          placeholder="新增一级标签"
          className="field"
        />
        <button onClick={addRoot} className="btn btn-primary">
          添加
        </button>
        </div>

        <div className="mt-5 space-y-2">
          {tree.map((node) => (
            <TagItem key={node.id} node={node} level={0} />
          ))}
        </div>
      </section>
    </div>
  )
}

function TagItem({ node, level }: { node: TagNode; level: number }) {
  const [adding, setAdding] = useState(false)
  const [childName, setChildName] = useState('')
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(node.name)

  const addChild = async () => {
    const n = childName.trim()
    if (!n) return
    await db.tags.add({ name: n, parentId: node.id!, preset: false, special: null })
    setChildName('')
    setAdding(false)
  }

  const rename = async () => {
    const n = name.trim()
    if (n) await db.tags.update(node.id!, { name: n })
    setEditing(false)
  }

  const remove = async () => {
    if (!confirm(`删除标签「${node.name}」？其子标签与相关账单将变为未分类。`)) return
    const ids = [node.id!]
    const children = await db.tags.where('parentId').equals(node.id!).toArray()
    ids.push(...children.map((c) => c.id!))
    await db.transactions.where('tagId').anyOf(ids).modify({ tagId: null })
    await db.tags.bulkDelete(ids)
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface-solid)] px-3 py-2"
        style={{ marginLeft: level * 20 }}
      >
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => e.key === 'Enter' && rename()}
            autoFocus
            className="field !px-2 !py-1 text-sm"
          />
        ) : (
          <span className="flex-1 text-sm">
            {node.name}
            {node.special && (
              <span className="tag-chip ml-2 text-[var(--brass)]">
                不计统计
              </span>
            )}
          </span>
        )}
        {level === 0 && (
          <button onClick={() => setAdding((v) => !v)} className="text-xs font-semibold text-[var(--tide)] hover:text-[var(--brass)]">
            + 子标签
          </button>
        )}
        <button onClick={() => setEditing((v) => !v)} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
          重命名
        </button>
        <button onClick={remove} className="text-xs text-[var(--muted)] hover:text-[var(--rose)]">
          删除
        </button>
      </div>

      {adding && (
        <div className="mt-1 flex gap-2" style={{ marginLeft: (level + 1) * 20 }}>
          <input
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addChild()}
            placeholder="子标签名称"
            autoFocus
            className="field flex-1 !py-1.5 text-sm"
          />
          <button onClick={addChild} className="btn btn-primary !min-h-0 !py-1.5 text-sm">
            添加
          </button>
        </div>
      )}

      <div className="mt-1 space-y-1">
        {node.children.map((c) => (
          <TagItem key={c.id} node={c} level={level + 1} />
        ))}
      </div>
    </div>
  )
}
