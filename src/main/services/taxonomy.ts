// Tree files (facets-taxonomy/1, requirements 22.5), cross-references and the tidy-up report.
// A tree file can be exported from one library and imported into another (or a later version),
// keeping node IDs where they are free, so test keyword trees can be reused across versions.
import type { Library, Tx } from '../db/library'
import type { Domain, TaxonomyPreview, TidyReport, TNode, Tree } from '@shared/types'
import { createNode, createTree, readNodes, readTrees, FACET_TREES } from './catalog'

export interface TaxNode {
  id?: string
  label: string
  shortCode?: string
  aliases?: string[]
  refs?: Record<string, string>
  crossRefs?: string[]
  description?: string
  domain?: Domain
  children?: TaxNode[]
}

export interface TaxTree {
  format: 'facets-taxonomy/1'
  tree: { key: string; name: string; kind: Tree['kind']; entriesPerPhoto: 'one' | 'many'; levels: string[]; domain: Domain; definition?: string }
  nodes: TaxNode[]
}

export interface TaxSet {
  format: 'facets-taxonomy-set/1'
  exportedAt: string
  trees: TaxTree[]
}

// ---------------------------------------------------------------- export

export function exportTaxonomy(lib: Library, treeId: number): TaxTree {
  const tree = readTrees(lib).find((t) => t.id === treeId)
  if (!tree) throw new Error('That tree no longer exists.')
  const nodes = readNodes(lib).filter((n) => n.treeId === treeId && !n.retired)
  const byId = new Map(readNodes(lib).map((n) => [n.id, n]))
  const kids = new Map<number | null, TNode[]>()
  for (const n of nodes) {
    const a = kids.get(n.parentId) ?? []
    a.push(n)
    kids.set(n.parentId, a)
  }
  const walk = (p: number | null): TaxNode[] =>
    (kids.get(p) ?? [])
      .sort((x, y) => x.sortOrder - y.sortOrder || x.label.localeCompare(y.label))
      .map((n) => {
        const out: TaxNode = { id: n.publicId, label: n.label }
        if (n.shortCode) out.shortCode = n.shortCode
        if (n.aliases.length) out.aliases = n.aliases
        if (Object.keys(n.refs).length) out.refs = n.refs
        if (n.xrefs.length) out.crossRefs = n.xrefs.map((x) => byId.get(x)?.publicId).filter((x): x is string => !!x)
        if (n.description) out.description = n.description
        if (n.domain) out.domain = n.domain
        const c = walk(n.id)
        if (c.length) out.children = c
        return out
      })
  return {
    format: 'facets-taxonomy/1',
    tree: {
      key: tree.key,
      name: tree.name,
      kind: tree.kind,
      entriesPerPhoto: tree.multi ? 'many' : 'one',
      levels: tree.levels,
      domain: tree.domainDefault,
      definition: tree.definition || undefined
    },
    nodes: walk(null)
  }
}

export function exportAllTaxonomies(lib: Library): TaxSet {
  return {
    format: 'facets-taxonomy-set/1',
    exportedAt: new Date().toISOString(),
    trees: readTrees(lib).filter((t) => !t.archived).map((t) => exportTaxonomy(lib, t.id))
  }
}

// ---------------------------------------------------------------- import

/** Accept a single tree file or a whole set of trees. */
export function parseTaxonomy(text: string): TaxTree[] {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new Error('That file is not a readable tree file (it is not valid JSON).')
  }
  const d = doc as { format?: string; trees?: TaxTree[] }
  if (d.format === 'facets-taxonomy/1') return [doc as TaxTree]
  if (d.format === 'facets-taxonomy-set/1' && Array.isArray(d.trees)) return d.trees
  throw new Error('That file is not a Facets tree file (expected format facets-taxonomy/1 or facets-taxonomy-set/1).')
}

interface Plan {
  preview: TaxonomyPreview
}

/**
 * Walk the file against the library. With tx = null nothing is written (the preview);
 * with a tx the same walk applies the changes, so the preview always matches what happens.
 * Matching is by node ID, then by label or alias under the same parent.
 */
