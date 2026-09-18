import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { get, post } from '../api'
import type { AuthConfig, User } from '../types'
import { useAuth } from '../App'

export default function Login() {
  const { setUser, health } = useAuth()
  const nav = useNavigate()
  const [cfg, setCfg] = useState<AuthConfig | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    get<AuthConfig>('/auth/config')
      .then(setCfg)
      // если конфигурация не пришла, показываем локальную форму: без неё
      // на экране входа не останется ничего
      .catch(() => setCfg({ local_login: true, oidc: false, oidc_label: '' }))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const u = await post<User>('/auth/login', { username, password })
      setUser(u)
      nav('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <img src="/logo.svg" height={40} alt="" />
          <div>
            <div className="t">{health?.app_title || 'ИИ-помощник'}</div>
            {health?.app_subtitle && <div className="s">{health.app_subtitle}</div>}
          </div>
        </div>

        <div className="login-body">
          {cfg?.oidc && (
            <>
              {/* Переход целиком на стороне браузера: сервер отвечает редиректом
                  на Keycloak, поэтому это ссылка, а не fetch. */}
              <a className="btn btn-block" href="/api/auth/oidc/login">
                {cfg.oidc_label || 'Единый вход'}
              </a>
              {cfg.local_login && <div className="login-or">или по логину и паролю</div>}
            </>
          )}

          {cfg?.local_login !== false && (
            <form onSubmit={submit} style={{ display: 'contents' }}>
              <label className="fld">
                Логин
                <input className="input" value={username} onChange={e => setUsername(e.target.value)}
                       autoFocus={!cfg?.oidc} autoComplete="username" />
              </label>
              <label className="fld">
                Пароль
                <input className="input" type="password" value={password}
                       onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
              </label>
              {error && <div className="alert alert-error">{error}</div>}
              <button className="btn" disabled={busy || !username || !password}>
                {busy ? 'Вход…' : 'Войти'}
              </button>
            </form>
          )}

          {error && cfg?.local_login === false && <div className="alert alert-error">{error}</div>}

          {/* Демо-доступ задаётся в backend/app/seed.py и в realm Keycloak.
              Перед сдачей сверьте подсказку с реальностью. */}
          <div className="login-hint">
            Демо-доступ: <b>marina</b> (HR-партнёр), <b>ruk</b> (руководитель), <b>exp</b> (специалист),
            <b>ana</b> (аналитик) — пароль <b>demo2026</b>
          </div>
        </div>
      </div>
    </div>
  )
}
