import { create } from 'zustand'
import { getLLMConfig } from '../db/db'
import { aiTagTransactions } from '../lib/ingest'
import type { Transaction } from '../types'

export interface AiTagProgress {
  stage: string
  done: number
  total: number
}

interface AiTagState {
  running: boolean
  progress: AiTagProgress | null
  message: string
  /** 执行 AI 打标签；状态存于全局，切换路由不会丢失进度 */
  run: (targets: Transaction[]) => Promise<void>
  clearMessage: () => void
}

export const useAiTag = create<AiTagState>((set, get) => ({
  running: false,
  progress: null,
  message: '',
  run: async (targets) => {
    if (get().running || targets.length === 0) return
    set({ running: true, message: '', progress: { stage: '准备中', done: 0, total: targets.length } })
    try {
      const cfg = await getLLMConfig()
      const res = await aiTagTransactions(cfg, targets, (p) => set({ progress: p }))
      set({
        progress: null,
        message: `已为 ${res.tagged} 笔打标签${
          res.created.length > 0 ? `，新建标签：${res.created.join('、')}` : ''
        }`,
      })
    } catch (e) {
      set({ progress: null, message: `打标签失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      set({ running: false })
    }
  },
  clearMessage: () => set({ message: '' }),
}))
