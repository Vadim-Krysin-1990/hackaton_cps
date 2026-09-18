import { useCallback, useEffect, useMemo, useState } from 'react'
import { del, get, post } from '../api'
import type { Anchor, InterviewFull, InterviewItem, ModelsInfo } from '../types'
import { Modal, Spinner, useDebounced } from '../components/ui'
import { SentimentLine } from '../components/exitcharts'

const RISK_PILL: Record<string, string> = { High: 'pill-red', Medium: 'pill-orange', Low: 'pill-green' }
const RISK_LABEL: Record<string, string> = { High: 'высокий', Medium: 'средний', Low: 'низкий' }

export const riskPill = (r: string | null) => (
  <span className={`pill ${RISK_PILL[r || ''] || 'pill-blue'}`}>{RISK_LABEL[r || ''] || r || '—'}</span>
)

export const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} с`

/** Исходный текст с подсветкой подтверждённых цитат. Клик по цитате в паспорте
 *  прокручивает к ней; выбранная реплика (с графика) выделяется рамкой. */
function SourceView({ source, anchors, active, activeUtt, utts }: {
  source: string; anchors: Anchor[]; active: string | null; activeUtt: number | null
  utts: { idx: number; start: number; end: number; speaker: string }[]
}) {
  const segments = useMemo(() => {
    const marks = anchors
      .filter(a => a.start !== null && a.end !== null)
      .sort((x, y) => x.start - y.start)
    const out: { text: string; anchor?: Anchor; utt?: number }[] = []
    let pos = 0
    const uttAt = (p: number) => utts.find(u => p >= u.start && p < u.end)?.idx
    for (const m of marks) {
      if (m.start < pos) continue
      if (m.start > pos) out.push({ text: source.slice(pos, m.start), utt: uttAt(pos) })
      out.push({ text: source.slice(m.start, m.end), anchor: m, utt: uttAt(m.start) })
      pos = m.end
    }
    if (pos < source.length) out.push({ text: source.slice(pos), utt: uttAt(pos) })
    return out
  }, [source, anchors, utts])
  return (
    <div className="artifact-text" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 420, overflow: 'auto' }}>
      {segments.map((s, i) => {
        const isActive = s.anchor && active === s.anchor.quote
        const inUtt = activeUtt !== null && s.utt === activeUtt
        return (
          <span key={i} id={s.anchor ? `q-${s.anchor.start}` : undefined}
                style={{
                  background: isActive ? 'var(--color-status-orange, #f3b23b)' : s.anchor ? 'rgba(0,121,194,0.16)' : inUtt ? 'rgba(46,158,91,0.12)' : undefined,
                  borderBottom: s.anchor ? '2px solid var(--chart-single)' : undefined,
                  outline: inUtt && !s.anchor ? '1px dashed var(--color-status-green, #2e9e5b)' : undefined,
                }}
                title={s.anchor ? `${s.anchor.field} · схожесть ${Math.round(s.anchor.ratio * 100)}%` : undefined}>
            {s.text}
          </span>
        )
      })}
    </div>
  )
}

export function PassportCard({ item, onChange }: { item: InterviewFull; onChange: (i: InterviewFull) => void }) {
  const [active, setActive] = useState<string | null>(null)
  const [activeUtt, setActiveUtt] = useState<number | null>(null)
  const [models, setModels] = useState<ModelsInfo | null>(null)
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const p = item.passport
  const a = item.analysis
  const v = a.verification

  useEffect(() => { get<ModelsInfo>('/interviews/models').then(m => { setModels(m); setModel(m.default) }).catch(() => {}) }, [])

  const pick = (quote: string) => {
    setActive(quote)
    const anchor = v.anchors.find(x => x.quote === quote)
    if (anchor) document.getElementById(`q-${anchor.start}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  const rerun = async () => {
    setBusy(true); setErr('')
    try { onChange(await post<InterviewFull>(`/interviews/${item.id}/reanalyze?model=${encodeURIComponent(model)}`)) }
    catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="pill pill-blue">причина: {p.exit_reason}</span>
          {riskPill(p.risk_zone)}
          <span className="pill">движок: {item.engine}</span>
          <span className="pill">{fmtSec(item.duration_ms)}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {models && models.models.length > 0 && (
            <select className="input" value={model} onChange={e => setModel(e.target.value)} style={{ minWidth: 180 }}>
              {models.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={rerun}>
            {busy ? 'Анализ…' : 'Прогнать другой моделью'}
          </button>
          <a className="btn btn-secondary btn-sm" href={`/api/interviews/${item.id}/docx`}>Скачать DOCX</a>
        </div>
      </div>
      {err && <div className="alert alert-error">{err}</div>}

      {p.summary && <div className="typo-body-15">{p.summary}</div>}

      <div className="grid cols-2">
        <div className="card" style={{ margin: 0 }}>
          <h3 className="card-title">Причина ухода: {p.exit_reason}</h3>
          {p.exit_reason_quote && (
            <div className="row-clickable" style={{ cursor: 'pointer' }} onClick={() => pick(p.exit_reason_quote)}>
              «{p.exit_reason_quote}»
            </div>
          )}
          {p.says && <div className="mt-lg"><span className="text-grey">Говорит:</span> {p.says}</div>}
          {p.feels && <div><span className="text-grey">Чувствует:</span> {p.feels}</div>}
        </div>
        <div className="card" style={{ margin: 0 }}>
          <h3 className="card-title">Зона риска для команды: {riskPill(p.risk_zone)}</h3>
          <div>{p.risk_rationale || '—'}</div>
          <div className="typo-legend-12 text-grey mt-lg">
            Проверка цитат: проверено {v.checked}, подтверждено {v.accepted}, отклонено {v.rejected.length}
          </div>
        </div>
      </div>

      <div className="card" style={{ margin: 0 }}>
        <h3 className="card-title">Системные проблемы</h3>
        {p.pain_points.length === 0 ? <div className="empty">Проблем с подтверждёнными цитатами нет</div> : (
          <table className="table">
            <thead><tr><th>Проблема</th><th style={{ width: 200 }}>Категория</th><th style={{ width: 110 }}>Упоминаний</th><th>Цитаты (клик — показать в тексте)</th></tr></thead>
            <tbody>
              {p.pain_points.map((pp, i) => (
                <tr key={i}>
                  <td className="cell-main">{pp.label}</td>
                  <td>{pp.category}</td>
                  <td>{pp.mentions}</td>
                  <td>
                    {pp.quotes.map((q, j) => (
                      <div key={j} style={{ cursor: 'pointer', color: active === q ? 'var(--color-status-orange, #c77800)' : undefined }}
                           onClick={() => pick(q)}>«{q}»</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card" style={{ margin: 0 }}>
          <h3 className="card-title">Что работает хорошо</h3>
          {p.best_practices.length === 0 ? <div className="empty">Не выделено</div> : p.best_practices.map((b, i) => (
            <div key={i} style={{ marginBottom: 8, cursor: 'pointer' }} onClick={() => pick(b.quote)}>
              <b>{b.label}</b><br /><span className="text-grey">«{b.quote}»</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ margin: 0 }}>
          <h3 className="card-title">Гипотезы по главной проблеме{p.top_problem ? `: ${p.top_problem}` : ''}</h3>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {p.improvement_suggestions.map((s, i) => <li key={i} style={{ marginBottom: 6 }}>{s}</li>)}
          </ol>
        </div>
      </div>

      <div className="card" style={{ margin: 0 }}>
        <h3 className="card-title">Настроение по ходу разговора</h3>
        <div className="typo-legend-12 text-grey mb-lg">
          Средний тон {a.sentiment.mean > 0 ? '+' : ''}{a.sentiment.mean}, {a.sentiment.trend}. Точка — реплика сотрудника, клик подсвечивает её в тексте.
        </div>
        <SentimentLine points={a.sentiment.points} onPick={idx => { setActiveUtt(idx); setActive(null) }} />
      </div>

      {v.rejected.length > 0 && (
        <div className="alert alert-warn">
          <b>Отклонено проверкой ({v.rejected.length}):</b> модель предложила фразы, которых в тексте нет, они в паспорт не попали.
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {v.rejected.map((r, i) => <li key={i}>{r.field}: «{r.quote}» — {r.reason}</li>)}
          </ul>
        </div>
      )}

      <div className="card" style={{ margin: 0 }}>
        <h3 className="card-title">Исходный текст</h3>
        <SourceView source={item.source} anchors={v.anchors} active={active} activeUtt={activeUtt} utts={a.utterances} />
      </div>

      <details>
        <summary className="typo-legend-12 text-grey" style={{ cursor: 'pointer' }}>Шаги конвейера и заметки</summary>
        <table className="table mt-lg">
          <tbody>
            {a.steps.map((s, i) => <tr key={i}><td className="cell-main" style={{ width: 120 }}>{s.step}</td><td style={{ width: 90 }}>{s.ms} мс</td><td>{s.detail}</td></tr>)}
            {a.notes.map((n, i) => <tr key={`n${i}`}><td className="cell-main">заметка</td><td /><td>{n}</td></tr>)}
          </tbody>
        </table>
      </details>
    </div>
  )
}

export default function Interviews() {
  const [data, setData] = useState<{ items: InterviewItem[]; total: number } | null>(null)
  const [card, setCard] = useState<InterviewFull | null>(null)
  const [q, setQ] = useState('')
  const [reason, setReason] = useState('')
  const [risk, setRisk] = useState('')
  const query = useDebounced(q)

  const load = useCallback(() => {
    const params = new URLSearchParams({ q: query, reason, risk, limit: '200' })
    get<{ items: InterviewItem[]; total: number }>(`/interviews?${params}`).then(setData).catch(() => setData({ items: [], total: 0 }))
  }, [query, reason, risk])
  useEffect(load, [load])

  const remove = async (id: number) => {
    if (!confirm('Удалить интервью и его паспорт?')) return
    await del(`/interviews/${id}`)
    setCard(null)
    load()
  }

  return (
    <>
      <div className="card">
        <div className="row spread mb-lg">
          <h3 className="card-title" style={{ margin: 0 }}>Интервью и паспорта</h3>
          <span className="typo-legend-12 text-grey">{data ? `всего: ${data.total}` : ''}</span>
        </div>
        <div className="row mb-lg" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="fld" style={{ flex: 1, minWidth: 220 }}>Поиск по тексту
            <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="слово из беседы или имя файла" />
          </label>
          <label className="fld">Причина
            <select className="input" value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">Все</option>
              {['деньги', 'карьера', 'микроклимат', 'нереализованность', 'другое'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="fld">Риск
            <select className="input" value={risk} onChange={e => setRisk(e.target.value)}>
              <option value="">Все</option>
              <option value="High">высокий</option><option value="Medium">средний</option><option value="Low">низкий</option>
            </select>
          </label>
        </div>
        {!data ? <Spinner /> : data.items.length === 0 ? (
          <div className="empty">Интервью пока нет. Загрузите транскрипты на экране «Загрузка».</div>
        ) : (
          <table className="table">
            <thead><tr><th>Файл</th><th style={{ width: 150 }}>Причина</th><th style={{ width: 110 }}>Риск</th>
              <th style={{ width: 200 }}>Главная проблема</th><th>Вывод</th><th style={{ width: 90 }}>Время</th></tr></thead>
            <tbody>
              {data.items.map(r => (
                <tr key={r.id} className="row-clickable" onClick={() => get<InterviewFull>(`/interviews/${r.id}`).then(setCard)}>
                  <td className="cell-main">{r.filename}<div className="cell-sub">{r.chars} симв. · {r.engine}</div></td>
                  <td>{r.exit_reason || '—'}</td>
                  <td>{riskPill(r.risk_zone)}</td>
                  <td>{r.top_problem || '—'}</td>
                  <td className="clamp-2">{r.summary || r.error || '—'}</td>
                  <td>{fmtSec(r.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {card && (
        <Modal title={`Паспорт проблемы · ${card.filename}`} onClose={() => setCard(null)}
               footer={<button className="btn btn-secondary btn-sm" onClick={() => remove(card.id)}>Удалить</button>}>
          <PassportCard item={card} onChange={c => { setCard(c); load() }} />
        </Modal>
      )}
    </>
  )
}
