// The Series editor (requirements 11.4): separate from the photo Describe tab.
// Used in the inspector when a Series is the editing target, and in the Series workspace.
import { useEffect, useMemo, useState } from 'react'
import type { OverlapWarning, PhotoRow, Series } from '@shared/types'
import { act, call, thumbUrl } from '../api'
import { useStore } from '../store'
import { fmtCaptured, pathLabel, useCtx, visibleTrees, type Ctx } from '../logic'
import { Icon, facetColor, treeIcon } from './Icon'
import { openPicker } from './NodePicker'
import { Commit } from './Inspector'
import { confirm, openMenuAt } from './ui'
import * as cmd from '../commands'
import { SHORT_MAX, seriesLabel, seriesNumber } from '@shared/shortname'

export function SeriesEditor({ id, compact = false }: { id: number; compact?: boolean }) {
  const s = useStore((st) => st.series.find((x) => x.id === id))
  const byId = useStore((st) => st.byId)
  const ctx = useCtx()
  if (!s) return <div className="muted" style={{ padding: 16 }}>This Series no longer exists (it may have been retired or undone).</div>
  const members = s.members.map((m) => byId.get(m)).filter((p): p is PhotoRow => !!p)
  return (
    <div className="series-editor col">
      <Header s={s} />
      <Primary s={s} ctx={ctx} />
      <Commit label={`Summary ${s.summary.length > 240 ? `(${s.summary.length} of 240 — consider trimming)` : `(${s.summary.length} of 240)`}`} value={s.summary} multiline rows={3}
        onCommit={(v) => void act('updateSeries', s.id, { summary: v })} />
      <Commit label="Narrative (paragraphs; *italic*, **bold**, # headings, links)" value={s.narrative} multiline rows={compact ? 6 : 10}
        onCommit={(v) => void act('updateSeries', s.id, { narrative: v })} />
      <Members s={s} members={members} ctx={ctx} />
      <Supporting s={s} ctx={ctx} />
      <Places s={s} ctx={ctx} />
      <Derived s={s} members={members} ctx={ctx} />
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow"><Commit label="Write-up reference (link or article ID on the website)" value={s.writeup} onCommit={(v) => void act('updateSeries', s.id, { writeup: v })} /></div>
      </div>
      <Commit label="Sources (for fact checking)" value={s.sources} multiline rows={2} onCommit={(v) => void act('updateSeries', s.id, { sources: v })} />
      <Overlap s={s} />
      <Readiness s={s} />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn small" onClick={() => useStore.getState().openDialog('applySeries', { id: s.id })}><Icon name="tag" size={13} />Apply Series keywords to members…</button>
        <button className="btn small ghost" onClick={async () => {
          if (await confirm(`Retire "${s.title}"?`, `Its ID ${s.publicId} is kept in the registry and never reused. The photos are not affected. You can undo this.`, 'Retire', true)) {
            await act('retireSeries', s.id)
            useStore.getState().set({ seriesTarget: null })
          }
        }}><Icon name="trash" size={13} />Retire</button>
      </div>
      <SeriesHistory id={s.id} />
    </div>
  )
}

function Header({ s }: { s: Series }) {
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <span className="ser-head"><span className="mono">SER-{seriesNumber(s.publicId)}</span>{s.shortName}</span>
        <span className="grow" />
        <select className="select" style={{ width: 120 }} value={s.status} onChange={(e) => void act('updateSeries', s.id, { status: e.target.value as Series['status'] })} title="Lifecycle status">
          {['draft', 'ready', 'published', 'withdrawn'].map((v) => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
        </select>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ width: 130 }}><Commit label={`Short name (max ${SHORT_MAX})`} value={s.shortName} onCommit={(v) => void act('updateSeries', s.id, { shortName: v })} /></div>
        <div className="grow"><Commit label="Title (unique)" value={s.title} onCommit={(v) => void act('updateSeries', s.id, { title: v })} /></div>
      </div>
      <div className="muted mono" style={{ fontSize: 11, marginTop: -6 }}>Series ID {s.publicId} (never changes)</div>
      <div className="muted mono" style={{ fontSize: 11, marginTop: -6 }}>slug: {s.slug}{s.slugFrozen ? ' (frozen at publication)' : ' (follows the title until first published)'}</div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="label">Privacy</div>
          <div className="seg">
            {(['private', 'public', 'internal'] as const).map((v) => (
              <button key={v} className={s.privacy === v ? 'on' : ''} onClick={() => void act('updateSeries', s.id, { privacy: v })}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
            ))}
          </div>
        </div>
        <label className="check" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={s.verified} onChange={(e) => void act('updateSeries', s.id, { verified: e.target.checked })} />Verified</label>
      </div>
    </>
  )
}

