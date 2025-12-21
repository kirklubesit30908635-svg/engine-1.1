import type { Handler } from "@netlify/functions";

type RunArchetype =
  | "strategy"
  | "revenue"
  | "build"
  | "outreach"
  | "optimization"
  | "risk_review";

type RequestBody = {
  model?: string;
  input: string;
  archetype?: RunArchetype;
  temperature?: number;
  max_output_tokens?: number;
  persist?: boolean;
  create_proof_artifact?: boolean;
  tags?: string[];
};

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization, x-engine-key",
      "access-control-allow-methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function buildSystemPrompt(archetype: RunArchetype) {
  const base =
    "You are Engine One: structured execution with provable outcomes. Refuse to act without clarity. Produce a concise execution plan, risks, and next actions.";
  const archetypes: Record<RunArchetype, string> = {
    strategy: "Focus: strategic clarity, positioning, priorities, and measurable outcomes.",
    revenue: "Focus: revenue path, pricing, conversion, and immediate monetization moves.",
    build: "Focus: technical build plan, architecture, tasks, and verification steps.",
    outreach: "Focus: pipeline, messaging, and outreach sequences with proof and metrics.",
    optimization: "Focus: improve performance, reduce cost, tighten loops, remove waste.",
    risk_review: "Focus: downside, reversibility, security, compliance, and failure modes.",
  };
  return `${base}\n${archetypes[archetype]}`;
}

async function callOpenAI(args: {
  apiKey: string;
  model: string;
  system: string;
  input: string;
  temperature: number;
  maxTokens: number;
}) {
  const { apiKey, model, system, input, temperature, maxTokens } = args;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
      temperature,
      max_output_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI failed: ${res.status} ${t}`);
  }

  const data = await res.json();
  const text =
    data?.output_text ??
    (Array.isArray(data?.output)
      ? data.output
          .flatMap((o: any) => o?.content ?? [])
          .map((c: any) => c?.text)
          .filter(Boolean)
          .join("\n")
      : "");

  if (!text) throw new Error("OpenAI returned empty output");
  return text as string;
}

function proofArtifactFromRun(archetype: RunArchetype, input: string, output: string) {
  const title = `Engine One Proof • ${archetype.toUpperCase()} • ${new Date()
    .toISOString()
    .slice(0, 10)}`;
  const summary = output.length > 220 ? output.slice(0, 220).trim() + "…" : output.trim();

  const content = [
    "# Executive Proof Artifact",
    "",
    `**Archetype:** ${archetype}`,
    `**Timestamp:** ${new Date().toISOString()}`,
    "",
    "## Input",
    input,
    "",
    "## Output",
    output,
    "",
    "## Verification Checklist",
    "- Outcome is specific and measurable",
    "- Risks and constraints identified",
    "- Next actions are executable",
    "- If unclear, system requested clarity",
  ].join("\n");

  return { title, summary, content };
}

async function getSupabaseUserIdFromJwt(args: {
  supabaseUrl: string;
  anonKey: string;
  jwt: string;
}) {
  const { supabaseUrl, anonKey, jwt } = args;

  // Validate JWT by asking Supabase who the user is.
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${jwt}`,
    },
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Auth invalid: ${res.status} ${t}`);
  }

  const user = await res.json();
  if (!user?.id) throw new Error("Auth invalid: missing user id");
  return user.id as string;
}

async function supabaseInsertRun(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  input: string;
  output: string;
  created_by: string;
}) {
  const { supabaseUrl, serviceRoleKey, input, output, created_by } = args;

  const res = await fetch(`${supabaseUrl}/rest/v1/runs`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify([{ input, output, created_by }]),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase insert runs failed: ${res.status} ${t}`);
  }

  const rows = (await res.json()) as any[];
  return rows?.[0] ?? null;
}

async function supabaseInsertVaultProof(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  created_by: string;
  run_id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
}) {
  const { supabaseUrl, serviceRoleKey, created_by, run_id, title, summary, content, tags } =
    args;

  const res = await fetch(`${supabaseUrl}/rest/v1/vault_entries`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify([
      {
        entry_type: "proof_artifact",
        title,
        summary,
        content,
        tags,
        importance: 8,
        status: "active",
        source: "engine_one",
        evidence_urls: [],
        related_ids: [run_id],
        is_locked: false,
        supersedes_id: null,
        created_by,
      },
    ]),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase insert vault_entries failed: ${res.status} ${t}`);
  }

  const rows = (await res.json()) as any[];
  return rows?.[0] ?? null;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

  try {
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });

    // Optional ops gate
    const gate = process.env.ENGINE_ONE_GATE_KEY;
    if (gate) {
      const provided = event.headers["x-engine-key"] || event.headers["X-Engine-Key"];
      if (!provided || provided !== gate) {
        return json(401, { ok: false, error: "Unauthorized (x-engine-key)" });
      }
    }

    // Require Supabase JWT
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json(401, { ok: false, error: "Missing Authorization Bearer token" });

    const body = event.body ? (JSON.parse(event.body) as RequestBody) : null;
    if (!body?.input || typeof body.input !== "string") {
      return json(400, { ok: false, error: "Missing input" });
    }

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const supabaseAnonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const created_by = await getSupabaseUserIdFromJwt({
      supabaseUrl,
      anonKey: supabaseAnonKey,
      jwt,
    });

    const archetype = (body.archetype ?? "strategy") as RunArchetype;
    const model = body.model ?? "gpt-4.1-mini";
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.35;
    const maxTokens = typeof body.max_output_tokens === "number" ? body.max_output_tokens : 900;

    const openaiKey = requireEnv("OPENAI_API_KEY");
    const started = Date.now();

    const output = await callOpenAI({
      apiKey: openaiKey,
      model,
      system: buildSystemPrompt(archetype),
      input: body.input,
      temperature,
      maxTokens,
    });

    const latency_ms = Date.now() - started;

    const persist = body.persist !== false; // default true
    const createProof = body.create_proof_artifact === true;

    let runRow: any | null = null;
    let proofRow: any | null = null;

    if (persist) {
      runRow = await supabaseInsertRun({
        supabaseUrl,
        serviceRoleKey,
        input: body.input,
        output,
        created_by,
      });

      if (createProof && runRow?.id) {
        const proof = proofArtifactFromRun(archetype, body.input, output);
        proofRow = await supabaseInsertVaultProof({
          supabaseUrl,
          serviceRoleKey,
          created_by,
          run_id: runRow.id,
          title: proof.title,
          summary: proof.summary,
          content: proof.content,
          tags: Array.isArray(body.tags) ? body.tags : ["engine_one", "proof"],
        });
      }
    }

    return json(200, {
      ok: true,
      model,
      archetype,
      latency_ms,
      output,
      run: runRow,
      proof: proofRow,
    });
  } catch (e: any) {
    return json(500, { ok: false, error: e?.message ?? "Server error" });
  }
};
