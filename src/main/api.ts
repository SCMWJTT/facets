declare const __BUILD_DATE__: string
// Every request from the interface arrives here. Mutating calls run as one action and return a delta.
import { BrowserWindow, dialog, shell, app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { ActionResult, AppInfo, DuplicateChoice, FieldEdit, LocationState, TNode, Tree, PasteSpec, SeriesPatch, Settings, Shoot } from '@shared/types'
import { Library, type ActionOutcome, type OpOptions, type Tx } from './db/library'
import * as C from './services/catalog'
import { runImport, readFilterManifest, rereadMetadata, type RereadField } from './services/importer'
import * as S from './services/series'
import * as X from './services/taxonomy'
import { ThumbQueue } from './services/thumbs'
import { endExifTool } from './services/exif'

interface Prefs {
  recent: string[]
  bounds?: { x: number; y: number; width: number; height: number; maximized: boolean }
}

const prefsFile = (): string => path.join(app.getPath('userData'), 'prefs.json')
export function loadPrefs(): Prefs {
  try {
    return { recent: [], ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }
  } catch {
    return { recent: [] }
  }
}
export function savePrefs(p: Prefs): void {
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true })
  fs.writeFileSync(prefsFile(), JSON.stringify(p, null, 2))
}

export class Api {
  lib: Library | null = null
  thumbs: ThumbQueue | null = null
  private busy = false

  constructor(private win: () => BrowserWindow | null) {}

  private send(channel: string, payload: unknown): void {
    this.win()?.webContents.send(channel, payload)
  }

  private need(): Library {
    if (!this.lib) throw new Error('No library is open.')
    return this.lib
  }

  /** Run a mutation as one undoable action and build the reply. */
  private act<T>(label: string, fn: (tx: Tx, lib: Library) => T, msg: (v: T, n: number) => string, bulk = 0, opts: OpOptions = {}): ActionResult {
    const lib = this.need()
    const out: ActionOutcome<T> = lib.action(label, (tx) => fn(tx, lib), { bulkCount: bulk, source: bulk > 1 ? 'bulk' : 'manual', ...opts })
    const message = msg(out.value, out.touchedPhotos.size)
    return { ok: true, message, delta: C.deltaFor(lib, out, message), data: out.value }
  }

  // ------------------------------------------------ library

  state() {
    const prefs = loadPrefs()
    return {
      library: this.lib ? this.info() : null,
      recent: prefs.recent.filter((p) => fs.existsSync(path.join(p, 'library.sqlite'))),
      version: app.getVersion()
    }
  }

  private info() {
    const lib = this.need()
    return {
      path: lib.dir,
      name: path.basename(lib.dir).replace(/\.facetslib$/i, ''),
      schemaVersion: lib.schemaVersion,
      photoCount: (lib.db.prepare('SELECT COUNT(*) AS n FROM photos WHERE retired = 0').get() as { n: number }).n
    }
  }

