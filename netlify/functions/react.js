/**
 * Autokirk Engine One (Netlify Function)
 * Purpose: clarity → execution (behaviorally-governed, frontend-parseable)
 * Runtime: CommonJS (Netlify-safe)
 */

const OpenAI = require("openai");

// -------------------------
// Response helpers
// -------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...corsHeaders, ...extraHeaders },
    body: JSON.stringify(payload),
  };
}

function safeJsonParse(raw) {
  if (!raw || typeof raw !== "string") return { ok: false, error: "Empty body" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }
}

function pickInput(body) {
  const candidates = [body.prompt, body.message, body.input, body.text];
  const found = candidates.find((v) => typeof v === "string" && v.trim().length);
  return found ? found.trim() : "";
}

function clampNumber(n, min, max, fallback) {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// -------------------------
// Engine One doctrine
// -------------------------
const SYSTEM_DOCTRINE = `
You are AUTOKIRK ENGINE ONE.

NON-NEGOTIABLE BEHAVIOR:
- Never explain what you are. Never mention being an AI, training data, or models.
- Never ask "How can I help?" or any generic follow-up.
- Do not use conversational filler. No apologies unless a real failure occurs.
- Assume the user is a founder/operator moving fast.

OUTPUT CONTRACT:
Return ONLY a single JSON object with EXACTLY these keys:
{
  "title": string,
  "executive_signal": string,
  "action_plan": string[],
  "risks_and_controls": string[],
  "next_action": string
}

RULES:
- title: 4–10 words, punchy.
- executive_signal: 2–5 sentences, decisive and specific.
- action_plan: 3–8 steps, imperative verbs, no fluff.
- risks_and_controls: 2–6 bullets, each includes a mitigation.
- next_action: ONE concrete step the user can do in <15 minutes.

If the input is vague, infer intent and proceed.
If input is operational, produce exact steps.
If input is strategic, elevate and translate into execution.

Return valid JSON only. No markdown. No code fences.
`.trim();

// -------------------------
// Netlify handler
// -------------------------
exports.handler = async (event) => {
  const t0 = Date.now();

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // Method gating
  if (event.httpMethod !== "POST") {
    return reply(405, {
      ok: false,
      error: "Method Not Allowed",
      allowed: ["POST", "OPTIONS"],
    });
  }

  // Env validation
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return reply(500, {
      ok: false,
      error: "Server misconfigured: OPENAI_API_KEY is missing",
    });
  }

  // Parse body
  const parsed = safeJsonParse(event.body);
  if (!parsed.ok) {
    return reply(400, { ok: false, error: parsed.error });
  }

  const body = parsed.value || {};
  const input = pickInput(body);
  if (!input) {
    return reply(400, {
      ok: false,
      error: "Missing input text. Provide: prompt | message | input | text",
    });
  }

  // Optional controls (safe defaults)
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "gpt-4.1-mini";
  const temperature = clampNumber(body.temperature, 0, 2, 0.35);
  const max_output_tokens = clampNumber(body.max_output_tokens, 64, 1400, 900);

  // Optional request metadata
  const user_id = typeof body.user_id === "string" ? body.user_id.slice(0, 64) : undefined;

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  try {
    const result = await client.responses.create({
      model,
      temperature,
      max_output_tokens,
      input: [
        { role: "system", content: SYSTEM_DOCTRINE },
        { role: "user", content: input },
      ],
      user: user_id,
    });

    // Responses API convenience: output_text may include the JSON string
    let raw = (result.output_text || "").trim();

    // Fallback extraction for edge shapes
    if (!raw && Array.isArray(result.output)) {
      raw = result.output
        .map((o) =>
          (o.content || [])
            .map((c) => (c.type === "output_text" ? c.text : ""))
            .join("")
        )
        .join("")
        .trim();
    }

    // Enforce JSON-only output. If model slips, attempt to recover by locating JSON block.
    let enginePayload = null;
    try {
      enginePayload = JSON.parse(raw);
    } catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const maybe = raw.slice(start, end + 1);
        try {
          enginePayload = JSON.parse(maybe);
        } catch {
          enginePayload = null;
        }
      }
    }

    if (!enginePayload || typeof enginePayload !== "object") {
      return reply(502, {
        ok: false,
        error: "Engine One output contract violated (non-JSON or unparsable).",
        diagnostics: {
          request_id: result.id || null,
          raw_preview: raw ? raw.slice(0, 300) : "",
        },
      });
    }

    // Basic contract checks (keep minimal, don’t over-police)
    const requiredKeys = ["title", "executive_signal", "action_plan", "risks_and_controls", "next_action"];
    for (const k of requiredKeys) {
      if (!(k in enginePayload)) {
        return reply(502, {
          ok: false,
          error: `Engine One output missing key: ${k}`,
          diagnostics: {
            request_id: result.id || null,
          },
        });
      }
    }

    const ms = Date.now() - t0;

    // Final stable response object
    return reply(200, {
      ok: true,
      engine: "engine-one",
      request_id: result.id || null,
      model,
      latency_ms: ms,
      input,
      output: enginePayload,
    });
  } catch (err) {
    const ms = Date.now() - t0;
    const message =
      err?.message ||
      err?.response?.data?.error?.message ||
      "Unknown error";

    return reply(500, {
      ok: false,
      engine: "engine-one",
      latency_ms: ms,
      error: "Engine One execution failure",
      details: message,
    });
  }
};

