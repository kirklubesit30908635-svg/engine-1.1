Autokirk Cockpit Auth Upgrade (Drop-in Bundle)

This zip contains:
A) public/_redirects (fixes Netlify invalid redirect source and SPA routing)
B) src/screens/Login.tsx (NEW) – magic-link login using Supabase Auth
C) src/components/AuthGate.tsx (NEW) – route guard, redirects to /login when unauthenticated
D) src/App.tsx (REPLACE) – wraps CockpitShell routes in AuthGate
E) src/screens/Console.execute.patch.txt – replace ONLY execute() and add supabase import
F) netlify/functions/engine-one.ts (REPLACE) – validates Supabase JWT and writes created_by correctly

Required Netlify environment variables:
- OPENAI_API_KEY
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
Optional:
- ENGINE_ONE_GATE_KEY   (if set, Console must send x-engine-key)

Supabase Auth settings (critical):
- Enable Email (Magic Link / OTP)
- Add Redirect URLs:
  - https://<your-site>.netlify.app
  - https://<your-custom-domain> (if applicable)
  - http://localhost:5173 (local dev), if you use it

Implementation steps:
1) Copy files into your repo at the same relative paths.
2) Apply the Console execute() patch as instructed in src/screens/Console.execute.patch.txt
3) Deploy to Netlify.
