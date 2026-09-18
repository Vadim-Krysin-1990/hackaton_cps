import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtNum, get } from '../api'
import type { Dashboard as DashboardData, Insight, Metrics } from '../types'
import { Kpi, Spinner } from '../components/ui'
import { DonutChart, HBarChart } from '../components/charts'
import { RelationGraph } from '../components/exitcharts'

const RISK_RU: Record<string, string> = { High: 'высокий', Medium: 'средний', Low: 'низкий' }

const fmtTime = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Дашборд для руководителя: частота системных проблем по всем интервью,
 *  связи между ними и вывод ИИ, что с главной делать. */
export default function Dashboard() {
  const [d, setD] = useState<DashboardData | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [ins, setIns] = useState<Insight | null>(null)
  const [insBusy, setInsBusy] = useState(false)

  const loadInsight = (refresh = false) => {
    setInsBusy(true)
    get<Insight>(`/interviews/insight${refresh ? '?refresh=true' : ''}`).then(setIns).catch(() => {}).finally(() => setInsBusy(false))
  }

  useEffect(() => {
    get<DashboardData>('/interviews/dashboard').then(setD).catch(() => {})
    get<Metrics>('/metrics').then(setMetrics).catch(() => {})
    loadInsight()
  }, [])

  if (!d) return <Spinner />
  const analyze = metrics?.operations.find(o => o.action === 'interview_analyze')
  const savedMin = analyze ? Math.max(0, (d.manual_minutes - analyze.avg_ms / 60000) * analyze.count) : 0
  const high = d.by_risk.find(r => r.name === 'High')?.count || 0
  const acc = d.verification.checked ? Math.round(d.verification.accepted / d.verification.checked * 100) : 0

  return (
    <>
      <div className="kpi-row">
        <Kpi label="Интервью разобрано" value={d.total} />
        <Kpi label="Самая частая проблема" value={d.top_problem || '—'} text />
        <Kpi label="Высокий риск для команды" value={high} accent={high ? 'red' : undefined} />
        <Kpi label="Цитат подтверждено" value={d.verification.checked ? `${acc}%` : '—'} />
      </div>

      {d.total === 0 && (
        <div className="card mt-lg">
          <div className="alert alert-info">
            Интервью пока нет. Загрузите .txt на экране <Link to="/upload">«Загрузка»</Link> — можно сразу несколько файлов.
          </div>
        </div>
      )}

      {d.total > 0 && (
        <>
          <div className="card mt-lg">
            <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 className="card-title" style={{ margin: 0 }}>Вывод ИИ: что делать с главной проблемой</h3>
                <div className="typo-legend-12 text-grey">
                  {ins?.ready ? `по ${ins.interviews_count} интервью · ${ins.engine} · обновлено ${fmtTime(ins.created_at)} · пересчитывается при новых интервью`
                              : insBusy ? 'модель формулирует вывод…' : 'вывод ещё не построен'}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" disabled={insBusy} onClick={() => loadInsight(true)}>
                {insBusy ? 'Считаю…' : 'Пересчитать'}
              </button>
            </div>
            {ins?.ready ? (
              <div className="mt-lg">
                <div className="typo-charts-header-2">{ins.headline}</div>
                <div className="typo-body-15 mt-lg">{ins.summary}</div>
                {ins.signals.length > 0 && (
                  <div className="alert alert-warn mt-lg">
                    <b>Сигналы:</b>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{ins.signals.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                <table className="table mt-lg">
                  <thead><tr><th>Действие</th><th style={{ width: 200 }}>Ответственный</th><th style={{ width: '35%' }}>Эффект</th></tr></thead>
                  <tbody>
                    {ins.recommendations.map((r, i) => (
                      <tr key={i}><td className="cell-main">{r.action}</td><td>{r.owner}</td><td>{r.effect}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : insBusy ? <Spinner /> : null}
          </div>

          <div className="grid cols-2 mt-lg">
            <div className="card">
              <h3 className="card-title">Системные проблемы: в скольких интервью названы</h3>
              <HBarChart data={d.pains.map(p => ({ name: p.name, count: p.count }))} max={9} />
            </div>
            <div className="card">
              <h3 className="card-title">Причины ухода</h3>
              <DonutChart data={d.by_reason} centerLabel="интервью" />
            </div>
          </div>

          <div className="grid cols-2 mt-lg">
            <div className="card">
              <h3 className="card-title">Какие проблемы идут вместе</h3>
              <RelationGraph nodes={d.pains.slice(0, 8)} edges={d.edges} />
              <div className="mt-lg"><Link to="/graph">Полный клубок связей: отделы, руководители, причины →</Link></div>
            </div>
            <div className="card">
              <h3 className="card-title">Зоны риска для команды</h3>
              <DonutChart data={d.by_risk.map(r => ({ name: RISK_RU[r.name] || r.name, count: r.count }))} centerLabel="интервью" />
              <h3 className="card-title mt-lg">Что работает хорошо</h3>
              <HBarChart data={d.practices} max={5} />
            </div>
          </div>

          <div className="card mt-lg">
            <h3 className="card-title">Было / стало</h3>
            <div className="grid cols-3">
              <div>
                <div className="kpi-label">Вручную</div>
                <div className="kpi-value" style={{ fontSize: 32 }}>{d.manual_minutes} мин</div>
                <div className="typo-legend-12 text-grey">на разбор одной беседы</div>
              </div>
              <div>
                <div className="kpi-label">Сервис</div>
                <div className="kpi-value" style={{ fontSize: 32 }}>{analyze ? `${(analyze.avg_ms / 1000).toFixed(1).replace('.', ',')} с` : '—'}</div>
                <div className="typo-legend-12 text-grey">в среднем на паспорт, по журналу</div>
              </div>
              <div>
                <div className="kpi-label">Сэкономлено</div>
                <div className="kpi-value" style={{ fontSize: 32 }}>{fmtNum(Math.round(savedMin))} мин</div>
                <div className="typo-legend-12 text-grey">(норматив − время сервиса) × {analyze?.count || 0} интервью</div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
