// The Series workspace (requirements 24.3): all Series by Primary Facet, as cards, with the full editor.
import { useMemo, useState } from 'react'
import type { Series } from '@shared/types'
import { seriesLabel } from '@shared/shortname'
import { thumbUrl } from '../api'
import { useStore } from '../store'
import { pathLabel, useCtx, visibleTrees } from '../logic'
import { Icon, facetColor, treeIcon } from './Icon'
import { SeriesEditor } from './SeriesEditor'
import { seriesMenu } from './Navigator'
import { openMenu } from './ui'
import * as cmd from '../commands'

export function SeriesWorkspace() {
  const series = useStore((s) => s.series)
  const byId = useStore((s) => s.byId)
  const ctx = useCtx()
  const [chosen, setChosen] = useState<number | null>(series[0]?.id ?? null)
  const [q, setQ] = useState('')
  const facets = visibleTrees(ctx).filter((t) => t.kind === 'facet')
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return series
    return series.filter((s) =>
      [s.title, s.shortName, s.publicId, s.summary, s.narrative].some((x) => x.toLowerCase().includes(t)) ||
      [s.primaryNodeId, ...s.supporting].some((id) => { const n = id !== null ? ctx.nodeById.get(id) : undefined; return !!n && (n.label.toLowerCase().includes(t) || n.aliases.some((a) => a.toLowerCase().includes(t))) })
    )
  }, [series, q, ctx])
  const groups: { key: string; name: string; color?: string; icon: string; list: Series[] }[] = [
    ...facets.map((t) => ({ key: t.key, name: t.name, color: facetColor(t.key), icon: treeIcon(t.key), list: shown.filter((s) => s.primaryNodeId !== null && ctx.nodeById.get(s.primaryNodeId)?.treeId === t.id) })),
    { key: 'none', name: 'No Primary Facet yet', icon: 'series', list: shown.filter((s) => s.primaryNodeId === null) }
  ]
  const current = chosen !== null && series.some((s) => s.id === chosen) ? chosen : null
  return (
    <div className="main">
      <div className="grow series-ws">
        <div className="toolbar">
          <div className="crumbs"><b>Series</b><span className="n">{series.length}</span></div>
          <div className="search">
            <Icon name="search" size={15} />
            <input className="field" placeholder="Search titles, summaries, keywords, IDs…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn small primary" onClick={cmd.newSeries} title="Select photos in the Library first (Ctrl+Shift+N)"><Icon name="plus" size={13} />New Series from selection</button>
        </div>
        <div className="viewport" style={{ padding: '6px 16px 24px' }}>
          {series.length === 0 && (
            <div className="empty" style={{ marginTop: 80, textAlign: 'center' }}>
              <div style={{ color: 'var(--accent)', marginBottom: 12 }}><Icon name="series" size={34} stroke={1.2} /></div>
              <div style={{ fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>No Series yet</div>
              In the Library, select the photos of one editorial story, then press Ctrl+Shift+N.
            </div>
          )}
          {groups.filter((g) => g.list.length).map((g) => (
            <div key={g.key} className="sw-group">
              <div className="sw-head"><span style={{ color: g.color, display: 'grid' }}><Icon name={g.icon} size={16} /></span>{g.name}<span className="n">{g.list.length}</span></div>
              <div className="sw-cards">
                {g.list.map((s) => {
                  const cover = s.coverPhotoId !== null ? byId.get(s.coverPhotoId) : undefined
                  const url = cover ? thumbUrl(cover.id, cover.thumbVer) : null
                  return (
                    <div key={s.id} className={'sw-card' + (current === s.id ? ' on' : '')} onClick={() => setChosen(s.id)} onDoubleClick={() => cmd.editSeries(s.id, true)}
                      onContextMenu={(e) => openMenu(e, seriesMenu(s))}>
                      <div className="sw-img">{url ? <img src={url} alt="" /> : <div className="ph" />}
                        {s.privacy === 'private' && <span className="badge private" title="Private Series"><Icon name="lock" size={11} /></span>}
                      </div>
                      <div className="sw-meta">
                        <div className="t1">{s.title}</div>
                        <div className="t2">{seriesLabel(s)} · {s.members.length} photos · {s.status}</div>
                        {s.primaryNodeId !== null && <div className="t2" title={pathLabel(s.primaryNodeId, ctx.nodeById)}>{ctx.nodeById.get(s.primaryNodeId)?.label}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel insp" style={{ width: 420, marginLeft: 6 }}>
        {current !== null ? (
          <>
            <div className="target-strip series plain"><span>{(() => { const x = series.find((s) => s.id === current); return x ? seriesLabel(x) : '' })()}</span>
              <button className="linkbtn" onClick={() => cmd.editSeries(current, true)}>Show its photos</button></div>
            <div className="insp-body" key={current}><SeriesEditor id={current} /></div>
          </>
        ) : <div className="insp-body muted" style={{ justifyContent: 'center', textAlign: 'center' }}>Choose a Series to edit it.</div>}
      </div>
    </div>
  )
}
