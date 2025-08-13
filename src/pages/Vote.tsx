import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { Company } from '../types'

function CompanyCard({ company, onVote }: { company: Company; onVote: (winnerId: string) => void }) {
  return (
    <div className="card">
      {company.logo_url ? (
        <img src={company.logo_url} alt={company.name} className="logo" />
      ) : (
        <div className="logo" style={{ background: '#f3f4f6' }} />
      )}
      <div>
        <a href={company.profile_url} target="_blank" rel="noreferrer" className="name">
          {company.name}
        </a>
        <div className="batch">{company.yc_batch || ''}</div>
      </div>
      <div className="one-liner">{company.one_liner || ''}</div>
      <button onClick={() => onVote(company.id)} style={{ fontSize: 18, padding: '12px 20px' }}>
        Vote
      </button>
    </div>
  )
}

export default function Vote() {
  const [pair, setPair] = useState<Company[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId] = useState<string>(() => {
    const key = 'ycelo_session_id'
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const s = crypto.randomUUID()
    localStorage.setItem(key, s)
    return s
  })

  async function loadPair() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.rpc('get_two_random_companies')
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setPair((data as Company[]) || null)
  }

  useEffect(() => {
    loadPair()
  }, [])

  async function vote(winnerId: string) {
    if (!pair || pair.length !== 2) return
    const [left, right] = pair
    const { error } = await supabase.rpc('record_vote_and_update_elo', {
      left_id: left.id,
      right_id: right.id,
      winner_id: winnerId,
      k: 32,
      voter_session: sessionId,
    })
    if (error) {
      setError(error.message)
      return
    }
    await loadPair()
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, flexDirection: 'column', gap: 16 }}>
      <div className="topnav">
        <Link to="/"><button className="tab active">Battle</button></Link>
        <Link to="/leaderboard"><button className="tab">Leaderboard</button></Link>
      </div>
      <div style={{ width: '100%', maxWidth: 1400 }}>
        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 16, textAlign: 'center' }}>{error}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <div className="pairRow">
            {loading || !pair ? (
              <div>Loading…</div>
            ) : (
              pair.map((c) => <CompanyCard key={c.id} company={c} onVote={vote} />)
            )}
          </div>
        </div>
        <div style={{ marginTop: 28, display: 'flex', justifyContent: 'center' }}>
          <button onClick={loadPair} style={{ fontSize: 16 }}>Skip</button>
        </div>
      </div>
    </div>
  )
}


