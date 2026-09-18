import { useCallback, useEffect, useState } from 'react'
import { fmtNum, get } from '../api'
import type { Facets, Paged, RecordCard, RecordItem } from '../types'
import { Modal, Spinner, useDebounced } from '../components/ui'

const PAGE_SIZE = 25

/** Просмотр загруженных данных: поиск, фильтры, карточка строки.
 *  Заменяется предметным экраном, когда появится своя модель данных. */
export default function Records() {
  const [facets, setFacets] = useState<Facets | null>(null)
  const [data, setData] = useState<Paged<RecordItem> | null>(null)
  const [card, setCard] = useState<RecordCard | null>(null)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const query = useDebounced(q)

  const load = useCallback(() => {
    const params = new URLSearchParams({
      q: query, category, status,
      limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE),
    })
    get<{ items: RecordItem[]; total: number }>(`/records?${params}`)
      .then(r => setData({
        items: r.items, total: r.total, page,
        pages: Math.max(1, Math.ceil(r.total / PAGE_SIZE)),
      }))
      .catch(() => setData({ items: [], total: 0, page: 1, pages: 1 }))
  }, [query, category, status, page])

  useEffect(load, [load])
  useEffect(() => { get<Facets>('/records/facets').then(setFacets).catch(() => {}) }, [])
  useEffect(() => setPage(1), [query, category, status])

  return (
    <>
      <div className="card">
        <div className="row spread mb-lg">
          <h3 className="card-title" style={{ margin: 0 }}>Данные</h3>
          <span className="typo-legend-12 text-grey">
            {facets ? `всего записей: ${facets.total}` : ''}
          </span>
        </div>

        <div className="row mb-lg" style={{ alignItems: 'flex-end' }}>
          <label className="fld" style={{ flex: 1, minWidth: 220 }}>
            Поиск
            <input className="input" value={q} onChange={e => setQ(e.target.value)}
                   placeholder="по названию или ключу" />
          </label>
          <label className="fld">
            Категория
            <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">Все</option>
              {facets?.by_category.map(c => (
                <option key={c.value} value={c.value}>{c.value} ({c.count})</option>
              ))}
            </select>
          </label>
          <label className="fld">
            Статус
            <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">Все</option>
              {facets?.by_status.map(s => (
                <option key={s.value} value={s.value}>{s.value} ({s.count})</option>
              ))}
            </select>
          </label>
        </div>

        {!data ? <Spinner /> : data.items.length === 0 ? (
          <div className="empty">Записей не найдено</div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr><th style={{ width: 150 }}>Ключ</th><th>Название</th>
                    <th style={{ width: 150 }}>Категория</th><th style={{ width: 150 }}>Статус</th>
                    <th style={{ width: 140 }}>Сумма</th></tr>
              </thead>
              <tbody>
                {data.items.map(r => (
                  <tr key={r.id} className="row-clickable"
                      onClick={() => get<RecordCard>(`/records/${r.id}`).then(setCard)}>
                    <td className="cell-main">{r.key}</td>
                    <td>{r.title || '—'}</td>
                    <td>{r.category || '—'}</td>
                    <td>{r.status || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.amount === null ? '—' : fmtNum(r.amount)}</td>
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

      {card && (
        <Modal title={card.title || card.key} onClose={() => setCard(null)}>
          <table className="table">
            <tbody>
              {Object.entries(card.payload).map(([k, v]) => (
                <tr key={k}>
                  <td className="cell-main" style={{ width: 260 }}>{k}</td>
                  <td>{v ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </>
  )
}
