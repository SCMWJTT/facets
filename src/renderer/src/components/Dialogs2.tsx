// Dialogs added in stages 2 and 3: New Series, Apply Series keywords, Propose Shoots,
// tree-file import preview, tidy-up report, new Facet (guarded) and re-read embedded metadata.
import { useEffect, useState } from 'react'
import type { OverlapWarning, ShootProposal, TaxonomyPreview, TidyReport, Tree } from '@shared/types'
import { act, call } from '../api'
import { useStore } from '../store'
import { fmtCaptured, pathLabel, useCtx, visibleTrees } from '../logic'
import { Dialog } from './ui'
import { Icon, facetColor, treeIcon } from './Icon'
import { openPicker } from './NodePicker'
import * as cmd from '../commands'

// ---------------------------------------------------------------- New Series

export function NewSeriesDialog({ close, ids }: { close: () => void; ids: number[] }) {
  const ctx = useCtx()
  const facets = visibleTrees(ctx).filter((t) => t.kind === 'facet')
  const [title, setTitle] = useState('')
  const [facet, setFacet] = useState<Tree | null>(null)
  const [node, setNode] = useState<number | null>(null)
  const [rationale, setRationale] = useState('')
  const [summary, setSummary] = useState('')
  const [warn, setWarn] = useState<OverlapWarning[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => void call<OverlapWarning[]>('seriesOverlap', { photoIds: ids, primaryNodeId: node, title }).then(setWarn), 250)
    return () => clearTimeout(t)
  }, [ids, node, title])
  const titleClash = ctx.series ? [...ctx.series.values()].find((s) => s.title.toLowerCase() === title.trim().toLowerCase()) : undefined
  const pick = (el: HTMLElement, t: Tree): void => {
    setFacet(t)
    openPicker(el, t, (nid) => setNode(nid), async (labels) => {
      const r = await act('createPath', t.id, labels, [])
      const nid = r?.data as number | undefined
      if (nid) setNode(nid)
    })
  }
  const nodeTree = node !== null ? ctx.trees.find((t) => t.id === ctx.nodeById.get(node)?.treeId) : undefined
  const isTheme = nodeTree?.key === 'theme'
  const ok = !!title.trim() && !titleClash && (!isTheme || !!rationale.trim())
  const create = async (): Promise<void> => {
    setBusy(true)
    const r = await act('createSeries', { title: title.trim(), primaryNodeId: node, themeRationale: rationale, summary, photoIds: ids })
    setBusy(false)
    if (r?.ok) {
      close()
      cmd.editSeries(r.data as number, false)
    }
  }
  return (
    <Dialog title="New Series" onClose={close} wide sub={`From ${ids.length} selected photo${ids.length === 1 ? '' : 's'}. A Series is an editorial collection with one main purpose; it may use photos from several Shoots and gets its own permanent Series ID.`}
      foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!ok || busy} onClick={() => void create()}>{warn.length ? 'Create anyway' : 'Create Series'}</button></>}>
      <div>
        <div className="label">Title <span className="hint">unique among active Series</span></div>
        <input className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Richard's Bake and Shark — Ash Wednesday 2026" onKeyDown={(e) => e.key === 'Enter' && ok && void create()} />
        {titleClash && <div className="err">Another Series ({titleClash.publicId}) already has this title. Add a year or a place to tell them apart.</div>}
      </div>
      <div>
        <div className="label">Primary Facet and keyword <span className="hint">can be chosen later</span></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>“This Series exists mainly to document ___.” A thing → Subject. An action → Activity. A named occasion → Event. A person or group → People. An idea → Theme.</div>
        <div className="facet-pick">
          {facets.map((t) => (
            <button key={t.id} className={facet?.id === t.id ? 'on' : ''} style={{ color: facet?.id === t.id ? facetColor(t.key) : undefined }} title={t.definition} onClick={(e) => pick(e.currentTarget, t)}>
              <Icon name={treeIcon(t.key)} size={14} />{t.name}
            </button>
          ))}
        </div>
        {node !== null && (
          <div className="chips" style={{ marginTop: 8 }}>
            <span className="chip">{pathLabel(node, ctx.nodeById)}<button className="x" onClick={() => { setNode(null); setFacet(null) }}><Icon name="x" size={10} stroke={2.2} /></button></span>
          </div>
        )}
      </div>
      {isTheme && (
        <div>
          <div className="label">Theme rationale <span className="hint">required for Theme</span></div>
          <textarea className="field" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="One or two sentences on why these photos express this idea." />
        </div>
      )}
      <div>
        <div className="label">Summary <span className="hint">optional now; {summary.length} of 240</span></div>
        <textarea className="field" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      {warn.length > 0 && (
        <div className="warnbox">
          <Icon name="alert" size={14} />
          <div>
            This would largely repeat {warn.map((x, i) => <span key={x.seriesId}>{i ? ', ' : ''}<b>{x.title}</b> ({x.publicId}: {x.pct}% of these photos, {x.reason})</span>)}.
            One Series per purpose is best; you may still create it if the purpose differs.
          </div>
        </div>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------- Apply Series keywords

export function ApplySeriesDialog({ close, id }: { close: () => void; id: number }) {
  const ctx = useCtx()
  const s = useStore((st) => st.series.find((x) => x.id === id))
  const nodes = s ? [...(s.primaryNodeId !== null ? [s.primaryNodeId] : []), ...s.supporting] : []
  const [chosen, setChosen] = useState<Set<number>>(new Set(nodes))
  const byId = useStore((st) => st.byId)
  if (!s) return null
  const counts = (nid: number): number => s.members.filter((m) => byId.get(m)?.nodes.includes(nid)).length
  return (
    <Dialog title="Apply Series keywords to member photos" onClose={close}
      sub={`“${s.title}” has ${s.members.length} member photos. Series keywords never reach photos silently: tick the ones to add to every member. This is one step you can undo.`}
      foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!chosen.size} onClick={async () => { await act('applySeriesKeywords', id, [...chosen]); close() }}>Apply {chosen.size} keyword{chosen.size === 1 ? '' : 's'}</button></>}>
      {nodes.length === 0 ? <div className="muted">This Series has no primary or supporting keywords yet.</div> : nodes.map((nid) => {
        const n = ctx.nodeById.get(nid)
        const t = n ? ctx.trees.find((x) => x.id === n.treeId) : undefined
        const have = counts(nid)
        return (
          <label key={nid} className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={chosen.has(nid)} onChange={(e) => { const c = new Set(chosen); if (e.target.checked) c.add(nid); else c.delete(nid); setChosen(c) }} />
            <span style={{ color: t ? facetColor(t.key) : undefined, display: 'grid' }}><Icon name={t ? treeIcon(t.key, t.icon) : 'tag'} size={13} /></span>
            <span>{pathLabel(nid, ctx.nodeById)}{nid === s.primaryNodeId && <span className="muted"> · primary</span>}<span className="muted"> · already on {have} of {s.members.length}</span></span>
          </label>
        )
      })}
    </Dialog>
  )
}

