// A tiny, dependency-free stand-in for an embedding model, good enough to show
// semantic matching offline. It maps helpdesk vocabulary onto shared concepts
// (e.g. "vacation", "annual leave", "time off" -> pto) and builds a normalized
// bag-of-concepts vector, so dot product == cosine similarity.
// The real gateway calls the embedding model connected to Capella Model Service.

const STOPWORDS = new Set(
  ("a an the i me my we our you your it its is are am was be been do does did can could " +
    "how what whats where when which who why to of for on in at by with from into about " +
    "and or but if so this that there here any some each per get got go use using need want " +
    "please help acme company work new up one steps step").split(" "),
);

// Phrases first (longest match wins), then single words.
const PHRASES: [string, string][] = [
  ["maternity leave", "parental"],
  ["paternity leave", "parental"],
  ["parental leave", "parental"],
  ["set up", "setup"],
  ["re-enroll", "setup"],
  ["tax documents", "payslip"],
  ["time off", "pto"],
  ["annual leave", "pto"],
  ["paid time off", "pto"],
  ["vacation days", "pto"],
  ["two-factor", "mfa"],
  ["two factor", "mfa"],
  ["pay stub", "payslip"],
  ["salary statement", "payslip"],
  ["open enrollment", "enroll"],
  ["health insurance", "benefit"],
  ["medical and dental", "benefit"],
  ["internal network", "vpn"],
  ["work computer", "laptop"],
  ["log in", "login"],
  ["sign in", "login"],
];

const SYNONYMS: Record<string, string> = {
  vacation: "pto", leave: "pto", holiday: "pto", holidays: "pto", pto: "pto",
  accrue: "accrual", accrual: "accrual", allowance: "accrual", many: "amount", much: "amount",
  days: "day", year: "year", annual: "year", yearly: "year",
  password: "password", passwords: "password", login: "password", forgot: "reset", expired: "reset",
  reset: "reset", change: "reset", set: "reset", setup: "setup",
  vpn: "vpn", access: "connect", remotely: "remote", remote: "remote", home: "remote", connect: "connect", connecting: "connect",
  laptop: "laptop", computer: "laptop", device: "device", phone: "phone", replacement: "request",
  replace: "request", upgrade: "request", old: "request", order: "request", request: "request",
  ask: "request", submit: "request", book: "request", file: "request", claim: "request", apply: "request",
  benefit: "benefit", benefits: "benefit", coverage: "benefit", plan: "benefit", enroll: "enroll",
  enrollment: "enroll", dates: "when", expense: "expense", expenses: "expense", reimbursed: "expense",
  reimbursement: "expense", spent: "expense", money: "expense", travel: "expense", report: "expense",
  mfa: "mfa", authenticator: "mfa", verify: "mfa", authentication: "mfa", re: "", transfer: "move",
  move: "move", enrolling: "enroll", wifi: "wifi", "wi-fi": "wifi", wireless: "wifi", network: "wifi",
  office: "office", guests: "guest", guest: "guest", parental: "parental", maternity: "parental",
  paternity: "parental", baby: "parental", born: "parental", weeks: "duration", software: "software",
  app: "software", application: "software", install: "install", installed: "install", download: "install",
  approved: "approved", payslip: "payslip", paycheck: "payslip", paychecks: "payslip", stub: "payslip",
  w: "", "w-2": "payslip", w2: "payslip", tax: "payslip", salary: "payslip", find: "find", see: "find", copy: "find",
};

export function tokenize(text: string): string[] {
  let t = ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ")} `;
  for (const [phrase, concept] of PHRASES) t = t.replaceAll(` ${phrase} `, ` ${concept} `);
  const out: string[] = [];
  for (const raw of t.trim().split(" ")) {
    if (!raw || STOPWORDS.has(raw)) continue;
    let w = SYNONYMS[raw];
    if (w === undefined) w = raw.length > 4 ? raw.replace(/(ing|ed|es|s)$/, "") : raw;
    if (w) out.push(w);
  }
  return out;
}

export type Vector = Map<string, number>;

export function embed(text: string): Vector {
  const v: Vector = new Map();
  for (const tok of tokenize(text)) v.set(tok, (v.get(tok) ?? 0) + 1);
  let norm = 0;
  for (const x of v.values()) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (const [k, x] of v) v.set(k, x / norm);
  return v;
}

/** Dot product of two L2-normalized vectors (== cosine similarity). */
export function similarity(a: Vector, b: Vector): number {
  let s = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, x] of small) s += x * (big.get(k) ?? 0);
  return s;
}

export const DENSE_DIMENSIONS = 256;

/** A dense, L2-normalized vector for /v1/embeddings: the sum of one fixed pseudo-random direction per concept. */
export function denseEmbed(tokens: string[]): number[] {
  const v = new Array<number>(DENSE_DIMENSIONS).fill(0);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) h = Math.imul(h ^ tok.charCodeAt(i), 16777619);
    // xorshift32 seeded by the concept, so the same concept always gets the same direction
    let x = h >>> 0 || 1;
    for (let d = 0; d < DENSE_DIMENSIONS; d++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      v[d] += ((x >>> 0) / 4294967296) * 2 - 1;
    }
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => Number((x / norm).toFixed(6)));
}
