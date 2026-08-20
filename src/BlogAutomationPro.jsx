import { useState, useEffect, useCallback, useRef } from "react";
import {
  getMonthKey, getMonthLabel, filterMonths, rollupMonths,
  makeMonthKey, monthPeriod, migrateMonthKeys,
} from "./monthFilters";
import { collectForbiddenBrands, enforceBrand, normalizeDomain } from "./brandGuard";
import {
  MIN_WORDS, countWords, hasFaqSection, extractFaqPairs, buildFaqSchema,
  insertBeforeFaq, boldKeywords, insertImages, seoReport,
} from "./articleQuality";
import { buildSchedule, parseSchedule, toGmtStamp, slugifyName } from "./schedule";
import { createPersister, IDLE, PENDING, SAVING, ERROR } from "./persist";

// ─── STORAGE ──────────────────────────────────────────────────────
let _appKey = (() => { try { return sessionStorage.getItem("blog_app_key") || ""; } catch { return ""; } })();
const setAppKey = (k) => { _appKey = k; try { sessionStorage.setItem("blog_app_key", k); } catch {} };
const authHeader = () => _appKey ? { "x-app-key": _appKey } : {};

// Returns { locked } | { error } | { state } — never a bare null. The caller
// MUST distinguish "the database is empty" (safe to start saving) from "the
// load failed" (saving would overwrite real data with this session's blanks).
const loadState = async () => {
  try {
    const res = await fetch("/api/state", { headers: authHeader() });
    if (res.status === 401) return { locked: true };
    if (!res.ok) return { error: `Server returned ${res.status}` };
    const d = await res.json();
    return { state: d && Object.keys(d).length > 0 ? d : null };
  } catch (e) {
    return { error: e.message || "Could not reach the server" };
  }
};

// Debounced — state changes on every keystroke, and each save rewrites the
// whole JSONB blob plus re-syncs the articles table.
const _persister = createPersister({
  send: async (state) => {
    const res = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(state),
    });
    // A 409 or 500 used to count as a successful save
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
  },
  onStatus: (s) => { _statusListeners.forEach(fn => fn(s)); },
});

const _statusListeners = new Set();
const onSaveStatus = (fn) => { _statusListeners.add(fn); return () => _statusListeners.delete(fn); };
const saveState = (s) => _persister.save(s);

if (typeof window !== "undefined") {
  // Write early when the tab is backgrounded, but keep the snapshot until the
  // server confirms it. keepalive is deliberately NOT used: the browser caps
  // keepalive bodies at 64 KB and a month of articles is far bigger, so those
  // requests were being dropped without a trace.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") _persister.flush();
  });
  window.addEventListener("pagehide", () => _persister.flush());
  // Last line of defence: never let a reload quietly discard an edit
  window.addEventListener("beforeunload", (e) => {
    if (!_persister.hasUnsaved()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

// Secrets arrive from the server as "••••••••abcd" placeholders and are sent
// back unchanged unless the user types a new value.
const MASK = "••••••••";
const isMasked = (v) => typeof v === "string" && v.startsWith(MASK);
const uid = () => Math.random().toString(36).slice(2, 10);

// ─── HELPERS ─────────────────────────────────────────────────────
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0,10); };

const TOPIC_BANK = [
  { title: "Top 10 Ancient Buddhist Temples in Sri Lanka", keywords: "Sri Lanka temples, ancient temples, Buddhist temples tour", category: "Cultural Heritage" },
  { title: "Complete Guide to Sigiriya Rock Fortress", keywords: "Sigiriya, Lion Rock, Sigiriya travel guide 2026", category: "Destinations" },
  { title: "Best Time to Visit Sri Lanka: Season-by-Season", keywords: "best time visit Sri Lanka, weather, monsoon seasons", category: "Travel Tips" },
  { title: "Sri Lanka Wildlife Safari: Yala & Udawalawe", keywords: "Sri Lanka safari, Yala National Park, Udawalawe elephants", category: "Wildlife" },
  { title: "Traditional Sri Lankan Cuisine: 15 Must-Try Dishes", keywords: "Sri Lankan food, traditional dishes, rice and curry", category: "Food & Culture" },
  { title: "Kandy to Ella Train: Most Scenic Rail Journey", keywords: "Kandy Ella train, scenic train ride, railway Sri Lanka", category: "Experiences" },
  { title: "Hidden Beaches of Southern Sri Lanka", keywords: "Sri Lanka beaches, Mirissa, Unawatuna, Tangalle", category: "Destinations" },
  { title: "Tea Country: Hill Plantation Adventures", keywords: "Sri Lanka tea, Nuwara Eliya, tea plantations", category: "Experiences" },
  { title: "Budget Travel Tips for Sri Lanka 2026", keywords: "Sri Lanka budget, cheap travel, backpacking", category: "Travel Tips" },
  { title: "Spiritual Sri Lanka: Buddhist Pilgrimage Guide", keywords: "Buddhist pilgrimage, sacred sites, Anuradhapura", category: "Spiritual Tourism" },
  { title: "Polonnaruwa Ancient City: A Walking Tour Guide", keywords: "Polonnaruwa, ancient ruins, UNESCO Sri Lanka", category: "Cultural Heritage" },
  { title: "Sri Lanka Ayurveda & Wellness Retreat Guide", keywords: "ayurveda Sri Lanka, wellness retreats, spa holidays", category: "Wellness" },
  { title: "Whale Watching in Mirissa: Complete Guide", keywords: "Mirissa whale watching, blue whales Sri Lanka", category: "Wildlife" },
  { title: "Galle Fort: History, Culture & Things to Do", keywords: "Galle Fort, Dutch colonial, Galle Sri Lanka", category: "Destinations" },
  { title: "Sri Lanka for Solo Travelers: Safety & Tips", keywords: "solo travel Sri Lanka, safety tips, solo female travel", category: "Travel Tips" },
  { title: "Adam's Peak: Sunrise Pilgrimage Trek Guide", keywords: "Adam's Peak, Sri Pada, sunrise hike Sri Lanka", category: "Spiritual Tourism" },
  { title: "Trincomalee & East Coast: Undiscovered Paradise", keywords: "Trincomalee, east coast beaches, Nilaveli Pigeon Island", category: "Destinations" },
  { title: "Sri Lankan Festivals & Cultural Events Calendar", keywords: "Sri Lanka festivals, Vesak, Kandy Perahera, Poya days", category: "Food & Culture" },
  { title: "Dambulla Cave Temple: Golden Temple Guide", keywords: "Dambulla, cave temple, golden temple Sri Lanka", category: "Cultural Heritage" },
  { title: "Sri Lanka Photography Guide: Best Spots & Tips", keywords: "Sri Lanka photography, best photo spots, travel photography", category: "Experiences" },
];

const CAT = {
  "Cultural Heritage": { grad: "linear-gradient(135deg,#78350f,#92400e)", text: "#fbbf24", dot: "#f59e0b" },
  "Destinations":      { grad: "linear-gradient(135deg,#1e3a5f,#1d4ed8)", text: "#93c5fd", dot: "#3b82f6" },
  "Travel Tips":       { grad: "linear-gradient(135deg,#052e16,#166534)", text: "#86efac", dot: "#22c55e" },
  "Wildlife":          { grad: "linear-gradient(135deg,#1c1207,#422006)", text: "#fde68a", dot: "#eab308" },
  "Food & Culture":    { grad: "linear-gradient(135deg,#4a044e,#86198f)", text: "#f0abfc", dot: "#ec4899" },
  "Experiences":       { grad: "linear-gradient(135deg,#2e1065,#5b21b6)", text: "#c4b5fd", dot: "#8b5cf6" },
  "Spiritual Tourism": { grad: "linear-gradient(135deg,#450a0a,#991b1b)", text: "#fca5a5", dot: "#ef4444" },
  "Wellness":          { grad: "linear-gradient(135deg,#022c22,#065f46)", text: "#5eead4", dot: "#14b8a6" },
};

// Statuses that count as delivered work, and those that are live in WordPress
const DONE_STATUSES = ["published", "published_now", "ready"];
const LIVE_STATUSES = ["published", "published_now"];

const STEPS = [
  { id: "title_gen",   icon: "✦", label: "SEO Title",  desc: "Generating optimized title & slug" },
  { id: "content_gen", icon: "✎", label: "Content",    desc: "Writing 2000+ words with FAQ" },
  { id: "images",      icon: "⬡", label: "Images",     desc: "Fetching & embedding 4–5 photos" },
  { id: "publishing",  icon: "↑", label: "Scheduling", desc: "Pushing to WordPress" },
];

const C = {
  bg: "#080C14", surface: "#0D1117", card: "#111827",
  border: "#1a2234", border2: "#243044",
  teal: "#14b8a6", tealDim: "#0d9488",
  text: "#e2e8f0", muted: "#64748b", muted2: "#475569",
};


// ─── SMALL COMPONENTS ────────────────────────────────────────────
const StatusDot = ({ status }) => {
  const map = {
    pending:      { color: "#475569", label: "Pending" },
    title_gen:    { color: "#818cf8", label: "SEO Title…",  spin: true },
    content_gen:  { color: "#38bdf8", label: "Writing…",    spin: true },
    images:       { color: "#c084fc", label: "Images…",     spin: true },
    ready:        { color: "#22c55e", label: "Ready" },
    publishing:   { color: "#fbbf24", label: "Publishing…", spin: true },
    published:    { color: "#14b8a6", label: "Scheduled ✓" },
    published_now:{ color: "#38bdf8", label: "Published ✓" },
    error:        { color: "#f87171", label: "Error" },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:600, color:s.color }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:s.color, display:"inline-block", animation: s.spin ? "pulse 1.2s ease-in-out infinite":"none", boxShadow: s.spin ? `0 0 6px ${s.color}`:"none" }} />
      {s.label}
    </span>
  );
};

const PayBadge = ({ status }) => {
  const m = {
    unpaid:  { bg:"rgba(239,68,68,0.12)",  text:"#fca5a5", border:"rgba(239,68,68,0.3)",  label:"UNPAID"  },
    paid:    { bg:"rgba(34,197,94,0.12)",  text:"#86efac", border:"rgba(34,197,94,0.3)",  label:"PAID"    },
    partial: { bg:"rgba(251,191,36,0.12)", text:"#fde68a", border:"rgba(251,191,36,0.3)", label:"PARTIAL" },
  };
  const s = m[status] || m.unpaid;
  return <span style={{ background:s.bg, color:s.text, border:`1px solid ${s.border}`, padding:"3px 10px", borderRadius:6, fontSize:10, fontWeight:700, letterSpacing:"0.08em" }}>{s.label}</span>;
};

const ConnBadge = ({ status }) => {
  const m = {
    idle:       { color: C.muted,    icon: "○", label: "Not tested" },
    testing:    { color: "#fbbf24",  icon: "◌", label: "Testing…"   },
    connected:  { color: "#22c55e",  icon: "●", label: "Connected"  },
    error:      { color: "#f87171",  icon: "✕", label: "Failed"     },
  };
  const s = m[status] || m.idle;
  return (
    <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:600, color:s.color }}>
      <span style={{ animation: status==="testing"?"spin 0.8s linear infinite":"none", display:"inline-block" }}>{s.icon}</span>
      {s.label}
    </span>
  );
};

const Field = ({ label, value, onChange, type="text", placeholder="", mono=false, hint, suffix }) => (
  <div style={{ marginBottom:16 }}>
    <label style={{ display:"block", fontSize:11, color:C.muted, marginBottom:6, fontWeight:500, letterSpacing:"0.05em", textTransform:"uppercase" }}>{label}</label>
    <div style={{ position:"relative" }}>
      <input value={value} onChange={e => onChange(e.target.value)} type={type} placeholder={placeholder}
        style={{ width:"100%", padding: suffix ? "10px 100px 10px 14px" : "10px 14px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:10, color:C.text, fontSize:13, fontFamily: mono?"'JetBrains Mono',monospace":"inherit", outline:"none", transition:"border 0.2s, box-shadow 0.2s", boxSizing:"border-box" }}
        onFocus={e=>{ e.target.style.borderColor=C.teal; e.target.style.boxShadow="0 0 0 3px rgba(20,184,166,0.12)"; }}
        onBlur={e=>{ e.target.style.borderColor=C.border2; e.target.style.boxShadow="none"; }} />
      {suffix && <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:12, color:C.muted }}>{suffix}</span>}
    </div>
    {hint && <p style={{ fontSize:11, color:C.muted2, marginTop:5, lineHeight:1.5 }}>{hint}</p>}
  </div>
);

