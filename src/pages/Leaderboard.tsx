import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Company } from '../types'
import { Link } from 'react-router-dom'

export default function Leaderboard() {
  const [rows, setRows] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)
      const q = query.trim()
      const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_')

      let res
      if (escaped) {
        // Server-side search across name and profile_url
        res = await supabase
          .from('companies')
          .select('*')
          .eq('status', 'Active')
          .or(`name.ilike.%${escaped}%,profile_url.ilike.%/companies/${escaped}%`)
          .order('elo_rating', { ascending: false })
          .order('elo_games_count', { ascending: false })
          .order('name', { ascending: true })
          .limit(25)
      } else {
        // Top 25 leaderboard
        res = await supabase
          .from('companies')
          .select('*')
          .eq('status', 'Active')
          .order('elo_rating', { ascending: false })
          .order('elo_games_count', { ascending: false })
          .order('name', { ascending: true })
          .limit(25)
      }

      setLoading(false)
      if (res.error) setError(res.error.message)
      else setRows((res.data as Company[]) || [])
    }

    // Debounce a bit for better UX
    const t = setTimeout(fetchData, 250)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 48 }}>
      <h1 style={{ fontSize: 40, fontWeight: 900, marginBottom: 16, textAlign: 'center', color: '#000' }}>Leaderboard</h1>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 24 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search YC company"
          style={{ width: 360, padding: '10px 12px', borderRadius: 10, border: '1px solid #000', fontSize: 16 }}
        />
        <Link to="/"><button>Back to Voting</button></Link>
      </div>
      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 16, textAlign: 'center' }}>{error}</div>}
      {loading ? (
        <div style={{ textAlign: 'center' }}>Loading…</div>
      ) : (
        <ol style={{ listStyle: 'decimal', paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {rows.length === 0 ? (
            <div style={{ textAlign: 'center', width: '100%' }}>No results</div>
          ) : rows.map((c) => (
            <li key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {c.logo_url ? <img src={c.logo_url} alt={c.name} style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', border: '1px solid #000' }} /> : <div style={{ width: 40, height: 40, background: '#f3f4f6', borderRadius: 8, border: '1px solid #000' }} />}
              <a href={c.profile_url} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: '#000', textDecoration: 'none' }}>{c.name}</a>
              <span style={{ color: '#000', opacity: 0.6 }}>({Math.round(c.elo_rating)})</span>
              {c.one_liner ? <span style={{ color: '#000', opacity: 0.7 }}>— {c.one_liner}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}


