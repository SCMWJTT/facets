import { useEffect, useMemo, useState } from 'react'
import { call } from '../api'
import { useStore, EMPTY_FILTERS } from '../store'
import { Icon } from './Icon'

interface Reg {
  codes: { code: string; name: string; archived: boolean; issued: number }[]
  ids: { publicId: string; shootCode: string; number: number; rawKey: string; state: string; issuedAt: string; publishedName: string | null }[]
}

function csv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map((v) => {
    const s = v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\r\n')
}

function download(name: string, text: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function Registry() {
  const [reg, setReg] = useState<Reg | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: 'publicId', d: 1 })
  const rev = useStore((s) => s.shoots)
  const photos = useStore((s) => s.photos)
  const seriesList = useStore((s) => s.series)
  const [sreg, setSreg] = useState<{ publicId: string; title: string; state: string; issuedAt: string; titles: string[]; aliases: string[] }[]>([])
  useEffect(() => { void call<Reg>('registry').then(setReg) }, [rev, photos])
  useEffect(() => { void call<typeof sreg>('seriesRegistry').then(setSreg) }, [seriesList])

  const ids = useMemo(() => {
    if (!reg) return []
    const query = q.trim().toLowerCase()
    const list = reg.ids.filter((r) => !query || [r.publicId, r.rawKey, r.publishedName ?? ''].some((s) => s.toLowerCase().includes(query)))
    const key = sort.k as keyof Reg['ids'][number]
    return list.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * sort.d)
  }, [reg, q, sort])
  const codes = useMemo(() => (reg?.codes ?? []).filter((c) => !q.trim() || c.code.toLowerCase().includes(q.trim().toLowerCase()) || c.name.toLowerCase().includes(q.trim().toLowerCase())), [reg, q])

  if (!reg) return null
  const th = (k: string, l: string) => <th onClick={() => setSort({ k, d: sort.k === k ? (sort.d === 1 ? -1 : 1) : 1 })}>{l}{sort.k === k ? (sort.d === 1 ? ' ↑' : ' ↓') : ''}</th>
  const byRaw = new Map(photos.map((p) => [p.publicId, p]))
  return (
    <div className="explorer" style={{ gridTemplateColumns: '360px 1fr' }}>
      <section>
        <div className="ex-head"><h3>Shoot codes</h3><span className="muted">{reg.codes.length}</span></div>
        <div className="reg">
          <table>
            <thead><tr><th>Code</th><th>Shoot</th><th style={{ textAlign: 'right' }}>IDs</th></tr></thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code}>
                  <td className="mono" style={{ color: 'var(--accent)' }}>{c.code}</td>
                  <td>{c.name}{c.archived && <span className="tag" style={{ marginLeft: 6 }}>archived</span>}</td>
                  <td style={{ textAlign: 'right' }}>{c.issued}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!codes.length && <div className="empty">No shoot codes yet.</div>}
        </div>
        <div className="ex-head"><h3>Series IDs</h3><span className="muted">{sreg.length}</span>
          <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => download('facets-series-ids.csv', csv([['Series ID', 'Title', 'State', 'Issued', 'Earlier titles', 'Aliases'], ...sreg.map((r) => [r.publicId, r.title, r.state, r.issuedAt, r.titles.join(' | '), r.aliases.join(' | ')])]))}><Icon name="save" size={13} />CSV</button>
        </div>
        <div className="reg">
          <table>
            <thead><tr><th>Series ID</th><th>Title</th><th>State</th></tr></thead>
            <tbody>
              {sreg.filter((r) => !q.trim() || [r.publicId, r.title, ...r.titles, ...r.aliases].some((x) => x.toLowerCase().includes(q.trim().toLowerCase()))).map((r) => (
                <tr key={r.publicId} title={r.titles.length ? `Earlier titles: ${r.titles.join('; ')}` : undefined}>
                  <td className={'mono' + (r.state === 'retired' ? ' retired' : '')} style={{ color: 'var(--blue)' }}>{r.publicId}</td>
                  <td>{r.title}{r.titles.length > 0 && <span className="muted"> · was {r.titles[r.titles.length - 1]}</span>}{r.aliases.length > 0 && <span className="muted"> · alias {r.aliases.join(', ')}</span>}</td>
                  <td><span className={'tag ' + (r.state === 'active' ? 'ok' : 'warn')}>{r.state}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sreg.length && <div className="empty">No Series yet.</div>}
        </div>
      </section>
      <section>
        <div className="ex-head">
          <h3>Photo IDs</h3>
          <span className="muted">{reg.ids.length} issued · {reg.ids.filter((r) => r.state === 'retired').length} retired</span>
          <div className="search" style={{ width: 280, maxWidth: 'none' }}>
            <Icon name="search" size={15} />
            <input className="field" placeholder="Find by ID, raw key or published name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn small" onClick={() => download('facets-photo-ids.csv', csv([['Photo ID', 'Shoot code', 'Number', 'Raw key', 'Published name', 'State', 'Issued'], ...reg.ids.map((r) => [r.publicId, r.shootCode, r.number, r.rawKey, r.publishedName, r.state, r.issuedAt])]))}>
            <Icon name="save" size={13} />CSV
          </button>
        </div>
        <div className="reg">
          <table>
            <thead><tr>{th('publicId', 'Photo ID')}{th('rawKey', 'Raw key')}{th('publishedName', 'Published name')}{th('state', 'State')}{th('issuedAt', 'Issued')}</tr></thead>
            <tbody>
              {ids.slice(0, 3000).map((r) => {
                const p = byRaw.get(r.publicId)
                return (
                  <tr key={r.publicId} style={{ cursor: p ? 'pointer' : 'default' }} onDoubleClick={() => {
                    if (!p) return
                    const s = useStore.getState()
                    s.setSource({ kind: 'all' })
                    s.set({ filters: { ...EMPTY_FILTERS, text: r.publicId } })
                    s.select([p.id], p.id)
                  }}>
                    <td className={'mono' + (r.state === 'retired' ? ' retired' : '')}>{r.publicId}</td>
                    <td className="mono">{r.rawKey}</td>
                    <td className="mono">{r.publishedName ?? '—'}</td>
                    <td><span className={'tag ' + (r.state === 'active' ? 'ok' : 'warn')}>{r.state}</span></td>
                    <td>{new Date(r.issuedAt).toLocaleDateString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!ids.length && <div className="empty">{reg.ids.length ? 'Nothing matches.' : 'No IDs issued yet. Put photos in a shoot and use Assign names.'}</div>}
        </div>
      </section>
    </div>
  )
}
