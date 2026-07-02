import { useState, useMemo, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";

const API_BASE = "/api";

const ACCENT = ["#3b82f6","#8b5cf6","#ec4899","#f59e0b","#10b981","#06b6d4","#f97316","#6366f1","#14b8a6","#e11d48"];

// Parse une chaîne "YYYY-MM-DD" en date locale (minuit local), pour éviter
// le décalage introduit par new Date("YYYY-MM-DD") qui parse en UTC.
function parseLocal(d) {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}
function getStatus(s, e) {
  const now = new Date(); now.setHours(0,0,0,0);
  const sd = parseLocal(s);
  const ed = parseLocal(e);
  if (now < sd) return "upcoming";
  if (now > ed) return "completed";
  return "active";
}
const SMETA = {
  active: { label:"En cours", bg:"#dcfce7", fg:"#166534", dot:"#22c55e" },
  upcoming: { label:"À venir", bg:"#dbeafe", fg:"#1e40af", dot:"#3b82f6" },
  completed: { label:"Terminé", bg:"#f3f4f6", fg:"#4b5563", dot:"#9ca3af" },
};
function fmtDate(d) { return d ? parseLocal(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"}) : ""; }
function daysLeft(e) { const n=new Date();n.setHours(0,0,0,0);return Math.ceil((parseLocal(e)-n)/864e5); }
function dur(s,e) { const d=Math.ceil((parseLocal(e)-parseLocal(s))/864e5); return d<7?`${d}j`:d<30?`${Math.round(d/7)} sem.`:`${Math.round(d/30)} mois`; }

const GRANDE = [
  { id:"g5", x:162, y:60,  o:"h", cp:"top",    label:"G5" },
  { id:"g2", x:70,  y:140, o:"v", cp:"left",   label:"G2" },
  { id:"g1", x:70,  y:276, o:"v", cp:"left",   label:"G1" },
  { id:"g3", x:150, y:330, o:"h", cp:"bottom", label:"G3" },
  { id:"g4", x:286, y:330, o:"h", cp:"bottom", label:"G4" },
];
const PETITE = [
  { id:"p1", x:40,  y:50,  o:"h", cp:"top",    label:"P1" },
  { id:"p2", x:40,  y:120, o:"h", cp:"bottom", label:"P2" },
  { id:"p3", x:210, y:50,  o:"h", cp:"top",    label:"P3" },
  { id:"p4", x:210, y:120, o:"h", cp:"bottom", label:"P4" },
  { id:"p5", x:120, y:260, o:"v", cp:"left",   label:"P5" },
  { id:"p6", x:218, y:260, o:"v", cp:"right",  label:"P6" },
];

const DESK_COLORS = {
  occupied:    { bg:"#dbeafe", border:"#3b82f6", text:"#1e40af", chair:"#93c5fd" },
  free:        { bg:"#d1fae5", border:"#22c55e", text:"#166534", chair:"#86efac" },
  unavailable: { bg:"#f1f5f9", border:"#cbd5e1", text:"#94a3b8", chair:"#e2e8f0" },
};
function deskColor(status, dark) {
  const c = DESK_COLORS[status];
  return dark ? { ...c, bg:`${c.border}22`, text:c.border, chair:`${c.border}55` } : c;
}
function chipColor(meta, dark) {
  return dark ? { bg:`${meta.dot}26`, fg:meta.dot, dot:meta.dot } : { bg:meta.bg, fg:meta.fg, dot:meta.dot };
}

const THEMES = {
  light: {
    pageBg:"#f4f5f7", surface:"#ffffff", surfaceAlt:"#f9fafb", surfaceHover:"#f3f4f6",
    border:"#e5e7eb", borderLight:"#f3f4f6", text:"#1a2332", textStrong:"#111827",
    textMuted:"#6b7280", textFaint:"#9ca3af", inputBg:"#fafafa",
    overlay:"rgba(0,0,0,0.35)", overlayStrong:"rgba(0,0,0,0.4)",
    floorBg:"#f8fafc", wall:"#cbd5e1", shadow:"rgba(0,0,0,0.05)",
  },
  dark: {
    pageBg:"#0f1420", surface:"#1a2130", surfaceAlt:"#212938", surfaceHover:"#2a3344",
    border:"#2d3a4d", borderLight:"#2a3344", text:"#e5e7eb", textStrong:"#f3f4f6",
    textMuted:"#9aa5b8", textFaint:"#6b7690", inputBg:"#242c3d",
    overlay:"rgba(0,0,0,0.55)", overlayStrong:"rgba(0,0,0,0.6)",
    floorBg:"#1e2634", wall:"#3a4658", shadow:"rgba(0,0,0,0.3)",
  },
};
function tint(color, dark, lightBg) { return dark ? `${color}22` : lightBg; }

function DeskUnit({ desk, status, name, onClick, isSelected, dark }) {
  const isH = desk.o === "h";
  const dW = isH ? 116 : 46;
  const dH = isH ? 46 : 116;
  const cr = 12;
  const gap = 5;
  const offsets = {
    top:    { x: dW/2 - cr, y: -cr*2 - gap },
    bottom: { x: dW/2 - cr, y: dH + gap },
    left:   { x: -cr*2 - gap, y: dH/2 - cr },
    right:  { x: dW + gap, y: dH/2 - cr },
  };
  const co = offsets[desk.cp];
  const c = deskColor(status, dark);
  const [hov, setHov] = useState(false);
  return (
    <div
      style={{ position:"absolute", left:desk.x, top:desk.y, cursor:"pointer", zIndex: isSelected ? 10 : 2 }}
      onClick={e => { e.stopPropagation(); onClick(desk); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{
        width:dW, height:dH, borderRadius:7,
        background: hov ? `${c.border}18` : c.bg,
        border:`2.5px solid ${c.border}`,
        boxShadow: isSelected
          ? `0 0 0 3px ${c.border}40, 0 4px 14px ${c.border}30`
          : hov ? `0 2px 10px ${c.border}20` : `0 1px 4px rgba(0,0,0,0.05)`,
        display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column",
        transition:"all 0.2s", position:"relative",
      }}>
        <div style={{ fontSize:8, color:c.text, fontWeight:700, opacity:0.45, letterSpacing:"0.05em" }}>{desk.label}</div>
        {name && (
          <div style={{
            fontSize: isH ? 10 : 9, fontWeight:700, color:c.text, marginTop:1,
            maxWidth: dW - 10, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textAlign:"center",
            writingMode: isH ? "horizontal-tb" : "horizontal-tb",
          }}>{name}</div>
        )}
      </div>
      {/* Chair */}
      <div style={{
        position:"absolute", left:co.x, top:co.y,
        width:cr*2, height:cr*2, borderRadius:"50%",
        background:c.chair, border:`2px solid ${c.border}`,
        transition:"all 0.2s",
        boxShadow: isSelected ? `0 0 0 2px ${c.border}30` : "none",
      }}>
        {/* Backrest indicator */}
        <div style={{
          position:"absolute",
          ...(desk.cp==="top"    ? { bottom:1, left:"18%", right:"18%", height:3 }
            : desk.cp==="bottom" ? { top:1,    left:"18%", right:"18%", height:3 }
            : desk.cp==="left"   ? { right:1,  top:"18%",  bottom:"18%", width:3 }
            :                      { left:1,   top:"18%",  bottom:"18%", width:3 }),
          borderRadius:2, background:c.border, opacity:0.3,
        }}/>
      </div>
    </div>
  );
}

const SvgIcon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={d}/>
  </svg>
);

const IC = {
  home:     "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  list:     "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  grid:     "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  cal:      "M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z M16 2v4 M8 2v4 M3 10h18",
  bar:      "M18 20V10 M12 20V4 M6 20v-6",
  plus:     "M12 5v14 M5 12h14",
  dl:       "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  search:   "M11 17.25a6.25 6.25 0 1 1 0-12.5 6.25 6.25 0 0 1 0 12.5z M16 16l4.5 4.5",
  x:        "M18 6L6 18 M6 6l12 12",
  edit:     "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  chevL:    "M15 18l-6-6 6-6",
  chevR:    "M9 18l6-6-6-6",
  trash:    "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  ban:      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M4.93 4.93l14.14 14.14",
  check:    "M20 6L9 17l-5-5",
  collapse: "M11 19l-7-7 7-7 M18 19l-7-7 7-7",
  expand:   "M13 5l7 7-7 7 M6 5l7 7-7 7",
  sun:      "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42",
  moon:     "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
};

function useViewportWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

export default function App() {
  const [stags, setStags] = useState([]);
  const [view, setView] = useState(() => sessionStorage.getItem("view") || "dashboard");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ nom:"", prenom:"", debut:"", fin:"", poste:"" });
  const [formError, setFormError] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [calMonth, setCalMonth] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() }));
  const [assignments, setAssignments] = useState({});
  const [selDesk, setSelDesk] = useState(null);
  const [deskModal, setDeskModal] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  const T = useMemo(() => (dark ? THEMES.dark : THEMES.light), [dark]);
  useEffect(() => { localStorage.setItem("theme", dark ? "dark" : "light"); }, [dark]);

  const viewportWidth = useViewportWidth();
  const isMobile = viewportWidth < 700;
  const isNarrow = viewportWidth < 960;

  const fetchStagiaires = useCallback(async () => {
    const res = await fetch(`${API_BASE}/stagiaires`);
    const data = await res.json();
    setStags(data);
  }, []);

  const fetchAssignments = useCallback(async () => {
    const res = await fetch(`${API_BASE}/assignments`);
    const data = await res.json();
    const map = {};
    data.forEach(a => {
      if (a.unavailable) map[a.desk_id] = { unavailable: true };
      else if (a.stagiaire_id) map[a.desk_id] = { stagiaireId: a.stagiaire_id };
    });
    setAssignments(map);
  }, []);

  useEffect(() => { fetchStagiaires(); fetchAssignments(); }, [fetchStagiaires, fetchAssignments]);
  useEffect(() => { sessionStorage.setItem("view", view); }, [view]);

  const resetForm = () => { setForm({ nom:"", prenom:"", debut:"", fin:"", poste:"" }); setEditId(null); setFormError(""); };
  const openAdd = () => { resetForm(); setShowForm(true); };
  const openEdit = s => { setForm({ nom:s.nom, prenom:s.prenom, debut:s.debut, fin:s.fin, poste:s.poste }); setEditId(s.id); setFormError(""); setShowForm(true); };

  const save = async () => {
    if (!form.nom || !form.prenom || !form.debut || !form.fin) return;
    setFormError("");
    const res = editId
      ? await fetch(`${API_BASE}/stagiaires/${editId}`, { method:"PUT", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(form) })
      : await fetch(`${API_BASE}/stagiaires`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(form) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFormError(data.error || "Une erreur est survenue, le stagiaire n'a pas été enregistré.");
      return;
    }
    setShowForm(false); resetForm();
    await fetchStagiaires();
    await fetchAssignments();
  };

  const remove = async id => {
    await fetch(`${API_BASE}/stagiaires/${id}`, { method:"DELETE" });
    await fetchStagiaires();
    await fetchAssignments();
  };

  const counts = useMemo(() => {
    const c = { all: stags.length, active: 0, upcoming: 0, completed: 0 };
    stags.forEach(s => c[getStatus(s.debut, s.fin)]++);
    return c;
  }, [stags]);

  const filtered = useMemo(() => {
    let l = stags;
    if (filter !== "all") l = l.filter(s => getStatus(s.debut, s.fin) === filter);
    if (search) { const q = search.toLowerCase(); l = l.filter(s => `${s.nom} ${s.prenom} ${s.poste}`.toLowerCase().includes(q)); }
    return l.sort((a, b) => parseLocal(a.debut) - parseLocal(b.debut));
  }, [stags, filter, search]);

  const exportXL = () => {
    const d = stags.map(s => ({
      "Nom": s.nom, "Prénom": s.prenom, "Début": fmtDate(s.debut), "Fin": fmtDate(s.fin),
      "Formation / Rythme": s.poste, "Statut": SMETA[getStatus(s.debut, s.fin)].label, "Durée": dur(s.debut, s.fin),
    }));
    const ws = XLSX.utils.json_to_sheet(d);
    ws["!cols"] = [{ wch:15 },{ wch:15 },{ wch:16 },{ wch:16 },{ wch:24 },{ wch:12 },{ wch:10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stagiaires");
    XLSX.writeFile(wb, `planning_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Calendar logic (année, jauge mensuelle par stagiaire)
  const MONTHS_SHORT = ["Janv.","Févr.","Mars","Avr.","Mai","Juin","Juil.","Août","Sept.","Oct.","Nov.","Déc."];
  const navY = dir => setCalMonth(p => ({ ...p, y: p.y + dir }));

  const yearStags = useMemo(() => stags.filter(s => {
    const sd = parseLocal(s.debut), ed = parseLocal(s.fin);
    const ys = new Date(calMonth.y, 0, 1), ye = new Date(calMonth.y, 11, 31);
    return sd <= ye && ed >= ys;
  }).sort((a, b) => parseLocal(a.debut) - parseLocal(b.debut)), [stags, calMonth.y]);

  const monthOverlap = useCallback((s, m) => {
    const ms = new Date(calMonth.y, m, 1), me = new Date(calMonth.y, m + 1, 0);
    const sd = parseLocal(s.debut), ed = parseLocal(s.fin);
    if (sd > me || ed < ms) return null;
    const startsHere = sd >= ms && sd <= me;
    const endsHere = ed >= ms && ed <= me;
    const dInMonth = me.getDate();
    const left = startsHere ? (sd.getDate() - 1) / dInMonth * 100 : 0;
    const right = endsHere ? ed.getDate() / dInMonth * 100 : 100;
    return { startsHere, endsHere, left, width: right - left };
  }, [calMonth.y]);

  const monthCounts = useMemo(() => MONTHS_SHORT.map((_, m) => yearStags.filter(s => monthOverlap(s, m)).length), [yearStags, monthOverlap]);

  // Desk logic
  const getDeskStatus = id => { const a = assignments[id]; if (!a) return "free"; if (a.unavailable) return "unavailable"; return "occupied"; };
  const getDeskName = id => { const a = assignments[id]; if (!a?.stagiaireId) return null; const s = stags.find(x => x.id === a.stagiaireId); return s ? `${s.prenom} ${s.nom[0]}.` : null; };
  const assignDesk = async (did, sid) => {
    await fetch(`${API_BASE}/assignments`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ desk_id: did, stagiaire_id: sid }) });
    await fetchAssignments();
  };
  const freeDesk = async did => {
    await fetch(`${API_BASE}/assignments/${did}`, { method:"DELETE" });
    await fetchAssignments();
  };
  const markUnavail = async did => {
    await fetch(`${API_BASE}/assignments/${did}/unavailable`, { method:"PUT" });
    await fetchAssignments();
  };
  const assignedIds = useMemo(() => new Set(Object.values(assignments).filter(a => a?.stagiaireId).map(a => a.stagiaireId)), [assignments]);
  const availStags = useMemo(() => stags.filter(s => !assignedIds.has(s.id) && getStatus(s.debut, s.fin) === "active"), [stags, assignedIds]);

  const allDesks = [...GRANDE.map(d => ({ ...d, room:"Grande Salle" })), ...PETITE.map(d => ({ ...d, room:"Petite Salle" }))];
  const occCount = Object.values(assignments).filter(a => a?.stagiaireId).length;
  const unaCount = Object.values(assignments).filter(a => a?.unavailable).length;
  const freeCount = allDesks.length - occCount - unaCount;

  const NAV = [
    { id:"dashboard", label:"Tableau de bord", icon:IC.home },
    { id:"list",      label:"Stagiaires",      icon:IC.list },
    { id:"plan",      label:"Plan bureaux",    icon:IC.grid },
    { id:"calendar",  label:"Calendrier",      icon:IC.cal },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", width:"100vw", fontFamily:"'Inter',-apple-system,system-ui,sans-serif", color:T.text, background:T.pageBg, overflow:"hidden", position:"fixed", top:0, left:0 }}>
    <div style={{ flex:1, display:"flex", overflow:"hidden", minHeight:0 }}>

      {/* ── SIDEBAR ── */}
      {!isMobile && (
      <div style={{ width: collapsed ? 56 : 200, minWidth: collapsed ? 56 : 200, background:"#1a2332", display:"flex", flexDirection:"column", transition:"all 0.25s ease", overflow:"hidden", zIndex:20 }}>
        <div style={{ padding: collapsed ? "16px 12px" : "16px", display:"flex", alignItems:"center", gap:10, borderBottom:"1px solid #2d3a4d", minHeight:56 }}>
          <div style={{ width:32, height:32, borderRadius:9, background:"linear-gradient(135deg,#3b82f6,#6366f1)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:14, flexShrink:0 }}>S</div>
          {!collapsed && <span style={{ color:"#fff", fontWeight:700, fontSize:14, whiteSpace:"nowrap" }}>StagiairePlan</span>}
        </div>
        <nav style={{ flex:1, padding:"8px 0" }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              width:"100%", display:"flex", alignItems:"center", gap:10,
              padding: collapsed ? "11px 0" : "11px 16px",
              justifyContent: collapsed ? "center" : "flex-start",
              background: view === n.id ? "#2d3a4d" : "transparent",
              border:"none", cursor:"pointer",
              color: view === n.id ? "#fff" : "#8896a8",
              fontSize:13, fontWeight: view === n.id ? 600 : 400,
              borderLeft: view === n.id ? "3px solid #3b82f6" : "3px solid transparent",
              transition:"all 0.15s", textAlign:"left",
            }}>
              <SvgIcon d={n.icon} size={18}/>
              {!collapsed && <span style={{ whiteSpace:"nowrap" }}>{n.label}</span>}
            </button>
          ))}
        </nav>
        <button onClick={() => setCollapsed(p => !p)} style={{ padding:12, border:"none", borderTop:"1px solid #2d3a4d", background:"transparent", color:"#8896a8", cursor:"pointer", display:"flex", justifyContent:"center" }}>
          <SvgIcon d={collapsed ? IC.expand : IC.collapse} size={16}/>
        </button>
      </div>
      )}

      {/* ── MAIN AREA ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* Top bar */}
        <div style={{ background:T.surface, borderBottom:`1px solid ${T.border}`, padding: isMobile ? "0 12px" : "0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", minHeight:56, gap:8, flexShrink:0 }}>
          <h1 style={{ fontSize: isMobile ? 14 : 16, fontWeight:700, margin:0, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{NAV.find(n => n.id === view)?.label}</h1>
          <div style={{ display:"flex", gap: isMobile ? 6 : 8, flexShrink:0 }}>
            <button onClick={() => setDark(p => !p)} title={dark ? "Passer en thème clair" : "Passer en thème sombre"} style={iBtn(T)} aria-label="Basculer le thème">
              <SvgIcon d={dark ? IC.sun : IC.moon} size={15}/>
            </button>
            <button onClick={exportXL} style={btnO(T)}><SvgIcon d={IC.dl} size={14}/>{!isMobile && <span>Export</span>}</button>
            <button onClick={openAdd} style={btnP}><SvgIcon d={IC.plus} size={14}/>{!isMobile && <span>Stagiaire</span>}</button>
          </div>
        </div>

        <div style={{ flex:1, display:"flex", flexDirection: isNarrow ? "column" : "row", overflow: isNarrow ? "auto" : "hidden" }}>
          {/* Scrollable content */}
          <div style={{ flex:1, overflow: isNarrow ? "visible" : "auto", padding: isMobile ? 12 : 24, minWidth:0 }}>

            {/* ────── DASHBOARD ────── */}
            {view === "dashboard" && (
              <div>
                <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 24 }}>
                  {[
                    { l:"Total stagiaires", v:counts.all, c:"#6366f1", bg:"#eef2ff" },
                    { l:"En cours",         v:counts.active, c:"#22c55e", bg:"#f0fdf4" },
                    { l:"À venir",          v:counts.upcoming, c:"#3b82f6", bg:"#eff6ff" },
                    { l:"Terminé",          v:counts.completed, c:"#9ca3af", bg:"#f9fafb" },
                  ].map((c, i) => (
                    <div key={i} style={{ background:tint(c.c, dark, c.bg), border:`1px solid ${T.border}`, borderRadius:12, padding: isMobile ? "16px 14px" : "22px 24px" }}>
                      <div style={{ fontSize: isMobile ? 26 : 36, fontWeight:800, color:c.c }}>{c.v}</div>
                      <div style={{ fontSize:13, color:T.textMuted, marginTop:4, fontWeight:500 }}>{c.l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 24 }}>
                  {[
                    { l:"Bureaux occupés",  v:occCount, c:"#3b82f6", bg:"#eff6ff" },
                    { l:"Bureaux libres",   v:freeCount, c:"#22c55e", bg:"#f0fdf4" },
                  ].map((c, i) => (
                    <div key={i} style={{ background:tint(c.c, dark, c.bg), border:`1px solid ${T.border}`, borderRadius:12, padding: isMobile ? "16px 14px" : "22px 24px" }}>
                      <div style={{ fontSize: isMobile ? 26 : 36, fontWeight:800, color:c.c }}>{c.v}</div>
                      <div style={{ fontSize:13, color:T.textMuted, marginTop:4, fontWeight:500 }}>{c.l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background:T.surface, borderRadius:14, border:`1px solid ${T.border}`, padding:20 }}>
                  <div style={{ fontSize:14, fontWeight:700, marginBottom:14 }}>Stagiaires en cours</div>
                  {stags.filter(s => getStatus(s.debut, s.fin) === "active").map((s, i) => (
                    <div key={s.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderBottom:`1px solid ${T.borderLight}` }}>
                      <div style={{ width:32, height:32, borderRadius:"50%", background:ACCENT[i%ACCENT.length], color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:12, flexShrink:0 }}>{s.prenom[0]}{s.nom[0]}</div>
                      <div style={{ flex:1 }}><div style={{ fontWeight:600, fontSize:13 }}>{s.prenom} {s.nom}</div><div style={{ fontSize:11, color:T.textMuted }}>{s.poste}</div></div>
                      <div style={{ fontSize:11, color: daysLeft(s.fin) <= 7 ? "#dc2626" : T.textMuted }}>{daysLeft(s.fin) > 0 ? `${daysLeft(s.fin)}j restants` : "Dernier jour"}</div>
                    </div>
                  ))}
                  {counts.active === 0 && <div style={{ color:T.textFaint, fontSize:13 }}>Aucun stagiaire en cours</div>}
                </div>
              </div>
            )}

            {/* ────── LIST ────── */}
            {view === "list" && (
              <div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
                  <div style={{ display:"flex", gap:6 }}>
                    {[["all","Tous"],["active","En cours"],["upcoming","À venir"],["completed","Terminé"]].map(([k, l]) => (
                      <button key={k} onClick={() => setFilter(k)} style={{ padding:"5px 12px", borderRadius:7, border: filter === k ? "1.5px solid #3b82f6" : `1px solid ${T.border}`, background: filter === k ? tint("#3b82f6", dark, "#eff6ff") : T.surface, color: filter === k ? "#2563eb" : T.textMuted, fontSize:12, fontWeight:500, cursor:"pointer" }}>
                        {l} <span style={{ color: filter === k ? "#3b82f6" : T.textFaint }}>{counts[k]}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ position:"relative", flex: isMobile ? "1 1 100%" : "none" }}>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" style={{ padding:"7px 12px 7px 32px", borderRadius:8, border:`1px solid ${T.border}`, fontSize:13, width: isMobile ? "100%" : 200, outline:"none", background:T.surface, color:T.textStrong, boxSizing:"border-box" }}/>
                    <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:T.textFaint }}><SvgIcon d={IC.search} size={14}/></span>
                  </div>
                </div>
                {isMobile ? (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {filtered.length === 0 && <div style={{ padding:40, textAlign:"center", color:T.textFaint, fontSize:13, background:T.surface, borderRadius:14, border:`1px solid ${T.border}` }}>Aucun stagiaire</div>}
                    {filtered.map((s, i) => { const st = getStatus(s.debut, s.fin); const m = chipColor(SMETA[st], dark); return (
                      <div key={s.id} style={{ background:T.surface, borderRadius:14, border:`1px solid ${T.border}`, padding:14 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <div style={{ width:36, height:36, borderRadius:"50%", background:ACCENT[i%ACCENT.length], color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13, flexShrink:0 }}>{s.prenom[0]}{s.nom[0]}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontWeight:600, fontSize:14 }}>{s.prenom} {s.nom}</div>
                            <div style={{ fontSize:12, color:T.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.poste}</div>
                          </div>
                          <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:6, background:m.bg, color:m.fg, fontSize:11, fontWeight:600, flexShrink:0 }}>
                            <span style={{ width:6, height:6, borderRadius:"50%", background:m.dot }}/>{SMETA[st].label}
                          </span>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:10, paddingTop:10, borderTop:`1px solid ${T.borderLight}` }}>
                          <div style={{ fontSize:12, color:T.textMuted }}>
                            {fmtDate(s.debut)} → {fmtDate(s.fin)} · {dur(s.debut, s.fin)}
                            {st === "active" && <div style={{ color: daysLeft(s.fin) <= 7 ? "#dc2626" : T.textMuted, marginTop:2 }}>{daysLeft(s.fin) > 0 ? `${daysLeft(s.fin)}j restants` : "Dernier jour"}</div>}
                          </div>
                          <div style={{ display:"flex", gap:4 }}>
                            <button onClick={() => openEdit(s)} style={iBtn(T)}><SvgIcon d={IC.edit} size={13}/></button>
                            <button onClick={() => remove(s.id)} style={{ ...iBtn(T), color:"#ef4444" }}><SvgIcon d={IC.trash} size={13}/></button>
                          </div>
                        </div>
                      </div>
                    ); })}
                  </div>
                ) : (
                <div style={{ background:T.surface, borderRadius:14, border:`1px solid ${T.border}`, overflow:"hidden" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"2fr 1.6fr 1fr 0.8fr 0.8fr 70px", gap:8, padding:"10px 16px", background:T.surfaceAlt, borderBottom:`1px solid ${T.border}`, fontSize:11, fontWeight:600, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.04em" }}>
                    <span>Stagiaire</span><span>Formation / Rythme</span><span>Période</span><span>Durée</span><span>Statut</span><span></span>
                  </div>
                  {filtered.length === 0 && <div style={{ padding:40, textAlign:"center", color:T.textFaint, fontSize:13 }}>Aucun stagiaire</div>}
                  {filtered.map((s, i) => { const st = getStatus(s.debut, s.fin); const m = chipColor(SMETA[st], dark); return (
                    <div key={s.id} style={{ display:"grid", gridTemplateColumns:"2fr 1.6fr 1fr 0.8fr 0.8fr 70px", gap:8, padding:"11px 16px", borderBottom:`1px solid ${T.borderLight}`, alignItems:"center", fontSize:13 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:32, height:32, borderRadius:"50%", background:ACCENT[i%ACCENT.length], color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:12, flexShrink:0 }}>{s.prenom[0]}{s.nom[0]}</div>
                        <div><div style={{ fontWeight:600 }}>{s.prenom} {s.nom}</div>{st === "active" && <div style={{ fontSize:11, color: daysLeft(s.fin) <= 7 ? "#dc2626" : T.textMuted }}>{daysLeft(s.fin) > 0 ? `${daysLeft(s.fin)}j restants` : "Dernier jour"}</div>}</div>
                      </div>
                      <span style={{ color:T.text }}>{s.poste}</span>
                      <span style={{ color:T.textMuted, fontSize:12 }}>{fmtDate(s.debut)} → {fmtDate(s.fin)}</span>
                      <span style={{ color:T.textMuted, fontSize:12 }}>{dur(s.debut, s.fin)}</span>
                      <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:6, background:m.bg, color:m.fg, fontSize:11, fontWeight:600, width:"fit-content" }}>
                        <span style={{ width:6, height:6, borderRadius:"50%", background:m.dot }}/>{SMETA[st].label}
                      </span>
                      <div style={{ display:"flex", gap:4, justifyContent:"flex-end" }}>
                        <button onClick={() => openEdit(s)} style={iBtn(T)}><SvgIcon d={IC.edit} size={13}/></button>
                        <button onClick={() => remove(s.id)} style={{ ...iBtn(T), color:"#ef4444" }}><SvgIcon d={IC.trash} size={13}/></button>
                      </div>
                    </div>
                  ); })}
                </div>
                )}
              </div>
            )}

            {/* ────── FLOOR PLAN ────── */}
            {view === "plan" && (
              <div>
                {/* Legend */}
                <div style={{ display:"flex", gap:20, marginBottom:16, alignItems:"center", flexWrap:"wrap" }}>
                  {[["Occupé","#3b82f6"],["Libre","#22c55e"],["Indisponible","#cbd5e1"]].map(([l, c]) => (
                    <div key={l} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:T.text }}>
                      <div style={{ width:14, height:14, borderRadius:4, background:c, opacity:0.7 }}/>{l}
                    </div>
                  ))}
                  <div style={{ marginLeft:"auto", fontSize:12, color:T.textMuted }}>
                    {occCount} occupé{occCount > 1 ? "s" : ""} · {freeCount} libre{freeCount > 1 ? "s" : ""} · {unaCount} indispo.
                  </div>
                </div>

                <div style={{ display:"flex", gap: isMobile ? 24 : 72, flexWrap:"wrap", justifyContent: isNarrow ? "flex-start" : "center" }}>
                  {/* GRANDE SALLE */}
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:"#6366f1" }}/>
                      Grande Salle
                      <span style={{ fontSize:11, fontWeight:400, color:T.textFaint }}>— 5 postes</span>
                    </div>
                    <div style={{ position:"relative", width:440, height:430 }}
                      onClick={() => { setSelDesk(null); setDeskModal(false); }}>
                      {/* Walls */}
                      <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:T.wall, borderRadius:"10px 10px 0 0" }}/>
                      <div style={{ position:"absolute", top:0, left:0, bottom:0, width:3, background:T.wall, borderRadius:"10px 0 0 10px" }}/>
                      <div style={{ position:"absolute", bottom:0, left:0, right:0, height:3, background:T.wall, borderRadius:"0 0 10px 10px" }}/>
                      {/* Right wall with door gap, facing the Petite Salle */}
                      <div style={{ position:"absolute", top:0, right:0, width:3, height:"42%", background:T.wall, borderRadius:"0 10px 0 0" }}/>
                      <div style={{ position:"absolute", bottom:0, right:0, width:3, height:"42%", background:T.wall, borderRadius:"0 0 10px 0" }}/>
                      {/* Floor fill */}
                      <div style={{ position:"absolute", top:3, left:3, right:3, bottom:3, background:T.floorBg, borderRadius:7 }}/>
                      {/* Door label */}
                      <div style={{ position:"absolute", right:6, top:"50%", transform:"translateY(-50%)", fontSize:10, color:T.textFaint, fontWeight:500, letterSpacing:"0.04em" }}>Porte ▷</div>
                      {/* Desks */}
                      {GRANDE.map(d => (
                        <DeskUnit key={d.id} desk={d} status={getDeskStatus(d.id)} name={getDeskName(d.id)} dark={dark}
                          isSelected={selDesk === d.id}
                          onClick={dk => { setSelDesk(dk.id); setDeskModal(true); }}/>
                      ))}
                    </div>
                  </div>

                  {/* PETITE SALLE */}
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:"#ec4899" }}/>
                      Petite Salle
                      <span style={{ fontSize:11, fontWeight:400, color:T.textFaint }}>— 6 postes</span>
                    </div>
                    <div style={{ position:"relative", width:380, height:430 }}
                      onClick={() => { setSelDesk(null); setDeskModal(false); }}>
                      <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:T.wall, borderRadius:"10px 10px 0 0" }}/>
                      <div style={{ position:"absolute", top:0, left:0, width:3, height:"42%", background:T.wall, borderRadius:"10px 0 0 0" }}/>
                      <div style={{ position:"absolute", bottom:0, left:0, width:3, height:"42%", background:T.wall, borderRadius:"0 0 0 10px" }}/>
                      <div style={{ position:"absolute", top:0, right:0, bottom:0, width:3, background:T.wall, borderRadius:"0 10px 10px 0" }}/>
                      <div style={{ position:"absolute", bottom:0, left:0, right:0, height:3, background:T.wall, borderRadius:"0 0 10px 10px" }}/>
                      <div style={{ position:"absolute", top:3, left:3, right:3, bottom:3, background:T.floorBg, borderRadius:7 }}/>
                      <div style={{ position:"absolute", left:6, top:"50%", transform:"translateY(-50%)", fontSize:10, color:T.textFaint, fontWeight:500, letterSpacing:"0.04em" }}>◁ Porte</div>
                      {PETITE.map(d => (
                        <DeskUnit key={d.id} desk={d} status={getDeskStatus(d.id)} name={getDeskName(d.id)} dark={dark}
                          isSelected={selDesk === d.id}
                          onClick={dk => { setSelDesk(dk.id); setDeskModal(true); }}/>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ────── CALENDAR ────── */}
            {view === "calendar" && (
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:T.surface, borderRadius:12, border:`1px solid ${T.border}`, padding:"10px 16px" }}>
                  <button onClick={() => navY(-1)} style={nBtn(T)}><SvgIcon d={IC.chevL} size={16}/></button>
                  <span style={{ fontWeight:700, fontSize:15 }}>{calMonth.y}</span>
                  <button onClick={() => navY(1)} style={nBtn(T)}><SvgIcon d={IC.chevR} size={16}/></button>
                </div>
                <div style={{ background:T.surface, borderRadius:14, border:`1px solid ${T.border}`, overflow:"auto" }}>
                  <div style={{ minWidth:1180 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"90px 110px 110px 150px repeat(12,1fr)", background:T.surfaceAlt, borderBottom:`1px solid ${T.border}` }}>
                      {["Statut","Prénom","Nom","Formation / Rythme"].map(h => (
                        <div key={h} style={{ padding:"9px 10px", fontSize:11, fontWeight:600, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.03em" }}>{h}</div>
                      ))}
                      {MONTHS_SHORT.map(m => (
                        <div key={m} style={{ padding:"9px 4px", fontSize:11, fontWeight:600, color:T.textMuted, textAlign:"center", borderLeft:`1px solid ${T.borderLight}` }}>{m}</div>
                      ))}
                    </div>
                    {yearStags.length === 0 && <div style={{ padding:30, textAlign:"center", color:T.textFaint, fontSize:13 }}>Aucun stagiaire sur {calMonth.y}</div>}
                    {yearStags.map(s => {
                      const idx = stags.findIndex(x => x.id === s.id); const color = ACCENT[idx%ACCENT.length];
                      const st = getStatus(s.debut, s.fin); const m = chipColor(SMETA[st], dark);
                      return (
                        <div key={s.id} style={{ display:"grid", gridTemplateColumns:"90px 110px 110px 150px repeat(12,1fr)", borderBottom:`1px solid ${T.borderLight}`, alignItems:"center", minHeight:34 }}>
                          <div style={{ padding:"0 10px" }}>
                            <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:6, background:m.bg, color:m.fg, fontSize:10, fontWeight:600 }}>
                              <span style={{ width:6, height:6, borderRadius:"50%", background:m.dot }}/>{SMETA[st].label}
                            </span>
                          </div>
                          <div style={{ padding:"0 10px", fontSize:12, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.prenom}</div>
                          <div style={{ padding:"0 10px", fontSize:12, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.nom}</div>
                          <div style={{ padding:"0 10px", fontSize:12, color:T.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.poste}</div>
                          {MONTHS_SHORT.map((_, mi) => {
                            const o = monthOverlap(s, mi);
                            const sd = parseLocal(s.debut), ed = parseLocal(s.fin);
                            return (
                              <div key={mi} style={{ position:"relative", height:22, borderLeft:`1px solid ${T.borderLight}` }}>
                                {o && (
                                  <div style={{
                                    position:"absolute", left:`${o.left}%`, width:`${o.width}%`, top:0, bottom:0,
                                    background:`${color}22`,
                                    borderRadius: o.startsHere && o.endsHere ? 3 : o.startsHere ? "3px 0 0 3px" : o.endsHere ? "0 3px 3px 0" : 0,
                                    borderLeft: o.startsHere ? `2.5px solid ${color}` : "none",
                                    zIndex: (o.startsHere || o.endsHere) ? 1 : 0,
                                  }}>
                                    {(o.startsHere || o.endsHere) && (
                                      <span style={{
                                        position:"absolute", top:"50%", whiteSpace:"nowrap",
                                        fontSize:9, fontWeight:700, color,
                                        ...(o.startsHere && o.endsHere
                                          ? { left:"50%", transform:"translate(-50%,-50%)" }
                                          : o.startsHere
                                          ? { left:4, transform:"translateY(-50%)" }
                                          : { right:4, transform:"translateY(-50%)" }),
                                      }}>
                                        {o.startsHere && o.endsHere
                                          ? `${String(sd.getDate()).padStart(2,"0")}–${String(ed.getDate()).padStart(2,"0")}`
                                          : o.startsHere
                                          ? `${String(sd.getDate()).padStart(2,"0")}.${String(sd.getMonth()+1).padStart(2,"0")}`
                                          : `${String(ed.getDate()).padStart(2,"0")}.${String(ed.getMonth()+1).padStart(2,"0")}`}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    {yearStags.length > 0 && (
                      <div style={{ display:"grid", gridTemplateColumns:"90px 110px 110px 150px repeat(12,1fr)", background:T.surfaceAlt, borderTop:`1px solid ${T.border}` }}>
                        <div style={{ gridColumn:"1 / span 4", padding:"8px 10px", fontSize:11, fontWeight:700, color:T.text }}>Total / mois</div>
                        {monthCounts.map((c, i) => (
                          <div key={i} style={{ textAlign:"center", padding:"8px 4px", fontSize:12, fontWeight:700, color: c > 0 ? "#2563eb" : T.textFaint }}>{c || "—"}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT PANEL (plan view) ── */}
          {view === "plan" && (
            <div style={{ width: isNarrow ? "100%" : 272, minWidth: isNarrow ? 0 : 272, borderLeft: isNarrow ? "none" : `1px solid ${T.border}`, borderTop: isNarrow ? `1px solid ${T.border}` : "none", background:T.surface, overflow: isNarrow ? "visible" : "auto", flexShrink:0 }}>
              <div style={{ padding:"16px 16px 10px", borderBottom:`1px solid ${T.borderLight}` }}>
                <div style={{ fontSize:14, fontWeight:700 }}>Affectations</div>
                <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>{occCount} / {allDesks.length} postes attribués</div>
              </div>
              {["Grande Salle", "Petite Salle"].map(room => {
                const desks = allDesks.filter(d => d.room === room);
                return (
                  <div key={room}>
                    <div style={{ padding:"10px 16px 4px", fontSize:11, fontWeight:700, color:T.textFaint, textTransform:"uppercase", letterSpacing:"0.04em" }}>{room}</div>
                    {desks.map(d => {
                      const st = getDeskStatus(d.id); const nm = getDeskName(d.id); const c = deskColor(st, dark);
                      return (
                        <button key={d.id} onClick={() => { setSelDesk(d.id); setDeskModal(true); }}
                          style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"8px 16px", border:"none", background: selDesk === d.id ? tint("#3b82f6", dark, "#f0f4ff") : "transparent", cursor:"pointer", textAlign:"left", borderBottom:`1px solid ${T.borderLight}`, transition:"background 0.1s" }}>
                          <div style={{ width:10, height:10, borderRadius:3, background:c.border, flexShrink:0 }}/>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:12, fontWeight:600 }}>{d.label}</div>
                            <div style={{ fontSize:11, color: st === "occupied" ? c.text : T.textFaint, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {st === "occupied" ? nm : st === "unavailable" ? "Indisponible" : "Libre"}
                            </div>
                          </div>
                          <div style={{ width:8, height:8, borderRadius:"50%", background:c.border, opacity:0.5 }}/>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              <div style={{ padding:"12px 16px 4px", fontSize:11, fontWeight:700, color:T.textFaint, textTransform:"uppercase", letterSpacing:"0.04em", borderTop:`1px solid ${T.border}`, marginTop:4 }}>
                Non affectés ({availStags.length})
              </div>
              {availStags.length === 0 && <div style={{ padding:"8px 16px", fontSize:12, color:T.textFaint }}>Tous affectés</div>}
              {availStags.map(s => (
                <div key={s.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 16px" }}>
                  <div style={{ width:24, height:24, borderRadius:"50%", background:ACCENT[stags.indexOf(s) % ACCENT.length], color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:9, flexShrink:0 }}>{s.prenom[0]}{s.nom[0]}</div>
                  <div style={{ fontSize:12, fontWeight:500 }}>{s.prenom} {s.nom}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      {isMobile && (
        <nav style={{ display:"flex", background:"#1a2332", borderTop:"1px solid #2d3a4d", flexShrink:0 }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3,
              padding:"8px 4px", background:"transparent", border:"none", cursor:"pointer",
              color: view === n.id ? "#fff" : "#8896a8",
              borderTop: view === n.id ? "2px solid #3b82f6" : "2px solid transparent",
            }}>
              <SvgIcon d={n.icon} size={18}/>
              <span style={{ fontSize:10, fontWeight: view === n.id ? 600 : 400, whiteSpace:"nowrap" }}>{n.label}</span>
            </button>
          ))}
        </nav>
      )}

      {/* ── DESK MODAL ── */}
      {deskModal && selDesk && (
        <div style={{ position:"fixed", inset:0, background:T.overlay, display:"flex", alignItems:"center", justifyContent:"center", zIndex:50, padding:16 }}
          onClick={() => { setDeskModal(false); setSelDesk(null); }}>
          <div onClick={e => e.stopPropagation()} style={{ background:T.surface, borderRadius:16, width:"100%", maxWidth:380, boxShadow:"0 24px 48px rgba(0,0,0,0.18)", overflow:"hidden" }}>
            {(() => {
              const desk = allDesks.find(d => d.id === selDesk);
              const st = getDeskStatus(selDesk);
              const a = assignments[selDesk];
              const assignee = a?.stagiaireId ? stags.find(s => s.id === a.stagiaireId) : null;
              const c = deskColor(st, dark);
              return (<>
                <div style={{ padding:"16px 20px", borderBottom:`1px solid ${T.borderLight}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div>
                    <div style={{ fontSize:15, fontWeight:700 }}>{desk.label} — {desk.room}</div>
                    <div style={{ display:"inline-flex", alignItems:"center", gap:5, marginTop:4, padding:"3px 8px", borderRadius:5, background:c.bg, fontSize:11, fontWeight:600, color:c.text }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background:c.border }}/>{st === "occupied" ? "Occupé" : st === "free" ? "Libre" : "Indisponible"}
                    </div>
                  </div>
                  <button onClick={() => { setDeskModal(false); setSelDesk(null); }} style={{ width:30, height:30, borderRadius:8, border:`1px solid ${T.border}`, background:T.surface, color:T.text, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <SvgIcon d={IC.x} size={14}/>
                  </button>
                </div>
                <div style={{ padding:"16px 20px" }}>
                  {st === "occupied" && assignee && (
                    <div style={{ marginBottom:16 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:T.textMuted, marginBottom:6 }}>Affecté à</div>
                      <div style={{ display:"flex", alignItems:"center", gap:10, padding:10, background:T.floorBg, borderRadius:10, border:`1px solid ${T.border}` }}>
                        <div style={{ width:36, height:36, borderRadius:"50%", background:"#3b82f6", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13 }}>{assignee.prenom[0]}{assignee.nom[0]}</div>
                        <div><div style={{ fontWeight:600, fontSize:13 }}>{assignee.prenom} {assignee.nom}</div><div style={{ fontSize:11, color:T.textMuted }}>{fmtDate(assignee.debut)} → {fmtDate(assignee.fin)}</div></div>
                      </div>
                      <button onClick={() => freeDesk(selDesk)} style={{ ...btnO(T), width:"100%", justifyContent:"center", marginTop:10, color:"#ef4444", borderColor:"#fecaca" }}>
                        <SvgIcon d={IC.trash} size={13}/><span>Libérer le poste</span>
                      </button>
                    </div>
                  )}
                  {st === "unavailable" && (
                    <div style={{ marginBottom:16 }}>
                      <div style={{ padding:14, background:T.surfaceAlt, borderRadius:10, textAlign:"center", color:T.textMuted, fontSize:13, marginBottom:10 }}>Ce poste est marqué indisponible</div>
                      <button onClick={() => freeDesk(selDesk)} style={{ ...btnO(T), width:"100%", justifyContent:"center" }}>
                        <SvgIcon d={IC.check} size={13}/><span>Rendre disponible</span>
                      </button>
                    </div>
                  )}
                  {(st === "free" || st === "occupied") && (<>
                    <div style={{ fontSize:12, fontWeight:600, color:T.textMuted, marginBottom:6 }}>{st === "occupied" ? "Réaffecter" : "Affecter un stagiaire"}</div>
                    {availStags.length === 0 && !assignee ? (
                      <div style={{ padding:14, background:T.surfaceAlt, borderRadius:10, textAlign:"center", color:T.textFaint, fontSize:13 }}>Aucun stagiaire disponible</div>
                    ) : (
                      <div style={{ maxHeight:200, overflow:"auto", border:`1px solid ${T.border}`, borderRadius:10 }}>
                        {availStags.map(s => (
                          <button key={s.id} onClick={() => { assignDesk(selDesk, s.id); setDeskModal(false); setSelDesk(null); }}
                            style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 12px", border:"none", background:T.surface, cursor:"pointer", borderBottom:`1px solid ${T.borderLight}`, textAlign:"left", color:T.textStrong }}>
                            <div style={{ width:28, height:28, borderRadius:"50%", background:ACCENT[stags.indexOf(s) % ACCENT.length], color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:10, flexShrink:0 }}>{s.prenom[0]}{s.nom[0]}</div>
                            <div style={{ fontSize:13, fontWeight:600 }}>{s.prenom} {s.nom}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>)}
                  {st === "free" && (
                    <button onClick={() => { markUnavail(selDesk); setDeskModal(false); setSelDesk(null); }}
                      style={{ ...btnO(T), width:"100%", justifyContent:"center", marginTop:10, color:T.textMuted }}>
                      <SvgIcon d={IC.ban} size={13}/><span>Marquer indisponible</span>
                    </button>
                  )}
                </div>
              </>);
            })()}
          </div>
        </div>
      )}

      {/* ── STAGIAIRE FORM MODAL ── */}
      {showForm && (
        <div style={{ position:"fixed", inset:0, background:T.overlayStrong, display:"flex", alignItems:"center", justifyContent:"center", zIndex:50, padding:16 }}>
          <div style={{ background:T.surface, borderRadius:16, padding:24, width:"100%", maxWidth:420, boxShadow:"0 24px 48px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize:17, fontWeight:700, marginBottom:20 }}>{editId ? "Modifier le stagiaire" : "Nouveau stagiaire"}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div><label style={lbl(T)}>Prénom</label><input value={form.prenom} onChange={e => setForm(f => ({ ...f, prenom: e.target.value }))} style={inp(T)} placeholder="Ex: Marie"/></div>
                <div><label style={lbl(T)}>Nom</label><input value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} style={inp(T)} placeholder="Ex: Curie"/></div>
              </div>
              <div><label style={lbl(T)}>Formation / Rythme</label><input value={form.poste} onChange={e => setForm(f => ({ ...f, poste: e.target.value }))} style={inp(T)} placeholder="Ex: EFB -14h/18h"/></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div><label style={lbl(T)}>Date de début</label><input type="date" value={form.debut} onChange={e => setForm(f => ({ ...f, debut: e.target.value }))} style={inp(T)}/></div>
                <div><label style={lbl(T)}>Date de fin</label><input type="date" value={form.fin} onChange={e => setForm(f => ({ ...f, fin: e.target.value }))} style={inp(T)}/></div>
              </div>
              {form.debut && form.fin && new Date(form.fin) < new Date(form.debut) && (
                <div style={{ fontSize:12, color:"#dc2626", background:tint("#dc2626", dark, "#fef2f2"), padding:"6px 10px", borderRadius:6 }}>La date de fin doit être postérieure à la date de début.</div>
              )}
              {formError && (
                <div style={{ fontSize:12, color:"#dc2626", background:tint("#dc2626", dark, "#fef2f2"), padding:"6px 10px", borderRadius:6 }}>{formError}</div>
              )}
            </div>
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={btnO(T)}>Annuler</button>
              <button onClick={save}
                disabled={!form.nom || !form.prenom || !form.debut || !form.fin || new Date(form.fin) < new Date(form.debut)}
                style={{ ...btnP, opacity: (!form.nom || !form.prenom || !form.debut || !form.fin || new Date(form.fin) < new Date(form.debut)) ? 0.5 : 1 }}>
                {editId ? "Enregistrer" : "Ajouter"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnP = { padding:"8px 16px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#3b82f6,#6366f1)", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:600, display:"flex", alignItems:"center", gap:6 };
const btnO = T => ({ padding:"8px 14px", borderRadius:8, border:`1px solid ${T.border}`, background:T.surface, cursor:"pointer", fontSize:13, fontWeight:500, color:T.text, display:"flex", alignItems:"center", gap:6 });
const iBtn = T => ({ width:28, height:28, borderRadius:6, border:`1px solid ${T.border}`, background:T.surface, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:T.textMuted });
const nBtn = T => ({ width:32, height:32, borderRadius:8, border:`1px solid ${T.border}`, background:T.surface, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:T.text });
const inp = T => ({ padding:"8px 12px", borderRadius:8, border:`1px solid ${T.border}`, fontSize:13, width:"100%", outline:"none", boxSizing:"border-box", background:T.inputBg, color: T.textStrong, caretColor: T.textStrong });
const lbl = T => ({ fontSize:12, fontWeight:600, color:T.textMuted, display:"block", marginBottom:4 });
