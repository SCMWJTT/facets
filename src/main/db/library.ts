import Database from 'better-sqlite3'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'
import type { Settings } from '@shared/types'

export const DEFAULT_SETTINGS: Settings = {
  creator: '',
  copyright: '',
  licence: 'All rights reserved',
  credit: '',
  rawKeyPattern: '',
  keywordRoots: {
    Subject: 'subject',
    Activity: 'activity',
    Event: 'event',
    People: 'people',
    Theme: 'theme',
    Location: 'location',
    Gallery: 'subject',
    Stories: 'story',
    Fieldcraft: 'technique'
  },
  unmappedRootsTo: 'subject',
  seedLocationFromIptc: true,
  nameTemplate: '{date:YYYY-MM-DD}-{shoot}-{code}-{number}',
  defaultTimeZone: '-04:00',
  suggestDistanceM: 2000,
  tiles: {
    street: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors'
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Imagery © Esri'
    }
  },
  mapCenter: { lat: 10.5, lon: -61.3, zoom: 9 }
}

export const nowIso = (): string => new Date().toISOString()

const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v))
const unjson = (s: string | null): unknown => (s === null ? null : JSON.parse(s))

/** Tables whose rows carry a photo_id column (used to find which photo a change concerns). */
const PHOTO_LINK_TABLES = new Set(['photo_nodes', 'set_members', 'photo_sites', 'series_members', 'series_featured', 'progress'])

export class LockedError extends Error {}

/**
 * Records every change made inside one user operation so it can be undone and shown in history.
 * All writes to catalogue data go through this class.
 */
export class Tx {
  touchedPhotos = new Set<number>()
  touchedTables = new Set<string>()
  private stmts = new Map<string, Database.Statement>()
  private insChange: Database.Statement

  constructor(
    public readonly lib: Library,
    public opId: number
  ) {
    this.insChange = lib.db.prepare(
      'INSERT INTO changes (op_id, op, tbl, row_id, photo_id, field, old_value, new_value) VALUES (?,?,?,?,?,?,?,?)'
    )
  }

  private stmt(sql: string): Database.Statement {
    let s = this.stmts.get(sql)
    if (!s) {
      s = this.lib.db.prepare(sql)
      this.stmts.set(sql, s)
    }
    return s
  }

  private note(tbl: string, photoId: number | null): void {
    this.touchedTables.add(tbl)
    if (photoId !== null && photoId !== undefined) this.touchedPhotos.add(photoId)
  }

  /** Set one field on one row. Returns true if the value changed. */
  set(tbl: string, id: number, field: string, value: unknown): boolean {
    const row = this.stmt(`SELECT ${field} AS v FROM ${tbl} WHERE id = ?`).get(id) as { v: unknown } | undefined
    if (!row) return false
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : value === undefined ? null : value
    if (row.v === v) return false
    this.stmt(`UPDATE ${tbl} SET ${field} = ? WHERE id = ?`).run(v, id)
    const photoId = tbl === 'photos' ? id : null
    this.insChange.run(this.opId, 'set', tbl, id, photoId, field, json(row.v), json(v))
    this.note(tbl, photoId)
    return true
  }

  /** Insert a row; returns its id. */
  insert(tbl: string, row: Record<string, unknown>): number {
    const cols = Object.keys(row)
    const vals = cols.map((c) => {
      const v = row[c]
      return typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v
    })
    const info = this.stmt(`INSERT INTO ${tbl} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(
      ...vals
    )
    const id = Number(info.lastInsertRowid)
    const full = this.stmt(`SELECT * FROM ${tbl} WHERE id = ?`).get(id) as Record<string, unknown>
    const photoId = tbl === 'photos' ? id : PHOTO_LINK_TABLES.has(tbl) ? (full.photo_id as number) : null
    this.insChange.run(this.opId, 'insert', tbl, id, photoId, null, null, json(full))
    this.note(tbl, photoId)
    return id
  }

  /** Delete a row (only used for link rows and never-used records). */
  delete(tbl: string, id: number): boolean {
    const full = this.stmt(`SELECT * FROM ${tbl} WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    if (!full) return false
    this.stmt(`DELETE FROM ${tbl} WHERE id = ?`).run(id)
    const photoId = tbl === 'photos' ? id : PHOTO_LINK_TABLES.has(tbl) ? (full.photo_id as number) : null
    this.insChange.run(this.opId, 'delete', tbl, id, photoId, null, json(full), null)
    this.note(tbl, photoId)
    return true
  }
}

export interface ActionOutcome<T> {
  value: T
  touchedPhotos: Set<number>
  touchedTables: Set<string>
  opId: number | null
}

/** Describes an operation for the persistent Operation History. */
export interface OpOptions {
  bulkCount?: number
  undoable?: boolean
  source?: 'manual' | 'palette' | 'bulk' | 'ai_patch' | 'migration' | 'import' | 'publish' | 'system'
  scope?: string
  params?: Record<string, unknown>
}

export class Library {
  db: Database.Database
  readonly dir: string
  private undoStack: number[] = []
  private redoStack: number[] = []
  private lockPath: string

