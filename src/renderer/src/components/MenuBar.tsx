// The menu bar in the title bar (requirements 24.2). Compact text buttons with Alt access keys.
import { useEffect, useRef } from 'react'
import { seriesLabel } from '@shared/shortname'
import { LOCATION_STATES } from '@shared/types'
import { act, bridge, call } from '../api'
import { useStore, THUMB_PRESETS, type Workspace } from '../store'
import { loadLibrary } from '../App'
import { visibleTrees } from '../logic'
import { confirm, openMenuAt, type MenuItem } from './ui'
import * as cmd from '../commands'
import { startTaxonomyImport } from './Dialogs2'

const st = () => useStore.getState()

/** A command that arrives in a later build stage: shown, so the plan is visible, but disabled. */
const later = (label: string, stage: number, key?: string): MenuItem => ({ label, key: key ?? `stage ${stage}`, disabled: true })

async function libraryCall(method: string, ...args: unknown[]): Promise<void> {
  try {
    if (await call(method, ...args)) await loadLibrary()
  } catch (e) {
    st().toast((e as Error).message, 'error')
  }
}

export const WORKSPACES: [Workspace, string][] = [
  ['library', 'Library'],
  ['map', 'Map'],
  ['series', 'Series'],
  ['hierarchies', 'Hierarchies'],
  ['registry', 'Registry'],
  ['history', 'History']
]

function fileMenu(): MenuItem[] {
  const s = st()
  return [
    { label: 'New Library…', icon: 'plus', onClick: () => void libraryCall('createLibrary') },
    { label: 'Open Library…', icon: 'folder', onClick: () => void libraryCall('openLibrary') },
    {
      label: 'Open Recent',
      sub: () =>
        s.recent.length
          ? s.recent.map((r) => ({ label: r.split(/[\\/]/).pop()?.replace(/\.facetslib$/i, '') ?? r, key: '', onClick: () => void libraryCall('openLibrary', r) }))
          : [{ label: 'No recent libraries', disabled: true }]
    },
    {
      label: 'Close Library',
      onClick: async () => {
        if (await confirm('Close this library?', 'Everything is already saved.', 'Close library')) {
          await call('closeLibrary')
          await loadLibrary()
        }
      }
    },
    { sep: true },
    { label: 'Import Folder…', icon: 'import', key: 'Ctrl+I', onClick: () => s.openDialog('import') },
    later('Import Legend Library…', 4),
    {
      label: 'Import Lightroom Keyword List…',
      sub: () => [
        { head: 'Into which tree?' },
        ...visibleTrees(s).map((t) => ({ label: t.name, onClick: () => void act('importOutline', t.id) }))
      ]
    },
    { label: 'Import Tree File (JSON)…', icon: 'tree', onClick: () => void startTaxonomyImport() },
    { label: 'Export All Trees (JSON)…', onClick: async () => { const p = await call<string | null>('exportTaxonomy', null); if (p) st().toast(`Saved ${p}`) } },
    { label: 'Read Filter Manifest…', onClick: () => void act('readFilterManifest') },
    { sep: true },
    later('Export Site Snapshot', 7),
    later('Export Set Sidecar…', 7),
    later('Export AI Package…', 8),
    later('Import AI Patch…', 8),
    { sep: true },
    {
      label: 'Export Library Backup (JSON)…',
      icon: 'save',
      onClick: async () => {
        if (!(await confirm('Export a library backup?', 'The backup contains everything in the catalogue, including Private names, places and positions. Keep it somewhere safe and never publish it.', 'Choose where to save'))) return
        const p = await call<string | null>('exportBackup')
        if (p) st().toast(`Backup written to ${p}`)
      }
    },
    later('Restore from Backup…', 9),
    { sep: true },
    { label: 'Exit', onClick: () => bridge.window('quit') }
  ]
}

