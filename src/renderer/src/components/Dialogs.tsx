import { useEffect, useMemo, useState } from 'react'
import type { DuplicateChoice, DuplicateGroup, EditableField, ImportReport, PasteSpec, Settings } from '@shared/types'
import { publishedName, TEMPLATE_SEGMENTS } from '@shared/naming'
import { act, bridge, call } from '../api'
import { useStore, EMPTY_FILTERS } from '../store'
import { loadLibrary } from '../App'
import { Dialog, confirm } from './ui'
import { FacetsMark, Icon } from './Icon'
import { useStore as useAppStore, FOOTER_OPTIONS, ICON_OPTIONS, THUMB_PRESETS } from '../store'
import type { AppInfo } from '@shared/types'
import { visibleTrees } from '../logic'
import * as cmd from '../commands'
import * as D2 from './Dialogs2'

export function Dialogs() {
  const d = useStore((s) => s.dialog)
  const close = useStore((s) => s.closeDialog)
  if (!d) return null
  switch (d.kind) {
    case 'import': return <ImportDialog close={close} />
    case 'shoot': return <ShootDialog close={close} ids={(d.props?.ids as number[]) ?? []} />
    case 'settings': return <SettingsDialog close={close} initialTab={(d.props?.tab as string) ?? 'defaults'} />
    case 'about': return <AboutDialog close={close} licences={!!d.props?.licences} />
    case 'newSeries': return <D2.NewSeriesDialog close={close} ids={d.props!.ids as number[]} />
    case 'applySeries': return <D2.ApplySeriesDialog close={close} id={d.props!.id as number} />
    case 'proposeShoots': return <D2.ProposeShootsDialog close={close} ids={d.props!.ids as number[]} />
    case 'taxonomyImport': return <D2.TaxonomyImportDialog close={close} file={d.props!.file as string} preview={d.props!.preview as never} />
    case 'tidy': return <D2.TidyDialog close={close} treeId={d.props!.treeId as number} />
    case 'newFacet': return <D2.NewFacetDialog close={close} />
    case 'reread': return <D2.RereadDialog close={close} ids={d.props!.ids as number[]} />
    case 'legend': return <IconLegendDialog close={close} />
    case 'thumbs': return <ThumbsDialog close={close} />
    case 'glossary': return <GlossaryDialog close={close} />
    case 'workflow': return <WorkflowDialog close={close} />
    case 'paste': return <PasteDialog close={close} />
    case 'shortcuts': return <ShortcutsDialog close={close} />
    case 'tree': return <TreeDialog close={close} />
  }
  return null
}

// ---------------------------------------------------------------- import

type ImportResult = { needsChoice: DuplicateGroup[] } | { report: ImportReport; setId: number | null; delta: never }

