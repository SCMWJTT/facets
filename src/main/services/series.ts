// Series: editorial collections (requirements section 11).
// A Series is independent of Shoots: it never stores a shoot link, and changing its members
// never changes a Photo's Shoot or Photo ID. Series IDs are issued outside the undo log.
import type { Library, Tx } from '../db/library'
import type { OverlapWarning, Series, SeriesPatch } from '@shared/types'
import { slugify } from '@shared/naming'
import { assignNode, nodeDomain } from './catalog'

const nowIso = (): string => new Date().toISOString()
const b = (v: unknown): boolean => v === 1 || v === true

export function readSeriesFull(lib: Library, ids?: number[]): Series[] {
  const where = ids ? `WHERE retired = 0 AND id IN (${ids.join(',') || '0'})` : 'WHERE retired = 0'
  const rows = lib.db.prepare(`SELECT * FROM series ${where} ORDER BY public_id`).all() as Record<string, unknown>[]
  const group = (sql: string): Map<number, number[]> => {
    const m = new Map<number, number[]>()
    for (const r of lib.db.prepare(sql).all() as { s: number; v: number }[]) {
      let a = m.get(r.s)
      if (!a) m.set(r.s, (a = []))
      a.push(r.v)
    }
    return m
  }
  const members = group(
    `SELECT m.series_id AS s, m.photo_id AS v FROM series_members m JOIN photos p ON p.id = m.photo_id AND p.retired = 0
     ORDER BY m.series_id, m.position, p.captured, p.raw_key`
  )
  const featured = group('SELECT series_id AS s, photo_id AS v FROM series_featured ORDER BY series_id, position')
  const supporting = group("SELECT series_id AS s, node_id AS v FROM series_nodes WHERE role = 'supporting' ORDER BY id")
  const places = group('SELECT series_id AS s, node_id AS v FROM series_places ORDER BY id')
  return rows.map((r) => {
    const id = r.id as number
    return {
      id,
      publicId: r.public_id as string,
      title: r.title as string,
      slug: r.slug as string,
      slugFrozen: b(r.slug_frozen),
      summary: r.summary as string,
      narrative: r.narrative as string,
      primaryNodeId: (r.primary_node_id as number) ?? null,
      themeRationale: r.theme_rationale as string,
      privacy: r.privacy as Series['privacy'],
      coverPhotoId: (r.cover_photo_id as number) ?? null,
      memberOrder: r.member_order as Series['memberOrder'],
      anchorLat: (r.anchor_lat as number) ?? null,
      anchorLon: (r.anchor_lon as number) ?? null,
      anchorMode: r.anchor_mode as Series['anchorMode'],
      dateLabel: r.date_label as string,
      writeup: r.writeup as string,
      sources: r.sources as string,
      status: r.status as Series['status'],
      verified: b(r.verified),
      provenance: r.provenance as string,
      createdAt: r.created_at as string,
      members: members.get(id) ?? [],
      featured: featured.get(id) ?? [],
      supporting: supporting.get(id) ?? [],
      places: places.get(id) ?? []
    }
  })
}

/** Issue the next Series ID. Written outside the undo log: an ID, once issued, is never issued again. */
function issueSeriesId(lib: Library, title: string): string {
  const r = lib.db.prepare("SELECT value FROM meta WHERE key = 'next_series'").get() as { value: string } | undefined
  let n = Number(r?.value ?? 1)
  let id = `SER-${String(n).padStart(6, '0')}`
  while (lib.db.prepare('SELECT 1 FROM series_registry WHERE public_id = ?').get(id)) id = `SER-${String(++n).padStart(6, '0')}`
  lib.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('next_series', ?)").run(String(n + 1))
  lib.db
    .prepare("INSERT INTO series_registry (public_id, number, title, state, issued_at) VALUES (?, ?, ?, 'active', ?)")
    .run(id, n, title, nowIso())
  return id
}

function facetKeyOfNode(lib: Library, nodeId: number): { key: string; kind: string } | null {
  return (
    (lib.db
      .prepare('SELECT t.key, t.kind FROM nodes n JOIN trees t ON t.id = n.tree_id WHERE n.id = ?')
      .get(nodeId) as { key: string; kind: string } | undefined) ?? null
  )
}

function checkTitle(lib: Library, title: string, exceptId: number | null): string {
  const t = title.trim()
  if (!t) throw new Error('A Series needs a title.')
  const clash = lib.db
    .prepare('SELECT public_id FROM series WHERE retired = 0 AND title = ? COLLATE NOCASE AND id IS NOT ?')
    .get(t, exceptId) as { public_id: string } | undefined
  if (clash)
    throw new Error(`Another Series (${clash.public_id}) already has this title. Add a year or a place to tell them apart.`)
  return t
}

