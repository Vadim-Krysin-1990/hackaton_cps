import { useCallback, useEffect, useRef, useState } from 'react'
import { get, postFile } from '../api'
import type { DocInfo, UploadInfo } from '../types'
import { Modal, Spinner } from '../components/ui'

function Dropzone({ accept, hint, onFile, busy }: {
  accept: string; hint: string; onFile: (f: File) => void; busy: boolean
}) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const drop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onFile(f)
  }, [onFile])
  return (
    <div
      className={`dropzone ${drag ? 'drag' : ''}`}
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={drop}
      onClick={() => inputRef.current?.click()}
    >
      {busy ? 'Загрузка и обработка…' : (
        <>Перетащите файл сюда или нажмите для выбора<br />
          <span className="typo-legend-12">{hint}</span></>
      )}
      <input ref={inputRef} type="file" accept={accept} hidden
             onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
    </div>
  )
}

/** Отчёт о качестве — то, что первым спрашивают у чужой выгрузки:
 *  сколько строк, какие колонки пустые, что загрузчик принял за ключ и сумму. */
function QualityView({ u }: { u: UploadInfo }) {
  const q = u.quality
  if (!q) return null
  const weak = q.columns.filter(c => c.filled_pct < 50)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        Строк принято: <b>{q.rows_total}</b> (пустых пропущено {q.empty_rows}) ·
        колонок: <b>{q.columns_total}</b>
      </div>
      <div>Новых записей: <b>{u.records_new}</b> · обновлено: <b>{u.records_updated}</b></div>

      <div>
        Распознанные роли колонок:{' '}
        {Object.keys(q.roles).length === 0
          ? <span className="text-grey">ни одна не распознана — правьте ROLE_HINTS в backend/app/ingest/loader.py</span>
          : Object.entries(q.roles).map(([role, col]) => (
              <span className="pill pill-blue" key={role} style={{ marginRight: 6 }}>
                {role} → {col}
              </span>
            ))}
      </div>

      {q.truncated && (
        <div className="alert alert-warn">
          Файл обрезан по предохранителю MAX_ROWS — поднимите лимит в loader.py, если нужно всё.
        </div>
      )}

      {weak.length > 0 && (
        <div className="alert alert-warn">
          Слабо заполненные колонки: {weak.map(c => `${c.name} — ${c.filled_pct}%`).join('; ')}
        </div>
      )}

      <table className="table">
        <thead>
          <tr><th>Колонка</th><th style={{ width: 110 }}>Заполнено</th>
              <th style={{ width: 110 }}>Уникальных</th><th>Пример значения</th></tr>
        </thead>
        <tbody>
          {q.columns.map(c => (
            <tr key={c.name}>
              <td className="cell-main">{c.name}</td>
              <td>{c.filled_pct}%</td>
              <td>{c.distinct}</td>
              <td className="text-grey">{c.example ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Uploads() {
  const [uploads, setUploads] = useState<UploadInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [docBusy, setDocBusy] = useState(false)
  const [error, setError] = useState('')
  const [shown, setShown] = useState<UploadInfo | null>(null)

  const load = useCallback(() => {
    get<UploadInfo[]>('/uploads').then(setUploads).catch(() => setUploads([]))
  }, [])
  useEffect(load, [load])

  const sendDataset = async (f: File) => {
    setBusy(true)
    setError('')
    try {
      const u = await postFile<UploadInfo>('/uploads', f)
      setShown(u)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить файл')
    } finally {
      setBusy(false)
    }
  }

  const sendDocument = async (f: File) => {
    setDocBusy(true)
    setError('')
    try {
      await postFile<DocInfo>('/documents', f)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить документ')
    } finally {
      setDocBusy(false)
    }
  }

  return (
    <>
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">Датасет</h3>
          <div className="typo-legend-12 text-grey mb-lg">
            Таблица задачи: строки попадают в базу, по ним работают поиск и ассистент.
          </div>
          <Dropzone accept=".xlsx,.xlsm,.xls,.csv" hint="XLSX или CSV"
                    onFile={sendDataset} busy={busy} />
        </div>
        <div className="card">
          <h3 className="card-title">Документы</h3>
          <div className="typo-legend-12 text-grey mb-lg">
            Нормативы, регламенты, описания: разбираются на фрагменты для поиска по смыслу.
          </div>
          <Dropzone accept=".pdf,.docx,.xlsx,.txt,.md,.html"
                    hint="PDF, DOCX, XLSX, TXT, MD, HTML" onFile={sendDocument} busy={docBusy} />
        </div>
      </div>

      {error && <div className="alert alert-error mt-lg">{error}</div>}

      <div className="card mt-lg">
        <h3 className="card-title">История загрузок</h3>
        {!uploads ? <Spinner /> : uploads.length === 0 ? (
          <div className="empty">Загрузок пока не было</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Файл</th><th style={{ width: 120 }}>Статус</th>
                  <th style={{ width: 100 }}>Строк</th><th style={{ width: 120 }}>Новых</th>
                  <th style={{ width: 160 }}>Когда</th></tr>
            </thead>
            <tbody>
              {uploads.map(u => (
                <tr key={u.id} className="row-clickable" onClick={() => setShown(u)}>
                  <td className="cell-main">{u.filename}</td>
                  <td>
                    <span className={`pill ${u.status === 'done' ? 'pill-green' : 'pill-red'}`}>
                      {u.status === 'done' ? 'разобран' : 'ошибка'}
                    </span>
                  </td>
                  <td>{u.rows_total}</td>
                  <td>{u.records_new}</td>
                  <td className="text-grey">
                    {u.created_at ? new Date(u.created_at).toLocaleString('ru-RU') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {shown && (
        <Modal title={`Разбор файла · ${shown.filename}`} onClose={() => setShown(null)}>
          {shown.error
            ? <div className="alert alert-error">{shown.error}</div>
            : <QualityView u={shown} />}
        </Modal>
      )}
    </>
  )
}
