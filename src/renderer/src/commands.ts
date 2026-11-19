import { act, call } from './api'
import { sel, useStore, THUMB_PRESETS } from './store'
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