  private constructor(dir: string, db: Database.Database) {
    this.dir = dir
    this.db = db
    this.lockPath = path.join(dir, 'library.lock')
  }

  get dbPath(): string {
    return path.join(this.dir, 'library.sqlite')
  }

  static create(dir: string): Library {
    if (fs.existsSync(path.join(dir, 'library.sqlite'))) throw new Error('A library already exists in that folder.')
    fs.mkdirSync(dir, { recursive: true })
    return Library.open(dir, true)
  }

  static open(dir: string, creating = false): Library {
    const file = path.join(dir, 'library.sqlite')
    // Facets never writes to a Legend library: refuse before touching anything in the folder.
    if (/\.legendlib$/i.test(dir) || (fs.existsSync(file) && Library.isLegend(file)))
      throw new Error('That folder is a Legend library. Facets never opens or changes Legend libraries; File › Import Legend Library (a later stage) will read one safely.')
    if (!creating && !fs.existsSync(file)) throw new Error('No Facets library found in that folder.')
    for (const sub of ['thumbs', 'backups', 'logs', 'exports']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
    Library.takeLock(dir)
    const db = new Database(file)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = OFF')
    db.pragma('cache_size = -64000')
    const lib = new Library(dir, db)
    try {
      lib.migrate()
      if (!creating) lib.dailyBackup()
    } catch (e) {
      lib.close()
      throw e
    }
    return lib
  }

  /** True when the database file belongs to Legend (read-only check). */
  static isLegend(file: string): boolean {
    let db: Database.Database | null = null
    try {
      db = new Database(file, { readonly: true, fileMustExist: true })
      const r = db.prepare("SELECT value FROM meta WHERE key = 'legend_format'").get()
      return !!r
    } catch {
      return false
    } finally {
      db?.close()
    }
  }

  private static takeLock(dir: string): void {
    const lockPath = path.join(dir, 'library.lock')
    if (fs.existsSync(lockPath)) {
      try {
        const info = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid: number; host: string }
        if (info.host === os.hostname() && info.pid !== process.pid && Library.alive(info.pid)) {
          throw new LockedError('This library is already open in another Facets window.')
        }
      } catch (e) {
        if (e instanceof LockedError) throw e
      }
    }
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, host: os.hostname(), at: nowIso() }))
  }

  private static alive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  close(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* ignore */
    }
    this.db.close()
    try {
      fs.unlinkSync(this.lockPath)
    } catch {
      /* ignore */
    }
  }

  get schemaVersion(): number {
    const hasMeta = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get()
    if (!hasMeta) return 0
    const r = this.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined
    return r ? Number(r.value) : 0
  }

  private migrate(): void {
    const current = this.schemaVersion
    if (current > SCHEMA_VERSION) {
      throw new Error(
        `This library was made by a newer version of Facets (format ${current}). Please update Facets to open it. The library has not been changed.`
      )
    }
    if (current === SCHEMA_VERSION) return
    if (current > 0) this.backup(`before-upgrade-v${current}-to-v${SCHEMA_VERSION}`)
    const run = this.db.transaction(() => {
      for (let v = current; v < SCHEMA_VERSION; v++) this.db.exec(MIGRATIONS[v])
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION))
      if (current === 0) {
        this.db.prepare("INSERT INTO meta (key, value) VALUES ('created_at', ?)").run(nowIso())
        this.db.prepare("INSERT INTO meta (key, value) VALUES ('format', 'facets-library/1')").run()
        this.db.prepare("INSERT INTO meta (key, value) VALUES ('library_id', ?)").run(crypto.randomUUID())
        this.db.prepare("INSERT INTO meta (key, value) VALUES ('next_series', '1')").run()
      }
    })
    run()
    this.log(`Library format upgraded from ${current} to ${SCHEMA_VERSION}`)
  }

  // ---------- backups ----------

  backup(reason: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = path.join(this.dir, 'backups', `library-${stamp}-${reason}.sqlite`)
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
    this.pruneBackups(30)
    return file
  }

  private dailyBackup(): void {
    const dir = path.join(this.dir, 'backups')
    const today = new Date().toISOString().slice(0, 10)
    const exists = fs.readdirSync(dir).some((f) => f.startsWith(`library-${today}`))
    if (!exists) this.backup('daily')
  }

  private pruneBackups(keep: number): void {
    const dir = path.join(this.dir, 'backups')
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('library-') && f.endsWith('.sqlite'))
      .sort()
    while (files.length > keep) {
      const f = files.shift()!
      try {
        fs.unlinkSync(path.join(dir, f))
      } catch {
        /* ignore */
      }
    }
  }

  log(line: string): void {
    const file = path.join(this.dir, 'logs', `facets-${new Date().toISOString().slice(0, 7)}.log`)
    fs.appendFileSync(file, `${nowIso()}  ${line}\n`)
  }

  // ---------- settings ----------

  getSettings(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const s: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>
    for (const r of rows) s[r.key] = JSON.parse(r.value)
    return s as unknown as Settings
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const up = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) up.run(k, JSON.stringify(v))
    })()
    return this.getSettings()
  }

  // ---------- operations, undo and redo ----------

  get libraryId(): string {
    const r = this.db.prepare("SELECT value FROM meta WHERE key='library_id'").get() as { value: string } | undefined
    return r?.value ?? ''
  }

  /**
   * Run one user action as a single transaction and a single undo step, recorded as one
   * persistent operation. bulkCount: number of photos the action touches; over 500 takes a backup first.
   */
  action<T>(label: string, fn: (tx: Tx) => T, opts: OpOptions = {}): ActionOutcome<T> {
    if ((opts.bulkCount ?? 0) > 500) this.backup('before-bulk')
    const undoable = opts.undoable !== false
    let tx!: Tx
    const run = this.db.transaction(() => {
      const info = this.db
        .prepare('INSERT INTO operations (at, label, source, scope, params) VALUES (?, ?, ?, ?, ?)')
        .run(nowIso(), label, opts.source ?? 'manual', opts.scope ?? '', JSON.stringify(opts.params ?? {}))
      tx = new Tx(this, Number(info.lastInsertRowid))
      const value = fn(tx)
      const changed = (this.db.prepare('SELECT COUNT(*) AS n FROM changes WHERE op_id = ?').get(tx.opId) as {
        n: number
      }).n
      if (changed === 0) {
        this.db.prepare('DELETE FROM operations WHERE id = ?').run(tx.opId)
      } else {
        this.touchModified(tx.touchedPhotos)
        this.db
          .prepare('UPDATE operations SET targets = ?, result = ? WHERE id = ?')
          .run(
            JSON.stringify([...tx.touchedPhotos]),
            JSON.stringify({ changes: changed, photos: tx.touchedPhotos.size, tables: [...tx.touchedTables] }),
            tx.opId
          )
      }
      return { value, changed }
    })
    const { value, changed } = run()
    if (changed > 0 && undoable) {
      this.undoStack.push(tx.opId)
      if (this.undoStack.length > 500) this.undoStack.shift()
      this.redoStack = []
    }
    return {
      value,
      touchedPhotos: tx.touchedPhotos,
      touchedTables: tx.touchedTables,
      opId: changed > 0 ? tx.opId : null
    }
  }

  private touchModified(ids: Set<number>): void {
    if (ids.size === 0) return
    const st = this.db.prepare('UPDATE photos SET modified_at = ? WHERE id = ?')
    const t = nowIso()
    for (const id of ids) st.run(t, id)
  }

  undoLabel(): string | null {
    const id = this.undoStack[this.undoStack.length - 1]
    return id ? this.opLabel(id) : null
  }
  redoLabel(): string | null {
    const id = this.redoStack[this.redoStack.length - 1]
    return id ? this.opLabel(id) : null
  }
  private opLabel(id: number): string | null {
    const r = this.db.prepare('SELECT label FROM operations WHERE id = ?').get(id) as { label: string } | undefined
    return r?.label ?? null
  }

  clearUndo(): void {
    this.undoStack = []
    this.redoStack = []
  }

  undo(): ActionOutcome<string> | null {
    const id = this.undoStack.pop()
    if (!id) return null
    const out = this.replay(id, true)
    this.redoStack.push(id)
    return out
  }

  redo(): ActionOutcome<string> | null {
    const id = this.redoStack.pop()
    if (!id) return null
    const out = this.replay(id, false)
    this.undoStack.push(id)
    return out
  }

  private replay(opId: number, backwards: boolean): ActionOutcome<string> {
    const changes = this.db
      .prepare('SELECT * FROM changes WHERE op_id = ? ORDER BY id ' + (backwards ? 'DESC' : 'ASC'))
      .all(opId) as {
      op: string
      tbl: string
      row_id: number
      photo_id: number | null
      field: string | null
      old_value: string | null
      new_value: string | null
    }[]
    const touchedPhotos = new Set<number>()
    const touchedTables = new Set<string>()
    const insertRow = (tbl: string, row: Record<string, unknown>): void => {
      const cols = Object.keys(row)
      this.db
        .prepare(`INSERT OR REPLACE INTO ${tbl} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...cols.map((c) => row[c]))
    }
    this.db.transaction(() => {
      for (const c of changes) {
        touchedTables.add(c.tbl)
        if (c.photo_id !== null) touchedPhotos.add(c.photo_id)
        if (c.op === 'set') {
          const v = unjson(backwards ? c.old_value : c.new_value)
          this.db.prepare(`UPDATE ${c.tbl} SET ${c.field} = ? WHERE id = ?`).run(v as never, c.row_id)
        } else if ((c.op === 'insert') === backwards) {
          this.db.prepare(`DELETE FROM ${c.tbl} WHERE id = ?`).run(c.row_id)
        } else {
          insertRow(c.tbl, unjson(c.op === 'insert' ? c.new_value : c.old_value) as Record<string, unknown>)
        }
      }
      this.db.prepare('UPDATE operations SET undone = ? WHERE id = ?').run(backwards ? 1 : 0, opId)
      this.touchModified(touchedPhotos)
    })()
    const label = this.opLabel(opId) ?? ''
    return { value: label, touchedPhotos, touchedTables, opId }
  }
}
