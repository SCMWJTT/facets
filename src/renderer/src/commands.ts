import { act, call } from './api'
import { sel, useStore, THUMB_PRESETS, type TempGroup } from './store'
import { prompt, type MenuItem } from './components/ui'
import type { PhotoRow } from '@shared/types'

const st = () => useStore.getState()

export function need(min = 1): number[] | null {
  const ids = sel()
  if (ids.length < min) {
    st().toast(min === 1 ? 'Select one or more photos first' : `Select at least ${min} photos`, 'warn')
    return null
  }
  return ids
}

export const undo = () => act('undo')
export const redo = () => act('redo')

export function setRating(n: number): void {
  const ids = need()
  if (ids) void act('editFields', ids, [{ field: 'rating', value: n }], `Rating ${n}`)
}

export function copyFields(): void {
  const f = st().focusId
  if (!f) return st().toast('Select a photo to copy from', 'warn')
  st().set({ clipboard: f })
  const p = st().byId.get(f)
  st().toast(`Fields copied from ${p?.publicId ?? p?.rawKey}`)
}

export function pasteFields(again = false): void {
  const src = st().clipboard
  if (!src) return st().toast('Copy fields from a photo first (Ctrl+Shift+C)', 'warn')
  const ids = need()
  if (!ids) return
  const spec = st().ui.pasteSpec
  if (again && spec) void act('paste', src, ids, spec)
  else st().openDialog('paste')
}

/** The photos currently shown in the Library, in order (kept up to date by the Library view). */
export let visibleIds: number[] = []
export function setVisibleIds(ids: number[]): void {
  visibleIds = ids
}

export function selectAll(): void {
  st().set({ workspace: 'library' })
  st().select(visibleIds, st().focusId ?? visibleIds[0] ?? null)
}

export function invertSelection(): void {
  const cur = st().selected
  st().select(visibleIds.filter((id) => !cur.has(id)))
}

export function focusSearch(): void {
  st().set({ workspace: 'library' })
  setTimeout(() => (document.querySelector('.search input') as HTMLInputElement | null)?.focus(), 0)
}

export function applyThumbPreset(key: string): void {
  const p = THUMB_PRESETS[key]
  if (!p) return
  st().setUi({ footer: [...p.footer], icons: [...p.icons] })
  st().toast(`Thumbnails: ${p.label}`)
}

export function newShoot(): void {
  st().openDialog('shoot', { ids: sel() })
}

export function assignNames(): void {
  const ids = need()
  if (ids) void act('assignNames', ids)
}

export async function newSet(): Promise<void> {
  const ids = sel()
  const name = await prompt('New set', '', ids.length ? `The ${ids.length} selected photos will be added.` : undefined, 'Create')
  if (name) void act('createSet', name, ids)
}

export function revealFile(p?: PhotoRow): void {
  const photo = p ?? (st().focusId ? st().byId.get(st().focusId!) : undefined)
  if (photo) void call('revealFile', photo.filePath)
}

/** Context menu for photos (grid, table, single). */
export function photoMenu(): MenuItem[] {
  const n = st().selected.size
  const s = st()
  const items: MenuItem[] = [
    { head: n === 1 ? '1 photo' : `${n} photos` },
    { label: 'New shoot from selection…', icon: 'camera', key: 'Ctrl+N', onClick: newShoot },
    { label: 'Assign Photo IDs', icon: 'hash', onClick: assignNames },
    { sep: true },
    { label: 'Copy fields', icon: 'copy', key: 'Ctrl+Shift+C', onClick: copyFields, disabled: n !== 1 && !s.focusId },
    { label: 'Paste fields…', icon: 'paste', key: 'Ctrl+Shift+V', onClick: () => pasteFields(false), disabled: !s.clipboard },
    { label: 'Paste again', key: 'Ctrl+Alt+V', onClick: () => pasteFields(true), disabled: !s.clipboard || !s.ui.pasteSpec },
    { sep: true },
    { label: 'New working group (T…) from selection', icon: 'plus', key: 'Ctrl+T', onClick: () => newGroup() },
    ...s.groups.slice(-6).map((g) => ({ label: `Add to working group ${g.code}${g.name ? ` · ${g.name}` : ''}`, onClick: () => addToGroup(g.code) })),
    ...(s.source.kind === 'group'
      ? [{ label: `Remove from ${(s.source as { code: string }).code}`, icon: 'x', onClick: () => removeFromGroup((s.source as { code: string }).code) }]
      : []),
    { sep: true },
    { label: 'New set from selection…', icon: 'set', onClick: () => void newSet() },
    ...s.sets
      .filter((x) => x.kind === 'manual')
      .slice(0, 8)
      .map((x) => ({ label: `Add to "${x.name}"`, onClick: () => void act('addToSet', x.id, sel()) })),
    ...(s.source.kind === 'set'
      ? [{ label: 'Remove from this set', icon: 'x', onClick: () => void act('removeFromSet', (s.source as { id: number }).id, sel()) }]
      : []),
    { sep: true },
    { label: 'Reset to camera position', icon: 'reset', onClick: () => void act('resetToCamera', sel()) },
    { label: 'Show in Explorer', icon: 'folder', onClick: () => revealFile(), disabled: n !== 1 && !s.focusId }
  ]
  return items
}

