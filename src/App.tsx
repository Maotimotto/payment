import { useEffect } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureSeed } from './db/db'
import { useApp } from './store/app'
import Dashboard from './pages/Dashboard'
import ImportPage from './pages/ImportPage'
import Transactions from './pages/Transactions'
import TagsPage from './pages/TagsPage'
import Settings from './pages/Settings'
import { BrandLockup } from './components/BrandMark'
import { ThemedIcon, type ThemedIconName } from './components/ThemedIcon'

const PRIMARY_NAV: { to: string; label: string; end: boolean; icon: ThemedIconName; hint: string }[] = [
  { to: '/', label: '概览', end: true, icon: 'overview', hint: '月度潮位' },
  { to: '/import', label: '导入', end: false, icon: 'import', hint: '归集流水' },
  { to: '/transactions', label: '流水', end: false, icon: 'transactions', hint: '适度校准' },
]

const MANAGE_NAV: { to: string; label: string; icon: ThemedIconName }[] = [
  { to: '/tags', label: '标签口径', icon: 'tags' },
  { to: '/settings', label: '保险柜', icon: 'settings' },
]

function LedgerSelector() {
  const { ledgerId, setLedgerId } = useApp()
  const ledgers = useLiveQuery(() => db.ledgers.toArray(), [])

  useEffect(() => {
    if (ledgers && ledgers.length > 0 && (ledgerId == null || !ledgers.some((l) => l.id === ledgerId))) {
      setLedgerId(ledgers[0].id!)
    }
  }, [ledgers, ledgerId, setLedgerId])

  if (!ledgers) return <div className="h-11 rounded border border-white/10" />

  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-white/48">Current ledger</span>
      <select
        value={ledgerId ?? ''}
        onChange={(e) => setLedgerId(Number(e.target.value))}
        className="w-full rounded-[8px] border border-white/14 bg-white/[0.08] px-3 py-2.5 text-sm text-white outline-none transition focus:border-white/40"
      >
        {ledgers.map((l) => (
          <option key={l.id} value={l.id} className="bg-slate-950 text-white">
            {l.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function PrivacySignal() {
  return (
    <div className="rounded-[8px] border border-white/12 bg-white/[0.06] p-3">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white/72">
        <ThemedIcon name="vault" className="h-4 w-4 text-[var(--brass)]" />
        Local vault
      </div>
      <p className="mt-2 text-xs leading-5 text-white/56">IndexedDB 本地保存，无账号、无后端。LLM 只在你启用后参与解析。</p>
    </div>
  )
}

export default function App() {
  const { theme, toggleTheme, initTheme } = useApp()

  useEffect(() => {
    ensureSeed()
    initTheme()
  }, [initTheme])

  return (
    <div className="app-shell">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[284px_minmax(0,1fr)]">
        <aside className="vault-sidebar flex flex-col gap-6 p-5 lg:min-h-screen lg:p-6">
          <div>
            <div className="flex items-start justify-between gap-4">
              <BrandLockup />
              <button
                onClick={toggleTheme}
                className="rounded-full border border-white/14 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/70 transition hover:border-white/32 hover:text-white"
                title={theme === 'dark' ? '切换浅色' : '切换深色'}
              >
                {theme === 'dark' ? 'Light' : 'Dark'}
              </button>
            </div>
            <div className="mt-5 h-px bg-gradient-to-r from-white/32 via-white/10 to-transparent" />
          </div>

          <LedgerSelector />

          <nav className="flex flex-col gap-2">
            {PRIMARY_NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
              >
                <ThemedIcon name={n.icon} className="nav-icon" />
                <span className="nav-copy">
                  <span>{n.label}</span>
                  <span className="nav-code">{n.hint}</span>
                </span>
              </NavLink>
            ))}
          </nav>

          <div className="manage-nav">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/36">Manage</div>
            <div className="grid gap-2">
              {MANAGE_NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link nav-link-secondary ${isActive ? 'nav-link-active' : ''}`}>
                  <ThemedIcon name={n.icon} className="nav-icon" />
                  <span>{n.label}</span>
                </NavLink>
              ))}
            </div>
          </div>

          <div className="hidden lg:block">
            <PrivacySignal />
          </div>

          <div className="mt-auto hidden text-[10px] uppercase tracking-[0.24em] text-white/38 lg:block">
            Tide ledger · Local first · LLM optional
          </div>
        </aside>

        <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-10 lg:py-9">
          <div className="mx-auto max-w-[1440px]">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/tags" element={<TagsPage />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  )
}
