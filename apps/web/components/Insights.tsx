"use client";

import { useEffect, useState } from "react";
import { HEADERS, costUSD, isEmbeddingModel, type CacheMode, type GatewayInfo, type ModelInfo, type Pricing, type Trace } from "@demo/core";
import { GatewayInfoView, connectionLabel, connectionPayload, type Connection } from "./ConnectionDialog";
import type { Settings } from "./HelpdeskApp";
import TraceView from "./TraceView";
import { hitLabel } from "./format";
import { CouchbaseMark, IconClose, IconExpand, IconPlay, IconSettings, IconShrink } from "./icons";

export interface PublicConfig {
  mock: boolean;
  model: string;
  endpointHost: string;
  pricing: Pricing;
  customConnectionAllowed: boolean;
}

export interface LedgerEntry {
  id: string;
  at: number;
  who: string;
  question: string;
  source: "chat" | "office";
  mode: CacheMode;
  cacheHit: boolean;
  matchScore?: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  scoped: boolean;
  trace?: Trace;
  error?: string;
  /** First message of a conversation, so the request is identical to any earlier ask of the same question. */
  firstTurn: boolean;
  repeatMiss?: boolean;
  /** "embedding" = POST /v1/embeddings, which the gateway never caches. */
  kind?: "chat" | "embedding";
  model?: string;
  dimensions?: number;
}

interface ModeRunSummary {
  mode: CacheMode;
  summary: {
    hitRate: number;
    upstreamCalls: number;
    billedTokens: number;
    costUSD: number;
    latency: { avg: number; p95: number };
  };
  modelBusyMs: number;
}

interface Benchmark {
  startedAt: string;
  dir: string;
  target: { mock: boolean; model: string; gateway?: GatewayInfo | null };
  options: { requests: number };
  runs: ModeRunSummary[];
}

const MODES: { id: CacheMode; label: string; help: string }[] = [
  { id: "none", label: "No cache", help: "Every question goes to Claude on Bedrock. This is the baseline." },
  { id: "standard", label: "Standard", help: "Exact match: SHA-256 of the full request. Identical questions are answered from Couchbase." },
  { id: "semantic", label: "Semantic", help: "Exact match first, then vector search: reworded questions with the same meaning are answered from Couchbase." },
];
const MODE_LABEL: Record<CacheMode, string> = { none: "No cache", standard: "Standard", semantic: "Semantic" };

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const fmtUsd = (x: number) => `$${x < 1 ? x.toFixed(4) : x.toFixed(2)}`;
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

