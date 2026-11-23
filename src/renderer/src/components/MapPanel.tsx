import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import type { PhotoRow } from '@shared/types'
import { act } from '../api'
import { useStore } from '../store'
import { Icon } from './Icon'

const icon = (cls: string, size = 14) => L.divIcon({ className: '', html: `<div class="pin ${cls}"></div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })

/** The small Locate map (map tool 1). Series anchors (blue diamonds) are added with Series in stage 3. */
export function MapPanel({ photos, placing, onPlaced }: { photos: PhotoRow[]; placing: boolean; onPlaced: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const tiles = useRef<L.TileLayer | null>(null)
  const settings = useStore((s) => s.settings)!
  const mapLayer = useStore((s) => s.ui.mapLayer)
  const setUi = useStore((s) => s.setUi)
  const pinned = useStore((s) => s.ui.locMapPinned)
  const height = useStore((s) => s.ui.locMapH)
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  const boundsRef = useRef<L.LatLngExpression[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const placingRef = useRef(placing)
  placingRef.current = placing
  const idsRef = useRef<number[]>([])
  idsRef.current = photos.map((p) => p.id)

  useEffect(() => {
    const on = (): void => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])

  // Create the map once.
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([settings.mapCenter.lat, settings.mapCenter.lon], settings.mapCenter.zoom)
    layer.current = L.layerGroup().addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (!placingRef.current || !idsRef.current.length) return
      void act('setPosition', idsRef.current, round(e.latlng.lat), round(e.latlng.lng)).then(onPlaced)
    })
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => { ro.disconnect(); m.remove(); map.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current
    if (!m) return
    tiles.current?.remove()
    const t = settings.tiles[mapLayer]
    tiles.current = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: 19, crossOrigin: true }).addTo(m)
  }, [mapLayer, settings.tiles])

  useEffect(() => {
    if (el.current) el.current.style.cursor = placing ? 'crosshair' : ''
    const c = el.current?.querySelector('.leaflet-container') as HTMLElement | null
    if (c) c.style.cursor = placing ? 'crosshair' : ''
  }, [placing])

  // Draw pins for the selection.
  const key = photos.map((p) => `${p.id}:${p.lat}:${p.lon}:${p.camLat}:${p.camLon}`).join('|')
  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const placed = photos.filter((p) => p.lat !== null && p.lon !== null)
    const bounds: L.LatLngExpression[] = []
    const single = photos.length === 1
    if (placed.length > 60) {
      const cluster = (L as unknown as { markerClusterGroup: (o: object) => L.LayerGroup }).markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40 })
      for (const p of placed) cluster.addLayer(L.marker([p.lat!, p.lon!], { icon: icon('other', 10) }))
      g.addLayer(cluster)
      placed.forEach((p) => bounds.push([p.lat!, p.lon!]))
    } else {
      for (const p of placed) {
        const moved = p.camLat !== null && (Math.abs(p.camLat - p.lat!) > 1e-7 || Math.abs((p.camLon ?? 0) - p.lon!) > 1e-7)
        if (moved && single) {
          L.marker([p.camLat!, p.camLon!], { icon: icon('cam'), interactive: false }).addTo(g)
          L.polyline([[p.camLat!, p.camLon!], [p.lat!, p.lon!]], { color: '#ffffff', opacity: 0.35, weight: 1.5, dashArray: '4 4' }).addTo(g)
          bounds.push([p.camLat!, p.camLon!])
        }
        const mk = L.marker([p.lat!, p.lon!], { icon: icon(''), draggable: true, title: p.publicId ?? p.rawKey }).addTo(g)
        mk.on('dragend', () => {
          const ll = mk.getLatLng()
          void act('setPosition', [p.id], round(ll.lat), round(ll.lng))
        })
        bounds.push([p.lat!, p.lon!])
      }
    }
    boundsRef.current = bounds
    if (!pinnedRef.current) fit(m, bounds)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const y0 = e.clientY
    const h0 = height
    const move = (ev: MouseEvent): void => setUi({ locMapH: Math.max(140, Math.min(900, h0 + ev.clientY - y0)) })
    const up = (): void => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <div className="map-wrap">
    <div className="map" style={{ height }}>
      <div ref={el} style={{ height: '100%' }} />
      <div className="map-tools">
        <button className={'iconbtn small' + (pinned ? ' on' : '')} title={pinned ? 'Pinned: the map stays where you put it. Click to follow the selection again.' : 'Pin the map so it stops zooming to each selection'}
          onClick={() => setUi({ locMapPinned: !pinned })}><Icon name="tack" size={14} /></button>
        <button className="iconbtn small" title="Zoom to the selection" onClick={() => map.current && fit(map.current, boundsRef.current)}><Icon name="fit" size={14} /></button>
      </div>
      <div className="map-layers seg">
        <button className={mapLayer === 'street' ? 'on' : ''} onClick={() => setUi({ mapLayer: 'street' })}>Map</button>
        <button className={mapLayer === 'satellite' ? 'on' : ''} onClick={() => setUi({ mapLayer: 'satellite' })}>Satellite</button>
      </div>
      {!online && <div className="offline"><div><Icon name="offline" size={22} /><div style={{ marginTop: 6 }}>No internet connection, so map tiles can't load.<br />Typed coordinates still work.</div></div></div>}
    </div>
    <div className="map-resize" title="Drag to change the map height" onMouseDown={startResize} />
    </div>
  )
}

function fit(m: L.Map, bounds: L.LatLngExpression[]): void {
  if (bounds.length === 1) m.setView(bounds[0], Math.max(m.getZoom(), 15), { animate: true })
  else if (bounds.length > 1) m.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 17, animate: true })
}

export const round = (n: number): number => Math.round(n * 1e6) / 1e6

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000
  const toR = (d: number): number => (d * Math.PI) / 180
  const dLat = toR(b.lat - a.lat)
  const dLon = toR(b.lon - a.lon)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