function walkImport(lib: Library, trees: TaxTree[], tx: Tx | null): Plan {
  const preview: TaxonomyPreview = { trees: [], xrefs: 0, problems: [] }
  const existingTrees = readTrees(lib)
  const pendingXrefs: [number | string, string][] = [] // [node (id or temp key), other public id]
  let temp = 0
  for (const tt of trees) {
    if (!tt?.tree?.key || !Array.isArray(tt.nodes)) {
      preview.problems.push('A tree in the file has no key or no nodes and was skipped.')
      continue
    }
    const key = tt.tree.key.toLowerCase()
    let tree = existingTrees.find((t) => t.key === key)
    const row = { key, name: tt.tree.name || key, exists: !!tree, newNodes: 0, matched: 0, updated: 0 }
    preview.trees.push(row)
    let treeId: number | null = tree?.id ?? null
    if (!tree && tx) {
      const isFacet = FACET_TREES.some((f) => f.key === key)
      treeId = createTree(tx, lib, {
        key,
        name: row.name,
        multi: tt.tree.entriesPerPhoto !== 'one',
        kind: isFacet ? (key === 'location' ? 'location' : 'facet') : 'legacy',
        hidden: false,
        levels: tt.tree.levels ?? [],
        domainDefault: tt.tree.domain ?? 'public',
        definition: tt.tree.definition ?? '',
        hasPosition: key === 'location'
      })
      tree = readTrees(lib).find((t) => t.id === treeId)
    }
    const nodes = treeId === null ? [] : readNodes(lib).filter((n) => n.treeId === treeId)
    const byPublic = new Map(nodes.map((n) => [n.publicId.toLowerCase(), n]))
    const usedAnywhere = (pid: string): boolean => !!lib.db.prepare('SELECT 1 FROM nodes WHERE public_id = ? COLLATE NOCASE').get(pid)
    const findUnder = (parent: number | null, n: TaxNode): TNode | undefined => {
      const names = [n.label, ...(n.aliases ?? [])].map((x) => x.trim().toLowerCase())
      return nodes.find(
        (x) => x.parentId === parent && !x.retired && (names.includes(x.label.toLowerCase()) || x.aliases.some((a) => names.includes(a.toLowerCase())))
      )
    }
    const visit = (list: TaxNode[], parent: number | null, parentIsNew: boolean): void => {
      for (const n of list) {
        if (!n?.label?.trim()) continue
        let match: TNode | undefined
        if (!parentIsNew) {
          match = n.id ? byPublic.get(n.id.toLowerCase()) : undefined
          if (match && match.treeId !== treeId) match = undefined
          if (!match) match = findUnder(parent, n)
        }
        let id: number | string
        if (match) {
          row.matched++
          id = match.id
          const aliases = [...new Set([...match.aliases, ...(n.aliases ?? [])])].filter((a) => a.toLowerCase() !== match!.label.toLowerCase())
          const changes: [string, unknown][] = []
          if (aliases.length !== match.aliases.length) changes.push(['aliases', JSON.stringify(aliases)])
          if (n.shortCode && !match.shortCode) changes.push(['short_code', n.shortCode.toUpperCase()])
          if (n.description && !match.description) changes.push(['description', n.description])
          if (n.refs && Object.keys(n.refs).some((k) => match!.refs[k] !== n.refs![k])) changes.push(['refs', JSON.stringify({ ...match.refs, ...n.refs })])
          if (changes.length) row.updated++
          if (tx) for (const [c, v] of changes) tx.set('nodes', match.id, c, v)
        } else {
          row.newNodes++
          if (tx && treeId !== null) {
            const nid = createNode(tx, lib, treeId, typeof parent === 'number' ? parent : null, n.label)
            // Keep the file's node ID when it is free, so trees round-trip between libraries.
            if (n.id && /^[a-z0-9]+-\d{4,}$/i.test(n.id) && !usedAnywhere(n.id)) {
              tx.set('nodes', nid, 'public_id', n.id.toLowerCase())
              const num = Number(n.id.split('-').pop())
              lib.db.prepare('UPDATE trees SET next_public = MAX(next_public, ?) WHERE id = ?').run(num + 1, treeId)
            }
            if (n.aliases?.length) tx.set('nodes', nid, 'aliases', JSON.stringify(n.aliases))
            if (n.shortCode) {
              const code = n.shortCode.toUpperCase()
              if (!lib.db.prepare('SELECT 1 FROM nodes WHERE tree_id = ? AND short_code = ?').get(treeId, code)) tx.set('nodes', nid, 'short_code', code)
            }
            if (n.description) tx.set('nodes', nid, 'description', n.description)
            if (n.refs) tx.set('nodes', nid, 'refs', JSON.stringify(n.refs))
            if (n.domain) tx.set('nodes', nid, 'domain', n.domain)
            id = nid
          } else id = `new-${temp++}`
        }
        for (const x of n.crossRefs ?? []) pendingXrefs.push([id, x])
        if (n.children?.length) visit(n.children, typeof id === 'number' ? id : null, typeof id !== 'number')
      }
    }
    visit(tt.nodes, null, treeId === null)
  }
  // Cross-references are resolved once every tree is in place.
  for (const [a, other] of pendingXrefs) {
    const b = lib.db.prepare('SELECT id FROM nodes WHERE public_id = ? COLLATE NOCASE').get(other) as { id: number } | undefined
    const otherInFile = trees.some((t) => JSON.stringify(t.nodes).toLowerCase().includes(`"id":"${other.toLowerCase()}"`))
    if (!b && !otherInFile) continue
    if (typeof a === 'number' && b) {
      if (!lib.db.prepare('SELECT 1 FROM node_xrefs WHERE (node_id = ? AND other_node_id = ?) OR (node_id = ? AND other_node_id = ?)').get(a, b.id, b.id, a)) {
        preview.xrefs++
        if (tx) addXref(tx, lib, a, b.id)
      }
    } else preview.xrefs++
  }
  return { preview }
}

