// "Acme People & IT Desk" - the enterprise helpdesk scenario used by the demo.
// Employees ask the same handful of questions all day, in many different words,
// which is exactly the traffic shape where Standard and Semantic Cache pay off.

export const COMPANY = "Acme Corp";
export const ASSISTANT_NAME = "Acme People & IT Desk";

export const SYSTEM_PROMPT = `You are the ${ASSISTANT_NAME}, the internal helpdesk assistant for ${COMPANY} employees.
Answer IT and HR questions using ${COMPANY} policy. Be concise and practical: give numbered steps where useful,
name the exact portal or form, and say when the employee should open a ticket instead.
Never ask for passwords or one-time codes.`;

export type Category = "IT" | "HR";

export interface Topic {
  id: string;
  category: Category;
  title: string;
  /** The wording used by suggested-question chips: identical text every time. */
  canonical: string;
  /** Different wordings of the same intent, as employees actually type them. */
  paraphrases: string[];
  /** Reference answer the mock gateway returns (the real model writes its own). */
  answer: string;
}

export const TOPICS: Topic[] = [
  {
    id: "password-reset",
    category: "IT",
    title: "Password reset",
    canonical: "How do I reset my password?",
    paraphrases: [
      "I forgot my password, how can I reset it?",
      "How can I change my Acme login password?",
      "My password expired, how do I set a new one?",
      "What's the process to reset my network password?",
    ],
    answer: `To reset your Acme password:

1. Go to **id.acme.example/reset** from any device.
2. Enter your work email and approve the push in **Acme Verify**.
3. Choose a new password (14+ characters, not one of your last 10).
4. Lock and unlock your laptop so it picks up the new password.

If you're locked out of Acme Verify too, call the IT Service Desk at x4357 - we'll verify you by video. We will never ask you for your password.`,
  },
  {
    id: "vpn",
    category: "IT",
    title: "VPN access",
    canonical: "How do I connect to the VPN?",
    paraphrases: [
      "How can I connect to the company VPN from home?",
      "What are the steps to set up VPN on my laptop?",
      "VPN isn't connecting, how do I get on the VPN?",
      "How do I access the internal network remotely?",
    ],
    answer: `To connect to the Acme VPN:

1. Open **GlobalConnect** from the menu bar (macOS) or system tray (Windows).
2. Choose the portal **vpn.acme.example** and sign in with SSO.
3. Approve the Acme Verify push.

If it fails: check you're on the latest GlobalConnect from **Self Service**, switch off other VPNs, and try the **vpn-backup.acme.example** portal. Still stuck? Open a ticket under *Network > VPN* with a screenshot of the error.`,
  },
  {
    id: "pto",
    category: "HR",
    title: "Request time off",
    canonical: "How do I request PTO?",
    paraphrases: [
      "How can I request vacation days?",
      "What's the process for taking time off?",
      "How do I book annual leave?",
      "Where do I submit a time off request?",
    ],
    answer: `To request paid time off:

1. Open **Workday** > *Absence* > *Request Time Off*.
2. Select the dates and the type (*Vacation*, *Personal*, *Sick*).
3. Add a note for your manager and submit.

Your manager gets a notification and usually approves within 2 business days. Please request vacation at least **2 weeks ahead** for 3+ consecutive days. Your remaining balance is shown on the same page.`,
  },
  {
    id: "pto-balance",
    category: "HR",
    title: "PTO balance & accrual",
    canonical: "How many vacation days do I get per year?",
    paraphrases: [
      "How much PTO do I accrue each year?",
      "What is the annual leave allowance at Acme?",
      "How many days of paid time off do employees get?",
      "How does vacation accrual work?",
    ],
    answer: `Full-time employees accrue PTO each pay period:

- **0-2 years:** 15 days/year
- **3-5 years:** 20 days/year
- **6+ years:** 25 days/year

You can carry over up to **5 days** into the next year. Sick leave is separate (10 days/year) and company holidays don't count against PTO. Check your live balance in **Workday > Absence**.`,
  },
  {
    id: "new-laptop",
    category: "IT",
    title: "Laptop request",
    canonical: "How do I request a new laptop?",
    paraphrases: [
      "How can I get a replacement laptop?",
      "My laptop is old, how do I ask for a new one?",
      "What's the process to order a new work computer?",
      "Can I get a laptop upgrade?",
    ],
    answer: `Laptops are refreshed every **3 years**. To request one:

1. Open **ServiceHub** > *Hardware* > *Laptop Request*.
2. Pick a standard model (MacBook Pro 14" or ThinkPad X1) - non-standard models need director approval.
3. Add your cost center and justification if you're inside the 3-year window.

Delivery is typically 5-7 business days. Back up your files to OneDrive first; IT will wipe and collect the old device.`,
  },
  {
    id: "benefits-enrollment",
    category: "HR",
    title: "Benefits enrollment",
    canonical: "When is open enrollment for benefits?",
    paraphrases: [
      "When can I change my health insurance plan?",
      "What are the dates for benefits open enrollment?",
      "How do I enroll in or change my benefits?",
      "When can I update my medical and dental coverage?",
    ],
    answer: `Open enrollment runs **November 1-15** each year, for coverage starting January 1.

To enroll or change plans, go to **Workday > Benefits > Open Enrollment** during that window. Outside it, you can only change plans within **30 days of a qualifying life event** (marriage, birth/adoption, loss of other coverage) - choose *Benefits > Life Event*.

Questions about a specific plan? Email benefits@acme.example.`,
  },
  {
    id: "expenses",
    category: "HR",
    title: "Expense reimbursement",
    canonical: "How do I submit an expense report?",
    paraphrases: [
      "How can I get reimbursed for a business expense?",
      "Where do I file my travel expenses?",
      "What's the process for expense reimbursement?",
      "How do I claim back money I spent on work?",
    ],
    answer: `Submit expenses in **Concur** within **30 days**:

1. Snap receipts in the Concur app (they auto-attach).
2. Create a report, add each expense with its category and project code.
3. Submit - it routes to your manager, then Finance.

Reimbursement lands with the next payroll after approval. Meals are capped at $75/day when traveling; anything over $25 needs an itemized receipt.`,
  },
  {
    id: "mfa",
    category: "IT",
    title: "MFA / new phone",
    canonical: "How do I set up MFA on a new phone?",
    paraphrases: [
      "I got a new phone, how do I move my authenticator?",
      "How can I re-enroll Acme Verify on my new device?",
      "How do I transfer two-factor authentication to a new phone?",
      "My MFA app is on my old phone, what do I do?",
    ],
    answer: `To move Acme Verify to a new phone:

1. On a laptop, go to **id.acme.example/security**.
2. Choose *Add device*, then scan the QR code with Acme Verify on the new phone.
3. Approve a test push, then remove the old phone from the list.

If you no longer have the old phone, call the IT Service Desk at x4357 for a temporary bypass code after a video identity check.`,
  },
  {
    id: "wifi",
    category: "IT",
    title: "Office Wi-Fi",
    canonical: "How do I connect to the office Wi-Fi?",
    paraphrases: [
      "What is the Wi-Fi network in the office?",
      "How can I get my laptop on the office wireless?",
      "Which Wi-Fi should employees use at the office?",
      "How do guests connect to Wi-Fi at Acme?",
    ],
    answer: `In Acme offices:

- **Employees:** join **Acme-Secure** - managed laptops connect automatically with your device certificate. No password needed.
- **Phones/personal devices:** join **Acme-Personal** and sign in with SSO.
- **Guests:** use **Acme-Guest**; your host creates a daily pass at **guest.acme.example**.

If Acme-Secure doesn't appear, run *Repair Network Profile* from Self Service.`,
  },
  {
    id: "parental-leave",
    category: "HR",
    title: "Parental leave",
    canonical: "What is the parental leave policy?",
    paraphrases: [
      "How much maternity leave do we get?",
      "How many weeks of paternity leave does Acme offer?",
      "What are the parental leave benefits?",
      "How do I apply for leave when my baby is born?",
    ],
    answer: `Acme offers **16 weeks of fully paid parental leave** to all parents (birth, adoption or foster), available within 12 months of the child's arrival. Birthing parents get an additional 6 weeks of medical leave.

To apply: tell your manager, then submit **Workday > Absence > Parental Leave** at least 30 days before your planned start. HR will contact you about benefits and a phased return option (4 weeks at 60% schedule).`,
  },
  {
    id: "software-install",
    category: "IT",
    title: "Install software",
    canonical: "How do I install software on my laptop?",
    paraphrases: [
      "How can I get an app installed on my work computer?",
      "Where do I download approved software?",
      "I need a new application, how do I install it?",
      "How do I request software that isn't in Self Service?",
    ],
    answer: `Most approved apps are one click away:

1. Open **Self Service** (macOS) or **Company Portal** (Windows).
2. Search for the app and click *Install*.

Not listed? Request it in **ServiceHub** > *Software* > *New Software Request*. Security reviews new tools within 5 business days; paid licenses also need your manager's approval. Please don't install unapproved software with admin rights.`,
  },
  {
    id: "payslip",
    category: "HR",
    title: "Payslips & W-2",
    canonical: "Where can I find my payslip?",
    paraphrases: [
      "How do I download my pay stub?",
      "Where can I see my salary statement?",
      "How do I get a copy of my W-2?",
      "Where are my paychecks and tax documents?",
    ],
    answer: `Your pay documents are in **Workday > Pay**:

- *Payslips* - every pay stub, downloadable as PDF.
- *Tax Documents* - W-2s are posted by **January 31** each year.
- *Payment Elections* - change your bank account.

Pay runs on the 15th and last business day of each month. Spot an error? Contact payroll@acme.example with the pay date.`,
  },
];

