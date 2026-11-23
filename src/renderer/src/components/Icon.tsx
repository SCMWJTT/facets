const P: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  table: 'M4 6h16M4 12h16M4 18h16M8 6v12',
  single: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  down: 'M6 9l6 6 6-6',
  right: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  up: 'M6 15l6-6 6 6',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  import: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  tree: 'M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  paste: 'M9 4h6v3H9zM8 5H5v16h14V5h-3',
  image: 'M4 4h16v16H4zM9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 15l-5-5L4 20',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  sortUp: 'M7 17V7M3 11l4-4 4 4M14 7h7M14 12h5M14 17h3',
  sortDown: 'M7 7v10M3 13l4 4 4-4M14 7h3M14 12h5M14 17h7',
  book: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  crosshair: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM22 12h-4M6 12H2M12 6V2M12 22v-4',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  people: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  merge: 'M7 3v6a5 5 0 0 0 5 5h5M17 14l-3-3M17 14l-3 3M7 21v-6',
  offline: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2-1.4M12 20h.01',
  hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  shoot: 'M3 7h18v13H3zM8 7V4h8v3',
  panelL: 'M4 4h16v16H4zM9 4v16',
  panelR: 'M4 4h16v16H4zM15 4v16',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7M8 21v-7h8v7',
  star: 'M12 2.5l2.6 6.2 6.6.5-5 4.4 1.5 6.5L12 16.6l-5.7 3.5 1.5-6.5-5-4.4 6.6-.5z',
  // Facets mark: a faceted gem.
  logo: 'M7 3.5h10l4.5 5.5L12 21 2.5 9z',
  gem: 'M7 3.5h10l4.5 5.5L12 21 2.5 9zM2.5 9h19M9.5 3.5L8 9l4 12 4-12-1.5-5.5',
  // The five Facets and the other objects (requirements 23.3).
  subject: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 16c0-5 3-8 8-8 0 5-3 8-8 8zM8 16l4-4',
  activity: 'M13 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7 21l3-6 3 2v4M10 15l1-5-3 1-2 3M11 10l3 2 3-1M3 12h3M2 16h4',
  event: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M12 12.5l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z',
  theme: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  series: 'M7 7h13v13H7zM4 4h13M4 4v13',
  set: 'M9 6h12M9 12h12M9 18h12M3 6l1.2 1.2L6.5 5M3 12l1.2 1.2L6.5 11M3 18l1.2 1.2L6.5 17',
  pinOff: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM4 4l16 16',
  pinFill: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z',
  placeTick: 'M3 7h11l3 5-3 5H3zM6.5 12l2 2 3.5-4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  globeTick: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  pencil: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
  ring: 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  map: 'M9 4l6 2 6-2v14l-6 2-6-2-6 2V6zM9 4v14M15 6v14',
  registry: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
  tack: 'M9 3h6M10 3v6l-3 4h10l-3-4V3M12 13v8',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  lasso: 'M4 4h16v16H4z',
  group: 'M4 6h10v10H4zM10 10h10v10H10z'
}

export function Icon({ name, size = 16, stroke = 1.6, fill = false, dash = false }: { name: string; size?: number; stroke?: number; fill?: boolean; dash?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash ? '2.5 2.5' : undefined} aria-hidden>
      <path d={P[name] ?? ''} />
    </svg>
  )
}

export function Star({ on, size = 13 }: { on: boolean; size?: number }) {
  return <Icon name="star" size={size} fill={on} stroke={on ? 0 : 1.5} />
}

/** The icon for a tree: each Facet has its own; Location is a pin; custom trees a branch. */
export function treeIcon(key: string, icon?: string): string {
  if (icon) return icon
  return ({ subject: 'subject', activity: 'activity', event: 'event', people: 'people', theme: 'theme', location: 'pin' } as Record<string, string>)[key] ?? 'tree'
}

/** The tint for a Facet's icon (design tokens --f-*). */
export function facetColor(key: string): string | undefined {
  return ({ subject: 'var(--f-subject)', activity: 'var(--f-activity)', event: 'var(--f-event)', people: 'var(--f-people)', theme: 'var(--f-theme)' } as Record<string, string>)[key]
}

/** The Facets mark: a faceted gem in amber tones. */
export function FacetsMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M7 3.5h10l4.5 5.5h-19z" fill="#f3c47f" />
      <path d="M2.5 9h19L12 21z" fill="#d4904a" />
      <path d="M8 9h8l-4 12z" fill="#e6a964" />
      <path d="M9.5 3.5h5L16 9H8z" fill="#f8d9a6" />
    </svg>
  )
}
