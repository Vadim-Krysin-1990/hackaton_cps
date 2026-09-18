import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtNum, get } from '../api'
import type { Facets, Health, Metrics } from '../types'
import { Kpi, Spinner } from '../components/ui'
import { DonutChart, HBarChart } from '../components/charts'

/** Обзор: что в данных и сколько времени экономит сервис.
 *
 *  Блок «было / стало» стоит первым намеренно — заказчики почти всегда
 *  оценивают решение по экономии времени специалиста, и цифра здесь
 *  измеренная (журнал), а не заявленная на слайде. */
export default function Overview() {
  const [facets, setFacets] = useState<Facets | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    get<Facets>('/records/facets').then(setFacets).catch(() => {})
    get<Metrics>('/metrics').then(setMetrics).catch(() => {})
    get<Health>('/health').then(setHealth).catch(() => {})
  }, [])

  if (!facets) return <Spinner />

  const fastest = metrics?.operations.find(o => o.avg_ms > 0)

  return (
    <>
      <div className="kpi-row">
        <Kpi label="Записей в базе" value={facets.total}
             sub={facets.total ? 'загруженный датасет' : 'датасет ещё не загружен'} />
        <Kpi label="Сумма по полю amount" value={fmtNum(facets.amount_sum, true)}
             sub="если поле распознано загрузчиком" />
        <Kpi label="Категорий" value={facets.by_category.length} sub="в текущих данных" />
        <Kpi label="Экономия времени"
             value={metrics ? `${fmtNum(metrics.saved_minutes_total)} мин` : '—'}
             sub={metrics ? `норматив ручной работы — ${metrics.manual_minutes} мин на операцию` : ''} />
      </div>

      {facets.total === 0 && (
        <div className="card mt-lg">
          <div className="alert alert-info">
            Данных пока нет. Загрузите XLSX или CSV на экране <Link to="/uploads">«Загрузка»</Link> —
            или сгенерируйте демонстрационный набор:
            <div className="code-line">python backend/scripts/make_demo_data.py data/samples/demo.xlsx --rows 500</div>
          </div>
        </div>
      )}

      {facets.total > 0 && (
        <div className="grid cols-2 mt-lg">
          <div className="card">
            <h3 className="card-title">По статусам</h3>
            <DonutChart data={facets.by_status.map(s => ({ name: s.value, count: s.count }))}
                        centerLabel="записей" />
          </div>
          <div className="card">
            <h3 className="card-title">По категориям</h3>
            <HBarChart data={facets.by_category.map(c => ({ name: c.value, count: c.count }))} />
          </div>
        </div>
      )}

      <div className="card mt-lg">
        <h3 className="card-title">Было / стало</h3>
        <div className="typo-legend-12 text-grey mb-lg">
          Длительность операций замеряется в журнале. Норматив ручной работы задаётся
          параметром APP_BASELINE_MANUAL_MINUTES — спросите цифру у заказчика, не выдумывайте.
        </div>
        {!metrics || metrics.operations.length === 0 ? (
          <div className="empty">Замеров пока нет — поработайте в сервисе, и цифры появятся</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Операция</th><th>Выполнено раз</th><th>Среднее время</th>
                  <th>Максимум</th><th>Быстрее ручной работы</th></tr>
            </thead>
            <tbody>
              {metrics.operations.map(o => (
                <tr key={o.action}>
                  <td className="cell-main">{o.label}</td>
                  <td>{o.count}</td>
                  <td>{o.avg_ms ? `${(o.avg_ms / 1000).toFixed(1).replace('.', ',')} с` : '—'}</td>
                  <td>{o.max_ms ? `${(o.max_ms / 1000).toFixed(1).replace('.', ',')} с` : '—'}</td>
                  <td>{o.speedup ? <span className="pill pill-green">в {fmtNum(o.speedup)} раза</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {fastest && (
          <div className="typo-body-14 mt-lg">
            Формулировка для питча: «{fastest.label.toLowerCase()} занимает у специалиста
            около {metrics?.manual_minutes} минут, сервис выполняет за
            {' '}{(fastest.avg_ms / 1000).toFixed(1).replace('.', ',')} секунды».
          </div>
        )}
      </div>

      <div className="card mt-lg">
        <h3 className="card-title">Состояние контура</h3>
        <div className="grid cols-3">
          <div className="row spread"><span>База данных</span>
            <span className={`pill ${health?.db ? 'pill-green' : 'pill-red'}`}>
              {health?.db ? 'работает' : 'недоступна'}</span></div>
          <div className="row spread"><span>Языковая модель</span>
            <span className={`pill ${health?.llm_available ? 'pill-green' : 'pill-red'}`}>
              {health?.llm_available ? health.llm_model : 'недоступна'}</span></div>
          <div className="row spread"><span>Эмбеддинги</span>
            <span className="pill pill-blue">{health?.embedder || '—'}</span></div>
        </div>
        {health && !health.llm_available && health.llm_error && (
          <div className="alert alert-warn mt-lg">
            Модель не отвечает: {health.llm_error}. Проверьте {health.llm_endpoint} —
            контур продолжает работать на фактах, но ответы будут без связного текста.
          </div>
        )}
      </div>
    </>
  )
}
