import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { 'X-Client-Info': 'autokirk-engine-one' } },
  })
}

function fallbackAnswer(prompt, reason) {
  const r = reason ? `\n\n(Operator note: ${reason})` : ''
  return (
    `Engine One (Fallback Mode)\n` +
    `Intent captured:\n- ${prompt}\n\n` +
    `Execution scaffold:\n1) Define the outcome in one sentence.\n2) Pick the 3 highest-leverage actions.\n3) Identify the single blocker.\n4) Execute the smallest irreversible step.\n5) Log result + next move.\n\n` +
    `Next step: reply with your one-sentence outcome and top blocker.` +
    r
  )
}

async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) return { ai_used: false, answer: fallbackAnswer(prompt, 'OPENAI_API_KEY not set') }

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          { role: 'system', content: [{ type: 'text', text: 'You are Engine One. Deliver clarity → execution. Be concise, actionable, and direct.' }] },
          { role: 'user', content: [{ type: 'text', text: prompt }] },
        ],
        temperature: 0.4,
      }),
    })
    const j = await r.json()
    if (!r.ok) return { ai_used: false, answer: fallbackAnswer(prompt, j?.error?.message || 'OpenAI request failed') }

    const out = (j.output || [])
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('\n')
      .trim()

    return { ai_used: true, answer: out || fallbackAnswer(prompt) }
  } catch (e) {
    return { ai_used: false, answer: fallbackAnswer(prompt, e?.message || 'OpenAI call error') }
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' })
  }

  const supabase = getSupabase()

  try {
    if (event.httpMethod === 'GET') {
      const url = new URL(event.rawUrl)
      const action = url.searchParams.get('action')
      if (action !== 'history') return json(400, { error: 'Unknown action.' })

      const { data, error } = await supabase
        .from('engine_one_memory')
        .select('id, created_at, prompt, answer, ai_used')
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) return json(500, { error: error.message })
      return json(200, { items: data || [] })
    }

    if (event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {}
      const prompt = (body.prompt || '').toString().trim()
      if (!prompt) return json(400, { error: 'Missing prompt.' })

      const { ai_used, answer } = await callOpenAI(prompt)

      const { data, error } = await supabase
        .from('engine_one_memory')
        .insert([{ prompt, answer, ai_used }])
        .select('id')
        .single()

      if (error) return json(500, { error: error.message })
      return json(200, { id: data?.id, ai_used, answer })
    }

    return json(405, { error: 'Method not allowed.' })
  } catch (e) {
    return json(500, { error: e?.message || 'Unexpected server error.' })
  }
}
