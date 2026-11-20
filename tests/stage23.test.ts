// Stage 2 (Sets, Shoots, Facets) and stage 3 (Series) acceptance tests.
import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '../src/main/db/library'
import * as C from '../src/main/services/catalog'
import * as S from '../src/main/services/series'
import * as X from '../src/main/services/taxonomy'
import { readFilterManifest, rereadMetadata, runImport } from '../src/main/services/importer'
import { endExifTool } from '../src/main/services/exif'
import { freshDir, makeJpeg } from './helpers'

let lib: Library
let libDir: string
const ids: number[] = []

/** Put photos straight into the catalogue (fast; no image files needed). */
function addPhotos(l: Library, n: number, start: string, prefix: string, gps?: [number, number]): number[] {
  const st = l.db.prepare(
    `INSERT INTO photos (raw_key, title, captured, file_path, imported_at, modified_at, lat, lon, cam_lat, cam_lon, pos_source, location_state)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  const out: number[] = []
  const t0 = Date.parse(start + 'Z')
  for (let i = 0; i < n; i++) {
    const cap = new Date(t0 + i * 60000).toISOString().slice(0, 19)
    const r = st.run(`${prefix}-${String(i).padStart(4, '0')}`, `${prefix} ${i}`, cap, `C:\\x\\${prefix}-${i}.jpg`, cap, cap,
      gps?.[0] ?? null, gps?.[1] ?? null, gps?.[0] ?? null, gps?.[1] ?? null, gps ? 'camera' : 'none', gps ? 'known' : 'missing_gps')
    out.push(Number(r.lastInsertRowid))
  }
  return out
}

const node = (l: Library, tree: string, path: string[]): number =>
  l.action('n', (tx) => C.findOrCreatePath(tx, l, C.readTrees(l).find((t) => t.key === tree)!.id, path)).value!

beforeAll(() => {
  libDir = path.join(freshDir('stage23'), 'Stage.facetslib')
  lib = Library.create(libDir)
  C.ensureDefaultTrees(lib)
  // Twelve outings of about 17 photos each, on different days, some with GPS.
  for (let d = 0; d < 12; d++) ids.push(...addPhotos(lib, 17, `2013-0${1 + Math.floor(d / 4)}-${String(10 + (d % 4) * 3).padStart(2, '0')}T09:00:00`, `D${d}`, d % 2 ? [10.6 + d * 0.01, -61.4] : undefined))
})

afterAll(async () => {
  lib?.close()
  await endExifTool()
})

describe('Sets', () => {
  it('a 200-photo Set from 12 Shoots reopens identically after a restart, with its remembered state', () => {
    const chosen = ids.slice(0, 200)
    const setId = lib.action('s', (tx) => C.createSet(tx, 'Client X — 19 Nov', chosen)).value
    C.saveSetState(lib, setId, { view: 'grid', sort: 'captured', filters: { text: 'bird' } })
    lib.close()
    lib = Library.open(libDir)
    const set = C.readSets(lib).find((s) => s.id === setId)!
    expect(set.name).toBe('Client X — 19 Nov')
    expect(set.state).toEqual({ view: 'grid', sort: 'captured', filters: { text: 'bird' } })
    const members = C.readPhotos(lib).filter((p) => p.sets.includes(setId)).map((p) => p.id).sort((a, b) => a - b)
    expect(members).toEqual([...chosen].sort((a, b) => a - b))
  })

  it('duplicate, replace and archive are undoable and never touch the photos', () => {
    const setId = C.readSets(lib).find((s) => s.name.startsWith('Client X'))!.id
    const dup = lib.action('d', (tx) => C.duplicateSet(tx, lib, setId, 'Copy')).value
    expect(C.readPhotos(lib).filter((p) => p.sets.includes(dup)).length).toBe(200)
    lib.action('r', (tx) => C.replaceSet(tx, lib, dup, ids.slice(0, 5)))
    expect(C.readPhotos(lib).filter((p) => p.sets.includes(dup)).length).toBe(5)
    lib.undo()
    expect(C.readPhotos(lib).filter((p) => p.sets.includes(dup)).length).toBe(200)
    lib.action('a', (tx) => C.archiveSet(tx, dup, true))
    expect(C.readSets(lib).find((s) => s.id === dup)!.archived).toBe(true)
  })
})

describe('Shoots', () => {
  it('proposes Shoots from time gaps and creates nothing until accepted', () => {
    const before = C.readShoots(lib).length
    const props = C.proposeShoots(lib, ids, 6, 0)
    expect(props.length).toBe(12)
    expect(props.every((p) => p.ids.length === 17)).toBe(true)
    expect(C.readShoots(lib).length).toBe(before)
    // A smaller gap than the spacing splits nothing; a jump in position splits.
    expect(C.proposeShoots(lib, ids.slice(0, 17), 6, 0).length).toBe(1)
  })

  it('no code or Photo ID is ever issued twice, through undo and withdrawal', () => {
    const issued = new Set<string>()
    for (let d = 0; d < 3; d++) {
      const g = ids.slice(d * 17, d * 17 + 17)
      const code = C.proposeCode(lib, `Outing ${d}`)
      lib.action('s', (tx) => C.createShoot(tx, lib, `Outing ${d}`, code, g))
      lib.action('n', (tx) => C.assignNames(tx, lib, g))
      lib.undo() // undo the naming
      lib.action('n2', (tx) => C.assignNames(tx, lib, g))
      for (const p of C.readPhotos(lib, g)) {
        expect(issued.has(p.publicId!)).toBe(false)
        issued.add(p.publicId!)
      }
    }
    const all = C.readRegistry(lib).ids.map((r) => r.publicId)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('Facet trees', () => {
  it('rename, move and merge keep assignments and node IDs', () => {
    const cocoa = node(lib, 'subject', ['Living things', 'Plants', 'Cocoa'])
    const pid = C.readNodes(lib).find((n) => n.id === cocoa)!.publicId
    lib.action('a', (tx) => C.assignNode(tx, lib, ids.slice(0, 10), cocoa))
    const food = node(lib, 'subject', ['Food'])
    lib.action('m', (tx) => {
      C.updateNode(tx, cocoa, { label: 'Cacao' })
      C.moveNode(tx, lib, cocoa, food)
    })
    const n = C.readNodes(lib).find((x) => x.id === cocoa)!
    expect([n.publicId, n.label, n.parentId]).toEqual([pid, 'Cacao', food])
    expect(C.readPhotos(lib).filter((p) => p.nodes.includes(cocoa)).length).toBe(10)
    const other = node(lib, 'subject', ['Food', 'Cocoa beans'])
    lib.action('a2', (tx) => C.assignNode(tx, lib, ids.slice(5, 15), other))
    lib.action('g', (tx) => C.mergeNodes(tx, lib, other, cocoa))
    expect(C.readPhotos(lib).filter((p) => p.nodes.includes(cocoa)).length).toBe(15)
  })

  it('cross-references link entries in different trees, and only those', () => {
    const cocoa = C.readNodes(lib).find((n) => n.label === 'Cacao')!.id
    const harvest = node(lib, 'activity', ['Agriculture', 'Harvesting', 'Cocoa harvesting'])
    lib.action('x', (tx) => X.addXref(tx, lib, cocoa, harvest))
    expect(C.readNodes(lib).find((n) => n.id === cocoa)!.xrefs).toEqual([harvest])
    expect(C.readNodes(lib).find((n) => n.id === harvest)!.xrefs).toEqual([cocoa])
    const plants = C.readNodes(lib).find((n) => n.label === 'Plants')!.id
    expect(() => lib.action('x2', (tx) => X.addXref(tx, lib, cocoa, plants))).toThrow(/different trees/)
  })

  it('tree files round-trip into a fresh library with the same node IDs, and re-import adds nothing', () => {
    const cocoa = C.readNodes(lib).find((n) => n.label === 'Cacao')!
    lib.action('c', (tx) => C.updateNode(tx, cocoa.id, { shortCode: 'CACA', aliases: ['Theobroma cacao'] }))
    const doc = X.exportAllTaxonomies(lib)
    const text = JSON.stringify(doc)
    expect(doc.trees.map((t) => t.tree.key)).toContain('subject')

    const fresh = Library.create(path.join(freshDir('stage23-fresh'), 'Fresh.facetslib'))
    C.ensureDefaultTrees(fresh)
    const trees = X.parseTaxonomy(text)
    const preview = X.previewTaxonomyImport(fresh, trees)
    const subj = preview.trees.find((t) => t.key === 'subject')!
    expect(subj.newNodes).toBeGreaterThan(0)
    expect(C.readNodes(fresh).some((n) => n.label === 'Cacao')).toBe(false) // a preview writes nothing
    fresh.action('i', (tx) => X.applyTaxonomyImport(tx, fresh, trees))
    C.rebuildClosure(fresh)
    const copy = C.readNodes(fresh).find((n) => n.label === 'Cacao')!
    expect(copy.publicId).toBe(cocoa.publicId)
    expect(copy.shortCode).toBe('CACA')
    expect(copy.aliases).toContain('Theobroma cacao')
    expect(copy.xrefs.length).toBe(1)
    // Importing the same file again matches everything.
    const again = X.previewTaxonomyImport(fresh, X.parseTaxonomy(text))
    expect(again.trees.reduce((a, t) => a + t.newNodes, 0)).toBe(0)
    expect(again.xrefs).toBe(0)
    // New entries made afterwards never reuse an imported ID.
    const n2 = fresh.action('n', (tx) => C.createNode(tx, fresh, copy.treeId, null, 'Brand new')).value
    const ids2 = C.readNodes(fresh).map((n) => n.publicId)
    expect(new Set(ids2).size).toBe(ids2.length)
    expect(C.readNodes(fresh).find((n) => n.id === n2)!.publicId).not.toBe(cocoa.publicId)
    fresh.close()
  })

  it('the tidy-up report lists unused and similar entries', () => {
    const subject = C.readTrees(lib).find((t) => t.key === 'subject')!.id
    node(lib, 'subject', ['Objects', 'Boat'])
    node(lib, 'subject', ['Objects', 'Boats'])
    const r = X.tidyReport(lib, subject)
    expect(r.unused.some((u) => u.path.endsWith('Boat'))).toBe(true)
    expect(r.similar.some((g) => g.paths.some((p) => p.endsWith('Boats')))).toBe(true)
    expect(r.unused.some((u) => u.path.endsWith('Cacao'))).toBe(false)
  })
})

describe('Series', () => {
  it('a Series of 20 photos from 3 Shoots never changes Shoots or Photo IDs (scenario C)', () => {
    const members = [...ids.slice(0, 7), ...ids.slice(17, 24), ...ids.slice(34, 40)]
    const before = C.readPhotos(lib, members).map((p) => [p.id, p.shootId, p.publicId])
    const harvest = C.readNodes(lib).find((n) => n.label === 'Cocoa harvesting')!.id
    const sid = lib.action('s', (tx) => S.createSeries(tx, lib, { title: 'Cocoa harvesting in Trinidad', primaryNodeId: harvest, photoIds: members })).value
    const s = S.readSeriesFull(lib, [sid])[0]
    expect(s.publicId).toMatch(/^SER-\d{6}$/)
    expect(s.members.length).toBe(20)
    expect(s.coverPhotoId).toBe(s.members[0])
    lib.action('r', (tx) => S.removeMembers(tx, lib, sid, ids.slice(0, 3)))
    lib.action('a', (tx) => S.addMembers(tx, lib, sid, ids.slice(50, 52)))
    expect(C.readPhotos(lib, members).map((p) => [p.id, p.shootId, p.publicId])).toEqual(before)
    // Manual editorial order (scenario C).
    const s2 = S.readSeriesFull(lib, [sid])[0]
    const reversed = [...s2.members].reverse()
    lib.action('o', (tx) => S.reorderMembers(tx, lib, sid, reversed))
    const s3 = S.readSeriesFull(lib, [sid])[0]
    expect(s3.members).toEqual(reversed)
    expect(s3.memberOrder).toBe('manual')
    expect(C.readPhotos(lib, [s3.members[0]])[0].series).toContain(sid)
  })

  it('needs a title unique among active Series, a Facet primary keyword, and a rationale for Theme', () => {
    const harvest = C.readNodes(lib).find((n) => n.label === 'Cocoa harvesting')!.id
    expect(() => lib.action('x', (tx) => S.createSeries(tx, lib, { title: 'cocoa harvesting in trinidad', primaryNodeId: harvest, photoIds: [] }))).toThrow(/already has this title/)
    const trinidad = C.readNodes(lib).find((n) => n.label === 'Trinidad')!.id
    expect(() => lib.action('x', (tx) => S.createSeries(tx, lib, { title: 'Somewhere', primaryNodeId: trinidad, photoIds: [] }))).toThrow(/five Facets/)
    const heritage = C.readNodes(lib).find((n) => n.label === 'Heritage')!.id
    expect(() => lib.action('x', (tx) => S.createSeries(tx, lib, { title: 'Heritage walk', primaryNodeId: heritage, photoIds: [] }))).toThrow(/rationale/)
    lib.action('ok', (tx) => S.createSeries(tx, lib, { title: 'Heritage walk', primaryNodeId: heritage, themeRationale: 'Old buildings across years.', photoIds: [] }))
  })

  it('warns on a near-identical Series and lets the user proceed', () => {
    const s = S.readSeriesFull(lib).find((x) => x.title === 'Cocoa harvesting in Trinidad')!
    const w = S.overlapWarnings(lib, { photoIds: s.members, primaryNodeId: s.primaryNodeId, title: 'Something else' })
    expect(w.length).toBe(1)
    expect(w[0].reason).toBe('same primary keyword')
    expect(w[0].pct).toBe(100)
    const w2 = S.overlapWarnings(lib, { photoIds: s.members, primaryNodeId: null, title: 'Cocoa harvesting in Trinidad 2' })
    expect(w2[0].reason).toBe('similar title')
    expect(S.overlapWarnings(lib, { photoIds: s.members.slice(0, 3), primaryNodeId: null, title: 'Unrelated' }).length).toBe(0)
    // Proceeding is allowed.
    lib.action('dup', (tx) => S.createSeries(tx, lib, { title: 'Cocoa harvesting in Trinidad — second look', primaryNodeId: s.primaryNodeId, photoIds: s.members }))
  })

  it('Series IDs are never reused, through undo and retirement', () => {
    const before = S.readSeriesRegistry(lib).map((r) => r.publicId)
    lib.action('t', (tx) => S.createSeries(tx, lib, { title: 'Temp', primaryNodeId: null, photoIds: [] }))
    const tempId = S.readSeriesRegistry(lib).find((r) => r.title === 'Temp')!.publicId
    lib.undo()
    const next = lib.action('t2', (tx) => S.createSeries(tx, lib, { title: 'Temp again', primaryNodeId: null, photoIds: [] })).value
    const s = S.readSeriesFull(lib, [next])[0]
    expect(before).not.toContain(s.publicId)
    expect(s.publicId).not.toBe(tempId)
    lib.action('r', (tx) => S.retireSeries(tx, next))
    expect(S.readSeriesFull(lib).some((x) => x.id === next)).toBe(false)
    const reg = S.readSeriesRegistry(lib)
    expect(reg.find((r) => r.publicId === s.publicId)!.state).toBe('retired')
    expect(reg.find((r) => r.publicId === tempId)!.state).toBe('retired')
    const all = reg.map((r) => r.publicId)
    expect(new Set(all).size).toBe(all.length)
  })

  it('title changes keep history; the slug follows the title until frozen', () => {
    const s = S.readSeriesFull(lib).find((x) => x.title === 'Heritage walk')!
    lib.action('t', (tx) => S.updateSeries(tx, lib, s.id, { title: 'Heritage walk, Port of Spain' }))
    const s2 = S.readSeriesFull(lib, [s.id])[0]
    expect(s2.slug).toBe('heritage-walk-port-of-spain')
    expect(S.readSeriesRegistry(lib).find((r) => r.publicId === s.publicId)!.titles).toEqual(['Heritage walk'])
    expect(S.seriesHistory(lib, s.id).some((h) => h.field === 'title')).toBe(true)
  })

  it('Series keywords reach member photos only by the explicit Apply command, as one undo step (scenario A)', () => {
    const s = S.readSeriesFull(lib).find((x) => x.title === 'Cocoa harvesting in Trinidad')!
    const event = C.readTrees(lib).find((t) => t.key === 'event')!.id
    const ash = lib.action('n', (tx) => C.findOrCreatePath(tx, lib, event, ['Cultural events', 'Carnival', 'Ash Wednesday 2026'])).value!
    lib.action('sup', (tx) => S.setSupporting(tx, lib, s.id, ash, true))
    expect(S.readSeriesFull(lib, [s.id])[0].supporting).toEqual([ash])
    expect(C.readPhotos(lib, s.members).some((p) => p.nodes.includes(ash))).toBe(false)
    lib.action('apply', (tx) => S.applySeriesKeywords(tx, lib, s.id, [ash]))
    expect(C.readPhotos(lib, s.members).every((p) => p.nodes.includes(ash))).toBe(true)
    lib.undo()
    expect(C.readPhotos(lib, s.members).some((p) => p.nodes.includes(ash))).toBe(false)
  })

  it('featured photos are limited to twelve; places are Location entries (scenario B)', () => {
    const s = S.readSeriesFull(lib).find((x) => x.title === 'Cocoa harvesting in Trinidad')!
    lib.action('f', (tx) => { for (const m of s.members.slice(0, 12)) S.setFeatured(tx, lib, s.id, m, true) })
    expect(() => lib.action('f2', (tx) => S.setFeatured(tx, lib, s.id, s.members[12], true))).toThrow(/at most 12/)
    const brigand = node(lib, 'location', ['Trinidad and Tobago', 'Trinidad', 'Manzanilla', 'Brigand Hill'])
    lib.action('p', (tx) => S.setPlace(tx, lib, s.id, brigand, true))
    expect(S.readSeriesFull(lib, [s.id])[0].places).toEqual([brigand])
  })
})

describe('Filter manifest and re-reading metadata', () => {
  it('records the Filter batch on matching photos', () => {
    const r = readFilterManifest(lib, JSON.stringify({
      format: 'filter-manifest/1', batch: { id: 7, date: '2026-11-18T10:00:00Z' },
      files: [{ rawKey: 'D0-0000' }, { rawKey: 'D0-0001' }, { rawKey: 'NOT-HERE' }]
    }))
    expect(r.matched).toBe(2)
    expect(r.unmatched).toEqual(['NOT-HERE'])
    expect(C.readPhotos(lib, ids.slice(0, 2)).every((p) => p.filterBatch === 'Filter batch 7 · 2026-11-18')).toBe(true)
  })

  it('re-reads only the chosen fields, as one undoable action', async () => {
    const dir = freshDir('reread')
    await makeJpeg(path.join(dir, '20200101-RERE0001.jpg'), { Title: 'From Lightroom', Rating: 3, Headline: 'LR caption' })
    const imp = await runImport(lib, { folder: dir, recursive: false })
    if ('needsChoice' in imp) throw new Error('unexpected')
    const id = C.readPhotos(lib).find((p) => p.rawKey === '20200101-RERE0001')!.id
    lib.action('e', (tx) => C.applyEdits(tx, [id], [{ field: 'title', value: 'Mine' }, { field: 'caption', value: 'My caption' }]))
    const r = await rereadMetadata(lib, [id], ['title'])
    expect(r.read).toBe(1)
    const p = C.readPhotos(lib, [id])[0]
    expect(p.title).toBe('From Lightroom')
    expect(p.caption).toBe('My caption')
    lib.undo()
    expect(C.readPhotos(lib, [id])[0].title).toBe('Mine')
    expect(fs.existsSync(path.join(dir, '20200101-RERE0001.jpg'))).toBe(true)
  })
})
