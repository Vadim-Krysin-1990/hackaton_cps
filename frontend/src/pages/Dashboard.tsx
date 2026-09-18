import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtNum, get } from '../api'
import type { Dashboard as DashboardData, Health, Metrics } from '../types'
import { Kpi, Spinner } from '../components/ui'
import { DonutChart, HBarChart } from '../components/charts'
import { RelationGraph } from '../components/exitcharts'

const RISK_RU: Record<string, string> = { High: 'высокий', Medium: 'средний', Low: 'низкий' }

/** Дашборд для руководителя: не «средняя температура», а частота системных
 *  проблем по всем интервью, связи между ними и что с главной делать. */
export default function Dashboard() {
  const [d, setD] = useState<DashboardData | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    get<DashboardData>('/interviews/dashboard').then(setD).catch(() => {})
    get<Metrics>('/metrics').then(setMetrics).catch(() => {})
    get<Health>('/health').then(setHealth).catch(() => {})
  }, [])

  if (!d) return <Spinner />
  const analyze = metrics?.operations.find(o => o.action === 'interview_analyze')
  const savedMin = analyze ? Math.max(0, (d.manual_minutes - analyze.avg_ms / 60000) * analyze.count) : 0
  const high = d.by_risk.find(r => r.name === 'High')?.count || 0
  const acc = d.verification.checked ? Math.round(d.verification.accepted / d.verification.checked * 100) : 0

  return (
    <>
      <div className="kpi-row">
        <Kpi label="Интервью разобрано" value={d.total} sub={d.total ? `главная причина: ${d.by_reason[0]?.name}` : 'загрузите транскрипты'} />
        <Kpi label="Самая частая проблема" value={d.top_problem || '—'}
             sub={d.pains[0] ? `в ${d.pains[0].share}% интервью` : ''} />
        <Kpi label="Высокий риск для команды" value={high} accent={high ? 'red' : undefined}
             sub="есть признаки, что уйдут и другие" />
        <Kpi label="Цитат подтверждено" value={d.verification.checked ? `${acc}%` : '—'}
             sub={`проверено ${d.verification.checked}, отклонено ${d.verification.rejected}`} />
      </div>

      {d.total === 0 && (
        <div className="card mt-lg">
          <div className="alert alert-info">
            Интервью пока нет. Загрузите .txt на экране <Link to="/upload">«Загрузка»</Link> — можно сразу несколько файлов.
            Демонстрационный набор лежит в <span className="code-line" style={{ display: 'inline' }}>data/samples/transcripts</span>.
          </div>
        </div>
      )}

      {d.total > 0 && (
        <>
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
              <h3 className="card-title">Связи между проблемами</h3>
              <RelationGraph nodes={d.pains.slice(0, 8)} edges={d.edges} />
            </div>
            <div className="card">
              <h3 className="card-title">Что делать с главной проблемой{d.top_problem ? `: ${d.top_problem}` : ''}</h3>
              {d.top_suggestions.length === 0 ? <div className="empty">Гипотез нет</div> : (
                <ol style={{ paddingLeft: 20 }}>
                  {d.top_suggestions.map((s, i) => <li key={i} style={{ marginBottom: 8 }}>{s}</li>)}
                </ol>
              )}
              <h3 className="card-title mt-lg">Зоны риска</h3>
              <DonutChart data={d.by_risk.map(r => ({ name: RISK_RU[r.name] || r.name, count: r.count }))} centerLabel="интервью" />
            </div>
          </div>

          <div className="grid cols-2 mt-lg">
            <div className="card">
              <h3 className="card-title">Что работает хорошо</h3>
              <HBarChart data={d.practices} />
            </div>
            <div className="card">
              <h3 className="card-title">Было / стало</h3>
              <div className="typo-body-15">
                Вручную: <b>{d.manual_minutes} мин</b> на разбор одной беседы.<br />
                Сервис: <b>{analyze ? `${(analyze.avg_ms / 1000).toFixed(1).replace('.', ',')} с` : '—'}</b> в среднем на паспорт.
              </div>
              <div className="typo-legend-12 text-grey mt-lg">
                Формула: (норматив − время сервиса) × число интервью = {d.manual_minutes} мин ×{' '}
                {analyze?.count || 0} − {analyze ? (analyze.avg_ms * analyze.count / 60000).toFixed(1).replace('.', ',') : 0} мин
              </div>
              <div className="kpi-value mt-lg" style={{ fontSize: 28 }}>{fmtNum(Math.round(savedMin))} мин сэкономлено</div>
              <div className="typo-legend-12 text-grey">
                Главное не минуты: системная проблема видна в день загрузки, а не через квартал.
              </div>
              <div className="mt-lg typo-legend-12 text-grey">
                Движки: {d.by_engine.map(e => `${e.name} (${e.count})`).join(', ')}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card mt-lg">
        <h3 className="card-title">Состояние контура</h3>
        <div className="grid cols-3">
          <div className="row spread"><span>База данных</span>
            <span className={`pill ${health?.db ? 'pill-green' : 'pill-red'}`}>{health?.db ? 'работает' : 'недоступна'}</span></div>
          <div className="row spread"><span>Языковая модель</span>
            <span className={`pill ${health?.llm_available ? 'pill-green' : 'pill-orange'}`}>
              {health?.llm_available ? health.llm_model : 'недоступна, работает запасной путь'}</span></div>
          <div className="row spread"><span>Провайдер</span><span className="pill pill-blue">{health?.llm_provider || '—'}</span></div>
        </div>
        {health && !health.llm_available && health.llm_error && (
          <div className="alert alert-warn mt-lg">
            Модель не отвечает: {health.llm_error}. Проверьте {health.llm_endpoint}. Паспорта строятся
            по ключевым словам, без модели — это видно в поле «движок».
          </div>
        )}
      </div>
    </>
  )
}
