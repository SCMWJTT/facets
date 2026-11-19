import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '../src/main/db/library'
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/schema'
import { runImport } from '../src/main/services/importer'
import { endExifTool } from '../src/main/services/exif'
import * as C from '../src/main/services/catalog'
import { freshDir, makeJpeg } from './helpers'

let lib: Library
let photos: string
let libDir: string

const mtimes = (dir: string) =>
  Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]))

/** Everything in the catalogue that an import could change, apart from the file-check time stamps. */
function catalogueState(l: Library): string {
  const tables = ['photos', 'photo_nodes', 'nodes', 'trees', 'sets', 'set_members', 'shoots', 'id_registry']
  const out: Record<string, unknown> = {}
  for (const t of tables) out[t] = l.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()
  return JSON.stringify(out)
}

beforeAll(async () => {
  photos = freshDir('photos')
  libDir = path.join(freshDir('lib'), 'Test.facetslib')
  await makeJpeg(path.join(photos, '20121227-GZ3A6486.jpg'), {
    Title: 'Tyrico at last light',
    Headline: 'The bay empties as the light goes.',
    Description: 'First paragraph.\n\nSecond paragraph.',
    Rating: 4,
    HierarchicalSubject: ['Gallery', 'Gallery|Landscapes', 'Gallery|Landscapes|Coast', 'Stories|Maracas', 'Activity|Recreation|Swimming'],
    Subject: ['Landscapes', 'Coast', 'Maracas', 'Swimming', 'Recreation', 'sunset'],
    GPSLatitude: 10.75412,
    GPSLongitude: -61.43087,
    DateTimeOriginal: '2012:12:27 17:48:00',
    Country: 'Trinidad and Tobago',
    State: 'Trinidad',
    City: 'Maracas'
  })
  for (let i = 0; i < 4; i++) {
    await makeJpeg(path.join(photos, `20121227-GZ3A65${10 + i}.jpg`), {
      Title: `Photo ${i}`,
      DateTimeOriginal: `2012:12:27 1${i}:00:00`,
      HierarchicalSubject: ['Gallery|Living things|Animals|Birds'],
      Subject: ['Birds']
    }, { r: 20 * i, g: 60, b: 80 })
  }
  fs.writeFileSync(path.join(photos, 'notes.txt'), 'not an image')
  lib = Library.create(libDir)
  C.ensureDefaultTrees(lib)
})

afterAll(async () => {
  lib?.close()
  await endExifTool()
})

