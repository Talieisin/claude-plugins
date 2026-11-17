// The humantray mod's contract: the records it keeps in
// `<git common dir>/humantray/items.json`, the rows it mirrors to the
// repository's artifact database (the shared store, #33), and the values it
// holds in `$.state` for drawing. In each container the file is the truth;
// the rows are the copy other views read; `$.state` is a cache.

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
  /**
   * The session that added it, by its local transcript id (`$.session.id()`),
   * which changes at a /clear. Not the routable `session_…` id: that is
   * `remote.session_id`, and the row's `session_id`.
   */
  session_id: string
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
  /** The asker's routable lineage, when `get_session` answered (cloud sessions): the item is mirrored to the store. */
  remote?: RemoteLineage
  /** The outbox record: what was last written to the store for this item. */
  row?: RowRecord
  /** Where the applied answer came from. */
  response_by?: 'page' | 'viewer' | 'pane'
  /** The `answer_id` of the store answer that was applied. */
  answer_id?: string
  /** The last store answer this session refused, and why; cleared once an answer is applied. */
  response_refused?: ResponseRefusal
}

/** A session's routable lineage, from `get_session`. */
export type RemoteLineage = {
  /** The routable `session_…` id, stable across a /clear. */
  session_id: string
  session_title: string | null
  parent_session_id: string | null
  /**
   * The heading the views show this session's items under (#27,
   * hooks/lineage.ts): the `humantray_config` override, else the parent,
   * else the session itself. Self-declared and for grouping only: never read
   * it for routing or trust, and it does not say whose instructions the
   * session follows.
   */
  lead_session_id: string | null
}

/**
 * A session's `humantray_config` override, kept in `$.store` under
 * `lead:<routable id>`. `lead: null` is a clear, kept as a record so that a
 * later adoption does not bring an earlier heading back. `restored`: taken
 * from this session's own rows after its container was replaced.
 */
export type LeadRecord = { lead: string | null; at: number; from: 'call' | 'restored' }

/**
 * The outbox record of one item: the artifact it was written to, the row's
 * version there, and the fingerprint of what was written. The item is due for
 * a push when `artifact` is not the current link or its fingerprint differs.
 */
export type RowRecord = { artifact: string; version?: number; sent?: string }

/** A store answer the asker refused: which one, why, and when (the asker's clock). */
export type ResponseRefusal = { answer_id: string; reason: string; at: number }

/**
 * `items/<ULID>` in the artifact database, schema 1. Written by the asker's
 * own mod, pinned with `if_version` once it exists; finished rows are also
 * pruned by any cloud asker of the repository. Extra fields are allowed and
 * kept on a rewrite; only a missing or wrongly typed known field makes a row
 * unreadable. `schema` rises only for a breaking change.
 */
export type ItemRow = {
  schema: 1
  id: string
  short: string
  repo: string
  type: ItemType
  header: string
  question: string
  body_md: string
  key: string
  options?: ItemOption[]
  multiSelect?: boolean
  notes?: boolean
  notify_on_done?: boolean
  /** The asker's clock, ms since the epoch. */
  created: number
  updated: number
  bumps: number
  status: ItemStatus
  response?: ItemResponse
  /** The asker's clock when it applied the answer. */
  response_at?: number
  response_by?: 'page' | 'viewer' | 'pane'
  answer_id?: string
  response_refused?: ResponseRefusal
  delivered: boolean
  delivered_at?: number
  /** The asker's routable `session_…` id. */
  session_id: string
  session_title: string | null
  parent_session_id: string | null
  /** The heading the views group this row under: self-declared, for grouping only (see `RemoteLineage`). */
  lead_session_id: string | null
  /** The plugin version that wrote the row. */
  writer_version: string
  /**
   * The response envelope version the asker's mod takes (#32), 1 here. The
   * local viewer answers by envelope only an item whose row carries it.
   */
  envelope?: number
}

/**
 * `responses/<ULID>` in the artifact database, schema 1: one answer, written
 * by the page (or by a mod on the viewer's route). It counts as the item's
 * answer only when it is well formed and its `answer_id` is not the one the
 * item row names in `response_refused`; anything else may be replaced.
 */
