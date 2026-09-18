import { useEffect, useRef, useState } from 'react'
import { del, get, post } from '../api'
import type { ChatMsg, Evidence } from '../types'
import { useAuth } from '../App'
import { Spinner } from '../components/ui'

/** Подсказки под задачу. Перепишите их первыми: на демо жюри жмёт именно их,
 *  а не придумывает вопросы само. */
const SUGGESTS = [
  'Что сейчас в данных?',
  'Какие записи требуют внимания?',
  'Найди записи по категории «Строительство»',
  'Что написано в документах про сроки?',
]

function EvidenceChips({ items }: { items: Evidence[] }) {
  if (!items?.length) return null
  return (
    <div className="evidence">
      {items.map((e, i) => e.type === 'record' ? (
        <span className="evd-chip" key={i} title={e.snippet}>{e.label || `Запись №${e.id}`}</span>
      ) : (
        <span className="evd-chip" key={i} title={e.snippet}>
          {e.source_url
            ? <a href={e.source_url} target="_blank" rel="noreferrer">{e.title || 'Документ'}</a>
            : <>{e.title || 'Документ'}</>}
          {e.page ? `, стр. ${e.page}` : ''}
        </span>
      ))}
    </div>
  )
}

export default function Assistant() {
  const { health } = useAuth()
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { get<ChatMsg[]>('/chat/history').then(setMsgs).catch(() => setMsgs([])) }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const send = async (question: string) => {
    const q = question.trim()
    if (!q || busy) return
    setText('')
    setBusy(true)
    setMsgs(m => [...(m || []), { role: 'user', content: q },
                                { role: 'assistant', content: '', pending: true }])
    try {
      const r = await post<{ answer: string; evidence: Evidence[] }>('/chat', { message: q })
      setMsgs(m => [...(m || []).filter(x => !x.pending),
                    { role: 'assistant', content: r.answer, evidence: r.evidence }])
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'неизвестная ошибка'
      setMsgs(m => [...(m || []).filter(x => !x.pending),
                    { role: 'assistant', content: `Не удалось получить ответ: ${detail}` }])
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    await del('/chat/history')
    setMsgs([])
  }

  if (!msgs) return <Spinner />

  return (
    <div className="card chat-card">
      <div className="row spread mb-lg">
        <div>
          <h3 className="card-title" style={{ margin: 0 }}>Ассистент</h3>
          <div className="typo-legend-12 text-grey" style={{ marginTop: 6 }}>
            {health?.llm_available
              ? <>Модель: <b>{health.llm_model}</b> · {health.llm_provider}</>
              : <>Модель недоступна — ответы собираются из фактов базы{health?.llm_error ? ` (${health.llm_error})` : ''}</>}
          </div>
        </div>
        {msgs.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={clear} disabled={busy}>
            Очистить диалог
          </button>
        )}
      </div>

      {msgs.length === 0 ? (
        <div className="chat-empty">
          <div className="typo-charts-header-2 mb-lg">С чего начать</div>
          <div className="suggests">
            {SUGGESTS.map(s => (
              <button key={s} className="suggest" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="chat-log">
          {msgs.map((m, i) => (
            <div key={i} className={`msg msg-${m.role}`}>
              {m.pending
                ? <div className="typo-legend-12 text-grey">Думаю…</div>
                : <>
                    <div className="msg-text">{m.content}</div>
                    {m.evidence && <EvidenceChips items={m.evidence} />}
                  </>}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <form className="chat-input" onSubmit={e => { e.preventDefault(); send(text) }}>
        <input className="input" value={text} placeholder="Спросите о данных или документах…"
               onChange={e => setText(e.target.value)} disabled={busy} />
        <button className="btn" disabled={busy || !text.trim()}>
          {busy ? 'Отправка…' : 'Спросить'}
        </button>
      </form>
    </div>
  )
}
