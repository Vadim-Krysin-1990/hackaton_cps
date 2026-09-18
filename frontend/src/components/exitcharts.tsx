import { useRef, useState } from 'react'
import type { SentimentPoint } from '../types'

/** График настроения по репликам сотрудника: линия от −1 до 1, точки
 *  подсвечиваются при наведении, самая низкая точка отмечена. */
export function SentimentLine({ points, onPick }: {
  points: SentimentPoint[]; onPick?: (idx: number) => void
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  if (!points.length) return <div className="empty">Нет реплик сотрудника</div>
  const W = 640, H = 180, padL = 28, padR = 12, padT = 12, padB = 24
  const iw = W - padL - padR, ih = H - padT - padB
  const x = (i: number) => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw)
  const y = (s: number) => padT + ((1 - s) / 2) * ih
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.score)}`).join(' ')
  const minIdx = points.reduce((m, p, i) => (p.score < points[m].score ? i : m), 0)
  const show = (e: React.MouseEvent, p: SentimentPoint) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text: `${p.score > 0 ? '+' : ''}${p.score}: ${p.snippet}` })
  }
  return (
    <div className="chart-wrap" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        {[1, 0, -1].map(g => (
          <g key={g}>
            <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--color-border-line-light)"
                  strokeWidth={1} strokeDasharray={g === 0 ? '0' : '3 4'} />
            <text x={padL - 6} y={y(g) + 4} textAnchor="end" fontSize={10} fill="var(--color-text-grey)">
              {g > 0 ? '+1' : g}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--chart-single)" strokeWidth={2} />
        {points.map((p, i) => (
          <g key={p.idx}>
            <circle cx={x(i)} cy={y(p.score)} r={i === minIdx ? 6 : 4}
                    fill={p.score < -0.3 ? 'var(--color-status-red, #d64541)' : p.score > 0.2 ? 'var(--color-status-green, #2e9e5b)' : 'var(--chart-single)'}
                    stroke="var(--color-bg, #fff)" strokeWidth={1.5} style={{ cursor: onPick ? 'pointer' : 'default' }}
                    onMouseMove={e => show(e, p)} onMouseLeave={() => setTip(null)}
                    onClick={() => onPick?.(p.idx)} />
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-text-grey)">{i + 1}</text>
          </g>
        ))}
      </svg>
      {tip && <div className="chart-tip" style={{ left: tip.x, top: tip.y, maxWidth: 320 }}>{tip.text}</div>}
    </div>
  )
}

/** Граф связей между категориями проблем: узлы по кругу, толщина ребра —
 *  сколько интервью, где обе проблемы встретились вместе. */
export function RelationGraph({ nodes, edges }: {
  nodes: { name: string; count: number }[]
  edges: { a: string; b: string; count: number }[]
}) {
  const [hover, setHover] = useState<string | null>(null)
  if (nodes.length < 2) return <div className="empty">Нужно хотя бы два вида проблем</div>
  const W = 640, H = 340, cx = W / 2, cy = H / 2, R = 120
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((n, i) => {
    const a = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2
    pos.set(n.name, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) })
  })
  const maxE = Math.max(...edges.map(e => e.count), 1)
  const maxN = Math.max(...nodes.map(n => n.count), 1)
  const active = (name: string) => !hover || hover === name || edges.some(e => e.count > 0 && ((e.a === hover && e.b === name) || (e.b === hover && e.a === name)))
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        {edges.map(e => {
          const a = pos.get(e.a), b = pos.get(e.b)
          if (!a || !b) return null
          const dim = hover && hover !== e.a && hover !== e.b
          return (
            <line key={`${e.a}|${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="var(--chart-single)" strokeOpacity={dim ? 0.08 : 0.25 + 0.6 * (e.count / maxE)}
                  strokeWidth={1 + 5 * (e.count / maxE)} />
          )
        })}
        {nodes.map(n => {
          const p = pos.get(n.name)!
          const r = 8 + 14 * (n.count / maxN)
          const left = p.x < cx - 10, right = p.x > cx + 10
          return (
            <g key={n.name} onMouseEnter={() => setHover(n.name)} onMouseLeave={() => setHover(null)}
               style={{ cursor: 'default' }} opacity={active(n.name) ? 1 : 0.3}>
              <circle cx={p.x} cy={p.y} r={r} fill="var(--cat-1)" stroke="var(--color-bg, #fff)" strokeWidth={2} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={600}>{n.count}</text>
              <text x={left ? p.x - r - 6 : right ? p.x + r + 6 : p.x}
                    y={p.y < cy - 10 ? p.y - r - 8 : p.y > cy + 10 ? p.y + r + 16 : p.y + 4}
                    textAnchor={left ? 'end' : right ? 'start' : 'middle'} fontSize={12}
                    fill="var(--color-text)">{n.name}</text>
            </g>
          )
        })}
      </svg>
      <div className="typo-legend-12 text-grey" style={{ marginTop: 6 }}>
        Толщина линии — в скольких интервью две проблемы названы вместе. Наведите на узел.
      </div>
    </div>
  )
}
