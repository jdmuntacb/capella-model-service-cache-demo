"use client";

import { useEffect, useRef, useState } from "react";
import { isEmbeddingModel, type GatewayInfo, type ModelInfo } from "@demo/core";
import type { PublicConfig } from "./Insights";
import { IconClose } from "./icons";

export interface Connection {
  source: "server" | "mock" | "custom";
  endpoint: string;
  apiKey: string;
  /** Empty = the server's CMS_MODEL. */
  model: string;
  /** Keep the API key in localStorage; otherwise only for this browser tab (sessionStorage). */
  rememberKey: boolean;
}

export const DEFAULT_CONNECTION: Connection = { source: "server", endpoint: "", apiKey: "", model: "", rememberKey: false };

const CONN_KEY = "acme-desk-connection";
const SESSION_KEY = "acme-desk-api-key";

export function loadConnection(): Connection {
  try {
    const stored = JSON.parse(localStorage.getItem(CONN_KEY) ?? "null") as Partial<Connection> | null;
    if (!stored) return DEFAULT_CONNECTION;
    const apiKey = stored.rememberKey ? (stored.apiKey ?? "") : (sessionStorage.getItem(SESSION_KEY) ?? "");
    return { ...DEFAULT_CONNECTION, ...stored, apiKey };
  } catch {
    return DEFAULT_CONNECTION;
  }
}

export function saveConnection(c: Connection) {
  try {
    localStorage.setItem(CONN_KEY, JSON.stringify({ ...c, apiKey: c.rememberKey ? c.apiKey : "" }));
    if (c.rememberKey || !c.apiKey) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, c.apiKey);
  } catch {
    // storage unavailable; the connection still applies until the page reloads
  }
}

/** What the API routes receive. The key goes only to this demo's own server. */
export function connectionPayload(c: Connection) {
  if (c.source === "custom") return { source: c.source, endpoint: c.endpoint, apiKey: c.apiKey, model: c.model };
  return { source: c.source, model: c.model || undefined };
}

export function connectionLabel(c: Connection, config: PublicConfig | null) {
  if (c.source === "mock") return { host: "Mock gateway (simulated Bedrock)", mock: true };
  if (c.source === "custom") {
    try {
      return { host: new URL(c.endpoint).host, mock: false };
    } catch {
      return { host: "custom endpoint", mock: false };
    }
  }
  if (!config) return { host: "Connecting...", mock: false };
  return { host: config.mock ? "Mock gateway (simulated Bedrock)" : config.endpointHost, mock: config.mock };
}

const fmtTtl = (s?: number) => (s === undefined ? undefined : s % 3600 === 0 ? `${s / 3600} h` : `${Math.round(s)} s`);

