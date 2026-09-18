import { useCallback, useEffect, useRef, useState } from 'react'
import { get, post, postFile } from '../api'
import type { DocInfo, LibraryStats, SearchHit } from '../types'
import { Modal, Spinner } from '../components/ui'

function highlight(text: string, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  if (!words.length) return text
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).map((part, i) =>
    words.some(w => part.toLowerCase() === w)
      ? <mark key={i} style={{ background: 'rgba(255,169,0,.28)', padding: '0 2px' }}>{part}</mark>
      : part,
  )
}

export default function Library() {
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [docs, setDocs] = useState<DocInfo[] | null>(null)
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [busyUpload, setBusyUpload] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<SearchHit | null>(null)
  const [page, setPage] = useState(1)
  const fileRef = useRef<HTMLInputElement>(null)
  const PAGE_SIZE = 25

  const refresh = useCallback(() => {
    get<LibraryStats>('/documents/stats').then(setStats).catch(() => {})
    const params = new URLSearchParams({ category })
    get<DocInfo[]>(`/documents?${params}`).then(setDocs).catch(() => setDocs([]))
  }, [category])

  useEffect(refresh, [refresh])
  useEffect(() => setPage(1), [category, docs?.length])

  const search = async () => {
    const q = query.trim()
    if (!q) { setHits(null); return }
    setSearching(true)
    setError('')
    try {
      const r = await post<{ results: SearchHit[] }>('/documents/search', { query: q, category, k: 10 })
      setHits(r.results)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка поиска')
    } finally {
      setSearching(false)
    }
  }

  const upload = async (f: File) => {
    setBusyUpload(true)
    setError('')
    try {
      await postFile<DocInfo>('/documents', f)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setBusyUpload(false)
    }
  }

  return (
    <>
      {error && <div className="alert alert-error mb-lg">{error}</div>}

      <div className="card">
        <div className="row spread mb-lg">
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>Библиотека документов</h3>
            <div className="typo-legend-12 text-grey" style={{ marginTop: 6 }}>
              {stats
                ? <>Документов: <b>{stats.documents_total}</b> · фрагментов в индексе: <b>{stats.chunks_total}</b>
                    {stats.errors > 0 && <> · с ошибками: {stats.errors}</>}</>
                : 'Загрузка…'}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-secondary" disabled={busyUpload} onClick={() => fileRef.current?.click()}>
              {busyUpload ? 'Загрузка…' : 'Добавить документ'}
            </button>
            <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.docm,.xlsx,.txt,.md,.html"
                   onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          </div>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <input className="input" style={{ flex: 1, minWidth: 260 }}
                 placeholder="Поиск по смыслу: задайте вопрос словами, а не ключевыми словами…"
                 value={query} onChange={e => setQuery(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') search() }} />
          <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Все разделы</option>
            {stats?.categories.map(c => (
              <option key={c.name} value={c.name}>{c.name} ({c.documents})</option>
            ))}
          </select>
          <button className="btn" onClick={search} disabled={searching || !query.trim()}>
            {searching ? 'Ищу…' : 'Найти'}
          </button>
          {hits && <button className="btn btn-secondary" onClick={() => { setHits(null); setQuery('') }}>Сбросить</button>}
        </div>
      </div>

      {hits && (
        <div className="card mt-lg">
          <h3 className="card-title">Найденные фрагменты · {hits.length}</h3>
          {hits.length === 0 ? <div className="empty">Ничего не найдено</div> : hits.map((h, i) => (
            <div key={i} className="flag-card" style={{ borderLeftColor: 'var(--color-brand-cps-blue)', cursor: 'pointer' }}
                 onClick={() => setPreview(h)}>
              <div className="f-title" style={{ justifyContent: 'space-between' }}>
                <span>{h.title || 'Без названия'}{h.page ? `, стр. ${h.page}` : ''}</span>
                <span className="pill pill-blue">{h.category || 'Прочее'}</span>
              </div>
              <div className="f-details">{highlight(h.text.slice(0, 320), query)}…</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid cols-3 mt-lg">
        {stats?.categories.map(c => (
          <div key={c.name} className="card kpi" style={{ cursor: 'pointer' }}
               onClick={() => setCategory(category === c.name ? '' : c.name)}>
            <div className="kpi-label">{c.name}</div>
            <div className="typo-accent-num-small" style={{
              color: category === c.name ? 'var(--color-brand-cps-blue)' : undefined,
            }}>{c.documents}</div>
            <div className="kpi-sub">{c.chunks} фрагментов в индексе</div>
          </div>
        ))}
      </div>

      <div className="card mt-lg">
        <h3 className="card-title">
          Документы{category && <> · раздел «{category}»</>}
          {docs && docs.length > 0 && <span className="text-grey" style={{ fontWeight: 400 }}> · {docs.length}</span>}
        </h3>
        {!docs ? <Spinner /> : docs.length === 0 ? (
          <div className="empty">
            Библиотека пуста. Наполните её командой <code>python scripts/crawl_library.py</code> и
            <code> python scripts/import_library.py</code> либо добавьте документ вручную.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Документ</th><th>Раздел</th><th className="num">Стр.</th>
                  <th className="num">Фрагм.</th><th>Источник</th><th>Статус</th></tr>
            </thead>
            <tbody>
              {docs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(d => (
                <tr key={d.id}>
                  <td style={{ maxWidth: 420 }}>
                    <div className="clamp-2 cell-main">{d.title || d.filename}</div>
                    <div className="cell-sub">{d.filename}</div>
                  </td>
                  <td><span className="pill pill-blue">{d.category}</span></td>
                  <td className="num">{d.pages || '—'}</td>
                  <td className="num">{d.chunks}</td>
                  <td style={{ maxWidth: 220 }}>
                    {d.source_url
                      ? <a href={d.source_url} target="_blank" rel="noreferrer" className="clamp-2"
                           style={{ fontSize: 12 }}>{d.source_url.replace(/^https?:\/\//, '')}</a>
                      : <span className="typo-legend-12 text-grey">загружен вручную</span>}
                  </td>
                  <td>{d.status === 'done' ? <span className="pill pill-green">в индексе</span>
                    : d.status === 'error' ? <span className="pill pill-red" title={d.error || ''}>ошибка</span>
                    : <span className="pill">обработка</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {docs && docs.length > PAGE_SIZE && (
          <div className="pager">
            <button className="btn btn-secondary btn-sm" disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}>Назад</button>
            <span>стр. {page} из {Math.ceil(docs.length / PAGE_SIZE)}</span>
            <button className="btn btn-secondary btn-sm"
                    disabled={page >= Math.ceil(docs.length / PAGE_SIZE)}
                    onClick={() => setPage(p => p + 1)}>Вперёд</button>
          </div>
        )}
      </div>

      {preview && (
        <Modal
          title={`${preview.title || 'Фрагмент'}${preview.page ? `, стр. ${preview.page}` : ''}`}
          onClose={() => setPreview(null)}
          footer={preview.source_url
            ? <a className="btn" href={preview.source_url} target="_blank" rel="noreferrer">Открыть источник</a>
            : <a className="btn" href={`/api/documents/${preview.doc_id}/file`}>Скачать документ</a>}
        >
          <div className="mb-lg"><span className="pill pill-blue">{preview.category}</span></div>
          <p className="artifact-text">{preview.text}</p>
        </Modal>
      )}
    </>
  )
}
