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

Return valid JSON only. No markdown. No code fences.
`.trim();

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return reply(405, { ok: false, error: "Method Not Allowed" });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return reply(500, { ok: false, error: "Missing OPENAI_API_KEY" });

  const parsed = safeJsonParse(event.body);
  if (!parsed.ok) return reply(400, { ok: false, error: parsed.error });

  const body = parsed.value || {};
  const input = pickInput(body);
  if (!input) return reply(400, { ok: false, error: "Missing input" });

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

    const raw = (result.output_text || "").trim();
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}

    if (!payload) {
      return reply(502, { ok: false, error: "Non-JSON output from model", raw_preview: raw.slice(0, 300) });
    }

    return reply(200, { ok: true, request_id: result.id || null, output: payload });
  } catch (err) {
    return reply(500, { ok: false, error: "Execution failure", details: err?.message || "Unknown error" });
  }
};
