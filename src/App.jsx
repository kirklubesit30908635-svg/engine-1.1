import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Autokirk Engine One — Cockpit-Style Debugger UI
 * - Cockpit-inspired: status tiles, registry table, tabs, right-side inspector
 * - Works with Netlify Functions endpoint by default: /.netlify/functions/engine-one
 * - Memory ledger: tries netlify function (/.netlify/functions/memory) first, then optional direct Supabase
 *
 * Optional env vars (Vite):
 * - VITE_ENGINE_ONE_ENDPOINT        (default: "/.netlify/functions/engine-one")
 * - VITE_ENGINE_ONE_MEMORY_ENDPOINT (default: "/.netlify/functions/memory")
 * - VITE_SUPABASE_URL               (optional direct read)
 * - VITE_SUPABASE_ANON_KEY          (optional direct read; requires RLS policies)
 * - VITE_ENGINE_ONE_TABLE           (default: "engine_one_memory")
 */

const envPick = (...keys) => {
  try {
    // Vite
    if (typeof import.meta !== "undefined" && import.meta.env) {
      for (const k of keys) if (import.meta.env[k]) return import.meta.env[k];
    }
  } catch {}
  try {
    // CRA/node style
    if (typeof process !== "undefined" && process.env) {
      for (const k of keys) if (process.env[k]) return process.env[k];
    }
  } catch {}
  return undefined;
};

const DEFAULT_ENDPOINT =
  envPick("VITE_ENGINE_ONE_ENDPOINT", "REACT_APP_ENGINE_ONE_ENDPOINT") ||
  "/.netlify/functions/engine-one";

const DEFAULT_MEMORY_ENDPOINT =
  envPick("VITE_ENGINE_ONE_MEMORY_ENDPOINT", "REACT_APP_ENGINE_ONE_MEMORY_ENDPOINT") ||
  "/.netlify/functions/memory";

