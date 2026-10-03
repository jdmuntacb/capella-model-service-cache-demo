"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASSISTANT_NAME,
  EMPLOYEES,
  TOPICS,
  buildWorkload,
  cosineSimilarity,
  isEmbeddingModel,
  type CacheMode,
  type ChatResult,
  type EmbedResult,
  type Pricing,
  type Trace,
} from "@demo/core";
import ConnectionDialog, { DEFAULT_CONNECTION, connectionPayload, loadConnection, saveConnection, type Connection } from "./ConnectionDialog";
import Markdown from "./Markdown";
import TraceView from "./TraceView";
import type { EmbeddingInfo } from "./explain";
import { hitLabel } from "./format";
import Insights, { type LedgerEntry, type PublicConfig } from "./Insights";
import { IconChat, IconClose, IconMenu, IconPanel, IconPlus, IconSend } from "./icons";

interface Meta {
  cacheHit: boolean;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  mode: CacheMode;
  matchScore?: number;
  scoped: boolean;
  trace?: Trace;
  repeatMiss?: boolean;
  /** Set when an embedding model answered (POST /v1/embeddings). */
  embedding?: EmbeddingInfo & { preview: number[] };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Sent to an embedding model; left out of the chat history. */
  embedOnly?: boolean;
  meta?: Meta;
  pending?: boolean;
  error?: string;
  /** Raw exchange for a failed request. */
  errorTrace?: Trace;
}

interface Conversation {
  id: string;
  employeeId: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

export interface Settings {
  mode: CacheMode;
  /** Send X-cb-attr-topic: <conversation id> so the cache is scoped to one conversation. */
  scoped: boolean;
  /** Semantic threshold override; undefined = use the gateway's configured value. */
  threshold?: number;
}

const STORE_KEY = "acme-desk-v1";
const uid = () => Math.random().toString(36).slice(2, 10);
const MODE_LABEL: Record<CacheMode, string> = { none: "No cache", standard: "Standard", semantic: "Semantic" };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable; state still works for this session
  }
}

class ChatFailure extends Error {
  constructor(
    message: string,
    readonly trace?: Trace,
  ) {
    super(message);
  }
}

async function callChat(
  messages: { role: "user" | "assistant"; content: string }[],
  settings: Settings,
  connection: Connection,
  topic?: string,
): Promise<ChatResult> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      mode: settings.mode,
      topic,
      threshold: settings.mode === "semantic" ? settings.threshold : undefined,
      connection: connectionPayload(connection),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ChatFailure(json.error ?? `Request failed (${res.status})`, json.trace);
  return json as ChatResult;
}

async function callEmbed(input: string, connection: Connection): Promise<EmbedResult> {
  const res = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, connection: connectionPayload(connection) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ChatFailure(json.error ?? `Request failed (${res.status})`, json.trace);
  return json as EmbedResult;
}