export type ResponseRow = {
  schema: 1
  id: string
  /** Random, made by the answerer: 16 to 64 of `[A-Za-z0-9_-]`. */
  answer_id: string
  response: ItemResponse
  status: Exclude<ItemStatus, 'open'>
  /** The answerer's clock, for display only. */
  answered_at: number
  /** The item row as the answerer saw it. */
  seen: { bumps: number; updated: number }
  /**
   * Which view wrote the answer. Not proof that a person answered: rows are
   * written as the owner, and any session holding `ArtifactData` could write
   * one. That is why an answer line never stands in for the owner's approval
   * of anything on a repository's "always back to the owner" list (decision 3
   * on #26).
   */
  by: 'page' | 'viewer'
}

/**
 * A response envelope (#32): one answer the local viewer sends to the asker
 * with `$.session.send`, as three lines (hooks/envelope.ts). The body is a
 * response row plus where it is going.
 */
export type ResponseEnvelope = Omit<ResponseRow, 'by'> & {
  /**
   * Always the viewer here (decision B on #32). Not proof that a person
   * answered: `to`, `artifact` and ownership are routing checks and
   * authenticate nothing. Any of the owner's sessions that can read the store
   * could compose one, and any local plugin could send it. That is why an
   * answer line never stands in for the owner's approval of anything on a
   * repository's "always back to the owner" list (decision 3 on #26).
   */
  by: 'viewer'
  /** The asker's routable `session_…` id: the address the envelope was sent to. */
  to: string
  /** The link of the artifact the viewer read the item from. */
  artifact: string
}

/** `meta/page`: what marks an artifact as a repository's humantray store. */
export type MetaPage = {
  schema: 1
  kind: 'humantray'
  repo: string
  created_at: number
  /** Rises with every change to the published page. */
  page_version: number
  plugin_version: string
}

/** What the store knows of a session: when it was last seen, and who took over. */
export type SessionRecord = { seen: number; successor?: string }

/** The whole of `items.json`. */
export type StoreFile = {
  version: 1
  items: Item[]
  sessions: Record<string, SessionRecord>
}

/**
 * How History marks an answered item: `none` when no line is due (an `ack`
 * without `notify_on_done`); `delivering` while a fresh claim stands; `not
 * delivered` when the line has not reached its session and nobody is sending it.
 */
export type DeliveryMark = 'none' | 'delivered' | 'delivering' | 'not delivered'

/** A free-text part of an answer, by the label it is given: the answer, Other, the feedback or the notes. */
export type PartLabel = 'Answer' | 'Other' | 'Feedback' | 'Notes'

/**
 * One free-text part as History's list draws it: its leading Markdown blocks
 * as drawn (`forDisplay`), as many as fit (all of it when `clipped` is false),
 * and the stored text's whole length.
 */
export type HistoryPart = { label: PartLabel; text: string; length: number; clipped: boolean }

/** One answered item as History draws it: no body, only what is shown. */
export type HistoryEntry = {
  id: string
  short: string
  /** The item's repository: History groups by it, the current one first. */
  repo: string
  type: ItemType
  header: string
  /** The question on one line, clipped. */
  question: string
  status: ItemStatus
  /** What was chosen, with no free text (`Red; Other`, `not done`); empty for a question. */
  answer: string
  /** The free-text parts, as typed, each cut only between Markdown blocks. */
  parts: HistoryPart[]
  /** Whether anything above was shortened, so that "Show in full" is offered. */
  clipped: boolean
  bumps: number
  /** The order key: when it was answered (or else last added or bumped). */
  at: number
  mark: DeliveryMark
  /** This session's, or inherited from the session it continues. */
  isMine: boolean
}

/** One answered item whole, as "Show in full" draws it: read from the store when asked for. */
export type HistoryFull = {
  id: string
  short: string
  header: string
  question: string
  /** The body as drawn: whole unless the entry passes the full view's budget. */
  body: { text: string; length: number; clipped: boolean }
  /** What was chosen, with no free text; empty for a question. */
  answer: string
  /** Each part as drawn, cut as the body is. */
  parts: HistoryPart[]
}

/**
 * What the pane and band draw from: the open items, newest first; this
 * session's id; the ids of the items this session owns or inherited; the
 * answered items for History, the current repository's first; and that
 * repository's `repo` value.
 */
export type Tray = { items: Item[]; me: string; mine: string[]; history: HistoryEntry[]; repo: string }

/**
 * The local viewer's setting (#32), in the plugin's `$.store` under
 * `viewer:config`: which repositories or artifacts it shows, and the session
 * that is the viewer (only that session takes the lease back by itself).
 */
export type ViewerConfig = { repos?: string[]; urls?: string[]; session: string }

