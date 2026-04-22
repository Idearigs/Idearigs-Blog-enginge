import { useState, useEffect, useCallback, useRef } from "react";

// ─── STORAGE ──────────────────────────────────────────────────────
const STORAGE_KEY = "wol-blog-automation-v3";

const loadState = async () => {
  let fromServer = null;
  let fromLocal = null;
  try {
    const res = await fetch("/api/state");
    if (res.ok) { const d = await res.json(); if (d && Object.keys(d).length > 0) fromServer = d; }
  } catch {}
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) fromLocal = JSON.parse(r); } catch {}

  // If server has data, use it (source of truth)
  if (fromServer) {
    // Also keep localStorage in sync
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fromServer)); } catch {}
    return fromServer;
  }
  // Server empty but localStorage has data — push localStorage up to server
  if (fromLocal) {
    try {
      await fetch("/api/state", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(fromLocal) });
    } catch {}
    return fromLocal;
  }
  return null;
};

const saveState = (s) => {
  // Always write to both — localStorage is the instant backup
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  fetch("/api/state", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(s) }).catch(() => {});
};
const uid = () => Math.random().toString(36).slice(2, 10);

// ─── HELPERS ─────────────────────────────────────────────────────
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const getMonthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const getMonthLabel = (key) => { const [y,m] = key.split("-"); return `${MONTHS[parseInt(m)-1]} ${y}`; };
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

const STEPS = [
  { id: "title_gen",   icon: "✦", label: "SEO Title",  desc: "Generating optimized title & slug" },
  { id: "content_gen", icon: "✎", label: "Content",    desc: "Writing 2000+ word article" },
  { id: "images",      icon: "⬡", label: "Images",     desc: "Fetching 3–5 Unsplash photos" },
  { id: "publishing",  icon: "↑", label: "Scheduling", desc: "Pushing to WordPress" },
];

const C = {
  bg: "#080C14", surface: "#0D1117", card: "#111827",
  border: "#1a2234", border2: "#243044",
  teal: "#14b8a6", tealDim: "#0d9488",
  text: "#e2e8f0", muted: "#64748b", muted2: "#475569",
};

// ─── SCHEDULE: 1 article per day, skip a day between each ────────
// Article 1 → startDate, Article 2 → startDate+2, Article 3 → startDate+4 …
const buildSchedule = (startDate, time) => {
  const [h, m] = (time || "09:00").split(":").map(Number);
  return Array.from({ length: 10 }, (_, i) => {
    const d = new Date(startDate + "T00:00:00");
    d.setDate(d.getDate() + i * 2); // every other day
    d.setHours(h, m, 0, 0);
    return d.toISOString().slice(0, 19);
  });
};

// Insert images into HTML at h2 section boundaries
const insertImagesIntoContent = (html, images) => {
  if (!images.length) return html;
  const parts = html.split(/<\/h2>/i);
  if (parts.length < 3) return html;
  const insertAt = new Set();
  const slots = parts.length - 2;
  const step = Math.max(1, Math.floor(slots / images.length));
  for (let i = 0; i < images.length; i++) insertAt.add(1 + i * step);
  let imgIdx = 0;
  return parts.map((part, i) => {
    const closer = i < parts.length - 1 ? "</h2>" : "";
    if (insertAt.has(i) && imgIdx < images.length) {
      const img = images[imgIdx++];
      return part + closer + `<figure style="margin:28px 0"><img src="${img.url}" alt="${img.alt}" style="width:100%;max-height:420px;object-fit:cover;border-radius:12px"/><figcaption style="text-align:center;font-size:12px;color:#888;margin-top:8px">${img.credit}</figcaption></figure>`;
    }
    return part + closer;
  }).join("");
};

