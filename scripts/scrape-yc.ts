import 'dotenv/config'
import { chromium, type Page } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL as string
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string

if (!supabaseUrl || !serviceKey) {
  console.error('Missing required env vars: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey)

type Company = {
  name: string
  one_liner: string | null
  profile_url: string
  logo_url: string | null
  yc_batch: string | null
  website_url: string | null
  location: string | null
}

type AlgoliaCapture = {
  appId: string
  apiKey: string
  indexName: string
} | null

async function acceptCookieBanner(page: Page) {
  try {
    await page.locator('button:has-text("Accept")').first().click({ timeout: 3000 })
  } catch {
    // ignore
  }
}

async function scrapePage(page: Page): Promise<Company[]> {
  await page.waitForLoadState('domcontentloaded')
  await acceptCookieBanner(page)

  // Initialize a persistent collection in the page context to accumulate across virtualization
  await page.evaluate(() => {
    // @ts-expect-error attach accumulator on window
    if (!window.__ycCompanies) {
      // @ts-expect-error attach accumulator on window
      window.__ycCompanies = new Map<string, { name: string; one_liner: string | null; profile_url: string; logo_url: string | null; yc_batch: string | null; website_url: string | null; location: string | null }>()
    }
  })

  let stableIterations = 0
  let lastCollected = 0
  let bottomHits = 0
  const maxIterations = 3000

  for (let i = 0; i < maxIterations; i++) {
    // Collect currently rendered cards into the persistent map
    const collected = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href^="/companies/"]')) as HTMLAnchorElement[]
      const hrefRegex = /^\/companies\/[-a-z0-9]+$/i
      const seen = new Set<string>()
      for (const a of anchors) {
        const href = a.getAttribute('href') || ''
        if (!hrefRegex.test(href)) continue
        if (seen.has(href)) continue
        seen.add(href)
        const container = a.closest('article, div') || a
        const nameEl = (container.querySelector('h2, h3, [data-testid*="name" i], strong') as HTMLElement | null)
        const taglineEl = (container.querySelector('[data-testid*="tagline" i], p, div[class*="Tagline" i]') as HTMLElement | null)
        const logoEl = (container.querySelector('img') as HTMLImageElement | null)
        const batchEl = (container.querySelector('[data-testid*="batch" i], [class*="Batch" i]') as HTMLElement | null)
        const locationEl = (container.querySelector('[data-testid*="location" i], [class*="Location" i]') as HTMLElement | null)

        const nameText = nameEl?.textContent?.trim() || a.innerText.trim().split('\n').map(s => s.trim()).filter(Boolean)[0] || ''
        if (!nameText) continue
        const oneLinerText = taglineEl?.textContent?.trim() || null
        const profileUrl = href.startsWith('http') ? href : `https://www.ycombinator.com${href}`
        const logoUrl = logoEl?.src || null
        const batchText = batchEl?.textContent?.trim() || null
        const locationText = locationEl?.textContent?.trim() || null

        // @ts-expect-error use window accumulator
        window.__ycCompanies.set(href, {
          name: nameText,
          one_liner: oneLinerText,
          profile_url: profileUrl,
          logo_url: logoUrl,
          yc_batch: batchText,
          website_url: null,
          location: locationText,
        })
      }
      // @ts-expect-error use window accumulator size
      return window.__ycCompanies.size as number
    })

    if (collected === lastCollected) stableIterations++
    else stableIterations = 0
    lastCollected = collected

    // Attempt to scroll down incrementally
    const reachedBottom = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement
      const before = el.scrollTop
      el.scrollTop = el.scrollTop + Math.floor(window.innerHeight * 0.9)
      return el.scrollTop === before
    })
    if (reachedBottom) {
      bottomHits++
      // Try clicking any load more button
      const loadMore = page.locator('button:has-text("Load more"), button:has-text("Show more"), [data-testid*="load" i]')
      if (await loadMore.first().isVisible().catch(() => false)) {
        await loadMore.first().click().catch(() => {})
        await page.waitForLoadState('networkidle').catch(() => {})
      }
    }

    await page.waitForTimeout(400)

    // Break if we have been stable for many iterations and hit bottom multiple times
    if (stableIterations > 20 && bottomHits > 10) break
  }

  const companies = await page.evaluate(() => {
    // @ts-expect-error read window accumulator
    const arr = Array.from(window.__ycCompanies.values())
    return arr as { name: string; one_liner: string | null; profile_url: string; logo_url: string | null; yc_batch: string | null; website_url: string | null; location: string | null }[]
  })

  return companies
}

