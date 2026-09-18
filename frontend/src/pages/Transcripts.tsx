import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, get, post } from '../api'
import type { InterviewFull, InterviewItem, ModelsInfo } from '../types'
import { Modal } from '../components/ui'
import { PassportCard, fmtSec, riskPill } from './Interviews'

/** Одно действие HR: выбрать файлы — дальше всё делает конвейер. */
export default function Transcripts() {
  const [models, setModels] = useState<ModelsInfo | null>(null)
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [done, setDone] = useState<InterviewItem[]>([])
  const [errors, setErrors] = useState<{ filename: string; error: string }[]>([])
  const [text, setText] = useState('')
  const [card, setCard] = useState<InterviewFull | null>(null)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nav = useNavigate()

  useEffect(() => { get<ModelsInfo>('/interviews/models').then(m => { setModels(m); setModel(m.default) }).catch(() => {}) }, [])

  const upload = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    setBusy(true); setErrors([]); setDone([])
    const results: InterviewItem[] = []
    const errs: { filename: string; error: string }[] = []
    // по одному файлу за запрос: прогресс виден, а один битый файл не роняет остальные
    for (let i = 0; i < list.length; i++) {
      setProgress(`${i + 1} из ${list.length}: ${list[i].name}`)
      const fd = new FormData()
      fd.append('files', list[i])
      fd.append('model', model)
      try {
        const res = await fetch('/api/interviews', { method: 'POST', body: fd, credentials: 'same-origin' })
        const body = await res.json()
        if (!res.ok) throw new ApiError(res.status, body.detail || res.statusText)
        results.push(...body.items)
        errs.push(...body.errors)
      } catch (e) {
        errs.push({ filename: list[i].name, error: (e as Error).message })
      }
      setDone([...results]); setErrors([...errs])
    }
    setBusy(false); setProgress('')
    if (results.length === 1 && list.length === 1) {
      get<InterviewFull>(`/interviews/${results[0].id}`).then(setCard).catch(() => {})
    }
  }, [model])

  const analyzeText = async () => {
    if (text.trim().length < 80) { setErrors([{ filename: 'текст', error: 'Слишком коротко для беседы: нужно хотя бы 80 символов' }]); return }
    setBusy(true); setErrors([])
    try {
      const r = await post<InterviewFull>('/interviews/text', { text, model, filename: 'вставленный текст' })
      setDone([r]); setCard(r); setText('')
    } catch (e) { setErrors([{ filename: 'текст', error: (e as Error).message }]) }
    finally { setBusy(false) }
  }

  return (
    <>
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">Транскрипты exit-интервью</h3>
          <div className="typo-legend-12 text-grey mb-lg">
            .txt, свободный диалог. Можно выбрать сразу весь датасет: каждый файл станет отдельным паспортом.
          </div>
          <label className="fld mb-lg">Модель для анализа
            <select className="input" value={model} onChange={e => setModel(e.target.value)} disabled={busy}>
              {(models?.models || [model]).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="typo-legend-12 text-grey">
              {models?.available ? `провайдер ${models.provider}, модель отвечает` : 'модель недоступна — сработает запасной путь по ключевым словам'}
            </span>
          </label>
          <div className={`dropzone ${drag ? 'drag' : ''}`}
               onDragOver={e => { e.preventDefault(); setDrag(true) }}
               onDragLeave={() => setDrag(false)}
               onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) upload(e.dataTransfer.files) }}
               onClick={() => !busy && inputRef.current?.click()}>
            {busy ? `Анализ… ${progress}` : <>Перетащите файлы сюда или нажмите для выбора<br /><span className="typo-legend-12">.txt, один или несколько</span></>}
            <input ref={inputRef} type="file" accept=".txt,.md" multiple hidden
                   onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">Или вставьте текст беседы</h3>
          <textarea className="input" rows={9} value={text} onChange={e => setText(e.target.value)} disabled={busy}
                    placeholder="…Уходишь? Да, перехожу к конкурентам. Знаешь, сама работа классная, но убивает вот это…" style={{ width: '100%', resize: 'vertical' }} />
          <div className="row mt-lg" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" disabled={busy || !text.trim()} onClick={analyzeText}>{busy ? 'Анализ…' : 'Разобрать'}</button>
          </div>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="card mt-lg">
          {errors.map((e, i) => <div className="alert alert-error" key={i}>{e.filename}: {e.error}</div>)}
        </div>
      )}

      {done.length > 0 && (
        <div className="card mt-lg">
          <div className="row spread mb-lg">
            <h3 className="card-title" style={{ margin: 0 }}>Готово: {done.length}</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => nav('/')}>Открыть дашборд</button>
          </div>
          <table className="table">
            <thead><tr><th>Файл</th><th style={{ width: 150 }}>Причина</th><th style={{ width: 110 }}>Риск</th><th>Главная проблема</th><th style={{ width: 90 }}>Время</th></tr></thead>
            <tbody>
              {done.map(r => (
                <tr key={r.id} className="row-clickable" onClick={() => get<InterviewFull>(`/interviews/${r.id}`).then(setCard)}>
                  <td className="cell-main">{r.filename}</td><td>{r.exit_reason}</td><td>{riskPill(r.risk_zone)}</td>
                  <td>{r.top_problem || '—'}</td><td>{fmtSec(r.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {card && (
        <Modal title={`Паспорт проблемы · ${card.filename}`} onClose={() => setCard(null)}>
          <PassportCard item={card} onChange={setCard} />
        </Modal>
      )}
    </>
  )
}