function ImportDialog({ close }: { close: () => void }) {
  const [folder, setFolder] = useState(() => localStorage.getItem('facets.lastImport') ?? '')
  const [recursive, setRecursive] = useState(false)
  const [retain, setRetain] = useState(true)
  const [step, setStep] = useState<'choose' | 'running' | 'choice' | 'done'>('choose')
  const [dups, setDups] = useState<DuplicateGroup[]>([])
  const [choices, setChoices] = useState<Record<string, DuplicateChoice>>({})
  const [report, setReport] = useState<ImportReport | null>(null)
  const [setId, setSetId] = useState<number | null>(null)
  const [openList, setOpenList] = useState<string | null>(null)
  const progress = useStore((s) => s.progress)

  const run = async (ch?: Record<string, DuplicateChoice>): Promise<void> => {
    if (!folder) return
    localStorage.setItem('facets.lastImport', folder)
    setStep('running')
    try {
      const r = await call<ImportResult>('runImport', folder, recursive, ch, retain)
      if ('needsChoice' in r) {
        setDups(r.needsChoice)
        setChoices(Object.fromEntries(r.needsChoice.map((g) => [g.rawKey.toLowerCase(), 'variant'])))
        setStep('choice')
        return
      }
      useStore.getState().applyDelta((r as unknown as { delta: Parameters<ReturnType<typeof useStore.getState>['applyDelta']>[0] }).delta)
      setReport(r.report)
      setSetId(r.setId)
      setStep('done')
    } catch (e) {
      useStore.getState().toast((e as Error).message, 'error')
      setStep('choose')
    }
  }

  if (step === 'running') {
    const pct = progress.importTotal ? (100 * progress.importDone) / progress.importTotal : 0
    return (
      <Dialog title="Importing…" onClose={() => {}}>
        <div className="progress"><i style={{ width: `${pct}%` }} /></div>
        <div className="muted">{progress.importTotal ? `${progress.importDone} of ${progress.importTotal} files · ${progress.importLabel}` : 'Scanning the folder…'}</div>
      </Dialog>
    )
  }

  if (step === 'choice') {
    return (
      <Dialog title="Same raw key, several files" wide onClose={() => setStep('choose')}
        sub="These files share a raw key. Choose for each whether they are separate variants (each becomes its own photo) or whether the newest file replaces the others."
        foot={<>
          <div className="left row">
            <button className="btn small ghost" onClick={() => setChoices(Object.fromEntries(dups.map((g) => [g.rawKey.toLowerCase(), 'variant'])))}>All variants</button>
            <button className="btn small ghost" onClick={() => setChoices(Object.fromEntries(dups.map((g) => [g.rawKey.toLowerCase(), 'replace'])))}>All replacements</button>
          </div>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={() => void run(choices)}>Continue import</button>
        </>}>
        {dups.map((g) => {
          const k = g.rawKey.toLowerCase()
          return (
            <div key={k} className="hsec">
              <div className="hname"><span className="mono">{g.rawKey}</span><span className="grow" />
                <div className="seg">
                  <button className={choices[k] === 'variant' ? 'on' : ''} onClick={() => setChoices({ ...choices, [k]: 'variant' })}>Variants</button>
                  <button className={choices[k] === 'replace' ? 'on' : ''} onClick={() => setChoices({ ...choices, [k]: 'replace' })}>Replacement</button>
                </div>
              </div>
              <div className="mono muted" style={{ fontSize: 11.5 }}>{g.files.map((f) => <div key={f}>{f.split(/[\\/]/).pop()}</div>)}</div>
            </div>
          )
        })}
      </Dialog>
    )
  }

  if (step === 'done' && report) {
    const stats: [string, string, string[]][] = [
      ['added', 'New photos', report.added],
      ['known', 'Already catalogued', report.known],
      ['changed', 'Re-exported', report.changed],
      ['variants', 'Variants', report.variants],
      ['skipped', 'Skipped', report.skipped.map((s) => `${s.file} — ${s.reason}`).concat(report.replaced.map((r) => `${r} — replaced by a newer file`))],
      ['flags', 'Flagged', report.flags.map((f) => `${f.file} — ${f.message}`)]
    ]
    return (
      <Dialog title="Import complete" wide onClose={close}
        sub={!report.setCreated ? 'Nothing new or changed: the library is exactly as it was, so no import Set was made.' : report.changed.length ? 'Re-exported photos kept all their catalogue fields; their thumbnails are being refreshed.' : 'Thumbnails are being made in the background; you can start working now. Lightroom keywords arrived as Internal tags, waiting for review.'}
        foot={<>
          <button className="btn ghost" onClick={close}>Close</button>
          {setId !== null && <button className="btn primary" onClick={() => { const s = useStore.getState(); s.setSource({ kind: 'set', id: setId }); s.set({ filters: EMPTY_FILTERS }); close() }}>Show imported photos</button>}
        </>}>
        <div className="report">
          {stats.map(([k, l, list]) => (
            <div key={k} className="stat" style={{ cursor: list.length ? 'pointer' : 'default', boxShadow: openList === k ? 'inset 0 0 0 1.5px var(--accent-ring)' : '' }} onClick={() => list.length && setOpenList(openList === k ? null : k)}>
              <b>{list.length}</b><span>{l}</span>
            </div>
          ))}
        </div>
        {openList && <div className="filelist">{stats.find((s) => s[0] === openList)![2].map((f, i) => <div key={i}>{f}</div>)}</div>}
      </Dialog>
    )
  }

  return (
    <Dialog title="Import a folder" onClose={close}
      sub="Choose the folder Lightroom exported JPEGs into. Files are only read; Facets never changes them."
      foot={<>
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!folder} onClick={() => void run()}><Icon name="import" size={14} />Import</button>
      </>}>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFolder(bridge.pathForFile(f)) }}>
        <div className="label">Folder</div>
        <div className="row">
          <input className="field mono" value={folder} placeholder="Drop a folder here or browse" onChange={(e) => setFolder(e.target.value)} />
          <button className="btn" onClick={async () => { const f = await call<string | null>('chooseFolder'); if (f) setFolder(f) }}><Icon name="folder" size={14} />Browse…</button>
        </div>
      </div>
      <label className="check"><input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />Include subfolders</label>
      <div>
        <div className="label">Location</div>
        <div className="seg">
          <button className={retain ? 'on' : ''} onClick={() => setRetain(true)}>Keep positions and places</button>
          <button className={!retain ? 'on' : ''} onClick={() => setRetain(false)}>Do not retain location</button>
        </div>
        {!retain && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>For private places: no GPS position or place name from these files is stored. The files themselves are not changed.</div>}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        New photos start as Draft with their Lightroom title, caption, rating, keywords and GPS. Keywords arrive as Internal tags until you review them. Photos already in the library are recognised by their raw key and keep everything you have recorded.
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- new shoot

