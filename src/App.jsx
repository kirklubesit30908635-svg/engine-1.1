import React, { useEffect, useMemo, useState } from 'react'

const API_URL = '/api/react'

function nowISO() {
  return new Date().toISOString()
}

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [response, setResponse] = useState('')
  const [history, setHistory] = useState([])
  const [mode, setMode] = useState('chat') // chat | history

  const canSend = useMemo(() => prompt.trim().length > 0 && status !== 'loading', [prompt, status])

  async function loadHistory() {
    setStatus('loading')
    setError('')
    try {
      const r = await fetch(`${API_URL}?action=history`, { method: 'GET' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Failed to load history')
      setHistory(Array.isArray(j?.items) ? j.items : [])
      setStatus('idle')
    } catch (e) {
      setStatus('idle')
      setError(e?.message || 'Failed to load history')
    }
  }

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function send() {
    if (!canSend) return
    setStatus('loading')
    setError('')
    setResponse('')
    const body = { prompt: prompt.trim(), ts: nowISO() }
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Request failed')
      setResponse(j?.answer || '')
      setPrompt('')
      await loadHistory()
      setStatus('idle')
    } catch (e) {
      setStatus('idle')
      setError(e?.message || 'Request failed')
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="mark">K</div>
          <div className="title">
            <div className="name">Autokirk Engine One</div>
            <div className="tag">Clarity → Execution</div>
          </div>
        </div>

        <nav className="nav">
          <button className={`tab ${mode === 'chat' ? 'active' : ''}`} onClick={() => setMode('chat')}>
            Console
          </button>
          <button className={`tab ${mode === 'history' ? 'active' : ''}`} onClick={() => setMode('history')}>
            Memory
          </button>
        </nav>
      </header>

      <main className="main">
        {mode === 'chat' ? (
          <section className="panel">
            <div className="panelHead">
              <div className="panelTitle">Operator Console</div>
              <div className="panelSub">Endpoint: <code>/api/react</code> · Supabase-backed memory</div>
            </div>

            <div className="composer">
              <textarea
                className="input"
                placeholder="Enter your command to Engine One…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
              />
              <div className="actions">
                <button className="btn" onClick={send} disabled={!canSend}>
                  {status === 'loading' ? 'Executing…' : 'Execute'}
                </button>
                <button className="btn ghost" onClick={loadHistory} disabled={status === 'loading'}>
                  Refresh Memory
                </button>
              </div>
            </div>

            {error ? (
              <div className="alert error">
                <div className="alertTitle">Execution Error</div>
                <div className="alertBody">{error}</div>
              </div>
            ) : null}

            {response ? (
              <div className="result">
                <div className="resultTitle">Engine Output</div>
                <pre className="resultBody">{response}</pre>
              </div>
            ) : (
              <div className="hint">Engine One is online. Submit an intent. The system will respond and log to memory.</div>
            )}
          </section>
        ) : (
          <section className="panel">
            <div className="panelHead">
              <div className="panelTitle">Memory Ledger</div>
              <div className="panelSub">Last 20 interactions stored in Supabase</div>
            </div>

            {error ? (
              <div className="alert error">
                <div className="alertTitle">Memory Error</div>
                <div className="alertBody">{error}</div>
              </div>
            ) : null}

            <div className="ledger">
              {history.length === 0 ? (
                <div className="empty">No entries yet.</div>
              ) : (
                history.map((it) => (
                  <div key={it.id} className="entry">
                    <div className="meta">
                      <span className="ts">{it.created_at || ''}</span>
                      <span className={`badge ${it.ai_used ? 'on' : 'off'}`}>{it.ai_used ? 'AI' : 'Fallback'}</span>
                    </div>
                    <div className="q">{it.prompt}</div>
                    <div className="a">{it.answer}</div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <span>Engine One · Production build</span>
        <span className="dot">•</span>
        <span>Supabase is the sole memory source</span>
      </footer>
    </div>
  )
}