async function captureAlgoliaCredentials(page: Page): Promise<AlgoliaCapture> {
  return await new Promise<AlgoliaCapture>((resolve) => {
    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) resolve(null)
    }, 8000)

    page.on('request', (req) => {
      try {
        const url = req.url()
        if (!/algolia\.(net|io)\/1\/(indexes|indexes\/\*\/queries)/.test(url)) return
        const headers = req.headers()
        const appId = headers['x-algolia-application-id']
        const apiKey = headers['x-algolia-api-key']
        const postData = req.postData()
        if (!appId || !apiKey || !postData) return
        const body = JSON.parse(postData)
        const first = (body.requests && (body.requests[0] as { indexName?: string })) || null
        const indexName: string | undefined = first?.indexName
        if (!indexName) return
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          resolve({ appId, apiKey, indexName })
        }
      } catch {
        // ignore
      }
    })

    // Trigger activity
    void page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  })
}

async function scrapeByQueries(page: Page, queries: string[]): Promise<Company[]> {
  // Ensure accumulator exists
  await page.evaluate(() => {
    // @ts-expect-error attach accumulator on window
    if (!window.__ycCompanies) {
      // @ts-expect-error attach accumulator on window
      window.__ycCompanies = new Map<string, { name: string; one_liner: string | null; profile_url: string; logo_url: string | null; yc_batch: string | null; website_url: string | null; location: string | null }>()
    }
  })

  for (const q of queries) {
    // Focus search box and type query
    const input = page.locator('input[type="search"], input[placeholder*="Search" i], [data-testid*="search" i] input')
    if (await input.count() === 0) continue
    await input.first().fill('')
    await input.first().type(q, { delay: 50 })
    await page.waitForTimeout(800)

    // Load as much as possible for this query
    let stable = 0
    let lastCount = 0
    for (let i = 0; i < 80 && stable < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(400)
      const count = await page.evaluate(() => document.querySelectorAll('a[href^="/companies/"]').length)
      if (count === lastCount) stable++
      else stable = 0
      lastCount = count
    }

    // Collect currently visible for this query
    await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href^="/companies/"]')) as HTMLAnchorElement[]
      const hrefRegex = /^\/companies\/[-a-z0-9]+$/i
      const seen = new Set<string>()
      for (const a of anchors) {
        const href = a.getAttribute('href') || ''
        if (!hrefRegex.test(href)) continue
        if (seen.has(href)) continue
        seen.add(href)
        const container = a.closest('article, div') || a
        const nameEl = (container.querySelector('h2, h3, [data-testid*="name" i], strong') as HTMLElement | null)
        const taglineEl = (container.querySelector('[data-testid*="tagline" i], p, div[class*="Tagline" i]') as HTMLElement | null)
        const logoEl = (container.querySelector('img') as HTMLImageElement | null)
        const batchEl = (container.querySelector('[data-testid*="batch" i], [class*="Batch" i]') as HTMLElement | null)
        const locationEl = (container.querySelector('[data-testid*="location" i], [class*="Location" i]') as HTMLElement | null)

        const nameText = nameEl?.textContent?.trim() || a.innerText.trim().split('\n').map(s => s.trim()).filter(Boolean)[0] || ''
        if (!nameText) continue
        const oneLinerText = taglineEl?.textContent?.trim() || null
        const profileUrl = href.startsWith('http') ? href : `https://www.ycombinator.com${href}`
        const logoUrl = logoEl?.src || null
        const batchText = batchEl?.textContent?.trim() || null
        const locationText = locationEl?.textContent?.trim() || null

        // @ts-expect-error use window accumulator
        window.__ycCompanies.set(href, {
          name: nameText,
          one_liner: oneLinerText,
          profile_url: profileUrl,
          logo_url: logoUrl,
          yc_batch: batchText,
          website_url: null,
          location: locationText,
        })
      }
    })
  }

  const companies = await page.evaluate(() => {
    // @ts-expect-error read window accumulator
    return Array.from(window.__ycCompanies.values()) as { name: string; one_liner: string | null; profile_url: string; logo_url: string | null; yc_batch: string | null; website_url: string | null; location: string | null }[]
  })

  return companies
}

// removed: fetchAllFromAlgolia (replaced by segmented strategies)

