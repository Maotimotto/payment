import * as XLSX from 'xlsx'
import type { Tag, Transaction } from '../types'
import { formatDate } from './format'
import { tagFullName } from './tags'

export function exportTransactionsToExcel(
  transactions: Transaction[],
  tags: Tag[],
  ledgerName: string,
): void {
  const rows = transactions.map((t) => ({
    时间: formatDate(t.occurredAt),
    方向: t.direction === 'income' ? '收入' : '支出',
    金额: t.amount,
    商户: t.merchant,
    标签: tagFullName(t.tagId, tags),
    支付方式: t.paymentMethod,
    来源: t.source,
    计入统计: t.countInStats ? '是' : '否',
    组合支付: t.comboGroupId ? '是' : '',
    备注: t.note,
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '账单明细')
  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `${ledgerName}_账单_${date}.xlsx`)
}
