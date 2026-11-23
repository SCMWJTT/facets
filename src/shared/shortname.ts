/** Series short names: unique, at most 10 characters (shown as "SER-12: Short"). */
export const SHORT_MAX = 10

const SMALL = new Set(['a', 'an', 'the', 'of', 'and', 'to', 'in', 'on', 'at', 'from', 'for', 'with', 'by'])

/** Suggest a short name from a title that does not clash with any name in `taken` (compared ignoring case). */
export function suggestShortName(title: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()))
  const words = title.replace(/['’`]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean)
  const main = words.filter((w) => !SMALL.has(w.toLowerCase()))
  const pool = main.length ? main : words
  let base = ''
  for (const w of pool) {
    const next = base ? `${base} ${w}` : w
    if (next.length > SHORT_MAX) break
    base = next
  }
  if (!base) base = (pool[0] ?? 'Series').slice(0, SHORT_MAX)
  if (!used.has(base.toLowerCase())) return base
  for (let i = 2; i < 1000; i++) {
    const suf = String(i)
    const cand = `${base.slice(0, SHORT_MAX - suf.length).trimEnd()}${suf}`
    if (!used.has(cand.toLowerCase())) return cand
  }
  return base
}

/** "SER-000012" → 12 */
export const seriesNumber = (publicId: string): number => Number(publicId.replace(/\D/g, '')) || 0

/** "SER-12: Short" */
export const seriesLabel = (s: { publicId: string; shortName: string }): string => `SER-${seriesNumber(s.publicId)}: ${s.shortName}`
