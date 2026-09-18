import { useEffect, useMemo, useRef, useState } from 'react'
import { get } from '../api'
import type { GraphData, GraphNode, InterviewFull } from '../types'
import { Modal, Spinner } from '../components/ui'
import { PassportCard } from './Interviews'

/** Клубок связей: интервью, отделы, руководители, причины, проблемы.
 *  Силовая раскладка считается прямо здесь, без библиотек: 50–100 узлов
 *  укладываются за доли секунды. Клик по узлу подсвечивает соседей и
 *  показывает, кто с ним связан; интервью открывается карточкой. */

const KIND_COLOR: Record<string, string> = {
  interview: 'var(--cat-1)', department: 'var(--cat-2)', manager: 'var(--cat-3)',
  reason: 'var(--cat-4)', problem: 'var(--cat-5)',
}
const KIND_ORDER = ['department', 'manager', 'reason', 'problem', 'interview']

interface P { id: string; x: number; y: number; vx: number; vy: number; r: number; node: GraphNode }

function layout(nodes: GraphNode[], edges: { source: string; target: string }[], W: number, H: number): P[] {
  const maxC = Math.max(...nodes.map(n => n.count), 1)
  const pts: P[] = nodes.map((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2
    const base = n.kind === 'interview' ? 7 : 12
    return { id: n.id, x: W / 2 + Math.cos(a) * W * 0.3, y: H / 2 + Math.sin(a) * H * 0.3, vx: 0, vy: 0,
             r: base + (n.kind === 'interview' ? 0 : 14 * (n.count / maxC)), node: n }
  })
  const idx = new Map(pts.map((p, i) => [p.id, i]))
  const links = edges.map(e => [idx.get(e.source)!, idx.get(e.target)!]).filter(([a, b]) => a !== undefined && b !== undefined)
  for (let it = 0; it < 260; it++) {
    const t = 1 - it / 260
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j]
        let dx = b.x - a.x, dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1 }
        const d = Math.sqrt(d2)
        const min = a.r + b.r + 14
        const f = (2600 / d2) * t + (d < min ? (min - d) * 0.5 : 0)
        const fx = (dx / d) * f, fy = (dy / d) * f
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy
      }
    }
    for (const [i, j] of links) {
      const a = pts[i], b = pts[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const target = a.r + b.r + 60
      const f = (d - target) * 0.02
      const fx = (dx / d) * f, fy = (dy / d) * f
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
    }
    for (const p of pts) {
      p.vx += (W / 2 - p.x) * 0.004; p.vy += (H / 2 - p.y) * 0.004
      p.x += p.vx * 0.5; p.y += p.vy * 0.5
      p.vx *= 0.6; p.vy *= 0.6
      p.x = Math.max(p.r + 4, Math.min(W - p.r - 4, p.x))
      p.y = Math.max(p.r + 4, Math.min(H - p.r - 4, p.y))
    }
  }
  return pts
}