function editMenu(): MenuItem[] {
  const s = st()
  return [
    { label: s.canUndo ? `Undo ${s.canUndo}` : 'Undo', icon: 'undo', key: 'Ctrl+Z', disabled: !s.canUndo, onClick: () => void cmd.undo() },
    { label: s.canRedo ? `Redo ${s.canRedo}` : 'Redo', icon: 'redo', key: 'Ctrl+Y', disabled: !s.canRedo, onClick: () => void cmd.redo() },
    { sep: true },
    { label: 'Copy Fields', icon: 'copy', key: 'Ctrl+Shift+C', disabled: !s.focusId, onClick: cmd.copyFields },
    { label: 'Paste Fields…', icon: 'paste', key: 'Ctrl+Shift+V', disabled: !s.clipboard, onClick: () => cmd.pasteFields(false) },
    { label: 'Paste Again', key: 'Ctrl+Alt+V', disabled: !s.clipboard || !s.ui.pasteSpec, onClick: () => cmd.pasteFields(true) },
    { sep: true },
    { label: 'Select All', key: 'Ctrl+A', onClick: cmd.selectAll },
    { label: 'Select None', key: 'Ctrl+D', onClick: () => s.select([]) },
    { label: 'Invert Selection', onClick: cmd.invertSelection },
    { sep: true },
    { label: 'Find', icon: 'search', key: 'Ctrl+F', onClick: cmd.focusSearch },
    { sep: true },
    { label: 'Settings…', icon: 'settings', key: 'Ctrl+,', onClick: () => s.openDialog('settings') }
  ]
}

function viewMenu(): MenuItem[] {
  const s = st()
  const check = (on: boolean): string | undefined => (on ? 'check' : undefined)
  return [
    ...WORKSPACES.map(([w, l], i) => ({ label: l, icon: check(s.workspace === w), key: `Ctrl+${i + 1}`, onClick: () => s.set({ workspace: w }) })),
    { sep: true },
    { label: 'Grid', icon: check(s.view === 'grid'), key: 'G', onClick: () => s.set({ view: 'grid', workspace: 'library' }) },
    { label: 'Table', icon: check(s.view === 'table'), key: 'T', onClick: () => s.set({ view: 'table', workspace: 'library' }) },
    { label: 'Single', icon: check(s.view === 'single'), key: 'E', onClick: () => s.set({ view: 'single', workspace: 'library' }) },
    { sep: true },
    { label: 'Navigator', icon: check(s.ui.navOpen), onClick: () => s.setUi({ navOpen: !s.ui.navOpen }) },
    { label: 'Inspector', icon: check(s.ui.inspOpen), onClick: () => s.setUi({ inspOpen: !s.ui.inspOpen }) },
    later('Palettes', 5, 'Ctrl+P'),
    { label: 'Filter columns', icon: check(s.ui.showFacets), key: 'F', onClick: () => s.setUi({ showFacets: !s.ui.showFacets }) },
    { sep: true },
    {
      label: 'Thumbnails',
      sub: () => [
        { head: 'Presets' },
        ...Object.entries(THUMB_PRESETS).map(([k, p]) => ({ label: p.label, onClick: () => cmd.applyThumbPreset(k) })),
        { sep: true },
        { label: 'Footer lines, icons and size…', icon: 'eye', onClick: () => s.openDialog('thumbs') }
      ]
    },
    { label: 'Icon legend', icon: 'info', onClick: () => s.openDialog('legend') },
    { sep: true },
    { label: 'Full screen', key: 'F11', onClick: () => bridge.window('fullscreen') }
  ]
}

function organiseMenu(): MenuItem[] {
  const s = st()
  const manual = s.sets.filter((x) => x.kind === 'manual' && !x.archived)
  return [
    { label: 'New Working Group from Selection', icon: 'group', key: 'Ctrl+T', onClick: () => cmd.newGroup() },
    {
      label: 'Add to Working Group',
      sub: () =>
        s.groups.length
          ? s.groups.map((g) => ({ label: `${g.code}${g.name ? ` · ${g.name}` : ''}`, onClick: () => cmd.addToGroup(g.code) }))
          : [{ label: 'No working groups yet', disabled: true }]
    },
    { label: 'Clear All Working Groups', disabled: !s.groups.length, onClick: () => cmd.clearGroups() },
    { sep: true },
    { label: 'New Set from Selection…', icon: 'set', onClick: () => void cmd.newSet() },
    { label: 'New Set from Current View…', onClick: () => void cmd.newSetFromView() },
    {
      label: 'Add to Set',
      sub: () =>
        manual.length
          ? manual.map((x) => ({ label: x.name, onClick: () => { const ids = cmd.need(); if (ids) void act('addToSet', x.id, ids) } }))
          : [{ label: 'No sets yet', disabled: true }]
    },
    { sep: true },
    { label: 'New Shoot from Selection…', icon: 'camera', key: 'Ctrl+N', onClick: cmd.newShoot },
    { label: 'Assign Photo IDs', icon: 'hash', onClick: cmd.assignNames },
    { label: 'Withdraw Photo IDs', onClick: () => { const ids = cmd.need(); if (ids) void act('withdrawNames', ids) } },
    { sep: true },
    { label: 'New Series from Selection…', icon: 'series', key: 'Ctrl+Shift+N', onClick: cmd.newSeries },
    {
      label: 'Add to Series',
      sub: () =>
        s.series.length
          ? s.series.map((x) => ({ label: `${seriesLabel(x)} · ${x.title}`, onClick: () => { const ids = cmd.need(); if (ids) void act('addToSeries', x.id, ids) } }))
          : [{ label: 'No Series yet', disabled: true }]
    },
    {
      label: 'Apply Series keywords to members…',
      disabled: s.seriesTarget === null && s.source.kind !== 'series',
      onClick: () => s.openDialog('applySeries', { id: s.seriesTarget ?? (s.source as { id: number }).id })
    },
    { sep: true },
    {
      label: 'Set Location state',
      sub: () => LOCATION_STATES.map(([k, l]) => ({ label: l, onClick: () => { const ids = cmd.need(); if (ids) void act('setLocationState', ids, k) } }))
    }
  ]
}

