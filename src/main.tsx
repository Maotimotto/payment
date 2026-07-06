import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '@fontsource-variable/manrope'
import '@fontsource/zcool-xiaowei'
import App from './App'
import './index.css'

if (import.meta.env.DEV) {
  void import('./lib/seed')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
