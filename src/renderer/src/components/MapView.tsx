// The Map module: the Library's thumbnails are replaced by a map. The navigator and inspector stay, so Series,
// Sets, groups and keywords work exactly as in the Library.
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import type { PhotoRow } from '@shared/types'
import { act, thumbUrl } from '../api'
import { useStore, groupColor } from '../store'
import type { Ctx, Group } from '../logic'
import { Icon } from './Icon'
import { DRAG_TYPE } from './Navigator'
import { round } from './MapPanel'
import * as cmd from '../commands'

type Visible = { list: PhotoRow[]; groups: Group[]; ctx: Ctx }

/** Where the map was left, so coming back to the Map module does not jump. */
let lastView: { center: L.LatLng; zoom: number } | null = null
let lastPrimaryKey = ''

const placed = (p: PhotoRow): boolean => p.lat !== null && p.lon !== null

function thumbSize(zoom: number): number {
  if (zoom <= 7) return 30
  if (zoom <= 11) return 40
  if (zoom <= 14) return 54
  if (zoom <= 16) return 68
  return 84
}

function thumbIcon(p: PhotoRow, size: number, selected: boolean): L.DivIcon {
  const url = thumbUrl(p.id, p.thumbVer)
  return L.divIcon({
    className: '',
    html: `<div class="mthumb${selected ? ' sel' : ''}" style="width:${size}px;height:${size}px">${url ? `<img src="${url}" draggable="false">` : ''}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  })
}

export function MapView({ visible }: { visible: Visible }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const tiles = useRef<L.TileLayer | null>(null)
  const primaryLayer = useRef<L.LayerGroup | null>(null)
  const otherLayer = useRef<L.LayerGroup | null>(null)
  const markers = useRef(new Map<number, { m: L.Marker; sel: boolean }>())
  const dots = useRef(new Map<number, { m: L.CircleMarker; color: string; r: number }>())
  const renderer = useRef(L.canvas({ padding: 0.3 }))
  const settings = useStore((s) => s.settings)!
  const mapLayer = useStore((s) => s.ui.mapLayer)
  const mp = useStore((s) => s.ui.map)
  const setUi = useStore((s) => s.setUi)
  const groups = useStore((s) => s.groups)
  const photos = useStore((s) => s.photos)
  const byId = useStore((s) => s.byId)
  const selected = useStore((s) => s.selected)
  const [zoom, setZoom] = useState(lastView?.zoom ?? settings.mapCenter.zoom)
  const [mode, setMode] = useState<'pan' | 'box' | 'place'>('pan')
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [online, setOnline] = useState(navigator.onLine)

  // The main group: the current Library view, or a working group.
  const primaryGroup = mp.primary !== 'view' ? groups.find((g) => g.code === mp.primary) : undefined
  const primary = useMemo(
    () => (primaryGroup ? primaryGroup.ids.map((id) => byId.get(id)).filter((p): p is PhotoRow => !!p) : visible.list),
    [primaryGroup, byId, visible.list]
  )
  const primaryPlaced = useMemo(() => primary.filter(placed), [primary])
  const unplaced = primary.length - primaryPlaced.length
  const primaryKey = (primaryGroup ? primaryGroup.code : 'view') + ':' + primaryPlaced.map((p) => `${p.id}:${p.lat}:${p.lon}:${p.thumbVer}`).join('|')
  const secondary = mp.secondary.filter((c) => c !== mp.primary && groups.some((g) => g.code === c))

  useEffect(() => {
    const on = (): void => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])

  // Create the map once.
  useEffect(() => {
    if (!el.current) return
    const start = lastView ?? { center: L.latLng(settings.mapCenter.lat, settings.mapCenter.lon), zoom: settings.mapCenter.zoom }
    const m = L.map(el.current, { zoomControl: true, worldCopyJump: true, boxZoom: false, preferCanvas: false }).setView(start.center, start.zoom)
    otherLayer.current = L.layerGroup().addTo(m)
    m.on('zoomend', () => setZoom(m.getZoom()))
    m.on('moveend', () => { lastView = { center: m.getCenter(), zoom: m.getZoom() } })
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (modeRef.current !== 'place') return
      const ids = [...useStore.getState().selected]
      if (!ids.length) return void useStore.getState().toast('Select photos first, then click the map to place them', 'warn')
      void act('setPosition', ids, round(e.latlng.lat), round(e.latlng.lng)).then(() => setMode('pan'))
    })
    // Box select: Shift+drag, or drag while the box tool is on. Ctrl adds to the selection.
    let box: L.Rectangle | null = null
    let from: L.LatLng | null = null
    const down = (e: L.LeafletMouseEvent): void => {
      const oe = e.originalEvent
      if (oe.button !== 0 || !(oe.shiftKey || modeRef.current === 'box')) return
      from = e.latlng
      m.dragging.disable()
      box = L.rectangle(L.latLngBounds(from, from), { color: '#e0a85e', weight: 1.5, fillOpacity: 0.08, interactive: false }).addTo(m)
    }
    const move = (e: L.LeafletMouseEvent): void => { if (box && from) box.setBounds(L.latLngBounds(from, e.latlng)) }
    const up = (e: L.LeafletMouseEvent): void => {
      if (!box || !from) return
      const b = box.getBounds()
      box.remove()
      box = null
      from = null
      m.dragging.enable()
      boxSelect(b, e.originalEvent.ctrlKey || e.originalEvent.metaKey)
    }
    m.on('mousedown', down)
    m.on('mousemove', move)
    m.on('mouseup', up)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => { ro.disconnect(); m.remove(); map.current = null; primaryLayer.current = null; markers.current.clear(); dots.current.clear() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current
    if (!m) return
    tiles.current?.remove()
    const t = settings.tiles[mapLayer]
    tiles.current = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: 19, crossOrigin: true }).addTo(m)
    tiles.current.bringToBack()
  }, [mapLayer, settings.tiles])

  useEffect(() => {
    const c = el.current?.querySelector('.leaflet-container') as HTMLElement | null
    const target = c ?? el.current
    if (target) target.style.cursor = mode === 'place' ? 'crosshair' : mode === 'box' ? 'cell' : ''
  }, [mode])

  /** Select the photos shown inside a box (main group thumbnails and group pins). */
  const boxSelect = (b: L.LatLngBounds, add: boolean): void => {
    const s = useStore.getState()
    const ids: number[] = []
    for (const [id, x] of markers.current) if (b.contains(x.m.getLatLng())) ids.push(id)
    for (const [id, x] of dots.current) if (!markers.current.has(id) && b.contains(x.m.getLatLng())) ids.push(id)
    const next = add ? [...new Set([...s.selected, ...ids])] : ids
    s.select(next)
    if (modeRef.current === 'box') setMode('pan')
    s.toast(`${ids.length} photo${ids.length === 1 ? '' : 's'} ${add ? 'added to the selection' : 'selected'}`)
  }

  const clickPhoto = (id: number, e: MouseEvent): void => {
    const s = useStore.getState()
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(s.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      s.select(next, id)
    } else if (e.shiftKey) s.select([...s.selected, id], id)
    else s.select([id], id)
  }

  // The main group as thumbnails (clustered when zoomed out).
  useEffect(() => {
    const m = map.current
    if (!m) return
    primaryLayer.current?.remove()
    markers.current.clear()
    const sel = useStore.getState().selected
    const size = thumbSize(m.getZoom())
    const cluster = (L as unknown as { markerClusterGroup: (o: object) => L.LayerGroup & { addLayers: (l: L.Layer[]) => void } }).markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: (z: number) => (z >= 16 ? 30 : 60),
      disableClusteringAtZoom: 18,
      spiderfyOnMaxZoom: true,
      chunkedLoading: true,
      iconCreateFunction: (c: { getChildCount: () => number; getAllChildMarkers: () => (L.Marker & { photoId?: number })[] }) => {
        const kids = c.getAllChildMarkers()
        const p = byId.get(kids[0]?.photoId ?? -1)
        const url = p ? thumbUrl(p.id, p.thumbVer) : null
        const anySel = kids.some((k) => k.photoId !== undefined && useStore.getState().selected.has(k.photoId))
        const sz = Math.max(44, thumbSize(m.getZoom()))
        return L.divIcon({
          className: '',
          html: `<div class="mthumb cl${anySel ? ' sel' : ''}" style="width:${sz}px;height:${sz}px">${url ? `<img src="${url}" draggable="false">` : ''}<span class="mcount">${c.getChildCount()}</span></div>`,
          iconSize: [sz, sz],
          iconAnchor: [sz / 2, sz / 2]
        })
      }
    })
    const list: L.Marker[] = []
    for (const p of primaryPlaced) {
      const isSel = sel.has(p.id)
      const mk = L.marker([p.lat!, p.lon!], { icon: thumbIcon(p, size, isSel), title: `${p.title || 'Untitled'} · ${p.publicId ?? p.rawKey}`, riseOnHover: true }) as L.Marker & { photoId?: number }
      mk.photoId = p.id
      mk.on('click', (e: L.LeafletMouseEvent) => { if (modeRef.current !== 'place') clickPhoto(p.id, e.originalEvent) })
      markers.current.set(p.id, { m: mk, sel: isSel })
      list.push(mk)
    }
    cluster.addLayers(list)
    cluster.addTo(m)
    primaryLayer.current = cluster
    // Zoom to the main group when it changes (not when the selection changes).
    if (primaryKey.split(':')[0] + primaryPlaced.length !== lastPrimaryKey) {
      lastPrimaryKey = primaryKey.split(':')[0] + primaryPlaced.length
      if (primaryPlaced.length === 1) m.setView([primaryPlaced[0].lat!, primaryPlaced[0].lon!], Math.max(m.getZoom(), 14))
      else if (primaryPlaced.length > 1) m.fitBounds(L.latLngBounds(primaryPlaced.map((p) => [p.lat!, p.lon!] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 16 })
    }
  }, [primaryKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resize thumbnails with the zoom.
  useEffect(() => {
    const size = thumbSize(zoom)
    for (const [id, x] of markers.current) {
      const p = byId.get(id)
      if (p) x.m.setIcon(thumbIcon(p, size, x.sel))
    }
    ;(primaryLayer.current as unknown as { refreshClusters?: () => void })?.refreshClusters?.()
  }, [zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // Other working groups as coloured pins, and optionally every placed photo as small dots.
  const otherKey = `${secondary.join(',')}|${mp.showAll}|${photos.length}|${groups.map((g) => `${g.code}:${g.ids.length}`).join(',')}|${primaryKey.length}`
  useEffect(() => {
    const g = otherLayer.current
    if (!g) return
    g.clearLayers()
    dots.current.clear()
    const sel = useStore.getState().selected
    const inPrimary = new Set(primaryPlaced.map((p) => p.id))
    const add = (p: PhotoRow, color: string, r: number): void => {
      if (inPrimary.has(p.id) || dots.current.has(p.id)) return
      const isSel = sel.has(p.id)
      const d = L.circleMarker([p.lat!, p.lon!], { renderer: renderer.current, radius: r, color: isSel ? '#ffffff' : 'rgba(0,0,0,.5)', weight: isSel ? 2 : 1, fillColor: color, fillOpacity: 0.95 })
      d.on('click', (e: L.LeafletMouseEvent) => { if (modeRef.current !== 'place') clickPhoto(p.id, e.originalEvent) })
      d.bindTooltip(`${p.title || 'Untitled'} · ${p.publicId ?? p.rawKey}`, { direction: 'top', offset: [0, -4] })
      dots.current.set(p.id, { m: d, color, r })
      g.addLayer(d)
    }
    for (const code of secondary) {
      const grp = groups.find((x) => x.code === code)
      if (!grp) continue
      for (const id of grp.ids) { const p = byId.get(id); if (p && placed(p)) add(p, groupColor(code), 6) }
    }
    if (mp.showAll) for (const p of photos) if (placed(p)) add(p, '#8a8f99', 3.5)
  }, [otherKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the selection highlighted without rebuilding the map.
  useEffect(() => {
    const size = thumbSize(map.current?.getZoom() ?? zoom)
    let changed = false
    for (const [id, x] of markers.current) {
      const now = selected.has(id)
      if (now === x.sel) continue
      const p = byId.get(id)
      if (p) x.m.setIcon(thumbIcon(p, size, now))
      x.sel = now
      changed = true
    }
    if (changed) (primaryLayer.current as unknown as { refreshClusters?: () => void })?.refreshClusters?.()
    for (const [id, x] of dots.current) {
      const now = selected.has(id)
      x.m.setStyle({ color: now ? '#ffffff' : 'rgba(0,0,0,.5)', weight: now ? 2 : 1 })
      if (now) x.m.bringToFront()
    }
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const fitPrimary = (): void => {
    const m = map.current
    if (!m || !primaryPlaced.length) return
    if (primaryPlaced.length === 1) m.setView([primaryPlaced[0].lat!, primaryPlaced[0].lon!], 15)
    else m.fitBounds(L.latLngBounds(primaryPlaced.map((p) => [p.lat!, p.lon!] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 16 })
  }
  const fitSelection = (): void => {
    const m = map.current
    const pts = [...selected].map((id) => byId.get(id)).filter((p): p is PhotoRow => !!p && placed(p)).map((p) => [p.lat!, p.lon!] as L.LatLngTuple)
    if (!m || !pts.length) return
    if (pts.length === 1) m.setView(pts[0], Math.max(m.getZoom(), 15))
    else m.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 })
  }
  const setMap = (p: Partial<typeof mp>): void => setUi({ map: { ...useStore.getState().ui.map, ...p } })
  const toggleSecondary = (code: string): void => setMap({ secondary: mp.secondary.includes(code) ? mp.secondary.filter((c) => c !== code) : [...mp.secondary, code] })
  const viewLabel = useMemo(() => {
    const s = useStore.getState()
    const src = s.source
    if (src.kind === 'all') return 'All photos'
    if (src.kind === 'group') return src.code
    if (src.kind === 'series') { const x = visible.ctx.series.get(src.id); return x ? `SER-${Number(x.publicId.replace(/\D/g, ''))}: ${x.shortName}` : 'Series' }
    if (src.kind === 'set') return s.sets.find((x) => x.id === src.id)?.name ?? 'Set'
    if (src.kind === 'shoot') return visible.ctx.shoots.get(src.id)?.code ?? 'Shoot'
    return 'Library view'
  }, [visible.list, visible.ctx]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mapview">
      <div className="toolbar map-toolbar">
        <span className="lead">Main</span>
        <select className="select" value={mp.primary} onChange={(e) => setMap({ primary: e.target.value })} title="The main group is shown as thumbnails">
          <option value="view">Library view: {viewLabel} ({visible.list.length.toLocaleString()})</option>
          {groups.map((g) => <option key={g.code} value={g.code}>{g.code}{g.name ? ` · ${g.name}` : ''} ({g.ids.length})</option>)}
        </select>
        <span className="lead" style={{ marginLeft: 6 }}>Also show</span>
        <div className="gchips">
          {groups.filter((g) => g.code !== mp.primary).map((g) => (
            <button key={g.code} className={'gchip' + (mp.secondary.includes(g.code) ? ' on' : '')} title={`Show ${g.code} as coloured pins`} onClick={() => toggleSecondary(g.code)}>
              <span className="gdot" style={{ background: groupColor(g.code) }} />{g.code}
            </button>
          ))}
          <button className={'gchip' + (mp.showAll ? ' on' : '')} title="Show every placed photo in the library as small grey dots" onClick={() => setMap({ showAll: !mp.showAll })}>
            <span className="gdot" style={{ background: '#8a8f99' }} />All photos
          </button>
        </div>
        <span className="grow" />
        <div className="seg">
          <button className={mode === 'pan' ? 'on' : ''} title="Move the map; click thumbnails to select (Ctrl adds)" onClick={() => setMode('pan')}><Icon name="map" size={14} /></button>
          <button className={mode === 'box' ? 'on' : ''} title="Draw a box to select (or hold Shift and drag at any time; Ctrl adds)" onClick={() => setMode(mode === 'box' ? 'pan' : 'box')}><Icon name="lasso" size={14} /></button>
          <button className={mode === 'place' ? 'on' : ''} title="Place the selected photos: click the map where they were taken" onClick={() => setMode(mode === 'place' ? 'pan' : 'place')}><Icon name="crosshair" size={14} /></button>
        </div>
        <button className="iconbtn" title="Zoom to the main group" onClick={fitPrimary}><Icon name="fit" /></button>
        <button className="iconbtn" title="Zoom to the selection" disabled={!selected.size} onClick={fitSelection}><Icon name="check" /></button>
      </div>
      <div className="mapview-map">
        <div ref={el} style={{ position: 'absolute', inset: 0 }} />
        <div className="map-layers seg">
          <button className={mapLayer === 'street' ? 'on' : ''} onClick={() => setUi({ mapLayer: 'street' })}>Map</button>
          <button className={mapLayer === 'satellite' ? 'on' : ''} onClick={() => setUi({ mapLayer: 'satellite' })}>Satellite</button>
        </div>
        {mode === 'place' && <div className="map-hint">Click the map to place {selected.size ? `the ${selected.size} selected photo${selected.size === 1 ? '' : 's'}` : 'the selection (select photos first)'} · Esc to cancel</div>}
        {mode === 'box' && <div className="map-hint">Drag a box around the photos to select them · Ctrl adds</div>}
        {unplaced > 0 && (
          <div className="map-unplaced">
            {unplaced.toLocaleString()} of the main group {unplaced === 1 ? 'has' : 'have'} no position
            <button className="linkbtn" onClick={() => useStore.getState().select(primary.filter((p) => !placed(p)).map((p) => p.id))}>Select them</button>
          </div>
        )}
        {!online && <div className="offline"><div><Icon name="offline" size={22} /><div style={{ marginTop: 6 }}>No internet connection, so map tiles can't load.</div></div></div>}
      </div>
      <SelectionStrip onEsc={() => setMode('pan')} />
    </div>
  )
}

/** The selected photos along the bottom of the map. Drag them onto a Series, Set or group in the navigator. */
function SelectionStrip({ onEsc }: { onEsc: () => void }) {
  const selected = useStore((s) => s.selected)
  const byId = useStore((s) => s.byId)
  const list = useMemo(() => [...selected].slice(0, 400).map((id) => byId.get(id)).filter((p): p is PhotoRow => !!p), [selected, byId])
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onEsc() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onEsc])
  return (
    <div className="selstrip">
      <div className="selstrip-head">
        <b>{selected.size ? `${selected.size.toLocaleString()} selected` : 'Nothing selected'}</b>
        <span className="muted">{selected.size ? 'Drag these onto a Series, Set or group in the navigator' : 'Click thumbnails on the map, or Shift+drag a box'}</span>
        <span className="grow" />
        <button className="btn small ghost" disabled={!selected.size} onClick={() => cmd.newGroup()} title="New working group (Ctrl+T)"><Icon name="group" size={13} />New group</button>
        <button className="btn small ghost" disabled={!selected.size} onClick={() => cmd.newSeries()} title="New Series (Ctrl+Shift+N)"><Icon name="series" size={13} />New Series</button>
        <button className="btn small ghost" disabled={!selected.size} onClick={() => useStore.getState().select([])}>Clear</button>
      </div>
      <div className="selstrip-row" draggable={selected.size > 0}
        onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify([...useStore.getState().selected])); e.dataTransfer.effectAllowed = 'copy' }}>
        {list.map((p) => {
          const url = thumbUrl(p.id, p.thumbVer)
          return (
            <div key={p.id} className={'sthumb' + (placed(p) ? '' : ' nopos')} title={`${p.title || 'Untitled'} · ${p.publicId ?? p.rawKey}${placed(p) ? '' : ' · no position'}`}
              onClick={(e) => { if (e.ctrlKey || e.metaKey) { const s = useStore.getState(); const n = new Set(s.selected); n.delete(p.id); s.select(n) } else useStore.getState().set({ focusId: p.id }) }}>
              {url ? <img src={url} draggable={false} alt="" /> : <div className="ph" />}
            </div>
          )
        })}
        {selected.size > list.length && <div className="muted" style={{ alignSelf: 'center', padding: '0 10px' }}>+{(selected.size - list.length).toLocaleString()} more</div>}
      </div>
    </div>
  )
}
