import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { NameCount } from '../types'

/* Палитра проверена валидатором dataviz: порядок фиксированный, не циклится. */
export const CAT_COLORS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)']

interface Tip { x: number; y: number; text: string }

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const show = (e: { clientX: number; clientY: number }, text: string) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text })
  }
  const hide = () => setTip(null)
  const tipEl = tip ? <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div> : null
  return { ref, show, hide, tipEl }
}

function Wrap({ children, tipEl, refEl }: { children: ReactNode; tipEl: ReactNode; refEl: React.RefObject<HTMLDivElement | null> }) {
  return <div className="chart-wrap" ref={refEl}>{children}{tipEl}</div>
}

/** Горизонтальные бары: один тон, значение у торца, ховер-тултип. */
export function HBarChart({ data, color = 'var(--chart-single)', max = 8 }: {
  data: NameCount[]; color?: string; max?: number
}) {
  const { ref, show, hide, tipEl } = useTip()
  if (!data.length) return <div className="empty">Нет данных</div>
  const shown = data.slice(0, max)
  const rest = data.slice(max)
  const rows = rest.length
    ? [...shown, { name: `Прочие (${rest.length})`, count: rest.reduce((s, d) => s + d.count, 0) }]
    : shown
  const top = Math.max(...rows.map(d => d.count), 1)
  return (
    <Wrap refEl={ref} tipEl={tipEl}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((d) => (
          <div key={d.name} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 44px', gap: 10, alignItems: 'center' }}
               onMouseMove={e => show(e, `${d.name}: ${d.count}`)} onMouseLeave={hide}>
            <div className="typo-legend-12 text-grey" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>{d.name}</div>
            <div style={{ height: 20, position: 'relative' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${Math.max(2, (d.count / top) * 100)}%`,
                background: color, borderRadius: '0 4px 4px 0',
              }} />
            </div>
            <div className="typo-legend-12-medium num" style={{ textAlign: 'right' }}>{d.count}</div>
          </div>
        ))}
      </div>
    </Wrap>
  )
}

/** Колонки по месяцам: один тон, скруглённый верх, редкие подписи оси X. */
export function ColumnChart({ data, color = 'var(--chart-single)' }: {
  data: { label: string; value: number }[]; color?: string
}) {
  const { ref, show, hide, tipEl } = useTip()
  if (!data.length) return <div className="empty">Нет данных</div>
  const W = 640, H = 210, padB = 26, padT = 14
  const top = Math.max(...data.map(d => d.value), 1)
  const gap = Math.min(14, Math.max(3, Math.floor(W / data.length / 4)))
  const bw = Math.max(4, Math.floor((W - gap * (data.length + 1)) / data.length))
  const every = Math.ceil(data.length / 8)
  const grid = [0.5, 1]
  const colPath = (x: number, y: number, w: number, h: number) => {
    const r = Math.min(4, w / 2, h)
    return `M ${x} ${y + h} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h} Z`
  }
  return (
    <Wrap refEl={ref} tipEl={tipEl}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        {grid.map(g => (
          <g key={g}>
            <line x1={0} x2={W} y1={padT + (H - padB - padT) * (1 - g)} y2={padT + (H - padB - padT) * (1 - g)}
                  stroke="var(--color-border-line-light)" strokeWidth={1} strokeDasharray={g === 1 ? '0' : '3 4'} />
            <text x={W - 2} y={padT + (H - padB - padT) * (1 - g) - 4} textAnchor="end" fontSize={10}
                  fill="var(--color-text-grey)">{Math.round(top * g)}</text>
          </g>
        ))}
        <line x1={0} x2={W} y1={H - padB} y2={H - padB} stroke="var(--color-border-line-light)" strokeWidth={1} />
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 3 : 0, (d.value / top) * (H - padB - padT))
          const x = gap + i * (bw + gap)
          return (
            <g key={d.label}>
              <rect x={x - gap / 2} y={padT} width={bw + gap} height={H - padB - padT} fill="transparent"
                    onMouseMove={e => show(e, `${d.label}: ${d.value}`)} onMouseLeave={hide} />
              {h > 0 && <path d={colPath(x, H - padB - h, bw, h)} fill={color} pointerEvents="none" />}
              {i % every === 0 && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--color-text-grey)">{d.label}</text>
              )}
            </g>
          )
        })}
      </svg>
    </Wrap>
  )
}

/** Donut: ≤5 категорий, 2px зазоры, итог в центре, легенда со значениями. */
export function DonutChart({ data, colors = CAT_COLORS, centerLabel = 'записей' }: {
  data: NameCount[]; colors?: string[]; centerLabel?: string
}) {
  const { ref, show, hide, tipEl } = useTip()
  if (!data.length) return <div className="empty">Нет данных</div>
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  const R = 84, r = 54, C = 100
  const padA = 0.04
  let angle = -Math.PI / 2
  const arcs = data.map((d, i) => {
    const frac = d.count / total
    const a0 = angle + padA / 2
    const a1 = angle + Math.max(frac * Math.PI * 2 - padA / 2, 0.01)
    angle += frac * Math.PI * 2
    const p = (rr: number, a: number) => `${C + rr * Math.cos(a)} ${C + rr * Math.sin(a)}`
    const large = a1 - a0 > Math.PI ? 1 : 0
    return {
      d, color: colors[i % colors.length],
      path: `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`,
    }
  })
  return (
    <Wrap refEl={ref} tipEl={tipEl}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <svg viewBox="0 0 200 200" style={{ width: 168, flexShrink: 0 }}>
          {arcs.map(a => (
            <path key={a.d.name} d={a.path} fill={a.color}
                  onMouseMove={e => show(e, `${a.d.name}: ${a.d.count} (${Math.round(a.d.count / total * 100)}%)`)}
                  onMouseLeave={hide} />
          ))}
          <text x={100} y={96} textAnchor="middle" fontSize={30} fontWeight={300} fill="var(--color-text)">{total}</text>
          <text x={100} y={116} textAnchor="middle" fontSize={11} fill="var(--color-text-grey)">{centerLabel}</text>
        </svg>
        <div className="legend" style={{ flexDirection: 'column', gap: 8, marginTop: 0 }}>
          {arcs.map(a => (
            <div className="li" key={a.d.name}>
              <span className="mark" style={{ background: a.color }} />
              <span>{a.d.name}</span>
              <span className="val">{a.d.count}</span>
              <span>· {Math.round(a.d.count / total * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Wrap>
  )
}