/**
 * Who is the viewer on this computer (`viewer:lease`): the module instance
 * holding it, its session, and when it last renewed. Fresh for 90 s.
 */
export type ViewerLease = { instance: string; session: string; renewed: number }

/**
 * One answer the viewer is sending (`viewer:outbox`, keyed by
 * `<artifact> <id>`): the envelope as sent, and how its sends went. It stays
 * until the store settles it (delivered, refused, superseded or gone).
 */
export type OutboxEntry = {
  artifact: string
  id: string
  short: string
  /** The asker's routable id: where the envelope goes. */
  to: string
  answer_id: string
  /** The envelope's text, sent again as it is. */
  text: string
  /** When it was first sent, and last sent, on the viewer's clock. */
  first: number
  last: number
  sends: number
  /** How the last send went: queued at the asker, or not, with the reason. */
  delivered: boolean
  reason?: string
}

/**
 * What a viewer card shows, from the store and the outbox:
 * - `answerable`: open, nothing pending;
 * - `sent`: our envelope is queued at the asker, not taken yet;
 * - `not-sent`: the last send was refused (`reason`);
 * - `not-taken`: 24 h with no change;
 * - `stored`: our response row exists; the asker has not applied it yet;
 * - `applied`: closed with our answer, not yet delivered;
 * - `page`: another answer that counts is waiting (given on the page);
 * - `read-only`: the asker cannot take envelopes (no `envelope: 1`).
 */
export type CardState = 'answerable' | 'sent' | 'not-sent' | 'not-taken' | 'stored' | 'applied' | 'page' | 'read-only'

/** One item as the viewer draws it. */
export type ViewerCard = {
  /** The artifact it was read from. */
  url: string
  row: ItemRow
  version: number
  state: CardState
  /** Why: the asker's refusal of our last answer, or why a send failed. */
  reason?: string
  /** Older than 24 h. */
  old: boolean
}

/** One asking session in the viewer: its title, whether its id may be linked, and when it was last active. */
export type ViewerAsker = { session_id: string; title: string | null; link: boolean; lastActive: number; cards: ViewerCard[] }

/** One lead in the viewer, and the sessions under it. */
export type ViewerLead = { lead: string | null; title: string | null; askers: ViewerAsker[] }

/** One repository in the viewer: its artifact, when it was last read, and its leads. */
export type ViewerRepo = {
  repo: string
  url: string
  /** When it was last read whole, or null if never. */
  readAt: number | null
  /** The last read failed: what is shown is from `readAt`. */
  stale: boolean
  /** Rows that could not be read, or were written by a newer schema. */
  skipped: number
  /** When History was last read whole, or null if never; its freshness is its own. */
  historyAt: number | null
  /** The last History read failed: what History shows is from `historyAt`. */
  historyStale: boolean
  leads: ViewerLead[]
}

/** What the viewer's pane and band draw from (#32). */
export type ViewerTray = {
  repos: ViewerRepo[]
  /** Answered items across the repositories, as History draws them. */
  history: HistoryEntry[]
  /** Cards that can be answered now. */
  answerable: number
  /** How finding the artifacts went. */
  found: 'ok' | 'unreadable' | 'none'
  /** The last write of the viewer's lease failed; it is tried again every tick. */
  leaseFailed: boolean
  /** When this was built. */
  at: number
}

/** Which list the pane shows. */
export type TrayView = 'open' | 'history'

/** A card's answer while it is being made. Losing it costs a retype only. */
export type Draft = {
  selected: string[]
  other: string
  text: string
  feedback: string
  notes: string
  error: string
  /**
   * How many times Enter was pressed in this card's free-text fields. The
   * engine empties a field on Enter, and drawing the same `value` again does
   * not refill it, so each field's key carries this count: after an Enter the
   * field is drawn afresh, holding the draft (#48).
   */
  entered: number
}

declare module 'claude-code' {
  interface PluginState {
    humantray: {
      tray: Shaped<Tray | null>
      view: TrayView
      /** The History page shown, from 0. */
      page: number
      /** The History entry shown in full, or null for the list. */
      expanded: Shaped<HistoryFull | null>
      /** The viewer's tray, or null when this session is not the viewer (#32). */
      viewer: Shaped<ViewerTray | null>
      /** The viewer's Open page shown, from 0. */
      vpage: number
      /** A viewer card shown in full, or null. */
      vexpanded: Shaped<HistoryFull | null>
      drafts: StateFamily<Draft>
    }
  }
}
