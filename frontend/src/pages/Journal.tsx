import { useCallback, useEffect, useState } from 'react'
import { get } from '../api'
import type { AuditEntry, AuditStats, Paged } from '../types'
import { Kpi, Spinner } from '../components/ui'

const PAGE_SIZE = 25

const DETAIL_LABELS: Record<string, string> = {
  filename: 'файл', new: 'новых', updated: 'обновлено', question: 'вопрос',
  llm_used: 'модель', kind: 'вид', record_id: 'запись', id: 'id',
  query: 'запрос', hits: 'найдено', chunks: 'фрагментов',
  status: 'статус', error: 'ошибка', removed: 'удалено',
}

function formatDetails(details: Record<string, unknown> | null): string {
  if (!details || Object.keys(details).length === 0) return '—'
  return Object.entries(details)
    .map(([k, v]) => {
      const label = DETAIL_LABELS[k] || k
      const value = typeof v === 'boolean' ? (v ? 'да' : 'нет') : String(v)
      return `${label}: ${value.length > 90 ? value.slice(0, 90) + '…' : value}`
    })
    .join(' · ')
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit',
                                     hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function Journal() {
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [data, setData] = useState<Paged<AuditEntry> | null>(null)
  const [action, setAction] = useState('')
  const [username, setUsername] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    const params = new URLSearchParams({
      action, username, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE),
    })
    get<{ items: AuditEntry[]; total: number }>(`/audit?${params}`)
      .then(r => setData({ items: r.items, total: r.total, page, pages: Math.max(1, Math.ceil(r.total / PAGE_SIZE)) }))
      .finally(() => setBusy(false))
    get<AuditStats>('/audit/stats').then(setStats).catch(() => {})
  }, [action, username, page])

  useEffect(load, [load])
  useEffect(() => setPage(1), [action, username])

  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <Kpi label="Событий в журнале" value={stats?.total ?? '—'} sub="с момента запуска системы" />
        <Kpi label="За последние сутки" value={stats?.last_24h ?? '—'} sub="действий пользователей" />
        <Kpi label="Пользователей" value={stats?.by_user.length ?? '—'}
             sub={stats?.by_user.slice(0, 3).map(u => `${u.username} — ${u.count}`).join(' · ')} />
      </div>

      <div className="card mt-lg">
        <div className="row spread mb-lg">
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>Журнал действий</h3>
            <div className="typo-legend-12 text-grey" style={{ marginTop: 6 }}>
              Каждое действие фиксируется: кто, что, когда и сколько это заняло.
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={busy}>
            {busy ? 'Обновляю…' : 'Обновить'}
          </button>
        </div>

        <div className="row mb-lg" style={{ alignItems: 'flex-end' }}>
          <label className="fld">
            Действие
            <select className="input" value={action} onChange={e => setAction(e.target.value)}>
              <option value="">Все действия</option>
              {stats?.by_action.map(a => (
                <option key={a.action} value={a.action}>{a.label} ({a.count})</option>
              ))}
            </select>
          </label>
          <label className="fld">
            Пользователь
            <select className="input" value={username} onChange={e => setUsername(e.target.value)}>
              <option value="">Все пользователи</option>
              {stats?.by_user.map(u => (
                <option key={u.username} value={u.username}>{u.username} ({u.count})</option>
              ))}
            </select>
          </label>
        </div>

        {!data ? <Spinner /> : data.items.length === 0 ? (
          <div className="empty">Событий не найдено</div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr><th style={{ width: 160 }}>Время</th><th style={{ width: 110 }}>Пользователь</th>
                    <th style={{ width: 230 }}>Действие</th><th style={{ width: 110 }}>Длительность</th>
                    <th>Детали</th></tr>
              </thead>
              <tbody>
                {data.items.map(e => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatTime(e.at)}</td>
                    <td className="cell-main">{e.username || '—'}</td>
                    <td>{e.action_label}</td>
                    <td>{e.duration_ms === null ? '—' : `${(e.duration_ms / 1000).toFixed(1).replace('.', ',')} с`}</td>
                    <td className="text-grey" style={{ fontSize: 13 }}>{formatDetails(e.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pager">
              <span>Всего: {data.total}</span>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1}
                      onClick={() => setPage(p => p - 1)}>Назад</button>
              <span>стр. {data.page} из {data.pages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= data.pages}
                      onClick={() => setPage(p => p + 1)}>Вперёд</button>
            </div>
          </>
        )}
      </div>

      {stats && stats.by_action.length > 0 && (
        <div className="card mt-lg">
          <h3 className="card-title">Что фиксируется</h3>
          <div className="grid cols-3">
            {stats.by_action.map(a => (
              <div key={a.action} className="row spread" style={{ gap: 8 }}>
                <span className="typo-body-14">{a.label}</span>
                <span className="pill pill-blue">{a.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
