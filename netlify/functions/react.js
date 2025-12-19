/* netlify/functions/engine-one.js
   CommonJS-safe Netlify Function (fixes: "Cannot use import statement outside a module")
*/

const OpenAI = require("openai");

// --- Small utilities (kept inside file for Netlify simplicity) ---
const json = (statusCode, payload, extraHeaders = {}) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...extraHeaders,
  },
  body: JSON.stringify(payload),
});

const safeParseJSON = (body) => {
  if (!body) return { ok: false, error: "Empty body" };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (e) {
    return { ok: false, error: "Invalid JSON body" };
  }
};

exports.handler = async (event) => {
  // Preflight (CORS)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return json(405, {
      ok: false,
      error: "Method Not Allowed",
      allowed: ["POST", "OPTIONS"],
    });
  }

  // Validate required env vars
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return json(500, {
      ok: false,
      error: "Server misconfigured: OPENAI_API_KEY is missing",
    });
  }

  // Parse JSON body
  const parsed = safeParseJSON(event.body);
  if (!parsed.ok) {
    return json(400, { ok: false, error: parsed.error });
  }

  const {
    // Input contract (flexible, but structured)
    prompt,
    message,
    input,
    // Optional controls
    model,
    temperature,
    max_output_tokens,
    // Optional metadata
    user_id,
  } = parsed.value || {};

  const text =
    (typeof prompt === "string" && prompt.trim()) ||
    (typeof message === "string" && message.trim()) ||
    (typeof input === "string" && input.trim());

  if (!text) {
    return json(400, {
      ok: false,
      error: "Missing input text. Provide one of: prompt | message | input",
    });
  }

  // Model defaults (pick a stable default; overrideable)
  const selectedModel = (model && String(model)) || "gpt-4.1-mini";
  const temp =
    typeof temperature === "number"
      ? Math.min(2, Math.max(0, temperature))
      : 0.4;

  const maxTokens =
    typeof max_output_tokens === "number"
      ? Math.min(4000, Math.max(64, max_output_tokens))
      : 800;

  // Instantiate OpenAI client
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  try {
    // Call OpenAI Responses API (recommended modern endpoint)
    const result = await client.responses.create({
      model: selectedModel,
      temperature: temp,
      max_output_tokens: maxTokens,

      // You can harden system behavior here without exposing internals
      input: [
        {
          role: "system",
          content:
            "You are Engine One: deliver clarity → execution. Be concise, structured, and action-oriented.",
        },
        {
          role: "user",
          content: text,
        },
      ],
      // Optional: identify user for abuse prevention (don’t send secrets)
      user: user_id ? String(user_id).slice(0, 64) : undefined,
    });

    // Extract text safely (Responses API returns different shapes depending on modality)
    const outputText =
      (result.output_text && String(result.output_text)) ||
      (Array.isArray(result.output) &&
        result.output
          .map((o) => {
            if (!o || !Array.isArray(o.content)) return "";
            return o.content
              .map((c) => (c && c.type === "output_text" ? c.text : ""))
              .join("");
          })
          .join("")
          .trim()) ||
      "";

    return json(200, {
      ok: true,
      engine: "engine-one",
      model: selectedModel,
      input: text,
      output: outputText,
      // optional trace (keep minimal)
      request_id: result.id || null,
    });
  } catch (err) {
    // Don’t leak secrets; do provide enough signal to debug
    const status = err?.status || err?.response?.status || 500;
    const message =
      err?.message ||
      err?.response?.data?.error?.message ||
      "Unknown server error";

    return json(status, {
      ok: false,
      error: "Engine One execution failed",
      details: message,
    });
  }
};
