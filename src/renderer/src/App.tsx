import { useEffect } from 'react'
import { bridge, call } from './api'
import { useStore } from './store'
import type { Delta, Snapshot } from '@shared/types'
import { FacetsMark, Icon } from './components/Icon'
import { MenuBar, WORKSPACES } from './components/MenuBar'
import { AskHost, MenuHost, Splitter, Toasts } from './components/ui'
import { Welcome } from './components/Welcome'
import { Navigator } from './components/Navigator'
import { LibraryView } from './components/LibraryView'
import { Inspector } from './components/Inspector'
import { Explorer } from './components/Explorer'
import { Registry } from './components/Registry'
import { Dialogs } from './components/Dialogs'
import { StatusBar } from './components/StatusBar'
import * as cmd from './commands'
import { useVisible } from './logic'

export async function loadLibrary(): Promise<void> {
  const state = await call<{ library: { path: string; name: string } | null; recent: string[]; version: string }>('state')
  useStore.getState().setLibraryState(state)
  if (state.library) useStore.getState().loadSnapshot(await call<Snapshot>('snapshot'))
}

export function App() {
  const library = useStore((s) => s.library)
  const workspace = useStore((s) => s.workspace)

  useEffect(() => {
    void loadLibrary()
    const offs = [
      bridge.on('progress', (p) => {
        const e = p as { task: string; done: number; total: number; label: string }
        const s = useStore.getState()
        s.set({ progress: { ...s.progress, importDone: e.done, importTotal: e.total, importLabel: e.label } })
      }),
      bridge.on('thumbs', (p) => {
        const e = p as { updates: { id: number; ver: number }[]; done: number; total: number; paused: boolean }
        const s = useStore.getState()
        s.setThumbs(e.updates)
        s.set({ progress: { ...s.progress, thumbDone: e.done, thumbTotal: e.total, thumbPaused: e.paused } })
      }),
      bridge.on('delta', (d) => useStore.getState().applyDelta(d as Delta))
    ]
    return () => offs.forEach((o) => o())
  }, [])

  useGlobalKeys(!!library)

  if (!library) return <><Welcome /><Dialogs /><MenuHost /><Toasts /><AskHost /></>

  return (
    <div className="app">
      <TitleBar />
      {workspace === 'library' && <LibraryWorkspace />}
      {workspace === 'hierarchies' && <div className="main"><div className="grow" style={{ minWidth: 0 }}><Explorer /></div></div>}
      {workspace === 'registry' && <div className="main"><div className="grow" style={{ minWidth: 0 }}><Registry /></div></div>}
      {workspace === 'map' && <Coming icon="map" title="Map" stage={6} text="The full-screen geographic workspace: layers for photos, Shoots, Series and places, lasso selection kept in step with the grid, the missing-location lane and a timeline. Until then, the Locate tab in the inspector places photos." />}
      {workspace === 'series' && <Coming icon="series" title="Series" stage={3} text="Editorial collections, each with one Primary Facet: cards with covers, counts and status, the overlap check and the full Series editor." />}
      {workspace === 'history' && <Coming icon="history" title="History" stage={9} text="Every operation, with filters, a preview and revert with conflict checks. Every change is already being recorded, so this history will reach back to today. Undo and redo work now (Ctrl+Z, Ctrl+Y)." />}
      <StatusBar />
      <Dialogs />
      <MenuHost />
      <AskHost />
      <Toasts />
    </div>
  )
}

function TitleBar() {
  const library = useStore((s) => s.library)!
  const workspace = useStore((s) => s.workspace)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const set = useStore((s) => s.set)
  const open = useStore((s) => s.openDialog)
  return (
    <div className="titlebar">
      <div className="brand" title={library.path}>
        <FacetsMark size={17} />
        Facets <span className="lib">{library.name}</span>
      </div>
      <MenuBar />
      <div className="tabs">
        {WORKSPACES.map(([w, l], i) => (
          <button key={w} className={workspace === w ? 'on' : ''} title={`Ctrl+${i + 1}`} onClick={() => set({ workspace: w })}>{l}</button>
        ))}
      </div>
      <div className="spacer" />
      <div className="tb-actions">
        <button className="iconbtn" title={canUndo ? `Undo ${canUndo} (Ctrl+Z)` : 'Nothing to undo'} disabled={!canUndo} onClick={() => void cmd.undo()}><Icon name="undo" /></button>
        <button className="iconbtn" title={canRedo ? `Redo ${canRedo} (Ctrl+Y)` : 'Nothing to redo'} disabled={!canRedo} onClick={() => void cmd.redo()}><Icon name="redo" /></button>
        <button className="btn small primary" style={{ marginLeft: 8 }} onClick={() => open('import')}><Icon name="import" size={14} />Import</button>
        <button className="iconbtn" title="Settings" onClick={() => open('settings')}><Icon name="settings" /></button>
      </div>
    </div>
  )
}

