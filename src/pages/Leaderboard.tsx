import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Company } from '../types'

export default function Leaderboard() {
  const [rows, setRows] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('elo_rating', { ascending: false })
        .order('elo_games_count', { ascending: false })
        .order('name', { ascending: true })
        .limit(100)
      setLoading(false)
      if (error) setError(error.message)
      else setRows((data as Company[]) || [])
    })()
  }, [])

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 48 }}>
      <h1 style={{ fontSize: 40, fontWeight: 900, marginBottom: 28, textAlign: 'center', color: '#000' }}>Leaderboard</h1>
      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 16, textAlign: 'center' }}>{error}</div>}
      {loading ? (
        <div style={{ textAlign: 'center' }}>Loading…</div>
      ) : (
        <ol style={{ listStyle: 'decimal', paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {rows.map((c) => (
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


