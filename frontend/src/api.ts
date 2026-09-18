export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail || detail
    } catch { /* не JSON */ }
    if (res.status === 401 && !path.startsWith('/auth/') && window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}

export function postFile<T>(path: string, file: File): Promise<T> {
  const fd = new FormData()
  fd.append('file', file)
  return request<T>(path, { method: 'POST', body: fd })
}

export async function downloadDocx(title: string, text: string): Promise<void> {
  const res = await fetch('/api/artifacts/docx', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, text }),
  })
  if (!res.ok) throw new ApiError(res.status, 'Не удалось сформировать файл')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title}.docx`
  a.click()
  URL.revokeObjectURL(url)
}

/** Числа по-русски. compact — короткая форма для плиток: 1,2 млн вместо 1 200 000,00.
 *  Единицу измерения (рубли, тонны, штуки) добавляйте на месте вызова. */
export const fmtNum = (v: number | null | undefined, compact = false): string => {
  if (v === null || v === undefined) return '—'
  if (compact) {
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1).replace('.', ',')} млрд`
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} млн`
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)} тыс`
    return v.toFixed(0)
  }
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export const fmtMonth = (ym: string): string => {
  const [y, m] = ym.split('-')
  return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${y.slice(2)}`
}