function Bars({ title, rows, fmt }: { title: string; rows: { mode: CacheMode; value: number }[]; fmt: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="bars">
      <figcaption>{title}</figcaption>
      {rows.map((r) => (
        <div className="bar-row" key={r.mode}>
          <span className="bar-lbl">{MODE_LABEL[r.mode]}</span>
          <span className="bar-track">
            <span className={`bar-fill fill-${r.mode}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="bar-val">{fmt(r.value)}</span>
        </div>
      ))}
    </figure>
  );
}

export default function Insights(props: {
  config: PublicConfig | null;
  pricing?: Pricing;
  settings: Settings;
  onSettings: (s: Settings) => void;
  ledger: LedgerEntry[];
  onClear: () => void;
  sim: { running: boolean; done: number; total: number };
  onSimulate: (n: number) => void;
  onStopSim: () => void;
  onClose: () => void;
  connection: Connection;
  model: string;
  onModel: (model: string) => void;
  onOpenConnection: () => void;
}) {
  const { config, settings, onSettings, sim } = props;
  // Failed requests and embeddings show in Traces but not in the cache savings figures.
  const ledger = props.ledger.filter((e) => !e.error && e.kind !== "embedding");
  const embedModel = isEmbeddingModel(props.model);
  const [full, setFull] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tab, setTab] = useState<"live" | "traces" | "bench">("live");
  const [openTrace, setOpenTrace] = useState<string | null>(null);
  const conn = connectionLabel(props.connection, config);
  const [info, setInfo] = useState<GatewayInfo | null | undefined>(undefined);
  const [infoOpen, setInfoOpen] = useState(false);
  // Only the endpoint and key decide which models exist; picking a model must not refetch.
  const modelsKey = JSON.stringify({ ...connectionPayload(props.connection), model: undefined });

  useEffect(() => {
    let cancelled = false;
    setInfo(undefined);
    // /api/models lists the models and reads /v1/info in one call.
    fetch("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: modelsKey })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setInfo(j.info ?? null);
        setModels(Array.isArray(j.models) ? j.models : []);
      })
      .catch(() => !cancelled && setInfo(null));
    return () => {
      cancelled = true;
    };
  }, [modelsKey]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  const [bench, setBench] = useState<Benchmark | null | undefined>(undefined);

  useEffect(() => {
    if (tab !== "bench" || bench !== undefined) return;
    fetch("/api/benchmark")
      .then((r) => r.json())
      .then(setBench)
      .catch(() => setBench(null));
  }, [tab, bench]);

  const hits = ledger.filter((e) => e.cacheHit);
  const misses = ledger.filter((e) => !e.cacheHit);
  const tokensSaved = hits.reduce((a, e) => a + e.promptTokens + e.completionTokens, 0);
  const tokensBilled = misses.reduce((a, e) => a + e.promptTokens + e.completionTokens, 0);
  const pricing = props.pricing;
  const saved = pricing ? hits.reduce((a, e) => a + costUSD(e.promptTokens, e.completionTokens, pricing), 0) : 0;
  const missAvg = mean(misses.map((e) => e.latencyMs));
  const hitAvg = mean(hits.map((e) => e.latencyMs));
  const waitSaved = misses.length ? hits.reduce((a, e) => a + Math.max(0, missAvg - e.latencyMs), 0) : 0;
  const recent = ledger.slice(-40);
  const maxLat = Math.max(1, ...recent.map((e) => e.latencyMs));

  const chatModels = models.filter((m) => !isEmbeddingModel(m.name));
  const embedModels = models.filter((m) => isEmbeddingModel(m.name));
  const custom = props.connection.source === "custom";
  const selected = props.connection.model;
  const listed = models.some((m) => m.name === selected);

  const nextHeaders = embedModel
    ? ["POST /v1/embeddings", "No X-cb-cache header: embeddings", "are not cached by the gateway."]
    : [
    `${HEADERS.cacheType}: ${settings.mode}`,
    ...(settings.scoped ? [`${HEADERS.attributePrefix}topic: <conversation id>`] : []),
    ...(settings.mode === "semantic" && settings.threshold !== undefined ? [`${HEADERS.cacheThreshold}: ${settings.threshold.toFixed(2)}`] : []),
      ];

  return (
    <aside className={`insights ${full ? "full" : ""}`} aria-label="Gateway insights">
      <header className="ins-head">
        <span className="ins-mark">
          <CouchbaseMark size={22} />
        </span>
        <div>
          <div className="ins-title">Gateway insights</div>
          <div className="ins-sub">Capella Model Service</div>
        </div>
        <button
          className="icon-btn"
          onClick={() => setFull((f) => !f)}
          aria-pressed={full}
          aria-label={full ? "Exit full screen" : "Expand to full screen"}
          title={full ? "Exit full screen (Esc)" : "Expand to full screen"}
        >
          {full ? <IconShrink /> : <IconExpand />}
        </button>
        <button className="icon-btn" onClick={props.onClose} aria-label="Close insights">
          <IconClose />
        </button>
      </header>

      <button className="ins-conn" onClick={props.onOpenConnection} title="Connection settings: endpoint, API key and model">
        <span className={`conn-dot ${config || props.connection.source !== "server" ? (conn.mock ? "conn-mock" : "conn-live") : ""}`} />
        <span className="conn-host">{conn.host}</span>
        <code>{props.model}</code>
        <IconSettings />
      </button>
      {info && (
        <div className="ins-gw">
          <button className="link" onClick={() => setInfoOpen((o) => !o)} aria-expanded={infoOpen}>
            Gateway {info.version}
            {info.commitHash ? ` · ${info.commitHash}` : ""} · {info.models.filter((m) => m.status === "healthy" && m.reachable !== false).length}/{info.models.length} models healthy
          </button>
          {infoOpen && <GatewayInfoView info={info} />}
        </div>
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "live"} className={tab === "live" ? "on" : ""} onClick={() => setTab("live")}>
          Live session
        </button>
        <button role="tab" aria-selected={tab === "traces"} className={tab === "traces" ? "on" : ""} onClick={() => setTab("traces")}>
          Traces{props.ledger.length ? ` (${props.ledger.length})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "bench"} className={tab === "bench" ? "on" : ""} onClick={() => setTab("bench")}>
          Benchmark
        </button>
      </div>

      {tab === "traces" ? (
        <div className="ins-body">
          <p className="ins-help">Every request this session, newest first, including office traffic. Open one to see why it was a hit or a miss and the exact request and response.</p>
          {props.ledger.length === 0 && <p className="empty-note">No requests yet.</p>}
          <ul className="trace-list">
            {props.ledger
              .slice()
              .reverse()
              .map((e) => (
                <li key={e.id} className={openTrace === e.id ? "open" : ""}>
                  <button className="trace-item" onClick={() => setOpenTrace(openTrace === e.id ? null : e.id)} aria-expanded={openTrace === e.id}>
                    <span className={`feed-dot ${e.error ? "err" : e.cacheHit ? "hit" : "miss"}`} />
                    <span className="trace-item-q">{e.question}</span>
                    <span className="trace-item-meta">
                      {e.error ? "failed" : e.kind === "embedding" ? `embedding · ${e.dimensions ?? "?"} dims` : e.cacheHit ? "hit" : e.mode === "none" ? "no cache" : e.repeatMiss ? "repeat miss" : "miss"} · {fmtMs(e.latencyMs)}
                    </span>
                  </button>
                  {openTrace === e.id && (
                    <TraceView
                      mode={e.mode}
                      cacheHit={e.cacheHit}
                      matchScore={e.matchScore}
                      promptTokens={e.promptTokens}
                      completionTokens={e.completionTokens}
                      latencyMs={e.latencyMs}
                      scoped={e.scoped}
                      trace={e.trace}
                      error={e.error}
                      repeatMiss={e.repeatMiss}
                      embedding={e.kind === "embedding" ? { model: e.model ?? props.model, dimensions: e.dimensions ?? 0 } : undefined}
                    />
                  )}
                </li>
              ))}
          </ul>
        </div>
      ) : tab === "live" ? (
        <div className="ins-body ins-grid">
          <section>
            <label className="ins-label" htmlFor="ins-model">
              Model
            </label>
            <select id="ins-model" className="ins-select" value={selected} onChange={(e) => props.onModel(e.target.value)}>
              {!custom && <option value="">Server default ({config?.model ?? "CMS_MODEL"})</option>}
              {selected && !listed && <option value={selected}>{selected}</option>}
              {chatModels.length > 0 && (
                <optgroup label="Chat: /v1/chat/completions">
                  {chatModels.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {embedModels.length > 0 && (
                <optgroup label="Embedding: /v1/embeddings">
                  {embedModels.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="ins-help">
              {embedModel
                ? "Embedding model: each message is sent to /v1/embeddings and the reply shows the vector and its similarity to earlier questions. The gateway does not cache embeddings."
                : "Chat model: messages go to /v1/chat/completions through the cache. Pick an embedding model to see the vectors the semantic cache compares."}
            </p>
          </section>

          <section className={embedModel ? "is-disabled" : ""}>
            <div className="ins-label">Cache mode</div>
            {embedModel && <p className="ins-help">Not used for embeddings. Pick a chat model to use the cache.</p>}
            <div className="segmented" role="radiogroup" aria-label="Cache mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={settings.mode === m.id}
                  className={settings.mode === m.id ? `on on-${m.id}` : ""}
                  disabled={embedModel}
                  onClick={() => onSettings({ ...settings, mode: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="ins-help">{MODES.find((m) => m.id === settings.mode)?.help}</p>
            <label className="toggle">
              <input type="checkbox" checked={settings.scoped} disabled={embedModel} onChange={(e) => onSettings({ ...settings, scoped: e.target.checked })} />
              <span>
                Scope to each conversation
                <small>Sends {HEADERS.attributePrefix}topic so answers are reused only within the same conversation. Safer for follow-up questions, but fewer hits.</small>
              </span>
            </label>
            {settings.mode === "semantic" && (
              <div className="threshold">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.threshold !== undefined}
                    disabled={embedModel}
                    onChange={(e) => onSettings({ ...settings, threshold: e.target.checked ? 0.75 : undefined })}
                  />
                  <span>
                    Override similarity threshold
                    <small>Defaults to the gateway&apos;s scoreThreshold. Lower values match looser rewordings.</small>
                  </span>
                </label>
                {settings.threshold !== undefined && (
                  <div className="slider">
                    <input
                      type="range"
                      min={0.5}
                      max={0.99}
                      step={0.01}
                      value={settings.threshold}
                      onChange={(e) => onSettings({ ...settings, threshold: Number(e.target.value) })}
                      aria-label="Similarity threshold"
                    />
                    <output>{settings.threshold.toFixed(2)}</output>
                  </div>
                )}
              </div>
            )}
            <pre className="headers" aria-label="Headers sent with the next request">{nextHeaders.join("\n")}</pre>
          </section>

          <section>
            <div className="ins-label-row">
              <span className="ins-label">This session</span>
              {props.ledger.length > 0 && (
                <button className="link" onClick={props.onClear}>
                  Reset
                </button>
              )}
            </div>
            <div className="tiles">
              <div className="tile">
                <span>Tokens saved</span>
                <b>{tokensSaved.toLocaleString()}</b>
                <small>{tokensBilled.toLocaleString()} billed{pricing ? ` · ${fmtUsd(saved)} saved` : ""}</small>
              </div>
              <div className="tile">
                <span>Bedrock calls avoided</span>
                <b>{hits.length}</b>
                <small>of {ledger.length} requests ({ledger.length ? Math.round((hits.length / ledger.length) * 100) : 0}%)</small>
              </div>
              <div className="tile">
                <span>Avg response</span>
                <b>{hits.length ? fmtMs(hitAvg) : "-"}</b>
                <small>from cache vs {misses.length ? fmtMs(missAvg) : "-"} from Bedrock</small>
              </div>
              <div className="tile">
                <span>Wait time saved</span>
                <b>{misses.length && hits.length ? fmtMs(waitSaved) : "-"}</b>
                <small>across all employees</small>
              </div>
            </div>
            {recent.length > 0 && (
              <figure className="spark" aria-label="Latency of recent requests">
                <figcaption>
                  Latency per request <span className="legend"><i className="lg-hit" /> cache <i className="lg-miss" /> Bedrock</span>
                </figcaption>
                <div className="spark-bars">
                  {recent.map((e) => (
                    <span
                      key={e.id}
                      className={e.cacheHit ? "hit" : "miss"}
                      style={{ height: `${Math.max(4, (e.latencyMs / maxLat) * 100)}%` }}
                      title={`${e.who}: ${e.question} - ${fmtMs(e.latencyMs)}${e.cacheHit ? " (cache)" : ""}`}
                    />
                  ))}
                </div>
              </figure>
            )}
          </section>

          <section>
            <div className="ins-label">Office traffic</div>
            <p className="ins-help">Replay a burst of questions from colleagues across Acme, with the current cache settings.</p>
            {sim.running ? (
              <div className="sim-run">
                <progress value={sim.done} max={sim.total} />
                <span>
                  {sim.done}/{sim.total}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={props.onStopSim}>
                  Stop
                </button>
              </div>
            ) : (
              <button className="btn btn-dark btn-sm" onClick={() => props.onSimulate(20)} disabled={embedModel} title={embedModel ? "Pick a chat model to simulate office traffic" : undefined}>
                <IconPlay /> Simulate 20 colleagues
              </button>
            )}
            <ul className="feed">
              {ledger
                .slice(-8)
                .reverse()
                .map((e) => (
                  <li key={e.id}>
                    <span className={`feed-dot ${e.cacheHit ? "hit" : "miss"}`} />
                    <div>
                      <div className="feed-q">{e.question}</div>
                      <div className="feed-meta">
                        {e.who} · {e.cacheHit ? `cache hit, ${hitLabel(e.mode, e.matchScore)}` : "Bedrock"} ·{" "}
                        {fmtMs(e.latencyMs)}
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      ) : (
        <div className="ins-body ins-grid">
          {bench === undefined && <p className="ins-help">Loading the latest benchmark...</p>}
          {bench === null && (
            <p className="ins-help">
              No benchmark yet. Run <code>npm run bench</code> to compare all three modes on the same helpdesk workload.
            </p>
          )}
          {bench && (
            <>
              <p className="ins-help">
                {bench.options.requests} helpdesk questions per mode against {bench.target.mock ? "the mock gateway" : "Capella Model Service"} ·{" "}
                {new Date(bench.startedAt).toLocaleString()}
                {bench.target.gateway ? ` · gateway ${bench.target.gateway.version}${bench.target.gateway.commitHash ? ` (${bench.target.gateway.commitHash})` : ""}` : ""}
              </p>
              <Bars title="Billed tokens" fmt={(v) => Math.round(v).toLocaleString()} rows={bench.runs.map((r) => ({ mode: r.mode, value: r.summary.billedTokens }))} />
              <Bars title="Average latency" fmt={fmtMs} rows={bench.runs.map((r) => ({ mode: r.mode, value: r.summary.latency.avg }))} />
              <Bars title="Bedrock calls" fmt={(v) => String(Math.round(v))} rows={bench.runs.map((r) => ({ mode: r.mode, value: r.summary.upstreamCalls }))} />
              <Bars title="Model generation time" fmt={fmtMs} rows={bench.runs.map((r) => ({ mode: r.mode, value: r.modelBusyMs }))} />
              <Bars title="Estimated cost" fmt={fmtUsd} rows={bench.runs.map((r) => ({ mode: r.mode, value: r.summary.costUSD }))} />
              <button className="link" onClick={() => setBench(undefined)}>
                Refresh
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
