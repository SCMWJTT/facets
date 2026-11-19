// Types shared by the main process (database side) and the interface.

export type Status = 'draft' | 'ready' | 'published' | 'withdrawn'
export type Precision = 'exact' | 'rounded' | 'approximate' | 'hidden'
export type PosSource = 'camera' | 'hand' | 'node' | 'none'
export type Domain = 'public' | 'private' | 'internal'
export type Privacy = 'inherit' | 'public' | 'private' | 'internal'
export type LocationState =
  | 'known'
  | 'approximate'
  | 'unknown'
  | 'missing_gps'
  | 'hidden'
  | 'not_retained'
  | 'not_applicable'

export const LOCATION_STATES: [LocationState, string][] = [
  ['known', 'Known'],
  ['approximate', 'Approximate'],
  ['unknown', 'Unknown'],
  ['missing_gps', 'Missing GPS'],
  ['hidden', 'Hidden'],
  ['not_retained', 'Not retained'],
  ['not_applicable', 'Not applicable']
]

/** One node assignment on a photo. */
export interface PhotoNode {
  node: number
  domain: Domain
}

/** One photo as held in memory by the interface. */
export interface PhotoRow {
  id: number // Photo record ID (internal, permanent)
  rawKey: string
  variantNo: number
  publicId: string | null // Photo ID, e.g. ASHW-00001
  publishedName: string | null
  status: Status
  title: string
  caption: string
  note: string
  alt: string
  rating: number
  creator: string
  copyright: string
  licence: string
  credit: string
  shootId: number | null
  lat: number | null
  lon: number | null
  elevation: number | null
  camLat: number | null
  camLon: number | null
  camEle: number | null
  posSource: PosSource
  showElevation: boolean
  precision: Precision
  locationState: LocationState
  people: boolean
  privatePlace: boolean
  privacy: Privacy
  captured: string | null // local time as recorded by the camera, "YYYY-MM-DDTHH:mm:ss"
  width: number
  height: number
  cameraBody: string
  lens: string
  focal: number | null
  aperture: number | null
  shutter: string
  iso: number | null
  filePath: string
  fileOffline: boolean
  filterBatch: string
  thumbVer: number // 0 = no thumbnail yet
  importedAt: string
  modifiedAt: string
  exportedAt: string | null
  nodes: number[] // node ids assigned (only the chosen nodes, not ancestors)
  internal: number[] // the subset of nodes assigned in the Internal domain
  privateNodes: number[] // the subset of nodes assigned in the Private domain
  sets: number[]
  series: number[]
  sites: number[] // sites the photo has been published to
}

/** Editable photo fields and their database columns. */
export const PHOTO_FIELDS = {
  title: 'title',
  caption: 'caption',
  note: 'note',
  alt: 'alt',
  rating: 'rating',
  creator: 'creator',
  copyright: 'copyright',
  licence: 'licence',
  credit: 'credit',
  status: 'status',
  lat: 'lat',
  lon: 'lon',
  elevation: 'elevation',
  posSource: 'pos_source',
  showElevation: 'show_elevation',
  precision: 'precision',
  locationState: 'location_state',
  people: 'people',
  privatePlace: 'private_place',
  privacy: 'privacy'
} as const
export type EditableField = keyof typeof PHOTO_FIELDS

export type TreeKind = 'facet' | 'location' | 'legacy'

/** A classification tree: one of the five Facets, the Location tree, or a legacy tree. */
export interface Tree {
  id: number
  key: string
  name: string
  kind: TreeKind
  icon: string
  definition: string
  multi: boolean
  levels: string[]
  hasPosition: boolean
  domainDefault: Domain
  sortOrder: number
  archived: boolean
  hidden: boolean
}

export interface TNode {
  id: number
  treeId: number
  parentId: number | null
  publicId: string
  label: string
  aliases: string[]
  shortCode: string
  description: string
  coverPhotoId: number | null
  sortOrder: number
  refs: Record<string, string>
  lat: number | null
  lon: number | null
  zoom: number | null
  domain: Domain | '' // '' = the tree's default
  hidden: boolean
  retired: boolean
}

