import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { act } from '../api'
import { useStore, EMPTY_FILTERS, type Source } from '../store'
import { ancestors, kidsOf, pathLabel, useCtx, missingRequired, locationDecided, visibleTrees, type Ctx } from '../logic'
import type { Series, Tree } from '@shared/types'
import { Icon, facetColor, treeIcon } from './Icon'
import { openMenu, prompt, confirm, type MenuItem } from './ui'
import * as cmd from '../commands'

export const DRAG_TYPE = 'application/x-facets-photos'

export function dragIds(e: DragEvent): number[] | null {
  const raw = e.dataTransfer.getData(DRAG_TYPE)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function useDrop(onIds: (ids: number[]) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false)
        const ids = dragIds(e)
        if (ids?.length) {
          e.preventDefault()
          onIds(ids)
        }
      }
    }
  }
}

function sameSource(a: Source, b: Source): boolean {
  return a.kind === b.kind && (a as { id?: number }).id === (b as { id?: number }).id && (a as { name?: string }).name === (b as { name?: string }).name
}

function Item({
  src,
  icon,
  label,
  n,
  depth = 0,
  twisty,
  onDropIds,
  onContext,
  extra,
  onClick
}: {
  src?: Source
  icon?: ReactNode
  label: ReactNode
  n?: number
  depth?: number
  twisty?: { open: boolean; toggle: () => void } | null
  onDropIds?: (ids: number[]) => void
  onContext?: (e: React.MouseEvent) => void
  extra?: ReactNode
  onClick?: () => void
}) {
  const source = useStore((s) => s.source)
  const setSource = useStore((s) => s.setSource)
  const drop = useDrop(onDropIds ?? (() => {}))
  const on = src ? sameSource(source, src) : false
  return (
    <div
      className={'nav-item' + (on ? ' on' : '') + (drop.over ? ' drop' : '')}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => {
        if (onClick) onClick()
        else if (src) {
          setSource(src)
          useStore.getState().setFilters({ ...EMPTY_FILTERS, text: useStore.getState().filters.text })
        }
      }}
      onContextMenu={onContext}
      {...(onDropIds ? drop.props : {})}
    >
      {twisty !== undefined && (
        <span
          className="tw"
          onClick={(e) => {
            e.stopPropagation()
            twisty?.toggle()
          }}
        >
          {twisty && <Icon name={twisty.open ? 'down' : 'right'} size={12} stroke={2} />}
        </span>
      )}
      {icon}
      <span className="lbl">{label}</span>
      {extra}
      {n !== undefined && <span className="n">{n.toLocaleString()}</span>}
    </div>
  )
}