describe('new library', () => {
  it('has the five Facets and the Location tree with their starter top levels', () => {
    const trees = C.readTrees(lib)
    expect(trees.filter((t) => t.kind === 'facet').map((t) => t.key)).toEqual(['subject', 'activity', 'event', 'people', 'theme'])
    expect(trees.find((t) => t.key === 'location')!.kind).toBe('location')
    const nodes = C.readNodes(lib)
    const subject = trees.find((t) => t.key === 'subject')!
    const tops = nodes.filter((n) => n.treeId === subject.id && n.parentId === null).map((n) => n.label)
    expect(tops).toEqual(['Living things', 'Landscapes', 'Water', 'Sky and weather', 'Built environment', 'Objects', 'Food'])
    expect(nodes.find((n) => n.label === 'Family')!.domain).toBe('private')
    expect(nodes.every((n) => /^(subj|act|evt|ppl|thm|loc)-\d{4}$/.test(n.publicId))).toBe(true)
  })

  it('creates every table of the data model', () => {
    const names = (lib.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all() as { name: string }[]).map((r) => r.name)
    for (const t of ['photos', 'photo_fts', 'photo_rtree', 'shoots', 'series', 'series_members', 'series_featured', 'series_nodes',
      'series_places', 'trees', 'nodes', 'node_closure', 'node_xrefs', 'photo_nodes', 'sets', 'set_members', 'saved_views',
      'palettes', 'palette_buttons', 'sites', 'photo_sites', 'series_sites', 'id_registry', 'series_registry', 'name_history',
      'aliases', 'imports', 'exports', 'operations', 'changes', 'ai_batches', 'ai_proposals', 'progress', 'meta', 'settings'])
      expect(names).toContain(t)
    expect(lib.libraryId).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('import', () => {
  it('imports new photos and seeds fields and Internal classifications from embedded metadata', async () => {
    const before = mtimes(photos)
    const r = await runImport(lib, { folder: photos, recursive: false })
    if ('needsChoice' in r) throw new Error('unexpected choice')
    expect(r.report.added.length).toBe(5)
    expect(r.report.skipped.length).toBe(1)
    expect(r.setId).not.toBeNull()
    const all = C.readPhotos(lib)
    const p = all.find((x) => x.rawKey === '20121227-GZ3A6486')!
    expect(p.title).toBe('Tyrico at last light')
    expect(p.caption).toBe('The bay empties as the light goes.')
    expect(p.note).toContain('Second paragraph')
    expect(p.rating).toBe(4)
    expect(p.lat).toBeCloseTo(10.75412, 4)
    expect(p.lon).toBeCloseTo(-61.43087, 4)
    expect(p.locationState).toBe('known')
    expect(p.captured).toBe('2012-12-27T17:48:00')
    const nodes = C.readNodes(lib)
    const trees = C.readTrees(lib)
    const where = (id: number) => {
      const n = nodes.find((x) => x.id === id)!
      return `${trees.find((t) => t.id === n.treeId)!.key}:${n.label}`
    }
    expect(p.nodes.map(where).sort()).toEqual(['activity:Swimming', 'location:Maracas', 'story:Maracas', 'subject:Coast', 'subject:sunset'].sort())
    // Seeded classifications wait in the Internal domain until reviewed.
    expect(p.internal.length).toBe(p.nodes.length)
    // The IPTC places merged into the starter Location tree.
    const loc = trees.find((t) => t.key === 'location')!
    expect(nodes.filter((n) => n.treeId === loc.id && n.label === 'Trinidad').length).toBe(1)
    // Unknown roots become hidden legacy trees.
    expect(trees.find((t) => t.key === 'story')!.kind).toBe('legacy')
    expect(trees.find((t) => t.key === 'story')!.hidden).toBe(true)
    // Birds landed in the existing Subject › Living things › Animals.
    const bird = all.find((x) => x.rawKey === '20121227-GZ3A6510')!
    expect(bird.nodes.map(where)).toEqual(['subject:Birds'])
    // Image files are never written.
    expect(mtimes(photos)).toEqual(before)
  })

  it('importing the same folder again changes nothing', async () => {
    const snap = catalogueState(lib)
    const sets = C.readSets(lib).length
    const r = await runImport(lib, { folder: photos, recursive: false })
    if ('needsChoice' in r) throw new Error('unexpected choice')
    expect(r.report.known.length).toBe(5)
    expect(r.report.added.length + r.report.changed.length + r.report.variants.length).toBe(0)
    expect(r.setId).toBeNull()
    expect(C.readSets(lib).length).toBe(sets)
    expect(catalogueState(lib)).toBe(snap)
  })

  it('a re-exported file keeps its catalogue fields', async () => {
    const id = C.readPhotos(lib).find((x) => x.rawKey === '20121227-GZ3A6510')!.id
    lib.action('t', (tx) => C.applyEdits(tx, [id], [{ field: 'title', value: 'Kept title' }]))
    await makeJpeg(path.join(photos, '20121227-GZ3A6510.jpg'), { Title: 'New LR title' }, { r: 200, g: 10, b: 10 })
    const r = await runImport(lib, { folder: photos, recursive: false })
    if ('needsChoice' in r) throw new Error('unexpected choice')
    expect(r.report.changed.length).toBe(1)
    const p = C.readPhotos(lib, [id])[0]
    expect(p.title).toBe('Kept title')
    expect(p.thumbVer).toBeLessThanOrEqual(0)
  })

  it('asks before treating two files with one raw key as variants', async () => {
    const dir = freshDir('variants')
    await makeJpeg(path.join(dir, '20130101-AAAA0001.jpg'), { Title: 'A' })
    fs.mkdirSync(path.join(dir, 'sub'))
    await makeJpeg(path.join(dir, 'sub', '20130101-AAAA0001.JPG'), { Title: 'B' })
    const first = await runImport(lib, { folder: dir, recursive: true })
    expect('needsChoice' in first).toBe(true)
    const r = await runImport(lib, { folder: dir, recursive: true, choices: { '20130101-aaaa0001': 'variant' } })
    if ('needsChoice' in r) throw new Error('unexpected choice')
    expect(r.report.added.length + r.report.variants.length).toBe(2)
    const vs = C.readPhotos(lib).filter((p) => p.rawKey.toLowerCase() === '20130101-aaaa0001')
    expect(vs.map((v) => v.variantNo).sort()).toEqual([0, 1])
  })

  it('can import without retaining any location', async () => {
    const dir = freshDir('private')
    await makeJpeg(path.join(dir, '20140202-HOME0001.jpg'), { Title: 'Home', GPSLatitude: 10.6, GPSLongitude: -61.4, Country: 'Trinidad and Tobago', City: 'Home town' })
    const r = await runImport(lib, { folder: dir, recursive: false, retainLocation: false })
    if ('needsChoice' in r) throw new Error('unexpected choice')
    const p = C.readPhotos(lib).find((x) => x.rawKey === '20140202-HOME0001')!
    expect([p.lat, p.lon, p.camLat, p.camLon]).toEqual([null, null, null, null])
    expect(p.locationState).toBe('not_retained')
    expect(C.readNodes(lib).some((n) => n.label === 'Home town')).toBe(false)
  })
})

describe('search indexes', () => {
  it('keeps full-text search and the spatial index in step with edits', () => {
    const p = C.readPhotos(lib).find((x) => x.rawKey === '20121227-GZ3A6486')!
    const hit = (q: string) => (lib.db.prepare('SELECT rowid FROM photo_fts WHERE photo_fts MATCH ?').all(q) as { rowid: number }[]).map((r) => r.rowid)
    expect(hit('tyrico')).toContain(p.id)
    lib.action('t', (tx) => C.applyEdits(tx, [p.id], [{ field: 'title', value: 'Maracas at dusk' }]))
    expect(hit('tyrico')).not.toContain(p.id)
    expect(hit('dusk')).toContain(p.id)
    lib.undo()
    expect(hit('tyrico')).toContain(p.id)
    const inBox = () => (lib.db.prepare('SELECT id FROM photo_rtree WHERE min_lat >= 10.7 AND max_lat <= 10.8 AND min_lon >= -61.5 AND max_lon <= -61.4').all() as { id: number }[]).map((r) => r.id)
    expect(inBox()).toContain(p.id)
    lib.action('m', (tx) => C.setPosition(tx, [p.id], 11.2, -60.7))
    expect(inBox()).not.toContain(p.id)
    lib.undo()
    expect(inBox()).toContain(p.id)
  })
})

describe('editing and operations', () => {
  it('bulk edit is one operation and one undo step, recorded with its targets', () => {
    const all = C.readPhotos(lib)
    const ids = all.map((p) => p.id)
    const titles = Object.fromEntries(all.map((p) => [p.id, p.title]))
    const out = lib.action('Caption', (tx) => C.applyEdits(tx, ids, [{ field: 'caption', value: 'Shared caption' }]), { source: 'bulk' })
    const after = C.readPhotos(lib)
    expect(after.every((p) => p.caption === 'Shared caption')).toBe(true)
    expect(after.every((p) => p.title === titles[p.id])).toBe(true)
    const op = lib.db.prepare('SELECT * FROM operations WHERE id = ?').get(out.opId) as { source: string; targets: string }
    expect(op.source).toBe('bulk')
    expect(JSON.parse(op.targets).sort()).toEqual([...ids].sort())
    lib.undo()
    expect(C.readPhotos(lib).some((p) => p.caption === 'Shared caption')).toBe(false)
    lib.redo()
    expect(C.readPhotos(lib).every((p) => p.caption === 'Shared caption')).toBe(true)
    expect(C.photoHistory(lib, ids[0]).some((h) => h.field === 'caption')).toBe(true)
  })

  it('setting and clearing a position keeps the location state consistent', () => {
    const p = C.readPhotos(lib).find((x) => x.locationState === 'missing_gps')!
    lib.action('p', (tx) => C.setPosition(tx, [p.id], 10.5, -61.3))
    expect(C.readPhotos(lib, [p.id])[0].locationState).toBe('known')
    lib.action('c', (tx) => C.setPosition(tx, [p.id], null, null))
    expect(C.readPhotos(lib, [p.id])[0].locationState).toBe('unknown')
  })
})

describe('trees', () => {
  it('rename, move and merge keep photo entries and their domains', () => {
    const subject = C.readTrees(lib).find((h) => h.key === 'subject')!
    const birds = C.readNodes(lib).find((n) => n.label === 'Birds')!
    const users = C.readPhotos(lib).filter((p) => p.nodes.includes(birds.id)).map((p) => p.id)
    expect(users.length).toBe(4)
    let wildlife = 0
    const out = lib.action('n', (tx) => {
      C.updateNode(tx, birds.id, { label: 'Birds of Trinidad', shortCode: 'brds' })
      wildlife = C.createNode(tx, lib, subject.id, null, 'Wildlife')
      C.moveNode(tx, lib, birds.id, wildlife)
    })
    C.deltaFor(lib, out)
    expect(C.readNodes(lib).find((n) => n.id === birds.id)!.shortCode).toBe('BRDS')
    expect(C.readPhotos(lib).filter((p) => p.nodes.includes(birds.id)).length).toBe(4)
    const closure = lib.db.prepare('SELECT 1 FROM node_closure WHERE ancestor = ? AND descendant = ?').get(wildlife, birds.id)
    expect(closure).toBeTruthy()
    let avian = 0
    lib.action('m', (tx) => {
      avian = C.createNode(tx, lib, subject.id, wildlife, 'Avian')
      C.mergeNodes(tx, lib, birds.id, avian)
    })
    const merged = C.readPhotos(lib).filter((p) => p.nodes.includes(avian))
    expect(merged.length).toBe(4)
    expect(merged.every((p) => p.internal.includes(avian))).toBe(true)
    expect(C.readNodes(lib).find((n) => n.id === avian)!.aliases).toContain('Birds of Trinidad')
    expect(() => lib.action('d', (tx) => C.deleteNode(tx, lib, avian))).toThrow()
    expect(() => lib.action('s', (tx) => C.updateNode(tx, wildlife, { shortCode: 'BRDS' }))).toThrow()
  })

  it('a Private node is never assigned as Public', () => {
    const family = C.readNodes(lib).find((n) => n.label === 'Family')!
    const id = C.readPhotos(lib)[0].id
    lib.action('a', (tx) => C.assignNode(tx, lib, [id], family.id, { domain: 'public' }))
    expect(C.readPhotos(lib, [id])[0].privateNodes).toContain(family.id)
  })
})

describe('shoots and Photo IDs', () => {
  it('never issues a code or ID twice', () => {
    const ids = C.readPhotos(lib).filter((p) => p.rawKey.startsWith('2012')).map((p) => p.id)
    let shootId = 0
    lib.action('s', (tx) => {
      shootId = C.createShoot(tx, lib, 'Maracas Lime', 'MALM', ids)
    })
    expect(C.readShoots(lib).find((s) => s.id === shootId)!.privacy).toBe('private')
    expect(() => lib.action('s2', (tx) => C.createShoot(tx, lib, 'Other', 'MALM', []))).toThrow()
    lib.action('n', (tx) => C.assignNames(tx, lib, ids))
    const named = C.readPhotos(lib, ids).map((p) => p.publicId).sort()
    expect(named[0]).toBe('MALM-00001')
    const first = C.readPhotos(lib, ids).find((p) => p.publicId === 'MALM-00001')!
    expect(first.publishedName).toMatch(/^2012-12-27-maracas-lime-MALM-00001$/)
    // Withdraw then rename: the old number is not reused.
    lib.action('w', (tx) => C.withdrawNames(tx, lib, [first.id]))
    lib.action('n2', (tx) => C.assignNames(tx, lib, [first.id]))
    const again = C.readPhotos(lib, [first.id])[0]
    expect(again.publicId).not.toBe('MALM-00001')
    const reg = C.readRegistry(lib)
    expect(reg.ids.find((r) => r.publicId === 'MALM-00001')!.state).toBe('retired')
    // Undoing the naming never lets a number be issued twice.
    lib.undo()
    lib.action('n3', (tx) => C.assignNames(tx, lib, [first.id]))
    expect(C.readPhotos(lib, [first.id])[0].publicId).not.toBe(again.publicId)
    // Undoing a shoot creation keeps its code reserved.
    lib.action('s3', (tx) => C.createShoot(tx, lib, 'Temp', 'TEMP', []))
    lib.undo()
    expect(C.codeIsFree(lib, 'TEMP')).toBe(false)
  })
})

describe('library safety', () => {
  it('re-opens with all data and keeps backups', () => {
    const n = C.readPhotos(lib).length
    lib.close()
    lib = Library.open(libDir)
    expect(C.readPhotos(lib).length).toBe(n)
    expect(fs.readdirSync(path.join(libDir, 'backups')).length).toBeGreaterThan(0)
  })

  it('refuses a library made by a newer Facets without changing it', () => {
    const dir = path.join(freshDir('newer'), 'Newer.facetslib')
    Library.create(dir).close()
    const db = new Database(path.join(dir, 'library.sqlite'))
    db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION + 1))
    db.close()
    const before = fs.readFileSync(path.join(dir, 'library.sqlite'))
    expect(() => Library.open(dir)).toThrow(/newer version of Facets/)
    expect(fs.readFileSync(path.join(dir, 'library.sqlite')).equals(before)).toBe(true)
  })

  it('refuses to open a Legend library', () => {
    const dir = path.join(freshDir('legendlib'), 'Old.legendlib')
    fs.mkdirSync(dir, { recursive: true })
    expect(() => Library.open(dir)).toThrow(/Legend library/)
    // A Legend library renamed to look like anything else is still recognised, and is left untouched.
    const other = path.join(freshDir('legendlib2'), 'Photos')
    fs.mkdirSync(other, { recursive: true })
    const db = new Database(path.join(other, 'library.sqlite'))
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('schema_version','1'),('legend_format','legend-library/1')")
    db.close()
    const before = fs.readdirSync(other)
    expect(() => Library.open(other)).toThrow(/Legend library/)
    expect(fs.readdirSync(other)).toEqual(before)
  })

  it('released migrations only add (version 1 is the first release)', () => {
    expect(MIGRATIONS.length).toBe(SCHEMA_VERSION)
    for (const m of MIGRATIONS.slice(1)) expect(m).not.toMatch(/\b(DROP|ALTER\s+TABLE\s+\w+\s+(RENAME|DROP))\b/i)
  })
})
