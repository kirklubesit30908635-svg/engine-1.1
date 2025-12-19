// netlify/functions/react.js
// Engine One — Netlify Function (Supabase memory + OpenAI Responses API)

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify(body),
  };
}

function extractOutputText(openaiJson) {
  // Responses API often includes `output_text` as a convenience
  if (openaiJson?.output_text && typeof openaiJson.output_text === "string") {
    return openaiJson.output_text.trim();
  }

  // Otherwise walk the structure: output[].content[] where type === "output_text"
  const out = openaiJson?.output;
  if (Array.isArray(out)) {
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string") {
            return c.text.trim();
          }
        }
      }
    }
  }

  // Fallback: stringify something useful
  return typeof openaiJson === "object"
    ? JSON.stringify(openaiJson).slice(0, 2000)
    : String(openaiJson);
}

async function getMemory(supabase, limit = 20) {
  const { data, error } = await supabase
    .from("engine_one_memory")
    .select("id, created_at, prompt, response, answer, ai_used")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function handler(event) {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!SUPABASE_URL) return json(500, { ok: false, error: "Missing SUPABASE_URL" });
  if (!SUPABASE_SERVICE_ROLE_KEY)
    return json(500, { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // Simple health/memory fetch via GET
    if (event.httpMethod === "GET") {
      const memory = await getMemory(supabase, 20);
      return json(200, { ok: true, mode: "memory", memory });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action || "execute";

    // Refresh memory
    if (action === "memory" || action === "refresh_memory" || action === "refresh") {
      const memory = await getMemory(supabase, 20);
      return json(200, { ok: true, mode: "memory", memory });
    }

    // Execute command
    const prompt =
      (body.command ?? body.prompt ?? body.input ?? body.text ?? "").toString().trim();

    if (!prompt) {
      return json(400, { ok: false, error: "Missing command/prompt/input" });
    }

    // Default fallback scaffolding (only used if OpenAI fails)
    const fallbackAnswer =
      `Engine One (Fallback Mode)\n` +
      `Intent captured:\n- ${prompt}\n\n` +
      `Execution scaffold:\n` +
      `1) Define the outcome in one sentence.\n` +
      `2) Pick the 3 highest-leverage actions.\n` +
      `3) Identify the single blocker.\n` +
      `4) Execute the smallest irreversible step.\n` +
      `5) Log result + next move.\n`;

    // If no OpenAI key, log fallback and return
    if (!OPENAI_API_KEY) {
      const { error: insertErr } = await supabase.from("engine_one_memory").insert({
        prompt,
        response: null,
        answer: fallbackAnswer,
        ai_used: "false",
      });

      if (insertErr) return json(500, { ok: false, error: insertErr.message });
      const memory = await getMemory(supabase, 20);
      return json(200, { ok: true, mode: "fallback", ai_used: false, answer: fallbackAnswer, memory });
    }

    // ---- OpenAI Responses API call (FIXED: type is input_text) ----
    let aiText = "";
    let openaiRaw = null;

    try {
      const payload = {
        model: OPENAI_MODEL,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        // Keep it stable and operator-grade
        temperature: 0.2,
        max_output_tokens: 700,
      };

      const resp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      openaiRaw = await resp.json();

      if (!resp.ok) {
        // Throw to fallback path
        const msg =
          openaiRaw?.error?.message ||
          `OpenAI error (${resp.status})`;
        throw new Error(msg);
      }

      aiText = extractOutputText(openaiRaw);
    } catch (e) {
      // OpenAI failed → log fallback
      const { error: insertErr } = await supabase.from("engine_one_memory").insert({
        prompt,
        response: null,
        answer: fallbackAnswer + `\n(Operator note: ${String(e.message || e)})`,
        ai_used: "false",
      });

      if (insertErr) return json(500, { ok: false, error: insertErr.message });

      const memory = await getMemory(supabase, 20);
      return json(200, {
        ok: true,
        mode: "fallback",
        ai_used: false,
        answer: fallbackAnswer,
        error: String(e.message || e),
        memory,
      });
    }

    // Log success (store in BOTH response + answer to satisfy any front-end expectations)
    const { error: logErr } = await supabase.from("engine_one_memory").insert({
      prompt,
      response: aiText,
      answer: aiText,
      ai_used: "true",
    });

    if (logErr) return json(500, { ok: false, error: logErr.message });

    const memory = await getMemory(supabase, 20);

    return json(200, {
      ok: true,
      mode: "ai",
      ai_used: true,
      answer: aiText,
      response: aiText,
      memory,
      // optional debug if you ever need it:
      // openai: openaiRaw,
    });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
}
