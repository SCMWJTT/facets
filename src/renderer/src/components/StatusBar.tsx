import { call } from '../api'
import { useStore } from '../store'
import { create } from 'zustand'

export const useShown = create<{ n: number }>(() => ({ n: 0 }))

export function StatusBar() {
  const total = useStore((s) => s.photos.length)
  const selected = useStore((s) => s.selected.size)
  const p = useStore((s) => s.progress)
  const workspace = useStore((s) => s.workspace)
  const open = useStore((s) => s.openDialog)
  return (
    <div className="statusbar">
      {workspace === 'library' ? <Shown /> : <span>{total.toLocaleString()} photos</span>}
      <span>{selected ? `${selected.toLocaleString()} selected` : ''}</span>
      <span className="grow" />
      {p.importTotal > 0 && (
        <span className="task">Importing {p.importDone}/{p.importTotal}<span className="bar"><i style={{ width: `${(100 * p.importDone) / p.importTotal}%` }} /></span></span>
      )}
      {p.thumbTotal > 0 && (
        <span className="task">
          {p.thumbPaused ? 'Thumbnails paused' : 'Making thumbnails'} {p.thumbDone}/{p.thumbTotal}
          <span className="bar"><i style={{ width: `${(100 * p.thumbDone) / Math.max(1, p.thumbTotal)}%` }} /></span>
          <button className="linkbtn" onClick={() => void call('pauseThumbs', !p.thumbPaused)}>{p.thumbPaused ? 'Resume' : 'Pause'}</button>
        </span>
      )}
      <button className="linkbtn" onClick={() => open('shortcuts')}>Shortcuts ?</button>
    </div>
  )
}

function Shown() {
  const n = useShown((s) => s.n)
  const total = useStore((s) => s.photos.length)
  const source = useStore((s) => s.source)
  const sets = useStore((s) => s.sets)
  const shoots = useStore((s) => s.shoots)
  let scope = 'All library'
  if (source.kind === 'set') scope = `Set: ${sets.find((x) => x.id === source.id)?.name ?? ''}`
  else if (source.kind === 'shoot') { const sh = shoots.find((x) => x.id === source.id); scope = `Shoot: ${sh ? `${sh.code} · ${sh.name}` : ''}` }
  else if (source.kind === 'node') scope = 'Keyword'
  else if (source.kind === 'noShoot') scope = 'Not in a Shoot'
  else if (source.kind === 'locUnknown') scope = 'Location unknown'
  else if (source.kind === 'pending') scope = 'Pending review'
  return (
    <span>
      <b style={{ color: 'var(--text2)', fontWeight: 500 }}>{scope}</b> · {n === total ? `${total.toLocaleString()} photos` : `${n.toLocaleString()} of ${total.toLocaleString()} photos shown`}
    </span>
  )
}
