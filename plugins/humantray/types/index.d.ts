// The humantray mod's contract: the records it keeps in
// `<git common dir>/humantray/items.json`, and the values it holds in
// `$.state` for drawing. The file is the truth; `$.state` is a cache.

/** The five kinds of item a session can put in the tray. */
export type ItemType = 'ack' | 'choice' | 'question' | 'do' | 'approve'

/** One option of a `choice` item (and the two an `approve` item supplies). */
export type ItemOption = { label: string; description: string }

/** `open` until answered; then by type: ack, do, and every other type. */
export type ItemStatus = 'open' | 'acknowledged' | 'done' | 'answered'

/**
 * What a person's answer stores, by type:
 * ack `{ acknowledged }`, choice and approve `{ selected, other? }`,
 * question `{ text }`, do `{ outcome, feedback? }`; any may carry `notes`.
 */
export type ItemResponse =
  | { acknowledged: true; notes?: string }
  | { selected: string[]; other?: string; notes?: string }
  | { text: string; notes?: string }
  | { outcome: 'done' | 'not_done'; feedback?: string; notes?: string }

/** One item, as stored. */
export type Item = {
  /** A ULID; shown as `short`, `HT-` and its last 5 characters. */
  id: string
  short: string
  /** The `origin` remote as `host/owner/name`, or the repository's root. */
  repo: string
  session_id: string
  /** The lead this session reports to; set by a later version (#27). */
  lead_id?: string
  type: ItemType
  header: string
  question: string
  body_md: string
  options?: ItemOption[]
  multiSelect?: boolean
  notes?: boolean
  notify_on_done?: boolean
  /** The caller's key, or the question normalised. */
  key: string
  created: number
  updated: number
  bumps: number
  status: ItemStatus
  response?: ItemResponse
  response_at?: number
  /** True once the answer's line has reached the owning session. */
  delivered: boolean
  delivered_at?: number
  /** A delivery in flight: when it was claimed, and by which module instance. */
  delivering_at?: number
  delivering_by?: string
  origin: 'local' | 'relayed'
}

/** What the store knows of a session: when it was last seen, and who took over. */
export type SessionRecord = { seen: number; successor?: string }

/** The whole of `items.json`. */
export type StoreFile = {
  version: 1
  items: Item[]
  sessions: Record<string, SessionRecord>
}

/** What the pane and band draw from: the open items, newest first. */
export type Tray = { items: Item[]; me: string }

/** A card's answer while it is being made. Losing it costs a retype only. */
export type Draft = {
  selected: string[]
  other: string
  text: string
  feedback: string
  notes: string
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    humantray: {
      tray: Shaped<Tray | null>
      drafts: StateFamily<Draft>
    }
  }
}