export function previewTaxonomyImport(lib: Library, trees: TaxTree[]): TaxonomyPreview {
  return walkImport(lib, trees, null).preview
}

export function applyTaxonomyImport(tx: Tx, lib: Library, trees: TaxTree[]): TaxonomyPreview {
  return walkImport(lib, trees, tx).preview
}

// ---------------------------------------------------------------- cross-references

export function addXref(tx: Tx, lib: Library, a: number, b: number): boolean {
  if (a === b) return false
  const ta = lib.db.prepare('SELECT tree_id FROM nodes WHERE id = ?').get(a) as { tree_id: number } | undefined
  const tb = lib.db.prepare('SELECT tree_id FROM nodes WHERE id = ?').get(b) as { tree_id: number } | undefined
  if (!ta || !tb) return false
  if (ta.tree_id === tb.tree_id) throw new Error('Cross-references link entries in different trees (for example Subject Cocoa and Activity Cocoa harvesting).')
  if (lib.db.prepare('SELECT 1 FROM node_xrefs WHERE (node_id = ? AND other_node_id = ?) OR (node_id = ? AND other_node_id = ?)').get(a, b, b, a)) return false
  tx.insert('node_xrefs', { node_id: a, other_node_id: b, kind: 'related' })
  tx.touchedTables.add('nodes')
  return true
}

export function removeXref(tx: Tx, lib: Library, a: number, b: number): boolean {
  const r = lib.db.prepare('SELECT id FROM node_xrefs WHERE (node_id = ? AND other_node_id = ?) OR (node_id = ? AND other_node_id = ?)').get(a, b, b, a) as
    | { id: number }
    | undefined
  if (!r) return false
  tx.delete('node_xrefs', r.id)
  tx.touchedTables.add('nodes')
  return true
}

// ---------------------------------------------------------------- tidy-up report

export function tidyReport(lib: Library, treeId: number): TidyReport {
  const all = readNodes(lib)
  const byId = new Map(all.map((n) => [n.id, n]))
  const nodes = all.filter((n) => n.treeId === treeId && !n.retired)
  const path = (n: TNode): string => {
    const parts: string[] = []
    let c: TNode | undefined = n
    while (c) {
      parts.unshift(c.label)
      c = c.parentId !== null ? byId.get(c.parentId) : undefined
    }
    return parts.join(' › ')
  }
  // In use: assigned to a photo, used by a Series, or with a used descendant.
  const used = new Set<number>()
  const direct = lib.db
    .prepare(
      `SELECT node_id AS id FROM photo_nodes UNION SELECT node_id FROM series_nodes UNION SELECT node_id FROM series_places
       UNION SELECT primary_node_id FROM series WHERE primary_node_id IS NOT NULL`
    )
    .all() as { id: number }[]
  for (const d of direct) {
    let c: TNode | undefined = byId.get(d.id)
    while (c) {
      used.add(c.id)
      c = c.parentId !== null ? byId.get(c.parentId) : undefined
    }
  }
  const unused = nodes.filter((n) => !used.has(n.id) && !nodes.some((k) => k.parentId === n.id)).map((n) => ({ id: n.id, path: path(n) }))
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .replace(/(ies)$/, 'y')
      .replace(/(es|s)$/, '')
  const groups = new Map<string, TNode[]>()
  for (const n of nodes) {
    for (const name of [n.label, ...n.aliases]) {
      const k = norm(name)
      if (!k) continue
      const g = groups.get(k) ?? []
      if (!g.includes(n)) g.push(n)
      groups.set(k, g)
    }
  }
  const seen = new Set<string>()
  const similar: TidyReport['similar'] = []
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const key = g.map((n) => n.id).sort().join(',')
    if (seen.has(key)) continue
    seen.add(key)
    similar.push({ ids: g.map((n) => n.id), paths: g.map(path) })
  }
  return { unused, similar }
}