function checkPrimary(lib: Library, nodeId: number | null, rationale: string): void {
  if (nodeId === null) return
  const f = facetKeyOfNode(lib, nodeId)
  if (!f || f.kind !== 'facet') throw new Error('The primary keyword must come from one of the five Facets.')
  if (f.key === 'theme' && !rationale.trim()) throw new Error('A Series whose Primary Facet is Theme needs a short rationale.')
}

/** Photos sorted by capture time, then raw key. */
function captureOrder(lib: Library, ids: number[]): number[] {
  if (!ids.length) return []
  return (
    lib.db
      .prepare(`SELECT id FROM photos WHERE id IN (${ids.join(',')}) ORDER BY captured IS NULL, captured, raw_key, variant_no`)
      .all() as { id: number }[]
  ).map((r) => r.id)
}

export interface NewSeries {
  title: string
  primaryNodeId: number | null
  themeRationale?: string
  summary?: string
  photoIds: number[]
  provenance?: string
}

export function createSeries(tx: Tx, lib: Library, s: NewSeries): number {
  const title = checkTitle(lib, s.title, null)
  checkPrimary(lib, s.primaryNodeId, s.themeRationale ?? '')
  const publicId = issueSeriesId(lib, title)
  const id = tx.insert('series', {
    public_id: publicId,
    title,
    slug: slugify(title),
    summary: s.summary ?? '',
    primary_node_id: s.primaryNodeId,
    theme_rationale: s.themeRationale ?? '',
    provenance: s.provenance ?? 'user',
    created_at: nowIso()
  })
  lib.db.prepare('UPDATE series_registry SET series_row_id = ? WHERE public_id = ?').run(id, publicId)
  addMembers(tx, lib, id, s.photoIds)
  const first = captureOrder(lib, s.photoIds)[0]
  if (first) tx.set('series', id, 'cover_photo_id', first)
  tx.touchedTables.add('series')
  return id
}

const SERIES_FIELDS: Record<string, string> = {
  title: 'title',
  slug: 'slug',
  summary: 'summary',
  narrative: 'narrative',
  primaryNodeId: 'primary_node_id',
  themeRationale: 'theme_rationale',
  privacy: 'privacy',
  coverPhotoId: 'cover_photo_id',
  memberOrder: 'member_order',
  anchorLat: 'anchor_lat',
  anchorLon: 'anchor_lon',
  anchorMode: 'anchor_mode',
  dateLabel: 'date_label',
  writeup: 'writeup',
  sources: 'sources',
  status: 'status',
  verified: 'verified'
}

