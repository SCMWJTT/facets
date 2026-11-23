import { useEffect } from 'react'
import { bridge, call } from './api'
import { useStore, EMPTY_FILTERS, loadGroups, type Filters, type Source, type UiPrefs, type View } from './store'
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
import { SeriesWorkspace } from './components/SeriesWorkspace'
import { Dialogs } from './components/Dialogs'
import { PickerHost } from './components/NodePicker'
import { StatusBar } from './components/StatusBar'
import * as cmd from './commands'
import { useVisible } from './logic'
import { MapView } from './components/MapView'

export async function loadLibrary(): Promise<void> {
  const state = await call<{ library: { path: string; name: string } | null; recent: string[]; version: string }>('state')
  useStore.getState().setLibraryState(state)
  if (state.library) {
    const s = useStore.getState()
    s.loadSnapshot(await call<Snapshot>('snapshot'))
    {
      const have = useStore.getState().byId
      useStore.getState().set({ groups: loadGroups().map((g) => ({ ...g, ids: g.ids.filter((id) => have.has(id)) })) })
    }
    // Reopen where the owner left off: the last active Set (or other source), exactly as it was.
    try {
      const last = JSON.parse(localStorage.getItem('facets.last.' + state.library.path) ?? 'null') as Source | null
      const st = useStore.getState()
      const valid =
        last &&
        (last.kind === 'all' || last.kind === 'noShoot' || last.kind === 'locUnknown' || last.kind === 'pending' ||
          (last.kind === 'set' && st.sets.some((x) => x.id === last.id)) ||
          (last.kind === 'shoot' && st.shoots.some((x) => x.id === last.id)) ||
          (last.kind === 'series' && st.series.some((x) => x.id === last.id)) ||
          (last.kind === 'node' && st.nodes.some((x) => x.id === last.id)) ||
          (last.kind === 'group' && st.groups.some((x) => x.code === last.code)))
      if (valid) {
        st.setSource(last)
        if (last.kind === 'set') restoreSetState(last.id)
        st.set({ workspace: 'library' })
      }
    } catch {
      /* no remembered state */
    }
  }
}

/** Put back a Set's remembered filters, view, sort and grouping (or start it clean). */
function restoreSetState(id: number): void {
  const s = useStore.getState()
  const st = s.sets.find((x) => x.id === id)?.state as { filters?: Filters; view?: View; sort?: UiPrefs['sort']; groupBy?: string } | undefined
  s.set({ filters: st?.filters ?? EMPTY_FILTERS, ...(st?.view ? { view: st.view } : {}) })
  if (st?.sort || st?.groupBy) s.setUi({ ...(st.sort ? { sort: st.sort } : {}), ...(st.groupBy ? { groupBy: st.groupBy } : {}) })
}

/** Keep each Set's state and the last source saved as the owner works. */
let saveTimer: ReturnType<typeof setTimeout> | null = null
useStore.subscribe((now, prev) => {
  if (!now.library) return
  if (now.source !== prev.source) {
    localStorage.setItem('facets.last.' + now.library.path, JSON.stringify(now.source.kind === 'selection' ? { kind: 'all' } : now.source))
    if (now.source.kind === 'set' && !(prev.source.kind === 'set' && prev.source.id === now.source.id)) restoreSetState(now.source.id)
    else if (prev.source.kind === 'set' && now.source.kind !== 'set') useStore.getState().set({ filters: EMPTY_FILTERS })
  }
  const src = useStore.getState().source
  if (src.kind !== 'set') return
  const cur = useStore.getState()
  if (now.filters === prev.filters && now.view === prev.view && now.ui.sort === prev.ui.sort && now.ui.groupBy === prev.ui.groupBy && now.source === prev.source) return
  const id = src.id
  const state = { filters: cur.filters, view: cur.view, sort: cur.ui.sort, groupBy: cur.ui.groupBy }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void call('saveSetState', id, state).catch(() => undefined)
    useStore.setState({ sets: useStore.getState().sets.map((x) => (x.id === id ? { ...x, state } : x)) })
  }, 400)
})

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
      {(workspace === 'library' || workspace === 'map') && <LibraryWorkspace map={workspace === 'map'} />}
      {workspace === 'hierarchies' && <div className="main"><div className="grow" style={{ minWidth: 0 }}><Explorer /></div></div>}
      {workspace === 'registry' && <div className="main"><div className="grow" style={{ minWidth: 0 }}><Registry /></div></div>}
      {workspace === 'series' && <SeriesWorkspace />}
      {workspace === 'history' && <Coming icon="history" title="History" stage={9} text="Every operation, with filters, a preview and revert with conflict checks. Every change is already being recorded, so this history will reach back to today. Undo and redo work now (Ctrl+Z, Ctrl+Y)." />}
      <StatusBar />
      <Dialogs />
      <PickerHost />
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
      <div className="brand" title={`Library: ${library.path}`}>
        <FacetsMark size={17} />
        Facets
      </div>
      <MenuBar />
      <div className="spacer" />
      <div className="tb-actions">
        <button className="iconbtn" title={canUndo ? `Undo ${canUndo} (Ctrl+Z)` : 'Nothing to undo'} disabled={!canUndo} onClick={() => void cmd.undo()}><Icon name="undo" /></button>
        <button className="iconbtn" title={canRedo ? `Redo ${canRedo} (Ctrl+Y)` : 'Nothing to redo'} disabled={!canRedo} onClick={() => void cmd.redo()}><Icon name="redo" /></button>
        <button className="btn small" style={{ marginLeft: 6 }} onClick={() => open('import')}><Icon name="import" size={14} />Import</button>
      </div>
      <nav className="modules">
        {WORKSPACES.map(([w, l], i) => (
          <button key={w} className={workspace === w ? 'on' : ''} title={`${l} (Ctrl+${i + 1})`} onClick={() => set({ workspace: w })}>{l}</button>
        ))}
      </nav>
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
      if (ctrl && e.key === ',') { e.preventDefault(); s.openDialog('settings'); return }
      if (ctrl && k === 'f') { e.preventDefault(); cmd.focusSearch(); return }
      if (e.key === 'F11') { e.preventDefault(); bridge.window('fullscreen'); return }
      if (ctrl && e.shiftKey && k === 'n') { e.preventDefault(); cmd.newSeries(); return }
      if (ctrl && !e.shiftKey && k === 't' && !typing) { e.preventDefault(); cmd.newGroup(); return }
      if (ctrl && k === 'p') { e.preventDefault(); s.toast('Palettes arrive in build stage 5', 'warn'); return }
      if (!typing && !ctrl && !e.altKey && e.key === '?') { s.openDialog('shortcuts') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

function LibraryWorkspace({ map }: { map: boolean }) {
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
        {map ? <MapView visible={visible} /> : <LibraryView visible={visible} />}
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
      if (s.workspace === 'map') {
        if (k === 'escape' && s.selected.size) s.select([])
        return
      }
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
