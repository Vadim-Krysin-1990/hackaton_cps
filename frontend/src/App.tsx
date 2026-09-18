import { createContext, useContext, useEffect, useState } from 'react'
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { get, post } from './api'
import type { Health, User } from './types'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Interviews from './pages/Interviews'
import Transcripts from './pages/Transcripts'
import Journal from './pages/Journal'
import About from './pages/About'

interface AppCtx {
  user: User | null
  setUser: (u: User | null) => void
  health: Health | null
}

const Ctx = createContext<AppCtx>({ user: null, setUser: () => {}, health: null })
export const useAuth = () => useContext(Ctx)

/** Экраны заготовки. Убирайте лишние и добавляйте свои — это единственное место,
 *  где описана навигация. */
const TABS = [
  { to: '/', label: 'Дашборд', end: true },
  { to: '/interviews', label: 'Интервью' },
  { to: '/upload', label: 'Загрузка' },
  { to: '/journal', label: 'Журнал' },
  { to: '/about', label: 'О сервисе' },
]

function Shell() {
  const { user, setUser, health } = useAuth()
  const nav = useNavigate()
  if (!user) return <Navigate to="/login" replace />
  const logout = async () => {
    let endSession = ''
    try {
      const r = await post<{ end_session_url?: string }>('/auth/logout')
      endSession = r.end_session_url || ''
    } catch { /* сессия и так истекла */ }
    setUser(null)
    // При входе через Keycloak своей cookie мало: сессия провайдера живёт
    // дольше, и следующий вход прошёл бы молча под тем же пользователем.
    if (endSession) window.location.href = endSession
    else nav('/login')
  }
  return (
    <>
      <header className="page-header">
        <img src="/logo.svg" height={36} alt="" style={{ flexShrink: 0 }} />
        <div className="sep" />
        <div>
          <div className="ph-title">{health?.app_title || 'ИИ-помощник'}</div>
          <div className="ph-sub">{health?.app_subtitle || ''}</div>
        </div>
        <div className="ph-user">
          <div className="name">{user.full_name || user.username}</div>
          <div className="role">{user.role_label}</div>
        </div>
        <button className="btn-logout" onClick={logout}>Выйти</button>
      </header>
      <nav className="nav-tabs">
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>
        ))}
      </nav>
      <main className="container">
        <Outlet />
      </main>
    </>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    get<Health>('/health').then(setHealth).catch(() => {})
    get<User>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  // заголовок вкладки берётся из настроек сервиса — бренд правится в .env
  useEffect(() => {
    if (health?.app_title) document.title = health.app_title
  }, [health])

  if (loading) return <Spinner />
  return (
    <Ctx.Provider value={{ user, setUser, health }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/interviews" element={<Interviews />} />
          <Route path="/upload" element={<Transcripts />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/about" element={<About />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Ctx.Provider>
  )
}
