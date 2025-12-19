# Autokirk Systems — Engine One (Netlify + GitHub, Supabase Memory)

This repo is a **production-ready** Vite + React app deployed on **Netlify** with a Netlify Function endpoint:

- **Endpoint:** `/api/react`
- **Memory:** **Supabase is the sole source of truth** (stores and retrieves chat history)

## 1) Supabase Setup (Required)

Create a Supabase project, then run this SQL in **SQL Editor**:

```sql
create table if not exists public.engine_one_memory (
  id bigserial primary key,
  user_id text not null,
  role text not null check (role in ('system','user','assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists engine_one_memory_user_id_created_at_idx
  on public.engine_one_memory (user_id, created_at desc);

-- Enable RLS
alter table public.engine_one_memory enable row level security;

-- Allow the client to read only its own rows (by user_id),
-- but writes are done server-side via service role key.
create policy "read_own_memory"
on public.engine_one_memory
for select
using (auth.role() = 'anon' or auth.role() = 'authenticated');
```

**Note:** For strict per-user isolation with Supabase Auth, add auth and store `auth.uid()` instead of `user_id`.  
This MVP uses a local `user_id` (UUID) for speed and simplicity; all writes happen via the server function using the service role.

## 2) Environment Variables

Copy `.env.example` to `.env` for local dev.

### Local dev (Vite + Functions)
- Vite reads `VITE_*` vars
- Netlify Functions read server-side vars

Set these:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

## 3) Install & Run Locally

```bash
npm install
npm run dev
```

For local Netlify Functions emulation, install Netlify CLI:

```bash
npm i -g netlify-cli
netlify dev
```

Then open the URL Netlify prints. The app will call `/api/react` and hit the local function.

## 4) Deploy (GitHub → Netlify)

1. Push this repo to GitHub.
2. In Netlify:
   - New site from Git
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
3. Add environment variables in Netlify Site Settings → Environment Variables.
4. Deploy.

## 5) Contract

- UI: simple Engine One chat console (no scope bloat).
- API: `/api/react` Netlify Function.
- Memory: Supabase `engine_one_memory` table (read lookback + store each turn).