export default function Graph() {
  const [data, setData] = useState<GraphData | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [card, setCard] = useState<InterviewFull | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const [pos, setPos] = useState<Map<string, { x: number; y: number }>>(new Map())
  const svgRef = useRef<SVGSVGElement>(null)
  const W = 1100, H = 640

  useEffect(() => { get<GraphData>('/interviews/graph').then(setData).catch(() => setData({ nodes: [], edges: [], kinds: {} })) }, [])

  const visible = useMemo(() => {
    if (!data) return { nodes: [] as GraphNode[], edges: [] as GraphData['edges'] }
    const nodes = data.nodes.filter(n => !hidden.has(n.kind))
    const ids = new Set(nodes.map(n => n.id))
    return { nodes, edges: data.edges.filter(e => ids.has(e.source) && ids.has(e.target)) }
  }, [data, hidden])

  const pts = useMemo(() => layout(visible.nodes, visible.edges, W, H), [visible])
  useEffect(() => { setPos(new Map(pts.map(p => [p.id, { x: p.x, y: p.y }]))) }, [pts])

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const e of visible.edges) {
      if (!m.has(e.source)) m.set(e.source, new Set())
      if (!m.has(e.target)) m.set(e.target, new Set())
      m.get(e.source)!.add(e.target); m.get(e.target)!.add(e.source)
    }
    return m
  }, [visible])

  const focus = sel || hover
  const lit = (id: string) => !focus || id === focus || neighbors.get(focus)?.has(id)
  const selNode = sel ? visible.nodes.find(n => n.id === sel) : null

  // связи выбранного узла по типам — «из этого отдела уходят по таким причинам»
  const related = useMemo(() => {
    if (!sel) return []
    const direct = neighbors.get(sel) || new Set<string>()
    const counts = new Map<string, number>()
    if (selNode?.kind === 'interview') {
      for (const id of direct) counts.set(id, 1)
    } else {
      // через интервью: соседи соседей
      for (const iv of direct) {
        for (const id of neighbors.get(iv) || []) {
          if (id === sel) continue
          counts.set(id, (counts.get(id) || 0) + 1)
        }
      }
    }
    return [...counts.entries()]
      .map(([id, c]) => ({ node: visible.nodes.find(n => n.id === id)!, c }))
      .filter(x => x.node)
      .sort((a, b) => KIND_ORDER.indexOf(a.node.kind) - KIND_ORDER.indexOf(b.node.kind) || b.c - a.c)
  }, [sel, selNode, neighbors, visible])

  const toSvg = (e: React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }
  }

  if (!data) return <Spinner />
  if (!data.nodes.length) return <div className="card"><div className="empty">Интервью пока нет. Загрузите транскрипты, и связи появятся.</div></div>

  return (
    <>
      <div className="card">
        <div className="row spread mb-lg" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 className="card-title" style={{ margin: 0 }}>Связи: кто, откуда и почему уходит</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(data.kinds).map(([k, label]) => (
              <button key={k} className={`pill ${hidden.has(k) ? '' : 'pill-blue'}`} style={{ cursor: 'pointer', border: 'none' }}
                      onClick={() => setHidden(h => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); return n })}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: KIND_COLOR[k], marginRight: 6, opacity: hidden.has(k) ? 0.3 : 1 }} />
                {label} ({data.nodes.filter(n => n.kind === k).length})
              </button>
            ))}
            {sel && <button className="btn btn-secondary btn-sm" onClick={() => setSel(null)}>Сбросить выбор</button>}
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: sel ? '1fr 320px' : '1fr', gap: 16 }}>
          <div className="chart-wrap">
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', userSelect: 'none' }}
                 onMouseMove={e => { if (drag) { const p = toSvg(e); setPos(m => new Map(m).set(drag.id, { x: p.x - drag.dx, y: p.y - drag.dy })) } }}
                 onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}>
              {visible.edges.map(e => {
                const a = pos.get(e.source), b = pos.get(e.target)
                if (!a || !b) return null
                const on = !focus || e.source === focus || e.target === focus
                return <line key={`${e.source}|${e.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                             stroke="var(--color-text-grey)" strokeOpacity={on ? 0.45 : 0.06} strokeWidth={on && focus ? 2 : 1} />
              })}
              {pts.map(p => {
                const q = pos.get(p.id) || p
                const n = p.node
                const isIv = n.kind === 'interview'
                const label = isIv ? '' : n.name.length > 26 ? n.name.slice(0, 25) + '…' : n.name
                return (
                  <g key={p.id} opacity={lit(p.id) ? 1 : 0.15} style={{ cursor: 'pointer' }}
                     onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}
                     onMouseDown={e => { const s = toSvg(e); setDrag({ id: p.id, dx: s.x - q.x, dy: s.y - q.y }) }}
                     onClick={() => setSel(s => (s === p.id ? null : p.id))}
                     onDoubleClick={() => { if (isIv && n.interview_id) get<InterviewFull>(`/interviews/${n.interview_id}`).then(setCard) }}>
                    <circle cx={q.x} cy={q.y} r={p.r} fill={KIND_COLOR[n.kind]}
                            stroke={sel === p.id ? 'var(--color-text)' : 'var(--color-bg, #fff)'} strokeWidth={sel === p.id ? 3 : 2} />
                    {!isIv && <text x={q.x} y={q.y + 4} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={600}>{n.count}</text>}
                    {isIv && n.risk === 'High' && <circle cx={q.x} cy={q.y} r={p.r + 3} fill="none" stroke="var(--color-error, #d64541)" strokeWidth={2} />}
                    <text x={q.x} y={q.y + p.r + 13} textAnchor="middle" fontSize={11} fill="var(--color-text)">{label}</text>
                    <title>{`${data.kinds[n.kind]}: ${n.name}${isIv ? `\n${n.summary || ''}\nдвойной клик — открыть паспорт` : `\nинтервью: ${n.count}`}`}</title>
                  </g>
                )
              })}
            </svg>
          </div>
          {sel && selNode && (
            <div>
              <div className="typo-legend-12 text-grey">{data.kinds[selNode.kind]}</div>
              <div className="typo-charts-header-2 mb-lg">{selNode.name}</div>
              {selNode.kind === 'interview' && (
                <button className="btn btn-secondary btn-sm mb-lg" onClick={() => selNode.interview_id && get<InterviewFull>(`/interviews/${selNode.interview_id}`).then(setCard)}>
                  Открыть паспорт
                </button>
              )}
              {related.length === 0 ? <div className="empty">Связей нет</div> : (
                <table className="table">
                  <tbody>
                    {related.map(r => (
                      <tr key={r.node.id} className="row-clickable" onClick={() => setSel(r.node.id)}>
                        <td className="cell-main">
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: KIND_COLOR[r.node.kind], marginRight: 6 }} />
                          {r.node.name}
                          <div className="cell-sub">{data.kinds[r.node.kind]}</div>
                        </td>
                        <td style={{ textAlign: 'right', width: 60 }}>{selNode.kind === 'interview' ? '' : r.c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
      {card && (
        <Modal title={`Паспорт проблемы · ${card.filename}`} onClose={() => setCard(null)}>
          <PassportCard item={card} onChange={setCard} />
        </Modal>
      )}
    </>
  )
}
