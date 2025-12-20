// /netlify/functions/react.js
// Engine One – single Netlify function that supports:
// - POST /api/react          -> executes prompt via OpenAI (fallback if OpenAI fails) and logs to Supabase
// - GET  /api/react?op=ledger -> returns last N ledger entries from Supabase
// - GET  /api/react?op=health -> returns env + supabase connectivity status (no secrets)
//
// Requires env vars in Netlify:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (recommended; bypasses RLS)
//   OPENAI_API_KEY              (optional; if missing -> fallback mode)
// Optional env vars:
//   OPENAI_MODEL (default "gpt-4.1-mini")

import { createClient } from "@supabase/supabase-js";

const TABLE = "engine_one_memory";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
    body: JSON.stringify(bodyObj),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function safeTrim(s, max = 20000) {
  if (typeof s !== "string") return "";
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n\n[TRUNCATED]";
}

function requiredEnv(name) {
  const v = process.env[name];
  return (typeof v === "string" && v.trim().length > 0) ? v.trim() : null;
}

function buildFallbackAnswer(prompt, reason) {
  const p = safeTrim(prompt, 2000);
  return [
    `Engine One (Fallback Mode)`,
    ``,
    `Intent captured:`,
    `- ${p || "(empty)"}`,
    ``,
    `Execution scaffold:`,
    `1) Define the outcome in one sentence.`,
    `2) Pick the 3 highest-leverage actions.`,
    `3) Identify the single blocker.`,
    `4) Execute the smallest irreversible step.`,
    `5) Log result + next move.`,
    ``,
    `Next step: reply with your one-sentence outcome and top blocker.`,
    reason ? `` : null,
    reason ? `(Operator note: ${reason})` : null,
  ].filter(Boolean).join("\n");
}

function extractOutputText(openaiJson) {
  // Prefer the convenience field if present
  if (openaiJson && typeof openaiJson.output_text === "string" && openaiJson.output_text.trim()) {
    return openaiJson.output_text.trim();
  }

  // Robust fallback: walk the output structure
  try {
    const out = openaiJson?.output;
    if (Array.isArray(out)) {
      const chunks = [];
      for (const item of out) {
        const content = item?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            // Responses API typically uses: { type: "output_text", text: "..." }
            if (typeof c?.text === "string") chunks.push(c.text);
          }
        }
      }
      const joined = chunks.join("\n").trim();
      if (joined) return joined;
    }
  } catch (_) {
    // ignore
  }

  return "";
}

async function openaiRespond({ prompt }) {
  const OPENAI_API_KEY = requiredEnv("OPENAI_API_KEY");
  const model = requiredEnv("OPENAI_MODEL") || "gpt-4.1-mini";

  if (!OPENAI_API_KEY) {
    return {
      ok: false,
      ai_used: false,
      model: null,
      output: buildFallbackAnswer(prompt, "OPENAI_API_KEY missing"),
      error: "OPENAI_API_KEY missing",
      raw: null,
    };
  }

  // Use Responses API with "input" as a plain string to avoid the invalid content-type errors.
  const payload = {
    model,
    input: safeTrim(prompt, 12000),
    temperature: 0.2,
    max_output_tokens: 900,
  };

  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const ms = Date.now() - t0;
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-json */ }

  if (!res.ok) {
    const msg =
      (data?.error?.message && String(data.error.message)) ||
      (typeof text === "string" && text.slice(0, 500)) ||
      `OpenAI request failed (${res.status})`;

    return {
      ok: false,
      ai_used: false,
      model,
      output: buildFallbackAnswer(prompt, msg),
      error: msg,
      raw: data || { raw_text: text },
      meta: { status: res.status, ms },
    };
  }

  const output = extractOutputText(data);
  if (!output) {
    const msg = "OpenAI returned no output text (unexpected response shape).";
    return {
      ok: false,
      ai_used: false,
      model,
      output: buildFallbackAnswer(prompt, msg),
      error: msg,
      raw: data,
      meta: { status: res.status, ms },
    };
  }

  return {
    ok: true,
    ai_used: true,
    model,
    output,
    error: null,
    raw: data,
    meta: { status: res.status, ms },
  };
}