/** Version and model health from GET /v1/info. */
export function GatewayInfoView({ info }: { info: GatewayInfo }) {
  const ttl = fmtTtl(info.defaults.cacheExpirySeconds);
  return (
    <div className="gw-info">
      <div className="gw-info-line">
        <b>Gateway {info.version}</b>
        {info.commitHash && <code>{info.commitHash}</code>}
        {info.buildTime && <span>built {info.buildTime.slice(0, 10)}</span>}
        {ttl && <span>default cache TTL {ttl}</span>}
      </div>
      <ul className="gw-models">
        {info.models.map((m) => (
          <li key={m.id} title={m.id}>
            <span className={`feed-dot ${m.status === "healthy" && m.reachable !== false ? "ok" : "err"}`} />
            <span className="gw-model-name">{m.name}</span>
            <span className="gw-model-meta">
              {isEmbeddingModel(m.name) ? "embedding · " : ""}
              {m.serverKind ? `${m.serverKind} · ` : ""}
              {m.status ?? "unknown"}
              {m.reachable === false ? ", unreachable" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type TestState = { status: "idle" } | { status: "testing" } | { status: "ok"; models: ModelInfo[]; info: GatewayInfo | null; latencyMs: number; host: string } | { status: "error"; message: string };

export default function ConnectionDialog(props: {
  value: Connection;
  config: PublicConfig | null;
  onSave: (c: Connection) => void;
  onClose: () => void;
}) {
  const { config } = props;
  const [c, setC] = useState<Connection>(props.value);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const first = useRef<HTMLInputElement>(null);
  const customAllowed = config?.customConnectionAllowed !== false;
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = (patch: Partial<Connection>) => {
    setC((prev) => ({ ...prev, ...patch }));
    if ("source" in patch || "endpoint" in patch || "apiKey" in patch) setTest({ status: "idle" });
  };

  async function runTest() {
    setTest({ status: "testing" });
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connectionPayload(c)),
      });
      const json = await res.json();
      if (!res.ok) return setTest({ status: "error", message: json.error ?? `HTTP ${res.status}` });
      setTest({ status: "ok", models: json.models, info: json.info ?? null, latencyMs: json.latencyMs, host: json.endpointHost });
      const listed = json.models as ModelInfo[];
      const chat = listed.filter((m) => !isEmbeddingModel(m.name));
      // Keep the current choice if it is listed; otherwise pick the first chat model.
      if (chat.length && !listed.some((m) => m.name === c.model)) set({ model: c.source === "custom" ? chat[0].name : "" });
    } catch (err) {
      setTest({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const models = test.status === "ok" ? test.models : [];
  const chatModels = models.filter((m) => !isEmbeddingModel(m.name));
  const embedModels = models.filter((m) => isEmbeddingModel(m.name));
  const canSave = c.source !== "custom" || (c.endpoint.trim() && c.apiKey && c.model.trim());
  const serverModel = config?.model ?? "CMS_MODEL";

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="conn-title">
        <header className="modal-head">
          <h2 id="conn-title">Connection settings</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>

        <form
          className="modal-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) props.onSave({ ...c, endpoint: c.endpoint.trim(), model: c.model.trim() });
          }}
        >
          <fieldset className="radio-cards">
            <legend className="ins-label">Gateway</legend>
            <label className={c.source === "server" ? "on" : ""}>
              <input type="radio" name="source" checked={c.source === "server"} onChange={() => set({ source: "server", model: "" })} />
              <span>
                <b>Server default</b>
                <small>From .env: {config ? (config.mock ? "mock gateway" : config.endpointHost) : "..."}</small>
              </span>
            </label>
            <label className={c.source === "mock" ? "on" : ""}>
              <input type="radio" name="source" checked={c.source === "mock"} onChange={() => set({ source: "mock", model: "" })} />
              <span>
                <b>Mock gateway</b>
                <small>Offline, simulated Bedrock</small>
              </span>
            </label>
            <label className={`${c.source === "custom" ? "on" : ""} ${customAllowed ? "" : "disabled"}`}>
              <input type="radio" name="source" checked={c.source === "custom"} disabled={!customAllowed} onChange={() => set({ source: "custom" })} />
              <span>
                <b>Capella Model Service</b>
                <small>{customAllowed ? "Your endpoint and API key" : "Disabled on this server"}</small>
              </span>
            </label>
          </fieldset>

          {c.source === "custom" && (
            <>
              <label className="field">
                <span>Endpoint URL</span>
                <input
                  ref={first}
                  type="url"
                  inputMode="url"
                  placeholder="https://<id>.ai.cloud.couchbase.com"
                  value={c.endpoint}
                  onChange={(e) => set({ endpoint: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <label className="field">
                <span>API key</span>
                <span className="field-row">
                  <input
                    type={showKey ? "text" : "password"}
                    value={c.apiKey}
                    onChange={(e) => set({ apiKey: e.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowKey((s) => !s)}>
                    {showKey ? "Hide" : "Show"}
                  </button>
                </span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={c.rememberKey} onChange={(e) => set({ rememberKey: e.target.checked })} />
                <span>
                  Remember the API key on this device
                  <small>Off: the key is kept only for this browser tab. Either way it is sent only to this demo&apos;s server, which forwards it to the gateway, and is masked in traces.</small>
                </span>
              </label>
            </>
          )}

          <label className="field">
            <span>Model</span>
            {chatModels.length > 0 ? (
              <select value={c.model} onChange={(e) => set({ model: e.target.value })}>
                {c.source !== "custom" && <option value="">Server default ({serverModel})</option>}
                <optgroup label="Chat: /v1/chat/completions">
                  {chatModels.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
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
            ) : (
              <input
                value={c.model}
                onChange={(e) => set({ model: e.target.value })}
                placeholder={c.source === "custom" ? "e.g. amazon.nova-lite-v1:0 (Test connection lists them)" : `Server default (${serverModel})`}
                spellCheck={false}
                required={c.source === "custom"}
              />
            )}
          </label>

          <div className="test-row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={runTest} disabled={test.status === "testing" || (c.source === "custom" && (!c.endpoint || !c.apiKey))}>
              {test.status === "testing" ? "Testing..." : "Test connection"}
            </button>
            {test.status === "ok" && (
              <span className="test-ok">
                Connected to {test.host} in {Math.round(test.latencyMs)} ms · {chatModels.length} chat model{chatModels.length === 1 ? "" : "s"}
                {embedModels.length > 0 ? ` · embedding: ${embedModels.map((m) => m.name).join(", ")}` : " · no embedding model listed (semantic cache needs one)"}
              </span>
            )}
            {test.status === "error" && <span className="test-err">{test.message}</span>}
          </div>
          {test.status === "ok" && test.info && <GatewayInfoView info={test.info} />}

          <footer className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSave}>
              Save
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
