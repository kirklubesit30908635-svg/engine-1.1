import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify(body),
  };
}

async function getMemory({ supabase, userId, lookback }) {
  const { data, error } = await supabase
    .from("engine_one_memory")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(lookback);

  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  // Return oldest-first for chat context
  return (data || []).reverse().map((m) => ({ role: m.role, content: m.content }));
}

async function storeTurn({ supabase, userId, role, content, metadata }) {
  const { error } = await supabase.from("engine_one_memory").insert([
    {
      user_id: userId,
      role,
      content,
      metadata: metadata || {},
    },
  ]);
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const { userId, message } = JSON.parse(event.body || "{}");
    if (!userId || typeof userId !== "string") return json(400, { error: "Missing userId" });
    if (!message || typeof message !== "string") return json(400, { error: "Missing message" });

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return json(500, { error: "Supabase server env not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)" });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const systemPrompt =
      process.env.ENGINE_ONE_SYSTEM_PROMPT ||
      "You are Autokirk Engine One. Outcome guarantee: clarity → execution. Be concise, structured, and action-oriented.";

    const lookback = Math.max(0, Math.min(50, parseInt(process.env.MEMORY_LOOKBACK || "16", 10) || 16));

    // Store user message first
    await storeTurn({
      supabase,
      userId,
      role: "user",
      content: message,
      metadata: { source: "web", endpoint: "/api/react" },
    });

    const memory = await getMemory({ supabase, userId, lookback });

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return json(500, { error: "OPENAI_API_KEY not configured" });

    const client = new OpenAI({ apiKey: openaiKey });

    const messages = [
      { role: "system", content: systemPrompt },
      ...memory.filter((m) => m.role === "user" || m.role === "assistant"),
    ];

    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.4,
    });

    const reply = completion?.choices?.[0]?.message?.content?.trim() || "";

    await storeTurn({
      supabase,
      userId,
      role: "assistant",
      content: reply || "(empty)",
      metadata: { model, endpoint: "/api/react" },
    });

    return json(200, { reply });
  } catch (err) {
    return json(500, { error: err?.message || "Unknown server error" });
  }
}
