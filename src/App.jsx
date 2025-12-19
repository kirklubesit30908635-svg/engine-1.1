import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Engine One — Operator Console (Front-end)
 * - Calls /api/react for execution
 * - Calls /api/memory for ledger (fallbacks if missing)
 * - Surfaces full error diagnostics (status + body)
 *
 * Works in:
 * - Vite: import.meta.env
 * - CRA: process.env
 */

const DEFAULT_ENDPOINT = "/api/react";
const DEFAULT_MEMORY_ENDPOINT = "/api/memory";

function envPick(...keys) {
  // Vite
  if (typeof import.meta !== "undefined" && import.meta.env) {
    for (const k of keys) if (import.meta.env[k]) return import.meta.env[k];
  }
  // CRA / Node-style
  if (typeof process !== "undefined" && process.env) {
    for (const k of keys) if (process.env[k]) return process.env[k];
  }
  return undefined;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function toPretty(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

async function fetchWithTimeout(url, opts = {}, ms = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export default function App() {
  const ENDPOINT = envPick("VITE_ENGINE_ONE_ENDPOINT", "REACT_APP_ENGINE_ONE_ENDPOINT") || DEFAULT_ENDPOINT;
  const MEMORY_ENDPOINT =
    envPick("VITE_ENGINE_ONE_MEMORY_ENDPOINT", "REACT_APP_ENGINE_ONE_MEMORY_ENDPOINT") || DEFAULT_MEMORY_ENDPOINT;

  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [latencyMs, setLatencyMs] = useState(null);

  const [outputText, setOutputText] = useState("");
  const [rawResponse, setRawResponse] = useState(null);

  const [errorBox, setErrorBox] = useState(null);

  const [ledger, setLedger] = useState([]);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [ledgerError, setLedgerError] = useState(null);

  const outputRef = useRef(null);

  const stats = useMemo(() => {
    const charsIn = command?.length || 0;
    const charsOut = outputText?.length || 0;
    return { charsIn, charsOut };
  }, [command, outputText]);

  useEffect(() => {
    // initial ledger pull
    refreshMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [outputText]);

  function clearErrors() {
    setErrorBox(null);
    setLedgerError(null);
  }

  async function execute() {
    clearErrors();
    const trimmed = (command || "").trim();
    if (!trimmed) {
      setErrorBox({
        title: "Execution Error",
        detail: "Type an instruction first.",
        hint: "Example: “Draft a 5-step plan to launch Engine One today.”",
      });
      return;
    }

    setBusy(true);
    setLatencyMs(null);

    const started = performance.now();

    try {
      // Backend should accept JSON { prompt: string } OR { input: string }
      const body = { prompt: trimmed };

      const res = await fetchWithTimeout(
        ENDPOINT,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        45000
      );

      const elapsed = Math.round(performance.now() - started);
      setLatencyMs(elapsed);

      const text = await res.text();
      const maybeJson = safeJsonParse(text);

      if (!res.ok) {
        setErrorBox({
          title: "Request failed",
          detail: `HTTP ${res.status} ${res.statusText}`,
          hint:
            "This is coming from the serverless function. The response body below is the real root cause.",
          body: maybeJson || text,
        });
        setRawResponse(maybeJson || text);
        return;
      }

      // Normalize output across many possible backends:
      // - { output: "..."} or { answer: "..."} or { text: "..."} etc.
      const data = maybeJson ?? { raw: text };

      const normalized =
        (data && (data.output || data.answer || data.response || data.text)) ??
        (typeof data === "string" ? data : null) ??
        text;

      setRawResponse(data);
      setOutputText(String(normalized || ""));

      // After execution, attempt to refresh ledger
      refreshMemory();
    } catch (e) {
      const elapsed = Math.round(performance.now() - started);
      setLatencyMs(elapsed);

      const isAbort = e?.name === "AbortError";
      setErrorBox({
        title: "Request failed",
        detail: isAbort ? "Timeout waiting for /api/react" : (e?.message || String(e)),
        hint:
          "If timeout: your function is hanging or OpenAI call is failing upstream. Check Netlify Function logs.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshMemory() {
    setLedgerBusy(true);
    setLedgerError(null);

    try {
      // Primary: GET /api/memory
      let res = await fetchWithTimeout(MEMORY_ENDPOINT, { method: "GET" }, 25000);

      // Fallback: sometimes the function is only /api/react and supports ?mode=memory
      if (res.status === 404) {
        res = await fetchWithTimeout(`${ENDPOINT}?mode=memory`, { method: "GET" }, 25000);
      }

      const text = await res.text();
      const maybeJson = safeJsonParse(text);

      if (!res.ok) {
        setLedgerError({
          title: "Memory refresh failed",
          detail: `HTTP ${res.status} ${res.statusText}`,
          body: maybeJson || text,
        });
        return;
      }

      const data = maybeJson ?? [];
      // Accept either { rows: [...] } or [...] directly
      const rows = Array.isArray(data) ? data : Array.isArray(data.rows) ? data.rows : [];

      // Normalize rows to common display fields:
      const normalized = rows.map((r) => ({
        id: r.id ?? r.uuid ?? r.pk ?? null,
        created_at: r.created_at ?? r.createdAt ?? r.ts ?? null,
        prompt: r.prompt ?? r.input ?? r.command ?? "",
        answer: r.answer ?? r.output ?? r.response ?? "",
        ai_used: typeof r.ai_used === "boolean" ? r.ai_used : (r.ai_used ?? null),
      }));

      setLedger(normalized.slice(0, 20));
    } catch (e) {
      setLedgerError({
        title: "Memory refresh failed",
        detail: e?.message || String(e),
      });
    } finally {
      setLedgerBusy(false);
    }
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      execute();
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.title}>Operator Console</div>
            <div style={styles.sub}>
              Endpoint: <span style={styles.mono}>{ENDPOINT}</span> · Supabase-backed memory
            </div>
          </div>
          <div style={styles.badgeRow}>
            <span style={styles.badge}>Engine One · Production build</span>
            <span style={styles.badgeGhost}>Supabase is the sole memory source</span>
          </div>
        </header>

        <section style={styles.panel}>
          <label style={styles.label}>Input</label>
          <textarea
            style={styles.textarea}
            placeholder="Enter your command to Engine One..."
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
          />

          <div style={styles.actions}>
            <button
              style={{ ...styles.btnPrimary, opacity: busy ? 0.7 : 1 }}
              onClick={execute}
              disabled={busy}
            >
              {busy ? "Executing..." : "Execute"}
            </button>

            <button style={styles.btn} onClick={() => { setCommand(""); setOutputText(""); setRawResponse(null); clearErrors(); }}>
              Reset
            </button>

            <div style={{ flex: 1 }} />

            <button
              style={{ ...styles.btnSecondary, opacity: ledgerBusy ? 0.7 : 1 }}
              onClick={refreshMemory}
              disabled={ledgerBusy}
            >
              {ledgerBusy ? "Refreshing..." : "Refresh Memory"}
            </button>
          </div>

          <div style={styles.metricsRow}>
            <div style={styles.metric}>
              <div style={styles.metricLabel}>Latency</div>
              <div style={styles.metricVal}>{latencyMs == null ? "—" : `${latencyMs} ms`}</div>
            </div>
            <div style={styles.metric}>
              <div style={styles.metricLabel}>Chars In</div>
              <div style={styles.metricVal}>{stats.charsIn}</div>
            </div>
            <div style={styles.metric}>
              <div style={styles.metricLabel}>Chars Out</div>
              <div style={styles.metricVal}>{stats.charsOut}</div>
            </div>
            <div style={styles.metricWide}>
              <div style={styles.metricLabel}>Shortcut</div>
              <div style={styles.metricValSmall}><span style={styles.mono}>Ctrl/⌘ + Enter</span> to Execute</div>
            </div>
          </div>
        </section>

        {errorBox && (
          <section style={styles.errorBox}>
            <div style={styles.errorTitle}>{errorBox.title}</div>
            <div style={styles.errorDetail}>{errorBox.detail}</div>
            {errorBox.hint && <div style={styles.errorHint}>{errorBox.hint}</div>}
            {errorBox.body != null && (
              <pre style={styles.pre}>{toPretty(errorBox.body)}</pre>
            )}
          </section>
        )}

        <section style={styles.panel}>
          <label style={styles.label}>Visible Reaction</label>
          <div ref={outputRef} style={styles.output}>
            {outputText ? (
              <pre style={styles.outputPre}>{outputText}</pre>
            ) : (
              <div style={styles.dim}>
                If text appears after Execute, the system is alive.
              </div>
            )}
          </div>

          {rawResponse != null && (
            <details style={styles.details}>
              <summary style={styles.summary}>Raw response (diagnostics)</summary>
              <pre style={styles.pre}>{toPretty(rawResponse)}</pre>
            </details>
          )}
        </section>

        <section style={styles.panel}>
          <div style={styles.ledgerHeader}>
            <div>
              <div style={styles.label}>Memory Ledger</div>
              <div style={styles.sub}>Last 20 interactions stored in Supabase</div>
            </div>
          </div>

          {ledgerError && (
            <div style={styles.warnBox}>
              <div style={styles.warnTitle}>{ledgerError.title}</div>
              <div style={styles.warnDetail}>{ledgerError.detail}</div>
              {ledgerError.body != null && <pre style={styles.pre}>{toPretty(ledgerError.body)}</pre>}
            </div>
          )}

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Time</th>
                  <th style={styles.th}>AI</th>
                  <th style={styles.th}>Prompt</th>
                  <th style={styles.th}>Answer</th>
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 ? (
                  <tr>
                    <td style={styles.td} colSpan={4}>
                      <span style={styles.dim}>
                        {ledgerBusy ? "Loading memory..." : "No memory rows found yet."}
                      </span>
                    </td>
                  </tr>
                ) : (
                  ledger.map((r, idx) => (
                    <tr key={r.id ?? idx}>
                      <td style={styles.tdMono}>{r.created_at ? String(r.created_at) : "—"}</td>
                      <td style={styles.td}>
                        {r.ai_used === true ? "AI" : r.ai_used === false ? "Fallback" : "—"}
                      </td>
                      <td style={styles.td}>
                        <div style={styles.cell}>{String(r.prompt || "")}</div>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.cell}>{String(r.answer || "")}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer style={styles.footer}>
          Autokirk Engine One · Clarity → Execution
        </footer>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(1200px 600px at 20% 0%, rgba(255,215,0,0.10), transparent 60%), #0b0e12",
    color: "#e7e7e7",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
    padding: "28px 16px",
  },
  shell: {
    maxWidth: 1100,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 18,
  },
  title: {
    fontSize: 34,
    fontWeight: 800,
    letterSpacing: 0.2,
  },
  sub: {
    opacity: 0.8,
    marginTop: 6,
    fontSize: 14,
  },
  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace',
    fontSize: 13,
  },
  badgeRow: { display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" },
  badge: {
    border: "1px solid rgba(255,215,0,0.30)",
    background: "rgba(255,215,0,0.10)",
    padding: "8px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
  },
  badgeGhost: {
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    padding: "8px 10px",
    borderRadius: 999,
    fontSize: 12,
    opacity: 0.9,
    fontWeight: 600,
  },
  panel: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: 18,
    background: "rgba(10,12,16,0.72)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    marginBottom: 16,
  },
  label: { fontSize: 14, fontWeight: 800, marginBottom: 10, letterSpacing: 0.3 },
  textarea: {
    width: "100%",
    minHeight: 140,
    resize: "vertical",
    borderRadius: 16,
    border: "1px solid rgba(255,215,0,0.22)",
    outline: "none",
    background: "rgba(0,0,0,0.35)",
    color: "#f4f4f4",
    padding: 14,
    fontSize: 16,
    lineHeight: 1.35,
  },
  actions: { display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" },
  btnPrimary: {
    borderRadius: 14,
    padding: "10px 14px",
    border: "1px solid rgba(255,215,0,0.35)",
    background: "linear-gradient(180deg, rgba(255,215,0,0.22), rgba(255,215,0,0.10))",
    color: "#ffe58a",
    fontWeight: 900,
    cursor: "pointer",
  },
  btnSecondary: {
    borderRadius: 14,
    padding: "10px 14px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  btn: {
    borderRadius: 14,
    padding: "10px 14px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.20)",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  metricsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    marginTop: 14,
  },
  metric: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    background: "rgba(255,255,255,0.03)",
    padding: 12,
  },
  metricWide: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    background: "rgba(255,255,255,0.03)",
    padding: 12,
    gridColumn: "1 / -1",
  },
  metricLabel: { fontSize: 12, opacity: 0.75, fontWeight: 700 },
  metricVal: { fontSize: 20, fontWeight: 900, marginTop: 6 },
  metricValSmall: { fontSize: 14, fontWeight: 800, marginTop: 6, opacity: 0.95 },

  output: {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.30)",
    padding: 14,
    minHeight: 140,
    maxHeight: 360,
    overflow: "auto",
  },
  outputPre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace',
    fontSize: 14,
    lineHeight: 1.45,
  },
  dim: { opacity: 0.7, fontSize: 14 },
  details: { marginTop: 12 },
  summary: { cursor: "pointer", fontWeight: 800, opacity: 0.9 },
  pre: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    background: "rgba(0,0,0,0.40)",
    border: "1px solid rgba(255,255,255,0.08)",
    overflow: "auto",
    fontSize: 12,
    lineHeight: 1.4,
  },

  errorBox: {
    borderRadius: 18,
    border: "1px solid rgba(255,80,80,0.40)",
    background: "rgba(255,80,80,0.10)",
    padding: 16,
    marginBottom: 16,
  },
  errorTitle: { fontWeight: 1000, fontSize: 18, color: "#ffb3b3" },
  errorDetail: { marginTop: 6, fontWeight: 800 },
  errorHint: { marginTop: 8, opacity: 0.9 },

  warnBox: {
    borderRadius: 16,
    border: "1px solid rgba(255,215,0,0.25)",
    background: "rgba(255,215,0,0.08)",
    padding: 12,
    marginBottom: 12,
  },
  warnTitle: { fontWeight: 900 },
  warnDetail: { marginTop: 4, opacity: 0.95 },

  ledgerHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 },
  tableWrap: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    overflow: "hidden",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    fontWeight: 900,
  },
  td: { padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", verticalAlign: "top" },
  tdMono: {
    padding: "10px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    verticalAlign: "top",
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace',
    fontSize: 12,
    opacity: 0.95,
    whiteSpace: "nowrap",
  },
  cell: { whiteSpace: "pre-wrap", wordBreak: "break-word" },
  footer: { opacity: 0.7, fontSize: 12, marginTop: 16, textAlign: "center" },
};