  async createLibrary() {
    const r = await dialog.showSaveDialog(this.win()!, {
      title: 'Create a Facets library',
      defaultPath: path.join(app.getPath('pictures'), 'Photos.facetslib'),
      buttonLabel: 'Create library',
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (r.canceled || !r.filePath) return null
    const dir = /\.facetslib$/i.test(r.filePath) ? r.filePath : r.filePath + '.facetslib'
    this.closeLibrary()
    this.attach(Library.create(dir))
    return this.state()
  }

  async openLibrary(dir?: string) {
    if (!dir) {
      const r = await dialog.showOpenDialog(this.win()!, {
        title: 'Open a Facets library',
        properties: ['openDirectory'],
        buttonLabel: 'Open library'
      })
      if (r.canceled || !r.filePaths[0]) return null
      dir = r.filePaths[0]
    }
    this.closeLibrary()
    this.attach(Library.open(dir))
    return this.state()
  }

  tryOpenLast(): void {
    // FACETS_LIBRARY opens (or creates) a given library; used for testing.
    const forced = process.env.FACETS_LIBRARY
    if (forced) {
      this.attach(fs.existsSync(path.join(forced, 'library.sqlite')) ? Library.open(forced) : Library.create(forced))
      return
    }
    const last = loadPrefs().recent[0]
    if (!last) return
    try {
      this.attach(Library.open(last))
    } catch {
      /* ignore */
    }
  }

  private attach(lib: Library): void {
    this.lib = lib
    C.ensureDefaultTrees(lib)
    C.rebuildClosure(lib)
    const prefs = loadPrefs()
    prefs.recent = [lib.dir, ...prefs.recent.filter((p) => p !== lib.dir)].slice(0, 8)
    savePrefs(prefs)
    this.thumbs = new ThumbQueue(lib, (updates, done, total, paused) => {
      this.send('thumbs', { updates, done, total, paused })
    })
    setTimeout(() => {
      this.thumbs?.enqueueNeeded()
      void this.checkOffline()
    }, 500)
  }

  closeLibrary(): void {
    this.thumbs?.stop()
    this.thumbs = null
    this.lib?.close()
    this.lib = null
  }

  async shutdown(): Promise<void> {
    this.closeLibrary()
    await endExifTool()
  }

  /** Mark photos whose image file is missing (for example an unplugged drive). */
  private async checkOffline(): Promise<void> {
    const lib = this.lib
    if (!lib) return
    const rows = lib.db.prepare('SELECT id, file_path, file_offline FROM photos WHERE retired = 0').all() as {
      id: number
      file_path: string
      file_offline: number
    }[]
    const flips: { id: number; off: number }[] = []
    for (let i = 0; i < rows.length; i += 200) {
      await Promise.all(
        rows.slice(i, i + 200).map(async (r) => {
          const exists = await fs.promises
            .access(r.file_path, fs.constants.R_OK)
            .then(() => true)
            .catch(() => false)
          const off = exists ? 0 : 1
          if (off !== r.file_offline) flips.push({ id: r.id, off })
        })
      )
      if (this.lib !== lib) return
    }
    if (!flips.length) return
    const st = lib.db.prepare('UPDATE photos SET file_offline = ? WHERE id = ?')
    lib.db.transaction(() => flips.forEach((f) => st.run(f.off, f.id)))()
    this.send('delta', { photos: C.readPhotos(lib, flips.map((f) => f.id)), canUndo: lib.undoLabel(), canRedo: lib.redoLabel() })
    if (flips.some((f) => f.off === 0)) this.thumbs?.enqueueNeeded()
  }

  appInfo(): AppInfo {
    const comp = (name: string, licence: string): { name: string; version: string; licence: string } => {
      let version = ''
      try {
        version = (JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`), 'utf8')) as { version: string }).version
      } catch {
        /* not resolvable when packed */
      }
      return { name, version, licence }
    }
    return {
      version: app.getVersion(),
      buildDate: typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '',
      libraryPath: this.lib?.dir ?? null,
      userData: app.getPath('userData'),
      logFolder: this.lib ? path.join(this.lib.dir, 'logs') : null,
      components: [
        { name: 'Electron', version: process.versions.electron ?? '', licence: 'MIT' },
        comp('better-sqlite3', 'MIT'),
        { name: 'SQLite', version: '', licence: 'Public domain' },
        comp('sharp', 'Apache-2.0 (libvips: LGPL-3.0)'),
        comp('exiftool-vendored', 'MIT (ExifTool: Artistic / GPL)'),
        { name: 'React', version: '', licence: 'MIT' },
        { name: 'Leaflet', version: '', licence: 'BSD-2-Clause' },
        { name: 'zustand', version: '', licence: 'MIT' },
        { name: '@tanstack/react-virtual', version: '', licence: 'MIT' }
      ]
    }
  }

  openLogFolder(): void {
    const dir = this.lib ? path.join(this.lib.dir, 'logs') : app.getPath('userData')
    void shell.openPath(dir)
  }

  snapshot() {
    return C.snapshot(this.need())
  }

  revealFile(p: string): void {
    shell.showItemInFolder(p)
  }

  // ------------------------------------------------ import

  async chooseFolder(): Promise<string | null> {
    const r = await dialog.showOpenDialog(this.win()!, { title: 'Choose a folder of exported JPEGs', properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  }

  async runImport(folder: string, recursive: boolean, choices?: Record<string, DuplicateChoice>, retainLocation = true) {
    const lib = this.need()
    if (this.busy) throw new Error('An import is already running.')
    this.busy = true
    try {
      const out = await runImport(lib, {
        folder,
        recursive,
        retainLocation,
        choices,
        onProgress: (done, total, label) => this.send('progress', { task: 'import', done, total, label })
      })
      this.send('progress', { task: 'import', done: 0, total: 0, label: '' })
      if ('needsChoice' in out) return out
      this.thumbs?.add([...out.newIds, ...out.changedIds])
      const delta = C.deltaFor(lib, { touchedPhotos: new Set(out.allIds), touchedTables: new Set(['nodes', 'sets', 'trees']) })
      delta.imports = C.readImports(lib)
      return { ...out, delta }
    } finally {
      this.busy = false
    }
  }

  pauseThumbs(p: boolean): void {
    this.thumbs?.setPaused(p)
  }
  prioritiseThumbs(ids: number[]): void {
    this.thumbs?.prioritise(ids)
  }

  // ------------------------------------------------ editing

  editFields(ids: number[], edits: FieldEdit[], label?: string): ActionResult {
    const name = label ?? `Edit ${edits.map((e) => e.field).join(', ')}`
    return this.act(name, (tx) => C.applyEdits(tx, ids, edits), (n) => `${fieldLabel(edits)} set on ${n} photo${n === 1 ? '' : 's'}`, ids.length)
  }

  setPosition(ids: number[], lat: number | null, lon: number | null): ActionResult {
    return this.act('Set position', (tx) => C.setPosition(tx, ids, lat, lon), (n) => `Position set on ${n} photo${n === 1 ? '' : 's'}`, ids.length)
  }

  resetToCamera(ids: number[]): ActionResult {
    return this.act('Reset to camera position', (tx, lib) => C.resetToCamera(tx, lib, ids), (n) => `Camera position restored on ${n} photos`, ids.length)
  }

  useNodePosition(ids: number[]): ActionResult {
    return this.act('Use location position', (tx, lib) => C.useNodePosition(tx, lib, ids), (n) => `${n} photos placed at their location's position`, ids.length)
  }

  setLocationState(ids: number[], state: LocationState): ActionResult {
    return this.act('Set location state', (tx) => { let n = 0; for (const id of ids) if (tx.set('photos', id, 'location_state', state)) n++; return n }, (n) => `Location state set on ${n} photo${n === 1 ? '' : 's'}`, ids.length)
  }

  paste(sourceId: number, ids: number[], spec: PasteSpec): ActionResult {
    return this.act('Paste fields', (tx, lib) => C.pasteFields(tx, lib, sourceId, ids, spec), (_v, n) => `Fields pasted on ${n} photos`, ids.length)
  }

  // ------------------------------------------------ trees

  assignNode(ids: number[], nodeId: number): ActionResult {
    return this.act('Assign entry', (tx, lib) => C.assignNode(tx, lib, ids, nodeId), (n) => `${this.nodeLabel(nodeId)} added to ${n} photos`, ids.length)
  }
  removeNode(ids: number[], nodeId: number): ActionResult {
    return this.act('Remove entry', (tx, lib) => C.removeNode(tx, lib, ids, nodeId), (n) => `${this.nodeLabel(nodeId)} removed from ${n} photos`, ids.length)
  }
  replaceEntries(ids: number[], treeId: number, nodeIds: number[]): ActionResult {
    return this.act(
      'Replace entries',
      (tx, lib) => {
        C.clearTree(tx, lib, ids, treeId)
        for (const n of nodeIds) C.assignNode(tx, lib, ids, n)
      },
      (_v, n) => `Entries replaced on ${n} photos`,
      ids.length
    )
  }
  createNode(treeId: number, parentId: number | null, label: string, assignTo: number[] = []): ActionResult {
    return this.act(
      'New node',
      (tx, lib) => {
        const id = C.createNode(tx, lib, treeId, parentId, label)
        if (assignTo.length) C.assignNode(tx, lib, assignTo, id)
        return id
      },
      () => `Created "${label}"${assignTo.length ? ` and added it to ${assignTo.length} photos` : ''}`
    )
  }
  createPath(treeId: number, labels: string[], assignTo: number[] = []): ActionResult {
    return this.act(
      'New entry',
      (tx, lib) => {
        const id = C.findOrCreatePath(tx, lib, treeId, labels)
        if (id && assignTo.length) C.assignNode(tx, lib, assignTo, id)
        return id
      },
      () => `"${labels.join(' › ')}" ${assignTo.length ? `added to ${assignTo.length} photos` : 'created'}`,
      assignTo.length
    )
  }
  updateNode(id: number, patch: Partial<TNode>): ActionResult {
    return this.act('Edit node', (tx) => C.updateNode(tx, id, patch), () => 'Node updated')
  }
  moveNode(id: number, parentId: number | null, beforeId: number | null): ActionResult {
    return this.act('Move node', (tx, lib) => C.moveNode(tx, lib, id, parentId, beforeId), () => `Moved ${this.nodeLabel(id)}`)
  }
  mergeNodes(fromId: number, intoId: number): ActionResult {
    const a = this.nodeLabel(fromId)
    return this.act('Merge nodes', (tx, lib) => C.mergeNodes(tx, lib, fromId, intoId), (n) => `Merged ${a} into ${this.nodeLabel(intoId)}; ${n} photos moved`)
  }
  deleteNode(id: number): ActionResult {
    const a = this.nodeLabel(id)
    return this.act('Delete node', (tx, lib) => C.deleteNode(tx, lib, id), () => `Deleted ${a}`)
  }
  nodeInUse(id: number): boolean {
    return C.nodeHasUse(this.need(), id)
  }
  createTree(h: C.TreeSpec): ActionResult {
    // Everyday tree creation makes custom (legacy-kind) trees; a sixth Facet is a guarded action in a later stage.
    return this.act('New tree', (tx, lib) => C.createTree(tx, lib, { ...h, kind: 'legacy', hidden: false }), () => `Tree ${h.name} created`)
  }
  updateTree(id: number, patch: Partial<Tree>): ActionResult {
    return this.act('Edit tree', (tx) => C.updateTree(tx, id, patch), () => 'Tree updated')
  }
  async exportOutline(id: number): Promise<string | null> {
    const lib = this.need()
    const h = C.readTrees(lib).find((x) => x.id === id)!
    const r = await dialog.showSaveDialog(this.win()!, { defaultPath: `${h.key}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, C.exportOutline(lib, id), 'utf8')
    return r.filePath
  }
  async importOutline(id: number): Promise<ActionResult | null> {
    const r = await dialog.showOpenDialog(this.win()!, { properties: ['openFile'], filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const text = fs.readFileSync(r.filePaths[0], 'utf8').replace(/^﻿/, '')
    return this.act('Import outline', (tx, lib) => C.importOutline(tx, lib, id, text), (n) => `${n} nodes created from the outline`)
  }
  private nodeLabel(id: number): string {
    const r = this.need().db.prepare('SELECT label FROM nodes WHERE id = ?').get(id) as { label: string } | undefined
    return r ? `"${r.label}"` : 'Node'
  }

  // ------------------------------------------------ shoots and Photo IDs

  proposeCode(name: string): string {
    return C.proposeCode(this.need(), name)
  }
  codeFree(code: string): boolean {
    return C.codeIsFree(this.need(), code.toUpperCase())
  }
  createShoot(name: string, code: string, ids: number[]): ActionResult {
    return this.act('New shoot', (tx, lib) => C.createShoot(tx, lib, name, code, ids), () => `Shoot ${code.toUpperCase()} created${ids.length ? ` with ${ids.length} photos` : ''}`, ids.length)
  }
  updateShoot(id: number, patch: Partial<Shoot>): ActionResult {
    return this.act('Edit shoot', (tx, lib) => C.updateShoot(tx, lib, id, patch), () => 'Shoot updated')
  }
  setShoot(ids: number[], shootId: number | null): ActionResult {
    return this.act('Set shoot', (tx, lib) => C.setShoot(tx, lib, ids, shootId), (r) =>
      `${r.moved} photos moved${r.refused ? `; ${r.refused} named photos kept their shoot (withdraw their IDs first)` : ''}`, ids.length)
  }
  assignNames(ids: number[]): ActionResult {
    return this.act('Assign Photo IDs', (tx, lib) => C.assignNames(tx, lib, ids), (r) =>
      `${r.named} Photo IDs issued${r.skipped ? `; ${r.skipped} photos already had one` : ''}`, ids.length)
  }
  withdrawNames(ids: number[]): ActionResult {
    return this.act('Withdraw Photo IDs', (tx, lib) => C.withdrawNames(tx, lib, ids), (r) =>
      `${r.withdrawn} IDs withdrawn and retired${r.refused ? `; ${r.refused} already published and kept` : ''}`)
  }
  registry() {
    return C.readRegistry(this.need())
  }

  // ------------------------------------------------ sets

  createSet(name: string, ids: number[]): ActionResult {
    return this.act('New set', (tx) => C.createSet(tx, name, ids), () => `Set "${name}" created with ${ids.length} photos`)
  }
  addToSet(setId: number, ids: number[]): ActionResult {
    return this.act('Add to set', (tx, lib) => C.addToSet(tx, lib, setId, ids), (n) => `${n} photos added to the set`)
  }
  removeFromSet(setId: number, ids: number[]): ActionResult {
    return this.act('Remove from set', (tx, lib) => C.removeFromSet(tx, lib, setId, ids), (n) => `${n} photos removed from the set`)
  }
  renameSet(setId: number, name: string): ActionResult {
    return this.act('Rename set', (tx) => tx.set('sets', setId, 'name', name), () => 'Set renamed')
  }
  deleteSet(setId: number): ActionResult {
    return this.act('Remove set', (tx) => tx.set('sets', setId, 'retired', 1), () => 'Set removed (photos are not affected)')
  }
  duplicateSet(setId: number, name: string): ActionResult {
    return this.act('Duplicate set', (tx, lib) => C.duplicateSet(tx, lib, setId, name), () => `Set "${name}" created`)
  }
  replaceSet(setId: number, ids: number[]): ActionResult {
    return this.act('Replace set contents', (tx, lib) => C.replaceSet(tx, lib, setId, ids), (n) => `The set now holds ${n} photos`, ids.length)
  }
  archiveSet(setId: number, archived: boolean): ActionResult {
    return this.act(archived ? 'Archive set' : 'Restore set', (tx) => C.archiveSet(tx, setId, archived), () => (archived ? 'Set archived' : 'Set restored'))
  }
  saveSetState(setId: number, state: Record<string, unknown>): void {
    C.saveSetState(this.need(), setId, state)
  }

  // ------------------------------------------------ shoots: proposals

  proposeShoots(ids: number[], gapHours: number, jumpKm: number) {
    return C.proposeShoots(this.need(), ids, gapHours, jumpKm)
  }
  createShoots(list: { name: string; code: string; ids: number[] }[]): ActionResult {
    return this.act(
      `Create ${list.length} proposed Shoot${list.length === 1 ? '' : 's'}`,
      (tx, lib) => {
        for (const x of list) {
          const id = C.createShoot(tx, lib, x.name, x.code, [])
          C.setShoot(tx, lib, x.ids, id)
          lib.db.prepare("UPDATE photos SET shoot_provenance = 'heuristic' WHERE id IN (" + x.ids.join(',') + ')').run()
        }
        return list.length
      },
      (n) => `${n} Shoot${n === 1 ? '' : 's'} created`,
      list.reduce((a, x) => a + x.ids.length, 0)
    )
  }
  shootSpan(id: number) {
    return C.shootSpan(this.need(), id)
  }

  // ------------------------------------------------ tree files, cross-references, tidy-up

  async exportTaxonomy(treeId: number | null): Promise<string | null> {
    const lib = this.need()
    const doc = treeId === null ? X.exportAllTaxonomies(lib) : X.exportTaxonomy(lib, treeId)
    const name = treeId === null ? `facets-trees-${new Date().toISOString().slice(0, 10)}.json` : `${(doc as X.TaxTree).tree.key}.facets-tree.json`
    const r = await dialog.showSaveDialog(this.win()!, { defaultPath: name, filters: [{ name: 'Facets tree file', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, JSON.stringify(doc, null, 2), 'utf8')
    return r.filePath
  }
  /** Step 1: choose a file and see what it would do. Nothing changes. */
  async previewTaxonomyFile(): Promise<{ file: string; preview: ReturnType<typeof X.previewTaxonomyImport> } | null> {
    const r = await dialog.showOpenDialog(this.win()!, { properties: ['openFile'], filters: [{ name: 'Facets tree file', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const file = r.filePaths[0]
    const trees = X.parseTaxonomy(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return { file, preview: X.previewTaxonomyImport(this.need(), trees) }
  }
  /** Step 2: apply the previewed file as one undoable action. */
  applyTaxonomyFile(file: string): ActionResult {
    const trees = X.parseTaxonomy(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    const res = this.act('Import tree file', (tx, lib) => X.applyTaxonomyImport(tx, lib, trees), (p) => {
      const n = p.trees.reduce((a, t) => a + t.newNodes, 0)
      return `${n} new entr${n === 1 ? 'y' : 'ies'} added; ${p.trees.reduce((a, t) => a + t.matched, 0)} matched existing ones`
    })
    if (res.delta) {
      C.rebuildClosure(this.need())
      res.delta.nodes = C.readNodes(this.need())
      res.delta.trees = C.readTrees(this.need())
    }
    return res
  }
  addXref(a: number, b: number): ActionResult {
    return this.act('Add cross-reference', (tx, lib) => X.addXref(tx, lib, a, b), () => 'Cross-reference added')
  }
  removeXref(a: number, b: number): ActionResult {
    return this.act('Remove cross-reference', (tx, lib) => X.removeXref(tx, lib, a, b), () => 'Cross-reference removed')
  }
  tidyReport(treeId: number) {
    return X.tidyReport(this.need(), treeId)
  }
  /** A sixth Facet: a guarded action the interface only offers after a warning. */
  createFacet(h: C.TreeSpec): ActionResult {
    return this.act('New Facet', (tx, lib) => C.createTree(tx, lib, { ...h, kind: 'facet', hidden: false, multi: true }), () => `Facet ${h.name} created`)
  }

  // ------------------------------------------------ Filter manifest and re-reading metadata

  async readFilterManifest(): Promise<ActionResult | null> {
    const lib = this.need()
    const r = await dialog.showOpenDialog(this.win()!, { properties: ['openFile'], filters: [{ name: 'Filter manifest', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const res = readFilterManifest(lib, fs.readFileSync(r.filePaths[0], 'utf8').replace(/^\uFEFF/, ''))
    const message = `${res.batch}: ${res.matched} photos matched${res.unmatched.length ? `; ${res.unmatched.length} files in the manifest are not in this library` : ''}`
    const ids = (lib.db.prepare('SELECT id FROM photos WHERE filter_batch = ?').all(res.batch) as { id: number }[]).map((x) => x.id)
    return { ok: true, message, data: res, delta: C.deltaFor(lib, { touchedPhotos: new Set(ids), touchedTables: new Set() }, message) }
  }
  async rereadMetadata(ids: number[], fields: RereadField[]): Promise<ActionResult> {
    const lib = this.need()
    const r = await rereadMetadata(lib, ids, fields)
    const message = `Re-read ${r.read} photo${r.read === 1 ? '' : 's'}${r.skipped ? `; ${r.skipped} skipped (file offline or unreadable)` : ''}`
    r.out.touchedTables.add('nodes')
    return { ok: true, message, delta: C.deltaFor(lib, r.out, message) }
  }

  // ------------------------------------------------ Series

  createSeries(s: S.NewSeries): ActionResult {
    return this.act('New Series', (tx, lib) => S.createSeries(tx, lib, s), () => `Series "${s.title}" created`, s.photoIds.length)
  }
  seriesOverlap(q: { photoIds: number[]; primaryNodeId: number | null; title: string; excludeId?: number | null }) {
    return S.overlapWarnings(this.need(), q)
  }
  updateSeries(id: number, patch: SeriesPatch): ActionResult {
    return this.act('Edit Series', (tx, lib) => S.updateSeries(tx, lib, id, patch), () => 'Series updated')
  }
  addToSeries(id: number, ids: number[]): ActionResult {
    return this.act('Add to Series', (tx, lib) => S.addMembers(tx, lib, id, ids), (n) => `${n} photo${n === 1 ? '' : 's'} added to the Series`, ids.length)
  }
  removeFromSeries(id: number, ids: number[]): ActionResult {
    return this.act('Remove from Series', (tx, lib) => S.removeMembers(tx, lib, id, ids), (n) => `${n} photo${n === 1 ? '' : 's'} removed from the Series`, ids.length)
  }
  reorderSeries(id: number, ordered: number[]): ActionResult {
    return this.act('Reorder Series', (tx, lib) => S.reorderMembers(tx, lib, id, ordered), () => 'Series order changed')
  }
  setSeriesFeatured(id: number, photoId: number, on: boolean): ActionResult {
    return this.act(on ? 'Feature photo' : 'Unfeature photo', (tx, lib) => S.setFeatured(tx, lib, id, photoId, on), () => (on ? 'Added to featured' : 'Removed from featured'))
  }
  setSeriesSupporting(id: number, nodeId: number, on: boolean): ActionResult {
    return this.act(on ? 'Add supporting keyword' : 'Remove supporting keyword', (tx, lib) => S.setSupporting(tx, lib, id, nodeId, on), () => 'Series keywords updated')
  }
  setSeriesPlace(id: number, nodeId: number, on: boolean): ActionResult {
    return this.act(on ? 'Add Series place' : 'Remove Series place', (tx, lib) => S.setPlace(tx, lib, id, nodeId, on), () => 'Series places updated')
  }
  retireSeries(id: number): ActionResult {
    return this.act('Retire Series', (tx) => S.retireSeries(tx, id), () => 'Series retired (its ID is never reused)')
  }
  applySeriesKeywords(id: number, nodeIds: number[]): ActionResult {
    const n = (this.need().db.prepare('SELECT COUNT(*) AS n FROM series_members WHERE series_id = ?').get(id) as { n: number }).n
    return this.act('Apply Series keywords to members', (tx, lib) => S.applySeriesKeywords(tx, lib, id, nodeIds), (k) => `${k} keyword assignment${k === 1 ? '' : 's'} added to member photos`, n, { source: 'bulk' })
  }
  seriesHistory(id: number) {
    return S.seriesHistory(this.need(), id)
  }
  seriesRegistry() {
    return S.readSeriesRegistry(this.need())
  }

  // ------------------------------------------------ history, undo, settings, backup

  history(photoId: number) {
    return C.photoHistory(this.need(), photoId)
  }

  undo(): ActionResult {
    const lib = this.need()
    const out = lib.undo()
    if (!out) return { ok: false, message: 'Nothing to undo' }
    C.reconcileRegistry(lib)
    out.touchedTables.add('nodes')
    out.touchedTables.add('shoots')
    out.touchedTables.add('series')
    out.touchedTables.add('sets')
    const message = `Undone: ${out.value}`
    return { ok: true, message, delta: C.deltaFor(lib, out, message) }
  }

  redo(): ActionResult {
    const lib = this.need()
    const out = lib.redo()
    if (!out) return { ok: false, message: 'Nothing to redo' }
    C.reconcileRegistry(lib)
    out.touchedTables.add('nodes')
    out.touchedTables.add('shoots')
    out.touchedTables.add('series')
    out.touchedTables.add('sets')
    const message = `Redone: ${out.value}`
    return { ok: true, message, delta: C.deltaFor(lib, out, message) }
  }

  saveSettings(patch: Partial<Settings>): ActionResult {
    const lib = this.need()
    const settings = lib.saveSettings(patch)
    if ('nameTemplate' in patch) {
      const ids = (lib.db.prepare('SELECT id FROM photos WHERE public_id IS NOT NULL AND exported_at IS NULL').all() as { id: number }[]).map((r) => r.id)
      if (ids.length) {
        const out = lib.action('Apply name template', (tx) => C.refreshPublishedNames(tx, lib, { ids }), { undoable: false })
        const d = C.deltaFor(lib, out, 'Settings saved')
        return { ok: true, message: 'Settings saved', delta: { ...d, settings } }
      }
    }
    return { ok: true, message: 'Settings saved', delta: { settings, canUndo: lib.undoLabel(), canRedo: lib.redoLabel() } }
  }

  async exportBackup(): Promise<string | null> {
    const lib = this.need()
    const r = await dialog.showSaveDialog(this.win()!, {
      defaultPath: `facets-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    const tables = (lib.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('node_closure') AND name NOT LIKE '%fts%' AND name NOT LIKE 'photo_rtree%' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name)
    const out: Record<string, unknown> = { format: 'facets-backup/1', libraryId: lib.libraryId, schemaVersion: lib.schemaVersion, exportedAt: new Date().toISOString(), tables: {} }
    for (const t of tables) (out.tables as Record<string, unknown>)[t] = lib.db.prepare(`SELECT * FROM ${t}`).all()
    fs.writeFileSync(r.filePath, JSON.stringify(out))
    return r.filePath
  }
}

function fieldLabel(edits: FieldEdit[]): string {
  const names: Record<string, string> = { alt: 'Alt text', locationState: 'Location state', privatePlace: 'Private place', showElevation: 'Show elevation' }
  const list = edits.map((e) => names[e.field] ?? e.field.charAt(0).toUpperCase() + e.field.slice(1))
  return list.join(', ')
}
