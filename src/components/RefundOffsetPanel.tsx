import { db } from '../db/db'
import { formatDate, formatMoney } from '../lib/format'
import type { RefundPair } from '../lib/dedup'

/**
 * 退款抵消面板：展示「消费 + 退款」抵消对，支持成对删除 / 全部删除。
 * 受控组件：pairs 由父级持有，删除后通过 onUpdate 回传剩余项。
 */
export function RefundOffsetPanel({
  pairs,
  onUpdate,
  onClose,
}: {
  pairs: RefundPair[]
  onUpdate: (next: RefundPair[]) => void
  onClose?: () => void
}) {
  const deletePair = async (p: RefundPair) => {
    await db.transactions.bulkDelete([p.expense.id!, p.income.id!])
    onUpdate(pairs.filter((x) => x !== p))
  }

  const deleteAll = async () => {
    if (!pairs.length) return
    if (!confirm(`确认删除全部 ${pairs.length} 组退款抵消（共 ${pairs.length * 2} 笔）？此操作不可恢复。`)) return
    await db.transactions.bulkDelete(pairs.flatMap((p) => [p.expense.id!, p.income.id!]))
    onUpdate([])
  }

  return (
    <div className="surface border-[color-mix(in_oklch,var(--brass)_42%,transparent)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="eyebrow text-[var(--brass)]">Refund offset</div>
          <div className="display mt-1 text-2xl">退款抵消 {pairs.length} 组</div>
        </div>
        <div className="flex gap-2">
          {pairs.length > 0 && (
            <button onClick={deleteAll} className="btn btn-danger !min-h-0 !py-1.5 text-xs">
              全部删除（{pairs.length * 2} 笔）
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="btn btn-ghost !min-h-0 !py-1.5 text-xs"
            >
              收起
            </button>
          )}
        </div>
      </div>

      {pairs.length === 0 ? (
        <div className="text-xs text-[var(--muted)]">未检测到“消费 + 退款”抵消对（金额相同、退款在消费之后、对方路径一致）。</div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-[var(--muted)]">
            特征：金额相同、退款发生在消费之后、收支为同一对方路径（原路退回）。确认后将成对删除。
          </div>
          {pairs.map((p, i) => (
            <div key={i} className="surface-flat p-3 text-sm">
              <div className="flex items-center justify-between py-0.5">
                <span className="tag-chip text-[var(--jade)]">消费</span>
                <span className="flex-1 truncate px-2">{p.expense.merchant}</span>
                <span className="text-xs text-[var(--muted)]">{formatDate(p.expense.occurredAt)}</span>
                <span className="ml-3 w-24 text-right font-[var(--font-num)] amount-expense">- {formatMoney(p.expense.amount)}</span>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <span className="tag-chip text-[var(--coral)]">退款</span>
                <span className="flex-1 truncate px-2">{p.income.merchant}</span>
                <span className="text-xs text-[var(--muted)]">{formatDate(p.income.occurredAt)}</span>
                <span className="ml-3 w-24 text-right font-[var(--font-num)] amount-income">+ {formatMoney(p.income.amount)}</span>
              </div>
              <div className="mt-2 text-right">
                <button onClick={() => deletePair(p)} className="btn btn-danger !min-h-0 !py-1 text-xs">
                  删除该对
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