// ─── SMALL COMPONENTS ────────────────────────────────────────────
const StatusDot = ({ status }) => {
  const map = {
    pending:     { color: "#475569", label: "Pending" },
    title_gen:   { color: "#818cf8", label: "SEO Title…", spin: true },
    content_gen: { color: "#38bdf8", label: "Writing…",   spin: true },
    images:      { color: "#c084fc", label: "Images…",    spin: true },
    ready:       { color: "#22c55e", label: "Ready" },
    publishing:  { color: "#fbbf24", label: "Scheduling…",spin: true },
    published:   { color: "#14b8a6", label: "Scheduled ✓" },
    error:       { color: "#f87171", label: "Error" },
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
  const done = articles.filter(a => ["published","ready"].includes(a.status)).length;
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
  const [loaded, setLoaded] = useState(false);
  const [nav, setNav] = useState("dashboard");
  const [months, setMonths] = useState({});
  const monthsRef = useRef({});
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [config, setConfig] = useState({
    grokKey: import.meta.env.VITE_GROK_API_KEY || "",
    grokModel: "grok-3-mini",
    unsplashKeys: [import.meta.env.VITE_UNSPLASH_ACCESS_KEY || ""].filter(Boolean),
    pricePerMonth: 6000,
    currency: "Rs",
  });
  const [newUnsplashKey, setNewUnsplashKey] = useState("");
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
  const [clientForm, setClientForm] = useState({ name:"", email:"", phone:"", website:"", notes:"" });
  const [siteConnStatus, setSiteConnStatus] = useState("idle"); // idle | testing | connected | error
  const [siteConnMsg, setSiteConnMsg] = useState("");

  // New month config
  const [nmDate, setNmDate] = useState(getMonthKey());
  const [nmClientId, setNmClientId] = useState("");
  const [nmSiteId, setNmSiteId] = useState("");
  const [nmStartDate, setNmStartDate] = useState(tomorrow());
  const [nmTime, setNmTime] = useState("09:00");
  const [nmLanguage, setNmLanguage] = useState("en");

  // Corrected doc upload state
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);

  const abortRef = useRef(false);
  const logEndRef = useRef(null);

  useEffect(() => {

    loadState().then(saved => {
      if (saved) {
        if (saved.months)   setMonths(saved.months);
        if (saved.clients)  setClients(saved.clients);
        if (saved.sites)    setSites(saved.sites);
        if (saved.config)   setConfig(p => {
          const sc = saved.config;
          // migrate old single unsplashAccessKey → unsplashKeys array
          let keys = sc.unsplashKeys || [];
          if (!keys.length && sc.unsplashAccessKey) keys = [sc.unsplashAccessKey];
          if (!keys.length) keys = [import.meta.env.VITE_UNSPLASH_ACCESS_KEY || ""].filter(Boolean);
          return {
            ...p, ...sc,
            grokKey: sc.grokKey || sc.geminiKey || import.meta.env.VITE_GROK_API_KEY || "",
            grokModel: "grok-3-mini",
            unsplashKeys: keys,
            pricePerMonth: sc.pricePerMonth ?? 6000,
            currency: sc.currency || "Rs",
          };
        });
        if (saved.payments)        setPayments(saved.payments);
        if (saved.targetKeywords)  setTargetKeywords(saved.targetKeywords);
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => { if (loaded) saveState({ months, clients, sites, config, payments, targetKeywords }); }, [months, clients, sites, config, payments, targetKeywords, loaded]);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [logs]);

  const addLog = useCallback((msg, type="info") => {
    setLogs(prev => [...prev, { msg, type, ts: new Date().toLocaleTimeString() }]);
  }, []);

  // ─── CLIENTS ────────────────────────────────────────────────
  const openAddClient = () => { setEditingClientId(null); setClientForm({ name:"", email:"", phone:"", website:"", notes:"" }); setShowClientModal(true); };
  const openEditClient = (c) => { setEditingClientId(c.id); setClientForm({ name:c.name, email:c.email||"", phone:c.phone||"", website:c.website||"", notes:c.notes||"" }); setShowClientModal(true); };
  const saveClient = () => {
    if (!clientForm.name) return;
    if (editingClientId) {
      setClients(p => p.map(c => c.id===editingClientId ? { ...c, ...clientForm } : c));
    } else {
      setClients(p => [...p, { id:uid(), ...clientForm, createdAt:new Date().toISOString() }]);
    }
    setShowClientModal(false);
  };
  const deleteClient = (id) => { if (confirm("Delete client? Their linked sites will remain.")) setClients(p => p.filter(c => c.id!==id)); };

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: siteForm.url, user: siteForm.user, appPass: siteForm.appPass }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setSiteConnStatus("connected");
      setSiteConnMsg(`Connected as: ${data.name} (${data.roles?.join(", ")})`);
    } catch (err) {
      setSiteConnStatus("error");
      setSiteConnMsg(err.message);
    }
  };

  // ─── MONTHS ─────────────────────────────────────────────────
  const createMonth = () => {
    if (months[nmDate]) return;
    const schedule = buildSchedule(nmStartDate, nmTime);
    const articles = [...TOPIC_BANK].sort(() => Math.random() - 0.5).slice(0, 10).map((t, i) => ({
      id: `${nmDate}-${i}`, ...t,
      seoTitle:"", content:"", metaDesc:"", slug:"",
      images:[], status:"pending", wordCount:0, error:null,
      scheduledAt: schedule[i],
    }));
    setMonths(p => ({ ...p, [nmDate]: {
      articles, createdAt: new Date().toISOString(),
      clientId: nmClientId, siteId: nmSiteId,
      scheduleStartDate: nmStartDate, scheduleTime: nmTime,
      language: nmLanguage,
    }}));
    const price = clients.find(c => c.id===nmClientId)?.pricePerMonth || config.pricePerMonth;
    setPayments(p => [...p, { monthKey:nmDate, status:"unpaid", amount:price, paidAt:null, clientId:nmClientId }]);
    setShowNewMonth(false);
    setSelectedMonth(nmDate);
    setNav("month");
  };

  const markPaid = (k) => setPayments(p => p.map(x => x.monthKey===k ? { ...x, status:"paid", paidAt:new Date().toISOString() } : x));

  const exportData = () => {
    const data = { months, clients, sites, payments, config, exportedAt: new Date().toISOString(), version: STORAGE_KEY };
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
        if (data.months)   setMonths(data.months);
        if (data.clients)  setClients(data.clients);
        if (data.sites)    setSites(data.sites);
        if (data.payments) setPayments(data.payments);
        if (data.config)   setConfig(p => ({ ...p, ...data.config }));
        alert("Data restored successfully.");
      } catch { alert("Invalid backup file."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };
  const getPayment = (k) => payments.find(p => p.monthKey===k) || { status:"unpaid" };
  const getSite = (id) => sites.find(s => s.id===id);
  const getClient = (id) => clients.find(c => c.id===id);

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
  const geminiCall = async (prompt, retries = 3) => {
    const model = config.grokModel || "grok-3-mini";
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.grokKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message || data.message || `HTTP ${res.status}`;
      if (retries > 0 && res.status === 429) {
        await new Promise(r => setTimeout(r, 15000));
        return geminiCall(prompt, retries - 1);
      }
      throw new Error(msg);
    }
    return data.choices?.[0]?.message?.content || "";
  };

  const pickRandomKeywords = (n = 3) => {
    if (!targetKeywords.length) return [];
    const shuffled = [...targetKeywords].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, shuffled.length));
  };

  const parseAIJson = (text) => {
    // Strip markdown fences
    let clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    // Remove control characters that break JSON.parse
    clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    try {
      return JSON.parse(clean);
    } catch {
      // Last resort: extract first {...} block
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error("AI returned invalid JSON — please retry");
    }
  };

  const LANG_NAMES = { en:"English", it:"Italian", de:"German", fr:"French", es:"Spanish" };

  const generateSEOTitle = async (topic, lang = "en") => {
    const kws = pickRandomKeywords(2);
    const kwHint = kws.length ? `\nNaturally weave 1-2 of these service keywords into the meta description if relevant: ${kws.join(", ")}` : "";
    const langLine = lang !== "en" ? `\nWRITE EVERYTHING IN ${LANG_NAMES[lang] || lang.toUpperCase()} — title, slug (latin chars), and meta description.` : "";
    const text = await geminiCall(`You are an SEO expert for "Wonders of Lanka" (wondersoflanka.com), a Sri Lanka tour guide agency.
Topic: "${topic.title}" | Keywords: ${topic.keywords}
Generate SEO title (50-65 chars), URL slug, meta description (150-160 chars).${kwHint}${langLine}
Respond ONLY in JSON (no markdown): {"seoTitle":"...","slug":"...","metaDescription":"..."}`);
    return parseAIJson(text);
  };

  const generateContent = async (topic, lang = "en") => {
    const kws = pickRandomKeywords(3);
    const kwSection = kws.length
      ? `\nService keywords to naturally include 1-2 times each (do NOT stuff — weave them in naturally as anchor text or in context): ${kws.map(k => `"${k}"`).join(", ")}`
      : "";
    const langLine = lang !== "en" ? `\nCRITICAL: Write the ENTIRE article in ${LANG_NAMES[lang] || lang} — all headings, paragraphs, FAQ, and CTA must be in ${LANG_NAMES[lang] || lang}.` : "";
    const text = await geminiCall(`You are a professional travel blog writer for "Wonders of Lanka" (wondersoflanka.com), a premium Sri Lanka tour guide and driver service in Sri Lanka.
Write a comprehensive SEO-optimized blog article.
Title: "${topic.seoTitle || topic.title}" | Keywords: ${topic.keywords} | Category: ${topic.category}
Requirements: 2000+ words, HTML (h2,h3,p,ul,li,strong,em), 5-7 H2 sections, practical tips and costs, FAQ section at end (6-8 questions), CTA mentioning Wonders of Lanka.${kwSection}${langLine}
Also generate 5 Unsplash image search queries IN ENGLISH (Sri Lanka travel photography).
Respond ONLY in JSON (no markdown): {"content":"<full HTML>","imageQueries":["q1","q2","q3","q4","q5"],"wordCount":2200}`);
    return parseAIJson(text);
  };

  // Per-key rate limit tracking: { keyIndex: resetTimestampMs }
  const unsplashKeyLimits = useRef({});

  const fetchOneImage = async (query, logFn) => {
    const keys = (config.unsplashKeys || []).filter(Boolean);
    if (!keys.length) return null;

    const now = Date.now();
    // Find first available (non-rate-limited) key
    let chosenIdx = -1;
    for (let i = 0; i < keys.length; i++) {
      const resetAt = unsplashKeyLimits.current[i];
      if (!resetAt || now >= resetAt) { chosenIdx = i; break; }
    }

    // All keys rate-limited — wait for the earliest reset
    if (chosenIdx === -1) {
      const earliest = Math.min(...Object.values(unsplashKeyLimits.current));
      const waitMs = earliest - now + 1500;
      const resetTime = new Date(earliest).toLocaleTimeString();
      logFn && logFn(`  ⏳ All ${keys.length} Unsplash key(s) rate limited — waiting until ${resetTime}…`, "warn");
      await new Promise(r => setTimeout(r, waitMs));
      unsplashKeyLimits.current = {};
      chosenIdx = 0;
    }

    const key = keys[chosenIdx];
    try {
      const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query+" Sri Lanka")}&per_page=5&orientation=landscape`, {
        headers: { Authorization: `Client-ID ${key}` }
      });
      const remaining = parseInt(res.headers.get("X-Ratelimit-Remaining") ?? "99");

      if (res.status === 429 || remaining === 0) {
        const resetAt = new Date(); resetAt.setHours(resetAt.getHours()+1, 0, 10, 0);
        unsplashKeyLimits.current[chosenIdx] = resetAt.getTime();
        logFn && logFn(`  ⚠ Key ${chosenIdx+1}/${keys.length} rate limited — switching key…`, "warn");
        return fetchOneImage(query, logFn); // retry with next available key
      }

      if (remaining <= 8) logFn && logFn(`  ⚠ Key ${chosenIdx+1}: only ${remaining} requests left this hour`, "warn");
      const data = await res.json();
      if (data.results?.length > 0) {
        const pick = data.results[Math.floor(Math.random() * Math.min(5, data.results.length))];
        return { url:pick.urls.regular, alt:pick.alt_description||query, credit:`Photo by ${pick.user.name} on Unsplash` };
      }
    } catch {}
    return null;
  };

  const fetchImages = async (queries, logFn) => {
    const images = [];
    const count = Math.min(5, Math.max(3, queries.length));
    for (let i = 0; i < count; i++) {
      if (i >= queries.length) break;
      logFn(`  Fetching image ${i+1}/${count}: "${queries[i]}"…`);
      const img = await fetchOneImage(queries[i], logFn);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: site.url, user: site.user, appPass: site.appPass, name: categoryName }),
    });
    const data = await res.json();
    if (data.id) {
      wpCatCache.current[site.id] = { ...cache, [categoryName]: data.id };
      return data.id;
    }
    return null;
  };

  // WordPress publish/schedule — proxied through Express to avoid CORS
  const publishToWP = async (site, article) => {
    const scheduledAt = article.scheduledAt;
    const now = new Date();
    const pubDate = scheduledAt ? new Date(scheduledAt) : null;
    const isFuture = pubDate && pubDate > now;

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
      try {
        const slug = article.slug || "article";
        const uploadRes = await fetch("/api/wp/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: site.url, user: site.user, appPass: site.appPass,
            imageUrl: firstImage.url,
            filename: `${slug}-featured.jpg`,
            alt: firstImage.alt || article.seoTitle || article.title,
          }),
        });
        if (uploadRes.ok) {
          const media = await uploadRes.json();
          featuredMediaId = media.id;
        }
      } catch { /* featured image is optional — don't fail the whole post */ }
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
    if (isFuture) post.date = scheduledAt;

    const res = await fetch("/api/wp/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: site.url, user: site.user, appPass: site.appPass, post }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || `WordPress API ${res.status}`);
    }
    return res.json();
  };

  useEffect(() => { testLogEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [testLogs]);

  // ─── TEST ARTICLE ────────────────────────────────────────────
  const runTestArticle = async () => {
    if (!config.grokKey) { setTestLogs([{ msg:"Grok API key not set — go to Settings first.", type:"error", ts:new Date().toLocaleTimeString() }]); return; }
    const addTL = (msg, type="info") => setTestLogs(p => [...p, { msg, type, ts: new Date().toLocaleTimeString() }]);
    const topic = testUseCustom
      ? { title: testCustomTitle || "Sri Lanka Travel Guide", keywords: testCustomKeywords || "Sri Lanka travel", category: testCustomCategory }
      : TOPIC_BANK[testTopicIdx];
    setTestRunning(true);
    setTestResult(null);
    setTestLogs([]);
    setTestTab("preview");
    addTL(`Starting test: "${topic.title}"`, "success");
    try {
      addTL("  Generating SEO title & slug…");
      const td = await generateSEOTitle(topic);
      addTL(`  ✓ Title: "${td.seoTitle}"`, "success");

      addTL("  Writing 2000+ word article…");
      const art = { ...topic, seoTitle: td.seoTitle, slug: td.slug, metaDesc: td.metaDescription };
      const cd = await generateContent(art);
      addTL(`  ✓ Content: ~${cd.wordCount} words`, "success");

      addTL("  Fetching Unsplash images (3–5)…");
      const imgs = await fetchImages(cd.imageQueries || [], addTL);
      addTL(`  ✓ ${imgs.length} images fetched`, "success");

      const finalContent = insertImagesIntoContent(cd.content, imgs);
      setTestResult({ seoTitle: td.seoTitle, slug: td.slug, metaDesc: td.metaDescription, content: finalContent, images: imgs, wordCount: cd.wordCount, category: topic.category, keywords: topic.keywords });
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
    abortRef.current = false;
    setIsRunning(true);
    setLogs([]);
    setSelectedArticle(null);
    const articles = monthData.articles;
    addLog(`🚀 Starting — ${articles.length} articles`, "success");
    if (site) addLog(`🔗 Publishing to: ${site.name}`, "info");
    else addLog("⚠ No site linked — will generate only (not publish).", "warn");

    for (let i = 0; i < articles.length; i++) {
      if (abortRef.current) { addLog("⛔ Aborted.", "error"); break; }
      const a = articles[i];
      if (a.status !== "pending" && a.status !== "error") continue;
      addLog(`\n── [${i+1}/10] "${a.title}"${a.status==="error" ? " (retrying)" : ""}`);

      // SEO Title
      try {
        updateArticle(monthKey, a.id, { status:"title_gen", error:null });
        addLog("  Generating SEO title…");
        const td = await generateSEOTitle(a, lang);
        updateArticle(monthKey, a.id, { seoTitle:td.seoTitle, slug:td.slug, metaDesc:td.metaDescription });
        addLog(`  ✓ "${td.seoTitle}"`, "success");
      } catch (err) { updateArticle(monthKey, a.id, { status:"error", error:err.message }); addLog(`  ✕ ${err.message}`, "error"); continue; }

      if (abortRef.current) break;

      // Content + Images
      try {
        updateArticle(monthKey, a.id, { status:"content_gen" });
        addLog("  Writing 2000+ word article…");
        const freshA = (monthsRef.current[monthKey] || months[monthKey])?.articles.find(x => x.id===a.id) || a;
        const cd = await generateContent(freshA, lang);
        addLog(`  ✓ ~${cd.wordCount||2000} words written`, "success");

        updateArticle(monthKey, a.id, { status:"images" });
        const imgs = await fetchImages(cd.imageQueries||[], msg => addLog(msg));
        const contentWithImgs = insertImagesIntoContent(cd.content, imgs);
        updateArticle(monthKey, a.id, { content:contentWithImgs, wordCount:cd.wordCount||2000, images:imgs, status:"ready" });
        addLog(`  ✓ ${imgs.length} images embedded`, "success");
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
          const dt = a.scheduledAt ? new Date(a.scheduledAt) : null;
          const isFuture = dt && dt > new Date();
          addLog(`  ${isFuture ? `📅 Scheduling ${dt.toLocaleDateString()} ${dt.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}` : "📤 Publishing now"}: "${a.seoTitle||a.title}"`);
          await publishToWP(site, a);
          updateArticle(monthKey, a.id, { status:"published" });
          addLog(`  ✓ ${isFuture ? "Scheduled!" : "Published!"}`, "success");
          await new Promise(r => setTimeout(r, 500));
        } catch (err) { updateArticle(monthKey, a.id, { status:"error", error:err.message }); addLog(`  ✕ ${err.message}`, "error"); }
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
      const monthData = months[monthKey];
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
      a.download = `wol-articles-${monthKey}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addLog("💾 Articles auto-saved to Downloads folder.", "success");
    } catch {}
  };

  const deleteMonth = (monthKey) => {
    if (!confirm(`Delete ${getMonthLabel(monthKey)} and all its articles? This cannot be undone.`)) return;
    setMonths(p => { const n = { ...p }; delete n[monthKey]; return n; });
    setPayments(p => p.filter(x => x.monthKey !== monthKey));
    if (selectedMonth === monthKey) { setSelectedMonth(null); setNav("dashboard"); }
  };

  // ─── PUBLISH READY (recheck) ─────────────────────────────────
  const publishReadyArticles = async (monthKey) => {
    const monthData = months[monthKey];
    const site = monthData?.siteId ? getSite(monthData.siteId) : null;
    if (!site?.user || !site?.appPass) { addLog("⚠ No WordPress site linked.", "error"); return; }
    const readyArts = monthData.articles.filter(a => a.status === "ready");
    if (!readyArts.length) { addLog("No ready articles to publish.", "warn"); return; }
    setIsRunning(true);
    addLog(`\n── Publishing ${readyArts.length} ready article(s) to WordPress…`, "success");
    for (const a of readyArts) {
      if (abortRef.current) break;
      try {
        updateArticle(monthKey, a.id, { status:"publishing" });
        const dt = a.scheduledAt ? new Date(a.scheduledAt) : null;
        const isFuture = dt && dt > new Date();
        addLog(`  ${isFuture ? `📅 Scheduling ${dt.toLocaleDateString()}` : "📤 Publishing now"}: "${a.seoTitle||a.title}"`);
        await publishToWP(site, a);
        updateArticle(monthKey, a.id, { status:"published" });
        addLog(`  ✓ Done!`, "success");
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        updateArticle(monthKey, a.id, { status:"ready", error:err.message });
        addLog(`  ✕ ${err.message}`, "error");
      }
    }
    setIsRunning(false);
    saveState();
  };

  // ─── DOWNLOAD ALL AS WORD ────────────────────────────────────
  const downloadAllAsWord = async (monthKey) => {
    const JSZip = (await import("jszip")).default;
    const monthData = months[monthKey];
    if (!monthData) return;
    const zip = new JSZip();
    const label = getMonthLabel(monthKey);

    monthData.articles.forEach((a, i) => {
      if (!a.content && !a.seoTitle) return;
      const num = String(i + 1).padStart(2, "0");
      const slug = a.slug || `article-${num}`;
      const scheduledStr = a.scheduledAt ? `Scheduled: ${new Date(a.scheduledAt).toLocaleDateString()}` : "";

      const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 12pt; line-height: 1.6; margin: 2cm; }
  h1 { font-size: 20pt; color: #1a365d; margin-bottom: 6pt; }
  h2 { font-size: 15pt; color: #2c5282; margin-top: 18pt; }
  h3 { font-size: 13pt; color: #2b6cb0; }
  .meta { background: #f7fafc; border: 1px solid #bee3f8; padding: 10pt; margin-bottom: 18pt; font-size: 10pt; }
  .meta strong { color: #2c5282; }
  img { max-width: 100%; }
</style>
</head>
<body>
<h1>${a.seoTitle || a.title || "Article"}</h1>
<div class="meta">
  <strong>Slug:</strong> ${a.slug || ""}<br>
  <strong>Category:</strong> ${a.category || ""}<br>
  <strong>Keywords:</strong> ${a.keywords || ""}<br>
  <strong>Meta Description:</strong> ${a.metaDesc || ""}<br>
  <strong>${scheduledStr}</strong>
</div>
${a.content || "<p>No content generated yet.</p>"}
</body></html>`;

      zip.file(`${num}-${slug}.doc`, "﻿" + html);
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `WOL-Articles-${label.replace(/\s/g,"-")}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ─── UPLOAD CORRECTED DOCS ───────────────────────────────────
  const handleCorrectedDocsUpload = async (monthKey, files) => {
    const mammoth = await import("mammoth");
    const monthData = months[monthKey];
    if (!monthData) return;
    setUploadingDocs(true);
    setUploadResults([]);
    const results = [];

    for (const file of Array.from(files)) {
      // Match by filename prefix e.g. "01-slug.docx" → article index 0
      const match = file.name.match(/^(\d+)/);
      const idx = match ? parseInt(match[1], 10) - 1 : -1;
      const article = monthData.articles[idx];
      if (!article) {
        results.push({ file: file.name, ok: false, msg: "Could not match to an article (name must start with 01-, 02-, etc.)" });
        continue;
      }
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const html = result.value;
        updateArticle(monthKey, article.id, { content: html, status: "ready", error: null });
        results.push({ file: file.name, ok: true, msg: `→ Article #${idx+1}: "${article.seoTitle || article.title}"` });
      } catch (err) {
        results.push({ file: file.name, ok: false, msg: err.message });
      }
    }

    setUploadResults(results);
    setUploadingDocs(false);
    saveState();
  };

  if (!loaded) return (
    <div style={{ height:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:40, height:40, borderRadius:"50%", border:`3px solid ${C.border2}`, borderTopColor:C.teal, animation:"spin 0.8s linear infinite", margin:"0 auto 16px" }} />
        <div style={{ color:C.muted, fontSize:13 }}>Loading…</div>
      </div>
    </div>
  );

  const sortedMonths = Object.keys(months).sort().reverse();
  const totalRevenue = payments.filter(p => p.status==="paid").reduce((s,p) => s+(p.amount||0), 0);
  const totalArticles = Object.values(months).reduce((s,m) => s+m.articles.filter(a => ["published","ready"].includes(a.status)).length, 0);
  const viewArticle = selectedMonth && selectedArticle ? months[selectedMonth]?.articles.find(a => a.id===selectedArticle) : null;

  const NAV = [
    { id:"dashboard", icon:"⊞", label:"Dashboard" },
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

      {/* ── SIDEBAR ── */}
      <aside style={{ width:220, background:C.surface, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"20px 16px 16px", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#0d9488,#14b8a6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:800, color:"#021a17", boxShadow:"0 0 16px rgba(20,184,166,0.35)", flexShrink:0 }}>W</div>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Blog Engine</div>
              <div style={{ fontSize:10, color:C.muted, marginTop:1 }}>v3 · Wonders of Lanka</div>
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
            const done = months[key].articles.filter(a => ["published","ready"].includes(a.status)).length;
            const active = selectedMonth===key && nav==="month";
            const client = getClient(months[key].clientId);
            return (
              <button key={key} onClick={() => { setSelectedMonth(key); setNav("month"); setSelectedArticle(null); }}
                style={{ width:"100%", padding:"8px 12px", background: active?"rgba(20,184,166,0.08)":"transparent", border: active?"1px solid rgba(20,184,166,0.15)":"1px solid transparent", borderRadius:9, color: active?C.text:C.muted, fontSize:12, cursor:"pointer", textAlign:"left", marginBottom:2, transition:"all 0.15s" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontWeight: active?600:400 }}>{getMonthLabel(key)}</span>
                  <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <span style={{ fontSize:10, color:C.muted2, fontFamily:"'JetBrains Mono',monospace" }}>{done}/10</span>
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
                  const pub = arts.filter(a => a.status==="published").length;
                  const rdy = arts.filter(a => a.status==="ready").length;
                  const pct = Math.round(((pub+rdy)/arts.length)*100);
                  const client = getClient(months[key].clientId);
                  const site = getSite(months[key].siteId);
                  const firstDate = arts[0]?.scheduledAt ? new Date(arts[0].scheduledAt).toLocaleDateString() : null;
                  const lastDate = arts[9]?.scheduledAt ? new Date(arts[9].scheduledAt).toLocaleDateString() : null;
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
                          {pub} scheduled · {rdy} ready · {10-pub-rdy} pending
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
                          <Btn onClick={() => openEditClient(client)} variant="ghost" small>Edit</Btn>
                          <Btn onClick={() => deleteClient(client.id)} variant="danger" small>✕</Btn>
                        </div>
                      </div>

                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:14 }}>
                        {[
                          { label:"Revenue", value:`$${clientRevenue}`, color:"#22c55e" },
                          { label:"Pending",  value:`$${clientPending}`, color:"#f87171" },
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
          const lastDate = arts[9]?.scheduledAt;
          return (
            <div style={{ padding:32 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
                <div>
                  <button onClick={() => { setSelectedMonth(null); setNav("dashboard"); }} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:12, padding:"0 0 8px", display:"flex", alignItems:"center", gap:4 }}>‹ Dashboard</button>
                  <h1 style={{ fontSize:24, fontWeight:800, color:C.text, letterSpacing:"-0.03em" }}>{getMonthLabel(selectedMonth)}</h1>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:6, flexWrap:"wrap" }}>
                    <PayBadge status={pay.status} />
                    {client && <span style={{ fontSize:12, color:"#d8b4fe", background:"rgba(192,132,252,0.08)", border:"1px solid rgba(192,132,252,0.2)", padding:"2px 10px", borderRadius:6 }}>👤 {client.name}</span>}
                    {site && <span style={{ fontSize:12, color:"#7dd3fc", background:"rgba(56,189,248,0.08)", border:"1px solid rgba(56,189,248,0.2)", padding:"2px 10px", borderRadius:6 }}>🔗 {site.name}</span>}
                    {months[selectedMonth]?.language && months[selectedMonth].language !== "en" && (
                      <span style={{ fontSize:12, color:"#fde68a", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.2)", padding:"2px 10px", borderRadius:6 }}>
                        🌍 {LANG_NAMES[months[selectedMonth].language]}
                      </span>
                    )}
                    {firstDate && <span style={{ fontSize:12, color:"#818cf8", background:"rgba(129,140,248,0.08)", border:"1px solid rgba(129,140,248,0.2)", padding:"2px 10px", borderRadius:6 }}>📅 {new Date(firstDate).toLocaleDateString()} – {new Date(lastDate).toLocaleDateString()}</span>}
                  </div>
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {pay.status !== "paid" && <Btn onClick={() => markPaid(selectedMonth)} variant="success">💰 Mark Paid</Btn>}
                  <Btn onClick={() => runPipeline(selectedMonth)} disabled={isRunning || pay.status!=="paid"}>
                    {isRunning ? "⏳ Running…" : pay.status!=="paid" ? "🔒 Pay First" : "▶ Run Pipeline"}
                  </Btn>
                  {!isRunning && arts.some(a => a.status==="error") && (
                    <Btn onClick={() => runPipeline(selectedMonth)} variant="warn" disabled={pay.status!=="paid"}>
                      🔁 Retry Failed ({arts.filter(a=>a.status==="error").length})
                    </Btn>
                  )}
                  {!isRunning && arts.some(a => a.status==="ready") && (
                    <Btn onClick={() => publishReadyArticles(selectedMonth)} variant="warn">
                      📤 Publish Ready ({arts.filter(a=>a.status==="ready").length})
                    </Btn>
                  )}
                  {arts.some(a => a.content) && (
                    <Btn onClick={() => downloadAllAsWord(selectedMonth)} variant="ghost">📥 Download as Word</Btn>
                  )}
                  {isRunning && <Btn onClick={() => { abortRef.current=true; }} variant="danger">⛔ Stop</Btn>}
                </div>
              </div>

              {(isRunning || logs.length > 0) && <PipelineVisualizer articles={arts} logs={logs} isRunning={isRunning} logEndRef={logEndRef} />}

              {/* Upload corrected docs (non-English months) */}
              {months[selectedMonth]?.language && months[selectedMonth].language !== "en" && (
                <div style={{ background:C.card, border:`1px solid rgba(129,140,248,0.3)`, borderRadius:14, padding:20, marginBottom:20 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#a5b4fc", marginBottom:6 }}>
                    📂 Upload Corrected Word Docs ({LANG_NAMES[months[selectedMonth].language]} articles)
                  </div>
                  <p style={{ fontSize:12, color:C.muted, marginBottom:12, lineHeight:1.6 }}>
                    After auditing the downloaded Word files, upload the corrected <code>.docx</code> files here.
                    Files must start with the article number (e.g. <code>01-slug.docx</code>, <code>02-slug.docx</code>).
                    The corrected content will replace the article and it will be ready to schedule to WordPress.
                  </p>
                  <label style={{ display:"inline-block", padding:"9px 18px", background:"rgba(129,140,248,0.12)", border:"1px solid rgba(129,140,248,0.3)", borderRadius:9, color:"#a5b4fc", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                    {uploadingDocs ? "Uploading…" : "Choose .docx files"}
                    <input type="file" accept=".docx" multiple style={{ display:"none" }} disabled={uploadingDocs}
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
                      const dt = a.scheduledAt ? new Date(a.scheduledAt) : null;
                      const isPast = dt && dt < new Date();
                      const statusColors = { published:"#14b8a6", ready:"#22c55e", error:"#f87171", pending:C.muted2 };
                      const col = statusColors[a.status] || C.muted2;
                      return (
                        <div key={a.id} onClick={() => setSelectedArticle(a.id)} style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${a.status==="published" ? "rgba(20,184,166,0.3)" : C.border}`, borderRadius:10, padding:"10px 12px", cursor:"pointer", transition:"all 0.2s" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor=C.border2}
                          onMouseLeave={e => e.currentTarget.style.borderColor = a.status==="published"?"rgba(20,184,166,0.3)":C.border}>
                          <div style={{ fontSize:10, color:C.muted2, marginBottom:4 }}>Article {i+1}</div>
                          {dt && <div style={{ fontSize:12, fontWeight:600, color: isPast ? C.muted : C.text }}>{dt.toLocaleDateString([],{month:"short",day:"numeric"})}</div>}
                          {dt && <div style={{ fontSize:10, color:C.muted2 }}>{dt.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>}
                          <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:4 }}>
                            <span style={{ width:5, height:5, borderRadius:"50%", background:col }} />
                            <span style={{ fontSize:10, color:col }}>{a.status==="published"?"Scheduled":a.status}</span>
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
                          {a.images?.length > 0 && <span style={{ fontSize:10, color:"#c084fc" }}>🖼 {a.images.length}</span>}
                          {a.wordCount > 0 && <span style={{ fontSize:10, color:C.muted2, fontFamily:"'JetBrains Mono',monospace" }}>{a.wordCount}w</span>}
                        </div>
                      </div>
                      {a.scheduledAt && (
                        <div style={{ marginTop:8, fontSize:10, color:"#818cf8" }}>
                          📅 {new Date(a.scheduledAt).toLocaleDateString()} {new Date(a.scheduledAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
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
                    {viewArticle.wordCount > 0 && <span style={{ fontSize:12, color:C.muted }}>~{viewArticle.wordCount} words</span>}
                    {viewArticle.images?.length > 0 && <span style={{ fontSize:12, color:"#c084fc" }}>🖼 {viewArticle.images.length} images</span>}
                    {viewArticle.scheduledAt && <span style={{ fontSize:12, color:"#818cf8" }}>📅 {new Date(viewArticle.scheduledAt).toLocaleString()}</span>}
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
            <div style={{ marginBottom:28 }}>
              <h1 style={{ fontSize:26, fontWeight:800, color:C.text, letterSpacing:"-0.03em" }}>Settings</h1>
              <p style={{ fontSize:13, color:C.muted, marginTop:4 }}>Global API keys and configuration</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24 }}>
                <h3 style={{ margin:"0 0 16px", fontSize:13, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>🤖 Grok AI (xAI)</h3>
                <Field label="API Key" value={config.grokKey} onChange={v => setConfig(p=>({...p,grokKey:v}))} type="password" placeholder="xai-..." mono hint="Get your key at console.x.ai" />
                <Select label="Model" value={config.grokModel || "grok-3-mini"} onChange={v => setConfig(p=>({...p,grokModel:v}))}
                  options={[
                    { value:"grok-3-mini",  label:"grok-3-mini  ← recommended (affordable, fast)" },
                    { value:"grok-3",       label:"grok-3  (highest quality, higher cost)" },
                  ]} />
              </div>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24 }}>
                <h3 style={{ margin:"0 0 6px", fontSize:13, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>📷 Unsplash API Keys</h3>
                <p style={{ fontSize:11, color:C.muted2, marginBottom:12, lineHeight:1.6 }}>Add up to 3 keys (50 req/hour each). Pipeline auto-switches when one hits its limit.</p>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
                  {(config.unsplashKeys||[]).map((k,i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color:C.muted, width:56, flexShrink:0 }}>Key {i+1}</span>
                      <input value={k} onChange={e => setConfig(p => { const keys=[...p.unsplashKeys]; keys[i]=e.target.value; return {...p,unsplashKeys:keys}; })}
                        style={{ flex:1, padding:"8px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:8, color:C.text, fontSize:11, fontFamily:"'JetBrains Mono',monospace", outline:"none" }}
                        onFocus={e=>e.target.style.borderColor=C.teal} onBlur={e=>e.target.style.borderColor=C.border2} />
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
                <h3 style={{ margin:"0 0 16px", fontSize:13, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>💰 Default Pricing</h3>
                <Field label="Currency Symbol" value={config.currency||"Rs"} onChange={v => setConfig(p=>({...p,currency:v}))} placeholder="Rs" hint="e.g. Rs · $ · £ · €" />
                <Field label={`Price per Month (${config.currency||"Rs"})`} value={config.pricePerMonth} onChange={v => setConfig(p=>({...p,pricePerMonth:parseFloat(v)||0}))} type="number" hint="10 articles per month" />
              </div>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:24, gridColumn:"1 / -1" }}>
                <h3 style={{ margin:"0 0 6px", fontSize:13, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>🎯 Target Keywords</h3>
                <p style={{ fontSize:12, color:C.muted2, marginBottom:14, lineHeight:1.6 }}>
                  These service keywords are randomly picked (2–3 per article) and naturally woven into content by Grok. Great for SEO ranking on your core services.
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
                  All data (clients, sites, months, payments, articles) is saved in <strong style={{ color:C.muted }}>browser localStorage</strong>.
                  Export a JSON backup regularly — if you clear browser data, everything is lost.
                </p>
                <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                  <Btn onClick={exportData}>↓ Export Backup</Btn>
                  <label style={{ padding:"10px 20px", borderRadius:10, fontWeight:600, fontSize:13, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.04)", color:C.muted, cursor:"pointer", transition:"all 0.15s" }}>
                    ↑ Import Backup
                    <input type="file" accept=".json" onChange={importData} style={{ display:"none" }} />
                  </label>
                  <span style={{ fontSize:11, color:C.muted2 }}>
                    Last save: {new Date().toLocaleDateString()} · Storage key: <code style={{ color:C.teal, fontSize:10 }}>{STORAGE_KEY}</code>
                  </span>
                </div>
              </div>
              <div style={{ background:C.card, border:"1px solid rgba(239,68,68,0.15)", borderRadius:14, padding:24 }}>
                <h3 style={{ margin:"0 0 10px", fontSize:13, color:"#f87171", fontWeight:600 }}>Danger Zone</h3>
                <Btn onClick={() => { if (confirm("Delete ALL data? This cannot be undone.")) { setMonths({}); setPayments([]); setSites([]); setClients([]); setLogs([]); fetch("/api/state",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}); localStorage.removeItem(STORAGE_KEY); } }} variant="danger">Reset All Data</Btn>
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
            <Field label="Application Password" value={siteForm.appPass} onChange={v => setSiteForm(p=>({...p,appPass:v}))} type="password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" mono hint="WP Admin → Users → Profile → Application Passwords → Add New" />
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
                    <select value={testTopicIdx} onChange={e => setTestTopicIdx(Number(e.target.value))}
                      style={{ width:"100%", padding:"9px 12px", background:"#0a0f1a", border:`1px solid ${C.border2}`, borderRadius:9, color:C.text, fontSize:12, outline:"none" }}>
                      {TOPIC_BANK.map((t, i) => <option key={i} value={i}>{t.title}</option>)}
                    </select>
                    <div style={{ marginTop:8, padding:"8px 10px", background:"rgba(255,255,255,0.03)", borderRadius:8, fontSize:11, color:C.muted }}>
                      <div style={{ marginBottom:3 }}><span style={{ color:C.muted2 }}>Keywords:</span> {TOPIC_BANK[testTopicIdx].keywords}</div>
                      <div><span style={{ color:C.muted2 }}>Category:</span> {TOPIC_BANK[testTopicIdx].category}</div>
                    </div>
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
                          <span style={{ fontSize:11, color:"#22c55e", background:"rgba(34,197,94,0.1)", border:"1px solid rgba(34,197,94,0.2)", padding:"3px 10px", borderRadius:6, fontFamily:"monospace" }}>~{testResult.wordCount} words</span>
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
            <p style={{ fontSize:12, color:C.muted, marginBottom:22 }}>10 articles will be assigned and scheduled 1 per day with a gap day between each (every 2 days).</p>

            <Field label="Month (YYYY-MM)" value={nmDate} onChange={setNmDate} placeholder="2026-05" mono />
            <Select label="Article Language" value={nmLanguage} onChange={setNmLanguage}
              options={[
                { value:"en", label:"🇬🇧 English" },
                { value:"it", label:"🇮🇹 Italian" },
                { value:"de", label:"🇩🇪 German" },
                { value:"fr", label:"🇫🇷 French" },
                { value:"es", label:"🇪🇸 Spanish" },
              ]} />
            <Select label="Client" value={nmClientId} onChange={v => { setNmClientId(v); setNmSiteId(""); }}
              options={[{ value:"", label:"— No client —" }, ...clients.map(c => ({ value:c.id, label:c.name }))]} />
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
                {buildSchedule(nmStartDate, nmTime).map((dt, i) => (
                  <span key={i} style={{ fontSize:10, color:C.muted, background:"rgba(255,255,255,0.05)", padding:"3px 8px", borderRadius:5, fontFamily:"'JetBrains Mono',monospace" }}>
                    #{i+1} {new Date(dt).toLocaleDateString([],{month:"short",day:"numeric"})}
                  </span>
                ))}
              </div>
              <div style={{ fontSize:11, color:C.muted2, marginTop:8 }}>Articles publish at {nmTime} · WordPress handles scheduling via <code style={{ color:C.teal }}>status: "future"</code></div>
            </div>

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <Btn onClick={() => setShowNewMonth(false)} variant="ghost">Cancel</Btn>
              <Btn onClick={createMonth} disabled={!!months[nmDate]}>{months[nmDate] ? "Month exists" : "Create Month"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