// ---------------------------------------------------------------- Propose Shoots

interface Row extends ShootProposal {
  name: string
  code: string
  accept: boolean
}

export function ProposeShootsDialog({ close, ids }: { close: () => void; ids: number[] }) {
  const [gap, setGap] = useState(4)
  const [jump, setJump] = useState(25)
  const [rows, setRows] = useState<Row[]>([])
  const [codes, setCodes] = useState<Record<number, boolean>>({})
  useEffect(() => {
    const t = setTimeout(async () => {
      const props = await call<ShootProposal[]>('proposeShoots', ids, gap, jump)
      const out: Row[] = []
      for (const p of props) out.push({ ...p, name: p.suggestedName, code: await call<string>('proposeCode', p.suggestedName), accept: true })
      // Codes proposed one by one may repeat; make them distinct in the dialog.
      const seen = new Set<string>()
      for (const r of out) {
        let c = r.code
        let i = 2
        while (seen.has(c)) c = (r.code.slice(0, 3) + String(i++)).slice(0, 4)
        r.code = c
        seen.add(c)
      }
      setRows(out)
    }, 200)
    return () => clearTimeout(t)
  }, [ids, gap, jump])
  useEffect(() => {
    void (async () => {
      const m: Record<number, boolean> = {}
      for (let i = 0; i < rows.length; i++) m[i] = /^[A-Z0-9]{4}$/.test(rows[i].code) && (await call<boolean>('codeFree', rows[i].code))
      setCodes(m)
    })()
  }, [rows])
  const up = (i: number, p: Partial<Row>): void => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const merge = (i: number): void => {
    if (i === 0) return
    const a = rows[i - 1]
    const b = rows[i]
    const m: Row = { ...a, ids: [...a.ids, ...b.ids], end: b.end ?? a.end, withGps: a.withGps + b.withGps, noTime: a.noTime + b.noTime }
    setRows([...rows.slice(0, i - 1), m, ...rows.slice(i + 1)])
  }
  const accepted = rows.filter((r) => r.accept)
  const dupCodes = new Set(accepted.map((r) => r.code)).size !== accepted.length
  const valid = accepted.length > 0 && !dupCodes && accepted.every((r) => r.name.trim() && codes[rows.indexOf(r)])
  const total = rows.reduce((a, r) => a + r.ids.length, 0)
  return (
    <Dialog title="Propose Shoots" wide onClose={close}
      sub={`From ${total} photo${total === 1 ? '' : 's'} not yet in a Shoot, sorted by capture time. The thresholds are only suggestions. Nothing is created until you choose Create.`}
      foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!valid} onClick={async () => { const r = await act('createShoots', accepted.map((x) => ({ name: x.name.trim(), code: x.code, ids: x.ids }))); if (r?.ok) close() }}>Create {accepted.length} Shoot{accepted.length === 1 ? '' : 's'}</button></>}>
      <div className="row" style={{ gap: 16 }}>
        <label className="row" style={{ gap: 6 }}>Split when photos are more than <input className="field" type="number" min={0.25} step={0.25} style={{ width: 70 }} value={gap} onChange={(e) => setGap(Number(e.target.value) || 4)} /> hours apart</label>
        <label className="row" style={{ gap: 6 }}>or the position jumps more than <input className="field" type="number" min={0} step={5} style={{ width: 70 }} value={jump} onChange={(e) => setJump(Number(e.target.value) || 0)} /> km</label>
      </div>
      {rows.length === 0 ? <div className="muted">No photos without a Shoot in this scope.</div> : (
        <div className="proposals">
          {rows.map((r, i) => (
            <div key={i} className={'prop' + (r.accept ? '' : ' off')}>
              <input type="checkbox" checked={r.accept} onChange={(e) => up(i, { accept: e.target.checked })} title="Accept this proposal" />
              <input className="field" style={{ flex: 1, minWidth: 200 }} value={r.name} onChange={(e) => up(i, { name: e.target.value })} />
              <input className={'field mono' + (codes[i] === false ? ' bad' : '')} style={{ width: 70 }} maxLength={4} value={r.code} onChange={(e) => up(i, { code: e.target.value.toUpperCase() })} title={codes[i] === false ? 'This code is taken or invalid' : 'Shoot code (four capital letters or digits, permanent)'} />
              <span className="muted" style={{ width: 190, fontSize: 11.5, lineHeight: 1.35 }}>{r.ids.length} photos<br />{r.start ? `${fmtCaptured(r.start)}${r.end && r.end !== r.start ? ' →' : ''}` : 'no capture time'}</span>
              <span className="muted" style={{ width: 120, fontSize: 12 }}>{r.withGps} with GPS{r.noTime ? ` · ${r.noTime} undated` : ''}</span>
              <button className="btn small ghost" disabled={i === 0} onClick={() => merge(i)} title="Merge with the proposal above">Merge ↑</button>
              <button className="btn small ghost" onClick={() => { const st = useStore.getState(); st.setSource({ kind: 'selection', ids: r.ids }) }} title="Show these photos">Show</button>
            </div>
          ))}
        </div>
      )}
      {dupCodes && <div className="err">Two accepted proposals have the same code.</div>}
    </Dialog>
  )
}

