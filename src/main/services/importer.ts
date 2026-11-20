// Import a folder of Lightroom-exported JPEGs. Image files are only ever read.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { DuplicateChoice, DuplicateGroup, ImportReport, Settings } from '@shared/types'
import { Library, Tx, nowIso } from '../db/library'
import { readExif, type ExifData } from './exif'
import { assignNode, createTree, findOrCreatePath, rebuildClosure } from './catalog'

const JPEG = /\.jpe?g$/i

export interface ScannedFile {
  file: string
  rawKey: string
  size: number
  mtime: number
}

export function rawKeyOf(file: string, pattern: string): string {
  const stem = path.basename(file).replace(/\.[^.]+$/, '')
  if (!pattern) return stem
  try {
    const m = stem.match(new RegExp(pattern))
    if (m) return (m[1] ?? m[0]).trim() || stem
  } catch {
    /* invalid pattern: fall back to the stem */
  }
  return stem
}

export function scanFolder(folder: string, recursive: boolean, pattern: string) {
  const files: ScannedFile[] = []
  const skipped: { file: string; reason: string }[] = []
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      skipped.push({ file: dir, reason: `Folder unreadable: ${(e as Error).message}` })
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (recursive) walk(full)
        continue
      }
      if (!e.isFile()) continue
      if (!JPEG.test(e.name)) {
        skipped.push({ file: full, reason: 'Not a JPEG' })
        continue
      }
      const st = fs.statSync(full)
      files.push({ file: full, rawKey: rawKeyOf(full, pattern), size: st.size, mtime: st.mtimeMs })
    }
  }
  walk(folder)
  return { files, skipped }
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1')
    fs.createReadStream(file, { flags: 'r' })
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

interface Existing {
  id: number
  raw_key: string
  variant_no: number
  file_path: string
  file_size: number
  file_mtime: number
  file_hash: string
  file_offline: number
  thumb_ver: number
}

type Plan =
  | { kind: 'new'; f: ScannedFile; variantNo: number }
  | { kind: 'known'; f: ScannedFile; ex: Existing }
  | { kind: 'replaced'; f: ScannedFile }

/** Work out which files need the user to choose "variant" or "replacement". */
export function findDuplicates(lib: Library, files: ScannedFile[]): DuplicateGroup[] {
  const out: DuplicateGroup[] = []
  for (const [key, group] of groupByKey(files)) {
    if (group.length < 2) continue
    const ex = existingFor(lib, key)
    const names = new Set(ex.map((e) => path.basename(e.file_path).toLowerCase()))
    const unmatched = group.filter((f) => !names.has(path.basename(f.file).toLowerCase()))
    if (unmatched.length >= 2 || (unmatched.length >= 1 && group.length - unmatched.length >= 1 && ex.length < group.length))
      out.push({ rawKey: group[0].rawKey, files: group.map((g) => g.file) })
  }
  return out
}

function groupByKey(files: ScannedFile[]): Map<string, ScannedFile[]> {
  const m = new Map<string, ScannedFile[]>()
  for (const f of files) {
    const k = f.rawKey.toLowerCase()
    const a = m.get(k) ?? []
    a.push(f)
    m.set(k, a)
  }
  for (const a of m.values()) a.sort((x, y) => x.file.localeCompare(y.file))
  return m
}

function existingFor(lib: Library, key: string): Existing[] {
  return lib.db
    .prepare('SELECT * FROM photos WHERE raw_key = ? COLLATE NOCASE AND retired = 0 ORDER BY variant_no')
    .all(key) as Existing[]
}

function plan(lib: Library, files: ScannedFile[], choices: Record<string, DuplicateChoice>): Plan[] {
  const plans: Plan[] = []
  for (const [key, group] of groupByKey(files)) {
    const ex = existingFor(lib, key)
    const free = [...ex]
    const rest: ScannedFile[] = []
    // 1. Same file name as a known record.
    for (const f of group) {
      const i = free.findIndex((e) => path.basename(e.file_path).toLowerCase() === path.basename(f.file).toLowerCase())
      if (i >= 0) plans.push({ kind: 'known', f, ex: free.splice(i, 1)[0] })
      else rest.push(f)
    }
    if (!rest.length) continue
    const choice = choices[key] ?? choices[group[0].rawKey] ?? 'variant'
    if (group.length >= 2 && choice === 'replace') {
      // Keep only the newest file; the others are reported as replaced.
      rest.sort((a, c) => c.mtime - a.mtime)
      const keep = rest.shift()!
      for (const r of rest) plans.push({ kind: 'replaced', f: r })
      if (free.length) plans.push({ kind: 'known', f: keep, ex: free.shift()! })
      else plans.push({ kind: 'new', f: keep, variantNo: nextVariant(lib, key, plans) })
      continue
    }
    // 2. Remaining files take remaining known records in order, then become new photos or variants.
    for (const f of rest) {
      if (free.length) plans.push({ kind: 'known', f, ex: free.shift()! })
      else plans.push({ kind: 'new', f, variantNo: nextVariant(lib, key, plans) })
    }
  }
  return plans
}