function ShootDialog({ close, ids }: { close: () => void; ids: number[] }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [touched, setTouched] = useState(false)
  const [free, setFree] = useState<boolean | null>(null)
  useEffect(() => {
    if (touched) return
    if (!name.trim()) { setCode(''); return }
    const t = setTimeout(() => void call<string>('proposeCode', name).then(setCode).catch(() => {}), 150)
    return () => clearTimeout(t)
  }, [name, touched])
  useEffect(() => {
    if (!/^[A-Z0-9]{4}$/.test(code)) { setFree(null); return }
    void call<boolean>('codeFree', code).then(setFree)
  }, [code])
  const ok = name.trim() && /^[A-Z0-9]{4}$/.test(code) && free
  const submit = async (): Promise<void> => { if (!ok) return; const r = await act('createShoot', name.trim(), code, ids); if (r?.ok) close() }
  return (
    <Dialog title="New shoot" onClose={close}
      sub={ids.length ? `${ids.length} selected photo${ids.length > 1 ? 's' : ''} will be put in it.` : 'No photos are selected; you can add them later by dragging.'}
      foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => void submit()}>Create shoot</button></>}>
      <div>
        <div className="label">Name</div>
        <input className="field" autoFocus value={name} placeholder="e.g. Maracas Lime" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      </div>
      <div>
        <div className="label">Code <span className={'hint' + (free === false ? ' over' : '')}>{code.length !== 4 ? 'four letters or digits' : free === null ? '' : free ? 'available' : 'already used — codes are never reused'}</span></div>
        <input className="field mono" style={{ width: 140, fontSize: 16, letterSpacing: '0.15em' }} value={code} maxLength={4}
          onChange={(e) => { setTouched(true); setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')) }} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- new hierarchy

function TreeDialog({ close }: { close: () => void }) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [touched, setTouched] = useState(false)
  const [multi, setMulti] = useState(true)
  const [levels, setLevels] = useState('')
  const [hasPosition, setHasPosition] = useState(false)
  useEffect(() => { if (!touched) setKey(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) }, [name, touched])
  const submit = async (): Promise<void> => {
    if (!name.trim() || !key) return
    const r = await act('createTree', { key, name: name.trim(), multi, levels: levels.split(',').map((x) => x.trim()).filter(Boolean), hasPosition })
    if (r?.ok) close()
  }
  return (
    <Dialog title="New custom tree" onClose={close} sub="For your own reference lists, for example Technique or Habitat. The five Facets (Subject, Activity, Event, People, Theme) are fixed."
      foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!name.trim() || !key} onClick={() => void submit()}>Create</button></>}>
      <div className="row">
        <div className="grow"><div className="label">Name</div><input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div style={{ width: 170 }}><div className="label">Key (permanent)</div><input className="field mono" value={key} onChange={(e) => { setTouched(true); setKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')) }} /></div>
      </div>
      <div>
        <div className="label">Entries per photo</div>
        <div className="seg"><button className={!multi ? 'on' : ''} onClick={() => setMulti(false)}>One</button><button className={multi ? 'on' : ''} onClick={() => setMulti(true)}>Many</button></div>
      </div>
      <div><div className="label">Level names (optional, comma separated)</div><input className="field" value={levels} placeholder="e.g. Story, Chapter" onChange={(e) => setLevels(e.target.value)} /></div>
      <label className="check"><input type="checkbox" checked={hasPosition} onChange={(e) => setHasPosition(e.target.checked)} />Entries carry a map position</label>
    </Dialog>
  )
}

// ---------------------------------------------------------------- paste fields

const PASTE_FIELDS: [EditableField, string][] = [
  ['title', 'Title'], ['caption', 'Caption'], ['note', 'Note'], ['alt', 'Alt text'], ['rating', 'Rating'],
  ['creator', 'Creator'], ['copyright', 'Copyright'], ['licence', 'Licence'], ['credit', 'Credit line'],
  ['lat', 'Position'], ['elevation', 'Elevation'], ['precision', 'Publishing precision'], ['showElevation', 'Publish elevation'],
  ['locationState', 'Location state'], ['people', 'Shows people'], ['privatePlace', 'Private place']
]

function PasteDialog({ close }: { close: () => void }) {
  const allH = useStore((s) => s.trees)
  const hs = useMemo(() => visibleTrees({ trees: allH }), [allH])
  const prev = useStore((s) => s.ui.pasteSpec)
  const src = useStore((s) => (s.clipboard ? s.byId.get(s.clipboard) : undefined))
  const n = useStore((s) => s.selected.size)
  const [fields, setFields] = useState<Set<EditableField>>(new Set(prev?.fields ?? ['title', 'caption', 'alt']))
  const [hier, setHier] = useState<Record<number, 'off' | 'add' | 'replace'>>(() => Object.fromEntries(hs.map((h) => [h.id, prev?.trees.find((x) => x.id === h.id)?.mode ?? 'off'])))
  const [shoot, setShoot] = useState(prev?.shoot ?? false)
  const toggle = (f: EditableField): void => { const s = new Set(fields); if (s.has(f)) s.delete(f); else s.add(f); setFields(s) }
  const go = async (): Promise<void> => {
    const fl = [...fields]
    if (fl.includes('lat')) fl.push('lon')
    const spec: PasteSpec = { fields: fl, trees: Object.entries(hier).filter(([, m]) => m !== 'off').map(([id, m]) => ({ id: Number(id), mode: m as 'add' | 'replace' })), shoot }
    useStore.getState().setUi({ pasteSpec: spec })
    await act('paste', src!.id, [...useStore.getState().selected], spec)
    close()
  }
  if (!src) return null
  return (
    <Dialog title="Paste fields" onClose={close} sub={<>From <span className="mono">{src.publicId ?? src.rawKey}</span> to {n} selected photo{n === 1 ? '' : 's'}. Your choice is remembered for “Paste again”.</>}
      foot={<>
        <div className="left row">
          <button className="btn small ghost" onClick={() => setFields(new Set(PASTE_FIELDS.map((f) => f[0])))}>All fields</button>
          <button className="btn small ghost" onClick={() => setFields(new Set())}>None</button>
        </div>
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" onClick={() => void go()}>Paste</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        {PASTE_FIELDS.map(([f, l]) => <label key={f} className="check"><input type="checkbox" checked={fields.has(f)} onChange={() => toggle(f)} />{l}</label>)}
        <label className="check"><input type="checkbox" checked={shoot} onChange={(e) => setShoot(e.target.checked)} />Shoot</label>
      </div>
      <div>
        <div className="label">Facets, Location and other trees</div>
        {hs.map((h) => (
          <div key={h.id} className="row" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
            <span>{h.name}</span>
            <div className="seg">
              {(['off', 'add', 'replace'] as const).map((m) => <button key={m} className={hier[h.id] === m ? 'on' : ''} onClick={() => setHier({ ...hier, [h.id]: m })}>{{ off: "Don't paste", add: 'Add', replace: 'Replace' }[m]}</button>)}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- settings

function SettingsDialog({ close, initialTab }: { close: () => void; initialTab: string }) {
  const settings = useStore((s) => s.settings)!
  const trees = useStore((s) => s.trees)
  const library = useStore((s) => s.library)!
  const version = useStore((s) => s.version)
  const focus = useStore((s) => (s.focusId ? s.byId.get(s.focusId) : s.photos[0]))
  const shoots = useStore((s) => s.shoots)
  const [s, setS] = useState<Settings>(structuredClone(settings))
  const [tab, setTab] = useState(initialTab)
  const roots = Object.entries(s.keywordRoots)
  const up = (p: Partial<Settings>): void => setS({ ...s, ...p })

  const example = useMemo(() => {
    const p = focus ?? null
    if (!p) return ''
    const sh = shoots.find((x) => x.id === p.shootId) ?? { id: 0, code: 'MALM', name: 'Maracas Lime', description: '', coverPhotoId: null, timeZone: '', clockOffsetMin: 0, privacy: 'private' as const, archived: false, nextNumber: 1 }
    return publishedName(s.nameTemplate, { ...p, publicId: p.publicId ?? `${sh.code}-00001` }, sh, null)
  }, [s.nameTemplate, focus, shoots])

  const keyExample = useMemo(() => {
    const sample = '20121227-GZ3A6486-Edit'
    if (!s.rawKeyPattern) return sample
    try { const m = sample.match(new RegExp(s.rawKeyPattern)); return m ? (m[1] ?? m[0]) : `${sample} (no match: file name used)` } catch { return 'invalid pattern' }
  }, [s.rawKeyPattern])

  const save = async (): Promise<void> => {
    const r = await act('saveSettings', s)
    if (r?.ok) close()
  }
  const tabs = [['defaults', 'Defaults'], ['import', 'Import'], ['names', 'Names'], ['map', 'Map'], ['library', 'Library']]
  return (
    <Dialog title="Settings" wide onClose={close}
      foot={<><span className="left muted" style={{ fontSize: 12 }}>Facets {version} · these settings are stored in the library</span><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={() => void save()}>Save</button></>}>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'defaults' && (
        <>
          <div className="muted" style={{ fontSize: 12 }}>Filled in on new photos when the embedded metadata has none.</div>
          <div className="row"><div className="grow"><div className="label">Creator</div><input className="field" value={s.creator} onChange={(e) => up({ creator: e.target.value })} /></div>
            <div className="grow"><div className="label">Copyright</div><input className="field" value={s.copyright} placeholder="© Your Name" onChange={(e) => up({ copyright: e.target.value })} /></div></div>
          <div className="row"><div className="grow"><div className="label">Licence</div><input className="field" value={s.licence} onChange={(e) => up({ licence: e.target.value })} /></div>
            <div className="grow"><div className="label">Credit line</div><input className="field" value={s.credit} onChange={(e) => up({ credit: e.target.value })} /></div></div>
          <div style={{ width: 200 }}><div className="label">Default time zone for new shoots</div><input className="field mono" value={s.defaultTimeZone} onChange={(e) => up({ defaultTimeZone: e.target.value })} /></div>
        </>
      )}
      {tab === 'import' && (
        <>
          <div>
            <div className="label">Raw key pattern <span className="hint">optional regular expression; the first group is the raw key</span></div>
            <input className="field mono" value={s.rawKeyPattern} placeholder="e.g. ^(.*?)(?:-Edit)?$" onChange={(e) => up({ rawKeyPattern: e.target.value })} />
            <div className="muted mono" style={{ fontSize: 11.5, marginTop: 5 }}>20121227-GZ3A6486-Edit.jpg → {keyExample}</div>
          </div>
          <div>
            <div className="label">Lightroom keyword roots <span className="hint">top-level Lightroom keyword → Facet or tree</span></div>
            {roots.map(([k, v], i) => (
              <div key={i} className="row" style={{ marginBottom: 6 }}>
                <input className="field" value={k} onChange={(e) => { const r = [...roots]; r[i] = [e.target.value, v]; up({ keywordRoots: Object.fromEntries(r) }) }} />
                <Icon name="right" size={14} />
                <select className="select" value={trees.some((h) => h.key === v) ? v : '__new'} onChange={(e) => { const r = [...roots]; r[i] = [k, e.target.value === '__new' ? v : e.target.value]; up({ keywordRoots: Object.fromEntries(r) }) }}>
                  {trees.map((h) => <option key={h.key} value={h.key}>{h.name}</option>)}
                  {!trees.some((h) => h.key === v) && <option value="__new">{v} (created on import)</option>}
                </select>
                <button className="iconbtn" onClick={() => up({ keywordRoots: Object.fromEntries(roots.filter((_, j) => j !== i)) })}><Icon name="x" size={14} /></button>
              </div>
            ))}
            <button className="btn small ghost" onClick={() => up({ keywordRoots: { ...s.keywordRoots, '': 'keywords' } })}><Icon name="plus" size={13} />Add mapping</button>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>Keywords under any other root go to</span>
              <select className="select" style={{ width: 180 }} value={s.unmappedRootsTo} onChange={(e) => up({ unmappedRootsTo: e.target.value })}>
                {trees.filter((t) => t.kind !== 'location').map((h) => <option key={h.key} value={h.key}>{h.name}</option>)}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>with their full path.</span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Flat keywords that are not part of any path go to Subject › Unsorted. A mapping to a tree that does not exist yet creates a hidden legacy tree. Everything seeded from Lightroom arrives as Internal until reviewed.</div>
          </div>
          <label className="check"><input type="checkbox" checked={s.seedLocationFromIptc} onChange={(e) => up({ seedLocationFromIptc: e.target.checked })} />Fill the Location tree from Lightroom's Country, State, City and Location fields</label>
        </>
      )}
      {tab === 'names' && (
        <>
          <div>
            <div className="label">Published name template</div>
            <input className="field mono" value={s.nameTemplate} onChange={(e) => up({ nameTemplate: e.target.value })} />
            <div className="chips" style={{ marginTop: 8 }}>
              {TEMPLATE_SEGMENTS.map((t) => <button key={t.token} className="chip" style={{ border: 0, paddingRight: 9 }} onClick={() => up({ nameTemplate: s.nameTemplate + (s.nameTemplate && !s.nameTemplate.endsWith('-') ? '-' : '') + t.token })}>{t.label}</button>)}
            </div>
          </div>
          <div className="hsec"><div className="label">Example</div><div className="mono">{example || '—'}</div></div>
          <div className="muted" style={{ fontSize: 12 }}>A published name is frozen when a photo is first exported. Until then, changing the template updates the names of named photos.</div>
        </>
      )}
      {tab === 'map' && (
        <>
          {(['street', 'satellite'] as const).map((k) => (
            <div key={k} className="hsec col" style={{ gap: 8 }}>
              <div className="hname" style={{ marginBottom: 0 }}>{k === 'street' ? 'Street map' : 'Satellite'}</div>
              <input className="field mono" value={s.tiles[k].url} onChange={(e) => up({ tiles: { ...s.tiles, [k]: { ...s.tiles[k], url: e.target.value } } })} />
              <input className="field" value={s.tiles[k].attribution} placeholder="Attribution" onChange={(e) => up({ tiles: { ...s.tiles, [k]: { ...s.tiles[k], attribution: e.target.value } } })} />
            </div>
          ))}
          <div className="row">
            <div className="grow"><div className="label">Default centre (lat, lon)</div><input className="field mono" value={`${s.mapCenter.lat}, ${s.mapCenter.lon}`} onChange={(e) => { const m = e.target.value.split(',').map((x) => Number(x.trim())); if (m.length === 2 && m.every(Number.isFinite)) up({ mapCenter: { ...s.mapCenter, lat: m[0], lon: m[1] } }) }} /></div>
            <div style={{ width: 120 }}><div className="label">Zoom</div><input className="field" type="number" value={s.mapCenter.zoom} onChange={(e) => up({ mapCenter: { ...s.mapCenter, zoom: Number(e.target.value) } })} /></div>
            <div style={{ width: 170 }}><div className="label">Suggest within (m)</div><input className="field" type="number" value={s.suggestDistanceM} onChange={(e) => up({ suggestDistanceM: Number(e.target.value) })} /></div>
          </div>
        </>
      )}
      {tab === 'library' && (
        <>
          <div className="kv"><div>Library</div><div className="mono">{library.path}</div></div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={async () => { const p = await call<string | null>('exportBackup'); if (p) useStore.getState().toast(`Backup written to ${p}`) }}><Icon name="save" size={14} />Export library backup (JSON)…</button>
            <button className="btn ghost" onClick={async () => { close(); try { if (await call('openLibrary')) await loadLibrary() } catch (e) { useStore.getState().toast((e as Error).message, 'error') } }}><Icon name="folder" size={14} />Open another library…</button>
            <button className="btn ghost" onClick={async () => { close(); try { if (await call('createLibrary')) await loadLibrary() } catch (e) { useStore.getState().toast((e as Error).message, 'error') } }}><Icon name="plus" size={14} />New library…</button>
            <button className="btn ghost" onClick={async () => { if (await confirm('Close this library?', 'Everything is already saved.', 'Close library')) { close(); await call('closeLibrary'); await loadLibrary() } }}>Close library</button>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Every change is saved the moment you make it. The library keeps a daily backup, a backup before any upgrade, and one before any change to more than 500 photos (last 30 are kept in its backups folder).</div>
        </>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------- shortcuts

function ShortcutsDialog({ close }: { close: () => void }) {
  const rows: [string, string][] = [
    ['G / T / E', 'Grid, table, single view (Space toggles single)'],
    ['Arrow keys', 'Move; Shift extends the selection'],
    ['Click, Shift-click, Ctrl-click', 'Select, select a range, add or remove'],
    ['Ctrl+A / Ctrl+D', 'Select all shown / select none'],
    ['0 – 5', 'Set the rating'],
    ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    ['Ctrl+Shift+C / Ctrl+Shift+V', 'Copy fields / paste fields'],
    ['Ctrl+Alt+V', 'Paste again with the last choices'],
    ['Ctrl+N', 'New shoot from selection'],
    ['Ctrl+Shift+N', 'New Series from selection (stage 3)'],
    ['Ctrl+1 … Ctrl+6', 'Library, Map, Series, Hierarchies, Registry, History'],
    ['Alt+F, E, V, O, T, P, H', 'Open the File, Edit, View, Organise, Tools, Options or Help menu'],
    ['Ctrl+wheel', 'Thumbnail size'],
    ['F11', 'Full screen'],
    ['?', 'This list'],
    ['Ctrl+I', 'Import a folder'],
    ['Ctrl+F', 'Search'],
    ['F', 'Show or hide filter columns'],
    ['Tab', 'Hide or show side panels'],
    ['Enter', 'Open the focused photo in single view'],
    ['Esc', 'Back to grid / clear selection'],
    ['Ctrl+Enter', 'Save a multi-line text field'],
    ['Drag photos', 'Onto a Shoot, a Set or a Facet or Location entry to assign']
  ]
  return (
    <Dialog title="Keyboard shortcuts" onClose={close} foot={<button className="btn primary" onClick={close}>Close</button>}>
      <div className="kv" style={{ gridTemplateColumns: '210px 1fr', fontSize: 12.5 }}>
        {rows.flatMap(([k, v]) => [<div key={k}><span className="kbd">{k}</span></div>, <div key={k + 'v'}>{v}</div>])}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- about

function AboutDialog({ close, licences }: { close: () => void; licences: boolean }) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => { void call<AppInfo>('appInfo').then(setInfo) }, [])
  return (
    <Dialog title="About Facets" onClose={close} foot={<button className="btn primary" onClick={close}>Close</button>}>
      <div className="row" style={{ gap: 14 }}>
        <FacetsMark size={46} />
        <div>
          <div style={{ fontSize: 20, fontWeight: 300, letterSpacing: '.03em' }}>Facets</div>
          <div className="muted">Version {info?.version ?? ''}{info?.buildDate ? ` · built ${info.buildDate}` : ''}</div>
        </div>
      </div>
      <div className="hsec" style={{ lineHeight: 1.55 }}>
        © Cynmark Systems Limited. Facets and its concept are owned by Cynmark Systems Limited. All rights reserved.
      </div>
      {info && (
        <div className="kv" style={{ gridTemplateColumns: '130px 1fr' }}>
          <div>Library</div><div className="mono">{info.libraryPath ?? 'none open'}</div>
          <div>Settings folder</div><div className="mono">{info.userData}</div>
          <div>Logs</div><div className="mono">{info.logFolder ?? '—'}</div>
        </div>
      )}
      {info && (
        <details open={licences}>
          <summary className="label" style={{ cursor: 'pointer' }}>Bundled components and licences</summary>
          <div className="kv" style={{ gridTemplateColumns: '170px 1fr', marginTop: 6 }}>
            {info.components.flatMap((c) => [<div key={c.name}>{c.name}{c.version ? ` ${c.version}` : ''}</div>, <div key={c.name + 'l'}>{c.licence}</div>])}
          </div>
        </details>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------- icon legend

export const ICON_LEGEND: { icon: React.ReactNode; name: string; meaning: string }[] = [
  { icon: <Icon name="pinFill" size={12} fill stroke={0} />, name: 'Pin (filled)', meaning: 'Has a position' },
  { icon: <span style={{ color: 'var(--warn)', display: 'grid' }}><Icon name="pinOff" size={12} /></span>, name: 'Pin (crossed)', meaning: 'No position and no location state set' },
  { icon: <Icon name="pin" size={12} />, name: 'Pin (hollow)', meaning: 'Location intentionally unknown, hidden or not retained' },
  { icon: <Icon name="placeTick" size={12} />, name: 'Place label tick', meaning: 'Has a Location entry' },
  { icon: <span className="mono" style={{ color: 'var(--accent2)', fontSize: 10 }}>ASHW</span>, name: 'Shoot code', meaning: 'In a Shoot' },
  { icon: <span style={{ color: 'var(--f-activity)', display: 'grid' }}><Icon name="activity" size={12} /></span>, name: 'Facet icon (tinted)', meaning: "In a Series; shows that Series' Primary Facet. A number appears if it is in several" },
  { icon: <span style={{ color: 'var(--d-private)', display: 'grid' }}><Icon name="lock" size={12} /></span>, name: 'Lock (red)', meaning: 'Private: the photo, its Shoot or a Private Series' },
  { icon: <Icon name="tag" size={12} dash />, name: 'Dashed tag', meaning: 'Has Internal or unreviewed tags' },
  { icon: <Icon name="sparkle" size={12} />, name: 'Sparkle', meaning: 'AI proposals pending review' },
  { icon: <Icon name="people" size={12} />, name: 'People', meaning: 'Shows identifiable people' },
  { icon: <span style={{ color: 'var(--accent2)', fontSize: 10.5 }}>v2</span>, name: 'v2', meaning: 'Variant (another edit of the same RAW)' },
  { icon: <span style={{ color: 'var(--bad)', display: 'grid' }}><Icon name="offline" size={12} /></span>, name: 'Offline', meaning: 'File offline (drive not connected); the cached thumbnail is shown' },
  { icon: <span className="missing-ring" style={{ display: 'inline-block', margin: 0 }} />, name: 'Dot ring (amber)', meaning: 'Missing required fields; the tooltip lists them' },
  { icon: <span style={{ color: 'var(--ok)', display: 'grid' }}><Icon name="globeTick" size={12} /></span>, name: 'Globe', meaning: 'Published to at least one site' },
  { icon: <span style={{ color: 'var(--warn)', display: 'grid' }}><Icon name="pencil" size={12} /></span>, name: 'Pencil', meaning: 'Changed since export' }
]

function IconLegendDialog({ close }: { close: () => void }) {
  return (
    <Dialog title="Icon legend" wide onClose={close} sub="What the small icons on thumbnails mean. Each can be switched on or off in View › Thumbnails. Hover any icon on a thumbnail for details."
      foot={<><button className="btn ghost left" onClick={() => { close(); useAppStore.getState().openDialog('thumbs') }}>Choose which icons show…</button><button className="btn primary" onClick={close}>Close</button></>}>
      <div className="legend-grid">
        {ICON_LEGEND.flatMap((r) => [
          <div key={r.name + 'i'} className="legend-icon"><span className="badge">{r.icon}</span></div>,
          <div key={r.name + 'n'} className="legend-name">{r.name}</div>,
          <div key={r.name + 'm'} className="muted">{r.meaning}</div>
        ])}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>Stars sit at the right of the first footer line. The selection tick sits top-right. Every tile uses the same positions, so a grid can be scanned at a glance.</div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- thumbnail display options

function ThumbsDialog({ close }: { close: () => void }) {
  const ui = useAppStore((s) => s.ui)
  const setUi = useAppStore((s) => s.setUi)
  const trees = useAppStore((s) => s.trees)
  const facetLines: [string, string][] = visibleTrees({ trees }).filter((t) => t.key !== 'location').map((t) => [`h:${t.key}`, `${t.name} entries`])
  const options = [...FOOTER_OPTIONS, ...facetLines]
  const line = (i: number) => ui.footer[i] ?? ''
  const setLine = (i: number, v: string): void => {
    const f = [line(0), line(1), line(2)]
    f[i] = v
    setUi({ footer: f.filter(Boolean) })
  }
  const toggle = (k: string): void => setUi({ icons: ui.icons.includes(k) ? ui.icons.filter((x) => x !== k) : [...ui.icons, k] })
  return (
    <Dialog title="Thumbnail display" wide onClose={close} sub="Changes apply at once and are remembered."
      foot={<><button className="btn ghost left" onClick={() => { close(); useAppStore.getState().openDialog('legend') }}>Icon legend…</button><button className="btn primary" onClick={close}>Done</button></>}>
      <div>
        <div className="label">Presets</div>
        <div className="row">
          {Object.entries(THUMB_PRESETS).map(([k, p]) => <button key={k} className="btn small" onClick={() => cmd.applyThumbPreset(k)}>{p.label}</button>)}
        </div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 22 }}>
        <div className="grow col">
          <div className="label" style={{ marginBottom: 0 }}>Footer lines <span className="hint">up to three, in order</span></div>
          {[0, 1, 2].map((i) => (
            <select key={i} className="select" value={line(i)} disabled={i > ui.footer.length} onChange={(e) => setLine(i, e.target.value)}>
              <option value="">{i === 0 ? 'No footer' : 'None'}</option>
              {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          ))}
          <div>
            <div className="label">Size</div>
            <input className="slider" style={{ width: '100%' }} type="range" min={0} max={6} value={ui.thumbSize} onChange={(e) => setUi({ thumbSize: Number(e.target.value) })} />
          </div>
        </div>
        <div className="grow">
          <div className="label">Icons</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            {ICON_OPTIONS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={ui.icons.includes(k)} onChange={() => toggle(k)} />{l}</label>)}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- glossary and workflow

const GLOSSARY: [string, string][] = [
  ['Library', 'One Facets database folder (Name.facetslib) with thumbnails, backups and logs.'],
  ['Photo', 'One imported JPEG. A second edit of the same RAW is its own Photo (a variant).'],
  ['Raw key', 'The file name without its extension, e.g. 20130115-GZ3A7589. The bridge to the RAW and to Filter. Never published.'],
  ['Photo ID', 'The permanent public identity, e.g. ASHW-00001. Issued once a Photo is in a Shoot. Never reused.'],
  ['Set', 'A named working selection of Photos. Imports make one. Not provenance, editorial meaning or publication.'],
  ['Shoot', 'A real-world capture outing, with a permanent four-character code. A Photo has at most one Shoot.'],
  ['Series', 'An editorial collection with one primary purpose; may span Shoots. Has its own Series ID (SER-000014).'],
  ['Facet', 'One of five classification dimensions: Subject, Activity, Event, People, Theme. Each has its own keyword tree.'],
  ['Location', 'A separate, optional geographic system: place tree, positions and a location state. Not a Facet.'],
  ['Domain', 'Public (may be published), Private (never leaves the library) or Internal (provisional until promoted).'],
  ['Palette', 'A saved group of keyword buttons for fast adding and removing on the selection (stage 5).'],
  ['Operation', 'One recorded action. Every change is one operation and one undo step.']
]

function GlossaryDialog({ close }: { close: () => void }) {
  return (
    <Dialog title="Glossary" wide onClose={close} foot={<button className="btn primary" onClick={close}>Close</button>}>
      <div className="kv" style={{ gridTemplateColumns: '110px 1fr', fontSize: 12.5 }}>
        {GLOSSARY.flatMap(([k, v]) => [<div key={k}><b style={{ color: 'var(--text)' }}>{k}</b></div>, <div key={k + 'v'} style={{ whiteSpace: 'normal' }}>{v}</div>])}
      </div>
    </Dialog>
  )
}

function WorkflowDialog({ close }: { close: () => void }) {
  const steps: [string, string][] = [
    ['Import', 'Import a folder of exported JPEGs (Ctrl+I). An import Set is made automatically.'],
    ['Work in a Set', 'Pick the Set you are working on in the navigator.'],
    ['Shoots', 'Group photos into Shoots (Ctrl+N) and assign Photo IDs.'],
    ['Locate', 'Correct positions in the Locate tab, assign places, or set a location state.'],
    ['Classify', 'Add Facet keywords in the Classify tab. Lightroom keywords arrive as Internal tags to review.'],
    ['Editorialise', 'Build Series with a Primary Facet, narrative and cover (stage 3).'],
    ['Verify and publish', 'Resolve gaps and privacy, mark items Ready, and publish JSON to your sites (stage 7).']
  ]
  return (
    <Dialog title="Workflow guide" onClose={close} sub="Filter culls the RAWs, Lightroom develops and exports, Facets organises and publishes." foot={<button className="btn primary" onClick={close}>Close</button>}>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map(([t, d]) => <li key={t}><b>{t}.</b> <span className="muted">{d}</span></li>)}
      </ol>
    </Dialog>
  )
}
