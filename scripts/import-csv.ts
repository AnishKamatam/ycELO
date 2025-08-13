import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'

type Company = {
  name: string
  one_liner: string | null
  profile_url: string
  logo_url: string | null
  yc_batch: string | null
  website_url: string | null
  location: string | null
}

const supabaseUrl = process.env.VITE_SUPABASE_URL as string
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string

if (!supabaseUrl || !serviceKey) {
  console.error('Missing required env vars: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey)

function normalizeUrl(maybeUrl: string | null | undefined): string | null {
  if (!maybeUrl) return null
  const v = String(maybeUrl).trim()
  if (!v) return null
  // If a YC slug/path, make absolute
  if (v.startsWith('/companies/')) return `https://www.ycombinator.com${v}`
  if (v.startsWith('companies/')) return `https://www.ycombinator.com/${v}`
  if (!/^https?:\/\//i.test(v) && /(^[a-z0-9-]+$)/i.test(v)) {
    return `https://www.ycombinator.com/companies/${v}`
  }
  return v
}

function normalizeWebsiteUrl(maybeUrl: string | null | undefined): string | null {
  if (!maybeUrl) return null
  let v = String(maybeUrl).trim()
  if (!v) return null
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`
  // remove trailing slash (except root)
  if (v.length > 1 && v.endsWith('/')) v = v.slice(0, -1)
  return v
}

function pick<T extends Record<string, unknown>>(row: T, keys: string[]): string | null {
  for (const k of keys) {
    const val = row[k]
    if (val === undefined || val === null) continue
    const s = String(val).trim()
    if (s) return s
  }
  return null
}

function mapRowToCompany(row: Record<string, unknown>): Company | null {
  // Normalize keys to lower-case for flexible matching
  const lower: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) lower[k.toLowerCase()] = v

  const name = pick(lower, ['name', 'company', 'company_name', 'title'])
  const one_liner = pick(lower, ['one_liner', 'tagline', 'description', 'blurb'])
  // Prefer YC "slug" as stable profile key when present
  const profileRaw = pick(lower, ['slug', 'profile_url', 'yc_url', 'permalink', 'yc_profile', 'link', 'url'])
  // Prefer small_logo_thumb_url from the dataset if available
  const logo_url = pick(lower, ['small_logo_thumb_url', 'logo_url', 'logo', 'image'])
  const yc_batch = pick(lower, ['batch', 'yc_batch'])
  const website_url_raw = pick(lower, ['website', 'website_url', 'homepage'])
  // Location: use all_locations first, else regions/0 if present
  const all_locations = pick(lower, ['all_locations'])
  const regions0 = pick(lower, ['regions/0'])
  const location = all_locations || regions0 || pick(lower, ['location', 'city', 'hq', 'hq_location'])

  const profile_url = normalizeUrl(profileRaw)
  const website_url = normalizeWebsiteUrl(website_url_raw)

  if (!name || !profile_url) return null

  return {
    name,
    one_liner,
    profile_url,
    logo_url: logo_url ? logo_url : null,
    yc_batch: yc_batch ? yc_batch : null,
    website_url: website_url ? website_url : null,
    location: location ? location : null,
  }
}

async function insertCompanies(rows: Company[]) {
  if (rows.length === 0) return
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await supabase.from('companies').upsert(chunk, {
      onConflict: 'profile_url',
      ignoreDuplicates: false,
    })
    if (error) throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry') || process.env.DRY_RUN === '1'
  const limitArg = args.find(a => a.startsWith('--limit='))
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined
  const filePath = args.find(a => !a.startsWith('--'))
  if (!filePath) {
    console.error('Usage: npm run import:csv -- [--dry] [--limit=N] /absolute/path/to/file.csv')
    process.exit(1)
  }

  const csvBuf = await readFile(filePath)
  const records = parse(csvBuf, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
    relax_quotes: true,
  }) as Record<string, unknown>[]

  const src = typeof limit === 'number' ? records.slice(0, limit) : records
  const mapped: Company[] = []
  for (const rec of src) {
    const m = mapRowToCompany(rec)
    if (m) mapped.push(m)
  }

  console.log(`Read ${records.length} rows (${src.length} considered), mapped ${mapped.length} rows`)
  if (dryRun) {
    console.log('Dry run only. Sample mapped rows:')
    console.log(JSON.stringify(mapped.slice(0, 10), null, 2))
    return
  }
  await insertCompanies(mapped)
  console.log('Import complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})


