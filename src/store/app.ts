import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface AppState {
  ledgerId: number | null
  setLedgerId: (id: number) => void
  theme: Theme
  toggleTheme: () => void
  initTheme: () => void
}

const THEME_KEY = 'payment-theme'
const LEDGER_KEY = 'payment-ledger'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

export const useApp = create<AppState>((set, get) => ({
  ledgerId: Number(localStorage.getItem(LEDGER_KEY)) || null,
  setLedgerId: (id) => {
    localStorage.setItem(LEDGER_KEY, String(id))
    set({ ledgerId: id })
  },
  theme: (localStorage.getItem(THEME_KEY) as Theme) || 'light',
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(THEME_KEY, next)
    applyTheme(next)
    set({ theme: next })
  },
  initTheme: () => {
    applyTheme(get().theme)
  },
}))