export function updateSeries(tx: Tx, lib: Library, id: number, patch: SeriesPatch): number {
  const cur = lib.db.prepare('SELECT * FROM series WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!cur) throw new Error('That Series no longer exists.')
  let n = 0
  const p = { ...patch }
  if (p.title !== undefined) {
    p.title = checkTitle(lib, p.title, id)
    if (p.title !== cur.title) {
      tx.insert('name_history', { kind: 'series_title', row_id: id, old_name: cur.title, new_name: p.title, at: nowIso() })
      // The slug follows the title until the Series is first published; after that it is frozen.
      if (!cur.slug_frozen && p.slug === undefined) p.slug = slugify(p.title)
    }
  }
  if (p.slug !== undefined) {
    p.slug = slugify(p.slug)
    if (cur.slug_frozen && p.slug !== cur.slug)
      tx.insert('name_history', { kind: 'series_slug', row_id: id, old_name: cur.slug, new_name: p.slug, at: nowIso() })
  }
  const primary = p.primaryNodeId !== undefined ? p.primaryNodeId : (cur.primary_node_id as number | null)
  const rationale = p.themeRationale !== undefined ? p.themeRationale : (cur.theme_rationale as string)
  if (p.primaryNodeId !== undefined || p.themeRationale !== undefined) checkPrimary(lib, primary, rationale)
  for (const [k, v] of Object.entries(p)) {
    const col = SERIES_FIELDS[k]
    if (!col) continue
    const val = typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' && k !== 'narrative' ? v.trim() : v
    if (tx.set('series', id, col, val)) n++
  }
  if (p.memberOrder === 'capture') reorderByCapture(tx, lib, id)
  tx.touchedTables.add('series')
  return n
}

function reorderByCapture(tx: Tx, lib: Library, sid: number): void {
  const rows = lib.db.prepare('SELECT id, photo_id FROM series_members WHERE series_id = ?').all(sid) as { id: number; photo_id: number }[]
  const order = captureOrder(lib, rows.map((r) => r.photo_id))
  const byPhoto = new Map(rows.map((r) => [r.photo_id, r.id]))
  order.forEach((pid, i) => tx.set('series_members', byPhoto.get(pid)!, 'position', i + 1))
}

export function addMembers(tx: Tx, lib: Library, sid: number, ids: number[]): number {
  const have = new Set(
    (lib.db.prepare('SELECT photo_id FROM series_members WHERE series_id = ?').all(sid) as { photo_id: number }[]).map((r) => r.photo_id)
  )
  const fresh = captureOrder(lib, ids.filter((id) => !have.has(id)))
  if (!fresh.length) return 0
  let pos = (lib.db.prepare('SELECT COALESCE(MAX(position), 0) AS n FROM series_members WHERE series_id = ?').get(sid) as { n: number }).n
  for (const pid of fresh) tx.insert('series_members', { series_id: sid, photo_id: pid, position: ++pos })
  const order = (lib.db.prepare('SELECT member_order FROM series WHERE id = ?').get(sid) as { member_order: string }).member_order
  if (order === 'capture') reorderByCapture(tx, lib, sid)
  tx.touchedTables.add('series')
  return fresh.length
}

export function removeMembers(tx: Tx, lib: Library, sid: number, ids: number[]): number {
  let n = 0
  const want = new Set(ids)
  for (const r of lib.db.prepare('SELECT id, photo_id FROM series_members WHERE series_id = ?').all(sid) as { id: number; photo_id: number }[]) {
    if (!want.has(r.photo_id)) continue
    tx.delete('series_members', r.id)
    n++
  }
  for (const r of lib.db.prepare('SELECT id, photo_id FROM series_featured WHERE series_id = ?').all(sid) as { id: number; photo_id: number }[])
    if (want.has(r.photo_id)) tx.delete('series_featured', r.id)
  const cover = (lib.db.prepare('SELECT cover_photo_id AS c FROM series WHERE id = ?').get(sid) as { c: number | null }).c
  if (cover !== null && want.has(cover)) {
    const next = lib.db.prepare('SELECT photo_id FROM series_members WHERE series_id = ? ORDER BY position LIMIT 1').get(sid) as
      | { photo_id: number }
      | undefined
    tx.set('series', sid, 'cover_photo_id', next?.photo_id ?? null)
  }
  tx.touchedTables.add('series')
  return n
}

/** Put members in a manual editorial order (the order given; members not listed keep their place after). */
export function reorderMembers(tx: Tx, lib: Library, sid: number, ordered: number[]): void {
  const rows = lib.db.prepare('SELECT id, photo_id FROM series_members WHERE series_id = ? ORDER BY position').all(sid) as {
    id: number
    photo_id: number
  }[]
  const byPhoto = new Map(rows.map((r) => [r.photo_id, r.id]))
  const rest = rows.map((r) => r.photo_id).filter((p) => !ordered.includes(p))
  ;[...ordered.filter((p) => byPhoto.has(p)), ...rest].forEach((pid, i) => tx.set('series_members', byPhoto.get(pid)!, 'position', i + 1))
  tx.set('series', sid, 'member_order', 'manual')
  tx.touchedTables.add('series')
}

export function setFeatured(tx: Tx, lib: Library, sid: number, photoId: number, on: boolean): void {
  const row = lib.db.prepare('SELECT id FROM series_featured WHERE series_id = ? AND photo_id = ?').get(sid, photoId) as { id: number } | undefined
  if (on && !row) {
    const n = (lib.db.prepare('SELECT COUNT(*) AS n FROM series_featured WHERE series_id = ?').get(sid) as { n: number }).n
    if (n >= 12) throw new Error('A Series can feature at most 12 photos.')
    tx.insert('series_featured', { series_id: sid, photo_id: photoId, position: n + 1 })
  } else if (!on && row) tx.delete('series_featured', row.id)
  tx.touchedTables.add('series')
}

export function setSupporting(tx: Tx, lib: Library, sid: number, nodeId: number, on: boolean): void {
  const row = lib.db.prepare('SELECT id FROM series_nodes WHERE series_id = ? AND node_id = ?').get(sid, nodeId) as { id: number } | undefined
  if (on && !row) tx.insert('series_nodes', { series_id: sid, node_id: nodeId, role: 'supporting', domain: nodeDomain(lib, nodeId) })
  else if (!on && row) tx.delete('series_nodes', row.id)
  tx.touchedTables.add('series')
}

export function setPlace(tx: Tx, lib: Library, sid: number, nodeId: number, on: boolean): void {
  const row = lib.db.prepare('SELECT id FROM series_places WHERE series_id = ? AND node_id = ?').get(sid, nodeId) as { id: number } | undefined
  if (on && !row) tx.insert('series_places', { series_id: sid, node_id: nodeId })
  else if (!on && row) tx.delete('series_places', row.id)
  tx.touchedTables.add('series')
}

/** Soft retire. The Series ID is never reused. */
export function retireSeries(tx: Tx, sid: number): void {
  tx.set('series', sid, 'retired', 1)
  tx.touchedTables.add('series')
}

/**
 * "Apply Series keywords to member photos": an explicit, previewed, undoable action.
 * Series keywords never reach the photos silently.
 */
export function applySeriesKeywords(tx: Tx, lib: Library, sid: number, nodeIds: number[]): number {
  const members = (lib.db.prepare('SELECT photo_id FROM series_members WHERE series_id = ?').all(sid) as { photo_id: number }[]).map(
    (r) => r.photo_id
  )
  let n = 0
  for (const node of nodeIds) n += assignNode(tx, lib, members, node, { provenance: 'series' })
  return n
}

/**
 * Warn when a Series would largely repeat another: more than 80% of its photos are shared with a Series
 * that has the same primary keyword or a similar title. The user may proceed.
 */
export function overlapWarnings(
  lib: Library,
  q: { photoIds: number[]; primaryNodeId: number | null; title: string; excludeId?: number | null }
): OverlapWarning[] {
  if (!q.photoIds.length) return []
  const mine = new Set(q.photoIds)
  const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const t = norm(q.title)
  const out: OverlapWarning[] = []
  for (const s of readSeriesFull(lib)) {
    if (s.id === q.excludeId) continue
    const shared = s.members.filter((m) => mine.has(m)).length
    const pct = shared / mine.size
    if (pct <= 0.8) continue
    const other = norm(s.title)
    const similar = !!t && !!other && (t === other || t.includes(other) || other.includes(t))
    const same = q.primaryNodeId !== null && s.primaryNodeId === q.primaryNodeId
    if (same || similar)
      out.push({ seriesId: s.id, publicId: s.publicId, title: s.title, shared, pct: Math.round(pct * 100), reason: same ? 'same primary keyword' : 'similar title' })
  }
  return out
}

export interface SeriesRegistryRow {
  publicId: string
  title: string
  state: 'active' | 'retired'
  issuedAt: string
  titles: string[] // earlier titles, oldest first
  aliases: string[]
}

export function readSeriesRegistry(lib: Library): SeriesRegistryRow[] {
  const rows = lib.db
    .prepare(
      `SELECT r.public_id, r.title AS first_title, r.issued_at, s.id, s.title, s.retired
       FROM series_registry r LEFT JOIN series s ON s.public_id = r.public_id ORDER BY r.public_id`
    )
    .all() as { public_id: string; first_title: string; issued_at: string; id: number | null; title: string | null; retired: number | null }[]
  return rows.map((r) => {
    const titles =
      r.id === null
        ? []
        : (lib.db.prepare("SELECT old_name FROM name_history WHERE kind = 'series_title' AND row_id = ? ORDER BY id").all(r.id) as { old_name: string }[]).map(
            (x) => x.old_name
          )
    const aliases =
      r.id === null
        ? []
        : (lib.db.prepare("SELECT alias FROM aliases WHERE target_kind = 'series' AND target_id = ?").all(r.id) as { alias: string }[]).map((x) => x.alias)
    return {
      publicId: r.public_id,
      title: r.title ?? r.first_title,
      state: r.id !== null && r.retired === 0 ? 'active' : 'retired',
      issuedAt: r.issued_at,
      titles,
      aliases
    }
  })
}

/** Change history of one Series and its member, keyword, place and featured lists. */
export function seriesHistory(lib: Library, sid: number): { at: string; label: string; field: string; oldValue: unknown; newValue: unknown; undone: boolean }[] {
  const rows = lib.db
    .prepare(
      `SELECT o.at, o.label, o.undone, c.tbl, c.op, c.field, c.old_value, c.new_value FROM changes c JOIN operations o ON o.id = c.op_id
       WHERE (c.tbl = 'series' AND c.row_id = ?)
          OR (c.tbl IN ('series_members','series_featured','series_nodes','series_places')
              AND COALESCE(json_extract(c.new_value, '$.series_id'), json_extract(c.old_value, '$.series_id')) = ?)
       ORDER BY c.id DESC LIMIT 400`
    )
    .all(sid, sid) as { at: string; label: string; undone: number; tbl: string; op: string; field: string | null; old_value: string | null; new_value: string | null }[]
  const parse = (v: string | null): unknown => {
    try {
      return v === null ? null : JSON.parse(v)
    } catch {
      return v
    }
  }
  const tblName: Record<string, string> = { series_members: 'members', series_featured: 'featured', series_nodes: 'supporting keywords', series_places: 'places' }
  return rows.map((r) => ({
    at: r.at,
    label: r.label,
    undone: r.undone === 1,
    field: r.tbl === 'series' ? r.field ?? (r.op === 'insert' ? 'created' : r.op) : `${tblName[r.tbl]} (${r.op === 'insert' ? 'added' : 'removed'})`,
    oldValue: r.tbl === 'series' ? parse(r.old_value) : null,
    newValue: r.tbl === 'series' ? parse(r.new_value) : null
  }))
}