/** Long-tail questions that are asked once - no cache can help these, and that's the honest baseline. */
export const UNIQUE_QUESTIONS: string[] = [
  "Can I expense a standing desk for my home office in Austin?",
  "Is there a discount program for gym memberships near the Denver office?",
  "How do I get access to the finance team's shared Tableau workbook?",
  "Can contractors attend the annual company offsite?",
  "What's the policy on bringing dogs into the Seattle office?",
  "How do I set up a shared mailbox for the customer success team?",
  "Can I work from Portugal for three weeks in July?",
  "Who approves budget for a team-building lunch over $500?",
  "My second monitor flickers when docked, any fix?",
  "How do I nominate a colleague for the quarterly values award?",
  "Can I get reimbursed for a Spanish language course?",
  "How do I change my legal name in all HR systems?",
  "Is jury duty paid leave at Acme?",
  "How do I book a room for a 40-person workshop in Building C?",
  "Why is Outlook asking me to re-authenticate every hour?",
  "Can I transfer unused learning budget to next year?",
];

export const EMPLOYEES = [
  { id: "u-jagadesh", name: "Jagadesh Munta", team: "Engineering" },
  { id: "u-mark", name: "Mark Gamble", team: "Marketing" },
  { id: "u-shrey", name: "Shrey Luthra", team: "Product" },
  { id: "u-talina", name: "Talina Munta", team: "Engineering" },
];