function Section({ id, title, children, onAdd, addTitle }: { id: string; title: string; children: ReactNode; onAdd?: () => void; addTitle?: string }) {
  const closed = useStore((s) => !!s.ui.navCollapsed[`sec:${id}`])
  const setUi = useStore((s) => s.setUi)
  const toggle = (): void => setUi({ navCollapsed: { ...useStore.getState().ui.navCollapsed, [`sec:${id}`]: !closed } })
  return (
    <div className="nav-sec">
      <div className={'nav-head' + (closed ? ' closed' : '')} onClick={toggle}>
        <span className="caret"><Icon name="down" size={11} stroke={2} /></span>
        {title}
        {onAdd && (
          <button className="iconbtn add" style={{ width: 22, height: 22 }} title={addTitle} onClick={(e) => { e.stopPropagation(); onAdd() }}>
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>
      {!closed && children}
    </div>
  )
}

export function Navigator() {
  const photos = useStore((s) => s.photos)
  const sets = useStore((s) => s.sets)
  const shoots = useStore((s) => s.shoots)
  const series = useStore((s) => s.series)
  const library = useStore((s) => s.library)
  const savedAll = useStore((s) => s.ui.savedFilters)
  const saved = savedAll[library?.path ?? ''] ?? []
  const navCollapsed = useStore((s) => s.ui.navCollapsed)
  const setUi = useStore((s) => s.setUi)
  const ctx = useCtx()
  const source = useStore((s) => s.source)

  const counts = useMemo(() => {
    const set = new Map<number, number>()
    const shoot = new Map<number, number>()
    const ser = new Map<number, number>()
    const node = new Map<number, number>()
    const loc = new Map<string, number>()
    let noShoot = 0
    let needs = 0
    let locUnknown = 0
    let pending = 0
    for (const p of photos) {
      for (const s of p.sets) set.set(s, (set.get(s) ?? 0) + 1)
      for (const s of p.series) ser.set(s, (ser.get(s) ?? 0) + 1)
      if (p.shootId) shoot.set(p.shootId, (shoot.get(p.shootId) ?? 0) + 1)
      else noShoot++
      const seen = new Set<number>()
      for (const id of p.nodes) for (const a of ancestors(id, ctx.nodeById)) seen.add(a.id)
      for (const id of seen) node.set(id, (node.get(id) ?? 0) + 1)
      loc.set(p.locationState, (loc.get(p.locationState) ?? 0) + 1)
      if (missingRequired(p, ctx).length) needs++
      if (!locationDecided(p) || p.locationState === 'unknown') locUnknown++
      if (p.internal.length) pending++
    }
    return { set, shoot, ser, node, loc, noShoot, needs, locUnknown, pending }
  }, [photos, ctx])

  const isOpen = (key: string): boolean => !!navCollapsed[key]
  const toggle = (key: string): void => setUi({ navCollapsed: { ...useStore.getState().ui.navCollapsed, [key]: !navCollapsed[key] } })

  const importSets = sets.filter((s) => s.kind === 'import')
  const manualSets = sets.filter((s) => s.kind === 'manual' && !s.archived)
  const trees = visibleTrees(ctx)
  const facets = trees.filter((t) => t.kind === 'facet')
  const location = trees.find((t) => t.kind === 'location')
  const custom = trees.filter((t) => t.kind === 'legacy')

  const nodeTree = (hid: number, parent: number | null, depth: number): ReactNode =>
    kidsOf(ctx, hid, parent)
      .filter((n) => !n.retired && !n.hidden)
      .map((n) => {
        const kids = kidsOf(ctx, hid, n.id).filter((k) => !k.retired && !k.hidden)
        const open = isOpen(`n:${n.id}`)
        return (
          <div key={n.id}>
            <Item
              src={{ kind: 'node', id: n.id }}
              label={n.label}
              extra={<>{n.shortCode && <span className="code">{n.shortCode}</span>}{n.domain === 'private' && <span className="dom private" title="Private: never published" />}{n.domain === 'internal' && <span className="dom internal" title="Internal: provisional" />}</>}
              n={counts.node.get(n.id) ?? 0}
              depth={depth}
              twisty={kids.length ? { open, toggle: () => toggle(`n:${n.id}`) } : null}
              onDropIds={(ids) => void act('assignNode', ids, n.id)}
              onContext={(e) =>
                openMenu(e, [
                  { label: 'Add child…', icon: 'plus', onClick: async () => { const l = await prompt(`New entry under "${n.label}"`, '', undefined, 'Add'); if (l) void act('createNode', hid, n.id, l) } },
                  { label: 'Rename…', onClick: async () => { const l = await prompt('Rename', n.label, undefined, 'Rename'); if (l) void act('updateNode', n.id, { label: l }) } },
                  { label: 'Add to selected photos', icon: 'tag', onClick: () => { const ids = cmd.need(); if (ids) void act('assignNode', ids, n.id) } },
                  { label: 'Remove from selected photos', onClick: () => { const ids = cmd.need(); if (ids) void act('removeNode', ids, n.id) } },
                  { sep: true },
                  { label: 'Open in Hierarchies', icon: 'tree', onClick: () => useStore.getState().set({ workspace: 'hierarchies', explorerTree: hid, explorerNode: n.id }) }
                ])
              }
            />
            {open && nodeTree(hid, n.id, depth + 1)}
          </div>
        )
      })

  const treeBlock = (t: Tree, ctx2: Ctx): ReactNode => {
    const open = isOpen(`t:${t.id}`)
    const total = photos.filter((p) => p.nodes.some((id) => ctx2.nodeById.get(id)?.treeId === t.id)).length
    return (
      <div key={t.id}>
        <Item
          icon={<span style={{ color: facetColor(t.key) ?? 'var(--text3)', display: 'grid' }}><Icon name={treeIcon(t.key, t.icon)} size={15} /></span>}
          label={t.name}
          n={total}
          twisty={{ open, toggle: () => toggle(`t:${t.id}`) }}
          onClick={() => toggle(`t:${t.id}`)}
          onContext={(e) => openMenu(e, [
            { label: `New ${t.name} entry…`, icon: 'plus', onClick: async () => { const l = await prompt(`New ${t.name} entry`, '', 'Added at the top level. Type a path with > to create several levels.', 'Add'); if (l) void act('createPath', t.id, l.split(/\s*>\s*/), []) } },
            { label: 'Open in Hierarchies', icon: 'tree', onClick: () => useStore.getState().set({ workspace: 'hierarchies', explorerTree: t.id, explorerNode: null }) }
          ])}
        />
        {open && nodeTree(t.id, null, 1)}
      </div>
    )
  }

  const quiet = (text: string): ReactNode => <div className="muted" style={{ padding: '2px 10px 6px 30px', fontSize: 12 }}>{text}</div>

  return (
    <div className="nav-scroll">
      <Section id="lib" title="Library">
        <Item src={{ kind: 'all' }} icon={<Icon name="image" size={15} />} label="All photos" n={photos.length} />
        <Item
          icon={<Icon name="alert" size={15} />}
          label="Needs attention"
          n={counts.needs}
          onClick={() => {
            const s = useStore.getState()
            s.setSource({ kind: 'all' })
            s.setFilters({ ...EMPTY_FILTERS, flags: ['needs'] })
          }}
        />
        <Item src={{ kind: 'noShoot' }} icon={<Icon name="camera" size={15} />} label="Not in a Shoot" n={counts.noShoot} />
        <Item src={{ kind: 'locUnknown' }} icon={<Icon name="pinOff" size={15} />} label="Location unknown" n={counts.locUnknown} />
        <Item src={{ kind: 'pending' }} icon={<Icon name="tag" size={15} dash />} label="Pending review" n={counts.pending} />
      </Section>

      <Section id="sets" title="Sets" onAdd={() => void cmd.newSet()} addTitle="New Set from selection">
        <Item
          icon={<Icon name="import" size={15} />}
          label="Imports"
          n={importSets.length}
          twisty={{ open: isOpen('imports'), toggle: () => toggle('imports') }}
          onClick={() => toggle('imports')}
        />
        {isOpen('imports') && (importSets.length === 0 ? quiet('Nothing imported yet') : importSets.map((s) => (
          <div key={s.id}>
            <Item src={{ kind: 'set', id: s.id }} depth={1} icon={<Icon name="set" size={14} />} label={s.name} n={counts.set.get(s.id) ?? 0}
              onContext={(e) => openMenu(e, setMenu(s))} />
            {source.kind === 'set' && source.id === s.id && <SetBreakdown setId={s.id} ctx={ctx} />}
          </div>
        )))}
        {!isOpen('imports') && source.kind === 'set' && importSets.some((x) => x.id === source.id) && <SetBreakdown setId={source.id} ctx={ctx} />}
        {manualSets.length === 0 && quiet('Select photos, then New Set (or drag them onto a Set)')}
        {manualSets.map((s) => (
          <div key={s.id}>
            <Item
              src={{ kind: 'set', id: s.id }}
              icon={<Icon name="set" size={15} />}
              label={s.name}
              n={counts.set.get(s.id) ?? 0}
              onDropIds={(ids) => void act('addToSet', s.id, ids)}
              onContext={(e) => openMenu(e, setMenu(s))}
            />
            {source.kind === 'set' && source.id === s.id && <SetBreakdown setId={s.id} ctx={ctx} />}
          </div>
        ))}
        {sets.some((x) => x.kind === 'manual' && x.archived) && (
          <div className="nav-item" onClick={() => toggle('archivedSets')}>
            <span className="muted" style={{ paddingLeft: 22 }}>{isOpen('archivedSets') ? 'Hide archived sets' : 'Show archived sets'}</span>
          </div>
        )}
        {isOpen('archivedSets') && sets.filter((x) => x.kind === 'manual' && x.archived).map((s) => (
          <Item key={s.id} src={{ kind: 'set', id: s.id }} icon={<Icon name="set" size={15} />} label={<span className="muted">{s.name}</span>} n={counts.set.get(s.id) ?? 0}
            onContext={(e) => openMenu(e, [{ label: 'Restore set', onClick: () => void act('archiveSet', s.id, false) }])} />
        ))}
      </Section>

      <Section id="series" title="Series" onAdd={() => cmd.newSeries()} addTitle="New Series from selection (Ctrl+Shift+N)">
        {series.length === 0 && quiet('Select photos, then New Series (Ctrl+Shift+N)')}
        {facets.map((t) => {
          const mine = series.filter((x) => x.primaryNodeId !== null && ctx.nodeById.get(x.primaryNodeId)?.treeId === t.id)
          if (!mine.length) return null
          const open = !isOpen(`sf:${t.id}`) // facets start open; the flag records closing
          const byNode = new Map<number, typeof mine>()
          for (const x of mine) byNode.set(x.primaryNodeId!, [...(byNode.get(x.primaryNodeId!) ?? []), x])
          return (
            <div key={t.id}>
              <Item icon={<span style={{ color: facetColor(t.key), display: 'grid' }}><Icon name={treeIcon(t.key)} size={15} /></span>} label={t.name} n={mine.length}
                twisty={{ open, toggle: () => toggle(`sf:${t.id}`) }} onClick={() => toggle(`sf:${t.id}`)} />
              {open && [...byNode.entries()].sort((a, b) => pathLabel(a[0], ctx.nodeById).localeCompare(pathLabel(b[0], ctx.nodeById))).map(([nid, list]) => (
                <div key={nid}>
                  <div className="nav-path" style={{ paddingLeft: 36 }}>{pathLabel(nid, ctx.nodeById)}</div>
                  {list.map((x) => <SeriesItem key={x.id} x={x} n={counts.ser.get(x.id) ?? 0} depth={2} />)}
                </div>
              ))}
            </div>
          )
        })}
        {series.some((x) => x.primaryNodeId === null) && (
          <div>
            <Item icon={<Icon name="series" size={15} />} label={<span className="muted">No Primary Facet yet</span>} n={series.filter((x) => x.primaryNodeId === null).length}
              twisty={{ open: !isOpen('sf:none'), toggle: () => toggle('sf:none') }} onClick={() => toggle('sf:none')} />
            {!isOpen('sf:none') && series.filter((x) => x.primaryNodeId === null).map((x) => <SeriesItem key={x.id} x={x} n={counts.ser.get(x.id) ?? 0} depth={1} />)}
          </div>
        )}
      </Section>

      {location && (
        <Section id="locations" title="Locations">
          {nodeTree(location.id, null, 0)}
          {(['unknown', 'hidden', 'not_retained'] as const).map((k) => (
            <Item
              key={k}
              icon={<Icon name="pinOff" size={14} />}
              label={{ unknown: 'Unknown', hidden: 'Hidden', not_retained: 'Not retained' }[k]}
              n={counts.loc.get(k) ?? 0}
              onClick={() => {
                const s = useStore.getState()
                s.setSource({ kind: 'all' })
                s.setFilters({ ...EMPTY_FILTERS, facets: { locstate: [k] } })
              }}
            />
          ))}
        </Section>
      )}

      <Section id="shoots" title="Shoots" onAdd={cmd.newShoot} addTitle="New Shoot from selection">
        {shoots.length === 0 && quiet('Select photos and press Ctrl+N to make a Shoot')}
        {shoots.filter((s) => !s.archived).map((s) => (
          <Item
            key={s.id}
            src={{ kind: 'shoot', id: s.id }}
            label={<><span className="code">{s.code}</span>&nbsp; {s.name}</>}
            extra={s.privacy === 'private' ? <span title="Private Shoot" style={{ color: 'var(--d-private)', display: 'grid' }}><Icon name="lock" size={12} /></span> : undefined}
            n={counts.shoot.get(s.id) ?? 0}
            onDropIds={(ids) => void act('setShoot', ids, s.id)}
            onContext={(e) =>
              openMenu(e, [
                { label: 'Rename shoot…', onClick: async () => { const n = await prompt('Rename shoot', s.name); if (n) void act('updateShoot', s.id, { name: n }) } },
                { label: 'Assign Photo IDs to all its photos', icon: 'hash', onClick: () => void act('assignNames', photos.filter((p) => p.shootId === s.id).map((p) => p.id)) },
                { sep: true },
                { label: 'Archive shoot', onClick: () => void act('updateShoot', s.id, { archived: true }) }
              ])
            }
          />
        ))}
        {shoots.some((s) => s.archived) && (
          <div className="nav-item" onClick={() => toggle('archived')}>
            <span className="muted" style={{ paddingLeft: 22 }}>{isOpen('archived') ? 'Hide archived' : 'Show archived'}</span>
          </div>
        )}
        {isOpen('archived') && shoots.filter((s) => s.archived).map((s) => (
          <Item key={s.id} src={{ kind: 'shoot', id: s.id }} label={<span className="muted"><span className="code">{s.code}</span>&nbsp; {s.name}</span>} n={counts.shoot.get(s.id) ?? 0}
            onContext={(e) => openMenu(e, [{ label: 'Restore shoot', onClick: () => void act('updateShoot', s.id, { archived: false }) }])} />
        ))}
      </Section>

      <Section id="facets" title="Facets">
        {facets.map((t) => treeBlock(t, ctx))}
      </Section>

      {custom.length > 0 && (
        <Section id="custom" title="Other trees">
          {custom.map((t) => treeBlock(t, ctx))}
        </Section>
      )}

      {saved.length > 0 && (
        <Section id="saved" title="Saved views">
          {saved.map((f) => (
            <Item
              key={f.name}
              src={{ kind: 'saved', name: f.name }}
              icon={<Icon name="filter" size={15} />}
              label={f.name}
              onClick={() => {
                const s = useStore.getState()
                s.set({ source: f.source.kind === 'saved' ? { kind: 'all' } : f.source, filters: f.filters, workspace: 'library' })
              }}
              onContext={(e) =>
                openMenu(e, [
                  {
                    label: 'Delete saved view',
                    icon: 'trash',
                    onClick: () => {
                      const s = useStore.getState()
                      const all = { ...s.ui.savedFilters }
                      all[library!.path] = (all[library!.path] ?? []).filter((x) => x.name !== f.name)
                      s.setUi({ savedFilters: all })
                    }
                  }
                ])
              }
            />
          ))}
        </Section>
      )}
    </div>
  )
}

function setMenu(s: { id: number; name: string; kind: string; archived: boolean }): MenuItem[] {
  return [
    { label: 'Add selected photos', icon: 'plus', onClick: () => { const ids = cmd.need(); if (ids) void act('addToSet', s.id, ids) } },
    { label: 'Remove selected photos', onClick: () => { const ids = cmd.need(); if (ids) void act('removeFromSet', s.id, ids) } },
    {
      label: 'Replace contents with the selection…',
      onClick: async () => {
        const ids = cmd.need()
        if (ids && (await confirm(`Replace the contents of "${s.name}"?`, `It will hold exactly the ${ids.length} selected photos. You can undo this.`, 'Replace')))
          void act('replaceSet', s.id, ids)
      }
    },
    { sep: true },
    { label: 'Rename…', onClick: async () => { const n = await prompt('Rename set', s.name); if (n) void act('renameSet', s.id, n) } },
    { label: 'Duplicate…', icon: 'copy', onClick: async () => { const n = await prompt('Name of the copy', `${s.name} (copy)`); if (n) void act('duplicateSet', s.id, n) } },
    { label: 'Archive', onClick: () => void act('archiveSet', s.id, true) },
    { label: 'Remove set', icon: 'trash', onClick: async () => { if (await confirm(`Remove the set "${s.name}"?`, 'The photos themselves are not affected.', 'Remove', true)) void act('deleteSet', s.id) } }
  ]
}

/** One Series in the navigator: click to show its photos and edit it in the inspector. */
function SeriesItem({ x, n, depth }: { x: Series; n: number; depth: number }) {
  return (
    <Item
      src={{ kind: 'series', id: x.id }}
      depth={depth}
      label={<>{x.title} <span className="muted mono" style={{ fontSize: 10.5 }}>{x.publicId}</span></>}
      extra={x.privacy === 'private' ? <span title="Private Series" style={{ color: 'var(--d-private)', display: 'grid' }}><Icon name="lock" size={11} /></span> : undefined}
      n={n}
      onClick={() => cmd.editSeries(x.id, true)}
      onDropIds={(ids) => void act('addToSeries', x.id, ids)}
      onContext={(e) => openMenu(e, seriesMenu(x))}
    />
  )
}

export function seriesMenu(x: Series): MenuItem[] {
  return [
    { label: 'Edit Series', icon: 'pencil', onClick: () => cmd.editSeries(x.id, false) },
    { label: 'Show its photos', icon: 'image', onClick: () => cmd.editSeries(x.id, true) },
    { label: 'Add selected photos', icon: 'plus', onClick: () => { const ids = cmd.need(); if (ids) void act('addToSeries', x.id, ids) } },
    { label: 'Remove selected photos', onClick: () => { const ids = cmd.need(); if (ids) void act('removeFromSeries', x.id, ids) } },
    { label: 'Apply Series keywords to members…', icon: 'tag', onClick: () => useStore.getState().openDialog('applySeries', { id: x.id }) },
    { sep: true },
    { label: 'Retire Series…', icon: 'trash', onClick: async () => { if (await confirm(`Retire "${x.title}"?`, `Its ID ${x.publicId} is kept in the registry and never reused. The photos are not affected. You can undo this.`, 'Retire', true)) void act('retireSeries', x.id) } }
  ]
}

/** Under the active Set: the Shoots, Series, Locations and Facet entries in it, with in-Set counts that act as filters. */
function SetBreakdown({ setId, ctx }: { setId: number; ctx: Ctx }) {
  const photos = useStore((s) => s.photos)
  const filters = useStore((s) => s.filters)
  const navCollapsed = useStore((s) => s.ui.navCollapsed)
  const data = useMemo(() => {
    const inSet = photos.filter((p) => p.sets.includes(setId))
    const shoot = new Map<number, number>()
    const ser = new Map<number, number>()
    const tree = new Map<number, Map<number, number>>() // tree -> node -> photos in the Set
    for (const p of inSet) {
      if (p.shootId) shoot.set(p.shootId, (shoot.get(p.shootId) ?? 0) + 1)
      for (const s of p.series) ser.set(s, (ser.get(s) ?? 0) + 1)
      const seen = new Set<number>()
      for (const id of p.nodes) for (const a of ancestors(id, ctx.nodeById)) seen.add(a.id)
      for (const id of seen) {
        const n = ctx.nodeById.get(id)
        if (!n) continue
        let m = tree.get(n.treeId)
        if (!m) tree.set(n.treeId, (m = new Map()))
        m.set(id, (m.get(id) ?? 0) + 1)
      }
    }
    return { shoot, ser, tree }
  }, [photos, setId, ctx])
  const toggleFilter = (dim: string, value: string): void => {
    const s = useStore.getState()
    const cur = s.filters.facets[dim] ?? []
    const next = cur.includes(value) ? [] : [value]
    const facets = { ...s.filters.facets, [dim]: next }
    if (!next.length) delete facets[dim]
    s.setFilters({ facets })
  }
  const on = (dim: string, value: string): boolean => (filters.facets[dim] ?? []).includes(value)
  const isOpen = (k: string): boolean => !!navCollapsed[k]
  const toggle = (k: string): void => useStore.getState().setUi({ navCollapsed: { ...useStore.getState().ui.navCollapsed, [k]: !useStore.getState().ui.navCollapsed[k] } })
  const row = (key: string, label: ReactNode, n: number, dim: string, value: string, depth: number, extra?: ReactNode): ReactNode => (
    <div key={key} className={'nav-item sub' + (on(dim, value) ? ' on' : '')} style={{ paddingLeft: 10 + depth * 12 }} onClick={() => toggleFilter(dim, value)} title="Click to filter the Set by this; click again to clear">
      {extra ?? <span className="tw" />}
      <span className="lbl">{label}</span>
      <span className="n">{n}</span>
    </div>
  )
  const block = (k: string, title: string, children: () => ReactNode[], count: number): ReactNode =>
    count === 0 ? null : (
      <div key={k}>
        <div className="nav-item sub head" style={{ paddingLeft: 22 }} onClick={() => toggle(`sb:${k}`)}>
          <span className="tw"><Icon name={isOpen(`sb:${k}`) ? 'down' : 'right'} size={11} /></span>
          <span className="lbl">{title}</span>
          <span className="n">{count}</span>
        </div>
        {isOpen(`sb:${k}`) && children()}
      </div>
    )
  const nodeRows = (t: Tree, m: Map<number, number>, parent: number | null, depth: number): ReactNode[] =>
    [...m.entries()]
      .filter(([id]) => (ctx.nodeById.get(id)?.parentId ?? null) === parent)
      .sort((a, b) => b[1] - a[1])
      .flatMap(([id, n]) => {
        const hasKids = [...m.keys()].some((k) => ctx.nodeById.get(k)?.parentId === id)
        const tw = hasKids ? (
          <span className="tw" onClick={(e) => { e.stopPropagation(); toggle(`sbn:${id}`) }}><Icon name={isOpen(`sbn:${id}`) ? 'down' : 'right'} size={10} /></span>
        ) : undefined
        return [row(`n${id}`, ctx.nodeById.get(id)?.label, n, `h:${t.key}`, String(id), depth, tw), ...(isOpen(`sbn:${id}`) ? nodeRows(t, m, id, depth + 1) : [])]
      })
  return (
    <div className="set-breakdown">
      {block('shoots', 'Shoots in this Set', () => [...data.shoot.entries()].map(([id, n]) => { const sh = ctx.shoots.get(id); return row(`sh${id}`, <><span className="code">{sh?.code}</span> {sh?.name}</>, n, 'shoot', String(id), 2) }), data.shoot.size)}
      {block('series', 'Series in this Set', () => [...data.ser.entries()].map(([id, n]) => { const x = ctx.series.get(id); return row(`se${id}`, <>{x?.title} <span className="muted" style={{ fontSize: 10.5 }}>{x ? `${n} of ${x.members.length}` : ''}</span></>, n, 'series', String(id), 2) }), data.ser.size)}
      {visibleTrees(ctx).map((t) => {
        const m = data.tree.get(t.id)
        if (!m) return null
        const tops = [...m.keys()].filter((id) => ctx.nodeById.get(id)?.parentId === null).length
        return block(`t${t.id}`, t.name, () => nodeRows(t, m, null, 2), tops)
      })}
    </div>
  )
}