function Primary({ s, ctx }: { s: Series; ctx: Ctx }) {
  const facets = visibleTrees(ctx).filter((t) => t.kind === 'facet')
  const node = s.primaryNodeId !== null ? ctx.nodeById.get(s.primaryNodeId) : undefined
  const tree = node ? ctx.trees.find((t) => t.id === node.treeId) : undefined
  const choose = (el: HTMLElement, t: (typeof facets)[number]): void =>
    openPicker(el, t, (nid) => void act('updateSeries', s.id, { primaryNodeId: nid }), async (labels) => {
      const r = await act('createPath', t.id, labels, [])
      const nid = (r?.data as number | undefined) ?? null
      if (nid) void act('updateSeries', s.id, { primaryNodeId: nid })
    })
  return (
    <div className="hsec">
      <div className="hname">Primary Facet <span className="meta">exactly one</span></div>
      <div className="facet-pick">
        {facets.map((t) => (
          <button key={t.id} className={tree?.id === t.id ? 'on' : ''} style={{ color: tree?.id === t.id ? facetColor(t.key) : undefined }} title={t.definition}
            onClick={(e) => choose(e.currentTarget, t)}>
            <Icon name={treeIcon(t.key)} size={14} />{t.name}
          </button>
        ))}
      </div>
      {node ? (
        <div className="chips" style={{ marginTop: 8 }}>
          <span className="chip" title="Primary keyword"><span className="path">{pathLabel(node.id, ctx.nodeById).split(' › ').slice(0, -1).join(' › ')}{node.parentId ? ' ›' : ''}</span>{node.label}</span>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>“This Series exists mainly to document ___.” A thing → Subject; an action → Activity; a named occasion → Event; a person or group → People; an idea → Theme. Choose the deepest accurate entry.</div>
      )}
      {tree?.key === 'theme' && (
        <div style={{ marginTop: 8 }}><Commit label="Theme rationale (required for Theme)" value={s.themeRationale} multiline rows={2} onCommit={(v) => void act('updateSeries', s.id, { themeRationale: v })} /></div>
      )}
    </div>
  )
}