/** A workspace that arrives in a later build stage. */
function Coming({ icon, title, stage, text }: { icon: string; title: string; stage: number; text: string }) {
  return (
    <div className="main">
      <div className="grow coming">
        <div className="card">
          <div style={{ color: 'var(--accent)', marginBottom: 14 }}><Icon name={icon} size={38} stroke={1.2} /></div>
          <h2>{title}</h2>
          <div className="muted" style={{ marginBottom: 14 }}>Arrives in build stage {stage}.</div>
          <div>{text}</div>
        </div>
      </div>
    </div>
  )
}

/** Shortcuts that work in every workspace. */
function useGlobalKeys(active: boolean) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if (s.dialog) return
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (ctrl && !e.shiftKey && !e.altKey && /^[1-6]$/.test(e.key)) { e.preventDefault(); s.set({ workspace: WORKSPACES[Number(e.key) - 1][0] }); return }
      if (ctrl && !e.shiftKey && k === 'z' && !typing) { e.preventDefault(); void cmd.undo(); return }
      if (ctrl && (k === 'y' || (e.shiftKey && k === 'z')) && !typing) { e.preventDefault(); void cmd.redo(); return }
      if (ctrl && k === 'i') { e.preventDefault(); s.openDialog('import'); return }
      if (ctrl && k === 'f') { e.preventDefault(); cmd.focusSearch(); return }
      if (e.key === 'F11') { e.preventDefault(); bridge.window('fullscreen'); return }
      if (ctrl && e.shiftKey && k === 'n') { e.preventDefault(); s.toast('Series arrive in build stage 3', 'warn'); return }
      if (ctrl && k === 'p') { e.preventDefault(); s.toast('Palettes arrive in build stage 5', 'warn'); return }
      if (!typing && !ctrl && !e.altKey && e.key === '?') { s.openDialog('shortcuts') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

function LibraryWorkspace() {
  const ui = useStore((s) => s.ui)
  const setUi = useStore((s) => s.setUi)
  const visible = useVisible()
  const ids = visible.list.map((p) => p.id)
  cmd.setVisibleIds(ids)
  useKeys(ids)
  return (
    <div className="main">
      {ui.navOpen && (
        <>
          <div className="panel nav" style={{ width: ui.navWidth }}>
            <Navigator />
          </div>
          <Splitter side="l" onDrag={(dx) => setUi({ navWidth: Math.max(190, Math.min(480, useStore.getState().ui.navWidth + dx)) })} />
        </>
      )}
      <div className="center">
        <LibraryView visible={visible} />
      </div>
      {ui.inspOpen && (
        <>
          <Splitter side="r" onDrag={(dx) => setUi({ inspWidth: Math.max(290, Math.min(560, useStore.getState().ui.inspWidth + dx)) })} />
          <div className="panel insp" style={{ width: ui.inspWidth }}>
            <Inspector />
          </div>
        </>
      )}
    </div>
  )
}

/** Library keyboard shortcuts. Arrow keys are handled by the grid itself. */
function useKeys(order: number[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if (s.dialog) return
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (typing) return
      if (ctrl && e.shiftKey && k === 'c') { e.preventDefault(); cmd.copyFields(); return }
      if (ctrl && e.shiftKey && k === 'v') { e.preventDefault(); cmd.pasteFields(false); return }
      if (ctrl && e.altKey && k === 'v') { e.preventDefault(); cmd.pasteFields(true); return }
      if (ctrl && k === 'a') { e.preventDefault(); s.select(order, s.focusId ?? order[0] ?? null); return }
      if (ctrl && k === 'd') { e.preventDefault(); s.select([]); return }
      if (ctrl && !e.shiftKey && k === 'n') { e.preventDefault(); cmd.newShoot(); return }
      if (ctrl || e.altKey) return
      if (/^[0-5]$/.test(e.key)) { cmd.setRating(Number(e.key)); return }
      if (k === 'g') s.set({ view: 'grid' })
      else if (k === 'e' || k === ' ') { e.preventDefault(); s.set({ view: s.view === 'single' ? 'grid' : 'single' }) }
      else if (k === 't') s.set({ view: 'table' })
      else if (k === 'tab') { e.preventDefault(); s.setUi({ navOpen: !(s.ui.navOpen && s.ui.inspOpen), inspOpen: !(s.ui.navOpen && s.ui.inspOpen) }) }
      else if (k === 'f') s.setUi({ showFacets: !s.ui.showFacets })
      else if (k === 'escape') {
        if (s.view === 'single') s.set({ view: 'grid' })
        else if (s.selected.size) s.select([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order])
}