function nextVariant(lib: Library, key: string, plans: Plan[]): number {
  const r = lib.db.prepare('SELECT MAX(variant_no) AS m FROM photos WHERE raw_key = ? COLLATE NOCASE').get(key) as {
    m: number | null
  }
  let n = r.m === null ? 0 : r.m + 1
  for (const p of plans) if (p.kind === 'new' && p.f.rawKey.toLowerCase() === key && p.variantNo >= n) n = p.variantNo + 1
  return n
}

export interface ImportOptions {
  folder: string
  recursive: boolean
  /** false = do not keep any position or place from these files (private places). Default true. */
  retainLocation?: boolean
  choices?: Record<string, DuplicateChoice>
  onProgress?: (done: number, total: number, label: string) => void
}

export type ImportOutcome =
  | { needsChoice: DuplicateGroup[] }
  | { importId: number; setId: number | null; report: ImportReport; newIds: number[]; changedIds: number[]; allIds: number[] }

export async function runImport(lib: Library, opts: ImportOptions): Promise<ImportOutcome> {
  const settings = lib.getSettings()
  const { files, skipped } = scanFolder(opts.folder, opts.recursive, settings.rawKeyPattern)
  const dups = findDuplicates(lib, files)
  if (dups.length && !opts.choices) return { needsChoice: dups }
  const plans = plan(lib, files, opts.choices ?? {})
  const retain = opts.retainLocation !== false
  const report: ImportReport = { added: [], known: [], changed: [], variants: [], replaced: [], relinked: [], skipped, flags: [], locationRetained: retain }

  // Decide content state and read metadata where needed.
  const total = plans.length
  let done = 0
  const work: { p: Plan; hash: string; exif: ExifData | null; state: 'new' | 'same' | 'changed' | 'replaced' }[] = []
  const tick = (label: string): void => {
    done++
    if (done % 10 === 0 || done === total) opts.onProgress?.(done, total, label)
  }
  const queue = [...plans]
  const worker = async (): Promise<void> => {
    while (queue.length) {
      const p = queue.shift()!
      try {
        if (p.kind === 'replaced') {
          work.push({ p, hash: '', exif: null, state: 'replaced' })
        } else if (p.kind === 'known') {
          const sameStat = p.ex.file_size === p.f.size && Math.abs(p.ex.file_mtime - p.f.mtime) < 2
          let hash = p.ex.file_hash
          let state: 'same' | 'changed' = 'same'
          if (!sameStat) {
            hash = await hashFile(p.f.file)
            state = hash === p.ex.file_hash ? 'same' : 'changed'
          }
          const exif = state === 'changed' ? await readExif(p.f.file) : null
          work.push({ p, hash, exif, state })
        } else {
          const [hash, exif] = await Promise.all([hashFile(p.f.file), readExif(p.f.file)])
          work.push({ p, hash, exif, state: 'new' })
        }
      } catch (e) {
        report.skipped.push({ file: p.f.file, reason: `Unreadable: ${(e as Error).message}` })
      }
      tick(path.basename(p.f.file))
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))

  // Write everything in one transaction.
  const newIds: number[] = []
  const changedIds: number[] = []
  const allIds: number[] = []
  const t = nowIso()
  const folderName = path.basename(opts.folder) || opts.folder
  let setId: number | null = null
  lib.action(
    `Import ${folderName}`,
    (tx) => {
      const insPhoto = lib.db.prepare(`INSERT INTO photos (
          raw_key, variant_no, title, caption, note, alt, rating, creator, copyright, licence, credit,
          lat, lon, elevation, cam_lat, cam_lon, cam_ele, pos_source, location_state, captured, width, height,
          camera_body, lens, focal, aperture, shutter, iso, file_path, file_size, file_mtime, file_hash,
          imported_at, modified_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      const updKnown = lib.db.prepare(
        'UPDATE photos SET file_path = ?, file_size = ?, file_mtime = ?, file_offline = 0 WHERE id = ?'
      )
      const updChanged = lib.db.prepare(`UPDATE photos SET file_path = ?, file_size = ?, file_mtime = ?, file_hash = ?,
          file_offline = 0, width = ?, height = ?, camera_body = ?, lens = ?, focal = ?, aperture = ?, shutter = ?, iso = ?,
          cam_lat = CASE WHEN location_state = 'not_retained' THEN NULL ELSE ? END,
          cam_lon = CASE WHEN location_state = 'not_retained' THEN NULL ELSE ? END,
          cam_ele = CASE WHEN location_state = 'not_retained' THEN NULL ELSE ? END,
          captured = COALESCE(?, captured), thumb_ver = -ABS(thumb_ver) WHERE id = ?`)
      for (const w of work) {
        const f = w.p.f
        if (w.state === 'replaced') {
          report.replaced.push(f.file)
          continue
        }
        if (w.exif?.preservedName) {
          const pk = w.exif.preservedName.replace(/\.[^.]+$/, '')
          if (pk.toLowerCase() !== f.rawKey.toLowerCase())
            report.flags.push({ file: f.file, message: `Embedded original name "${w.exif.preservedName}" differs from raw key "${f.rawKey}"` })
        }
        if (w.p.kind === 'known') {
          const ex = w.p.ex
          if (w.state === 'same') {
            updKnown.run(f.file, f.size, f.mtime, ex.id)
            if (ex.file_offline || path.resolve(ex.file_path) !== path.resolve(f.file)) report.relinked.push(f.file)
            report.known.push(f.file)
          } else {
            const x = w.exif!
            updChanged.run(f.file, f.size, f.mtime, w.hash, x.width, x.height, x.cameraBody, x.lens, x.focal, x.aperture,
              x.shutter, x.iso, retain ? x.lat : null, retain ? x.lon : null, retain ? x.ele : null, x.captured, ex.id)
            report.changed.push(f.file)
            changedIds.push(ex.id)
          }
          allIds.push(ex.id)
          continue
        }
        // New photo: seed fields once from embedded metadata.
        const x = w.exif!
        const variantNo = w.p.kind === 'new' ? w.p.variantNo : 0
        const s = seedText(x, settings)
        const lat = retain ? x.lat : null
        const lon = retain ? x.lon : null
        const ele = retain ? x.ele : null
        const hasPos = lat !== null && lon !== null
        const info = insPhoto.run(
          f.rawKey, variantNo, s.title, s.caption, s.note, s.alt, x.rating, s.creator, s.copyright,
          settings.licence, settings.credit, lat, lon, ele, lat, lon, ele,
          hasPos ? 'camera' : 'none', retain ? (hasPos ? 'known' : 'missing_gps') : 'not_retained', x.captured, x.width, x.height,
          x.cameraBody, x.lens, x.focal, x.aperture, x.shutter, x.iso, f.file, f.size, f.mtime, w.hash, t, t
        )
        const id = Number(info.lastInsertRowid)
        newIds.push(id)
        allIds.push(id)
        if (variantNo > 0) report.variants.push(f.file)
        else report.added.push(f.file)
        seedTrees(tx, lib, id, x, settings, retain)
      }
      // The import Set. A re-import that brings nothing new or changed leaves the library exactly as it was.
      if (newIds.length || changedIds.length) {
        const sid = lib.db
          .prepare("INSERT INTO sets (name, kind, created_at) VALUES (?, 'import', ?)")
          .run(`${folderName} · ${t.slice(0, 10)}`, t)
        setId = Number(sid.lastInsertRowid)
        const mem = lib.db.prepare('INSERT OR IGNORE INTO set_members (set_id, photo_id) VALUES (?, ?)')
        for (const id of allIds) mem.run(setId, id)
        tx.touchedTables.add('sets')
      }
      report.setCreated = setId !== null
    },
    { undoable: false, source: 'import', params: { folder: opts.folder, recursive: opts.recursive, retainLocation: retain } }
  )
  rebuildClosure(lib)

  const r = report
  const info = lib.db
    .prepare(
      'INSERT INTO imports (at, folder, scanned, added, known, changed, variants, skipped, set_id, options, report) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(t, opts.folder, files.length + skipped.length, r.added.length, r.known.length, r.changed.length,
      r.variants.length, r.skipped.length + r.replaced.length, setId, JSON.stringify({ recursive: opts.recursive, retainLocation: retain }), JSON.stringify(r))
  lib.log(
    `Import ${opts.folder}: scanned ${files.length + skipped.length}, new ${r.added.length}, already catalogued ${r.known.length}, re-exported ${r.changed.length}, variants ${r.variants.length}, skipped ${r.skipped.length}, replaced ${r.replaced.length}, flagged ${r.flags.length}`
  )
  return { importId: Number(info.lastInsertRowid), setId, report, newIds, changedIds, allIds }
}

function seedText(x: ExifData, s: Settings) {
  let caption = x.headline
  let note = ''
  const d = x.description
  if (d) {
    if (!caption && d.length <= 240 && !/\n\s*\n/.test(d)) caption = d
    else note = d
  }
  return {
    title: x.title,
    caption,
    note,
    alt: x.alt,
    creator: x.creator || s.creator,
    copyright: x.rights || s.copyright
  }
}

function treeId(tx: Tx, lib: Library, key: string): number {
  const r = lib.db.prepare('SELECT id FROM trees WHERE key = ?').get(key) as { id: number } | undefined
  if (r) return r.id
  // A mapping to a tree that does not exist yet creates a legacy tree (hidden from pickers, searchable).
  const name = key.charAt(0).toUpperCase() + key.slice(1)
  return createTree(tx, lib, { key, name, multi: true, kind: 'legacy' })
}

/**
 * Seed classifications from embedded keywords and IPTC places, once, on first import.
 * Seeded assignments go into the Internal domain until reviewed (requirements 8.4 and 14).
 */
function seedTrees(tx: Tx, lib: Library, photoId: number, x: ExifData, s: Settings, retainLocation: boolean): void {
  const seeded = { domain: 'internal' as const, provenance: 'embedded' }
  const fallback = treeId(tx, lib, s.unmappedRootsTo || 'subject')
  const subject = treeId(tx, lib, 'subject')
  const covered = new Set<string>()
  // Hierarchical keywords: assign only the deepest paths.
  const paths = x.hierarchical.map((h) => h.split('|').map((p) => p.trim()).filter(Boolean)).filter((p) => p.length)
  const leaves = paths.filter(
    (p) => !paths.some((q) => q.length > p.length && p.every((seg, i) => seg.toLowerCase() === q[i].toLowerCase()))
  )
  for (const p of paths) for (const seg of p) covered.add(seg.toLowerCase())
  for (const p of leaves) {
    const target = s.keywordRoots[p[0]]
    let tid = fallback
    let labels = p
    if (target) {
      if (target === 'location' && !retainLocation) continue
      tid = treeId(tx, lib, target)
      labels = p.slice(1)
    }
    if (!labels.length) continue
    const node = findOrCreatePath(tx, lib, tid, labels)
    if (node) assignNode(tx, lib, [photoId], node, seeded)
  }
  // Flat keywords not part of any path go to Subject › Unsorted.
  for (const k of x.subjects) {
    if (covered.has(k.toLowerCase())) continue
    const node = findOrCreatePath(tx, lib, subject, ['Unsorted', k])
    if (node) assignNode(tx, lib, [photoId], node, seeded)
  }
  if (s.seedLocationFromIptc && retainLocation) {
    const { country, state, city, sublocation } = x.iptc
    const labels = [country, state, city, sublocation].filter(Boolean)
    if (labels.length) {
      const loc = treeId(tx, lib, 'location')
      const node = findOrCreatePath(tx, lib, loc, labels)
      if (node) assignNode(tx, lib, [photoId], node, seeded)
    }
  }
}

// ---------------------------------------------------------------- Filter manifest (filter-manifest/1, requirements 22.6)

export interface ManifestResult {
  batch: string
  matched: number
  unmatched: string[]
}

/** Record which Photos came from which Filter pick batch. One undoable action. */
export function readFilterManifest(lib: Library, text: string): ManifestResult {
  let m: { format?: string; batch?: unknown; date?: string; created?: string; destination?: string; files?: { rawKey?: string; file?: string }[] }
  try {
    m = JSON.parse(text)
  } catch {
    throw new Error('That file is not a readable Filter manifest (it is not valid JSON).')
  }
  if (m.format !== 'filter-manifest/1' || !Array.isArray(m.files)) throw new Error('That file is not a Filter manifest (expected format filter-manifest/1).')
  const b = m.batch as { id?: unknown; name?: string; date?: string; created?: string } | string | number | undefined
  const batchName = typeof b === 'object' && b ? String(b.name ?? b.id ?? '') : String(b ?? '')
  const date = (typeof b === 'object' && b ? b.date ?? b.created : undefined) ?? m.date ?? m.created ?? ''
  const label = `Filter batch ${batchName || '?'}${date ? ` · ${String(date).slice(0, 10)}` : ''}`
  const find = lib.db.prepare('SELECT id FROM photos WHERE raw_key = ? AND retired = 0')
  const unmatched: string[] = []
  const ids: number[] = []
  for (const f of m.files) {
    const key = f.rawKey ?? (f.file ? path.basename(f.file).replace(/\.[^.]+$/, '') : '')
    if (!key) continue
    const rows = find.all(key) as { id: number }[]
    if (!rows.length) unmatched.push(key)
    for (const r of rows) ids.push(r.id)
  }
  lib.action(
    'Read Filter manifest',
    (tx) => {
      for (const id of ids) tx.set('photos', id, 'filter_batch', label)
    },
    { source: 'import', params: { batch: label } }
  )
  return { batch: label, matched: ids.length, unmatched }
}

// ---------------------------------------------------------------- re-read embedded metadata (explicit, chosen fields)

export type RereadField = 'title' | 'caption' | 'note' | 'alt' | 'rating' | 'creator' | 'copyright' | 'position' | 'captured' | 'keywords'

export async function rereadMetadata(lib: Library, ids: number[], fields: RereadField[]): Promise<{ read: number; skipped: number; out: { touchedPhotos: Set<number>; touchedTables: Set<string> } }> {
  const rows = lib.db
    .prepare(`SELECT id, file_path, pos_source, location_state FROM photos WHERE id IN (${ids.join(',') || '0'})`)
    .all() as { id: number; file_path: string; pos_source: string; location_state: string }[]
  const settings = lib.getSettings()
  const read: { row: (typeof rows)[number]; x: ExifData }[] = []
  let skipped = 0
  for (const r of rows) {
    if (!fs.existsSync(r.file_path)) {
      skipped++
      continue
    }
    try {
      read.push({ row: r, x: await readExif(r.file_path) })
    } catch {
      skipped++
    }
  }
  const out = lib.action(
    'Re-read embedded metadata',
    (tx) => {
      for (const { row, x } of read) {
        const s = seedText(x, settings)
        const want = new Set(fields)
        if (want.has('title')) tx.set('photos', row.id, 'title', s.title)
        if (want.has('caption')) tx.set('photos', row.id, 'caption', s.caption)
        if (want.has('note')) tx.set('photos', row.id, 'note', s.note)
        if (want.has('alt')) tx.set('photos', row.id, 'alt', s.alt)
        if (want.has('rating')) tx.set('photos', row.id, 'rating', x.rating)
        if (want.has('creator')) tx.set('photos', row.id, 'creator', s.creator)
        if (want.has('copyright')) tx.set('photos', row.id, 'copyright', s.copyright)
        if (want.has('captured') && x.captured) tx.set('photos', row.id, 'captured', x.captured)
        if (want.has('position') && row.location_state !== 'not_retained') {
          tx.set('photos', row.id, 'cam_lat', x.lat)
          tx.set('photos', row.id, 'cam_lon', x.lon)
          tx.set('photos', row.id, 'cam_ele', x.ele)
          if (row.pos_source === 'camera' || row.pos_source === 'none') {
            tx.set('photos', row.id, 'lat', x.lat)
            tx.set('photos', row.id, 'lon', x.lon)
            tx.set('photos', row.id, 'elevation', x.ele)
            tx.set('photos', row.id, 'pos_source', x.lat !== null ? 'camera' : 'none')
            if (x.lat !== null && (row.location_state === 'missing_gps' || row.location_state === 'unknown')) tx.set('photos', row.id, 'location_state', 'known')
          }
        }
        if (want.has('keywords')) seedTrees(tx, lib, row.id, x, settings, row.location_state !== 'not_retained')
      }
    },
    { bulkCount: read.length, source: 'bulk', params: { fields } }
  )
  return { read: read.length, skipped, out }
}