function toolsMenu(): MenuItem[] {
  return [
    { label: 'Propose Shoots…', icon: 'camera', onClick: () => st().openDialog('proposeShoots', { ids: cmd.visibleIds }) },
    later('Suggest Locations…', 5),
    later('Privacy Audit', 7),
    later('Check Library', 9),
    later('Find Duplicates', 9),
    { label: 'Re-read Embedded Metadata…', onClick: () => { const ids = cmd.need(); if (ids) st().openDialog('reread', { ids }) } },
    {
      label: 'Tidy-up Report',
      sub: () => visibleTrees(st()).map((t) => ({ label: t.name, onClick: () => st().openDialog('tidy', { treeId: t.id }) }))
    },
    later('Promote Internal tags…', 7),
    { sep: true },
    later('Sites…', 7),
    later('Ready checks…', 9)
  ]
}

function helpMenu(): MenuItem[] {
  const s = st()
  return [
    { label: 'Keyboard shortcuts', icon: 'keyboard', key: '?', onClick: () => s.openDialog('shortcuts') },
    { label: 'Glossary', icon: 'book', onClick: () => s.openDialog('glossary') },
    { label: 'Workflow guide', onClick: () => s.openDialog('workflow') },
    { label: 'Open log folder', icon: 'folder', onClick: () => void call('openLogFolder') },
    { label: 'Licences', onClick: () => s.openDialog('about', { licences: true }) },
    { sep: true },
    { label: 'About Facets', icon: 'logo', onClick: () => s.openDialog('about') }
  ]
}

const MENUS: { key: string; label: string; access: string; items: () => MenuItem[] }[] = [
  { key: 'file', label: 'File', access: 'f', items: fileMenu },
  { key: 'edit', label: 'Edit', access: 'e', items: editMenu },
  { key: 'view', label: 'View', access: 'v', items: viewMenu },
  { key: 'organise', label: 'Organise', access: 'o', items: organiseMenu },
  { key: 'tools', label: 'Tools', access: 't', items: toolsMenu },
  { key: 'help', label: 'Help', access: 'h', items: helpMenu }
]

export function MenuBar() {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const m = MENUS.find((x) => x.access === e.key.toLowerCase())
      const el = m ? refs.current[m.key] : null
      if (!m || !el) return
      e.preventDefault()
      openMenuAt(el, m.items())
    }
    // Underline the access letters while Alt is held.
    const altOn = (e: KeyboardEvent): void => { if (e.key === 'Alt') document.body.classList.add('alt-keys') }
    const altOff = (e: KeyboardEvent): void => { if (e.key === 'Alt') document.body.classList.remove('alt-keys') }
    const blur = (): void => document.body.classList.remove('alt-keys')
    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', altOn)
    window.addEventListener('keyup', altOff)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', altOn)
      window.removeEventListener('keyup', altOff)
      window.removeEventListener('blur', blur)
    }
  }, [])
  return (
    <div className="menubar">
      {MENUS.map((m) => {
        const i = m.label.toLowerCase().indexOf(m.access)
        return (
          <button key={m.key} ref={(el) => { refs.current[m.key] = el }} onClick={(e) => openMenuAt(e.currentTarget, m.items())} title={`Alt+${m.access.toUpperCase()}`}>
            {m.label.slice(0, i)}<u>{m.label[i]}</u>{m.label.slice(i + 1)}
          </button>
        )
      })}
    </div>
  )
}
