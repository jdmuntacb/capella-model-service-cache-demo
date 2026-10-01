// Lucide-style functional glyphs (2px stroke), inlined to avoid a runtime dependency.
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconPlus = () => (
  <svg {...base} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
export const IconSend = () => (
  <svg {...base} aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const IconPanel = () => (
  <svg {...base} aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>
);
export const IconMenu = () => (
  <svg {...base} aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
export const IconClose = () => (
  <svg {...base} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconChat = () => (
  <svg {...base} width={16} height={16} aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
);
export const IconPlay = () => (
  <svg {...base} width={16} height={16} aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
);

/** Couchbase logomark (official path, single color via currentColor). */
export const CouchbaseMark = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Couchbase" role="img">
    <path
      fill="currentColor"
      d="M83.1,58.6c0,2.9-1.7,5.5-5,6.1c-5.8,1-17.9,1.6-28.1,1.6s-22.3-0.7-28.1-1.6c-3.3-0.6-5-3.2-5-6.1V39.4c0-2.9,2.3-5.7,5-6.1c1.7-0.3,5.6-0.6,8.8-0.6c1.2,0,2.2,0.9,2.2,2.3v13.3c5.9,0,11.1-0.3,17.1-0.3s11.2,0.3,17.2,0.3V35.1c0-1.4,1-2.3,2.2-2.3c3.2,0,7.1,0.3,8.8,0.6c2.7,0.4,5,3.2,5,6.1L83.1,58.6z M50,1C22.9,1,1,22.9,1,50s21.9,49,49,49s49-21.9,49-49S77.1,1,50,1L50,1z"
    />
  </svg>
);
