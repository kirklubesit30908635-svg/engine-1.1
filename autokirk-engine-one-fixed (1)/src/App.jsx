import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getSupabase } from './lib/supabaseClient.js'

function uuidv4() {
  // Simple UUID v4 generator (browser safe)
  // Not crypto-perfect, but fine for client identity in this MVP.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function App() {
  const supabase = useMemo(() => getSupabase(), [])
  const [userId, setUserId] = useState('')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState({ ok: true, text: 'Ready' })
  const chatRef = useRef(null)

  useEffect(() => {
    const existing = localStorage.getItem('ak_user_id')
    const id = existing || uuidv4()
    if (!existing) localStorage.setItem('ak_user_id', id)
    setUserId(id)
  }, [])

  useEffect(() => {
    // Load prior messages from Supabase (if configured)
    async function load() {
      if (!supabase || !userId) return
      setStatus({ ok: true, text: 'Syncing memory…' })
      const { data, error } = await supabase
        .from('engine_one_memory')
        .select('role, content, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(50)

      if (error) {
        setStatus({ ok: false, text: `Supabase read failed: ${error.message}` })
        return
      }
      const mapped = (data || []).map((m) => ({
        role: m.role,
        content: m.content,
        created_at: m.created_at,
      }))
      // Only display user+assistant (system is used server-side)
      setMessages(mapped.filter(m => m.role !== 'system'))
      setStatus({ ok: true, text: 'Ready (memory synced)' })
      setTimeout(() => scrollToBottom(), 50)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  function scrollToBottom() {
    if (!chatRef.current) return
    chatRef.current.scrollTop = chatRef.current.scrollHeight
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return

    const optimisticUser = { role: 'user', content: text, created_at: new Date().toISOString() }
    setMessages((m) => [...m, optimisticUser])
    setInput('')
    setBusy(true)
    setStatus({ ok: true, text: 'Executing…' })
    setTimeout(() => scrollToBottom(), 30)

    try {
      const res = await fetch('/api/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message: text }),
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(payload?.error || `Request failed (${res.status})`)
      }

      const aiMsg = {
        role: 'assistant',
        content: payload.reply || '(empty reply)',
        created_at: new Date().toISOString(),
      }
      setMessages((m) => [...m, aiMsg])
      setStatus({ ok: true, text: 'Ready' })
      setTimeout(() => scrollToBottom(), 30)
    } catch (e) {
      setStatus({ ok: false, text: e.message || 'Unknown error' })
      // Append error bubble as assistant to keep chat readable
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: `⚠️ Error: ${e.message || 'Unknown error'}`,
          created_at: new Date().toISOString(),
        },
      ])
      setTimeout(() => scrollToBottom(), 30)
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  }

  const memoryConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

  return (
    <div className="container">
      <div className="brand">
        <h1>
          Autokirk <span>Engine One</span>
        </h1>
        <div className="badge">Outcome: clarity → execution</div>
      </div>

      <div className="panel">
        <div className="header">
          <div className="title">
            <strong>Command Console</strong>
            <small>Endpoint: <span style={{ fontFamily: 'var(--mono)' }}>/api/react</span> • Memory: Supabase</small>
          </div>
          <div className="kpi">
            <span>Founder Mode: ON</span>
            <span>User: {userId ? userId.slice(0, 8) : '…'}</span>
            <span>Memory: {memoryConfigured ? 'configured' : 'missing env'}</span>
          </div>
        </div>

        <div className="chat" ref={chatRef}>
          {messages.length === 0 ? (
            <div className="notice">
              <span className="ok">Booted.</span> Type a directive. Press <b>Ctrl/⌘ + Enter</b> to send fast.
            </div>
          ) : null}

          {messages.map((m, idx) => (
            <div className="msg" key={idx}>
              <div className={'avatar ' + (m.role === 'user' ? 'user' : 'ai')}>
                {m.role === 'user' ? 'YOU' : 'AK'}
              </div>
              <div className={'bubble ' + (m.role === 'user' ? 'user' : '')}>
                <div className="meta">
                  <span>{m.role === 'user' ? 'Founder Directive' : 'Engine One Response'}</span>
                  <span>{m.created_at ? formatTime(m.created_at) : ''}</span>
                </div>
                <pre>{m.content}</pre>
              </div>
            </div>
          ))}
        </div>

        <div className="footer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type founder directive…"
            disabled={busy}
          />
          <button onClick={send} disabled={busy || !input.trim()}>
            {busy ? 'Running…' : 'Send'}
          </button>
        </div>
      </div>

      <div className="notice">
        Status: <span className={status.ok ? 'ok' : 'bad'}>{status.text}</span>
        <span style={{ marginLeft: 10 }}>|</span>
        <span style={{ marginLeft: 10 }}>Supabase is the sole memory source; all writes are server-side.</span>
      </div>
    </div>
  )
}
