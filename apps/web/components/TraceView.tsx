"use client";

import { useState } from "react";
import type { Trace } from "@demo/core";
import { explain, toCurl, type ExplainInput } from "./explain";

const CACHE_HEADER = /^(x-cache|x-cb-(cache|match|semantic|attr))/i;

function HeaderList({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers).sort(([a], [b]) => Number(!CACHE_HEADER.test(a)) - Number(!CACHE_HEADER.test(b)) || a.localeCompare(b));
  return (
    <dl className="trace-headers">
      {entries.map(([k, v]) => (
        <div key={k} className={CACHE_HEADER.test(k) ? "cache-h" : ""}>
          <dt>{k}</dt>
          <dd>{v === "" ? <em>(empty)</em> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Json({ value }: { value: unknown }) {
  return <pre className="trace-json">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

/** Plain-language explanation plus the raw request and response for one gateway call. */
export default function TraceView(props: ExplainInput) {
  const ex = explain(props);
  const { trace } = props;
  const [tab, setTab] = useState<"why" | "request" | "response">("why");
  const [copied, setCopied] = useState(false);

  const copy = async (t: Trace) => {
    try {
      await navigator.clipboard.writeText(toCurl(t));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; nothing to do
    }
  };

  return (
    <div className={`trace trace-${ex.tone}`}>
      <div className="trace-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "why"} className={tab === "why" ? "on" : ""} onClick={() => setTab("why")}>
          Explanation
        </button>
        <button role="tab" aria-selected={tab === "request"} className={tab === "request" ? "on" : ""} onClick={() => setTab("request")} disabled={!trace}>
          Request
        </button>
        <button role="tab" aria-selected={tab === "response"} className={tab === "response" ? "on" : ""} onClick={() => setTab("response")} disabled={!trace?.response}>
          Response{trace?.response ? ` ${trace.response.status}` : ""}
        </button>
        {trace && (
          <button className="link trace-copy" onClick={() => copy(trace)} title="Copy the request as a curl command (key replaced with $CMS_API_KEY)">
            {copied ? "Copied" : "Copy as curl"}
          </button>
        )}
      </div>

      {tab === "why" && (
        <div className="trace-why">
          <b className="trace-verdict">{ex.verdict}</b>
          {props.repeatMiss && <span className="badge badge-error trace-warn">Repeat missed: cache write failing</span>}
          <ol>
            {ex.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      {tab === "request" && trace && (
        <div className="trace-pane">
          <code className="trace-line">
            {trace.request.method} {trace.request.url}
          </code>
          <HeaderList headers={trace.request.headers} />
          <Json value={trace.request.body} />
        </div>
      )}

      {tab === "response" && trace?.response && (
        <div className="trace-pane">
          <code className="trace-line">
            HTTP {trace.response.status} · {Math.round(trace.latencyMs)} ms
          </code>
          <HeaderList headers={trace.response.headers} />
          <Json value={trace.response.body} />
        </div>
      )}
    </div>
  );
}
