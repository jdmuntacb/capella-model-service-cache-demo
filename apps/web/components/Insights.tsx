"use client";

import { useEffect, useState } from "react";
import { HEADERS, costUSD, type CacheMode, type Pricing } from "@demo/core";
import type { Settings } from "./HelpdeskApp";
import { hitLabel } from "./format";
import { CouchbaseMark, IconClose, IconPlay } from "./icons";

export interface PublicConfig {
  mock: boolean;
  model: string;
  endpointHost: string;
  pricing: Pricing;
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
  target: { mock: boolean; model: string };
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
}) {
  const { config, settings, onSettings, ledger, sim } = props;
  const [tab, setTab] = useState<"live" | "bench">("live");
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

  const nextHeaders = [
    `${HEADERS.cacheType}: ${settings.mode}`,
    ...(settings.scoped ? [`${HEADERS.attributePrefix}topic: <conversation id>`] : []),
    ...(settings.mode === "semantic" && settings.threshold !== undefined ? [`${HEADERS.cacheThreshold}: ${settings.threshold.toFixed(2)}`] : []),
  ];

  return (
    <aside className="insights" aria-label="Gateway insights">
      <header className="ins-head">
        <span className="ins-mark">
          <CouchbaseMark size={22} />
        </span>
        <div>
          <div className="ins-title">Gateway insights</div>
          <div className="ins-sub">Capella Model Service</div>
        </div>
        <button className="icon-btn" onClick={props.onClose} aria-label="Close insights">
          <IconClose />
        </button>
      </header>

      <div className="ins-conn">
        <span className={`conn-dot ${config ? (config.mock ? "conn-mock" : "conn-live") : ""}`} />
        {config ? (config.mock ? "Mock gateway (simulated Bedrock)" : config.endpointHost) : "Connecting..."}
        {config && <code>{config.model}</code>}
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "live"} className={tab === "live" ? "on" : ""} onClick={() => setTab("live")}>
          Live session
        </button>
        <button role="tab" aria-selected={tab === "bench"} className={tab === "bench" ? "on" : ""} onClick={() => setTab("bench")}>
          Benchmark
        </button>
      </div>

      {tab === "live" ? (
        <div className="ins-body">
          <section>
            <div className="ins-label">Cache mode</div>
            <div className="segmented" role="radiogroup" aria-label="Cache mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={settings.mode === m.id}
                  className={settings.mode === m.id ? `on on-${m.id}` : ""}
                  onClick={() => onSettings({ ...settings, mode: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="ins-help">{MODES.find((m) => m.id === settings.mode)?.help}</p>
            <label className="toggle">
              <input type="checkbox" checked={settings.scoped} onChange={(e) => onSettings({ ...settings, scoped: e.target.checked })} />
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
              {ledger.length > 0 && (
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
              <button className="btn btn-dark btn-sm" onClick={() => props.onSimulate(20)}>
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
        <div className="ins-body">
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