function Supporting({ s, ctx }: { s: Series; ctx: Ctx }) {
  const trees = visibleTrees(ctx).filter((t) => t.kind !== 'location')
  const add = (el: HTMLElement): void =>
    openMenuAt(el, [
      { head: 'Add a supporting keyword from…' },
      ...trees.map((t) => ({
        label: t.name,
        icon: treeIcon(t.key, t.icon),
        onClick: () =>
          openPicker(el, t, (nid) => void act('setSeriesSupporting', s.id, nid, true), async (labels) => {
            const r = await act('createPath', t.id, labels, [])
            const nid = r?.data as number | undefined
            if (nid) void act('setSeriesSupporting', s.id, nid, true)
          })
      }))
    ])
  return (
    <div className="hsec">
      <div className="hname">Supporting keywords <span className="meta">any Facet; Series metadata only</span><span className="grow" />
        <button className="btn small ghost" onClick={(e) => add(e.currentTarget)}><Icon name="plus" size={13} /> Add</button>
      </div>
      {s.supporting.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>None. These describe the Series; they reach member photos only through “Apply Series keywords”.</div> : (
        <div className="chips">
          {s.supporting.map((nid) => {
            const n = ctx.nodeById.get(nid)
            const t = n ? ctx.trees.find((x) => x.id === n.treeId) : undefined
            return (
              <span key={nid} className="chip" title={pathLabel(nid, ctx.nodeById)}>
                {t && <span style={{ color: facetColor(t.key), display: 'grid' }}><Icon name={treeIcon(t.key, t.icon)} size={11} /></span>}
                {n?.label ?? '?'}
                <button className="x" title="Remove" onClick={() => void act('setSeriesSupporting', s.id, nid, false)}><Icon name="x" size={10} stroke={2.2} /></button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Places({ s, ctx }: { s: Series; ctx: Ctx }) {
  const loc = ctx.trees.find((t) => t.kind === 'location')
  return (
    <div className="hsec">
      <div className="hname">Places <span className="meta">optional; may be absent or hidden</span><span className="grow" />
        {loc && <button className="btn small ghost" onClick={(e) => openPicker(e.currentTarget, loc, (nid) => void act('setSeriesPlace', s.id, nid, true), async (labels) => {
          const r = await act('createPath', loc.id, labels, [])
          const nid = r?.data as number | undefined
          if (nid) void act('setSeriesPlace', s.id, nid, true)
        })}><Icon name="plus" size={13} /> Add</button>}
      </div>
      {s.places.length > 0 && (
        <div className="chips" style={{ marginBottom: 8 }}>
          {s.places.map((nid) => (
            <span key={nid} className="chip" title={pathLabel(nid, ctx.nodeById)}>
              <Icon name="pin" size={11} />{ctx.nodeById.get(nid)?.label}
              <button className="x" title="Remove" onClick={() => void act('setSeriesPlace', s.id, nid, false)}><Icon name="x" size={10} stroke={2.2} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
        <div style={{ width: 92 }}><Commit label="Anchor lat" mono value={s.anchorLat?.toFixed(5) ?? ''} onCommit={(v) => void act('updateSeries', s.id, { anchorLat: v.trim() ? Number(v) : null })} /></div>
        <div style={{ width: 92 }}><Commit label="Anchor lon" mono value={s.anchorLon?.toFixed(5) ?? ''} onCommit={(v) => void act('updateSeries', s.id, { anchorLon: v.trim() ? Number(v) : null })} /></div>
        <div className="seg" title="How the anchor may be shown">
          {(['exact', 'approximate', 'hidden'] as const).map((v) => (
            <button key={v} className={s.anchorMode === v ? 'on' : ''} onClick={() => void act('updateSeries', s.id, { anchorMode: v })}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 5 }}>The anchor is where the Series sits on the Atlas (dragging it on the Map arrives with the Map workspace).</div>
    </div>
  )
}

function Members({ s, members, ctx }: { s: Series; members: PhotoRow[]; ctx: Ctx }) {
  const [drag, setDrag] = useState<number | null>(null)
  const move = (from: number, to: number): void => {
    if (from === to) return
    const order = members.map((p) => p.id)
    const [x] = order.splice(order.indexOf(from), 1)
    order.splice(order.indexOf(to), 0, x)
    void act('reorderSeries', s.id, order)
  }
  return (
    <div className="hsec">
      <div className="hname">Members <span className="meta">{members.length} photo{members.length === 1 ? '' : 's'} · {s.featured.length} featured</span><span className="grow" />
        <div className="seg" title="Member order">
          <button className={s.memberOrder === 'capture' ? 'on' : ''} onClick={() => void act('updateSeries', s.id, { memberOrder: 'capture' })}>By time</button>
          <button className={s.memberOrder === 'manual' ? 'on' : ''} onClick={() => void act('updateSeries', s.id, { memberOrder: 'manual' })} title="Drag thumbnails to set an editorial order">Manual</button>
        </div>
      </div>
      <div className="member-strip">
        {members.map((p) => {
          const u = thumbUrl(p.id, p.thumbVer)
          const featured = s.featured.includes(p.id)
          return (
            <div key={p.id} className={'mem' + (drag === p.id ? ' dragging' : '')} draggable
              onDragStart={(e) => { setDrag(p.id); e.dataTransfer.setData('text/plain', String(p.id)) }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, p.id); setDrag(null) }}
              onDragEnd={() => setDrag(null)}
              title={`${p.title || p.rawKey}${p.shootId ? ` · ${ctx.shoots.get(p.shootId)?.code}` : ''}`}
              onDoubleClick={() => { const st = useStore.getState(); st.setSource({ kind: 'series', id: s.id }); st.select([p.id], p.id) }}>
              {u ? <img src={u} alt="" draggable={false} /> : <div className="ph" />}
              {s.coverPhotoId === p.id && <span className="cover-mark" title="Cover">Cover</span>}
              <div className="mem-tools">
                <button title="Make this the cover" onClick={() => void act('updateSeries', s.id, { coverPhotoId: p.id })}><Icon name="image" size={11} /></button>
                <button className={featured ? 'on' : ''} title={featured ? 'Remove from featured' : 'Add to featured (up to 12)'} onClick={() => void act('setSeriesFeatured', s.id, p.id, !featured)}><Icon name="star" size={11} fill={featured} stroke={featured ? 0 : 1.6} /></button>
                <button title="Remove from this Series" onClick={() => void act('removeFromSeries', s.id, [p.id])}><Icon name="x" size={11} /></button>
              </div>
            </div>
          )
        })}
        <button className="mem add" title="Add the selected photos" onClick={() => { const ids = cmd.need(); if (ids) void act('addToSeries', s.id, ids) }}><Icon name="plus" size={18} /><span>Add selected</span></button>
      </div>
    </div>
  )
}

function Derived({ s, members, ctx }: { s: Series; members: PhotoRow[]; ctx: Ctx }) {
  const shoots = useMemo(() => {
    const m = new Map<number, number>()
    for (const p of members) if (p.shootId) m.set(p.shootId, (m.get(p.shootId) ?? 0) + 1)
    return [...m.entries()]
  }, [members])
  const times = members.map((p) => p.captured).filter((x): x is string => !!x).sort()
  return (
    <div className="hsec">
      <div className="hname">Shoots and dates <span className="meta">derived from the members; never stored on the Series</span></div>
      <div className="kv" style={{ gridTemplateColumns: '90px 1fr' }}>
        <div>Shoots</div>
        <div>{shoots.length ? shoots.map(([id, n]) => <span key={id} className="code" style={{ marginRight: 8 }} title={ctx.shoots.get(id)?.name}>{ctx.shoots.get(id)?.code} ({n})</span>) : '—'}</div>
        <div>Date span</div>
        <div>{times.length ? `${fmtCaptured(times[0])}${times.length > 1 ? ` – ${fmtCaptured(times[times.length - 1])}` : ''}` : '—'}</div>
      </div>
      <div style={{ marginTop: 8 }}><Commit label="Display label for dates (optional; never changes capture data)" value={s.dateLabel} onCommit={(v) => void act('updateSeries', s.id, { dateLabel: v })} /></div>
    </div>
  )
}

function Overlap({ s }: { s: Series }) {
  const [w, setW] = useState<OverlapWarning[]>([])
  const key = s.members.join(',') + '|' + s.primaryNodeId + '|' + s.title
  useEffect(() => {
    void call<OverlapWarning[]>('seriesOverlap', { photoIds: s.members, primaryNodeId: s.primaryNodeId, title: s.title, excludeId: s.id }).then(setW)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!w.length) return null
  return (
    <div className="warnbox">
      <Icon name="alert" size={14} />
      <div>
        This Series largely repeats {w.map((x, i) => <span key={x.seriesId}>{i ? ', ' : ''}<b>{x.title}</b> ({x.publicId}: {x.pct}% shared, {x.reason})</span>)}.
        A photo may be in several Series when the editorial purpose differs; otherwise consider merging them.
      </div>
    </div>
  )
}

function Readiness({ s }: { s: Series }) {
  const checks: [string, boolean][] = [
    ['Title', !!s.title.trim()],
    ['Primary keyword', s.primaryNodeId !== null],
    ['Summary', !!s.summary.trim()],
    ['Cover', s.coverPhotoId !== null],
    ['Privacy decided', true]
  ]
  return (
    <div className="hsec">
      <div className="hname">Ready to publish? <span className="meta">Series checks</span></div>
      <div className="checks">
        {checks.map(([l, ok]) => <span key={l} className={'check-item' + (ok ? ' ok' : '')}><Icon name={ok ? 'check' : 'x'} size={11} stroke={2.2} />{l}</span>)}
      </div>
    </div>
  )
}

function SeriesHistory({ id }: { id: number }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<{ at: string; label: string; field: string; oldValue: unknown; newValue: unknown; undone: boolean }[]>([])
  const series = useStore((st) => st.series)
  useEffect(() => {
    if (open) void call<typeof rows>('seriesHistory', id).then(setRows)
  }, [open, id, series])
  const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : typeof v === 'string' ? (v.length > 60 ? v.slice(0, 60) + '…' : v) : JSON.stringify(v))
  return (
    <div className="hsec">
      <div className="hname" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}><Icon name={open ? 'down' : 'right'} size={12} /> History</div>
      {open && (rows.length === 0 ? <div className="muted">No changes recorded yet.</div> : (
        <div className="hist">
          {rows.map((r, i) => (
            <div key={i} className={'h' + (r.undone ? ' undone' : '')}>
              <div className="muted" style={{ fontSize: 11 }}>{new Date(r.at).toLocaleString()} · {r.label}{r.undone ? ' (undone)' : ''}</div>
              <div><b>{r.field}</b>{r.oldValue !== null || r.newValue !== null ? <>: {show(r.oldValue)} → {show(r.newValue)}</> : null}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The inspector's Series tab when photos are the target: which Series they belong to. */
export function PhotoSeriesTab({ photos }: { photos: PhotoRow[] }) {
  const series = useStore((st) => st.series)
  const ctx = useCtx()
  const ids = photos.map((p) => p.id)
  const counts = new Map<number, number>()
  for (const p of photos) for (const sid of p.series) counts.set(sid, (counts.get(sid) ?? 0) + 1)
  const addMenu = (el: HTMLElement): void =>
    openMenuAt(el, [
      { label: 'New Series from these photos…', icon: 'plus', key: 'Ctrl+Shift+N', onClick: cmd.newSeries },
      ...(series.length ? [{ sep: true } as const, { head: 'Add to an existing Series' }] : []),
      ...series.map((x) => ({ label: `${seriesLabel(x)} · ${x.title}`, onClick: () => void act('addToSeries', x.id, ids) }))
    ])
  return (
    <>
      <div className="row"><span className="grow muted" style={{ fontSize: 12 }}>A photo may be in several Series when the editorial purpose differs.</span>
        <button className="btn small" onClick={(e) => addMenu(e.currentTarget)}><Icon name="plus" size={13} />Add to Series</button>
      </div>
      {counts.size === 0 ? <div className="muted">Not in any Series.</div> : [...counts.entries()].map(([sid, n]) => {
        const x = ctx.series.get(sid)
        if (!x) return null
        const pn = x.primaryNodeId !== null ? ctx.nodeById.get(x.primaryNodeId) : undefined
        const t = pn ? ctx.trees.find((tt) => tt.id === pn.treeId) : undefined
        return (
          <div key={sid} className="series-row">
            <span style={{ color: t ? facetColor(t.key) : 'var(--text3)', display: 'grid' }}><Icon name={t ? treeIcon(t.key) : 'series'} size={15} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="t1">{x.title}</div>
              <div className="muted" style={{ fontSize: 11 }}>{seriesLabel(x)}{pn ? ` · ${pn.label}` : ''}{n < photos.length ? ` · on ${n} of ${photos.length}` : ''}</div>
            </div>
            <button className="btn small ghost" onClick={() => cmd.editSeries(sid, false)}>Edit</button>
            <button className="iconbtn" title="Remove the selected photos from this Series" onClick={() => void act('removeFromSeries', sid, ids)}><Icon name="x" size={13} /></button>
          </div>
        )
      })}
    </>
  )
}