function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** What an embedding model returned for one message. */
function EmbeddingCard({ e }: { e: NonNullable<Meta["embedding"]> }) {
  const max = Math.max(1e-9, ...e.preview.map(Math.abs));
  return (
    <div className="embed-card">
      <p>
        <b>{e.dimensions.toLocaleString()}-dimension vector</b> from <code>{e.model}</code>
      </p>
      <div className="embed-bars" aria-hidden="true">
        {e.preview.map((v, i) => (
          <span key={i} className={v < 0 ? "neg" : ""} style={{ height: `${Math.max(6, (Math.abs(v) / max) * 100)}%` }} />
        ))}
      </div>
      <code className="embed-vec">
        [{e.preview.map((v) => v.toFixed(4)).join(", ")}
        {e.dimensions > e.preview.length ? `, ... ${(e.dimensions - e.preview.length).toLocaleString()} more` : ""}]
      </code>
      {e.nearest && e.nearest.length > 0 ? (
        <div className="embed-near">
          <span className="ins-label">Similarity to earlier questions</span>
          <ul>
            {e.nearest.map((n) => (
              <li key={n.question}>
                <span className="embed-score">{n.score.toFixed(3)}</span>
                <span>{n.question}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="embed-hint">Ask a reworded question in this conversation to see its cosine similarity to this one.</p>
      )}
    </div>
  );
}

function MessageMeta({ meta, show, traceOpen, onTrace }: { meta: Meta; show: boolean; traceOpen: boolean; onTrace: () => void }) {
  if (!show) return null;
  const tokens = meta.promptTokens + meta.completionTokens;
  return (
    <>
    <div className={`meta ${meta.cacheHit ? "meta-hit" : ""}`}>
      {meta.embedding ? (
        <span className="badge badge-miss">Embedding · not cached</span>
      ) : meta.cacheHit ? (
        <span className={`badge badge-${meta.mode}`}>Cache hit · {hitLabel(meta.mode, meta.matchScore)}</span>
      ) : (
        <span className="badge badge-miss">
          {meta.mode === "none" ? "Cache off" : meta.trace?.response?.headers["x-cb-cache-enabled"] === "false" ? "Cache disabled on gateway" : "Cache miss"} · Bedrock
        </span>
      )}
      <span>{fmtMs(meta.latencyMs)}</span>
      <span>
        {tokens.toLocaleString()} tokens {meta.cacheHit ? "saved" : "billed"}
      </span>
      {meta.scoped && <span>conversation-scoped</span>}
      {meta.repeatMiss && <span className="badge badge-error">repeat missed</span>}
      <button className={`trace-toggle ${traceOpen ? "on" : ""}`} onClick={onTrace} aria-expanded={traceOpen}>
        {traceOpen ? "Hide trace" : "Why? · Trace"}
      </button>
    </div>
    {traceOpen && (
      <TraceView
        mode={meta.mode}
        cacheHit={meta.cacheHit}
        matchScore={meta.matchScore}
        promptTokens={meta.promptTokens}
        completionTokens={meta.completionTokens}
        latencyMs={meta.latencyMs}
        scoped={meta.scoped}
        trace={meta.trace}
        repeatMiss={meta.repeatMiss}
        embedding={meta.embedding}
      />
    )}
    </>
  );
}

export default function HelpdeskApp() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [employeeId, setEmployeeId] = useState(EMPLOYEES[0].id);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({ mode: "semantic", scoped: false });
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  // The office simulation loop outlives renders; read the latest ledger through a ref.
  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sim, setSim] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });
  const simStop = useRef(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [connection, setConnection] = useState<Connection>(DEFAULT_CONNECTION);
  const [connOpen, setConnOpen] = useState(false);
  const [openTraces, setOpenTraces] = useState<Set<string>>(new Set());
  // Embedding vectors per conversation, kept in memory only (too large for localStorage).
  const vectors = useRef(new Map<string, { question: string; vector: number[] }[]>());
  const toggleTrace = (id: string) =>
    setOpenTraces((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
    const stored = load<{ conversations: Conversation[]; employeeId: string; settings: Settings; insightsOpen: boolean } | null>(STORE_KEY, null);
    if (stored) {
      setConversations(stored.conversations.map((c) => ({ ...c, messages: c.messages.filter((m) => !m.pending) })));
      // Fall back to the first employee if the saved one is no longer in the list.
      setEmployeeId(EMPLOYEES.some((e) => e.id === stored.employeeId) ? stored.employeeId : EMPLOYEES[0].id);
      if (stored.settings) setSettings(stored.settings);
      setInsightsOpen(stored.insightsOpen ?? true);
    } else if (window.matchMedia("(max-width: 960px)").matches) {
      setInsightsOpen(false); // on phones the panel overlays the chat; open it on demand
    }
    setConnection(loadConnection());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) save(STORE_KEY, { conversations, employeeId, settings, insightsOpen });
  }, [hydrated, conversations, employeeId, settings, insightsOpen]);

  const employee = EMPLOYEES.find((e) => e.id === employeeId) ?? EMPLOYEES[0];
  const myConversations = useMemo(
    () => conversations.filter((c) => c.employeeId === employeeId).sort((a, b) => b.createdAt - a.createdAt),
    [conversations, employeeId],
  );
  const active = myConversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages.length, active?.messages[active?.messages.length - 1]?.pending]);

  // A first-turn, unscoped request is byte-identical to any earlier first-turn ask of the same question
  // (the API key is the same for every employee), so missing again means the earlier answer was never stored.
  // Only count earlier answers that finished at least 300 ms before this request started.
  const isRepeatMiss = (l: LedgerEntry[], r: ChatResult, question: string, scoped: boolean, firstTurn: boolean) =>
    !r.cacheHit &&
    r.mode !== "none" &&
    !scoped &&
    firstTurn &&
    r.trace?.response?.headers["x-cb-cache-enabled"] !== "false" &&
    l.some((e) => !e.error && e.firstTurn && !e.scoped && e.mode !== "none" && e.question === question && Date.now() - r.latencyMs - e.at > 300);

  const record = useCallback((r: ChatResult, question: string, who: string, source: LedgerEntry["source"], scoped: boolean, firstTurn: boolean, repeatMiss: boolean) => {
    setLedger((l) => [
      ...l,
      {
        id: uid(),
        at: Date.now(),
        who,
        question,
        source,
        mode: r.mode,
        cacheHit: r.cacheHit,
        matchScore: r.matchScore,
        latencyMs: r.latencyMs,
        promptTokens: r.usage.prompt_tokens,
        completionTokens: r.usage.completion_tokens,
        scoped,
        trace: r.trace,
        firstTurn,
        repeatMiss,
      },
    ]);
  }, []);

  const recordEmbedding = useCallback((r: EmbedResult, question: string, who: string) => {
    setLedger((l) => [
      ...l,
      {
        id: uid(),
        at: Date.now(),
        who,
        question,
        source: "chat",
        kind: "embedding",
        model: r.model,
        dimensions: r.dimensions,
        mode: "none",
        cacheHit: false,
        latencyMs: r.latencyMs,
        promptTokens: r.usage.prompt_tokens,
        completionTokens: 0,
        scoped: false,
        trace: r.trace,
        firstTurn: false,
      },
    ]);
  }, []);

  const recordError = useCallback((err: unknown, question: string, who: string, source: LedgerEntry["source"], mode: CacheMode, scoped: boolean, embedding?: boolean) => {
    const trace = err instanceof ChatFailure ? err.trace : undefined;
    setLedger((l) => [
      ...l,
      {
        id: uid(),
        at: Date.now(),
        who,
        question,
        source,
        mode,
        cacheHit: false,
        latencyMs: trace?.latencyMs ?? 0,
        promptTokens: 0,
        completionTokens: 0,
        scoped,
        trace,
        firstTurn: false,
        kind: embedding ? "embedding" : "chat",
        error: err instanceof Error ? err.message : String(err),
      },
    ]);
  }, []);

  const effectiveModel = connection.model || config?.model || "the model";
  const embedModel = isEmbeddingModel(effectiveModel);

  const patchConversation = (id: string, fn: (c: Conversation) => Conversation) =>
    setConversations((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setDraft("");
    setBusy(true);

    let conv = active;
    if (!conv) {
      conv = { id: `conv-${uid()}`, employeeId, title: question.slice(0, 60), messages: [], createdAt: Date.now() };
      const created = conv;
      setConversations((cs) => [created, ...cs]);
      setActiveId(created.id);
    }
    const convId = conv.id;
    const embedMode = isEmbeddingModel(effectiveModel);
    const userMsg: Message = { id: uid(), role: "user", content: question, embedOnly: embedMode || undefined };
    const pending: Message = { id: uid(), role: "assistant", content: "", pending: true };
    // Embedding turns are not part of the chat conversation.
    const history = [...conv.messages.filter((m) => !m.error && !m.pending && !m.embedOnly && !m.meta?.embedding), userMsg].map((m) => ({ role: m.role, content: m.content }));
    // Functional updates run in order, so a conversation created above is already present here.
    patchConversation(convId, (c) => ({ ...c, messages: [...c.messages, userMsg, pending] }));

    if (embedMode) {
      try {
        const r = await callEmbed(question, connection);
        const earlier = vectors.current.get(convId) ?? [];
        const nearest = earlier
          .filter((v) => v.question !== question && v.vector.length === r.embedding.length)
          .map((v) => ({ question: v.question, score: cosineSimilarity(r.embedding, v.vector) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        vectors.current.set(convId, [...earlier.filter((v) => v.question !== question), { question, vector: r.embedding }]);
        const meta: Meta = {
          cacheHit: false,
          latencyMs: r.latencyMs,
          promptTokens: r.usage.prompt_tokens,
          completionTokens: 0,
          mode: "none",
          scoped: false,
          trace: r.trace,
          embedding: { model: r.model, dimensions: r.dimensions, nearest, preview: r.embedding.slice(0, 8) },
        };
        patchConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === pending.id ? { ...m, pending: false, meta } : m)),
        }));
        recordEmbedding(r, question, employee.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const errorTrace = err instanceof ChatFailure ? err.trace : undefined;
        patchConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === pending.id ? { ...m, pending: false, error: msg, errorTrace, embedOnly: true } : m)),
        }));
        recordError(err, question, employee.name, "chat", "none", false, true);
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const r = await callChat(history, settings, connection, settings.scoped ? convId : undefined);
      const firstTurn = history.length === 1;
      const repeatMiss = isRepeatMiss(ledgerRef.current, r, question, settings.scoped, firstTurn);
      const meta: Meta = {
        cacheHit: r.cacheHit,
        latencyMs: r.latencyMs,
        promptTokens: r.usage.prompt_tokens,
        completionTokens: r.usage.completion_tokens,
        mode: r.mode,
        matchScore: r.matchScore,
        scoped: settings.scoped,
        trace: r.trace,
        repeatMiss,
      };
      patchConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === pending.id ? { ...m, content: r.content, pending: false, meta } : m)),
      }));
      record(r, question, employee.name, "chat", settings.scoped, firstTurn, repeatMiss);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorTrace = err instanceof ChatFailure ? err.trace : undefined;
      patchConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === pending.id ? { ...m, pending: false, error: msg, errorTrace } : m)),
      }));
      recordError(err, question, employee.name, "chat", settings.mode, settings.scoped);
    } finally {
      setBusy(false);
    }
  }

  async function simulateOffice(requests: number) {
    if (sim.running || embedModel) return;
    simStop.current = false;
    const workload = buildWorkload({ requests, seed: Math.floor(Math.random() * 1e9) });
    setSim({ running: true, done: 0, total: workload.length });
    for (const item of workload) {
      if (simStop.current) break;
      const who = EMPLOYEES.find((e) => e.id === item.employeeId)?.name ?? item.employeeId;
      try {
        // Each colleague asks in their own fresh conversation.
        const r = await callChat([{ role: "user", content: item.question }], settings, connection, settings.scoped ? `sim-${uid()}` : undefined);
        record(r, item.question, who, "office", settings.scoped, true, isRepeatMiss(ledgerRef.current, r, item.question, settings.scoped, true));
      } catch (err) {
        recordError(err, item.question, who, "office", settings.mode, settings.scoped);
      }
      setSim((s) => ({ ...s, done: s.done + 1 }));
    }
    setSim((s) => ({ ...s, running: false }));
  }

  const newChat = () => {
    setActiveId(null);
    setSidebarOpen(false);
  };

  const greeting = `Hi ${employee.name.split(" ")[0]}, how can we help today?`;
  const chips = TOPICS.slice(0, 6);
  const pricing: Pricing | undefined = config?.pricing;

  return (
    <div className={`app ${insightsOpen ? "with-insights" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`} aria-label="Conversations">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">A</div>
          <div>
            <div className="brand-name">{ASSISTANT_NAME}</div>
            <div className="brand-sub">Acme Corp employee helpdesk</div>
          </div>
          <button className="icon-btn only-mobile" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <IconClose />
          </button>
        </div>
        <button className="btn btn-primary new-chat" onClick={newChat}>
          <IconPlus /> New request
        </button>
        <div className="section-label">Recent conversations</div>
        <nav className="conv-list">
          {myConversations.length === 0 && <p className="empty-note">No conversations yet.</p>}
          {myConversations.map((c) => (
            <button
              key={c.id}
              className={`conv ${c.id === activeId ? "active" : ""}`}
              onClick={() => {
                setActiveId(c.id);
                setSidebarOpen(false);
              }}
            >
              <IconChat />
              <span>{c.title}</span>
            </button>
          ))}
        </nav>
        <label className="user-switch">
          <span className="section-label">Signed in as</span>
          <select
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setActiveId(null);
            }}
          >
            {EMPLOYEES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.team}
              </option>
            ))}
          </select>
          <span className="hint">Switch colleagues to see answers shared across employees.</span>
        </label>
      </aside>
      {sidebarOpen && <div className="scrim only-mobile" onClick={() => setSidebarOpen(false)} />}

      <main className="chat" aria-label="Chat">
        <header className="chat-head">
          <button className="icon-btn only-mobile" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <IconMenu />
          </button>
          <div className="chat-title">
            <h1>{active ? active.title : "New request"}</h1>
            <span className="status-dot">IT &amp; HR assistant · online</span>
          </div>
          {embedModel ? (
            <span className="mode-pill mode-none" title="An embedding model is selected: messages go to /v1/embeddings">
              Embeddings
            </span>
          ) : (
            <span className={`mode-pill mode-${settings.mode}`} title="Gateway cache mode for new messages">
              {MODE_LABEL[settings.mode]} cache{settings.scoped ? " · scoped" : ""}
            </span>
          )}
          <button
            className={`btn btn-ghost ${insightsOpen ? "pressed" : ""}`}
            onClick={() => setInsightsOpen((o) => !o)}
            aria-pressed={insightsOpen}
          >
            <IconPanel /> <span className="hide-sm">Gateway insights</span>
          </button>
        </header>

        <div className="thread">
          {!active || active.messages.length === 0 ? (
            <div className="welcome">
              <h2>{greeting}</h2>
              <p>Ask about passwords, VPN, devices, time off, benefits, pay or expenses. Popular requests:</p>
              <div className="chips">
                {chips.map((t) => (
                  <button key={t.id} className="chip" onClick={() => send(t.canonical)} disabled={busy}>
                    <span className={`chip-cat cat-${t.category}`}>{t.category}</span>
                    {t.canonical}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            active.messages.map((m) => (
              <div key={m.id} className={`msg msg-${m.role}`}>
                {m.role === "assistant" && (
                  <div className="avatar" aria-hidden="true">
                    A
                  </div>
                )}
                <div className="bubble-wrap">
                  <div className={`bubble ${m.error ? "bubble-error" : ""}`}>
                    {m.pending ? (
                      <span className="typing" aria-label="Assistant is typing">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : m.error ? (
                      <p>Sorry, the assistant could not answer: {m.error}</p>
                    ) : m.meta?.embedding ? (
                      <EmbeddingCard e={m.meta.embedding} />
                    ) : m.role === "assistant" ? (
                      <Markdown text={m.content} />
                    ) : (
                      <p>{m.content}</p>
                    )}
                  </div>
                  {m.meta && <MessageMeta meta={m.meta} show={insightsOpen} traceOpen={openTraces.has(m.id)} onTrace={() => toggleTrace(m.id)} />}
                  {m.error && (
                    <>
                      <div className="meta">
                        <span className="badge badge-error">Request failed</span>
                        <button className={`trace-toggle ${openTraces.has(m.id) ? "on" : ""}`} onClick={() => toggleTrace(m.id)} aria-expanded={openTraces.has(m.id)}>
                          {openTraces.has(m.id) ? "Hide trace" : "Why? · Trace"}
                        </button>
                      </div>
                      {openTraces.has(m.id) && (
                        <TraceView
                          embedding={m.embedOnly ? { model: effectiveModel, dimensions: 0 } : undefined}
                          mode={settings.mode}
                          cacheHit={false} promptTokens={0} completionTokens={0} latencyMs={m.errorTrace?.latencyMs ?? 0} scoped={false} trace={m.errorTrace} error={m.error} />
                      )}
                    </>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={threadEnd} />
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder={embedModel ? "Type text to embed with " + effectiveModel + "..." : "Describe what you need help with..."}
            rows={1}
            aria-label="Message"
          />
          <button className="send" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
            <IconSend />
          </button>
        </form>
        <p className="disclaimer">
          {embedModel
            ? `Embedding model selected: messages are sent to /v1/embeddings on ${effectiveModel}. Pick a chat model in Gateway insights to chat.`
            : `Answers come from ${effectiveModel} via Capella Model Service. Never share passwords or one-time codes.`}
        </p>
      </main>

      {insightsOpen && (
        <Insights
          config={config}
          pricing={pricing}
          settings={settings}
          onSettings={setSettings}
          ledger={ledger}
          onClear={() => setLedger([])}
          sim={sim}
          onSimulate={simulateOffice}
          onStopSim={() => (simStop.current = true)}
          onClose={() => setInsightsOpen(false)}
          connection={connection}
          model={effectiveModel}
          onModel={(model) => {
            const c = { ...connection, model };
            setConnection(c);
            saveConnection(c);
          }}
          onOpenConnection={() => setConnOpen(true)}
        />
      )}
      {connOpen && (
        <ConnectionDialog
          value={connection}
          config={config}
          onClose={() => setConnOpen(false)}
          onSave={(c) => {
            // Session totals from one gateway mean nothing for another.
            if (JSON.stringify(connectionPayload(c)) !== JSON.stringify(connectionPayload(connection))) setLedger([]);
            setConnection(c);
            saveConnection(c);
            setConnOpen(false);
          }}
        />
      )}
    </div>
  );
}
