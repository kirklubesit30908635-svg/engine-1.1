const OpenAI = require("openai");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Engine-Key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(statusCode, payload) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(payload) };
}

function safeJsonParse(raw) {
  if (!raw || typeof raw !== "string") return { ok: false, error: "Empty body" };
  try { return { ok: true, value: JSON.parse(raw) }; }
  catch { return { ok: false, error: "Invalid JSON body" }; }
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

const SYSTEM_DOCTRINE = `
You are AUTOKIRK ENGINE ONE.

NON-NEGOTIABLE BEHAVIOR:
- Never explain what you are. Never mention being an AI, training data, or models.
- Never ask generic follow-up questions.
- No filler. Be decisive and execution-oriented.
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
- executive_signal: 2–5 sentences, specific and direct.
- action_plan: 3–8 steps, imperative verbs.
- risks_and_controls: 2–6 bullets, each includes a mitigation.
- next_action: ONE concrete step doable in <15 minutes.

Return valid JSON only. No markdown. No code fences.
`.trim();

function requireEngineKey(event) {
  const expected = process.env.ENGINE_ONE_API_KEY;
  if (!expected) return { ok: true };

  const provided =
    event.headers?.["x-engine-key"] ||
    event.headers?.["X-Engine-Key"] ||
    event.headers?.["x-engine-key".toLowerCase()];

  if (!provided || String(provided) !== String(expected)) {
    return { ok: false, error: "Unauthorized (missing or invalid x-engine-key)" };
  }
  return { ok: true };
}

exports.handler = async (event) => {
  const t0 = Date.now();

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return reply(405, { ok: false, error: "Method Not Allowed", allowed: ["POST", "OPTIONS"] });
  }

  const gate = requireEngineKey(event);
  if (!gate.ok) return reply(401, { ok: false, error: gate.error });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return reply(500, { ok: false, error: "Server misconfigured: missing OPENAI_API_KEY" });
  }

  const parsed = safeJsonParse(event.body);
  if (!parsed.ok) return reply(400, { ok: false, error: parsed.error });

  const body = parsed.value || {};
  const input = pickInput(body);
  if (!input) {
    return reply(400, { ok: false, error: "Missing input text. Provide: prompt | message | input | text" });
  }

  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "gpt-4.1-mini";
  const temperature = clampNumber(body.temperature, 0, 2, 0.35);
  const max_output_tokens = clampNumber(body.max_output_tokens, 64, 1400, 900);

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  try {
    const result = await client.responses.create({
      model,
      temperature,
      max_output_tokens,
      input: [
        { role: "system", content: SYSTEM_DOCTRINE },
        { role: "user", content: input }
      ],
    });

    let raw = (result.output_text || "").trim();
    if (!raw && Array.isArray(result.output)) {
      raw = result.output
        .map((o) => (o.content || []).map((c) => (c.type === "output_text" ? c.text : "")).join(""))
        .join("")
        .trim();
    }

    let enginePayload = null;
    try {
      enginePayload = JSON.parse(raw);
    } catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        try { enginePayload = JSON.parse(raw.slice(start, end + 1)); }
        catch { enginePayload = null; }
      }
    }

    if (!enginePayload || typeof enginePayload !== "object") {
      return reply(502, {
        ok: false,
        error: "Engine One output contract violated (non-JSON or unparsable).",
        diagnostics: { request_id: result.id || null, raw_preview: raw.slice(0, 300) },
      });
    }

    const requiredKeys = ["title","executive_signal","action_plan","risks_and_controls","next_action"];
    for (const k of requiredKeys) {
      if (!(k in enginePayload)) {
        return reply(502, { ok: false, error: `Engine One output missing key: ${k}`, diagnostics: { request_id: result.id || null } });
      }
    }

    return reply(200, {
      ok: true,
      engine: "engine-one",
      request_id: result.id || null,
      model,
      latency_ms: Date.now() - t0,
      output: enginePayload
    });
  } catch (err) {
    return reply(500, {
      ok: false,
      engine: "engine-one",
      latency_ms: Date.now() - t0,
      error: "Engine One execution failure",
      details: err?.message || "Unknown error"
    });
  }
};

