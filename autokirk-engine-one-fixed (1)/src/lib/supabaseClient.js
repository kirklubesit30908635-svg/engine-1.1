import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export function getSupabase() {
  if (!url || !anon) return null
  return createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { 'X-Client-Info': 'autokirk-engine-one' } },
  })
}