const SUPABASE_URL = envPick("VITE_SUPABASE_URL", "REACT_APP_SUPABASE_URL");
const SUPABASE_ANON_KEY = envPick("VITE_SUPABASE_ANON_KEY", "REACT_APP_SUPABASE_ANON_KEY");
const TABLE = envPick("VITE_ENGINE_ONE_TABLE", "REACT_APP_ENGINE_ONE_TABLE") || "engine_one_memory";

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const nowIso = () => new Date().toISOString();

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function formatTs(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

function pillTone(status) {
  switch (status) {
    case "Healthy":
      return "pill good";
    case "Degraded":
      return "pill warn";
    case "Blocked":
      return "pill bad";
    default:
      return "pill";
  }
}

function deriveHealth({ lastRunOk, lastLatencyMs, lastMemoryOk }) {
  // simple operator-grade signal
  if (lastRunOk === false) return "Blocked";
  if (lastMemoryOk === false) return "Degraded";
  if (typeof lastLatencyMs === "number" && lastLatencyMs > 2500) return "Degraded";
  return "Healthy";
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  const json = safeJsonParse(text);
  return { res, text, json };
}

// --- Optional direct Supabase REST read (no @supabase/supabase-js needed)
async function supabaseSelect({ limit = 50 }) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Direct Supabase read not configured (missing SUPABASE_URL/ANON_KEY).");
  }
  const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(TABLE)}?select=*&order=created_at.desc&limit=${limit}`;
  const { res, text, json } = await fetchJson(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "count=exact",
    },
  });
  if (!res.ok) {
    const msg = json?.message || text || `Supabase REST error (${res.status})`;
    throw new Error(msg);
  }
  return Array.isArray(json) ? json : [];
}

export default function App() {
  // Request controls
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [model, setModel] = useState("gpt-4.1-mini");
  const [temperature, setTemperature] = useState(0.35);
  const [maxTokens, setMaxTokens] = useState(900);
  const [engineKey, setEngineKey] = useState("");

  const [input, setInput] = useState("Define the fastest path to monetize Engine One on autokirk.com");

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [runOk, setRunOk] = useState(null); // null unknown
  const [runLatencyMs, setRunLatencyMs] = useState(null);
  const [raw, setRaw] = useState(null);
  const [visible, setVisible] = useState("Ready.");

  // Ledger
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState("");

  // Cockpit UI state
  const [tab, setTab] = useState("All"); // All | Executed | Needs Attention
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  // derived memory signal
  const [lastMemoryOk, setLastMemoryOk] = useState(null);

  const inputRef = useRef(null);

  const health = useMemo(
    () =>
      deriveHealth({
        lastRunOk: runOk,
        lastLatencyMs: runLatencyMs,
        lastMemoryOk: lastMemoryOk,
      }),
    [runOk, runLatencyMs, lastMemoryOk]
  );

  const counters = useMemo(() => {
    const total = ledger.length;
    const executed = ledger.filter((r) => (r.answer || r.response) && String(r.answer || r.response).trim().length > 0)
      .length;
    const needs = ledger.filter((r) => {
      const a = String(r.answer || r.response || "");
      // heuristic: fallback or error markers = needs attention
      return a.toLowerCase().includes("fallback") || a.toLowerCase().includes("error") || a.toLowerCase().includes("invalid");
    }).length;

    return { total, executed, needs };
  }, [ledger]);

  const filteredLedger = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = ledger;

    if (tab === "Executed") {
      rows = rows.filter((r) => String(r.answer || r.response || "").trim().length > 0);
    } else if (tab === "Needs Attention") {
      rows = rows.filter((r) => {
        const a = String(r.answer || r.response || "").toLowerCase();
        return a.includes("fallback") || a.includes("error") || a.includes("invalid");
      });
    }

    if (!q) return rows;
    return rows.filter((r) => {
      const p = String(r.prompt || "");
      const a = String(r.answer || r.response || "");
      const t = String(r.created_at || "");
      return (p + " " + a + " " + t).toLowerCase().includes(q);
    });
  }, [ledger, tab, search]);

  const selectedRow = useMemo(() => {
    if (!selectedId) return null;
    return ledger.find((r) => String(r.id) === String(selectedId)) || null;
  }, [ledger, selectedId]);

  async function loadLedger() {
    setLedgerLoading(true);
    setLedgerError("");
    setLastMemoryOk(null);

    // 1) try netlify memory function if it exists
    try {
      const { res, text, json } = await fetchJson(DEFAULT_MEMORY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });

      if (res.ok) {
        const rows = Array.isArray(json?.rows) ? json.rows : Array.isArray(json) ? json : [];
        setLedger(rows);
        setLastMemoryOk(true);
        if (!selectedId && rows[0]?.id) setSelectedId(String(rows[0].id));
        return;
      }

      // if function exists but fails, keep diagnostics and fall through to Supabase REST if configured
      const msg = json?.error || text || `Memory endpoint error (${res.status})`;
      setLedgerError(msg);
    } catch (e) {
      setLedgerError(e?.message || String(e));
    }

    // 2) optional direct supabase REST read
    try {
      const rows = await supabaseSelect({ limit: 50 });
      setLedger(rows);
      setLastMemoryOk(true);
      if (!selectedId && rows[0]?.id) setSelectedId(String(rows[0].id));
      return;
    } catch (e) {
      setLastMemoryOk(false);
      setLedgerError((prev) => prev || (e?.message || String(e)));
    } finally {
      setLedgerLoading(false);
    }
  }

  useEffect(() => {
    // initial load
    loadLedger().finally(() => setLedgerLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function execute() {
    const prompt = input.trim();
    if (!prompt) {
      setRunError("Input is empty.");
      setRunOk(false);
      return;
    }

    setIsRunning(true);
    setRunError("");
    setRunOk(null);
    setRunLatencyMs(null);
    setRaw(null);

    const started = performance.now();

    try {
      const payload = {
        prompt,
        model: model?.trim() || undefined,
        temperature: clamp(Number(temperature) || 0.35, 0, 2),
        max_output_tokens: clamp(Number(maxTokens) || 900, 32, 4096),
        // you can pass extra flags without breaking server; server may ignore
        meta: {
          client: "engine-one-cockpit-ui",
          ts: nowIso(),
        },
      };

      const headers = { "Content-Type": "application/json" };
      if (engineKey.trim()) headers["x-engine-key"] = engineKey.trim();

      const { res, text, json } = await fetchJson(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const elapsed = Math.round(performance.now() - started);
      setRunLatencyMs(elapsed);

      // normalize visible output
      let out =
        json?.output_text ||
        json?.answer ||
        json?.response ||
        json?.text ||
        json?.message ||
        (typeof json === "string" ? json : "") ||
        text;

      if (!out || !String(out).trim()) out = "No output returned.";

      setVisible(String(out));
      setRaw({
        status: res.status,
        ok: res.ok,
        elapsed_ms: elapsed,
        headers: {
          "content-type": res.headers.get("content-type"),
        },
        json,
        text: text?.slice(0, 20000),
      });

      if (!res.ok) {
        setRunOk(false);
        setRunError(
          json?.error ||
            json?.message ||
            `Request failed (${res.status}). Check Raw response (diagnostics).`
        );
      } else {
        setRunOk(true);
      }

      // refresh ledger after a run (best effort)
      await loadLedger();
    } catch (e) {
      setRunOk(false);
      setRunError(e?.message || String(e));
      setRaw({ exception: e?.message || String(e) });
    } finally {
      setIsRunning(false);
    }
  }

  function reset() {
    setInput("");
    setVisible("Ready.");
    setRunError("");
    setRunOk(null);
    setRunLatencyMs(null);
    setRaw(null);
    inputRef.current?.focus?.();
  }

  return (
    <div className="ak-root">
      <div className="ak-topbar">
        <div className="ak-brand">
          <div className="ak-mark" aria-hidden="true" />
          <div>
            <div className="ak-title">Autokirk Engine One</div>
            <div className="ak-sub">Clarity → Execution • Cockpit Debugger</div>
          </div>
        </div>

        <div className="ak-topbar-right">
          <span className={pillTone(health)}>
            <span className="dot" />
            {health}
          </span>
          <button className="btn ghost" onClick={loadLedger} disabled={ledgerLoading}>
            {ledgerLoading ? "Refreshing…" : "Refresh Ledger"}
          </button>
        </div>
      </div>

      <div className="ak-alert-strip">
        <div className="ak-alert-left">
          <div className="ak-alert-title">Operator Status</div>
          <div className="ak-alert-body">
            Endpoint: <span className="mono">{endpoint}</span>
            {runLatencyMs != null ? (
              <>
                {" "}
                • Last latency: <span className="mono">{runLatencyMs}ms</span>
              </>
            ) : null}
            {lastMemoryOk === false ? (
              <>
                {" "}
                • <span className="bad">Ledger read blocked</span>
              </>
            ) : lastMemoryOk === true ? (
              <>
                {" "}
                • <span className="good">Ledger online</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="ak-alert-actions">
          <button className="btn primary" onClick={execute} disabled={isRunning}>
            {isRunning ? "Executing…" : "Execute"}
          </button>
          <button className="btn" onClick={reset} disabled={isRunning}>
            Reset
          </button>
        </div>
      </div>

      <div className="ak-grid">
        {/* LEFT: Registry + input */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Execution Registry</div>
              <div className="panel-sub">
                Submit intent → run execution → persist to ledger. Control surface mirrors cockpit semantics.
              </div>
            </div>

            <div className="panel-actions">
              <button className="btn ghost small" onClick={() => setTab("All")}>
                All
              </button>
              <button className="btn ghost small" onClick={() => setTab("Executed")}>
                Executed
              </button>
              <button className="btn ghost small" onClick={() => setTab("Needs Attention")}>
                Needs Attention
              </button>
            </div>
          </div>

          {/* Status tiles */}
          <div className="tiles">
            <div className="tile">
              <div className="tile-label">Total</div>
              <div className="tile-value">{counters.total}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Executed</div>
              <div className="tile-value">{counters.executed}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Needs Attention</div>
              <div className="tile-value">{counters.needs}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Health</div>
              <div className="tile-value">{health}</div>
            </div>
          </div>

          {/* Intent input */}
          <div className="field-grid">
            <div className="field">
              <label>Endpoint</label>
              <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="input" />
            </div>
            <div className="field">
              <label>Model (optional)</label>
              <input value={model} onChange={(e) => setModel(e.target.value)} className="input" />
            </div>
            <div className="field">
              <label>x-engine-key (optional / gate)</label>
              <input value={engineKey} onChange={(e) => setEngineKey(e.target.value)} className="input" placeholder="Only needed if gated" />
            </div>
            <div className="field">
              <label>Temperature</label>
              <input
                type="number"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                className="input"
              />
            </div>
            <div className="field">
              <label>Max Output Tokens</label>
              <input
                type="number"
                step="10"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                className="input"
              />
            </div>
          </div>

          <div className="field">
            <label>Intent</label>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="textarea"
              placeholder="Enter your intent to Engine One…"
            />
            <div className="hint">
              Operator verbs: Execute → Observe → Resolve → Log.
            </div>
          </div>

          {/* Registry table */}
          <div className="registry-head">
            <div className="registry-title">
              Registry
              <span className="chip">{filteredLedger.length} shown</span>
            </div>

            <div className="registry-controls">
              <input
                className="input search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by prompt, answer, timestamp…"
              />
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 190 }}>Time</th>
                  <th>Prompt</th>
                  <th style={{ width: 160 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLedger.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      {ledgerLoading ? "Loading…" : "No rows to display."}
                      {ledgerError ? <div className="small bad">Ledger error: {ledgerError}</div> : null}
                    </td>
                  </tr>
                ) : (
                  filteredLedger.map((r) => {
                    const ans = String(r.answer || r.response || "");
                    const needs =
                      ans.toLowerCase().includes("fallback") ||
                      ans.toLowerCase().includes("error") ||
                      ans.toLowerCase().includes("invalid");

                    const status = needs ? "Needs Attention" : ans.trim() ? "Active" : "Paused";

                    const isSel = String(selectedId) === String(r.id);

                    return (
                      <tr key={String(r.id)} className={isSel ? "row sel" : "row"}>
                        <td>
                          <span className={needs ? "badge warn" : "badge ok"}>{status}</span>
                        </td>
                        <td className="mono">{formatTs(r.created_at)}</td>
                        <td className="truncate">{String(r.prompt || "").trim() || <span className="muted">—</span>}</td>
                        <td>
                          <div className="row-actions">
                            <button className="btn tiny" onClick={() => setSelectedId(String(r.id))}>
                              View
                            </button>
                            <button
                              className="btn tiny ghost"
                              onClick={() => {
                                setInput(String(r.prompt || ""));
                                inputRef.current?.focus?.();
                              }}
                            >
                              Fork
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {runError ? (
            <div className="error-box">
              <div className="error-title">Execution Error</div>
              <div className="error-body">{runError}</div>
            </div>
          ) : null}
        </div>

        {/* RIGHT: Inspector (cockpit style) */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Inspector</div>
              <div className="panel-sub">Selected run details, visible output, and diagnostics.</div>
            </div>

            <div className="panel-actions">
              <button
                className="btn ghost small"
                onClick={() => {
                  if (!selectedRow?.prompt) return;
                  setInput(String(selectedRow.prompt));
                  inputRef.current?.focus?.();
                }}
                disabled={!selectedRow?.prompt}
              >
                Load Intent
              </button>
            </div>
          </div>

          <div className="inspector">
            <div className="inspector-section">
              <div className="inspector-title">Visible Reaction</div>
              <pre className="pre">{visible}</pre>
            </div>

            <div className="inspector-section">
              <div className="inspector-title">Selected Ledger Row</div>
              {selectedRow ? (
                <div className="kv">
                  <div className="kv-row">
                    <div className="kv-k">id</div>
                    <div className="kv-v mono">{String(selectedRow.id)}</div>
                  </div>
                  <div className="kv-row">
                    <div className="kv-k">created_at</div>
                    <div className="kv-v mono">{String(selectedRow.created_at)}</div>
                  </div>
                  <div className="kv-row">
                    <div className="kv-k">ai_used</div>
                    <div className="kv-v mono">{String(selectedRow.ai_used ?? selectedRow.ai_used === false ? selectedRow.ai_used : "—")}</div>
                  </div>
                  <div className="kv-row">
                    <div className="kv-k">prompt</div>
                    <div className="kv-v">{String(selectedRow.prompt || "")}</div>
                  </div>
                  <div className="kv-row">
                    <div className="kv-k">answer</div>
                    <div className="kv-v">{String(selectedRow.answer || selectedRow.response || "")}</div>
                  </div>
                </div>
              ) : (
                <div className="muted">No row selected.</div>
              )}
            </div>

            <details className="details" open={false}>
              <summary>Raw response (diagnostics)</summary>
              <pre className="pre small">{raw ? JSON.stringify(raw, null, 2) : "No diagnostics yet."}</pre>
            </details>

            <div className="inspector-footer">
              <div className="foot-note">
                Supabase-backed ledger table: <span className="mono">{TABLE}</span>
              </div>
              <div className="foot-note">
                If ledger reads fail: set RLS policies or provide memory function endpoint.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="ak-footer">
        <div>Engine One • Production build • “money is the signal” discipline</div>
        <div className="mono">
          {SUPABASE_URL ? "Supabase: configured" : "Supabase: not configured"} •{" "}
          {DEFAULT_MEMORY_ENDPOINT ? `Memory endpoint: ${DEFAULT_MEMORY_ENDPOINT}` : "Memory endpoint: none"}
        </div>
      </div>
    </div>
  );
}