const Select = ({ label, value, onChange, options }) => (
  <div style={{ marginBottom:16 }}>
    <label style={{ display:"block", fontSize:11, color:C.muted, marginBottom:6, fontWeight:500, letterSpacing:"0.05em", textTransform:"uppercase" }}>{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width:"100%", padding:"10px 14px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:10, color:C.text, fontSize:13, outline:"none", cursor:"pointer" }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

// ─── PIPELINE VISUALIZER ─────────────────────────────────────────
const PipelineVisualizer = ({ articles, logs, isRunning, logEndRef }) => {
  const total = articles.length;
  const done = articles.filter(a => DONE_STATUSES.includes(a.status)).length;
  const errored = articles.filter(a => a.status === "error").length;
  const progress = Math.round((done / total) * 100);
  const activeArticle = articles.find(a => ["title_gen","content_gen","images","publishing"].includes(a.status));
  const activeStep = activeArticle ? STEPS.findIndex(s => s.id === activeArticle.status) : -1;
  return (
    <div style={{ background:"linear-gradient(135deg,#0d1117 0%,#0a1628 100%)", border:`1px solid ${C.border2}`, borderRadius:16, padding:24, marginBottom:20 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600, color:C.text, display:"flex", alignItems:"center", gap:8 }}>
            {isRunning && <span style={{ width:8, height:8, borderRadius:"50%", background:C.teal, display:"inline-block", animation:"pulse 1.2s ease-in-out infinite", boxShadow:`0 0 10px ${C.teal}` }} />}
            {isRunning ? "Pipeline Running" : done===total ? "Pipeline Complete" : "Pipeline Ready"}
          </div>
          <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>{done}/{total} articles · {errored > 0 ? `${errored} error(s)` : "no errors"}</div>
        </div>
        <div style={{ fontSize:28, fontWeight:800, color: done===total ? C.teal : C.text }}>{progress}%</div>
      </div>
      <div style={{ height:6, background:"#1a2234", borderRadius:99, marginBottom:24, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${progress}%`, background:`linear-gradient(90deg,${C.tealDim},${C.teal})`, borderRadius:99, transition:"width 0.6s ease", boxShadow:`0 0 8px ${C.teal}` }} />
      </div>
      <div style={{ display:"flex", gap:8, marginBottom: activeArticle ? 16 : 0 }}>
        {STEPS.map((step, i) => {
          const isCurrent = i === activeStep;
          const isDone = activeStep > i || (activeStep === -1 && done > 0 && i < 3);
          return (
            <div key={step.id} style={{ flex:1, background: isCurrent ? "rgba(20,184,166,0.08)" : "rgba(255,255,255,0.02)", border:`1px solid ${isCurrent ? "rgba(20,184,166,0.35)" : C.border}`, borderRadius:12, padding:"12px 14px", transition:"all 0.3s" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ fontSize:16, opacity: isCurrent ? 1 : 0.35, filter: isCurrent ? `drop-shadow(0 0 6px ${C.teal})` : "none" }}>{step.icon}</span>
                {isCurrent && <span style={{ width:6, height:6, borderRadius:"50%", background:C.teal, animation:"pulse 1.2s infinite", boxShadow:`0 0 6px ${C.teal}` }} />}
                {isDone && !isCurrent && <span style={{ fontSize:10, color:"#22c55e" }}>✓</span>}
              </div>
              <div style={{ fontSize:11, fontWeight:600, color: isCurrent ? C.teal : C.muted, marginBottom:2 }}>{step.label}</div>
              <div style={{ fontSize:10, color:C.muted2 }}>{step.desc}</div>
            </div>
          );
        })}
      </div>
      {activeArticle && (
        <div style={{ background:"rgba(20,184,166,0.06)", border:"1px solid rgba(20,184,166,0.2)", borderRadius:10, padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:11, color:C.teal, fontWeight:600 }}>NOW</span>
          <span style={{ fontSize:12, color:C.text, flex:1 }}>{activeArticle.seoTitle || activeArticle.title}</span>
          <StatusDot status={activeArticle.status} />
        </div>
      )}
      {logs.length > 0 && (
        <div style={{ background:"#060a10", borderRadius:10, padding:14, maxHeight:180, overflowY:"auto", border:`1px solid ${C.border}`, marginTop:16 }}>
          {logs.slice(-40).map((l, i) => (
            <div key={i} style={{ padding:"2px 0", fontSize:11, fontFamily:"'JetBrains Mono',monospace", lineHeight:1.7 }}>
              <span style={{ color:"#2d3f5a" }}>{l.ts} </span>
              <span style={{ color: l.type==="error" ? "#f87171" : l.type==="success" ? "#4ade80" : l.type==="warn" ? "#fbbf24" : "#94a3b8" }}>{l.msg}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
};

// ─── MAIN ────────────────────────────────────────────────────────
export default function BlogAutomationPro() {
  const [locked, setLocked] = useState(false);
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [canSave, setCanSave] = useState(false);
  const [saveStatus, setSaveStatus] = useState(IDLE);
  const [nav, setNav] = useState("dashboard");
  const [months, setMonths] = useState({});
  const monthsRef = useRef({});
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  // API keys live server-side; what is held here is either a masked placeholder
  // (already saved) or a new value the user just typed.
  const [config, setConfig] = useState({
    grokKey: "",
    grokModel: "grok-3-mini",
    unsplashKeys: [],
    pricePerMonth: 6000,
    currency: "Rs",
    niche: "Sri Lanka tours and travel",
    brandName: "",
    brandWebsite: "",
  });
  const [newUnsplashKey, setNewUnsplashKey] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState("");
  const [targetKeywords, setTargetKeywords] = useState([
    "Sri Lanka tour guide and driver",
    "Sri Lanka tour driver",
    "Sri Lanka private tours with driver",
    "Honeymoon tours Sri Lanka",
    "Culture tours Sri Lanka",
    "Sri Lanka safari tours",
  ]);
  const [newKeyword, setNewKeyword] = useState("");
  const [payments, setPayments] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);

  // Test article
  const [showTestModal, setShowTestModal] = useState(false);
  const [testClientId, setTestClientId] = useState("");
  const [testTopicIdx, setTestTopicIdx] = useState(0);
  const [testCustomTitle, setTestCustomTitle] = useState("");
  const [testCustomKeywords, setTestCustomKeywords] = useState("");
  const [testCustomCategory, setTestCustomCategory] = useState("Destinations");
  const [testUseCustom, setTestUseCustom] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testLogs, setTestLogs] = useState([]);
  const [testResult, setTestResult] = useState(null); // { seoTitle, slug, metaDesc, content, images, wordCount }
  const [testTab, setTestTab] = useState("preview"); // preview | html
  const testLogEndRef = useRef(null);

  // Modals
  const [showNewMonth, setShowNewMonth] = useState(false);
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [editingSiteId, setEditingSiteId] = useState(null);
  const [editingClientId, setEditingClientId] = useState(null);
  const [siteForm, setSiteForm] = useState({ name:"", url:"", user:"", appPass:"", clientId:"" });
  const [clientForm, setClientForm] = useState({ name:"", email:"", phone:"", website:"", notes:"", niche:"", pricePerMonth:"" });
  const [siteConnStatus, setSiteConnStatus] = useState("idle"); // idle | testing | connected | error
  const [siteConnMsg, setSiteConnMsg] = useState("");

  // Content profile (keywords + topic bank) per client
  const [profileClientId, setProfileClientId] = useState(null);
  const [profileTab, setProfileTab] = useState("keywords"); // keywords | topics
  const [kwSearch, setKwSearch] = useState("");
  const [kwBulk, setKwBulk] = useState("");
  const [topicBulk, setTopicBulk] = useState("");
  const [topicForm, setTopicForm] = useState({ title:"", keywords:"", category:"Destinations" });

  // Months management page filters
  const [mfClient, setMfClient] = useState("");
  const [mfStatus, setMfStatus] = useState("all");   // all | unpaid | partial | paid
  const [mfSearch, setMfSearch] = useState("");
  const [mfSort, setMfSort] = useState("newest");    // newest | oldest | client

  // New month config
  const [nmDate, setNmDate] = useState(getMonthKey());
  const [nmClientId, setNmClientId] = useState("");
  const [nmSiteId, setNmSiteId] = useState("");
  const [nmStartDate, setNmStartDate] = useState(tomorrow());
  const [nmTime, setNmTime] = useState("09:00");
  const [nmLanguage, setNmLanguage] = useState("en");
  const [nmTopicSource, setNmTopicSource] = useState("ai"); // ai | bank
  const [nmGenerating, setNmGenerating] = useState(false);
  const [nmError, setNmError] = useState("");

  // Word export state — image downloads make this slow enough to need feedback
  const [docxExporting, setDocxExporting] = useState(false);
  const [docxProgress, setDocxProgress] = useState("");

  // Corrected doc upload state
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);

  const abortRef = useRef(false);
  const logEndRef = useRef(null);

  const applyState = (saved) => {
    if (!saved) return;
    // Bare "2026-01" keys predate multi-client months; rewrite them so a
    // second client can own the same calendar month. Payments and article ids
    // move with their month. The result is saved by the next autosave.
    const migrated = migrateMonthKeys({ months: saved.months || {}, payments: saved.payments || [] }, uid);
    const renamedCount = Object.keys(migrated.renamed).length;
    if (renamedCount) console.info(`[months] re-keyed ${renamedCount} month(s) for multi-client support`);

    if (saved.months)        setMonths(migrated.months);
    // Older records predate per-client content profiles — normalise them here
    if (saved.clients)       setClients(saved.clients.map(c => ({
      ...c,
      niche:    c.niche || "",
      keywords: Array.isArray(c.keywords) ? c.keywords : [],
      topics:   Array.isArray(c.topics)   ? c.topics   : [],
    })));
    if (saved.sites)         setSites(saved.sites);
    if (saved.config)        setConfig(p => {
      const sc = saved.config;
      let keys = sc.unsplashKeys || [];
      if (!keys.length && sc.unsplashAccessKey) keys = [sc.unsplashAccessKey];
      return {
        ...p, ...sc,
        grokKey: sc.grokKey || sc.geminiKey || "",
        grokModel: sc.grokModel || "grok-3-mini",
        unsplashKeys: keys,
        pricePerMonth: sc.pricePerMonth ?? 6000,
        currency: sc.currency || "Rs",
        niche: sc.niche || "Sri Lanka tours and travel",
      };
    });
    if (saved.payments)      setPayments(migrated.payments);
    if (saved.targetKeywords) setTargetKeywords(saved.targetKeywords);
  };

  // Autosave stays off until we know what is already in the database. Turning it
  // on after a failed load would push this session's empty defaults over every
  // saved month, client, site and API key.
  const enterApp = (res) => {
    if (res.locked) { setLocked(true); setLoaded(true); return; }
    if (res.error) { setLoadError(res.error); setCanSave(false); setLoaded(true); return; }
    applyState(res.state);
    setLoadError("");
    setCanSave(true);
    setLoaded(true);
  };

  const retryLoad = () => { setLoadError(""); loadState().then(enterApp); };

  useEffect(() => { loadState().then(enterApp); }, []);

  const doLogin = async () => {
    setLoginError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPass }),
      });
      if (!res.ok) { setLoginError("Wrong password. Try again."); return; }
      setAppKey(loginPass);
      setLocked(false);
      loadState().then(enterApp);
    } catch {
      setLoginError("Connection error. Is the server running?");
    }
  };

  useEffect(() => { if (canSave) saveState({ months, clients, sites, config, payments, targetKeywords }); }, [months, clients, sites, config, payments, targetKeywords, canSave]);
  useEffect(() => onSaveStatus(setSaveStatus), []);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [logs]);
  // Keep the ref in step with state so long-running loops read fresh articles
  useEffect(() => { monthsRef.current = months; }, [months]);

  const saveSettings = async () => {
    if (!canSave) { setSettingsSavedMsg("✕ Not saved — the database never loaded. Reload first."); return; }
    setSettingsSaving(true);
    setSettingsSavedMsg("");
    try {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ months, clients, sites, config, payments, targetKeywords }),
      });
      // fetch only rejects on network failure — a 500 still resolves, and
      // reporting that as saved is how an API key silently fails to persist
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server returned ${res.status}`);
      }
      setSettingsSavedMsg("✓ Saved to database");
    } catch (e) {
      setSettingsSavedMsg(`✕ Save failed — ${e.message}`);
    }
    setSettingsSaving(false);
    setTimeout(() => setSettingsSavedMsg(""), 5000);
  };

  const addLog = useCallback((msg, type="info") => {
    setLogs(prev => [...prev, { msg, type, ts: new Date().toLocaleTimeString() }]);
  }, []);

  const updateMonthSite = (monthKey, siteId) => {
    setMonths(p => ({ ...p, [monthKey]: { ...p[monthKey], siteId } }));
  };

  // ─── CLIENTS ────────────────────────────────────────────────
  const BLANK_CLIENT = { name:"", email:"", phone:"", website:"", notes:"", niche:"", pricePerMonth:"" };
  const openAddClient = () => { setEditingClientId(null); setClientForm(BLANK_CLIENT); setShowClientModal(true); };
  const openEditClient = (c) => {
    setEditingClientId(c.id);
    setClientForm({
      name:c.name, email:c.email||"", phone:c.phone||"", website:c.website||"",
      notes:c.notes||"", niche:c.niche||"", pricePerMonth:c.pricePerMonth ?? "",
    });
    setShowClientModal(true);
  };
  const saveClient = () => {
    if (!clientForm.name) return;
    const patch = { ...clientForm, pricePerMonth: clientForm.pricePerMonth === "" ? null : parseFloat(clientForm.pricePerMonth) || 0 };
    if (editingClientId) {
      setClients(p => p.map(c => c.id===editingClientId ? { ...c, ...patch } : c));
    } else {
      setClients(p => [...p, { id:uid(), ...patch, keywords:[], topics:[], createdAt:new Date().toISOString() }]);
    }
    setShowClientModal(false);
  };
  const deleteClient = (id) => { if (confirm("Delete client? Their linked sites will remain.")) setClients(p => p.filter(c => c.id!==id)); };

  // ─── CONTENT PROFILE (per-client keywords + topics) ─────────
  const updateClient = (id, patch) => setClients(p => p.map(c => c.id===id ? { ...c, ...patch } : c));

  const openProfile = (c) => {
    setProfileClientId(c.id);
    setProfileTab("keywords");
    setKwSearch(""); setKwBulk(""); setTopicBulk("");
    setTopicForm({ title:"", keywords:"", category:"Destinations" });
  };

  // Accepts newline- or comma-separated input; dedupes case-insensitively
  const parseKeywordList = (text) =>
    text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

  const addKeywords = (clientId, text) => {
    const incoming = parseKeywordList(text);
    if (!incoming.length) return;
    const client = clients.find(c => c.id===clientId);
    const existing = client?.keywords || [];
    const seen = new Set(existing.map(k => k.toLowerCase()));
    const added = [];
    for (const kw of incoming) {
      if (seen.has(kw.toLowerCase())) continue;
      seen.add(kw.toLowerCase());
      added.push(kw);
    }
    if (added.length) updateClient(clientId, { keywords: [...existing, ...added] });
    setKwBulk("");
  };

  const removeKeyword = (clientId, kw) => {
    const client = clients.find(c => c.id===clientId);
    updateClient(clientId, { keywords: (client?.keywords || []).filter(k => k !== kw) });
  };

  const addTopic = (clientId, topic) => {
    if (!topic.title.trim()) return;
    const client = clients.find(c => c.id===clientId);
    updateClient(clientId, { topics: [...(client?.topics || []), {
      title: topic.title.trim(),
      keywords: topic.keywords.trim(),
      category: topic.category || "Destinations",
    }]});
    setTopicForm({ title:"", keywords:"", category: topic.category || "Destinations" });
  };

  // One topic per line: "Title | keyword, keyword | Category" (last two optional)
  const addTopicsBulk = (clientId, text) => {
    const rows = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (!rows.length) return;
    const client = clients.find(c => c.id===clientId);
    const existing = client?.topics || [];
    const seen = new Set(existing.map(t => t.title.toLowerCase()));
    const added = [];
    for (const row of rows) {
      const [title, keywords = "", category = ""] = row.split("|").map(s => s.trim());
      if (!title || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      added.push({ title, keywords, category: CAT[category] ? category : "Destinations" });
    }
    if (added.length) updateClient(clientId, { topics: [...existing, ...added] });
    setTopicBulk("");
  };

  const removeTopic = (clientId, idx) => {
    const client = clients.find(c => c.id===clientId);
    updateClient(clientId, { topics: (client?.topics || []).filter((_, i) => i !== idx) });
  };

  // ─── SITES ──────────────────────────────────────────────────
  const openAddSite = (clientId="") => {
    setEditingSiteId(null);
    setSiteForm({ name:"", url:"", user:"", appPass:"", clientId });
    setSiteConnStatus("idle"); setSiteConnMsg("");
    setShowSiteModal(true);
  };
  const openEditSite = (s) => {
    setEditingSiteId(s.id);
    setSiteForm({ name:s.name, url:s.url, user:s.user, appPass:s.appPass, clientId:s.clientId||"" });
    setSiteConnStatus(s.connStatus || "idle"); setSiteConnMsg(s.connMsg||"");
    setShowSiteModal(true);
  };
  const saveSite = () => {
    if (!siteForm.name || !siteForm.url) return;
    const entry = { ...siteForm, connStatus: siteConnStatus, connMsg: siteConnMsg };
    if (editingSiteId) {
      setSites(p => p.map(s => s.id===editingSiteId ? { ...s, ...entry } : s));
    } else {
      setSites(p => [...p, { id:uid(), ...entry, createdAt:new Date().toISOString() }]);
    }
    setShowSiteModal(false);
  };
  const deleteSite = (id) => { if (confirm("Delete this site?")) setSites(p => p.filter(s => s.id!==id)); };

  const testConnection = async () => {
    if (!siteForm.url || !siteForm.user || !siteForm.appPass) {
      setSiteConnStatus("error"); setSiteConnMsg("Fill in URL, username and password first."); return;
    }
    setSiteConnStatus("testing"); setSiteConnMsg("");
    try {
      const res = await fetch("/api/wp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ siteId: editingSiteId || "", url: siteForm.url, user: siteForm.user, appPass: siteForm.appPass }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setSiteConnStatus("connected");
      setSiteConnMsg(`Connected as: ${data.name}${data.roles?.length ? ` (${data.roles.join(", ")})` : ""}`);
    } catch (err) {
      setSiteConnStatus("error");
      setSiteConnMsg(err.message);
    }
  };

  // ─── MONTHS ─────────────────────────────────────────────────
  // A client's own topic bank wins; the built-in list is the fallback
  const topicBankFor = (clientId) => {
    const c = clients.find(x => x.id === clientId);
    return c?.topics?.length ? c.topics : TOPIC_BANK;
  };

  // The key a month for this client+period would occupy. Several clients can
  // share a period; the same client twice in one period is still a duplicate.
  const monthKeyFor = (period, clientId) => makeMonthKey(period, clientId || `none-${uid()}`);

  const createMonth = async () => {
    if (nmGenerating) return;
    setNmError("");

    const monthKey = monthKeyFor(nmDate, nmClientId);
    if (months[monthKey]) {
      const owner = getClient(nmClientId)?.name;
      setNmError(`${owner || "This client"} already has ${getMonthLabel(nmDate)}. Open it from the Months page, or pick another month.`);
      return;
    }

    let picked;
    if (nmTopicSource === "ai") {
      if (!config.grokKey) { setNmError("Grok API key not set — add it in Settings, or switch to the topic bank."); return; }
      setNmGenerating(true);
      try {
        const profile = profileForClient(getClient(nmClientId), getSite(nmSiteId));
        picked = await generateMonthlyTopics(profile, 10, getMonthLabel(nmDate), usedTitlesFor(nmClientId));
      } catch (err) {
        setNmError(err.message);
        setNmGenerating(false);
        return;
      }
      setNmGenerating(false);
    } else {
      picked = [...topicBankFor(nmClientId)].sort(() => Math.random() - 0.5).slice(0, 10);
    }

    if (!picked?.length) { setNmError("No topics available for this month."); return; }
    const schedule = buildSchedule(nmStartDate, nmTime, picked.length);
    const articles = picked.map((t, i) => ({
      // Article ids are the primary key of the articles table, so they carry
      // the full month key — two clients' Januaries must not collide.
      id: `${monthKey}-${i}`, ...t,
      seoTitle:"", content:"", metaDesc:"", slug:"",
      images:[], status:"pending", wordCount:0, error:null,
      scheduledAt: schedule[i],
    }));
    setMonths(p => ({ ...p, [monthKey]: {
      articles, createdAt: new Date().toISOString(),
      clientId: nmClientId, siteId: nmSiteId,
      scheduleStartDate: nmStartDate, scheduleTime: nmTime,
      language: nmLanguage,
    }}));
    const price = clients.find(c => c.id===nmClientId)?.pricePerMonth ?? config.pricePerMonth;
    setPayments(p => [...p, { monthKey, status:"unpaid", amount:price, paidAt:null, clientId:nmClientId }]);
    setShowNewMonth(false);
    setSelectedMonth(monthKey);
    setNav("month");
  };

  // Upserts, because months created before payments existed have no record
  const upsertPayment = (k, patch) => setPayments(p => {
    if (p.some(x => x.monthKey === k)) return p.map(x => x.monthKey===k ? { ...x, ...patch } : x);
    const md = months[k];
    return [...p, {
      monthKey: k,
      status: "unpaid",
      amount: clients.find(c => c.id===md?.clientId)?.pricePerMonth ?? config.pricePerMonth,
      paidAt: null,
      clientId: md?.clientId,
      ...patch,
    }];
  });

  const setPaymentStatus = (k, status) => upsertPayment(k, {
    status,
    // Keep the original paid date when re-confirming; clear it when reverting
    paidAt: status === "paid" ? (getPayment(k).paidAt || new Date().toISOString()) : null,
  });

  const setPaymentAmount = (k, amount) => upsertPayment(k, { amount });

  const markPaid = (k) => setPaymentStatus(k, "paid");

  const exportData = () => {
    // targetKeywords was missing here, so a restore silently wiped the global list
    const data = { months, clients, sites, payments, config, targetKeywords, exportedAt: new Date().toISOString(), version: "blog-engine-v3" };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blog-engine-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        // A backup taken before multi-client months carries bare period keys
        const m = migrateMonthKeys({ months: data.months || {}, payments: data.payments || [] }, uid);
        if (data.months)   setMonths(m.months);
        if (data.clients)  setClients(data.clients);
        if (data.sites)    setSites(data.sites);
        if (data.payments) setPayments(m.payments);
        if (data.config)   setConfig(p => ({ ...p, ...data.config }));
        if (Array.isArray(data.targetKeywords)) setTargetKeywords(data.targetKeywords);
        alert(
          "Data restored successfully." +
          (data.config && isMasked(data.config.grokKey)
            ? "\n\nNote: API keys are masked in backups — re-enter them in Settings."
            : "")
        );
      } catch { alert("Invalid backup file."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };
  const getPayment = (k) => payments.find(p => p.monthKey===k) || { status:"unpaid" };
  const getSite = (id) => sites.find(s => s.id===id);
  const getClient = (id) => clients.find(c => c.id===id);

  // Resolve the content profile AI generation should write against: brand name,
  // website, niche and target keywords. The linked client wins; the linked site
  // and then the global defaults fill any gaps.
  const profileForClient = (client, site) => {
    // Client first, then the linked site, then the global default. Nothing is
    // hardcoded: an article must only ever carry this client's own brand.
    const name = client?.name || site?.name || config.brandName || "";
    const rawWebsite = client?.website || site?.url || config.brandWebsite || "";
    const website = normalizeDomain(rawWebsite);
    return {
      clientId: client?.id || "",
      name, website,
      niche: client?.niche || config.niche || "",
      keywords: client?.keywords?.length ? client.keywords : targetKeywords,
      // Every other client's brand, plus legacy defaults — never to appear here
      forbidden: collectForbiddenBrands({
        clients, activeClientId: client?.id || "", activeName: name, activeWebsite: website,
      }),
    };
  };

  const getProfile = (monthData) => {
    const site = monthData?.siteId ? getSite(monthData.siteId) : null;
    const client = monthData?.clientId ? getClient(monthData.clientId) : (site?.clientId ? getClient(site.clientId) : null);
    return profileForClient(client, site);
  };

  const updateArticle = useCallback((monthKey, articleId, updates) => {
    setMonths(prev => {
      const next = {
        ...prev,
        [monthKey]: { ...prev[monthKey], articles: prev[monthKey].articles.map(a => a.id===articleId ? { ...a, ...updates } : a) }
      };
      monthsRef.current = next;
      return next;
    });
  }, []);

  // ─── API ────────────────────────────────────────────────────
  // Proxied through Express — the xAI key never reaches the browser.
  // Retries and model selection are handled server-side.
  const aiCall = async (prompt) => {
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data.text || "";
  };

  const pickRandomKeywords = (list, n = 3) => {
    const pool = list || [];
    if (!pool.length) return [];
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, shuffled.length));
  };

  const parseAIJson = (text) => {
    let clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    // Remove control characters that break JSON.parse
    clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

    // 1. Try as-is
    let result = tryParse(clean);
    if (result) return result;

    // 2. Fix invalid escape sequences — AI sometimes emits \c, \s, \2022 etc. inside HTML content
    const fixEscapes = (s) => s.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    result = tryParse(fixEscapes(clean));
    if (result) return result;

    // 3. Extract first {...} block and retry both ways
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      result = tryParse(match[0]) || tryParse(fixEscapes(match[0]));
      if (result) return result;
    }

    throw new Error("AI returned invalid JSON — please retry");
  };

  const LANG_NAMES = { en:"English", it:"Italian", de:"German", fr:"French", es:"Spanish" };
  const DEFAULT_PROFILE = { name: "", website: "", niche: "", keywords: [], forbidden: [] };

  // Brand rules injected into every generation prompt. With no brand configured
  // we ask for entirely unbranded copy rather than letting Grok invent one.
  const brandRules = (profile) => {
    const forbidden = profile.forbidden?.length
      ? `\nNEVER mention any of these names or domains — they belong to other businesses: ${profile.forbidden.map(f => `"${f}"`).join(", ")}.`
      : "";
    if (!profile.name && !profile.website) {
      return `\nDo NOT mention any company, brand, agency or website name anywhere in the output.${forbidden}`;
    }
    const site = profile.website ? ` and the website "${profile.website}"` : "";
    return `\nBRAND RULE: the ONLY business this article may reference is "${profile.name}"${site}. `
      + `Every mention of a company, agency, brand, contact or website must be "${profile.name}"`
      + (profile.website ? ` / "${profile.website}"` : "")
      + `. Do NOT invent, cite or link any other tour operator, agency, competitor or third-party booking site.${forbidden}`;
  };

  const generateSEOTitle = async (topic, lang = "en", profile = DEFAULT_PROFILE) => {
    const kws = pickRandomKeywords(profile.keywords, 2);
    const kwHint = kws.length ? `\nNaturally weave 1-2 of these service keywords into the meta description if relevant: ${kws.join(", ")}` : "";
    const langLine = lang !== "en" ? `\nWRITE EVERYTHING IN ${LANG_NAMES[lang] || lang.toUpperCase()} — title, slug (latin chars), and meta description.` : "";
    const text = await aiCall(`You are an SEO expert for "${profile.name}" (${profile.website}), a business in this niche: ${profile.niche}.
Topic: "${topic.title}" | Keywords: ${topic.keywords}
Generate SEO title (50-65 chars), URL slug, meta description (150-160 chars).${kwHint}${brandRules(profile)}${langLine}
Respond ONLY in JSON (no markdown): {"seoTitle":"...","slug":"...","metaDescription":"..."}`);
    return parseAIJson(text);
  };

  const langLineFor = (lang) => lang !== "en"
    ? `\nCRITICAL: Write the ENTIRE article in ${LANG_NAMES[lang] || lang} — all headings, paragraphs, FAQ and CTA must be in ${LANG_NAMES[lang] || lang}.`
    : "";

  // The heading text insertFaq/hasFaqSection look for, in the article's language
  const FAQ_TITLE = { en:"Frequently Asked Questions", it:"Domande Frequenti (FAQ)", de:"Häufig gestellte Fragen (FAQ)", fr:"Questions Fréquentes (FAQ)", es:"Preguntas Frecuentes (FAQ)" };

  const generateContent = async (topic, lang = "en", profile = DEFAULT_PROFILE) => {
    const kws = pickRandomKeywords(profile.keywords, 4);
    const kwSection = kws.length
      ? `\nTarget keywords — use each 2-3 times woven naturally into sentences, and wrap the most important occurrence of each in <strong>: ${kws.map(k => `"${k}"`).join(", ")}`
      : "";
    const faqTitle = FAQ_TITLE[lang] || FAQ_TITLE.en;
    const text = await aiCall(`You are a professional blog writer for "${profile.name}" (${profile.website}), a premium business in this niche: ${profile.niche}.
Write a comprehensive, genuinely useful SEO-optimized blog article.
Title: "${topic.seoTitle || topic.title}" | Keywords: ${topic.keywords} | Category: ${topic.category}

HARD REQUIREMENTS:
1. LENGTH: at least 2000 words of real body copy — aim for 2200-2500. This is the single most important requirement; short articles are rejected. Write in depth: specifics, numbers, prices, durations, place names, seasons, step-by-step detail. Never pad with filler or repeat yourself.
2. STRUCTURE: valid HTML using only h2, h3, p, ul, ol, li, strong, em, table, tr, td. No <html>, <head>, <body> or markdown fences. Start with a 2-3 paragraph intro (no h2 above it), then 6-8 <h2> sections of 250-350 words each, several with <h3> sub-points.
3. EMPHASIS: bold the key phrases, statistics and keywords with <strong> — roughly 10-15 times across the article. Never bold whole paragraphs.
4. Include one "Key Takeaways" <ul> near the top and at least one comparison <table> (e.g. costs, seasons or options).
5. FAQ: end the article with <h2>${faqTitle}</h2> followed by 6-8 questions. Each question must be an <h3> and each answer a <p> of 40-70 words that directly answers it.${profile.name ? `\n6. Close with a short call-to-action paragraph mentioning ${profile.name}.` : ""}${kwSection}${brandRules(profile)}${langLineFor(lang)}

Also generate 5 image search queries IN ENGLISH suitable for stock photography of: ${profile.niche}. Make them concrete and visual (place, subject, activity) — not abstract.
Respond ONLY in JSON (no markdown): {"content":"<full HTML>","imageQueries":["q1","q2","q3","q4","q5"],"wordCount":2200}`);
    return parseAIJson(text);
  };

  // Grok routinely lands under target. Rather than accept a thin article we ask
  // for extra sections only — cheaper and safer than regenerating the whole thing.
  const expandContent = async (html, topic, lang, profile, shortfall) => {
    const existing = [...String(html).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]*>/g, "").trim());
    const text = await aiCall(`You are expanding an existing blog article titled "${topic.seoTitle || topic.title}" for a business in this niche: ${profile.niche}.
It is about ${shortfall} words short of the required length.

Write 2-3 ADDITIONAL <h2> sections totalling at least ${Math.max(400, shortfall + 150)} words that add genuinely new information.
These H2 sections already exist — do NOT repeat or rephrase them: ${existing.map(h => `"${h}"`).join(", ") || "(none)"}.
Use the same voice. Same HTML rules: h2, h3, p, ul, li, strong, em only. Bold key phrases with <strong>. Do not write an intro, a conclusion or an FAQ — sections only.${brandRules(profile)}${langLineFor(lang)}
Respond ONLY in JSON (no markdown): {"content":"<h2>…</h2>…"}`);
    const parsed = parseAIJson(text);
    return String(parsed.content || parsed.html || "").trim();
  };

  const generateFaqSection = async (topic, lang, profile) => {
    const faqTitle = FAQ_TITLE[lang] || FAQ_TITLE.en;
    const text = await aiCall(`Write an FAQ section for a blog article titled "${topic.seoTitle || topic.title}" (niche: ${profile.niche}, keywords: ${topic.keywords}).
Exactly 7 questions real readers would search for. Each question is an <h3>, each answer a <p> of 40-70 words that answers it directly and specifically.
Start the block with <h2>${faqTitle}</h2>. HTML only, no markdown.${brandRules(profile)}${langLineFor(lang)}
Respond ONLY in JSON (no markdown): {"faq":"<h2>${faqTitle}</h2><h3>…</h3><p>…</p>…"}`);
    const parsed = parseAIJson(text);
    return String(parsed.faq || parsed.content || "").trim();
  };

  /**
   * Everything between "Grok returned HTML" and "this is publishable":
   * brand guard → length top-up → FAQ → bolded keywords → images → FAQ schema.
   * Shared by the pipeline and the single test article so they cannot drift.
   */
  const polishArticle = async ({ raw, topic, lang, profile, images, logFn }) => {
    const log = logFn || (() => {});

    // Last line of defence: rewrite any competitor brand Grok let through
    const guarded = enforceBrand(raw, profile, profile.forbidden);
    if (guarded.replaced) log(`  🛡 Rewrote ${guarded.replaced} stray brand mention(s): ${guarded.terms.join(", ")}`, "warn");
    let html = guarded.html;

    // Length
    let words = countWords(html);
    if (words < MIN_WORDS) {
      const shortfall = MIN_WORDS - words;
      log(`  ↻ ${words} words — expanding by ~${shortfall} to reach ${MIN_WORDS}…`, "warn");
      try {
        const extra = await expandContent(html, topic, lang, profile, shortfall);
        if (extra) {
          const safeExtra = enforceBrand(extra, profile, profile.forbidden).html;
          html = insertBeforeFaq(html, safeExtra);
          words = countWords(html);
        }
      } catch (err) {
        log(`  ⚠ Expansion failed (${err.message}) — keeping the shorter draft`, "warn");
      }
    }
    if (words < MIN_WORDS) log(`  ⚠ ${words} words — still under the ${MIN_WORDS} target`, "warn");
    else log(`  ✓ ${words} words`, "success");

    // FAQ
    if (!hasFaqSection(html)) {
      log("  ↻ No FAQ section — generating one…", "warn");
      try {
        const faq = await generateFaqSection(topic, lang, profile);
        if (faq) html += "\n" + enforceBrand(faq, profile, profile.forbidden).html;
      } catch (err) {
        log(`  ⚠ FAQ generation failed: ${err.message}`, "warn");
      }
    }
    const faqPairs = extractFaqPairs(html);
    log(faqPairs.length ? `  ✓ FAQ: ${faqPairs.length} Q&A` : "  ⚠ No FAQ in the final article", faqPairs.length ? "success" : "warn");

    // Keyword emphasis — the model bolds some already; this guarantees the rest
    const kwList = [...new Set([
      ...String(topic.keywords || "").split(",").map(k => k.trim()),
      ...(profile.keywords || []),
    ].filter(Boolean))];
    const bolded = boldKeywords(html, kwList, { perKeyword: 2 });
    html = bolded.html;
    if (bolded.bolded) log(`  ✓ Bolded ${bolded.bolded} keyword mention(s)`, "success");

    // Images
    const placed = insertImages(html, images);
    html = placed.html;
    if (placed.inserted) log(`  ✓ ${placed.inserted} image(s) embedded in the article`, "success");
    else log("  ⚠ No images embedded — check the Unsplash keys in Settings", "error");

    // FAQPage rich-result markup
    html += buildFaqSchema(faqPairs);

    return { html, words, faq: faqPairs.length, images: placed.inserted, report: seoReport(html, kwList) };
  };

  // Every title this client has ever been given, so Grok can avoid repeats
  const usedTitlesFor = (clientId) => {
    const seen = new Set();
    for (const md of Object.values(months)) {
      if ((md.clientId || "") !== (clientId || "")) continue;
      for (const a of md.articles || []) {
        if (a.title) seen.add(a.title);
        if (a.seoTitle) seen.add(a.seoTitle);
      }
    }
    return [...seen];
  };

  // Ask Grok for a fresh, current set of topics instead of reusing a fixed bank
  const generateMonthlyTopics = async (profile, count, monthLabel, avoidTitles = []) => {
    const cats = Object.keys(CAT);
    const avoid = avoidTitles.length
      ? `\nAlready used for this client — do NOT repeat or closely paraphrase any of them:\n${avoidTitles.slice(0, 100).map(t => `- ${t}`).join("\n")}`
      : "";
    const kws = pickRandomKeywords(profile.keywords, 6);
    const kwLine = kws.length ? `\nThe business ranks for these services, so favour angles that support them: ${kws.join(", ")}.` : "";

    const text = await aiCall(`You are an SEO content strategist${profile.name ? ` for "${profile.name}"` : ""}, planning a blog calendar for ${monthLabel}.
Niche: ${profile.niche || "general travel"}.
Propose exactly ${count} FRESH, specific, high-search-intent blog article topics that are timely and relevant for ${monthLabel} — seasonal angles, current traveller interests, recent trends, upcoming events. Avoid generic evergreen titles that any year could use.
Every title must be distinct from the others in this list and cover a different angle or destination.${kwLine}${avoid}
For each topic provide:
- "title": 55-70 characters, specific and clickable
- "keywords": 3-6 comma-separated search keywords
- "category": EXACTLY one of these: ${cats.join(" | ")}
Vary the categories across the ${count} topics.${brandRules(profile)}
Respond ONLY in JSON (no markdown): {"topics":[{"title":"...","keywords":"...","category":"..."}]}`);

    const parsed = parseAIJson(text);
    const raw = Array.isArray(parsed) ? parsed : (parsed.topics || []);
    const avoidLower = new Set(avoidTitles.map(t => t.toLowerCase().trim()));
    const seen = new Set();
    const topics = [];

    for (const t of raw) {
      const title = String(t?.title || "").trim();
      if (!title) continue;
      const lower = title.toLowerCase();
      if (avoidLower.has(lower) || seen.has(lower)) continue; // drop repeats
      seen.add(lower);
      topics.push({
        title,
        keywords: String(t.keywords || "").trim(),
        // Grok occasionally invents a category — snap it back to a known one
        category: CAT[t.category] ? t.category : cats[topics.length % cats.length],
      });
      if (topics.length >= count) break;
    }

    if (!topics.length) throw new Error("Grok returned no usable topics — try again");
    return topics;
  };

  // Proxied through Express — access keys stay server-side, which also handles
  // per-key rate limit tracking and rotation.
  const fetchOneImage = async (query, logFn, usedIds) => {
    try {
      const res = await fetch("/api/images/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ query }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.warning) logFn && logFn(`  ⚠ ${data.warning}`, "warn");
      if (!res.ok) { logFn && logFn(`  ⚠ Image search failed: ${data.error || res.status}`, "warn"); return null; }

      const all = data.results || [];
      // Prefer high-resolution, not-yet-used-in-this-article photos; relax filters if nothing matches
      let candidates = all.filter(r => (r.width||0) >= 1600 && !usedIds.has(r.id));
      if (!candidates.length) candidates = all.filter(r => !usedIds.has(r.id));
      if (!candidates.length) candidates = all;
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * Math.min(8, candidates.length))];
        usedIds.add(pick.id);
        return { url:pick.url, alt:pick.alt || query, credit:pick.credit };
      }
    } catch {}
    return null;
  };

  const fetchImages = async (queries, logFn, category = "", niche = "") => {
    const images = [];
    const usedIds = new Set();
    const count = Math.min(5, Math.max(4, queries.length || 5));
    // Broader fallback queries used when an AI-generated query returns no usable photos
    const base = niche || "travel";
    const fallbacks = [category ? `${category} ${base}` : null, base, `${base} landscape`, `${base} photography`].filter(Boolean);
    let fbIdx = 0;
    for (let i = 0; i < count; i++) {
      const query = queries[i] || fallbacks[fbIdx++ % fallbacks.length];
      logFn(`  Fetching image ${i+1}/${count}: "${query}"…`);
      let img = await fetchOneImage(query, logFn, usedIds);
      if (!img) {
        const fb = fallbacks[fbIdx++ % fallbacks.length];
        logFn(`  ↻ No usable results for "${query}" — trying "${fb}"…`, "warn");
        img = await fetchOneImage(fb, logFn, usedIds);
      }
      if (img) images.push(img);
      if (i < count - 1) await new Promise(r => setTimeout(r, 1500));
    }
    return images;
  };

  // Cache: siteId → { categoryName → wpCategoryId }
  const wpCatCache = useRef({});

  const getOrCreateWPCategory = async (site, categoryName) => {
    const cache = wpCatCache.current[site.id] || {};
    if (cache[categoryName]) return cache[categoryName];

    const res = await fetch("/api/wp/category", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ siteId: site.id, url: site.url, user: site.user, name: categoryName }),
    });
    const data = await res.json();
    if (data.id) {
      wpCatCache.current[site.id] = { ...cache, [categoryName]: data.id };
      return data.id;
    }
    return null;
  };

  // WordPress publish/schedule — proxied through Express to avoid CORS
  const publishToWP = async (site, article, logFn) => {
    const scheduledAt = article.scheduledAt;
    const now = new Date();
    const pubDate = parseSchedule(scheduledAt);
    const isFuture = pubDate && pubDate > now;

    // Check if post already exists with this slug to prevent duplicates on retry
    if (article.slug) {
      try {
        const chk = await fetch("/api/wp/find-post", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({ siteId: site.id, url: site.url, user: site.user, slug: article.slug }),
        });
        if (chk.ok) {
          const found = await chk.json();
          if (found.found) {
            logFn?.(`  ℹ Post already exists in WordPress (id: ${found.id}, ${found.status}) — skipping duplicate`, "warn");
            return { id: found.id, status: found.status, __alreadyExists: true };
          }
        }
      } catch { /* best-effort check — proceed with create if it fails */ }
    }

    // Resolve category ID (auto-create if missing)
    const categories = [];
    if (article.category) {
      const catId = await getOrCreateWPCategory(site, article.category);
      if (catId) categories.push(catId);
    }

    // Upload first image as featured image
    let featuredMediaId = null;
    const firstImage = article.images?.[0];
    if (firstImage?.url) {
      logFn?.(`  📸 Uploading featured image…`);
      const ctrl = new AbortController();
      const tmo = setTimeout(() => ctrl.abort(), 35000);
      try {
        const uploadRes = await fetch("/api/wp/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({
            siteId: site.id, url: site.url, user: site.user,
            imageUrl: firstImage.url,
            filename: `${article.slug || "article"}-featured.jpg`,
            alt: firstImage.alt || article.seoTitle || article.title,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(tmo);
        if (uploadRes.ok) {
          const media = await uploadRes.json();
          featuredMediaId = media.id;
          logFn?.(`  ✓ Featured image set (id: ${featuredMediaId})`, "success");
        } else {
          const err = await uploadRes.json().catch(() => ({}));
          logFn?.(`  ⚠ Featured image failed: ${err.error || uploadRes.status}`, "warn");
        }
      } catch (err) {
        clearTimeout(tmo);
        logFn?.(`  ⚠ Featured image ${err.name === "AbortError" ? "timed out (skipped)" : `error: ${err.message}`}`, "warn");
      }
    }

    const post = {
      title: article.seoTitle || article.title,
      content: article.content,
      status: isFuture ? "future" : "publish",
      slug: article.slug,
      excerpt: article.metaDesc,
      ...(categories.length && { categories }),
      ...(featuredMediaId && { featured_media: featuredMediaId }),
    };
    // Use date_gmt so WordPress treats the time as UTC regardless of site timezone
    if (isFuture) post.date_gmt = toGmtStamp(scheduledAt);

    const ctrl = new AbortController();
    const tmo = setTimeout(() => ctrl.abort(), 95000);
    try {
      const res = await fetch("/api/wp/post", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ siteId: site.id, url: site.url, user: site.user, post }),
        signal: ctrl.signal,
      });
      clearTimeout(tmo);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || `WordPress API ${res.status}`);
      }
      return res.json();
    } catch (err) {
      clearTimeout(tmo);
      if (err.name === "AbortError") throw new Error("WordPress did not respond within 90s — check site connectivity");
      throw err;
    }
  };

  useEffect(() => { testLogEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [testLogs]);

  // ─── TEST ARTICLE ────────────────────────────────────────────
  const runTestArticle = async () => {
    if (!config.grokKey) { setTestLogs([{ msg:"Grok API key not set — go to Settings first.", type:"error", ts:new Date().toLocaleTimeString() }]); return; }
    const addTL = (msg, type="info") => setTestLogs(p => [...p, { msg, type, ts: new Date().toLocaleTimeString() }]);
    const bank = topicBankFor(testClientId);
    const profile = profileForClient(getClient(testClientId), null);
    const topic = testUseCustom
      ? { title: testCustomTitle || `${profile.niche} guide`, keywords: testCustomKeywords || profile.niche, category: testCustomCategory }
      : bank[Math.min(testTopicIdx, bank.length - 1)];
    if (!topic) { setTestLogs([{ msg:"No topics available — add topics to this client's content profile.", type:"error", ts:new Date().toLocaleTimeString() }]); return; }
    setTestRunning(true);
    setTestResult(null);
    setTestLogs([]);
    setTestTab("preview");
    addTL(`Starting test: "${topic.title}"`, "success");
    addTL(`  Profile: ${profile.name} (${profile.website}) · ${profile.keywords.length} keyword(s)`, "info");
    try {
      addTL("  Generating SEO title & slug…");
      const td = await generateSEOTitle(topic, "en", profile);
      addTL(`  ✓ Title: "${td.seoTitle}"`, "success");

      addTL("  Writing 2000+ word article…");
      const art = { ...topic, seoTitle: td.seoTitle, slug: td.slug, metaDesc: td.metaDescription };
      const cd = await generateContent(art, "en", profile);

      addTL("  Fetching Unsplash images (4–5)…");
      const imgs = await fetchImages(cd.imageQueries || [], addTL, topic.category, profile.niche);
      addTL(imgs.length ? `  ✓ ${imgs.length} images fetched` : "  ✕ 0 images fetched — add an Unsplash key in Settings", imgs.length ? "success" : "error");

      const polished = await polishArticle({ raw: cd.content, topic: art, lang: "en", profile, images: imgs, logFn: addTL });
      setTestResult({ seoTitle: td.seoTitle, slug: td.slug, metaDesc: td.metaDescription, content: polished.html, images: imgs, wordCount: polished.words, category: topic.category, keywords: topic.keywords, report: polished.report });
      addTL("Done! Article ready to preview.", "success");
    } catch (err) {
      addTL(`Error: ${err.message}`, "error");
    }
    setTestRunning(false);
  };

  // ─── PIPELINE ────────────────────────────────────────────────
  const runPipeline = async (monthKey) => {
    if (!config.grokKey) { addLog("⚠ Grok API key not set — go to Settings.", "error"); return; }
    if (getPayment(monthKey).status !== "paid") { addLog("⚠ Mark month as PAID first.", "error"); return; }
    const monthData = months[monthKey];
    const lang = monthData.language || "en";
    const site = monthData.siteId ? getSite(monthData.siteId) : null;
    const profile = getProfile(monthData);
    abortRef.current = false;
    setIsRunning(true);
    setLogs([]);
    setSelectedArticle(null);
    const articles = monthData.articles;
    addLog(`🚀 Starting — ${articles.length} articles`, "success");
    addLog(`🏷 Brand: ${profile.name} (${profile.website}) · niche: ${profile.niche}`, "info");
    addLog(`🎯 ${profile.keywords.length} target keyword(s) in profile`, "info");
    if (site) addLog(`🔗 Publishing to: ${site.name}`, "info");
    else addLog("⚠ No site linked — will generate only (not publish).", "warn");

    for (let i = 0; i < articles.length; i++) {
      if (abortRef.current) { addLog("⛔ Aborted.", "error"); break; }
      const a = articles[i];
      if (a.status !== "pending" && a.status !== "error") continue;
      addLog(`\n── [${i+1}/${articles.length}] "${a.title}"${a.status==="error" ? " (retrying)" : ""}`);

      // SEO Title
      try {
        updateArticle(monthKey, a.id, { status:"title_gen", error:null });
        addLog("  Generating SEO title…");
        const td = await generateSEOTitle(a, lang, profile);
        const gTitle = enforceBrand(td.seoTitle, profile, profile.forbidden);
        const gMeta  = enforceBrand(td.metaDescription, profile, profile.forbidden);
        if (gTitle.replaced + gMeta.replaced) addLog(`  🛡 Rewrote ${gTitle.replaced + gMeta.replaced} stray brand mention(s) in title/meta`, "warn");
        updateArticle(monthKey, a.id, { seoTitle:gTitle.html, slug:td.slug, metaDesc:gMeta.html });
        addLog(`  ✓ "${gTitle.html}"`, "success");
      } catch (err) { updateArticle(monthKey, a.id, { status:"error", error:err.message }); addLog(`  ✕ ${err.message}`, "error"); continue; }

      if (abortRef.current) break;

      // Content + Images
      try {
        updateArticle(monthKey, a.id, { status:"content_gen" });
        addLog("  Writing 2000+ word article…");
        const freshA = (monthsRef.current[monthKey] || months[monthKey])?.articles.find(x => x.id===a.id) || a;
        const cd = await generateContent(freshA, lang, profile);

        updateArticle(monthKey, a.id, { status:"images" });
        const imgs = await fetchImages(cd.imageQueries||[], (msg, type) => addLog(msg, type), a.category, profile.niche);
        if (!imgs.length) addLog("  ✕ 0 images fetched — add or renew an Unsplash key in Settings", "error");

        const polished = await polishArticle({ raw: cd.content, topic: freshA, lang, profile, images: imgs, logFn: addLog });
        updateArticle(monthKey, a.id, {
          content: polished.html, wordCount: polished.words, images: imgs,
          faqCount: polished.faq, imageCount: polished.images, status: "ready",
        });
      } catch (err) { updateArticle(monthKey, a.id, { status:"error", error:err.message }); addLog(`  ✕ ${err.message}`, "error"); continue; }
    }

    // Publish / Schedule to WP
    if (!abortRef.current && site?.user && site?.appPass) {
      addLog("\n── Submitting to WordPress…", "success");
      const current = (monthsRef.current[monthKey] || months[monthKey]).articles;
      for (let i = 0; i < current.length; i++) {
        if (abortRef.current) break;
        const a = current[i];
        if (a.status !== "ready") continue;
        try {
          updateArticle(monthKey, a.id, { status:"publishing" });
          const dt = a.scheduledAt ? parseSchedule(a.scheduledAt) : null;
          const isFuture = dt && dt > new Date();
          addLog(`  ${isFuture ? `📅 Scheduling ${dt.toLocaleDateString()} ${dt.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}` : "📤 Publishing now"}: "${a.seoTitle||a.title}"`);
          const result = await publishToWP(site, a, addLog);
          updateArticle(monthKey, a.id, { status: result?.__alreadyExists || isFuture ? "published" : "published_now", error:null });
          addLog(`  ✓ ${result?.__alreadyExists ? "Already in WordPress (skipped)" : isFuture ? "Scheduled!" : "Published!"}`, "success");
          await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          // Content is fine — only the WordPress push failed, so leave it "ready"
          // and let "Publish Ready" retry without regenerating the article.
          updateArticle(monthKey, a.id, { status:"ready", error:err.message });
          addLog(`  ✕ ${err.message}`, "error");
        }
      }
    } else if (!site) {
      addLog("\n⚠ No WordPress site linked — link one in Sites, then re-run.", "warn");
    }

    addLog("\n🏁 Pipeline complete!", "success");
    setIsRunning(false);
    // Auto-save articles to disk
    autoExportArticles(monthKey);
  };

  const autoExportArticles = (monthKey) => {
    try {
      // Read through the ref — `months` is stale inside a long pipeline run
      const monthData = monthsRef.current[monthKey] || months[monthKey];
      if (!monthData) return;
      const exportData = {
        month: getMonthLabel(monthKey),
        exportedAt: new Date().toISOString(),
        site: getSite(monthData.siteId)?.url || "",
        client: getClient(monthData.clientId)?.name || "",
        articles: monthData.articles.map(a => ({
          title: a.seoTitle || a.title,
          slug: a.slug,
          category: a.category,
          keywords: a.keywords,
          metaDescription: a.metaDesc,
          wordCount: a.wordCount,
          scheduledAt: a.scheduledAt,
          status: a.status,
          content: a.content,
          images: a.images,
        })),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type:"application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugifyName(getClient(monthData.clientId)?.name) || "articles"}-${monthPeriod(monthKey)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addLog("💾 Articles auto-saved to Downloads folder.", "success");
    } catch {}
  };

  const deleteMonth = (monthKey) => {
    // Two clients can share a calendar month, so name the owner in the prompt
    const owner = getClient(months[monthKey]?.clientId)?.name;
    if (!confirm(`Delete ${getMonthLabel(monthKey)}${owner ? ` for ${owner}` : ""} and all its articles? This cannot be undone.`)) return;
    setMonths(p => { const n = { ...p }; delete n[monthKey]; return n; });
    setPayments(p => p.filter(x => x.monthKey !== monthKey));
    if (selectedMonth === monthKey) { setSelectedMonth(null); setNav("dashboard"); }
  };

  // ─── PUBLISH READY (recheck) ─────────────────────────────────
  // Anything that has been written and is not already live. Not just status
  // "ready": after a pipeline run everything is "published", and an article
  // whose WordPress push failed sits in "error" with perfectly good content.
  // WordPress is checked for the slug first, so re-running skips duplicates.
  const publishableArticles = (monthData) =>
    (monthData?.articles || []).filter(a => a.content && !LIVE_STATUSES.includes(a.status));

  const publishReadyArticles = async (monthKey) => {
    const monthData = months[monthKey];
    const site = monthData?.siteId ? getSite(monthData.siteId) : null;
    if (!site?.user || !site?.appPass) { addLog("⚠ No WordPress site linked — link one in Sites first.", "error"); return; }
    const readyArts = publishableArticles(monthData);
    if (!readyArts.length) {
      const live = (monthData?.articles || []).filter(a => LIVE_STATUSES.includes(a.status)).length;
      addLog(live ? `All ${live} article(s) are already in WordPress.` : "No generated articles to publish yet — run the pipeline first.", "warn");
      return;
    }

    // Auto-reschedule: if any scheduled date is in the past, rebuild the schedule
    // starting from tomorrow so all articles get proper future dates in WordPress
    const now = new Date();
    const allPast = readyArts.every(a => !a.scheduledAt || parseSchedule(a.scheduledAt) <= now);
    if (allPast) {
      addLog("⚠ All scheduled dates are in the past — rescheduling from tomorrow…", "warn");
      const [h, m] = (monthData.scheduleTime || "09:00").split(":").map(Number);
      readyArts.forEach((a, i) => {
        const d = new Date();
        d.setDate(d.getDate() + 1 + i * 2);
        d.setHours(h, m, 0, 0);
        updateArticle(monthKey, a.id, { scheduledAt: d.toISOString() });
        a.scheduledAt = d.toISOString();
      });
    }

    setIsRunning(true);
    addLog(`\n── Publishing ${readyArts.length} ready article(s) to WordPress…`, "success");
    for (const a of readyArts) {
      if (abortRef.current) break;
      try {
        updateArticle(monthKey, a.id, { status:"publishing" });
        const dt = a.scheduledAt ? parseSchedule(a.scheduledAt) : null;
        const isFuture = dt && dt > new Date();
        addLog(`  ${isFuture ? `📅 Scheduling for ${dt.toLocaleDateString()}` : "📤 Publishing now"}: "${a.seoTitle||a.title}"`);
        const result = await publishToWP(site, a, addLog);
        const finalStatus = result?.__alreadyExists ? "published" : isFuture ? "published" : "published_now";
        updateArticle(monthKey, a.id, { status: finalStatus });
        addLog(`  ✓ ${result?.__alreadyExists ? "Already in WordPress (skipped)" : isFuture ? "Scheduled!" : "Published!"}`, "success");
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        updateArticle(monthKey, a.id, { status:"ready", error:err.message });
        addLog(`  ✕ ${err.message}`, "error");
      }
    }
    setIsRunning(false);
  };

  // ─── DOWNLOAD ALL AS WORD (.docx) ────────────────────────────
  // Natural pixel size, so a photo can be scaled to the text column instead of
  // being guessed at. Returns zeroes if the browser cannot decode it.
  const imagePixelSize = async (blob) => {
    try {
      if (typeof createImageBitmap === "function") {
        const bmp = await createImageBitmap(blob);
        const size = { width: bmp.width, height: bmp.height };
        bmp.close?.();
        return size;
      }
    } catch { /* fall through to the <img> route */ }
    try {
      const url = URL.createObjectURL(blob);
      const size = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = url;
      });
      URL.revokeObjectURL(url);
      return size;
    } catch { return { width: 0, height: 0 }; }
  };

  // The proxy first: it is not subject to CORS and already validates the URL.
  // A direct fetch is the fallback if the proxy itself is unreachable.
  const fetchImageBytes = async (src) => {
    const attempts = [
      () => fetch("/api/images/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ imageUrl: src }),
      }),
      () => fetch(src),
    ];
    for (const attempt of attempts) {
      try {
        const res = await attempt();
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob.size || !/^image\//i.test(blob.type || "image/jpeg")) continue;
        const { width, height } = await imagePixelSize(blob);
        return { data: await blob.arrayBuffer(), width, height, mime: blob.type };
      } catch { /* try the next route */ }
    }
    return null;
  };

  const downloadAllAsWord = async (monthKey) => {
    const monthData = months[monthKey];
    if (!monthData || docxExporting) return;

    setDocxExporting(true);
    setDocxProgress("Preparing…");
    try {
      // Loaded on demand — the docx writer is large and only this button needs it
      const [{ default: JSZip }, blocksMod, docxMod] = await Promise.all([
        import("jszip"), import("./htmlBlocks"), import("./docxBuilder"),
      ]);
      const { htmlToBlocks, imageSources } = blocksMod;
      const { buildArticleDoc, docToBlob } = docxMod;

      const zip = new JSZip();
      const label = getMonthLabel(monthKey);
      const clientName = getClient(monthData.clientId)?.name || "";
      // One download per photo, even when several articles reuse it
      const imageCache = new Map();
      let embedded = 0, missing = 0, written = 0;

      const usable = monthData.articles.filter(a => a.content || a.seoTitle);

      for (let i = 0; i < monthData.articles.length; i++) {
        const a = monthData.articles[i];
        if (!a.content && !a.seoTitle) continue;
        const num = String(i + 1).padStart(2, "0");
        setDocxProgress(`Article ${written + 1} of ${usable.length}…`);

        const blocks = htmlToBlocks(a.content || "<p>No content generated yet.</p>");

        for (const src of imageSources(blocks)) {
          if (imageCache.has(src)) continue;
          const bytes = await fetchImageBytes(src);
          imageCache.set(src, bytes);
          if (bytes) embedded++; else missing++;
        }

        const images = new Map([...imageCache].filter(([, v]) => v));
        const doc = buildArticleDoc({
          article: a,
          blocks,
          images,
          meta: {
            client: clientName,
            scheduled: a.scheduledAt ? parseSchedule(a.scheduledAt).toLocaleString() : "",
          },
        });
        zip.file(`${num}-${a.slug || `article-${num}`}.docx`, await docToBlob(doc));
        written++;
      }

      if (!written) { setDocxProgress("Nothing to export yet."); return; }

      setDocxProgress("Zipping…");
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      // Named after the client, not the original single-brand hardcode
      const who = slugifyName(clientName) || "articles";
      link.download = `${who}-${label.replace(/\s/g, "-")}.zip`;
      link.click();
      URL.revokeObjectURL(url);

      setDocxProgress(
        `${written} .docx file(s) · ${embedded} image(s) embedded` +
        (missing ? ` · ${missing} could not be downloaded` : "")
      );
    } catch (err) {
      setDocxProgress(`Export failed: ${err.message}`);
    } finally {
      setDocxExporting(false);
      setTimeout(() => setDocxProgress(""), 8000);
    }
  };

  // ─── UPLOAD CORRECTED DOCS ───────────────────────────────────
  const handleCorrectedDocsUpload = async (monthKey, files) => {
    const mammoth = await import("mammoth");
    const monthData = months[monthKey];
    if (!monthData) return;
    setUploadingDocs(true);
    setUploadResults([]);
    const results = [];
    // Hand-edited docs go through the same brand guard as generated ones
    const profile = getProfile(monthData);
    const total = monthData.articles.length;

    for (const file of Array.from(files || [])) {
      if (!/\.docx$/i.test(file.name)) {
        results.push({
          file: file.name, ok: false,
          msg: /\.zip$/i.test(file.name)
            ? "That is the zip — unzip it first, then choose the .docx files inside"
            : "Not a .docx file (Word's older .doc format is not supported — use Save As → .docx)",
        });
        continue;
      }

      // Match by filename prefix e.g. "01-slug.docx" -> article index 0
      const match = file.name.match(/^(\d+)/);
      const idx = match ? parseInt(match[1], 10) - 1 : -1;
      const article = monthData.articles[idx];
      if (!article) {
        results.push({
          file: file.name, ok: false,
          msg: match
            ? `No article #${idx + 1} in this month (it has ${total})`
            : "Filename must start with the article number, e.g. 01-slug.docx",
        });
        continue;
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        // Word stores the photos inside the file. Mammoth would hand them back
        // as base64 data URIs, which bloat the saved state and which WordPress
        // will not host; map them back onto the original image URLs instead.
        const known = article.images || [];
        let imgIdx = 0;
        const result = await mammoth.convertToHtml({ arrayBuffer }, {
          convertImage: mammoth.images.imgElement(async (image) => {
            const original = known[imgIdx++];
            if (original?.url) return { src: original.url, alt: original.alt || "" };
            const b64 = await image.read("base64");
            return { src: `data:${image.contentType};base64,${b64}` };
          }),
        });

        const guarded = enforceBrand(result.value, profile, profile.forbidden);
        const words = countWords(guarded.html);
        const imageCount = (guarded.html.match(/<img[\s>]/gi) || []).length;
        updateArticle(monthKey, article.id, {
          content: guarded.html, wordCount: words, status: "ready", error: null,
          faqCount: extractFaqPairs(guarded.html).length,
          imageCount,
        });
        results.push({
          file: file.name, ok: true,
          msg: `-> Article #${idx + 1}: "${article.seoTitle || article.title}" · ${words} words · ${imageCount} image(s)`
            + (guarded.replaced ? ` · ${guarded.replaced} brand mention(s) rewritten` : ""),
        });
      } catch (err) {
        results.push({ file: file.name, ok: false, msg: err.message });
      }
    }

    setUploadResults(results);
    setUploadingDocs(false);
  };

  if (locked) return (
    <div style={{ height:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ width:340, background:C.surface, border:`1px solid ${C.border2}`, borderRadius:20, padding:36 }}>
        <div style={{ fontSize:22, fontWeight:800, color:C.text, marginBottom:6, letterSpacing:"-0.03em" }}>Blog Engine</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:28 }}>Enter your password to continue</div>
        <label style={{ display:"block", fontSize:11, color:C.muted, marginBottom:6, fontWeight:500, letterSpacing:"0.05em", textTransform:"uppercase" }}>Password</label>
        <input
          type="password"
          value={loginPass}
          onChange={e => setLoginPass(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doLogin()}
          placeholder="••••••••"
          autoFocus
          style={{ width:"100%", padding:"10px 14px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:10, color:C.text, fontSize:14, outline:"none", boxSizing:"border-box", marginBottom:loginError ? 8 : 16 }}
        />
        {loginError && <div style={{ fontSize:12, color:"#f87171", marginBottom:12 }}>{loginError}</div>}
        <button onClick={doLogin} style={{ width:"100%", padding:"11px", background:C.teal, border:"none", borderRadius:10, color:"#000", fontSize:14, fontWeight:700, cursor:"pointer" }}>
          Unlock
        </button>
      </div>
    </div>
  );

  if (!loaded) return (
    <div style={{ height:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:40, height:40, borderRadius:"50%", border:`3px solid ${C.border2}`, borderTopColor:C.teal, animation:"spin 0.8s linear infinite", margin:"0 auto 16px" }} />
        <div style={{ color:C.muted, fontSize:13 }}>Loading…</div>
      </div>
    </div>
  );

  const cur = config.currency || "Rs";

  // ─── MONTHS PAGE: filtering + rollup ────────────────────────
  const monthKeys = Object.keys(months);
  const filteredMonthKeys = filterMonths({
    months, payments, clients, sites,
    clientId: mfClient, status: mfStatus, search: mfSearch, sort: mfSort,
  });
  const mfRollup = rollupMonths({ keys: filteredMonthKeys, months, payments, liveStatuses: LIVE_STATUSES });

  const testBank = topicBankFor(testClientId);
  const testTopic = testBank[Math.min(testTopicIdx, testBank.length - 1)];
  const nmBank = topicBankFor(nmClientId);
  const nmCount = nmTopicSource === "ai" ? 10 : Math.min(10, nmBank.length);
  const nmUsesClientTopics = !!clients.find(c => c.id === nmClientId)?.topics?.length;
  // Only a repeat for the SAME client is a duplicate — other clients may share
  // the period, and an unassigned month gets a fresh key every time.
  const nmDuplicate = !!nmClientId && !!months[makeMonthKey(nmDate, nmClientId)];
  const nmPeriodOwners = Object.keys(months)
    .filter(k => monthPeriod(k) === monthPeriod(nmDate))
    .map(k => getClient(months[k].clientId)?.name)
    .filter(Boolean);
  // Newest period first; clients sharing a period are grouped by name
  const sortedMonths = filterMonths({ months, payments, clients, sites, sort: "newest" });
  const totalRevenue = payments.filter(p => p.status==="paid").reduce((s,p) => s+(p.amount||0), 0);
  const totalArticles = Object.values(months).reduce((s,m) => s+m.articles.filter(a => DONE_STATUSES.includes(a.status)).length, 0);
  const viewArticle = selectedMonth && selectedArticle ? months[selectedMonth]?.articles.find(a => a.id===selectedArticle) : null;

  const NAV = [
    { id:"dashboard", icon:"⊞", label:"Dashboard" },
    { id:"months",    icon:"🗓", label:"Months",   badge: monthKeys.length },
    { id:"clients",   icon:"👥", label:"Clients",  badge: clients.length },
    { id:"sites",     icon:"🔗", label:"Sites",    badge: sites.length },
    { id:"payments",  icon:"◈", label:"Payments" },
    { id:"settings",  icon:"⚙", label:"Settings" },
  ];

  const Btn = ({ children, onClick, variant="primary", disabled=false, small=false }) => {
    const styles = {
      primary: { background: disabled ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,#0d9488,#14b8a6)", color: disabled ? C.muted : "#021a17", boxShadow: disabled ? "none" : "0 4px 16px rgba(20,184,166,0.3)" },
      ghost:   { background:"rgba(255,255,255,0.04)", color:C.muted, border:`1px solid ${C.border}` },
      danger:  { background:"rgba(239,68,68,0.1)", color:"#fca5a5", border:"1px solid rgba(239,68,68,0.25)" },
      success: { background:"rgba(34,197,94,0.1)", color:"#86efac", border:"1px solid rgba(34,197,94,0.25)" },
      warn:    { background:"rgba(251,146,60,0.1)", color:"#fdba74", border:"1px solid rgba(251,146,60,0.25)" },
    };
    const s = styles[variant] || styles.primary;
    return (
      <button onClick={onClick} disabled={disabled}
        style={{ padding: small ? "7px 14px" : "10px 20px", borderRadius:10, fontWeight:600, cursor:disabled?"not-allowed":"pointer", fontSize: small ? 12 : 13, border:"none", transition:"all 0.15s", ...s }}>
        {children}
      </button>
    );
  };

  return (
    <div style={{ display:"flex", height:"100vh", background:C.bg, color:C.text, fontFamily:"'Inter','Segoe UI',sans-serif", overflow:"hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Saving is disabled until the database has been read, so a failed load
          cannot overwrite real data with this session's blank defaults. */}
      {loadError && (
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:9999, background:"#7f1d1d", borderBottom:"1px solid #ef4444", padding:"10px 18px", display:"flex", alignItems:"center", gap:14, fontSize:13, color:"#fecaca" }}>
          <span style={{ fontWeight:700 }}>⚠ Could not load your data — {loadError}.</span>
          <span>Changes are <strong>not being saved</strong> so nothing already stored gets overwritten.</span>
          <button onClick={retryLoad}
            style={{ marginLeft:"auto", padding:"5px 14px", background:"#fecaca", border:"none", borderRadius:7, color:"#7f1d1d", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            Retry
          </button>
        </div>
      )}

      {/* ── SIDEBAR ── */}
      <aside style={{ width:220, background:C.surface, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"20px 16px 16px", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#0d9488,#14b8a6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:800, color:"#021a17", boxShadow:"0 0 16px rgba(20,184,166,0.35)", flexShrink:0 }}>W</div>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Blog Engine</div>
              {/* Never let a save fail invisibly again */}
              {(() => {
                const s = {
                  [SAVING]:  { text: "Saving…",            color: C.muted },
                  [PENDING]: { text: "Unsaved changes",    color: "#fbbf24" },
                  [ERROR]:   { text: "Save failed — retrying", color: "#f87171" },
                  [IDLE]:    { text: "All changes saved",  color: C.muted },
                }[saveStatus] || { text: "", color: C.muted };
                return <div style={{ fontSize:10, color:s.color, marginTop:1 }}>{s.text}</div>;
              })()}
            </div>
          </div>
        </div>
        <nav style={{ padding:"10px 8px", flex:1, overflowY:"auto" }}>
          {NAV.map(item => {
            const active = nav===item.id && !selectedMonth;
            return (
              <button key={item.id} onClick={() => { setNav(item.id); setSelectedMonth(null); setSelectedArticle(null); }}
                style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"9px 12px", background: active?"rgba(20,184,166,0.1)":"transparent", border: active?"1px solid rgba(20,184,166,0.2)":"1px solid transparent", borderRadius:9, color: active?C.teal:C.muted, fontSize:13, fontWeight: active?600:400, cursor:"pointer", marginBottom:2, transition:"all 0.15s" }}>
                <span style={{ display:"flex", alignItems:"center", gap:9 }}><span style={{ fontSize:13 }}>{item.icon}</span>{item.label}</span>
                {item.badge > 0 && <span style={{ background:"rgba(20,184,166,0.15)", color:C.teal, fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:99 }}>{item.badge}</span>}
              </button>
            );
          })}

          <div style={{ padding:"16px 12px 8px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:10, color:C.muted2, textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:600 }}>Months</span>
            <button onClick={() => setShowNewMonth(true)} style={{ background:"rgba(20,184,166,0.1)", border:"1px solid rgba(20,184,166,0.2)", color:C.teal, width:22, height:22, borderRadius:6, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>+</button>
          </div>

          {sortedMonths.map(key => {
            const p = getPayment(key);
            const done = months[key].articles.filter(a => DONE_STATUSES.includes(a.status)).length;
            const active = selectedMonth===key && nav==="month";
            const client = getClient(months[key].clientId);
            return (
              <button key={key} onClick={() => { setSelectedMonth(key); setNav("month"); setSelectedArticle(null); }}
                style={{ width:"100%", padding:"8px 12px", background: active?"rgba(20,184,166,0.08)":"transparent", border: active?"1px solid rgba(20,184,166,0.15)":"1px solid transparent", borderRadius:9, color: active?C.text:C.muted, fontSize:12, cursor:"pointer", textAlign:"left", marginBottom:2, transition:"all 0.15s" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontWeight: active?600:400 }}>{getMonthLabel(key)}</span>
                  <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <span style={{ fontSize:10, color:C.muted2, fontFamily:"'JetBrains Mono',monospace" }}>{done}/{months[key].articles.length}</span>
                    <span style={{ width:6, height:6, borderRadius:"50%", background: p.status==="paid"?"#22c55e":"#ef4444", boxShadow: p.status==="paid"?"0 0 4px #22c55e":"none" }} />
                  </span>
                </div>
                {client && <div style={{ fontSize:10, color:C.muted2, marginTop:2 }}>👤 {client.name}</div>}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── MAIN ── */}
      <main style={{ flex:1, overflowY:"auto", height:"100vh" }}>

        {/* ── DASHBOARD ── */}
        {nav==="dashboard" && (
          <div style={{ padding:32 }}>
            <div style={{ marginBottom:28 }}>
              <h1 style={{ fontSize:26, fontWeight:800, color:C.text, letterSpacing:"-0.03em" }}>Dashboard</h1>
              <p style={{ fontSize:13, color:C.muted, marginTop:4 }}>Manage your monthly blog automation workflow</p>
            </div>

            {!config.grokKey && (
              <div style={{ background:"rgba(251,191,36,0.06)", border:"1px solid rgba(251,191,36,0.25)", borderRadius:12, padding:"14px 18px", marginBottom:16, display:"flex", gap:12, alignItems:"center" }}>
                ⚠ <span style={{ fontSize:13, color:"#fde68a" }}>Grok API key not set — <button onClick={() => setNav("settings")} style={{ background:"none", border:"none", color:C.teal, cursor:"pointer", fontSize:13, padding:"0 4px", textDecoration:"underline" }}>Settings</button></span>
              </div>
            )}
            {clients.length===0 && (
              <div style={{ background:"rgba(192,132,252,0.05)", border:"1px solid rgba(192,132,252,0.2)", borderRadius:12, padding:"14px 18px", marginBottom:16, display:"flex", gap:12, alignItems:"center" }}>
                👥 <span style={{ fontSize:13, color:"#d8b4fe" }}>No clients yet — <button onClick={() => setNav("clients")} style={{ background:"none", border:"none", color:C.teal, cursor:"pointer", fontSize:13, padding:"0 4px", textDecoration:"underline" }}>add a client</button> to get started.</span>
              </div>
            )}
            {sites.length===0 && (
              <div style={{ background:"rgba(56,189,248,0.05)", border:"1px solid rgba(56,189,248,0.2)", borderRadius:12, padding:"14px 18px", marginBottom:16, display:"flex", gap:12, alignItems:"center" }}>
                🔗 <span style={{ fontSize:13, color:"#7dd3fc" }}>No WordPress sites — <button onClick={() => setNav("sites")} style={{ background:"none", border:"none", color:C.teal, cursor:"pointer", fontSize:13, padding:"0 4px", textDecoration:"underline" }}>add a site</button> to enable publishing.</span>
              </div>
            )}

            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:28 }}>
              {[
                { label:"Total Revenue",    value:`${config.currency||"Rs"} ${totalRevenue.toLocaleString()}`, color:"#22c55e", icon:"💰" },
                { label:"Articles Generated",value:totalArticles,     color:"#38bdf8", icon:"📝" },
                { label:"Active Clients",    value:clients.length,    color:"#c084fc", icon:"👥" },
                { label:"Active Months",     value:sortedMonths.length,color:"#f59e0b", icon:"📅" },
              ].map(s => (
                <div key={s.label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"18px 20px", position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", right:14, top:14, fontSize:20, opacity:0.2 }}>{s.icon}</div>
                  <div style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>{s.label}</div>
                  <div style={{ fontSize:30, fontWeight:800, color:s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <h2 style={{ fontSize:13, fontWeight:600, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Monthly Overview</h2>
              <div style={{ display:"flex", gap:8 }}>
                <Btn onClick={() => { setShowTestModal(true); setTestResult(null); setTestLogs([]); }} variant="ghost" small>⚗ Test Article</Btn>
                <Btn onClick={() => setShowNewMonth(true)} small>+ New Month</Btn>
              </div>
            </div>

            {sortedMonths.length===0 ? (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:48, textAlign:"center" }}>
                <div style={{ fontSize:36, marginBottom:12, opacity:0.3 }}>📄</div>
                <p style={{ color:C.muted, marginBottom:20, fontSize:14 }}>No months yet.</p>
                <Btn onClick={() => setShowNewMonth(true)}>+ Create First Month</Btn>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {sortedMonths.map(key => {
                  const p = getPayment(key);
                  const arts = months[key].articles;
                  const pub = arts.filter(a => LIVE_STATUSES.includes(a.status)).length;
                  const rdy = arts.filter(a => a.status==="ready").length;
                  const pct = arts.length ? Math.round(((pub+rdy)/arts.length)*100) : 0;
                  const client = getClient(months[key].clientId);
                  const site = getSite(months[key].siteId);
                  const firstDate = arts[0]?.scheduledAt ? parseSchedule(arts[0].scheduledAt).toLocaleDateString() : null;
                  const lastArt = arts[arts.length - 1];
                  const lastDate = lastArt?.scheduledAt ? parseSchedule(lastArt.scheduledAt).toLocaleDateString() : null;
                  return (
                    <div key={key}
                      style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"all 0.2s" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor=C.border2; e.currentTarget.style.background="#151e2e"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor=C.border; e.currentTarget.style.background=C.card; }}>
                      <div style={{ flex:1, cursor:"pointer" }} onClick={() => { setSelectedMonth(key); setNav("month"); }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8, flexWrap:"wrap" }}>
                          <span style={{ fontSize:15, fontWeight:700, color:C.text }}>{getMonthLabel(key)}</span>
                          <PayBadge status={p.status} />
                          {client && <span style={{ fontSize:11, color:"#d8b4fe", background:"rgba(192,132,252,0.1)", border:"1px solid rgba(192,132,252,0.2)", padding:"2px 8px", borderRadius:6 }}>👤 {client.name}</span>}
                          {site && <span style={{ fontSize:11, color:"#7dd3fc", background:"rgba(56,189,248,0.08)", border:"1px solid rgba(56,189,248,0.2)", padding:"2px 8px", borderRadius:6 }}>🔗 {site.name}</span>}
                        </div>
                        <div style={{ height:4, background:"#1a2234", borderRadius:99, width:"60%", overflow:"hidden", marginBottom:6 }}>
                          <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${C.tealDim},${C.teal})`, borderRadius:99, transition:"width 0.5s" }} />
                        </div>
                        <div style={{ fontSize:11, color:C.muted }}>
                          {pub} scheduled · {rdy} ready · {arts.length-pub-rdy} pending
                          {firstDate && lastDate && <span style={{ marginLeft:12, color:C.muted2 }}>📅 {firstDate} → {lastDate}</span>}
                        </div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginLeft:12 }}>
                        <button onClick={e => { e.stopPropagation(); autoExportArticles(key); }} title="Download articles JSON"
                          style={{ background:"rgba(56,189,248,0.08)", border:"1px solid rgba(56,189,248,0.2)", color:"#7dd3fc", borderRadius:8, padding:"6px 10px", fontSize:12, cursor:"pointer" }}>↓</button>
                        <button onClick={e => { e.stopPropagation(); deleteMonth(key); }} title="Delete month"
                          style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", color:"#f87171", borderRadius:8, padding:"6px 10px", fontSize:12, cursor:"pointer" }}>✕</button>
                        <span style={{ color:C.border2, fontSize:16, cursor:"pointer" }} onClick={() => { setSelectedMonth(key); setNav("month"); }}>›</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── MONTHS (management) ── */}
        {nav==="months" && (() => {
          const ctlStyle = { padding:"9px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:9, color:C.text, fontSize:12, outline:"none", boxSizing:"border-box", width:"100%" };
          const filtersOn = mfClient || mfStatus !== "all" || mfSearch.trim();
          return (
            <div style={{ padding:32 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
                <div>
                  <h1 style={{ fontSize:26, fontWeight:800, color:C.text, letterSpacing:"-0.03em" }}>Months</h1>
                  <p style={{ fontSize:13, color:C.muted, marginTop:4 }}>Filter by client, update billing, change the linked site, or remove a month.</p>
                </div>
                <Btn onClick={() => setShowNewMonth(true)}>+ New Month</Btn>
              </div>

              {/* Filters */}
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:18, marginBottom:18 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr 1fr 1.6fr", gap:10 }}>
                  <div>
                    <label style={{ display:"block", fontSize:10, color:C.muted2, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>Client</label>
                    <select value={mfClient} onChange={e => setMfClient(e.target.value)} style={{ ...ctlStyle, cursor:"pointer" }}>
                      <option value="">All clients</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display:"block", fontSize:10, color:C.muted2, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>Payment</label>
                    <select value={mfStatus} onChange={e => setMfStatus(e.target.value)} style={{ ...ctlStyle, cursor:"pointer" }}>
                      <option value="all">All statuses</option>
                      <option value="unpaid">Unpaid</option>
                      <option value="partial">Partial</option>
                      <option value="paid">Paid</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display:"block", fontSize:10, color:C.muted2, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>Sort</label>
                    <select value={mfSort} onChange={e => setMfSort(e.target.value)} style={{ ...ctlStyle, cursor:"pointer" }}>
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="client">By client</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display:"block", fontSize:10, color:C.muted2, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>Search</label>
                    <input value={mfSearch} onChange={e => setMfSearch(e.target.value)} placeholder="Month, client or site…"
                      style={ctlStyle} onFocus={e => e.target.style.borderColor=C.teal} onBlur={e => e.target.style.borderColor=C.border2} />
                  </div>
                </div>
                {filtersOn && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:12 }}>
                    <span style={{ fontSize:11, color:C.muted }}>Showing {filteredMonthKeys.length} of {monthKeys.length} month(s)</span>
                    <button onClick={() => { setMfClient(""); setMfStatus("all"); setMfSearch(""); }}
                      style={{ background:"none", border:"none", color:C.teal, fontSize:11, cursor:"pointer", textDecoration:"underline", padding:0 }}>Clear filters</button>
                  </div>
                )}
              </div>

              {/* Rollup for the current filter */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
                {[
                  { label:"Months",      value:filteredMonthKeys.length, color:"#f59e0b" },
                  { label:"Articles",    value:`${mfRollup.live}/${mfRollup.articles}`, color:"#38bdf8", sub:"live / total" },
                  { label:"Paid",        value:`${cur} ${mfRollup.paid.toLocaleString()}`, color:"#22c55e" },
                  { label:"Outstanding", value:`${cur} ${mfRollup.outstanding.toLocaleString()}`, color:"#f87171" },
                ].map(s => (
                  <div key={s.label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 18px" }}>
                    <div style={{ fontSize:10, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>{s.label}</div>
                    <div style={{ fontSize:22, fontWeight:800, color:s.color }}>{s.value}</div>
                    {s.sub && <div style={{ fontSize:10, color:C.muted2, marginTop:2 }}>{s.sub}</div>}
                  </div>
                ))}
              </div>

              {/* List */}
              {monthKeys.length === 0 ? (
                <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:48, textAlign:"center" }}>
                  <div style={{ fontSize:36, marginBottom:12, opacity:0.3 }}>🗓</div>
                  <p style={{ color:C.muted, marginBottom:20, fontSize:14 }}>No months yet.</p>
                  <Btn onClick={() => setShowNewMonth(true)}>+ Create First Month</Btn>
                </div>
              ) : filteredMonthKeys.length === 0 ? (
                <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:40, textAlign:"center" }}>
                  <p style={{ color:C.muted, fontSize:13, marginBottom:14 }}>No months match these filters.</p>
                  <Btn variant="ghost" small onClick={() => { setMfClient(""); setMfStatus("all"); setMfSearch(""); }}>Clear filters</Btn>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  {filteredMonthKeys.map(key => {
                    const md = months[key];
                    const arts = md.articles || [];
                    const pay = getPayment(key);
                    const client = getClient(md.clientId);
                    const site = getSite(md.siteId);
                    const live = arts.filter(a => LIVE_STATUSES.includes(a.status)).length;
                    const rdy  = arts.filter(a => a.status === "ready").length;
                    const err  = arts.filter(a => a.status === "error").length;
                    const pct  = arts.length ? Math.round(((live + rdy) / arts.length) * 100) : 0;
                    const first = arts[0]?.scheduledAt;
                    const last  = arts[arts.length - 1]?.scheduledAt;
                    return (
                      <div key={key} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"18px 20px" }}>

                        {/* Identity row */}
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:16, marginBottom:12 }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:8 }}>
                              <span onClick={() => { setSelectedMonth(key); setNav("month"); setSelectedArticle(null); }}
                                style={{ fontSize:16, fontWeight:700, color:C.text, cursor:"pointer" }}
                                onMouseEnter={e => e.currentTarget.style.color=C.teal}
                                onMouseLeave={e => e.currentTarget.style.color=C.text}>{getMonthLabel(key)}</span>
                              <PayBadge status={pay.status} />
                              {client
                                ? <span style={{ fontSize:11, color:"#d8b4fe", background:"rgba(192,132,252,0.1)", border:"1px solid rgba(192,132,252,0.2)", padding:"2px 8px", borderRadius:6 }}>👤 {client.name}</span>
                                : <span style={{ fontSize:11, color:C.muted2, background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, padding:"2px 8px", borderRadius:6 }}>no client</span>}
                              {md.language && md.language !== "en" && (
                                <span style={{ fontSize:11, color:"#fde68a", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.2)", padding:"2px 8px", borderRadius:6 }}>🌍 {LANG_NAMES[md.language]}</span>
                              )}
                              {err > 0 && <span style={{ fontSize:11, color:"#fca5a5", background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.25)", padding:"2px 8px", borderRadius:6 }}>⚠ {err} error{err>1?"s":""}</span>}
                            </div>
                            <div style={{ height:4, background:"#1a2234", borderRadius:99, width:"70%", overflow:"hidden", marginBottom:6 }}>
                              <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${C.tealDim},${C.teal})`, borderRadius:99, transition:"width 0.5s" }} />
                            </div>
                            <div style={{ fontSize:11, color:C.muted }}>
                              {live} live · {rdy} ready · {Math.max(0, arts.length - live - rdy)} pending · {arts.length} total
                              {first && last && <span style={{ marginLeft:12, color:C.muted2 }}>📅 {parseSchedule(first).toLocaleDateString()} → {parseSchedule(last).toLocaleDateString()}</span>}
                            </div>
                          </div>
                          <Btn small variant="ghost" onClick={() => { setSelectedMonth(key); setNav("month"); setSelectedArticle(null); }}>Open ›</Btn>
                        </div>

                        {/* Controls row */}
                        <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr 1fr auto", gap:10, alignItems:"end", borderTop:`1px solid ${C.border}`, paddingTop:14 }}>
                          <div>
                            <label style={{ display:"block", fontSize:10, color:C.muted2, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>WordPress site</label>
                            <select value={md.siteId || ""} onChange={e => updateMonthSite(key, e.target.value)}
                              style={{ ...ctlStyle, cursor:"pointer", color: md.siteId ? "#7dd3fc" : "#f87171", borderColor: md.siteId ? C.border2 : "rgba(239,68,68,0.35)" }}>
                              <option value="">⚠ No site linked</option>
                              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={{ display:"block", fontSize:10, color:C.muted2, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>Payment</label>
                            <select value={pay.status || "unpaid"} onChange={e => setPaymentStatus(key, e.target.value)}
                              style={{ ...ctlStyle, cursor:"pointer", color: pay.status==="paid" ? "#86efac" : pay.status==="partial" ? "#fde68a" : "#fca5a5" }}>
                              <option value="unpaid">Unpaid</option>
                              <option value="partial">Partial</option>
                              <option value="paid">Paid</option>
                            </select>
                          </div>
                          <div>
                            <label style={{ display:"block", fontSize:10, color:C.muted2, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>Amount ({cur})</label>
                            <input type="number" value={pay.amount ?? 0} onChange={e => setPaymentAmount(key, parseFloat(e.target.value) || 0)}
                              style={ctlStyle} onFocus={e => e.target.style.borderColor=C.teal} onBlur={e => e.target.style.borderColor=C.border2} />
                          </div>
                          <div style={{ display:"flex", gap:6, paddingBottom:1 }}>
                            <button onClick={() => autoExportArticles(key)} title="Download articles JSON"
                              style={{ background:"rgba(56,189,248,0.08)", border:"1px solid rgba(56,189,248,0.2)", color:"#7dd3fc", borderRadius:9, padding:"9px 12px", fontSize:12, cursor:"pointer" }}>↓ JSON</button>
                            <button onClick={() => downloadAllAsWord(key)} disabled={!arts.some(a => a.content) || docxExporting} title={arts.some(a => a.content) ? "Download all articles as .docx with images (.zip)" : "No generated content yet"}
                              style={{ background:"rgba(129,140,248,0.08)", border:"1px solid rgba(129,140,248,0.2)", color: arts.some(a => a.content) ? "#a5b4fc" : C.muted2, borderRadius:9, padding:"9px 12px", fontSize:12, cursor: arts.some(a => a.content) && !docxExporting ? "pointer" : "not-allowed" }}>{docxExporting ? "⏳ Word" : "📥 Word"}</button>
                            <button onClick={() => deleteMonth(key)} title="Delete this month"
                              style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", color:"#f87171", borderRadius:9, padding:"9px 12px", fontSize:12, cursor:"pointer" }}>✕ Delete</button>
                          </div>
                        </div>

                        {pay.status === "paid" && pay.paidAt && (
                          <div style={{ fontSize:10, color:C.muted2, marginTop:8 }}>Paid on {new Date(pay.paidAt).toLocaleDateString()}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── CLIENTS ── */}
        {nav==="clients" && (
          <div style={{ padding:32 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28 }}>
              <div>
                <h1 style={{ fontSize:26, fontWeight:800, color:C.text, letterSpacing:"-0.03em" }}>Clients</h1>
                <p style={{ fontSize:13, color:C.muted, marginTop:4 }}>Manage clients and their WordPress sites</p>
              </div>
              <Btn onClick={openAddClient}>+ Add Client</Btn>
            </div>

            {clients.length===0 ? (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:48, textAlign:"center" }}>
                <div style={{ fontSize:40, marginBottom:12, opacity:0.3 }}>👥</div>
                <p style={{ color:C.muted, fontSize:14, marginBottom:20 }}>No clients yet. Add your first client to begin.</p>
                <Btn onClick={openAddClient}>+ Add First Client</Btn>
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                {clients.map(client => {
                  const clientSites = sites.filter(s => s.clientId===client.id);
                  const clientMonths = sortedMonths.filter(k => months[k].clientId===client.id);
                  const clientRevenue = payments.filter(p => p.clientId===client.id && p.status==="paid").reduce((s,p) => s+(p.amount||0), 0);
                  const clientPending = payments.filter(p => p.clientId===client.id && p.status==="unpaid").reduce((s,p) => s+(p.amount||0), 0);
                  return (
                    <div key={client.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:22, transition:"border 0.2s" }}
                      onMouseEnter={e => e.currentTarget.style.borderColor=C.border2}
                      onMouseLeave={e => e.currentTarget.style.borderColor=C.border}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                          <div style={{ width:40, height:40, borderRadius:12, background:"linear-gradient(135deg,#2e1065,#5b21b6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:800, color:"#c4b5fd", flexShrink:0 }}>
                            {client.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize:15, fontWeight:700, color:C.text }}>{client.name}</div>
                            {client.email && <div style={{ fontSize:12, color:C.muted }}>{client.email}</div>}
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:6 }}>
                          <Btn onClick={() => openProfile(client)} variant="ghost" small>🎯 Profile</Btn>
                          <Btn onClick={() => openEditClient(client)} variant="ghost" small>Edit</Btn>
                          <Btn onClick={() => deleteClient(client.id)} variant="danger" small>✕</Btn>
                        </div>
                      </div>

                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:14 }}>
                        {[
                          { label:"Revenue", value:`${cur} ${clientRevenue.toLocaleString()}`, color:"#22c55e" },
                          { label:"Pending",  value:`${cur} ${clientPending.toLocaleString()}`, color:"#f87171" },
                          { label:"Months",   value:clientMonths.length, color:"#c4b5fd" },
                        ].map(s => (
                          <div key={s.label} style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"10px 12px" }}>
                            <div style={{ fontSize:10, color:C.muted2, marginBottom:4 }}>{s.label}</div>
                            <div style={{ fontSize:18, fontWeight:700, color:s.color }}>{s.value}</div>
                          </div>
                        ))}
                      </div>

                      {client.phone && <div style={{ fontSize:12, color:C.muted, marginBottom:4 }}>📞 {client.phone}</div>}
                      {client.website && <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>🌐 {client.website}</div>}
                      {client.notes && <div style={{ fontSize:12, color:C.muted2, background:"rgba(255,255,255,0.02)", borderRadius:8, padding:"8px 10px", marginBottom:12 }}>{client.notes}</div>}

                      {/* Content profile summary */}
                      <div onClick={() => openProfile(client)}
                        style={{ background:"rgba(20,184,166,0.05)", border:"1px solid rgba(20,184,166,0.18)", borderRadius:10, padding:"10px 12px", marginBottom:12, cursor:"pointer" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                          <span style={{ fontSize:11, color:C.teal, fontWeight:600 }}>🎯 CONTENT PROFILE</span>
                          <span style={{ fontSize:11, color:C.muted }}>manage ›</span>
                        </div>
                        <div style={{ fontSize:11, color:C.muted }}>
                          <span style={{ color: client.keywords?.length ? "#86efac" : "#fbbf24" }}>
                            {client.keywords?.length || 0} keyword{client.keywords?.length === 1 ? "" : "s"}
                          </span>
                          {" · "}
                          <span style={{ color: client.topics?.length ? "#86efac" : "#fbbf24" }}>
                            {client.topics?.length || 0} topic{client.topics?.length === 1 ? "" : "s"}
                          </span>
                          {!client.keywords?.length && <span style={{ color:C.muted2 }}> — using global defaults</span>}
                        </div>
                        {client.niche && <div style={{ fontSize:11, color:C.muted2, marginTop:4 }}>Niche: {client.niche}</div>}
                      </div>

                      <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                          <span style={{ fontSize:11, color:C.muted, fontWeight:600 }}>LINKED SITES</span>
                          <button onClick={() => openAddSite(client.id)} style={{ background:"none", border:"none", color:C.teal, fontSize:11, cursor:"pointer", padding:0, textDecoration:"underline" }}>+ Add Site</button>
                        </div>
                        {clientSites.length===0
                          ? <div style={{ fontSize:12, color:C.muted2 }}>No sites linked yet.</div>
                          : clientSites.map(s => (
                              <div key={s.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"rgba(255,255,255,0.03)", borderRadius:8, padding:"8px 10px", marginBottom:6 }}>
                                <div>
                                  <div style={{ fontSize:12, fontWeight:600, color:C.text }}>{s.name}</div>
                                  <div style={{ fontSize:10, color:C.muted, fontFamily:"'JetBrains Mono',monospace" }}>{s.url}</div>
                                </div>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <ConnBadge status={s.connStatus||"idle"} />
                                  <button onClick={() => openEditSite(s)} style={{ background:"none", border:"none", color:C.muted, fontSize:11, cursor:"pointer", padding:0, textDecoration:"underline" }}>edit</button>
                                </div>
                              </div>
                            ))
                        }
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SITES ── */}
        {nav==="sites" && (
          <div style={{ padding:32 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28 }}>
              <div>
                <h1 style={{ fontSize:26, fontWeight:800, color:C.text, letterSpacing:"-0.03em" }}>WordPress Sites</h1>
                <p style={{ fontSize:13, color:C.muted, marginTop:4 }}>Connect and verify WordPress sites via Application Password API</p>
              </div>
              <Btn onClick={() => openAddSite()}>+ Add Site</Btn>
            </div>

            {sites.length===0 ? (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:48, textAlign:"center" }}>
                <div style={{ fontSize:40, marginBottom:12, opacity:0.3 }}>🔗</div>
                <p style={{ color:C.muted, fontSize:14, marginBottom:20 }}>No sites added. Connect a WordPress site to enable scheduled publishing.</p>
                <Btn onClick={() => openAddSite()}>+ Add First Site</Btn>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {sites.map(site => {
                  const client = getClient(site.clientId);
                  const linked = sortedMonths.filter(k => months[k].siteId===site.id).length;
                  return (
                    <div key={site.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"18px 22px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
                          <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#1e3a5f,#1d4ed8)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>W</div>
                          <div>
                            <div style={{ fontSize:15, fontWeight:700, color:C.text }}>{site.name}</div>
                            <div style={{ fontSize:12, color:C.muted, fontFamily:"'JetBrains Mono',monospace" }}>{site.url}</div>
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
                          <ConnBadge status={site.connStatus||"idle"} />
                          {site.connMsg && site.connStatus==="connected" && <span style={{ fontSize:11, color:C.muted }}>{site.connMsg}</span>}
                          {client && <span style={{ fontSize:11, color:"#d8b4fe" }}>👤 {client.name}</span>}
                          {linked > 0 && <span style={{ fontSize:11, color:C.teal }}>📅 {linked} month{linked>1?"s":""}</span>}
                          <span style={{ fontSize:11, color: site.appPass ? "#22c55e" : "#f87171" }}>{site.appPass ? "🔑 API password set" : "⚠ No password"}</span>
                        </div>
                        {site.connStatus==="error" && site.connMsg && <div style={{ fontSize:11, color:"#f87171", marginTop:6 }}>✕ {site.connMsg}</div>}
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        <Btn onClick={() => openEditSite(site)} variant="ghost" small>Edit</Btn>
                        <Btn onClick={() => deleteSite(site.id)} variant="danger" small>✕</Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop:24, background:"rgba(56,189,248,0.04)", border:"1px solid rgba(56,189,248,0.15)", borderRadius:12, padding:18 }}>
              <div style={{ fontSize:12, fontWeight:600, color:"#7dd3fc", marginBottom:8 }}>How to create a WordPress Application Password</div>
              <ol style={{ color:C.muted, fontSize:12, lineHeight:1.9, paddingLeft:18 }}>
                <li>Go to <strong style={{ color:C.text }}>WordPress Admin → Users → Your Profile</strong></li>
                <li>Scroll to <strong style={{ color:C.text }}>Application Passwords</strong></li>
                <li>Type "Blog Automation" and click <strong style={{ color:C.text }}>Add New Application Password</strong></li>
                <li>Copy the generated password (spaces included) and paste it into the site form</li>
                <li>Click <strong style={{ color:C.text }}>Test Connection</strong> — it hits the WP REST API to verify credentials</li>
              </ol>
            </div>
          </div>
        )}

        {/* ── MONTH VIEW ── */}
        {nav==="month" && selectedMonth && !viewArticle && (() => {
          const md = months[selectedMonth];
          const arts = md.articles;
          const pay = getPayment(selectedMonth);
          const site = getSite(md.siteId);
          const client = getClient(md.clientId);
          const firstDate = arts[0]?.scheduledAt;
          const lastDate = arts[arts.length - 1]?.scheduledAt;
          return (
            <div style={{ padding:32 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
                <div>
                  <button onClick={() => { setSelectedMonth(null); setNav("dashboard"); }} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:12, padding:"0 0 8px", display:"flex", alignItems:"center", gap:4 }}>‹ Dashboard</button>
                  <h1 style={{ fontSize:24, fontWeight:800, color:C.text, letterSpacing:"-0.03em" }}>{getMonthLabel(selectedMonth)}</h1>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:6, flexWrap:"wrap" }}>
                    <PayBadge status={pay.status} />
                    {client && <span style={{ fontSize:12, color:"#d8b4fe", background:"rgba(192,132,252,0.08)", border:"1px solid rgba(192,132,252,0.2)", padding:"2px 10px", borderRadius:6 }}>👤 {client.name}</span>}
                    <select
                      value={md.siteId || ""}
                      onChange={e => updateMonthSite(selectedMonth, e.target.value)}
                      title="Change WordPress site"
                      style={{ fontSize:12, color: md.siteId ? "#7dd3fc" : "#f87171", background: md.siteId ? "rgba(56,189,248,0.08)" : "rgba(239,68,68,0.08)", border:`1px solid ${md.siteId ? "rgba(56,189,248,0.2)" : "rgba(239,68,68,0.3)"}`, padding:"2px 8px", borderRadius:6, cursor:"pointer", outline:"none" }}
                    >
                      <option value="">⚠ No site linked</option>
                      {sites.map(s => <option key={s.id} value={s.id}>🔗 {s.name}</option>)}
                    </select>
                    {months[selectedMonth]?.language && months[selectedMonth].language !== "en" && (
                      <span style={{ fontSize:12, color:"#fde68a", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.2)", padding:"2px 10px", borderRadius:6 }}>
                        🌍 {LANG_NAMES[months[selectedMonth].language]}
                      </span>
                    )}
                    {firstDate && <span style={{ fontSize:12, color:"#818cf8", background:"rgba(129,140,248,0.08)", border:"1px solid rgba(129,140,248,0.2)", padding:"2px 10px", borderRadius:6 }}>📅 {parseSchedule(firstDate).toLocaleDateString()} – {parseSchedule(lastDate).toLocaleDateString()}</span>}
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:8, alignItems:"flex-end" }}>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
                    {pay.status !== "paid" && <Btn onClick={() => markPaid(selectedMonth)} variant="success">💰 Mark Paid</Btn>}
                    <Btn onClick={() => runPipeline(selectedMonth)} disabled={isRunning || pay.status!=="paid"}>
                      {isRunning ? "⏳ Running…" : pay.status!=="paid" ? "🔒 Pay First" : "▶ Run Pipeline"}
                    </Btn>
                    {!isRunning && arts.some(a => a.status==="error") && (
                      <Btn onClick={() => runPipeline(selectedMonth)} variant="warn" disabled={pay.status!=="paid"}>
                        🔁 Retry Failed ({arts.filter(a=>a.status==="error").length})
                      </Btn>
                    )}
                    {/* Publishes everything already written that is not yet live,
                        so the Word round trip is optional rather than required. */}
                    {!isRunning && arts.some(a => a.content) && (() => {
                      const pending = publishableArticles(months[selectedMonth]).length;
                      return (
                        <Btn onClick={() => publishReadyArticles(selectedMonth)} variant={pending ? "warn" : "ghost"} disabled={!pending}>
                          {pending ? `📤 Publish to WordPress (${pending})` : "✓ All published"}
                        </Btn>
                      );
                    })()}
                    {isRunning && <Btn onClick={() => { abortRef.current=true; }} variant="danger">⛔ Stop</Btn>}
                  </div>
                  {arts.some(a => a.content) && (
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <Btn onClick={() => downloadAllAsWord(selectedMonth)} variant="ghost" disabled={docxExporting}>
                        {docxExporting ? "⏳ Building .docx…" : "📥 Download All as Word (.docx)"}
                      </Btn>
                      {docxProgress && <span style={{ fontSize:11, color:C.muted }}>{docxProgress}</span>}
                    </div>
                  )}
                </div>
              </div>

              {(isRunning || logs.length > 0) && <PipelineVisualizer articles={arts} logs={logs} isRunning={isRunning} logEndRef={logEndRef} />}

              {/* Optional edit round trip — available for every month, not only
                  translated ones, and never required to publish. */}
              {arts.some(a => a.content) && (
                <div style={{ background:C.card, border:`1px solid rgba(129,140,248,0.3)`, borderRadius:14, padding:20, marginBottom:20 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#a5b4fc", marginBottom:6 }}>
                    📂 Optional: edit the text first
                    {months[selectedMonth]?.language && months[selectedMonth].language !== "en"
                      ? ` (${LANG_NAMES[months[selectedMonth].language]} articles)` : ""}
                  </div>
                  <p style={{ fontSize:12, color:C.muted, marginBottom:12, lineHeight:1.6 }}>
                    You do not need this to publish — <strong>Publish to WordPress</strong> above sends the articles as generated.
                    To reword them first: download the Word files, edit them, then upload the changed <code>.docx</code> files here
                    and publish. Keep the leading number in the filename (<code>01-slug.docx</code>, <code>02-slug.docx</code>) —
                    that is how each file is matched to its article.
                    <br />
                    <span style={{ color:C.muted2 }}>
                      Unzip the download first; the picker cannot see files that are still inside the <code>.zip</code>.
                    </span>
                  </p>
                  <label style={{ display:"inline-block", padding:"9px 18px", background:"rgba(129,140,248,0.12)", border:"1px solid rgba(129,140,248,0.3)", borderRadius:9, color:"#a5b4fc", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                    {uploadingDocs ? "Uploading…" : "Choose .docx files"}
                    {/* Both the extension and the MIME type, plus a catch-all, so
                        Windows does not hide the files behind its type filter */}
                    <input type="file" multiple style={{ display:"none" }} disabled={uploadingDocs}
                      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*"
                      onChange={e => handleCorrectedDocsUpload(selectedMonth, e.target.files)} />
                  </label>
                  {uploadResults.length > 0 && (
                    <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:4 }}>
                      {uploadResults.map((r, i) => (
                        <div key={i} style={{ fontSize:12, color: r.ok ? "#86efac" : "#fca5a5" }}>
                          {r.ok ? "✓" : "✕"} <strong>{r.file}</strong> — {r.msg}
                        </div>
                      ))}
                      {uploadResults.some(r => r.ok) && (
                        <div style={{ marginTop:8 }}>
                          <Btn onClick={() => publishReadyArticles(selectedMonth)} disabled={isRunning}>
                            📅 Schedule Corrected Articles to WordPress
                          </Btn>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Schedule timeline */}
              {arts.some(a => a.scheduledAt) && (
                <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:18, marginBottom:20 }}>
                  <div style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:14 }}>📅 Publishing Schedule — 1 article every 2 days</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8 }}>
                    {arts.map((a, i) => {
                      const dt = a.scheduledAt ? parseSchedule(a.scheduledAt) : null;
                      const isPast = dt && dt < new Date();
                      const statusColors = { published:"#14b8a6", published_now:"#38bdf8", ready:"#22c55e", error:"#f87171", pending:C.muted2 };
                      const col = statusColors[a.status] || C.muted2;
                      const isLive = LIVE_STATUSES.includes(a.status);
                      return (
                        <div key={a.id} onClick={() => setSelectedArticle(a.id)} style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${isLive ? "rgba(20,184,166,0.3)" : C.border}`, borderRadius:10, padding:"10px 12px", cursor:"pointer", transition:"all 0.2s" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor=C.border2}
                          onMouseLeave={e => e.currentTarget.style.borderColor = isLive ? "rgba(20,184,166,0.3)" : C.border}>
                          <div style={{ fontSize:10, color:C.muted2, marginBottom:4 }}>Article {i+1}</div>
                          {dt && <div style={{ fontSize:12, fontWeight:600, color: isPast ? C.muted : C.text }}>{dt.toLocaleDateString([],{month:"short",day:"numeric"})}</div>}
                          {dt && <div style={{ fontSize:10, color:C.muted2 }}>{dt.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>}
                          <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:4 }}>
                            <span style={{ width:5, height:5, borderRadius:"50%", background:col }} />
                            <span style={{ fontSize:10, color:col }}>{a.status==="published"?"Scheduled":a.status==="published_now"?"Published":a.status}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                {arts.map((a, i) => {
                  const cat = CAT[a.category] || CAT["Destinations"];
                  return (
                    <div key={a.id} onClick={() => setSelectedArticle(a.id)}
                      style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"16px 18px", cursor:"pointer", transition:"all 0.2s", position:"relative", overflow:"hidden" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor=C.border2; e.currentTarget.style.transform="translateY(-1px)"; e.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,0.3)"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor=C.border; e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="none"; }}>
                      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:cat.grad }} />
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"start", marginBottom:10 }}>
                        <span style={{ fontSize:10, color:C.muted2, fontFamily:"'JetBrains Mono',monospace" }}>#{String(i+1).padStart(2,"0")}</span>
                        <StatusDot status={a.status} />
                      </div>
                      <h4 style={{ margin:"0 0 8px", fontSize:13, fontWeight:600, color:C.text, lineHeight:1.5 }}>{a.seoTitle || a.title}</h4>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:4 }}>
                        <span style={{ display:"inline-flex", alignItems:"center", gap:5, background:cat.grad, borderRadius:6, padding:"3px 8px" }}>
                          <span style={{ width:5, height:5, borderRadius:"50%", background:cat.dot }} />
                          <span style={{ fontSize:10, color:cat.text, fontWeight:500 }}>{a.category}</span>
                        </span>
                        <div style={{ display:"flex", gap:8 }}>
                          {(a.imageCount ?? a.images?.length ?? 0) > 0 && <span style={{ fontSize:10, color:"#c084fc" }}>🖼 {a.imageCount ?? a.images.length}</span>}
                          {a.faqCount > 0 && <span style={{ fontSize:10, color:"#38bdf8" }}>❓{a.faqCount}</span>}
                          {a.wordCount > 0 && <span style={{ fontSize:10, color: a.wordCount >= MIN_WORDS ? "#22c55e" : "#fbbf24", fontFamily:"'JetBrains Mono',monospace" }}>{a.wordCount}w</span>}
                        </div>
                      </div>
                      {a.scheduledAt && (
                        <div style={{ marginTop:8, fontSize:10, color:"#818cf8" }}>
                          📅 {parseSchedule(a.scheduledAt).toLocaleDateString()} {parseSchedule(a.scheduledAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── ARTICLE DETAIL ── */}
        {nav==="month" && viewArticle && (
          <div style={{ padding:32 }}>
            <button onClick={() => setSelectedArticle(null)} style={{ background:"none", border:"none", color:C.teal, fontSize:13, cursor:"pointer", padding:"0 0 16px", display:"flex", alignItems:"center", gap:4 }}>‹ {getMonthLabel(selectedMonth)}</button>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:28 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:20 }}>
                <div style={{ flex:1, paddingRight:20 }}>
                  <h1 style={{ margin:"0 0 8px", fontSize:22, fontWeight:800, color:C.text }}>{viewArticle.seoTitle || viewArticle.title}</h1>
                  <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                    {viewArticle.slug && <span style={{ fontSize:12, color:C.muted, fontFamily:"'JetBrains Mono',monospace" }}>/{viewArticle.slug}</span>}
                    {viewArticle.wordCount > 0 && <span style={{ fontSize:12, color: viewArticle.wordCount >= MIN_WORDS ? "#22c55e" : "#fbbf24" }}>{viewArticle.wordCount} words</span>}
                    {(viewArticle.imageCount ?? viewArticle.images?.length ?? 0) > 0 && <span style={{ fontSize:12, color:"#c084fc" }}>🖼 {viewArticle.imageCount ?? viewArticle.images.length} images</span>}
                    {viewArticle.faqCount > 0 && <span style={{ fontSize:12, color:"#38bdf8" }}>❓ {viewArticle.faqCount} FAQ</span>}
                    {viewArticle.scheduledAt && <span style={{ fontSize:12, color:"#818cf8" }}>📅 {parseSchedule(viewArticle.scheduledAt).toLocaleString()}</span>}
                  </div>
                </div>
                <StatusDot status={viewArticle.status} />
              </div>
              {viewArticle.metaDesc && (
                <div style={{ background:"#0a0f1a", padding:"12px 16px", borderRadius:10, marginBottom:20, border:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:10, color:C.teal, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" }}>Meta Description</span>
                  <p style={{ margin:"6px 0 0", fontSize:13, color:"#94a3b8", lineHeight:1.6 }}>{viewArticle.metaDesc}</p>
                </div>
              )}
              {viewArticle.content
                ? <div style={{ color:"#94a3b8", fontSize:14, lineHeight:1.9, maxWidth:760 }} dangerouslySetInnerHTML={{ __html:viewArticle.content }} />
                : <p style={{ color:C.muted2, fontStyle:"italic", fontSize:13 }}>Content not yet generated.</p>
              }
            </div>
          </div>
        )}

        {/* ── PAYMENTS ── */}
        {nav==="payments" && (
          <div style={{ padding:32 }}>
            <div style={{ marginBottom:28 }}>
              <h1 style={{ fontSize:26, fontWeight:800, color:C.text, letterSpacing:"-0.03em" }}>Payments</h1>
              <p style={{ fontSize:13, color:C.muted, marginTop:4 }}>Track billing per client and month</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:28 }}>
              <div style={{ background:"rgba(34,197,94,0.06)", border:"1px solid rgba(34,197,94,0.15)", borderRadius:16, padding:"20px 22px" }}>
                <div style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Total Revenue</div>
                <div style={{ fontSize:36, fontWeight:800, color:"#22c55e" }}>{config.currency||"Rs"} {totalRevenue.toLocaleString()}</div>
              </div>
              <div style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.15)", borderRadius:16, padding:"20px 22px" }}>
                <div style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Outstanding</div>
                <div style={{ fontSize:36, fontWeight:800, color:"#f87171" }}>{config.currency||"Rs"} {payments.filter(p => p.status==="unpaid").reduce((s,p) => s+(p.amount||0), 0).toLocaleString()}</div>
              </div>
              <div style={{ background:"rgba(129,140,248,0.06)", border:"1px solid rgba(129,140,248,0.15)", borderRadius:16, padding:"20px 22px" }}>
                <div style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Active Clients</div>
                <div style={{ fontSize:36, fontWeight:800, color:"#818cf8" }}>{clients.length}</div>
              </div>
            </div>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                    {["Month","Client","Site","Amount","Status","Paid Date","Action"].map(h => (
                      <th key={h} style={{ padding:"12px 16px", fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", textAlign:"left", fontWeight:600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.sort((a,b) => b.monthKey.localeCompare(a.monthKey)).map(p => {
                    const client = getClient(p.clientId || months[p.monthKey]?.clientId);
                    const site = getSite(months[p.monthKey]?.siteId);
                    return (
                      <tr key={p.monthKey} style={{ borderBottom:`1px solid ${C.border}`, transition:"background 0.15s" }}
                        onMouseEnter={e => e.currentTarget.style.background="#151e2e"}
                        onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                        <td style={{ padding:"14px 16px", fontSize:14, fontWeight:500 }}>{getMonthLabel(p.monthKey)}</td>
                        <td style={{ padding:"14px 16px", fontSize:12, color:"#d8b4fe" }}>{client?.name || "—"}</td>
                        <td style={{ padding:"14px 16px", fontSize:12, color:C.muted }}>{site?.name || "—"}</td>
                        <td style={{ padding:"14px 16px", fontSize:14, color:"#22c55e", fontFamily:"'JetBrains Mono',monospace" }}>{config.currency||"Rs"} {(p.amount||0).toLocaleString()}</td>
                        <td style={{ padding:"14px 16px" }}><PayBadge status={p.status} /></td>
                        <td style={{ padding:"14px 16px", fontSize:12, color:C.muted, fontFamily:"'JetBrains Mono',monospace" }}>{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : "—"}</td>
                        <td style={{ padding:"14px 16px" }}>
                          {p.status!=="paid" && <Btn onClick={() => markPaid(p.monthKey)} variant="success" small>Mark Paid</Btn>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {payments.length===0 && <div style={{ padding:40, textAlign:"center", color:C.muted, fontSize:13 }}>No payments yet.</div>}
            </div>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {nav==="settings" && (
          <div style={{ padding:32 }}>
            <div style={{ marginBottom:28, display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <h1 style={{ fontSize:26, fontWeight:800, color:C.text, letterSpacing:"-0.03em" }}>Settings</h1>
                <p style={{ fontSize:13, color:C.muted, marginTop:4 }}>Global API keys and configuration</p>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                {settingsSavedMsg && (
                  <span style={{ fontSize:13, color: settingsSavedMsg.startsWith("✓") ? "#86efac" : "#fca5a5" }}>
                    {settingsSavedMsg}
                  </span>
                )}
                <Btn onClick={saveSettings} disabled={settingsSaving}>
                  {settingsSaving ? "⏳ Saving…" : "💾 Save Settings"}
                </Btn>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24 }}>
                <h3 style={{ margin:"0 0 16px", fontSize:13, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>🤖 Grok AI (xAI)</h3>
                {/* A saved key is shown read-only — editing it in place would
                    produce a half-mask the server cannot resolve. */}
                {isMasked(config.grokKey) ? (
                  <div style={{ marginBottom:16 }}>
                    <label style={{ display:"block", fontSize:11, color:C.muted, marginBottom:6, fontWeight:500, letterSpacing:"0.05em", textTransform:"uppercase" }}>API Key</label>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <div style={{ flex:1, padding:"10px 14px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:10, color:C.muted, fontSize:13, fontFamily:"'JetBrains Mono',monospace" }}>{config.grokKey}</div>
                      <Btn small variant="ghost" onClick={() => setConfig(p=>({...p,grokKey:""}))}>Replace</Btn>
                    </div>
                    <p style={{ fontSize:11, color:C.muted2, marginTop:5, lineHeight:1.5 }}>✓ Stored on the server — never sent to the browser.</p>
                  </div>
                ) : (
                  <Field label="API Key" value={config.grokKey} onChange={v => setConfig(p=>({...p,grokKey:v}))} type="password" placeholder="xai-..." mono
                    hint="Saved to the database server-side; it is never included in the page. Get your key at console.x.ai" />
                )}
                <Select label="Model" value={config.grokModel || "grok-3-mini"} onChange={v => setConfig(p=>({...p,grokModel:v}))}
                  options={[
                    { value:"grok-3-mini",  label:"grok-3-mini  ← recommended (affordable, fast)" },
                    { value:"grok-3",       label:"grok-3  (highest quality, higher cost)" },
                  ]} />
              </div>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24 }}>
                <h3 style={{ margin:"0 0 6px", fontSize:13, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>📷 Unsplash API Keys</h3>
                <p style={{ fontSize:11, color:C.muted2, marginBottom:12, lineHeight:1.6 }}>Add up to 3 keys (50 req/hour each). The server rotates them when one hits its limit. Saved keys show as <code>••••••••</code> — overwrite a field to replace that key.</p>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
                  {(config.unsplashKeys||[]).map((k,i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color:C.muted, width:56, flexShrink:0 }}>Key {i+1}</span>
                      {/* Saved keys are read-only — remove and re-add to change one */}
                      {isMasked(k) ? (
                        <div style={{ flex:1, padding:"8px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:8, color:C.muted, fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>{k}</div>
                      ) : (
                        <input value={k} onChange={e => setConfig(p => { const keys=[...p.unsplashKeys]; keys[i]=e.target.value; return {...p,unsplashKeys:keys}; })}
                          style={{ flex:1, padding:"8px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:8, color:C.text, fontSize:11, fontFamily:"'JetBrains Mono',monospace", outline:"none" }}
                          onFocus={e=>e.target.style.borderColor=C.teal} onBlur={e=>e.target.style.borderColor=C.border2} />
                      )}
                      <button onClick={() => setConfig(p => ({...p, unsplashKeys: p.unsplashKeys.filter((_,j)=>j!==i)}))}
                        style={{ background:"none", border:"none", color:"#f87171", cursor:"pointer", fontSize:16, padding:"0 4px" }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <input value={newUnsplashKey} onChange={e=>setNewUnsplashKey(e.target.value)} placeholder="Paste new Access Key…"
                    style={{ flex:1, padding:"8px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:8, color:C.text, fontSize:11, fontFamily:"'JetBrains Mono',monospace", outline:"none" }}
                    onFocus={e=>e.target.style.borderColor=C.teal} onBlur={e=>e.target.style.borderColor=C.border2}
                    onKeyDown={e=>{ if(e.key==="Enter"&&newUnsplashKey.trim()){ setConfig(p=>({...p,unsplashKeys:[...p.unsplashKeys,newUnsplashKey.trim()]})); setNewUnsplashKey(""); }}} />
                  <Btn small onClick={()=>{ if(newUnsplashKey.trim()){ setConfig(p=>({...p,unsplashKeys:[...p.unsplashKeys,newUnsplashKey.trim()]})); setNewUnsplashKey(""); }}}>Add Key</Btn>
                </div>
                <p style={{ fontSize:11, color:C.muted2, marginTop:8 }}>{(config.unsplashKeys||[]).length} key(s) · ~{(config.unsplashKeys||[]).length * 50} req/hour total</p>
              </div>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24 }}>
                <h3 style={{ margin:"0 0 16px", fontSize:13, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>💰 Global Defaults</h3>
                <Field label="Currency Symbol" value={config.currency||"Rs"} onChange={v => setConfig(p=>({...p,currency:v}))} placeholder="Rs" hint="e.g. Rs · $ · £ · €" />
                <Field label={`Price per Month (${cur})`} value={config.pricePerMonth} onChange={v => setConfig(p=>({...p,pricePerMonth:parseFloat(v)||0}))} type="number" hint="Used for clients with no price of their own" />
                <Field label="Default Niche" value={config.niche||""} onChange={v => setConfig(p=>({...p,niche:v}))} placeholder="Sri Lanka tours and travel"
                  hint="Fallback for clients with no niche set — shapes AI prompts and image searches." />
                <Field label="Default Brand Name" value={config.brandName||""} onChange={v => setConfig(p=>({...p,brandName:v}))} placeholder="(none)"
                  hint="Only used for months with no client and no site. Leave blank and articles are written with no brand at all." />
                <Field label="Default Brand Website" value={config.brandWebsite||""} onChange={v => setConfig(p=>({...p,brandWebsite:v}))} placeholder="(none)" mono />
              </div>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24, gridColumn:"1 / -1" }}>
                <h3 style={{ margin:"0 0 6px", fontSize:13, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>🎯 Fallback Target Keywords</h3>
                <p style={{ fontSize:12, color:C.muted2, marginBottom:14, lineHeight:1.6 }}>
                  Used only for clients that have no keywords of their own. 2–3 are picked at random per article and woven into the content by Grok.
                  Manage per-client keywords in <strong style={{ color:C.muted }}>Clients → 🎯 Profile</strong>.
                </p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:14 }}>
                  {targetKeywords.map((kw, i) => (
                    <span key={i} style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(20,184,166,0.08)", border:`1px solid rgba(20,184,166,0.25)`, borderRadius:8, padding:"5px 10px", fontSize:12, color:C.teal }}>
                      {kw}
                      <button onClick={() => setTargetKeywords(p => p.filter((_,j) => j!==i))}
                        style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:14, lineHeight:1, padding:0 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
                    onKeyDown={e => { if (e.key==="Enter" && newKeyword.trim()) { setTargetKeywords(p => [...p, newKeyword.trim()]); setNewKeyword(""); }}}
                    placeholder="Add a keyword and press Enter…"
                    style={{ flex:1, padding:"9px 14px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:9, color:C.text, fontSize:12, outline:"none" }}
                    onFocus={e => e.target.style.borderColor=C.teal} onBlur={e => e.target.style.borderColor=C.border2} />
                  <Btn onClick={() => { if (newKeyword.trim()) { setTargetKeywords(p => [...p, newKeyword.trim()]); setNewKeyword(""); }}} small>Add</Btn>
                </div>
              </div>

              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24, gridColumn:"1 / -1" }}>
                <h3 style={{ margin:"0 0 6px", fontSize:13, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>💾 Data Backup</h3>
                <p style={{ fontSize:12, color:C.muted2, marginBottom:16, lineHeight:1.6 }}>
                  All data is stored in <strong style={{ color:C.muted }}>PostgreSQL</strong> on your VPS — safe across browser clears and redeployments.
                  Export a JSON backup as an extra safety net.
                  <br />
                  <strong style={{ color:"#fde68a" }}>Note:</strong> API keys and WordPress passwords are held server-side and appear in the export only as <code>••••••••</code> placeholders.
                  Importing into a fresh database will need those re-entered.
                </p>
                <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                  <Btn onClick={exportData}>↓ Export Backup</Btn>
                  <label style={{ padding:"10px 20px", borderRadius:10, fontWeight:600, fontSize:13, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.04)", color:C.muted, cursor:"pointer", transition:"all 0.15s" }}>
                    ↑ Import Backup
                    <input type="file" accept=".json" onChange={importData} style={{ display:"none" }} />
                  </label>
                </div>
              </div>
              <div style={{ background:C.card, border:"1px solid rgba(239,68,68,0.15)", borderRadius:14, padding:24 }}>
                <h3 style={{ margin:"0 0 10px", fontSize:13, color:"#f87171", fontWeight:600 }}>Danger Zone</h3>
                <Btn onClick={() => { if (confirm("Delete ALL data? This cannot be undone.")) { setMonths({}); setPayments([]); setSites([]); setClients([]); setLogs([]); fetch("/api/state",{method:"POST",headers:{"Content-Type":"application/json",...authHeader()},body:"{}"}); } }} variant="danger">Reset All Data</Btn>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── ADD/EDIT SITE MODAL ── */}
      {showSiteModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999 }} onClick={() => setShowSiteModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#0f1623", border:`1px solid ${C.border2}`, borderRadius:18, padding:28, width:440, boxShadow:"0 24px 64px rgba(0,0,0,0.6)", maxHeight:"90vh", overflowY:"auto" }}>
            <h3 style={{ margin:"0 0 6px", fontSize:18, fontWeight:800, color:C.text }}>{editingSiteId ? "Edit Site" : "Add WordPress Site"}</h3>
            <p style={{ fontSize:12, color:C.muted, marginBottom:22 }}>Connect via WordPress Application Password — the official WP REST API authentication method.</p>
            <Field label="Site Name" value={siteForm.name} onChange={v => setSiteForm(p=>({...p,name:v}))} placeholder="e.g. Wonders of Lanka" />
            <Field label="WordPress URL" value={siteForm.url} onChange={v => setSiteForm(p=>({...p,url:v}))} placeholder="https://wondersoflanka.com" mono hint="No trailing slash — root domain of your WP site" />
            <Field label="WordPress Username" value={siteForm.user} onChange={v => setSiteForm(p=>({...p,user:v}))} placeholder="admin" />
            {/* A saved password stays on the server; show it read-only so it
                cannot be half-edited into an unresolvable value. */}
            {isMasked(siteForm.appPass) ? (
              <div style={{ marginBottom:16 }}>
                <label style={{ display:"block", fontSize:11, color:C.muted, marginBottom:6, fontWeight:500, letterSpacing:"0.05em", textTransform:"uppercase" }}>Application Password</label>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <div style={{ flex:1, padding:"10px 14px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:10, color:C.muted, fontSize:13, fontFamily:"'JetBrains Mono',monospace" }}>{siteForm.appPass}</div>
                  <Btn small variant="ghost" onClick={() => setSiteForm(p=>({...p,appPass:""}))}>Replace</Btn>
                </div>
                <p style={{ fontSize:11, color:C.muted2, marginTop:5, lineHeight:1.5 }}>✓ Stored on the server — never sent to the browser.</p>
              </div>
            ) : (
              <Field label="Application Password" value={siteForm.appPass} onChange={v => setSiteForm(p=>({...p,appPass:v}))} type="password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" mono hint="WP Admin → Users → Profile → Application Passwords → Add New" />
            )}
            <Select label="Link to Client (optional)" value={siteForm.clientId} onChange={v => setSiteForm(p=>({...p,clientId:v}))}
              options={[{ value:"", label:"— No client —" }, ...clients.map(c => ({ value:c.id, label:c.name }))]} />

            {/* Test connection */}
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20, padding:"12px 16px", background:"rgba(255,255,255,0.03)", borderRadius:10, border:`1px solid ${C.border}` }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, fontWeight:600, color:C.text, marginBottom:4 }}>API Connection Test</div>
                <ConnBadge status={siteConnStatus} />
                {siteConnMsg && <div style={{ fontSize:11, color: siteConnStatus==="connected" ? "#22c55e" : "#f87171", marginTop:4 }}>{siteConnMsg}</div>}
              </div>
              <Btn onClick={testConnection} variant="ghost" small disabled={siteConnStatus==="testing"}>
                {siteConnStatus==="testing" ? "Testing…" : "Test Connection"}
              </Btn>
            </div>

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <Btn onClick={() => setShowSiteModal(false)} variant="ghost">Cancel</Btn>
              <Btn onClick={saveSite} disabled={!siteForm.name || !siteForm.url}>{editingSiteId ? "Save Changes" : "Add Site"}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD/EDIT CLIENT MODAL ── */}
      {showClientModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999 }} onClick={() => setShowClientModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#0f1623", border:`1px solid ${C.border2}`, borderRadius:18, padding:28, width:420, boxShadow:"0 24px 64px rgba(0,0,0,0.6)" }}>
            <h3 style={{ margin:"0 0 6px", fontSize:18, fontWeight:800, color:C.text }}>{editingClientId ? "Edit Client" : "Add Client"}</h3>
            <p style={{ fontSize:12, color:C.muted, marginBottom:22 }}>Client details for billing and site management.</p>
            <Field label="Client Name *" value={clientForm.name} onChange={v => setClientForm(p=>({...p,name:v}))} placeholder="Company or person name" />
            <Field label="Email" value={clientForm.email} onChange={v => setClientForm(p=>({...p,email:v}))} type="email" placeholder="client@example.com" />
            <Field label="Phone" value={clientForm.phone} onChange={v => setClientForm(p=>({...p,phone:v}))} placeholder="+1 234 567 8900" />
            <Field label="Website" value={clientForm.website} onChange={v => setClientForm(p=>({...p,website:v}))} placeholder="https://client.com" mono />
            <Field label="Niche" value={clientForm.niche} onChange={v => setClientForm(p=>({...p,niche:v}))}
              placeholder="e.g. Sri Lanka tours and travel"
              hint="What this client's business is about — drives every AI prompt and image search. Blank uses the global default." />
            <Field label={`Price per Month (${cur}) — optional`} value={clientForm.pricePerMonth} onChange={v => setClientForm(p=>({...p,pricePerMonth:v}))} type="number"
              placeholder={String(config.pricePerMonth ?? 0)}
              hint="Leave blank to bill this client at the global default." />
            <div style={{ marginBottom:16 }}>
              <label style={{ display:"block", fontSize:11, color:C.muted, marginBottom:6, fontWeight:500, letterSpacing:"0.05em", textTransform:"uppercase" }}>Notes</label>
              <textarea value={clientForm.notes} onChange={e => setClientForm(p=>({...p,notes:e.target.value}))} placeholder="Any notes about this client…" rows={3}
                style={{ width:"100%", padding:"10px 14px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:10, color:C.text, fontSize:13, outline:"none", resize:"vertical", boxSizing:"border-box" }}
                onFocus={e=>{ e.target.style.borderColor=C.teal; }}
                onBlur={e=>{ e.target.style.borderColor=C.border2; }} />
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <Btn onClick={() => setShowClientModal(false)} variant="ghost">Cancel</Btn>
              <Btn onClick={saveClient} disabled={!clientForm.name}>{editingClientId ? "Save Changes" : "Add Client"}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── CONTENT PROFILE MODAL (keywords + topic bank) ── */}
      {profileClientId && (() => {
        const pc = clients.find(c => c.id === profileClientId);
        if (!pc) return null;
        const kws = pc.keywords || [];
        const tps = pc.topics || [];
        const term = kwSearch.trim().toLowerCase();
        const shown = term ? kws.filter(k => k.toLowerCase().includes(term)) : kws;
        const inputStyle = { width:"100%", padding:"9px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:9, color:C.text, fontSize:12, outline:"none", boxSizing:"border-box" };
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999 }} onClick={() => setProfileClientId(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background:"#0d1117", border:`1px solid ${C.border2}`, borderRadius:20, width:"min(860px,95vw)", maxHeight:"90vh", display:"flex", flexDirection:"column", boxShadow:"0 32px 80px rgba(0,0,0,0.7)", overflow:"hidden" }}>

              {/* Header */}
              <div style={{ padding:"20px 24px 0", flexShrink:0 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <h3 style={{ margin:0, fontSize:18, fontWeight:800, color:C.text }}>🎯 Content Profile — {pc.name}</h3>
                    <p style={{ margin:"4px 0 0", fontSize:12, color:C.muted }}>
                      Keywords are woven into every article for this client; topics are the pool months draw from.
                      {pc.niche ? ` Niche: ${pc.niche}` : " No niche set — edit the client to add one."}
                    </p>
                  </div>
                  <button onClick={() => setProfileClientId(null)} style={{ background:"none", border:"none", color:C.muted, fontSize:20, cursor:"pointer", lineHeight:1 }}>×</button>
                </div>
                <div style={{ display:"flex", gap:4, marginTop:16, borderBottom:`1px solid ${C.border}` }}>
                  {[["keywords",`Keywords (${kws.length})`],["topics",`Topics (${tps.length})`]].map(([id,label]) => (
                    <button key={id} onClick={() => setProfileTab(id)}
                      style={{ padding:"8px 16px", border:"none", borderBottom:`2px solid ${profileTab===id ? C.teal : "transparent"}`, background:"transparent", color: profileTab===id ? C.teal : C.muted, fontSize:12, fontWeight:600, cursor:"pointer" }}
                    >{label}</button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div style={{ flex:1, overflowY:"auto", padding:"20px 24px 24px", minHeight:0 }}>

                {profileTab === "keywords" ? (
                  <>
                    <div style={{ marginBottom:16 }}>
                      <label style={{ display:"block", fontSize:11, color:C.muted, marginBottom:6, fontWeight:600, letterSpacing:"0.05em", textTransform:"uppercase" }}>Add keywords in bulk</label>
                      <textarea value={kwBulk} onChange={e => setKwBulk(e.target.value)} rows={4}
                        placeholder={"Paste one per line, or comma-separated:\nSri Lanka tour guide and driver\nHoneymoon tours Sri Lanka, Culture tours Sri Lanka"}
                        style={{ ...inputStyle, resize:"vertical", fontFamily:"'JetBrains Mono',monospace", lineHeight:1.6 }}
                        onFocus={e => e.target.style.borderColor=C.teal} onBlur={e => e.target.style.borderColor=C.border2} />
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
                        <span style={{ fontSize:11, color:C.muted2 }}>Duplicates are skipped automatically (case-insensitive).</span>
                        <Btn small onClick={() => addKeywords(pc.id, kwBulk)} disabled={!kwBulk.trim()}>+ Add {parseKeywordList(kwBulk).length || ""} Keyword(s)</Btn>
                      </div>
                    </div>

                    <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:12 }}>
                      <input value={kwSearch} onChange={e => setKwSearch(e.target.value)} placeholder="Filter keywords…"
                        style={{ ...inputStyle, flex:1 }}
                        onFocus={e => e.target.style.borderColor=C.teal} onBlur={e => e.target.style.borderColor=C.border2} />
                      <span style={{ fontSize:11, color:C.muted, whiteSpace:"nowrap" }}>{shown.length} of {kws.length}</span>
                      {kws.length > 0 && (
                        <Btn small variant="danger" onClick={() => { if (confirm(`Remove all ${kws.length} keywords from ${pc.name}?`)) updateClient(pc.id, { keywords: [] }); }}>Clear all</Btn>
                      )}
                    </div>

                    {kws.length === 0 ? (
                      <div style={{ background:"rgba(251,191,36,0.06)", border:"1px solid rgba(251,191,36,0.25)", borderRadius:10, padding:"14px 16px", fontSize:12, color:"#fde68a", lineHeight:1.6 }}>
                        No keywords yet — this client falls back to the {targetKeywords.length} global keyword(s) from Settings.
                      </div>
                    ) : shown.length === 0 ? (
                      <div style={{ fontSize:12, color:C.muted2, padding:"14px 0" }}>No keywords match "{kwSearch}".</div>
                    ) : (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                        {shown.map(kw => (
                          <span key={kw} style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(20,184,166,0.08)", border:"1px solid rgba(20,184,166,0.25)", borderRadius:8, padding:"6px 10px", fontSize:12, color:C.teal }}>
                            {kw}
                            <button onClick={() => removeKeyword(pc.id, kw)} title="Remove"
                              style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:14, lineHeight:1, padding:0 }}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom:18 }}>
                      <label style={{ display:"block", fontSize:11, color:C.muted, marginBottom:6, fontWeight:600, letterSpacing:"0.05em", textTransform:"uppercase" }}>Add a topic</label>
                      <div style={{ display:"grid", gridTemplateColumns:"2fr 2fr 1.2fr auto", gap:8, alignItems:"center" }}>
                        <input value={topicForm.title} onChange={e => setTopicForm(p=>({...p,title:e.target.value}))} placeholder="Article title"
                          style={inputStyle} onFocus={e => e.target.style.borderColor=C.teal} onBlur={e => e.target.style.borderColor=C.border2} />
                        <input value={topicForm.keywords} onChange={e => setTopicForm(p=>({...p,keywords:e.target.value}))} placeholder="Topic keywords"
                          style={inputStyle} onFocus={e => e.target.style.borderColor=C.teal} onBlur={e => e.target.style.borderColor=C.border2} />
                        <select value={topicForm.category} onChange={e => setTopicForm(p=>({...p,category:e.target.value}))}
                          style={{ ...inputStyle, cursor:"pointer" }}>
                          {Object.keys(CAT).map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                        <Btn small onClick={() => addTopic(pc.id, topicForm)} disabled={!topicForm.title.trim()}>+ Add</Btn>
                      </div>
                    </div>

                    <div style={{ marginBottom:18 }}>
                      <label style={{ display:"block", fontSize:11, color:C.muted, marginBottom:6, fontWeight:600, letterSpacing:"0.05em", textTransform:"uppercase" }}>Add topics in bulk</label>
                      <textarea value={topicBulk} onChange={e => setTopicBulk(e.target.value)} rows={4}
                        placeholder={"One per line — Title | keywords | Category\nTop 10 Beaches in Bali | Bali beaches, Seminyak | Destinations\nBali Food Guide | Balinese cuisine | Food & Culture"}
                        style={{ ...inputStyle, resize:"vertical", fontFamily:"'JetBrains Mono',monospace", lineHeight:1.6 }}
                        onFocus={e => e.target.style.borderColor=C.teal} onBlur={e => e.target.style.borderColor=C.border2} />
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
                        <span style={{ fontSize:11, color:C.muted2 }}>Keywords and category are optional; unknown categories become "Destinations".</span>
                        <Btn small onClick={() => addTopicsBulk(pc.id, topicBulk)} disabled={!topicBulk.trim()}>+ Add Topics</Btn>
                      </div>
                    </div>

                    {tps.length === 0 ? (
                      <div style={{ background:"rgba(251,191,36,0.06)", border:"1px solid rgba(251,191,36,0.25)", borderRadius:10, padding:"14px 16px", fontSize:12, color:"#fde68a", lineHeight:1.6 }}>
                        No topics yet — new months for this client draw from the {TOPIC_BANK.length} built-in Sri Lanka topics. Add topics here to make months client-specific.
                      </div>
                    ) : (
                      <>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                          <span style={{ fontSize:11, color:C.muted }}>
                            {tps.length} topic(s) · a month draws 10 at random{tps.length < 10 ? ` — only ${tps.length} available, so months will have ${tps.length} articles` : ""}
                          </span>
                          <Btn small variant="danger" onClick={() => { if (confirm(`Remove all ${tps.length} topics from ${pc.name}?`)) updateClient(pc.id, { topics: [] }); }}>Clear all</Btn>
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                          {tps.map((t, i) => {
                            const cs = CAT[t.category] || CAT["Destinations"];
                            return (
                              <div key={`${t.title}-${i}`} style={{ display:"flex", alignItems:"center", gap:10, background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:9, padding:"9px 12px" }}>
                                <span style={{ fontSize:10, color:C.muted2, fontFamily:"'JetBrains Mono',monospace", width:24, flexShrink:0 }}>{String(i+1).padStart(2,"0")}</span>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontSize:12, fontWeight:600, color:C.text }}>{t.title}</div>
                                  {t.keywords && <div style={{ fontSize:11, color:C.muted2, marginTop:2 }}>{t.keywords}</div>}
                                </div>
                                <span style={{ fontSize:10, color:cs.text, background:cs.grad, padding:"3px 9px", borderRadius:6, flexShrink:0 }}>{t.category}</span>
                                <button onClick={() => removeTopic(pc.id, i)} title="Remove"
                                  style={{ background:"none", border:"none", color:"#f87171", cursor:"pointer", fontSize:15, lineHeight:1, padding:"0 2px" }}>×</button>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              <div style={{ padding:"14px 24px", borderTop:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
                <span style={{ fontSize:11, color:C.muted2 }}>Changes save automatically.</span>
                <Btn onClick={() => setProfileClientId(null)}>Done</Btn>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── TEST ARTICLE MODAL ── */}
      {showTestModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999 }} onClick={() => !testRunning && setShowTestModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#0d1117", border:`1px solid ${C.border2}`, borderRadius:20, width:"min(900px,95vw)", maxHeight:"92vh", display:"flex", flexDirection:"column", boxShadow:"0 32px 80px rgba(0,0,0,0.7)", overflow:"hidden" }}>

            {/* Header */}
            <div style={{ padding:"20px 24px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div>
                <h3 style={{ margin:0, fontSize:18, fontWeight:800, color:C.text }}>⚗ Test Article Generator</h3>
                <p style={{ margin:"4px 0 0", fontSize:12, color:C.muted }}>Generate a single article preview — no WordPress, no month setup required</p>
              </div>
              {!testRunning && <button onClick={() => setShowTestModal(false)} style={{ background:"none", border:"none", color:C.muted, fontSize:20, cursor:"pointer", lineHeight:1 }}>×</button>}
            </div>

            <div style={{ display:"flex", flex:1, minHeight:0 }}>
              {/* Left panel — config */}
              <div style={{ width:280, borderRight:`1px solid ${C.border}`, padding:20, overflowY:"auto", flexShrink:0 }}>
                {/* Client — decides brand, niche, keywords and topic bank */}
                <div style={{ marginBottom:16 }}>
                  <label style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", display:"block", marginBottom:8 }}>Client Profile</label>
                  <select value={testClientId} onChange={e => { setTestClientId(e.target.value); setTestTopicIdx(0); }}
                    style={{ width:"100%", padding:"9px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:9, color:C.text, fontSize:12, outline:"none" }}>
                    <option value="">— Global defaults —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {(() => {
                    const p = profileForClient(getClient(testClientId), null);
                    return (
                      <div style={{ marginTop:8, padding:"8px 10px", background:"rgba(20,184,166,0.06)", border:"1px solid rgba(20,184,166,0.18)", borderRadius:8, fontSize:11, color:C.muted, lineHeight:1.6 }}>
                        <div>{p.name} · {p.website}</div>
                        <div style={{ color:C.muted2 }}>{p.keywords.length} keyword(s) · {testBank.length} topic(s)</div>
                      </div>
                    );
                  })()}
                </div>

                {/* Topic source toggle */}
                <div style={{ marginBottom:16 }}>
                  <label style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", display:"block", marginBottom:8 }}>Topic Source</label>
                  <div style={{ display:"flex", gap:6 }}>
                    {[["preset","Preset"],["custom","Custom"]].map(([v,l]) => (
                      <button key={v} onClick={() => setTestUseCustom(v==="custom")}
                        style={{ flex:1, padding:"7px 0", borderRadius:8, border:`1px solid ${testUseCustom===(v==="custom") ? C.teal : C.border2}`, background: testUseCustom===(v==="custom") ? "rgba(20,184,166,0.1)" : "transparent", color: testUseCustom===(v==="custom") ? C.teal : C.muted, fontSize:12, fontWeight:600, cursor:"pointer" }}
                      >{l}</button>
                    ))}
                  </div>
                </div>

                {!testUseCustom ? (
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", display:"block", marginBottom:8 }}>Select Topic</label>
                    <select value={Math.min(testTopicIdx, testBank.length - 1)} onChange={e => setTestTopicIdx(Number(e.target.value))}
                      style={{ width:"100%", padding:"9px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:9, color:C.text, fontSize:12, outline:"none" }}>
                      {testBank.map((t, i) => <option key={i} value={i}>{t.title}</option>)}
                    </select>
                    {testTopic && (
                      <div style={{ marginTop:8, padding:"8px 10px", background:"rgba(255,255,255,0.03)", borderRadius:8, fontSize:11, color:C.muted }}>
                        <div style={{ marginBottom:3 }}><span style={{ color:C.muted2 }}>Keywords:</span> {testTopic.keywords}</div>
                        <div><span style={{ color:C.muted2 }}>Category:</span> {testTopic.category}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ marginBottom:12 }}>
                      <label style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", display:"block", marginBottom:6 }}>Article Title</label>
                      <input value={testCustomTitle} onChange={e => setTestCustomTitle(e.target.value)} placeholder="e.g. Best Beaches in Sri Lanka"
                        style={{ width:"100%", padding:"9px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:9, color:C.text, fontSize:12, outline:"none", boxSizing:"border-box" }}
                        onFocus={e => e.target.style.borderColor=C.teal} onBlur={e => e.target.style.borderColor=C.border2} />
                    </div>
                    <div style={{ marginBottom:12 }}>
                      <label style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", display:"block", marginBottom:6 }}>Keywords</label>
                      <input value={testCustomKeywords} onChange={e => setTestCustomKeywords(e.target.value)} placeholder="e.g. Sri Lanka beaches, Mirissa"
                        style={{ width:"100%", padding:"9px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:9, color:C.text, fontSize:12, outline:"none", boxSizing:"border-box" }}
                        onFocus={e => e.target.style.borderColor=C.teal} onBlur={e => e.target.style.borderColor=C.border2} />
                    </div>
                    <div style={{ marginBottom:12 }}>
                      <label style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", display:"block", marginBottom:6 }}>Category</label>
                      <select value={testCustomCategory} onChange={e => setTestCustomCategory(e.target.value)}
                        style={{ width:"100%", padding:"9px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:9, color:C.text, fontSize:12, outline:"none" }}>
                        {Object.keys(CAT).map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                <div style={{ marginBottom:16 }}>
                  <button onClick={runTestArticle} disabled={testRunning}
                    style={{ width:"100%", padding:"10px 0", borderRadius:10, fontWeight:700, fontSize:13, border:"none", cursor:testRunning?"not-allowed":"pointer", background:testRunning?"rgba(255,255,255,0.04)":"linear-gradient(135deg,#0d9488,#14b8a6)", color:testRunning?C.muted:"#021a17", boxShadow:testRunning?"none":"0 4px 16px rgba(20,184,166,0.3)", transition:"all 0.15s" }}>
                    {testRunning ? "Generating…" : "Generate Article"}
                  </button>
                </div>

                {/* Live log */}
                {testLogs.length > 0 && (
                  <div style={{ background:"#060a10", borderRadius:9, padding:10, maxHeight:200, overflowY:"auto", border:`1px solid ${C.border}` }}>
                    {testLogs.map((l, i) => (
                      <div key={i} style={{ fontSize:10, fontFamily:"'JetBrains Mono',monospace", lineHeight:1.8 }}>
                        <span style={{ color:"#2d3f5a" }}>{l.ts} </span>
                        <span style={{ color: l.type==="error"?"#f87171":l.type==="success"?"#4ade80":l.type==="warn"?"#fbbf24":"#94a3b8" }}>{l.msg}</span>
                      </div>
                    ))}
                    <div ref={testLogEndRef} />
                  </div>
                )}
              </div>

              {/* Right panel — result */}
              <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
                {!testResult ? (
                  <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:C.muted, gap:12 }}>
                    {testRunning ? (
                      <>
                        <span style={{ width:32, height:32, border:`3px solid ${C.border2}`, borderTopColor:C.teal, borderRadius:"50%", display:"block", animation:"spin 0.9s linear infinite" }} />
                        <span style={{ fontSize:13 }}>Generating article…</span>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize:40, opacity:0.2 }}>📄</span>
                        <span style={{ fontSize:13 }}>Select a topic and click Generate</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0 }}>
                    {/* Result header */}
                    <div style={{ padding:"14px 20px", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                        <div style={{ flex:1, minWidth:0, marginRight:12 }}>
                          <div style={{ fontSize:15, fontWeight:700, color:C.text, lineHeight:1.4, marginBottom:4 }}>{testResult.seoTitle}</div>
                          <div style={{ fontSize:11, color:C.muted, fontFamily:"'JetBrains Mono',monospace" }}>/{testResult.slug}</div>
                        </div>
                        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                          {(() => {
                            const ok = testResult.wordCount >= MIN_WORDS;
                            const col = ok ? "#22c55e" : "#fbbf24";
                            const chip = { fontSize:11, color:col, background:`${col}1a`, border:`1px solid ${col}33`, padding:"3px 10px", borderRadius:6, fontFamily:"monospace" };
                            const r = testResult.report;
                            return <>
                              <span style={chip} title={ok ? "Meets the 2000 word target" : `Under the ${MIN_WORDS} word target`}>{testResult.wordCount} words</span>
                              {r && <span style={{ ...chip, color:"#c084fc", background:"#c084fc1a", border:"1px solid #c084fc33" }}>🖼 {r.images}</span>}
                              {r && <span style={{ ...chip, color:"#38bdf8", background:"#38bdf81a", border:"1px solid #38bdf833" }}>❓ {r.faq} FAQ</span>}
                              {r && <span style={{ ...chip, color:C.muted, background:"transparent", border:`1px solid ${C.border2}` }}>{r.bold} bold</span>}
                            </>;
                          })()}
                          {testResult.category && (() => { const cs = CAT[testResult.category]; return cs ? <span style={{ fontSize:11, color:cs.text, background:cs.grad, padding:"3px 10px", borderRadius:6 }}>{testResult.category}</span> : null; })()}
                        </div>
                      </div>
                      <div style={{ fontSize:11, color:C.muted2, lineHeight:1.5, marginBottom:8 }}>
                        <span style={{ color:C.muted, fontWeight:600 }}>Meta: </span>{testResult.metaDesc}
                      </div>
                      {/* Tab bar */}
                      <div style={{ display:"flex", gap:4 }}>
                        {[["preview","Preview"],["html","HTML"]].map(([id,label]) => (
                          <button key={id} onClick={() => setTestTab(id)}
                            style={{ padding:"5px 14px", borderRadius:7, border:`1px solid ${testTab===id ? C.teal : C.border}`, background: testTab===id ? "rgba(20,184,166,0.1)" : "transparent", color: testTab===id ? C.teal : C.muted, fontSize:11, fontWeight:600, cursor:"pointer" }}
                          >{label}</button>
                        ))}
                        <div style={{ flex:1 }} />
                        <button onClick={() => navigator.clipboard.writeText(testResult.content)}
                          style={{ padding:"5px 14px", borderRadius:7, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, fontSize:11, cursor:"pointer" }}>
                          Copy HTML
                        </button>
                      </div>
                    </div>

                    {/* Tab content */}
                    <div style={{ flex:1, overflowY:"auto", padding:"0" }}>
                      {testTab==="preview" ? (
                        <div style={{ padding:"24px 28px", lineHeight:1.8 }}
                          dangerouslySetInnerHTML={{ __html: `<style>
                            .test-preview h1{font-size:28px;font-weight:800;color:#e2e8f0;margin:0 0 24px;line-height:1.3}
                            .test-preview h2{font-size:20px;font-weight:700;color:#e2e8f0;margin:32px 0 14px;border-bottom:1px solid #1a2234;padding-bottom:10px}
                            .test-preview h3{font-size:16px;font-weight:600;color:#cbd5e1;margin:22px 0 10px}
                            .test-preview p{color:#94a3b8;margin:0 0 14px;font-size:14px}
                            .test-preview ul,.test-preview ol{color:#94a3b8;padding-left:20px;margin:0 0 14px}
                            .test-preview li{margin-bottom:6px;font-size:14px}
                            .test-preview strong{color:#cbd5e1}
                            .test-preview figure{margin:28px 0}
                            .test-preview figure img{width:100%;max-height:420px;object-fit:cover;border-radius:12px}
                            .test-preview figure figcaption{text-align:center;font-size:12px;color:#475569;margin-top:8px}
                          </style><div class="test-preview">${testResult.content}</div>` }}
                        />
                      ) : (
                        <pre style={{ padding:"20px 24px", fontSize:11, color:"#94a3b8", fontFamily:"'JetBrains Mono',monospace", lineHeight:1.7, whiteSpace:"pre-wrap", wordBreak:"break-all", margin:0 }}>
                          {testResult.content}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── NEW MONTH MODAL ── */}
      {showNewMonth && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999 }} onClick={() => setShowNewMonth(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#0f1623", border:`1px solid ${C.border2}`, borderRadius:18, padding:28, width:440, boxShadow:"0 24px 64px rgba(0,0,0,0.6)", maxHeight:"90vh", overflowY:"auto" }}>
            <h3 style={{ margin:"0 0 6px", fontSize:18, fontWeight:800, color:C.text }}>Create New Month</h3>
            <p style={{ fontSize:12, color:C.muted, marginBottom:22 }}>{nmCount} article{nmCount===1?"":"s"} will be assigned and scheduled 1 per day with a gap day between each (every 2 days).</p>

            <Field label="Month (YYYY-MM)" value={nmDate} onChange={setNmDate} placeholder="2026-05" mono />
            <Select label="Article Language" value={nmLanguage} onChange={setNmLanguage}
              options={[
                { value:"en", label:"🇬🇧 English" },
                { value:"it", label:"🇮🇹 Italian" },
                { value:"de", label:"🇩🇪 German" },
                { value:"fr", label:"🇫🇷 French" },
                { value:"es", label:"🇪🇸 Spanish" },
              ]} />
            <Select label="Client" value={nmClientId} onChange={v => { setNmClientId(v); setNmSiteId(""); setNmError(""); }}
              options={[{ value:"", label:"— No client —" }, ...clients.map(c => ({ value:c.id, label:c.name }))]} />

            {/* Several clients can share a calendar month; the same client twice cannot */}
            {nmPeriodOwners.length > 0 && (
              <div style={{ marginTop:-8, marginBottom:16, fontSize:11, color: nmDuplicate ? "#fca5a5" : C.muted, lineHeight:1.6 }}>
                {nmDuplicate
                  ? `${getClient(nmClientId)?.name} already has ${getMonthLabel(nmDate)} — open it from the Months page instead.`
                  : `${getMonthLabel(nmDate)} already exists for ${nmPeriodOwners.join(", ")}. Creating another for a different client is fine.`}
              </div>
            )}

            {/* Topic source */}
            <div style={{ marginBottom:16 }}>
              <label style={{ display:"block", fontSize:11, color:C.muted, marginBottom:6, fontWeight:500, letterSpacing:"0.05em", textTransform:"uppercase" }}>Topics</label>
              <div style={{ display:"flex", gap:6 }}>
                {[["ai","✦ Fresh AI topics"],["bank","📚 Topic bank"]].map(([v,l]) => (
                  <button key={v} onClick={() => { setNmTopicSource(v); setNmError(""); }}
                    style={{ flex:1, padding:"8px 0", borderRadius:9, border:`1px solid ${nmTopicSource===v ? C.teal : C.border2}`, background: nmTopicSource===v ? "rgba(20,184,166,0.1)" : "transparent", color: nmTopicSource===v ? C.teal : C.muted, fontSize:12, fontWeight:600, cursor:"pointer" }}
                  >{l}</button>
                ))}
              </div>
              <div style={{ background: nmTopicSource==="ai" ? "rgba(20,184,166,0.06)" : nmUsesClientTopics ? "rgba(20,184,166,0.06)" : "rgba(251,191,36,0.06)", border:`1px solid ${nmTopicSource==="ai" || nmUsesClientTopics ? "rgba(20,184,166,0.2)" : "rgba(251,191,36,0.25)"}`, borderRadius:10, padding:"10px 14px", marginTop:8, fontSize:11, lineHeight:1.6, color: nmTopicSource==="ai" || nmUsesClientTopics ? C.teal : "#fde68a" }}>
                {nmTopicSource === "ai"
                  ? `Grok will generate 10 fresh topics for ${getMonthLabel(nmDate)}, skipping the ${usedTitlesFor(nmClientId).length} title(s) this client already has — so no two months repeat.`
                  : nmUsesClientTopics
                    ? `Drawing from this client's own topic bank (${nmBank.length} topics).`
                    : `No client topic bank — using the ${nmBank.length} built-in topics. These repeat across months; switch to Fresh AI topics to avoid that.`}
              </div>
            </div>

            <Select label="WordPress Site" value={nmSiteId} onChange={setNmSiteId}
              options={[
                { value:"", label:"— No site (generate only) —" },
                ...sites.filter(s => !nmClientId || s.clientId===nmClientId || !s.clientId).map(s => ({ value:s.id, label:`${s.name} — ${s.url}` }))
              ]} />

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Field label="First Publish Date" value={nmStartDate} onChange={setNmStartDate} type="date" />
              <Field label="Publish Time" value={nmTime} onChange={setNmTime} type="time" />
            </div>

            {/* Schedule preview */}
            <div style={{ background:"rgba(129,140,248,0.06)", border:"1px solid rgba(129,140,248,0.2)", borderRadius:10, padding:"12px 14px", marginBottom:16 }}>
              <div style={{ fontSize:11, color:"#a5b4fc", fontWeight:600, marginBottom:8 }}>📅 Schedule Preview</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {buildSchedule(nmStartDate, nmTime, nmCount).map((dt, i) => (
                  <span key={i} style={{ fontSize:10, color:C.muted, background:"rgba(255,255,255,0.05)", padding:"3px 8px", borderRadius:5, fontFamily:"'JetBrains Mono',monospace" }}>
                    #{i+1} {new Date(dt).toLocaleDateString([],{month:"short",day:"numeric"})}
                  </span>
                ))}
              </div>
              <div style={{ fontSize:11, color:C.muted2, marginTop:8 }}>Articles publish at {nmTime} · WordPress handles scheduling via <code style={{ color:C.teal }}>status: "future"</code></div>
            </div>

            {nmError && (
              <div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:12, color:"#fca5a5", lineHeight:1.6 }}>
                ✕ {nmError}
              </div>
            )}

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <Btn onClick={() => setShowNewMonth(false)} variant="ghost" disabled={nmGenerating}>Cancel</Btn>
              <Btn onClick={createMonth} disabled={nmDuplicate || nmGenerating}>
                {nmDuplicate ? "Already created" : nmGenerating ? "⏳ Generating topics…" : "Create Month"}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
