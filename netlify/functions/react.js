// netlify/functions/react.js
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const payload = JSON.parse(event.body || "{}");
    const prompt = String(payload.prompt ?? payload.input ?? "").trim();

    if (!prompt) return json(400, { error: "Missing prompt" });

    // If no OpenAI key, still log prompt with fallback answer
    if (!OPENAI_API_KEY) {
      const answer = "Engine One (Fallback Mode) Intent captured.\n\nNext: connect OPENAI_API_KEY in Netlify env vars.";
      await supabase.from("engine_one_memory").insert([{ prompt, answer, ai_used: false }]);
      return json(200, { answer, ai_used: false, mode: "fallback" });
    }

    const client = new OpenAI({ apiKey: OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    // IMPORTANT: Correct Responses API content types:
    // Supported: input_text, input_image, output_text, etc.
    const SYSTEM = [
      "You are Autokirk Engine One.",
      "Mission: Clarity → Execution.",
      "Output format:",
      "1) One-sentence outcome.",
      "2) Top 3 highest-leverage actions (numbered).",
      "3) Single blocker.",
      "4) Smallest irreversible step.",
      "5) Next move.",
      "Rules: No filler. No 'as an AI'. Concrete steps.",
    ].join("\n");

    const started = Date.now();

    const resp = await client.responses.create({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM }] },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      temperature: 0.2,
      max_output_tokens: 700,
    });

    // Best universal extraction: output_text
    const answer = (resp.output_text || "").trim() || "No output_text returned.";

    const ms = Date.now() - started;

    // Log to Supabase — match your schema exactly
    const { error: dbErr } = await supabase
      .from("engine_one_memory")
      .insert([{ prompt, answer, ai_used: true }]);

    if (dbErr) {
      // Still return the AI answer; show DB failure explicitly
      return json(200, {
        answer,
        ai_used: true,
        model,
        latency_ms: ms,
        warning: "AI succeeded but Supabase insert failed",
        supabase_error: dbErr,
      });
    }

    return json(200, { answer, ai_used: true, model, latency_ms: ms });
  } catch (err) {
    return json(500, {
      error: "Server error",
      message: err?.message || String(err),
      stack: err?.stack || null,
    });
  }
};
// netlify/functions/memory.js
import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase
      .from("engine_one_memory")
      .select("id, created_at, prompt, answer, ai_used")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) return json(500, { error: "Supabase select failed", supabase_error: error });

    return json(200, data || []);
  } catch (err) {
    return json(500, {
      error: "Server error",
      message: err?.message || String(err),
      stack: err?.stack || null,
    });
  }
};