// ---------------------------------------------------------------- tree file import (preview first)

export function TaxonomyImportDialog({ close, file, preview }: { close: () => void; file: string; preview: TaxonomyPreview }) {
  const totalNew = preview.trees.reduce((a, t) => a + t.newNodes, 0)
  const totalUpd = preview.trees.reduce((a, t) => a + t.updated, 0)
  return (
    <Dialog title="Import a tree file" wide onClose={close} sub={<span className="mono" style={{ fontSize: 11.5 }}>{file}</span>}
      foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!totalNew && !totalUpd && !preview.xrefs} onClick={async () => { await act('applyTaxonomyFile', file); close() }}>Import</button></>}>
      <div className="muted" style={{ fontSize: 12.5 }}>Entries are matched by their ID, then by name or alias under the same parent. Existing entries keep their IDs, assignments and text; only missing aliases, short codes, descriptions and references are added. Nothing changes until you choose Import, and it can be undone.</div>
      <table className="mini">
        <thead><tr><th>Tree</th><th>In this library</th><th>New entries</th><th>Matched</th><th>Updated</th></tr></thead>
        <tbody>
          {preview.trees.map((t) => (
            <tr key={t.key}><td>{t.name}</td><td>{t.exists ? 'Yes' : 'Will be created'}</td><td>{t.newNodes}</td><td>{t.matched}</td><td>{t.updated}</td></tr>
          ))}
        </tbody>
      </table>
      <div>{preview.xrefs} new cross-reference{preview.xrefs === 1 ? '' : 's'}.</div>
      {preview.problems.map((p, i) => <div key={i} className="err">{p}</div>)}
      {!totalNew && !totalUpd && !preview.xrefs && <div className="muted">Everything in this file is already in the library.</div>}
    </Dialog>
  )
}

// ---------------------------------------------------------------- tidy-up report