export type QuestionKind = "exact" | "paraphrase" | "unique";

export interface WorkloadItem {
  index: number;
  employeeId: string;
  question: string;
  kind: QuestionKind;
  topicId?: string;
}

export interface WorkloadOptions {
  requests: number;
  seed?: number;
  /** Share of requests that reuse the exact chip wording. */
  exactShare?: number;
  /** Share of requests that are a reworded popular question. */
  paraphraseShare?: number;
}

/** Small deterministic PRNG so every run sends the same workload in the same order. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a day-in-the-life helpdesk workload: popular topics asked repeatedly
 * (some via suggested chips = exact text, most typed freely = paraphrases), plus long-tail one-offs.
 */
export function buildWorkload(opts: WorkloadOptions): WorkloadItem[] {
  const rand = mulberry32(opts.seed ?? 42);
  const exactShare = opts.exactShare ?? 0.35;
  const paraShare = opts.paraphraseShare ?? 0.45;
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  // Popularity is skewed: the first topics are asked far more often (Zipf-like).
  const weights = TOPICS.map((_, i) => 1 / (i + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const pickTopic = () => {
    let r = rand() * total;
    for (let i = 0; i < TOPICS.length; i++) {
      r -= weights[i];
      if (r <= 0) return TOPICS[i];
    }
    return TOPICS[TOPICS.length - 1];
  };

  const unique = [...UNIQUE_QUESTIONS];
  const items: WorkloadItem[] = [];
  for (let i = 0; i < opts.requests; i++) {
    const employeeId = pick(EMPLOYEES).id;
    const r = rand();
    if (r < exactShare) {
      const t = pickTopic();
      items.push({ index: i, employeeId, question: t.canonical, kind: "exact", topicId: t.id });
    } else if (r < exactShare + paraShare || unique.length === 0) {
      const t = pickTopic();
      items.push({ index: i, employeeId, question: pick(t.paraphrases), kind: "paraphrase", topicId: t.id });
    } else {
      const q = unique.splice(Math.floor(rand() * unique.length), 1)[0];
      items.push({ index: i, employeeId, question: q, kind: "unique" });
    }
  }
  return items;
}

/** Finds the topic whose wording best matches a question (used by the mock to pick an answer). */
export function findTopic(question: string): Topic | undefined {
  const q = question.trim().toLowerCase();
  return TOPICS.find((t) => t.canonical.toLowerCase() === q || t.paraphrases.some((p) => p.toLowerCase() === q));
}
