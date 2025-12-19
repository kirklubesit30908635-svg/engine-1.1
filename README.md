# Autokirk Engine One

**Endpoint:** `/api/react`  
**Deploy:** GitHub → Netlify  
**Memory:** Supabase (sole source of truth)

## Netlify environment variables
Required:
- `NODE_VERSION=18`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional (AI):
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default: `gpt-4o-mini`)

## Supabase table
Create `engine_one_memory`:

- `id` uuid primary key default `gen_random_uuid()`
- `created_at` timestamptz default `now()`
- `prompt` text not null
- `answer` text not null
- `ai_used` boolean default false