// ---------------------------------------------------------------- Series

/** New Series from the selected photos (Ctrl+Shift+N). */
export function newSeries(): void {
  const ids = need()
  if (!ids) return
  st().openDialog('newSeries', { ids })
}

/** Make a Series the inspector's editing target; optionally show its photos in the Library. */
export function editSeries(id: number, showPhotos: boolean): void {
  const s = st()
  if (showPhotos) s.setSource({ kind: 'series', id })
  s.set({ seriesTarget: id })
  s.setUi({ inspTab: 'series', inspOpen: true })
}

/** New Set from everything shown in the current view (scope plus filters). */
export async function newSetFromView(): Promise<void> {
  if (!visibleIds.length) return st().toast('Nothing is shown in the current view', 'warn')
  const name = await prompt('New Set from the current view', '', `It will hold the ${visibleIds.length} photos shown now.`, 'Create')
  if (name) void act('createSet', name, visibleIds)
}

// ---------------------------------------------------------------- temporary working groups (T001, T002…)

function nextCode(groups: TempGroup[]): string {
  const max = groups.reduce((m, g) => Math.max(m, Number(g.code.replace(/\D/g, '')) || 0), 0)
  return 'T' + String(max + 1).padStart(3, '0')
}

/** New working group from the selection (Ctrl+T). Returns its code. */
export function newGroup(ids = sel()): string | null {
  if (!ids.length) {
    st().toast('Select one or more photos first', 'warn')
    return null
  }
  const groups = st().groups
  const code = nextCode(groups)
  st().setGroups([...groups, { code, name: '', ids: [...ids] }])
  st().toast(`Working group ${code} made with ${ids.length} photo${ids.length === 1 ? '' : 's'}`)
  return code
}

export function addToGroup(code: string, ids = sel()): void {
  if (!ids.length) return void st().toast('Select one or more photos first', 'warn')
  let added = 0
  st().setGroups(st().groups.map((g) => {
    if (g.code !== code) return g
    const have = new Set(g.ids)
    const extra = ids.filter((id) => !have.has(id))
    added = extra.length
    return { ...g, ids: [...g.ids, ...extra] }
  }))
  st().toast(`${added} photo${added === 1 ? '' : 's'} added to ${code}`)
}

export function removeFromGroup(code: string, ids = sel()): void {
  const drop = new Set(ids)
  let n = 0
  st().setGroups(st().groups.map((g) => {
    if (g.code !== code) return g
    const keep = g.ids.filter((id) => !drop.has(id))
    n = g.ids.length - keep.length
    return { ...g, ids: keep }
  }))
  st().toast(`${n} photo${n === 1 ? '' : 's'} removed from ${code}`)
}

export function deleteGroup(code: string): void {
  const s = st()
  s.setGroups(s.groups.filter((g) => g.code !== code))
  if (s.source.kind === 'group' && s.source.code === code) s.setSource({ kind: 'all' })
  const m = s.ui.map
  s.setUi({ map: { ...m, primary: m.primary === code ? 'view' : m.primary, secondary: m.secondary.filter((x) => x !== code) } })
  s.toast(`Working group ${code} deleted (the photos are not affected)`)
}

export function clearGroups(): void {
  const s = st()
  s.setGroups([])
  if (s.source.kind === 'group') s.setSource({ kind: 'all' })
  s.setUi({ map: { ...s.ui.map, primary: 'view', secondary: [] } })
  s.toast('All working groups cleared')
}

export async function renameGroup(code: string): Promise<void> {
  const g = st().groups.find((x) => x.code === code)
  if (!g) return
  const name = await prompt(`Name ${code}`, g.name, 'Optional. The code stays the same.', 'Save')
  if (name === null || name === undefined) return
  st().setGroups(st().groups.map((x) => (x.code === code ? { ...x, name: name.trim() } : x)))
}

export function selectGroup(code: string): void {
  const g = st().groups.find((x) => x.code === code)
  if (g) st().select(g.ids)
}

/** Make a working group permanent as a Set. */
export async function groupToSet(code: string): Promise<void> {
  const g = st().groups.find((x) => x.code === code)
  if (!g) return
  const name = await prompt('Save as a Set', g.name || code, `The ${g.ids.length} photos in ${code} will be kept as a Set.`, 'Create')
  if (name) void act('createSet', name, g.ids)
}
