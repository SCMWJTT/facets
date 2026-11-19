import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { act } from '../api'
import { useStore, EMPTY_FILTERS, type Source } from '../store'
import { ancestors, kidsOf, useCtx, missingRequired, locationDecided, visibleTrees, type Ctx } from '../logic'
import type { Tree } from '@shared/types'
import { Icon, facetColor, treeIcon } from './Icon'
import { openMenu, prompt, confirm } from './ui'
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
          <Item key={s.id} src={{ kind: 'set', id: s.id }} depth={1} icon={<Icon name="set" size={14} />} label={s.name} n={counts.set.get(s.id) ?? 0} />
        )))}
        {manualSets.length === 0 && quiet('Select photos, then New Set (or drag them onto a Set)')}
        {manualSets.map((s) => (
          <Item
            key={s.id}
            src={{ kind: 'set', id: s.id }}
            icon={<Icon name="set" size={15} />}
            label={s.name}
            n={counts.set.get(s.id) ?? 0}
            onDropIds={(ids) => void act('addToSet', s.id, ids)}
            onContext={(e) =>
              openMenu(e, [
                { label: 'Rename…', onClick: async () => { const n = await prompt('Rename set', s.name); if (n) void act('renameSet', s.id, n) } },
                { label: 'Remove set', icon: 'trash', onClick: async () => { if (await confirm(`Remove the set "${s.name}"?`, 'The photos themselves are not affected.', 'Remove', true)) void act('deleteSet', s.id) } }
              ])
            }
          />
        ))}
      </Section>

      <Section id="series" title="Series">
        {series.length === 0 ? quiet('Series (editorial collections) arrive in build stage 3') : facets.map((t) => {
          const mine = series.filter((x) => x.primaryNodeId !== null && ctx.nodeById.get(x.primaryNodeId)?.treeId === t.id)
          if (!mine.length) return null
          return (
            <div key={t.id}>
              <Item icon={<span style={{ color: facetColor(t.key), display: 'grid' }}><Icon name={treeIcon(t.key)} size={15} /></span>} label={t.name} n={mine.length} />
              {mine.map((x) => <Item key={x.id} depth={1} src={{ kind: 'series', id: x.id }} label={<>{x.title} <span className="muted">· {x.publicId}</span></>} n={counts.ser.get(x.id) ?? 0} />)}
            </div>
          )
        })}
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