export interface Shoot {
  id: number
  code: string
  name: string
  description: string
  coverPhotoId: number | null
  timeZone: string
  clockOffsetMin: number
  privacy: Privacy
  archived: boolean
  nextNumber: number
}

/** Editorial collection (records exist from stage 3; the type is here so the model is complete). */
export interface Series {
  id: number
  publicId: string
  title: string
  slug: string
  summary: string
  primaryNodeId: number | null
  privacy: Privacy
  coverPhotoId: number | null
  status: Status
}

export interface PhotoSet {
  id: number
  name: string
  kind: 'import' | 'manual'
  createdAt: string
  archived: boolean
}

export interface ImportRecord {
  id: number
  at: string
  folder: string
  scanned: number
  added: number
  known: number
  changed: number
  variants: number
  skipped: number
  setId: number | null
  report: ImportReport
}

export interface ImportReport {
  added: string[]
  known: string[]
  changed: string[]
  variants: string[]
  replaced: string[]
  relinked: string[]
  skipped: { file: string; reason: string }[]
  flags: { file: string; message: string }[]
  locationRetained?: boolean
  setCreated?: boolean
}

/** Two files in one import with the same raw key. */
export interface DuplicateGroup {
  rawKey: string
  files: string[]
}
export type DuplicateChoice = 'variant' | 'replace'

export interface Settings {
  creator: string
  copyright: string
  licence: string
  credit: string
  rawKeyPattern: string // regex with one capture group, or '' for the plain file name
  keywordRoots: Record<string, string> // Lightroom top-level keyword -> tree key ('' root mapping = unmapped)
  unmappedRootsTo: string // tree key for hierarchical keywords whose root is not mapped
  seedLocationFromIptc: boolean
  nameTemplate: string
  defaultTimeZone: string
  suggestDistanceM: number
  tiles: {
    street: { url: string; attribution: string }
    satellite: { url: string; attribution: string }
  }
  mapCenter: { lat: number; lon: number; zoom: number }
}

export interface LibraryInfo {
  path: string
  name: string
  schemaVersion: number
  photoCount: number
}

export interface Snapshot {
  photos: PhotoRow[]
  trees: Tree[]
  nodes: TNode[]
  shoots: Shoot[]
  series: Series[]
  sets: PhotoSet[]
  imports: ImportRecord[]
  settings: Settings
  canUndo: string | null
  canRedo: string | null
}

/** Partial update pushed to the interface after any change. */
export interface Delta {
  photos?: PhotoRow[]
  removedPhotos?: number[]
  trees?: Tree[]
  nodes?: TNode[]
  shoots?: Shoot[]
  series?: Series[]
  sets?: PhotoSet[]
  imports?: ImportRecord[]
  settings?: Settings
  full?: boolean // the interface should reload everything
  canUndo: string | null
  canRedo: string | null
  message?: string
}

export interface ActionResult {
  ok: boolean
  message: string
  delta?: Delta
  data?: unknown
}

export type TextMode = 'replace' | 'prepend' | 'append' | 'findReplace'

export interface FieldEdit {
  field: EditableField
  value: unknown
  mode?: TextMode
  find?: string
}

export interface HistoryEntry {
  at: string
  label: string
  field: string
  oldValue: unknown
  newValue: unknown
  undone: boolean
}

export interface ProgressEvent {
  task: 'import' | 'thumbs'
  done: number
  total: number
  label: string
  paused?: boolean
}

export interface PasteSpec {
  fields: EditableField[]
  trees: { id: number; mode: 'add' | 'replace' }[]
  shoot: boolean
}

export interface AppInfo {
  version: string
  buildDate: string
  libraryPath: string | null
  userData: string
  logFolder: string | null
  components: { name: string; version: string; licence: string }[]
}
