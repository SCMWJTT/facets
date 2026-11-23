// 0.3.0: Series short names, and upgrading a format-1 library without losing anything.
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { Library } from '../src/main/db/library'
import * as C from '../src/main/services/catalog'
import * as S from '../src/main/services/series'
import { suggestShortName, seriesLabel } from '../src/shared/shortname'
import { freshDir } from './helpers'

const libs: Library[] = []
afterAll(() => libs.forEach((l) => l.close()))

describe('short names', () => {
  it('suggests unique names of at most 10 characters', () => {
    expect(suggestShortName('Vegetable Field', [])).toBe('Vegetable')
    expect(suggestShortName('The Vegetable Field', ['Vegetable'])).toBe('Vegetable2')
    expect(suggestShortName('South East Peninsula Nature Trip', []).length).toBeLessThanOrEqual(10)
    expect(seriesLabel({ publicId: 'SER-000012', shortName: 'Veg' })).toBe('SER-12: Veg')
  })

  it('new Series get a short name; clashes and long names are refused; it can be changed and undone', () => {
    const lib = Library.create(path.join(freshDir('v030a'), 'A.facetslib'))
    libs.push(lib)
    C.ensureDefaultTrees(lib)
    const a = lib.action('s', (tx) => S.createSeries(tx, lib, { title: 'Vegetable Field', primaryNodeId: null, photoIds: [] })).value!
    const b = lib.action('s', (tx) => S.createSeries(tx, lib, { title: 'Vegetable Field 2014', primaryNodeId: null, photoIds: [] })).value!
    const all = S.readSeriesFull(lib)
    expect(all.find((x) => x.id === a)!.shortName).toBe('Vegetable')
    expect(all.find((x) => x.id === b)!.shortName).toBe('Vegetable2')
    expect(() => lib.action('x', (tx) => S.updateSeries(tx, lib, b, { shortName: 'vegetable' }))).toThrow(/already uses/)
    expect(() => lib.action('x', (tx) => S.updateSeries(tx, lib, b, { shortName: 'Much too long' }))).toThrow(/at most 10/)
    lib.action('Edit Series', (tx) => S.updateSeries(tx, lib, b, { shortName: 'Veg 14' }))
    expect(S.readSeriesFull(lib, [b])[0].shortName).toBe('Veg 14')
    lib.undo()
    expect(S.readSeriesFull(lib, [b])[0].shortName).toBe('Vegetable2')
  })

  it('a format-1 library upgrades: existing Series keep everything and gain short names', () => {
    const dir = path.join(freshDir('v030b'), 'Old.facetslib')
    let lib = Library.create(dir)
    C.ensureDefaultTrees(lib)
    const id = lib.action('s', (tx) => S.createSeries(tx, lib, { title: 'River Walk at Dusk', primaryNodeId: null, photoIds: [] })).value!
    lib.close()
    // Make it look like a 0.2.0 library: no short_name column, format 1.
    const db = new Database(path.join(dir, 'library.sqlite'))
    db.exec('ALTER TABLE series DROP COLUMN short_name')
    db.prepare("UPDATE meta SET value = '1' WHERE key = 'schema_version'").run()
    db.close()
    lib = Library.open(dir)
    libs.push(lib)
    expect(lib.schemaVersion).toBe(2)
    const s = S.readSeriesFull(lib, [id])[0]
    expect(s.title).toBe('River Walk at Dusk')
    expect(s.shortName).toBe('River Walk')
  })
})
