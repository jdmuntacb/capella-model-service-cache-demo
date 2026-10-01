"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASSISTANT_NAME,
  EMPLOYEES,
  TOPICS,
  buildWorkload,
  type CacheMode,
  type ChatResult,
  type Pricing,
} from "@demo/core";
import Markdown from "./Markdown";
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
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: Meta;
  pending?: boolean;
  error?: string;
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

async function callChat(
  messages: { role: "user" | "assistant"; content: string }[],
  settings: Settings,
  topic?: string,
): Promise<ChatResult> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, mode: settings.mode, topic, threshold: settings.mode === "semantic" ? settings.threshold : undefined }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as ChatResult;
}

function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function MessageMeta({ meta, show }: { meta: Meta; show: boolean }) {
  if (!show) return null;
  const tokens = meta.promptTokens + meta.completionTokens;
  return (
    <div className={`meta ${meta.cacheHit ? "meta-hit" : ""}`}>
      {meta.cacheHit ? (
        <span className={`badge badge-${meta.mode}`}>Cache hit · {hitLabel(meta.mode, meta.matchScore)}</span>
      ) : (
        <span className="badge badge-miss">{meta.mode === "none" ? "Cache off" : "Cache miss"} · Bedrock</span>
      )}
      <span>{fmtMs(meta.latencyMs)}</span>
      <span>
        {tokens.toLocaleString()} tokens {meta.cacheHit ? "saved" : "billed"}
      </span>
      {meta.scoped && <span>conversation-scoped</span>}
    </div>
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
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sim, setSim] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });
  const simStop = useRef(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
    const stored = load<{ conversations: Conversation[]; employeeId: string; settings: Settings; insightsOpen: boolean } | null>(STORE_KEY, null);
    if (stored) {
      setConversations(stored.conversations.map((c) => ({ ...c, messages: c.messages.filter((m) => !m.pending) })));
      setEmployeeId(stored.employeeId ?? EMPLOYEES[0].id);
      if (stored.settings) setSettings(stored.settings);
      setInsightsOpen(stored.insightsOpen ?? true);
    } else if (window.matchMedia("(max-width: 960px)").matches) {
      setInsightsOpen(false); // on phones the panel overlays the chat; open it on demand
    }
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

  const record = useCallback((r: ChatResult, question: string, who: string, source: LedgerEntry["source"]) => {
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
      },
    ]);
  }, []);

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
    const userMsg: Message = { id: uid(), role: "user", content: question };
    const pending: Message = { id: uid(), role: "assistant", content: "", pending: true };
    const history = [...conv.messages.filter((m) => !m.error && !m.pending), userMsg].map((m) => ({ role: m.role, content: m.content }));
    // Functional updates run in order, so a conversation created above is already present here.
    patchConversation(convId, (c) => ({ ...c, messages: [...c.messages, userMsg, pending] }));

    try {
      const r = await callChat(history, settings, settings.scoped ? convId : undefined);
      const meta: Meta = {
        cacheHit: r.cacheHit,
        latencyMs: r.latencyMs,
        promptTokens: r.usage.prompt_tokens,
        completionTokens: r.usage.completion_tokens,
        mode: r.mode,
        matchScore: r.matchScore,
        scoped: settings.scoped,
      };
      patchConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === pending.id ? { ...m, content: r.content, pending: false, meta } : m)),
      }));
      record(r, question, employee.name, "chat");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patchConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === pending.id ? { ...m, pending: false, error: msg } : m)),
      }));
    } finally {
      setBusy(false);
    }
  }

  async function simulateOffice(requests: number) {
    if (sim.running) return;
    simStop.current = false;
    const workload = buildWorkload({ requests, seed: Math.floor(Math.random() * 1e9) });
    setSim({ running: true, done: 0, total: workload.length });
    for (const item of workload) {
      if (simStop.current) break;
      const who = EMPLOYEES.find((e) => e.id === item.employeeId)?.name ?? item.employeeId;
      try {
        // Each colleague asks in their own fresh conversation.
        const r = await callChat([{ role: "user", content: item.question }], settings, settings.scoped ? `sim-${uid()}` : undefined);
        record(r, item.question, who, "office");
      } catch {
        // keep going; errors show up as a gap in the feed
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
          <span className={`mode-pill mode-${settings.mode}`} title="Gateway cache mode for new messages">
            {MODE_LABEL[settings.mode]} cache{settings.scoped ? " · scoped" : ""}
          </span>
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
                    ) : m.role === "assistant" ? (
                      <Markdown text={m.content} />
                    ) : (
                      <p>{m.content}</p>
                    )}
                  </div>
                  {m.meta && <MessageMeta meta={m.meta} show={insightsOpen} />}
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
            placeholder="Describe what you need help with..."
            rows={1}
            aria-label="Message"
          />
          <button className="send" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
            <IconSend />
          </button>
        </form>
        <p className="disclaimer">Answers come from Claude Sonnet via Capella Model Service. Never share passwords or one-time codes.</p>
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
        />
      )}
    </div>
  );
}
