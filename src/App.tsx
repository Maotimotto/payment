import { Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ensureSeed } from './db/db'
import { useApp } from './store/app'
import Dashboard from './pages/Dashboard'

export default function App() {
  const { initTheme } = useApp()

  useEffect(() => {
    ensureSeed()
    initTheme()
  }, [initTheme])

  return (
    <div className="app-shell app-shell-immersive">
      <main className="immersive-main">
        <Suspense fallback={<div className="grid min-h-screen place-items-center text-[var(--muted)]">加载中…</div>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/import" element={<Navigate to="/" replace />} />
            <Route path="/transactions" element={<Navigate to="/" replace />} />
            <Route path="/tags" element={<Navigate to="/" replace />} />
            <Route path="/settings" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
