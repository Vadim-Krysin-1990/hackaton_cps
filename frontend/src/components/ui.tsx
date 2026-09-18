import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export function Kpi({ label, value, sub, accent }: {
  label: string; value: ReactNode; sub?: ReactNode; accent?: 'red' | 'orange'
}) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${accent ? `accent-${accent}` : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

export function Modal({ title, onClose, children, footer }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head">
          <div className="t">{title}</div>
          <button className="x-btn" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Spinner() {
  return <div style={{ padding: 40 }}><div className="spin" /></div>
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