function supabaseClient() {
  const url = requiredEnv("SUPABASE_URL");
  const service = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anon = requiredEnv("SUPABASE_ANON_KEY");

  // Prefer service role (server-side only)
  const key = service || anon;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "autokirk-engine-one/netlify" } },
  });
}

async function logToLedger({ sb, prompt, answer, ai_used }) {
  // Match your schema: prompt text not null, answer text not null, ai_used boolean default false
  const row = {
    prompt: safeTrim(prompt, 12000),
    answer: safeTrim(answer, 20000),
    ai_used: !!ai_used,
  };

  const { error } = await sb.from(TABLE).insert(row);
  if (error) {
    return { ok: false, error: error.message || String(error) };
  }
  return { ok: true };
}

async function readLedger({ sb, limit }) {
  const n = Number.isFinite(limit) ? limit : 20;
  const take = Math.max(1, Math.min(200, n));

  const { data, error } = await sb
    .from(TABLE)
    .select("id, created_at, prompt, answer, ai_used")
    .order("created_at", { ascending: false })
    .limit(take);

  if (error) return { ok: false, error: error.message || String(error), data: [] };
  return { ok: true, data: data || [] };
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders, body: "" };
    }

    const url = new URL(event.rawUrl || `https://local${event.path || "/api/react"}`);
    const op = (url.searchParams.get("op") || "").toLowerCase();

    const sb = supabaseClient();

    // HEALTH
    if (event.httpMethod === "GET" && op === "health") {
      const env = {
        has_SUPABASE_URL: !!requiredEnv("SUPABASE_URL"),
        has_SUPABASE_SERVICE_ROLE_KEY: !!requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
        has_SUPABASE_ANON_KEY: !!requiredEnv("SUPABASE_ANON_KEY"),
        has_OPENAI_API_KEY: !!requiredEnv("OPENAI_API_KEY"),
        OPENAI_MODEL: requiredEnv("OPENAI_MODEL") || "gpt-4.1-mini",
        TABLE,
        server_time: nowIso(),
      };

      if (!sb) return json(200, { ok: true, env, supabase: { ok: false, error: "Supabase env missing" } });

      // quick read test (non-fatal)
      const ping = await readLedger({ sb, limit: 1 });
      return json(200, { ok: true, env, supabase: { ok: ping.ok, error: ping.ok ? null : ping.error } });
    }

    // LEDGER
    if (event.httpMethod === "GET" && (op === "ledger" || op === "memory" || op === "log")) {
      if (!sb) return json(500, { ok: false, error: "Supabase env missing (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY recommended)" });

      const limit = parseInt(url.searchParams.get("limit") || "20", 10);
      const ledger = await readLedger({ sb, limit });
      if (!ledger.ok) return json(500, { ok: false, error: ledger.error, data: [] });

      return json(200, { ok: true, data: ledger.data });
    }

    // EXECUTE
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed. Use POST to execute, GET ?op=ledger for memory." });
    }

    let body = {};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch { body = {}; }

    const prompt = safeTrim(body?.prompt ?? body?.input ?? "", 12000);
    if (!prompt) return json(400, { ok: false, error: "Missing prompt" });

    const run_id = crypto?.randomUUID?.() || `run_${Date.now()}`;

    // 1) call OpenAI (or fallback)
    const ai = await openaiRespond({ prompt });

    // 2) log to ledger (always attempt)
    let ledgerStatus = { ok: false, error: "Supabase env missing" };
    if (sb) {
      ledgerStatus = await logToLedger({
        sb,
        prompt,
        answer: ai.output,
        ai_used: ai.ai_used,
      });
    }

    // 3) respond to client with full diagnostics
    return json(200, {
      ok: true,
      run_id,
      ai_used: ai.ai_used,
      model: ai.model,
      output: ai.output,
      openai_ok: ai.ok,
      openai_error: ai.error,
      openai_meta: ai.meta || null,
      ledger_ok: ledgerStatus.ok,
      ledger_error: ledgerStatus.ok ? null : ledgerStatus.error,
      server_time: nowIso(),
    });
  } catch (e) {
    return json(500, {
      ok: false,
      error: e?.message ? String(e.message) : "Unhandled server error",
      server_time: nowIso(),
    });
  }
};
