// /src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

const ENDPOINT = "/api/react"; // Netlify redirect should route /api/* -> /.netlify/functions/*

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso || "";
  }
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function copy(text) {
  return navigator.clipboard.writeText(text);
}

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);

  const [output, setOutput] = useState("");
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState("");

  const [ledger, setLedger] = useState([]);
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerLimit, setLedgerLimit] = useState(20);

  const [health, setHealth] = useState(null);

  const promptRef = useRef(null);

  const canRun = useMemo(() => prompt.trim().length > 0 && !running, [prompt, running]);

  async function fetchHealth() {
    try {
      const res = await fetch(`${ENDPOINT}?op=health`, { method: "GET" });
      const j = await res.json();
      setHealth(j);
    } catch {
      setHealth({ ok: false });
    }
  }

  async function refreshLedger(limit = ledgerLimit) {
    setLedgerError("");
    try {
      const res = await fetch(`${ENDPOINT}?op=ledger&limit=${encodeURIComponent(limit)}`, { method: "GET" });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Ledger request failed (${res.status})`);
      setLedger(j.data || []);
    } catch (e) {
      setLedger([]);
      setLedgerError(e?.message || "Failed to load ledger");
    }
  }

  async function execute() {
    if (!canRun) return;
    setRunning(true);
    setError("");
    setMeta(null);

    const p = prompt.trim();

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || `Request failed (${res.status})`);
      }

      setOutput(j.output || "");
      setMeta(j);

      // Refresh ledger after execution (best-effort)
      await refreshLedger(ledgerLimit);
    } catch (e) {
      setError(e?.message || "Request failed");
    } finally {
      setRunning(false);
    }
  }

  function onKeyDown(e) {
    // Ctrl+Enter to execute
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      execute();
    }
  }

  useEffect(() => {
    fetchHealth();
    refreshLedger(ledgerLimit);
    // autofocus
    setTimeout(() => promptRef.current?.focus?.(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ak-root">
      <style>{styles}</style>

      <header className="ak-header">
        <div className="ak-brand">
          <div className="ak-k">K</div>
          <div>
            <div className="ak-title">Autokirk Engine One</div>
            <div className="ak-subtitle">Clarity → Execution</div>
          </div>
        </div>

        <div className="ak-status">
          <div className="ak-pill">
            <span className="ak-dim">Endpoint:</span>
            <span className="ak-mono">{ENDPOINT}</span>
            <span className="ak-dim">• Supabase-backed memory</span>
          </div>

          <div className="ak-mini">
            <div className="ak-mini-row">
              <span className="ak-dim">AI Key:</span>{" "}
              <span className={health?.env?.has_OPENAI_API_KEY ? "ok" : "warn"}>
                {health?.env?.has_OPENAI_API_KEY ? "present" : "missing (fallback mode)"}
              </span>
            </div>
            <div className="ak-mini-row">
              <span className="ak-dim">Supabase:</span>{" "}
              <span className={health?.supabase?.ok ? "ok" : "warn"}>
                {health?.supabase?.ok ? "reachable" : "check env / RLS"}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="ak-main">
        <section className="ak-card">
          <div className="ak-card-head">
            <div>
              <div className="ak-h2">Operator Console</div>
              <div className="ak-dim">Ctrl+Enter executes. Every run logs to the ledger.</div>
            </div>

            <div className="ak-actions">
              <button
                className="ak-btn ak-btn-ghost"
                onClick={() => {
                  setPrompt("");
                  setOutput("");
                  setMeta(null);
                  setError("");
                  setTimeout(() => promptRef.current?.focus?.(), 10);
                }}
                disabled={running}
                title="Clear console"
              >
                Clear
              </button>

              <button
                className="ak-btn ak-btn-ghost"
                onClick={() => fetchHealth()}
                disabled={running}
                title="Re-check health"
              >
                Health
              </button>

              <button
                className="ak-btn ak-btn-primary"
                onClick={execute}
                disabled={!canRun}
                title="Execute (Ctrl+Enter)"
              >
                {running ? "Executing…" : "Execute"}
              </button>
            </div>
          </div>

          <textarea
            ref={promptRef}
            className="ak-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Enter your command to Engine One…"
            spellCheck={true}
          />

          {error ? (
            <div className="ak-alert ak-alert-error">
              <div className="ak-alert-title">Execution Error</div>
              <div className="ak-mono">{error}</div>
            </div>
          ) : null}

          {output ? (
            <div className="ak-output-wrap">
              <div className="ak-output-head">
                <div className="ak-h3">Engine Output</div>
                <div className="ak-output-actions">
                  <button className="ak-btn ak-btn-ghost" onClick={() => copy(output)} title="Copy output">
                    Copy
                  </button>
                  <button
                    className="ak-btn ak-btn-ghost"
                    onClick={() => {
                      const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `engine-one-output-${Date.now()}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    title="Download output as .txt"
                  >
                    Download
                  </button>
                </div>
              </div>

              <pre className="ak-output">{output}</pre>

              {meta ? (
                <div className="ak-meta">
                  <div className="ak-meta-row">
                    <span className="ak-dim">run_id:</span> <span className="ak-mono">{meta.run_id}</span>
                  </div>
                  <div className="ak-meta-row">
                    <span className="ak-dim">ai_used:</span>{" "}
                    <span className={meta.ai_used ? "ok" : "warn"}>{String(meta.ai_used)}</span>
                  </div>
                  <div className="ak-meta-row">
                    <span className="ak-dim">model:</span> <span className="ak-mono">{meta.model || "(none)"}</span>
                  </div>
                  <div className="ak-meta-row">
                    <span className="ak-dim">openai_ok:</span>{" "}
                    <span className={meta.openai_ok ? "ok" : "warn"}>{String(meta.openai_ok)}</span>
                    {meta.openai_error ? (
                      <>
                        {" "}
                        <span className="ak-dim">•</span> <span className="ak-mono">{meta.openai_error}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="ak-meta-row">
                    <span className="ak-dim">ledger_ok:</span>{" "}
                    <span className={meta.ledger_ok ? "ok" : "warn"}>{String(meta.ledger_ok)}</span>
                    {meta.ledger_error ? (
                      <>
                        {" "}
                        <span className="ak-dim">•</span> <span className="ak-mono">{meta.ledger_error}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="ak-meta-row">
                    <span className="ak-dim">server_time:</span>{" "}
                    <span className="ak-mono">{meta.server_time ? fmtTime(meta.server_time) : ""}</span>
                  </div>

                  <div className="ak-meta-actions">
                    <button
                      className="ak-btn ak-btn-ghost"
                      onClick={() => copy(JSON.stringify(meta, null, 2))}
                      title="Copy full response JSON"
                    >
                      Copy JSON
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="ak-note">
              Engine One is online. Submit an intent. The system will respond and log to memory.
            </div>
          )}
        </section>

        <section className="ak-card">
          <div className="ak-card-head">
            <div>
              <div className="ak-h2">Memory Ledger</div>
              <div className="ak-dim">Last {ledgerLimit} interactions stored in Supabase</div>
            </div>

            <div className="ak-actions">
              <div className="ak-inline">
                <span className="ak-dim">Limit</span>
                <input
                  className="ak-input"
                  type="number"
                  value={ledgerLimit}
                  min={1}
                  max={200}
                  onChange={(e) => setLedgerLimit(clamp(parseInt(e.target.value || "20", 10), 1, 200))}
                  disabled={running}
                />
              </div>

              <button className="ak-btn ak-btn-ghost" onClick={() => refreshLedger(ledgerLimit)} disabled={running}>
                Refresh Memory
              </button>
            </div>
          </div>

          {ledgerError ? (
            <div className="ak-alert ak-alert-warn">
              <div className="ak-alert-title">Ledger Error</div>
              <div className="ak-mono">{ledgerError}</div>
            </div>
          ) : null}

          <div className="ak-ledger">
            {ledger.length === 0 ? (
              <div className="ak-dim">No rows found yet.</div>
            ) : (
              ledger.map((row) => (
                <details className="ak-row" key={row.id || `${row.created_at}-${Math.random()}`}>
                  <summary className="ak-row-sum">
                    <div className="ak-row-left">
                      <span className="ak-time">{fmtTime(row.created_at)}</span>
                      <span className={`ak-badge ${row.ai_used ? "ok" : "warn"}`}>
                        {row.ai_used ? "AI" : "Fallback"}
                      </span>
                    </div>
                    <div className="ak-row-mid">
                      <span className="ak-mono ak-ellipsis">{row.prompt}</span>
                    </div>
                    <div className="ak-row-right">
                      <button
                        className="ak-btn ak-btn-ghost"
                        onClick={(e) => {
                          e.preventDefault();
                          setPrompt(row.prompt || "");
                          setOutput(row.answer || "");
                          setMeta(null);
                          setError("");
                          setTimeout(() => promptRef.current?.focus?.(), 10);
                        }}
                        title="Load into console"
                      >
                        Load
                      </button>

                      <button
                        className="ak-btn ak-btn-ghost"
                        onClick={(e) => {
                          e.preventDefault();
                          copy(row.prompt || "");
                        }}
                        title="Copy prompt"
                      >
                        Copy Prompt
                      </button>
                    </div>
                  </summary>

                  <div className="ak-row-body">
                    <div className="ak-row-grid">
                      <div>
                        <div className="ak-dim">Prompt</div>
                        <pre className="ak-pre">{row.prompt || ""}</pre>
                      </div>
                      <div>
                        <div className="ak-dim">Answer</div>
                        <pre className="ak-pre">{row.answer || ""}</pre>
                      </div>
                    </div>

                    <div className="ak-row-foot">
                      <span className="ak-dim">id:</span> <span className="ak-mono">{row.id}</span>
                      <span className="ak-dot">•</span>
                      <button className="ak-btn ak-btn-ghost" onClick={() => copy(row.answer || "")}>
                        Copy Answer
                      </button>
                      <button
                        className="ak-btn ak-btn-ghost"
                        onClick={() => {
                          setPrompt(row.prompt || "");
                          setOutput(row.answer || "");
                          setMeta(null);
                          setError("");
                          window.scrollTo({ top: 0, behavior: "smooth" });
                          setTimeout(() => promptRef.current?.focus?.(), 50);
                        }}
                      >
                        Open in Console
                      </button>
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </section>
      </main>

      <footer className="ak-footer">
        <span className="ak-dim">Engine One • Production build • Supabase is the sole memory source</span>
      </footer>
    </div>
  );
}

const styles = `
  :root{
    --bg:#060606;
    --panel: rgba(255,255,255,0.06);
    --panel2: rgba(255,255,255,0.04);
    --stroke: rgba(255,255,255,0.12);
    --gold: rgba(198,159,77,0.95);
    --gold2: rgba(198,159,77,0.35);
    --text: rgba(255,255,255,0.92);
    --dim: rgba(255,255,255,0.65);
    --bad: rgba(255,90,90,0.95);
    --warn: rgba(255,200,80,0.95);
    --ok: rgba(120,255,190,0.92);
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
  }
  *{ box-sizing:border-box; }
  body{
    margin:0;
    background:
      radial-gradient(900px 600px at 15% 10%, rgba(198,159,77,0.10), transparent 60%),
      radial-gradient(900px 600px at 80% 30%, rgba(198,159,77,0.08), transparent 60%),
      linear-gradient(180deg, #050505, #070707);
    color:var(--text);
    font-family:var(--sans);
  }
  .ak-root{ max-width: 1100px; margin: 0 auto; padding: 22px 16px 36px; }
  .ak-header{ display:flex; justify-content:space-between; gap:16px; align-items:flex-start; margin-bottom:14px; }
  .ak-brand{ display:flex; gap:12px; align-items:center; }
  .ak-k{
    width:42px; height:42px;
    border-radius:12px;
    display:flex; align-items:center; justify-content:center;
    font-weight:800;
    background: linear-gradient(180deg, rgba(198,159,77,0.18), rgba(198,159,77,0.06));
    border:1px solid var(--gold2);
    box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  }
  .ak-title{ font-size:18px; font-weight:800; letter-spacing:0.2px; }
  .ak-subtitle{ color:var(--dim); font-size:12px; margin-top:2px; }
  .ak-status{ display:flex; flex-direction:column; gap:8px; align-items:flex-end; }
  .ak-pill{
    padding:10px 12px;
    border-radius:14px;
    border:1px solid var(--stroke);
    background: rgba(0,0,0,0.25);
    backdrop-filter: blur(8px);
    font-size:12px;
    display:flex; gap:10px; align-items:center; flex-wrap:wrap;
  }
  .ak-mini{ font-size:12px; color:var(--dim); text-align:right; }
  .ak-mini-row{ margin-top:2px; }
  .ak-main{ display:flex; flex-direction:column; gap:14px; }
  .ak-card{
    border:1px solid rgba(198,159,77,0.22);
    background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
    border-radius: 18px;
    padding: 14px;
    box-shadow: 0 30px 80px rgba(0,0,0,0.55);
  }
  .ak-card-head{ display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:10px; }
  .ak-h2{ font-size:16px; font-weight:800; }
  .ak-h3{ font-size:13px; font-weight:800; color:var(--dim); }
  .ak-dim{ color:var(--dim); }
  .ak-mono{ font-family:var(--mono); }
  .ak-actions{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
  .ak-inline{ display:flex; gap:8px; align-items:center; }
  .ak-input{
    width:80px;
    padding:9px 10px;
    border-radius:12px;
    border:1px solid var(--stroke);
    background: rgba(0,0,0,0.25);
    color: var(--text);
    outline: none;
  }
  .ak-btn{
    border-radius: 14px;
    border: 1px solid var(--stroke);
    padding: 10px 12px;
    color: var(--text);
    background: rgba(0,0,0,0.25);
    cursor:pointer;
    font-weight:700;
  }
  .ak-btn:hover{ border-color: rgba(198,159,77,0.45); }
  .ak-btn:disabled{ opacity:0.55; cursor:not-allowed; }
  .ak-btn-primary{
    border-color: rgba(198,159,77,0.55);
    background: linear-gradient(180deg, rgba(198,159,77,0.28), rgba(198,159,77,0.12));
    color: rgba(255,255,255,0.95);
  }
  .ak-btn-ghost{ background: rgba(0,0,0,0.18); }
  .ak-textarea{
    width:100%;
    min-height: 160px;
    resize: vertical;
    border-radius: 16px;
    border: 1px solid rgba(198,159,77,0.35);
    outline:none;
    padding: 14px;
    background: radial-gradient(700px 250px at 20% 10%, rgba(198,159,77,0.10), transparent 55%),
                rgba(0,0,0,0.35);
    color: var(--text);
    font-family: var(--mono);
    font-size: 14px;
    line-height: 1.5;
  }
  .ak-alert{
    margin-top:10px;
    border-radius: 16px;
    padding: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.28);
  }
  .ak-alert-error{ border-color: rgba(255,90,90,0.35); }
  .ak-alert-warn{ border-color: rgba(255,200,80,0.30); }
  .ak-alert-title{ font-weight:900; margin-bottom:6px; color: rgba(255,255,255,0.92); }
  .ak-note{ margin-top:12px; color:var(--dim); }
  .ak-output-wrap{ margin-top:12px; }
  .ak-output-head{ display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px; }
  .ak-output-actions{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
  .ak-output{
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.35);
    padding: 12px;
    overflow:auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.55;
    margin: 0;
  }
  .ak-meta{
    margin-top: 10px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(0,0,0,0.25);
    padding: 10px 12px;
    font-size: 12px;
  }
  .ak-meta-row{ margin-top:6px; }
  .ak-meta-actions{ margin-top:10px; display:flex; justify-content:flex-end; }
  .ok{ color: var(--ok); font-weight:900; }
  .warn{ color: var(--warn); font-weight:900; }
  .bad{ color: var(--bad); font-weight:900; }
  .ak-ledger{ margin-top: 8px; display:flex; flex-direction:column; gap:10px; }
  .ak-row{
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(0,0,0,0.20);
    overflow:hidden;
  }
  .ak-row-sum{
    list-style:none;
    display:flex;
    gap:10px;
    justify-content:space-between;
    align-items:center;
    padding: 10px 12px;
    cursor:pointer;
  }
  .ak-row-sum::-webkit-details-marker{ display:none; }
  .ak-row-left{ display:flex; gap:10px; align-items:center; min-width: 190px; }
  .ak-time{ color: var(--dim); font-size: 12px; }
  .ak-badge{
    font-size: 11px;
    font-weight: 900;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(0,0,0,0.18);
  }
  .ak-row-mid{ flex: 1; min-width: 220px; }
  .ak-row-right{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
  .ak-ellipsis{
    display:block;
    max-width: 520px;
    overflow:hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ak-row-body{
    border-top: 1px solid rgba(255,255,255,0.08);
    padding: 12px;
  }
  .ak-row-grid{
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  @media (max-width: 900px){
    .ak-header{ flex-direction:column; align-items:stretch; }
    .ak-status{ align-items:flex-start; }
    .ak-row-grid{ grid-template-columns: 1fr; }
    .ak-ellipsis{ max-width: 100%; }
  }
  .ak-pre{
    margin: 6px 0 0;
    padding: 10px;
    border-radius: 14px;
    background: rgba(0,0,0,0.30);
    border: 1px solid rgba(255,255,255,0.08);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.5;
  }
  .ak-row-foot{
    margin-top: 10px;
    display:flex;
    gap:10px;
    align-items:center;
    flex-wrap:wrap;
    justify-content:flex-end;
    color: var(--dim);
    font-size: 12px;
  }
  .ak-dot{ color: rgba(255,255,255,0.25); }
  .ak-footer{
    margin-top: 14px;
    text-align:center;
    color: var(--dim);
    font-size: 12px;
  }
`;