export function TidyDialog({ close, treeId }: { close: () => void; treeId: number }) {
  const [r, setR] = useState<TidyReport | null>(null)
  const nodes = useStore((s) => s.nodes)
  const tree = useStore((s) => s.trees.find((t) => t.id === treeId))
  useEffect(() => { void call<TidyReport>('tidyReport', treeId).then(setR) }, [treeId, nodes])
  const open = (id: number): void => { useStore.getState().set({ workspace: 'hierarchies', explorerTree: treeId, explorerNode: id }); close() }
  return (
    <Dialog title={`Tidy-up report · ${tree?.name ?? ''}`} wide onClose={close} foot={<button className="btn primary" onClick={close}>Close</button>}>
      {!r ? <div className="muted">Checking…</div> : (
        <>
          <div className="hsec">
            <div className="hname">Similar names <span className="meta">{r.similar.length} group{r.similar.length === 1 ? '' : 's'}; consider merging</span></div>
            {r.similar.length === 0 ? <div className="muted">None.</div> : r.similar.map((g, i) => (
              <div key={i} className="tidy-row">{g.paths.map((p, j) => <button key={j} className="linkbtn" onClick={() => open(g.ids[j])}>{p}</button>)}</div>
            ))}
          </div>
          <div className="hsec">
            <div className="hname">Unused entries <span className="meta">{r.unused.length}; not on any photo or Series</span></div>
            {r.unused.length === 0 ? <div className="muted">None.</div> : (
              <div className="tidy-list">{r.unused.slice(0, 400).map((u) => <button key={u.id} className="linkbtn" onClick={() => open(u.id)}>{u.path}</button>)}</div>
            )}
          </div>
        </>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------- a sixth Facet (guarded)

export function NewFacetDialog({ close }: { close: () => void }) {
  const [name, setName] = useState('')
  const [definition, setDefinition] = useState('')
  const [sure, setSure] = useState(false)
  const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return (
    <Dialog title="Add a Facet (advanced)" onClose={close}
      sub="The five Facets (Subject, Activity, Event, People, Theme) are meant to cover every Series. A sixth Facet appears everywhere — the navigator, Classify, Series homes and exports — and cannot be removed once used."
      foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn danger" disabled={!sure || !key || !definition.trim()} onClick={async () => { const r = await act('createFacet', { key, name: name.trim(), multi: true, definition: definition.trim() }); if (r?.ok) close() }}>Add Facet</button></>}>
      <div><div className="label">Name</div><input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
      <div><div className="label">Defining question</div><input className="field" value={definition} onChange={(e) => setDefinition(e.target.value)} placeholder="e.g. Which technique was used?" /></div>
      <div className="muted mono" style={{ fontSize: 11.5 }}>key: {key || '—'}</div>
      <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />I have checked that none of the existing five Facets fits.</label>
    </Dialog>
  )
}

// ---------------------------------------------------------------- re-read embedded metadata

const REREAD: [string, string][] = [
  ['title', 'Title'], ['caption', 'Caption (headline)'], ['note', 'Note (description)'], ['alt', 'Alt text'], ['rating', 'Rating'],
  ['creator', 'Creator'], ['copyright', 'Copyright'], ['captured', 'Capture time'], ['position', 'Camera position (GPS)'], ['keywords', 'Keywords (added as Internal tags)']
]

export function RereadDialog({ close, ids }: { close: () => void; ids: number[] }) {
  const [fields, setFields] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  return (
    <Dialog title="Re-read embedded metadata" onClose={close}
      sub={`Reads the files of ${ids.length} selected photo${ids.length === 1 ? '' : 's'} again and replaces only the fields you tick. The files are never changed. One step you can undo.`}
      foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!fields.size || busy} onClick={async () => { setBusy(true); await act('rereadMetadata', ids, [...fields]); setBusy(false); close() }}>{busy ? 'Reading…' : 'Re-read'}</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px' }}>
        {REREAD.map(([k, l]) => (
          <label key={k} className="check"><input type="checkbox" checked={fields.has(k)} onChange={(e) => { const f = new Set(fields); if (e.target.checked) f.add(k); else f.delete(k); setFields(f) }} />{l}</label>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>Positions you moved by hand are kept; only the camera position is refreshed for them.</div>
    </Dialog>
  )
}

/** Helper for the menus: preview a tree file, then show the import dialog. */
export async function startTaxonomyImport(): Promise<void> {
  try {
    const r = await call<{ file: string; preview: TaxonomyPreview } | null>('previewTaxonomyFile')
    if (r) useStore.getState().openDialog('taxonomyImport', r)
  } catch (e) {
    useStore.getState().toast((e as Error).message, 'error')
  }
}
