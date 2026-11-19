import { call } from '../api'
import { useStore } from '../store'
import { loadLibrary } from '../App'
import { FacetsMark, Icon } from './Icon'

export function Welcome() {
  const recent = useStore((s) => s.recent)
  const version = useStore((s) => s.version)
  const run = async (method: string, ...args: unknown[]): Promise<void> => {
    try {
      const r = await call(method, ...args)
      if (r) await loadLibrary()
    } catch (e) {
      useStore.getState().toast((e as Error).message, 'error')
    }
  }
  return (
    <div className="welcome" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="card" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="logo"><FacetsMark size={52} /></div>
        <h1>Facets</h1>
        <p>Organise, classify and publish your edited photographs.{version && ` Version ${version}.`}</p>
        <div className="actions">
          <button className="btn primary" onClick={() => void run('createLibrary')}><Icon name="plus" size={15} />New library…</button>
          <button className="btn" onClick={() => void run('openLibrary')}><Icon name="folder" size={15} />Open library…</button>
        </div>
        {recent.length > 0 && (
          <div className="recent">
            <div className="label" style={{ padding: '6px 8px 2px' }}>Recent</div>
            {recent.map((r) => (
              <div key={r} className="nav-item" onClick={() => void run('openLibrary', r)}>
                <Icon name="book" size={15} />
                <div className="lbl">
                  <div>{r.split(/[\\/]/).pop()?.replace(/\.facetslib$/i, '')}</div>
                  <div className="path">{r}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="copyright">© Cynmark Systems Limited. Facets and its concept are owned by Cynmark Systems Limited. All rights reserved.</div>
    </div>
  )
}