async function fetchAllFromAlgoliaSegmentedByBatch(creds: NonNullable<AlgoliaCapture>): Promise<Company[]> {
  const { appId, apiKey, indexName } = creds
  const endpoint = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(indexName)}/query`

  type QueryResponse = { hits: Record<string, unknown>[]; nbPages: number; facets?: Record<string, Record<string, number>> }

  async function query(params: Record<string, unknown>): Promise<QueryResponse> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-algolia-api-key': apiKey,
        'x-algolia-application-id': appId,
      },
      body: JSON.stringify({ params: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() }),
    })
    if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`)
    const json = (await res.json()) as QueryResponse
    return json
  }

  // Get facet counts for batch if available
  let facetBatches: string[] = []
  try {
    const facetsResp = await query({ query: '', hitsPerPage: 0, facets: JSON.stringify(['batch']) })
    const facetMap = facetsResp.facets?.batch
    if (facetMap) facetBatches = Object.keys(facetMap)
  } catch {
    // ignore facet discovery errors
  }

  if (facetBatches.length === 0) return []

  const dedup = new Map<string, Record<string, unknown>>()

  for (const batch of facetBatches) {
    // Page through this batch
    let pageNum = 0
    while (true) {
      const resp = await query({ query: '', hitsPerPage: 1000, page: pageNum, facetFilters: JSON.stringify([[`batch:${batch}`]]) })
      for (const hit of resp.hits) {
        const key = String((hit.slug as string) || (hit.permalink as string) || (hit.url as string) || '')
        if (!dedup.has(key)) dedup.set(key, hit)
      }
      pageNum += 1
      if (pageNum >= (resp.nbPages || 1)) break
    }
  }

  const allHits = Array.from(dedup.values())
  const rows: Company[] = allHits.map((hRaw) => {
    const h = hRaw as Record<string, unknown>
    const slug = (h.slug as string) || (h.permalink as string) || ((h.url as string | undefined)?.replace(/^.*\/companies\//, '') ?? '')
    const profile_url = slug.startsWith('http') ? slug : `https://www.ycombinator.com/companies/${slug}`
    const name = (h.name as string) || (h.company_name as string) || (h.title as string) || ''
    const one_liner = (h.tagline as string) || (h.one_liner as string) || (h.description as string) || null
    const logo_url = (h.logo as string) || (h.logo_url as string) || (h.image as string) || null
    const yc_batch = (h.batch as string) || (h.yc_batch as string) || null
    const website_url = (h.website as string) || (h.website_url as string) || null
    const location = (h.location as string) || (h.location_city as string) || null
    return { name, one_liner, profile_url, logo_url, yc_batch, website_url, location }
  }).filter(r => r.name && r.profile_url)

  return rows
}

async function fetchAllFromAlgoliaByLetters(creds: NonNullable<AlgoliaCapture>): Promise<Company[]> {
  const { appId, apiKey, indexName } = creds
  const endpoint = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(indexName)}/query`

  async function query(params: Record<string, unknown>): Promise<{ hits: Record<string, unknown>[]; nbPages: number }> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-algolia-api-key': apiKey,
        'x-algolia-application-id': appId,
      },
      body: JSON.stringify({ params: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() }),
    })
    if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`)
    const json = (await res.json()) as { hits: unknown[]; nbPages: number }
    return { hits: json.hits as Record<string, unknown>[], nbPages: json.nbPages }
  }

  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
  const dedup = new Map<string, Record<string, unknown>>()
  for (const ch of letters) {
    let pageNum = 0
    while (true) {
      const resp = await query({ query: ch, hitsPerPage: 1000, page: pageNum })
      for (const hit of resp.hits) {
        const key = String((hit.slug as string) || (hit.permalink as string) || (hit.url as string) || '')
        if (!dedup.has(key)) dedup.set(key, hit)
      }
      pageNum += 1
      if (pageNum >= (resp.nbPages || 1)) break
    }
  }

  const allHits = Array.from(dedup.values())
  const rows: Company[] = allHits.map((hRaw) => {
    const h = hRaw as Record<string, unknown>
    const slug = (h.slug as string) || (h.permalink as string) || ((h.url as string | undefined)?.replace(/^.*\/companies\//, '') ?? '')
    const profile_url = slug.startsWith('http') ? slug : `https://www.ycombinator.com/companies/${slug}`
    const name = (h.name as string) || (h.company_name as string) || (h.title as string) || ''
    const one_liner = (h.tagline as string) || (h.one_liner as string) || (h.description as string) || null
    const logo_url = (h.logo as string) || (h.logo_url as string) || (h.image as string) || null
    const yc_batch = (h.batch as string) || (h.yc_batch as string) || null
    const website_url = (h.website as string) || (h.website_url as string) || null
    const location = (h.location as string) || (h.location_city as string) || null
    return { name, one_liner, profile_url, logo_url, yc_batch, website_url, location }
  }).filter(r => r.name && r.profile_url)

  return rows
}

function generateBigrams(): string[] {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
  const queries: string[] = []
  for (const a of alphabet) {
    for (const b of alphabet) {
      queries.push(a + b)
    }
  }
  return queries
}

async function fetchAllFromAlgoliaByQueries(creds: NonNullable<AlgoliaCapture>, queries: string[]): Promise<Company[]> {
  const { appId, apiKey, indexName } = creds
  const endpoint = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(indexName)}/query`

  async function query(params: Record<string, unknown>): Promise<{ hits: Record<string, unknown>[]; nbPages: number }> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-algolia-api-key': apiKey,
        'x-algolia-application-id': appId,
      },
      body: JSON.stringify({ params: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() }),
    })
    if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`)
    const json = (await res.json()) as { hits: unknown[]; nbPages: number }
    return { hits: json.hits as Record<string, unknown>[], nbPages: json.nbPages }
  }

  const dedup = new Map<string, Record<string, unknown>>()
  for (const q of queries) {
    let pageNum = 0
    while (true) {
      const resp = await query({ query: q, hitsPerPage: 1000, page: pageNum })
      for (const hit of resp.hits) {
        const key = String((hit.slug as string) || (hit.permalink as string) || (hit.url as string) || '')
        if (!dedup.has(key)) dedup.set(key, hit)
      }
      pageNum += 1
      if (pageNum >= (resp.nbPages || 1)) break
    }
  }

  const allHits = Array.from(dedup.values())
  const rows: Company[] = allHits.map((hRaw) => {
    const h = hRaw as Record<string, unknown>
    const slug = (h.slug as string) || (h.permalink as string) || ((h.url as string | undefined)?.replace(/^.*\/companies\//, '') ?? '')
    const profile_url = slug.startsWith('http') ? slug : `https://www.ycombinator.com/companies/${slug}`
    const name = (h.name as string) || (h.company_name as string) || (h.title as string) || ''
    const one_liner = (h.tagline as string) || (h.one_liner as string) || (h.description as string) || null
    const logo_url = (h.logo as string) || (h.logo_url as string) || (h.image as string) || null
    const yc_batch = (h.batch as string) || (h.yc_batch as string) || null
    const website_url = (h.website as string) || (h.website_url as string) || null
    const location = (h.location as string) || (h.location_city as string) || null
    return { name, one_liner, profile_url, logo_url, yc_batch, website_url, location }
  }).filter(r => r.name && r.profile_url)

  return rows
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
  const apifyToken = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN
  if (process.env.USE_APIFY === '1' && apifyToken) {
    const url = `https://api.apify.com/v2/acts/scraped~y-combinator-scraper/run-sync-get-dataset-items?token=${apifyToken}`
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
    if (!res.ok) throw new Error(`Apify HTTP ${res.status}`)
    const items = (await res.json()) as Record<string, unknown>[]
    const rows: Company[] = items.map((it) => {
      const i = it as Record<string, unknown>
      const name = String(i.title ?? i.name ?? '')
      const one_liner = (i.tagline as string) || (i.description as string) || null
      const profile_url = String(i.url ?? i.link ?? '')
      const logo_url = (i.logo as string) || (i.logo_url as string) || null
      const yc_batch = (i.batch as string) || null
      const website_url = (i.website as string) || null
      const location = (i.location as string) || null
      return { name, one_liner, profile_url, logo_url, yc_batch, website_url, location }
    }).filter(r => r.name && r.profile_url)
    console.log(`Scraped ${rows.length} companies`)
    await insertCompanies(rows)
    return
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto('https://www.ycombinator.com/companies', { waitUntil: 'domcontentloaded' })
  // Try to capture Algolia creds and use API for full listing; fallback to DOM scraper
  const creds = await captureAlgoliaCredentials(page)
  let companies: Company[] = []
  if (creds) {
    companies = await fetchAllFromAlgoliaSegmentedByBatch(creds)
    if (companies.length < 2000) {
      // Fallback to letter-union if batches facet missing or incomplete
      const letterSet = await fetchAllFromAlgoliaByLetters(creds)
      const bigramSet = await fetchAllFromAlgoliaByQueries(creds, generateBigrams())
      const map = new Map<string, Company>()
      for (const c of [...companies, ...letterSet, ...bigramSet]) map.set(c.profile_url, c)
      companies = Array.from(map.values())
    }
    if (companies.length < 4000) {
      // Additional DOM-based multi-query fallback to bypass API limits
      const domSet = await scrapeByQueries(page, ['a','e','i','o','u', ...'bcdfghjklmnpqrstvwxyz'.split(''), ...'0123456789'.split('')])
      const map = new Map<string, Company>()
      for (const c of [...companies, ...domSet]) map.set(c.profile_url, c)
      companies = Array.from(map.values())
    }
  } else {
    companies = await scrapePage(page)
    if (companies.length < 2000) {
      // DOM-based multi-query fallback
      const domSet = await scrapeByQueries(page, ['a','e','i','o','u', ...'bcdfghjklmnpqrstvwxyz'.split(''), ...'0123456789'.split('')])
      const map = new Map<string, Company>()
      for (const c of [...companies, ...domSet]) map.set(c.profile_url, c)
      companies = Array.from(map.values())
    }
  }
  console.log(`Scraped ${companies.length} companies`)
  await insertCompanies(companies)
  await browser.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})


