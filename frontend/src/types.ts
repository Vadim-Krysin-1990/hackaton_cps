export interface User {
  id: number
  username: string
  full_name: string
  role: string
  role_label: string
  via?: 'local' | 'oidc'
}

export interface AuthConfig {
  local_login: boolean
  oidc: boolean
  oidc_label: string
}

export interface Health {
  app_title: string
  app_subtitle: string
  db: boolean
  qdrant_mode: string
  embedder: string
  llm_provider: string
  llm_model: string
  llm_available: boolean
  llm_endpoint: string
  llm_key_set: boolean
  llm_error: string
}

export interface NameCount {
  name: string
  count: number
}

export interface Evidence {
  type: 'record' | 'document'
  id?: number
  label?: string
  doc_id?: number
  title?: string | null
  page?: number | null
  snippet?: string
  score?: number
  category?: string | null
  source_url?: string | null
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  evidence?: Evidence[] | null
  at?: string | null
  pending?: boolean
}

export interface RecordItem {
  id: number
  key: string
  title: string | null
  category: string | null
  status: string | null
  amount: number | null
}

export interface RecordCard extends RecordItem {
  payload: Record<string, string | null>
}

export interface Facets {
  total: number
  amount_sum: number
  by_category: { value: string; count: number }[]
  by_status: { value: string; count: number }[]
}

export interface ColumnQuality {
  name: string
  filled: number
  filled_pct: number
  distinct: number
  example: string | null
}

export interface UploadQuality {
  rows_total: number
  empty_rows: number
  columns_total: number
  columns: ColumnQuality[]
  roles: Record<string, string>
  truncated: boolean
}

export interface UploadInfo {
  id: number
  filename: string
  kind: string
  status: string
  rows_total: number
  records_new: number
  records_updated: number
  columns: string[] | null
  quality: UploadQuality | null
  error: string | null
  created_at: string | null
}

export interface DocInfo {
  id: number
  filename: string
  title: string | null
  pages: number
  chunks: number
  status: string
  error: string | null
  source_url: string | null
  category: string
  doc_type: string
  created_at: string | null
}

export interface LibraryStats {
  categories: { name: string; documents: number; chunks: number }[]
  documents_total: number
  chunks_total: number
  vector_points: number
  errors: number
}

export interface SearchHit {
  doc_id: number | null
  title: string | null
  category: string | null
  source_url: string | null
  page: number | null
  score: number | null
  text: string
}

export interface AuditEntry {
  id: number
  username: string
  action: string
  action_label: string
  details: Record<string, unknown> | null
  duration_ms: number | null
  at: string | null
}

export interface AuditStats {
  total: number
  last_24h: number
  by_action: { action: string; label: string; count: number }[]
  by_user: { username: string; count: number }[]
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pages: number
}

export interface MetricOperation {
  action: string
  label: string
  count: number
  avg_ms: number
  max_ms: number
  speedup: number | null
}

export interface Metrics {
  manual_minutes: number
  operations: MetricOperation[]
  saved_minutes_total: number
}

export interface Artifact {
  kind: string
  title: string
  text: string
  llm_used: boolean
}

/* --- Exit-интервью --- */
export interface PainPoint {
  label: string
  category: string
  mentions: number
  quotes: string[]
}

export interface BestPractice {
  label: string
  quote: string
}

export interface Passport {
  department?: string
  manager?: string
  exit_reason: string
  exit_reason_quote: string
  says: string
  feels: string
  pain_points: PainPoint[]
  best_practices: BestPractice[]
  risk_zone: 'High' | 'Medium' | 'Low' | string
  risk_rationale: string
  top_problem: string
  improvement_suggestions: string[]
  summary: string
}

export interface SentimentPoint {
  idx: number
  score: number
  feeling: number
  markers: string[]
  snippet: string
}

export interface Anchor {
  field: string
  quote: string
  start: number
  end: number
  ratio: number
}

export interface Verification {
  checked: number
  accepted: number
  rejected: { field: string; quote: string; reason: string }[]
  anchors: Anchor[]
}

export interface UtteranceInfo {
  idx: number
  speaker: 'interviewer' | 'employee' | 'unknown'
  text: string
  start: number
  end: number
}

export interface InterviewAnalysis {
  sentiment: { points: SentimentPoint[]; mean: number; min: number; min_idx: number | null; trend: string }
  verification: Verification
  utterances: UtteranceInfo[]
  steps: { step: string; ms: number; detail: string }[]
  notes: string[]
}

export interface InterviewItem {
  id: number
  filename: string
  chars: number
  status: string
  error: string | null
  exit_reason: string | null
  risk_zone: string | null
  top_problem: string | null
  department: string
  manager: string
  engine: string
  duration_ms: number
  summary: string
  pains: number
  created_at: string | null
}

export interface InterviewFull extends InterviewItem {
  source: string
  passport: Passport
  analysis: InterviewAnalysis
}

export interface ModelsInfo {
  default: string
  available: boolean
  provider: string
  models: string[]
}

export interface Dashboard {
  total: number
  by_reason: NameCount[]
  by_risk: NameCount[]
  by_engine: NameCount[]
  pains: { name: string; count: number; mentions: number; share: number }[]
  practices: NameCount[]
  edges: { a: string; b: string; count: number }[]
  top_problem: string | null
  top_suggestions: string[]
  verification: { checked: number; accepted: number; rejected: number }
  avg_duration_ms: number
  manual_minutes: number
}

export interface GraphNode {
  id: string
  kind: 'interview' | 'department' | 'manager' | 'reason' | 'problem' | string
  name: string
  count: number
  risk?: string | null
  summary?: string
  interview_id?: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: { source: string; target: string; count: number }[]
  kinds: Record<string, string>
}

export interface Insight {
  ready: boolean
  interviews_count: number
  engine: string
  duration_ms: number
  created_at: string | null
  headline: string
  summary: string
  signals: string[]
  recommendations: { action: string; owner: string; effect: string }[]
}
