import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'

type Row = Record<string, unknown>

type Mapping = {
  name?: string
  one_liner?: string
  profile_url?: string
  logo_url?: string
  yc_batch?: string
  website_url?: string
  location?: string
}

function toLowerKeys(row: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) out[k.toLowerCase()] = v
  return out
}

function detectMapping(headers: string[]): Mapping {
  const lowerHeaders = headers.map(h => h.toLowerCase())
  const set = new Set(lowerHeaders)
  const find = (cands: string[]) => cands.find(c => set.has(c))
  return {
    name: find(['name', 'company', 'company_name', 'title']),
    one_liner: find(['one_liner', 'tagline', 'description', 'blurb']),
    profile_url: find(['profile_url', 'yc_url', 'permalink', 'slug', 'yc_profile', 'link', 'url']),
    logo_url: find(['logo_url', 'logo', 'image']),
    yc_batch: find(['yc_batch', 'batch']),
    website_url: find(['website_url', 'website', 'homepage']),
    location: find(['location', 'city', 'hq', 'hq_location']),
  }
}

function str(val: unknown): string {
  return val == null ? '' : String(val)
}

function normalizeProfileUrl(v: string): string {
  const t = v.trim()
  if (!t) return t
  if (t.startsWith('/companies/')) return `https://www.ycombinator.com${t}`
  if (t.startsWith('companies/')) return `https://www.ycombinator.com/${t}`
  if (!/^https?:\/\//i.test(t) && /^[a-z0-9-]+$/i.test(t)) return `https://www.ycombinator.com/companies/${t}`
  return t
}

function truncate(v: string, n = 120): string {
  return v.length <= n ? v : v.slice(0, n - 1) + '…'
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error('Usage: npm run analyze:csv -- /absolute/path/to/file.csv')
    process.exit(1)
  }

  const buf = await readFile(filePath)
  const records = parse(buf, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
    relax_quotes: true,
  }) as Row[]

  if (!records.length) {
    console.log('No rows found')
    return
  }

  const headers = Object.keys(records[0])
  const mapping = detectMapping(headers)
  const lowerRecords = records.map(toLowerKeys)

  const colStats: Record<string, { nonEmpty: number; examples: string[] }> = {}
  for (const h of headers) colStats[h] = { nonEmpty: 0, examples: [] }

  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      const s = str(v).trim()
      if (s) {
        colStats[k].nonEmpty += 1
        if (colStats[k].examples.length < 5) colStats[k].examples.push(truncate(s))
      }
    }
  }

  const total = records.length

  const profKey = mapping.profile_url
  let duplicates = 0
  if (profKey) {
    const seen = new Set<string>()
    for (const r of lowerRecords) {
      const raw = str(r[profKey])
      const norm = normalizeProfileUrl(raw)
      if (!norm) continue
      const key = norm.toLowerCase()
      if (seen.has(key)) duplicates += 1
      else seen.add(key)
    }
  }

  console.log('CSV analysis:')
  console.log(`- Rows: ${total}`)
  console.log(`- Columns (${headers.length}): ${headers.join(', ')}`)

  console.log('\nPer-column non-empty counts and examples:')
  for (const h of headers) {
    const s = colStats[h]
    const pct = ((s.nonEmpty / total) * 100).toFixed(1)
    console.log(`  - ${h}: ${s.nonEmpty}/${total} (${pct}%)`)
    if (s.examples.length) console.log(`    e.g. ${s.examples.join(' | ')}`)
  }

  console.log('\nDetected mapping to schema:')
  console.log(mapping)

  console.log('\nMapping coverage:')
  for (const [field, key] of Object.entries(mapping)) {
    if (!key) {
      console.log(`  - ${field}: not detected`)
      continue
    }
    const nonEmpty = lowerRecords.reduce((acc, r) => (str(r[key]).trim() ? acc + 1 : acc), 0)
    const pct = ((nonEmpty / total) * 100).toFixed(1)
    console.log(`  - ${field} <- ${key}: ${nonEmpty}/${total} (${pct}%)`)
  }

  if (profKey) {
    console.log(`\nProfile URL duplicates (post-normalization): ${duplicates}`)
  }

  const mappedKeys = new Set(Object.values(mapping).filter(Boolean) as string[])
  const extra = headers.filter(h => !mappedKeys.has(h.toLowerCase()))
  if (extra.length) {
    console.log(`\nUnmapped columns: ${extra.join(', ')}`)
  }

  console.log('\nNote: This is a dry analysis; no data has been imported.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})


