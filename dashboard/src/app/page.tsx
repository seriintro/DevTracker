"use client";
import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, LineChart, Line, Area, AreaChart,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AppRow    { app: string; total_seconds: number; sessions: number }
interface DayRow    { day: string; total_seconds: number }
interface DetailRow { app: string; detail: string; total_seconds: number }
interface RecentRow { app: string; title: string; detail: string; category: string; started: string; duration: number }
interface HourRow   { hour: string; seconds: number }
interface ProjectFile { file: string; seconds: number }
interface Project    { project: string; path: string; app: string; seconds: number; topFiles: ProjectFile[] }

interface TreeFile  { name: string; seconds: number }
interface TreeNode  { seconds: number; files: TreeFile[]; dirs: Record<string, TreeNode> }

interface LangEntry  { lang: string; seconds: number; pct: number }
interface BookmarkedProject {
  project: string; path: string; app: string; seconds: number;
  tree: TreeNode;
  dailySeconds:  { day: string; seconds: number }[];
  hourly:        { hour: number; seconds: number }[];
  activeDays:    number;
  avgPerDay:     number;
  peakWindow:    string | null;
  bestDay:       { day: string | null; seconds: number };
  firstSeen:     string | null;
  lastSeen:      string | null;
  languages:     LangEntry[];
  weekLangs:     LangEntry[];
}
interface LangRow    { language: string; seconds: number }
interface SiteRow    { site: string; seconds: number }
interface Bookmark   { path: string; display: string; added: string }

interface Stats {
  topApps: AppRow[]; dailyTotals: DayRow[];
  categoryBreakdown: Record<string, number>;
  topDetails: DetailRow[]; recentActivity: RecentRow[];
  todayTotal: number; streak: number; focusScore: number;
  lastApp: string | null; lastDetail: string | null; lastUpdated: string | null;
}
interface ProjectsData {
  projects: Project[];
  topSites: SiteRow[];
  languages: LangRow[];
}
interface HourlyData { hourly: HourRow[] }

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (s: number) => {
  if (!s) return "0s";
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtS = (s: number) =>
  s >= 3600 ? `${(s / 3600).toFixed(1)}h` : s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`;
const fmtT = (iso: string) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
};

function getIcon(app: string): string {
  const a = app.toLowerCase();
  if (/chrome|firefox|edge|brave|opera|vivaldi|safari|arc|browser/.test(a)) return "🌐";
  if (/code|vscode|studio|idea|pycharm|webstorm|clion|sublime|atom|cursor|zed|notepad\+\+/.test(a)) return "⌨️";
  if (/notepad|wordpad|word|writer/.test(a)) return "📄";
  if (/terminal|cmd|powershell|bash|zsh|wt|alacritty|iterm|hyper|conhost/.test(a)) return "🖥️";
  if (/slack|discord|teams|telegram|whatsapp|zoom|skype|signal/.test(a)) return "💬";
  if (/spotify|music|itunes|vlc|mpv|winamp/.test(a)) return "🎵";
  if (/figma|sketch|xd|canva|photoshop|illustrator|inkscape/.test(a)) return "🎨";
  if (/excel|sheets|calc/.test(a)) return "📊";
  if (/outlook|thunderbird|mail/.test(a)) return "📧";
  if (/notion|obsidian|onenote|evernote/.test(a)) return "📝";
  if (/explorer|finder|files|nautilus/.test(a)) return "📁";
  if (/steam|epic|rocketleague|minecraft|game|play/.test(a)) return "🎮";
  if (/snip|screenshot|photos|preview/.test(a)) return "📷";
  return "📦";
}

function getLangIcon(lang: string): string {
  const l = lang.toLowerCase();
  if (/python/.test(l)) return "🐍";
  if (/typescript|react/.test(l)) return "⚛️";
  if (/javascript/.test(l)) return "🟨";
  if (/html/.test(l)) return "🌐";
  if (/css|scss/.test(l)) return "🎨";
  if (/markdown/.test(l)) return "📝";
  if (/shell/.test(l)) return "🖥️";
  if (/json|yaml|toml/.test(l)) return "⚙️";
  if (/go/.test(l)) return "🐹";
  if (/rust/.test(l)) return "🦀";
  if (/java/.test(l)) return "☕";
  if (/sql/.test(l)) return "🗄️";
  return "💾";
}

function getFileIcon(fname: string): string {
  if (/\.py$/.test(fname)) return "🐍";
  if (/\.tsx?$/.test(fname)) return "⚛️";
  if (/\.jsx?$/.test(fname)) return "🟨";
  if (/\.html$/.test(fname)) return "🌐";
  if (/\.css|\.scss/.test(fname)) return "🎨";
  if (/\.md$/.test(fname)) return "📝";
  return "💾";
}

const PALETTE = ["#00ff9d", "#00c8ff", "#ff6b6b", "#ffd93d", "#c77dff", "#ff9a3c", "#ff6fd8", "#3cffd0"];

const CAT_COLORS: Record<string, string> = {
  code:          "#00ff9d",
  browse:        "#00c8ff",
  productivity:  "#ffd93d",
  communication: "#c77dff",
  social:        "#ff9a3c",
  media:         "#ff6fd8",
  other:         "#4a5568",
};

function catColor(cat: string) { return CAT_COLORS[cat] || "#4a5568"; }

function Tip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f1420", border: "1px solid rgba(0,255,157,0.2)", borderRadius: 6, padding: "7px 11px", fontSize: 11 }}>
      <div style={{ color: "#4a5568", marginBottom: 3 }}>{label}</div>
      <div style={{ color: PALETTE[0] }}>{fmtS(payload[0].value)}</div>
    </div>
  );
}

function HeatmapBar({ hour, seconds, max }: { hour: string; seconds: number; max: number }) {
  const pct  = max > 0 ? seconds / max : 0;
  const h    = parseInt(hour);
  const ampm = h < 12 ? `${h === 0 ? 12 : h}am` : `${h === 12 ? 12 : h - 12}pm`;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
      <div style={{ width: "100%", height: 60, background: "rgba(255,255,255,.04)", borderRadius: 3, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: `${pct * 100}%`,
          background: pct > 0.7
            ? "linear-gradient(0deg,#00ff9d,#ffd93d)"
            : pct > 0.3
              ? "linear-gradient(0deg,#00c8ff,#00ff9d)"
              : "rgba(0,255,157,.4)",
          borderRadius: "3px 3px 0 0",
          transition: "height .4s ease",
        }} />
      </div>
      {[0, 6, 12, 18, 23].includes(h)
        ? <div style={{ fontSize: 8, color: "#4a5568", whiteSpace: "nowrap" }}>{ampm}</div>
        : <div style={{ height: 12 }} />
      }
    </div>
  );
}

// ── Language colours ─────────────────────────────────────────────────────────
const LANG_COLORS: Record<string, string> = {
  "Python":          "#3572A5",
  "JavaScript":      "#f1e05a",
  "TypeScript":      "#2b7489",
  "TypeScript/React":"#61dafb",
  "JavaScript/React":"#f7df1e",
  "HTML":            "#e34c26",
  "CSS":             "#563d7c",
  "SCSS":            "#c6538c",
  "JSON":            "#40bf77",
  "Markdown":        "#083fa1",
  "Shell":           "#89e051",
  "Go":              "#00ADD8",
  "Rust":            "#dea584",
  "C++":             "#f34b7d",
  "C":               "#555555",
  "C/C++":           "#f34b7d",
  "Java":            "#b07219",
  "Kotlin":          "#A97BFF",
  "Ruby":            "#701516",
  "PHP":             "#4F5D95",
  "SQL":             "#e38c00",
  "YAML":            "#cb171e",
  "TOML":            "#9c4221",
  "Config":          "#6e7681",
  "Vue":             "#41b883",
  "Svelte":          "#ff3e00",
  "Dart":            "#00B4AB",
  "Swift":           "#FA7343",
  "C#":              "#239120",
  "Elixir":          "#6e4a7e",
  "R":               "#276DC3",
};
function langColor(lang: string) { return LANG_COLORS[lang] || "#4a5568"; }

// ── Language bar (WakaTime-style █ block bar) ────────────────────────────────
function LangBar({ lang, pct, seconds }: { lang: string; pct: number; seconds: number }) {
  const color  = langColor(lang);
  const filled = Math.round(pct / 10);   // 0-10 blocks
  const empty  = 10 - filled;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,.03)" }}>
      <span style={{ fontSize: 10, color: "#94a3b8", width: 110, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lang}</span>
      <span style={{ fontFamily: "monospace", fontSize: 13, letterSpacing: 1, flexShrink: 0 }}>
        <span style={{ color }}> {"█".repeat(filled)}</span>
        <span style={{ color: "rgba(255,255,255,.08)" }}>{"█".repeat(empty)}</span>
      </span>
      <span style={{ fontSize: 10, color: "#4a5568", marginLeft: "auto", flexShrink: 0 }}>{pct}%</span>
      <span style={{ fontSize: 10, color, fontWeight: 600, minWidth: 36, textAlign: "right", flexShrink: 0 }}>{fmtS(seconds)}</span>
    </div>
  );
}

// ── Mini hourly heatmap for a project ────────────────────────────────────────
function MiniHeatmap({ hourly }: { hourly: { hour: number; seconds: number }[] }) {
  const max = Math.max(...hourly.map(h => h.seconds), 1);
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 32 }}>
      {hourly.map(h => {
        const pct = h.seconds / max;
        return (
          <div key={h.hour} title={`${h.hour}:00 — ${fmtS(h.seconds)}`} style={{
            flex: 1, height: `${Math.max(pct * 100, pct > 0 ? 8 : 0)}%`,
            minHeight: pct > 0 ? 2 : 0,
            background: pct > 0.7
              ? "linear-gradient(0deg,#ffd700,#00ff9d)"
              : pct > 0.3 ? "#ffd700" : "rgba(255,215,0,.5)",
            borderRadius: "2px 2px 0 0",
          }} />
        );
      })}
    </div>
  );
}

// ── File Tree ────────────────────────────────────────────────────────────────
function FileTree({ node, maxSecs, depth = 0 }: { node: TreeNode; maxSecs: number; depth?: number }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (name: string) => setCollapsed(prev => {
    const s = new Set(prev);
    s.has(name) ? s.delete(name) : s.add(name);
    return s;
  });

  const indent = depth * 16;
  const hasContent = node.files.length > 0 || Object.keys(node.dirs).length > 0;
  if (!hasContent) return <div style={{ fontSize: 10, color: "#2d3748", paddingLeft: indent }}>No files tracked yet</div>;

  return (
    <div>
      {/* Subdirectories first */}
      {Object.entries(node.dirs)
        .sort((a, b) => b[1].seconds - a[1].seconds)
        .map(([dirName, child]) => {
          const isCollapsed = collapsed.has(dirName);
          return (
            <div key={dirName}>
              {/* Dir row */}
              <div
                onClick={() => toggle(dirName)}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "5px 0", paddingLeft: indent,
                  cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,.03)",
                }}
              >
                <span style={{ fontSize: 11, width: 14, textAlign: "center", color: "#ffd700", flexShrink: 0 }}>
                  {isCollapsed ? "▶" : "▼"}
                </span>
                <span style={{ fontSize: 12, flexShrink: 0 }}>📁</span>
                <span style={{ flex: 1, fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{dirName}/</span>
                {/* Time bar */}
                <div style={{ width: 60, height: 2, background: "rgba(255,255,255,.06)", borderRadius: 2, flexShrink: 0 }}>
                  <div style={{ height: 2, borderRadius: 2, background: "linear-gradient(90deg,#ffd700,#00ff9d)", width: `${(child.seconds / maxSecs) * 100}%` }} />
                </div>
                <span style={{ fontSize: 10, color: "#ffd700", fontWeight: 600, minWidth: 36, textAlign: "right", flexShrink: 0 }}>{fmtS(child.seconds)}</span>
              </div>
              {/* Recurse */}
              {!isCollapsed && (
                <FileTree node={child} maxSecs={maxSecs} depth={depth + 1} />
              )}
            </div>
          );
        })}
      {/* Files */}
      {node.files.map(f => (
        <div key={f.name} style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "4px 0", paddingLeft: indent + 21,
          borderBottom: "1px solid rgba(255,255,255,.03)",
        }}>
          <span style={{ fontSize: 11, flexShrink: 0 }}>{getFileIcon(f.name)}</span>
          <span style={{ flex: 1, fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
          <div style={{ width: 60, height: 2, background: "rgba(255,255,255,.06)", borderRadius: 2, flexShrink: 0 }}>
            <div style={{ height: 2, borderRadius: 2, background: "#00c8ff", width: `${(f.seconds / maxSecs) * 100}%` }} />
          </div>
          <span style={{ fontSize: 10, color: "#00c8ff", fontWeight: 600, minWidth: 36, textAlign: "right", flexShrink: 0 }}>{fmtS(f.seconds)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stats,    setStats]    = useState<Stats | null>(null);
  const [projects, setProjects] = useState<ProjectsData | null>(null);
  const [hourly,   setHourly]   = useState<HourlyData | null>(null);
  const [bookmarkedProjects, setBookmarkedProjects] = useState<BookmarkedProject[]>([]);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [range,    setRange]    = useState("1");
  const [error,    setError]    = useState<string | null>(null);
  const [ping,     setPing]     = useState("");
  const [live,     setLive]     = useState(true);
  const [tab,      setTab]      = useState<"apps" | "sites" | "recent">("apps");
  const [view,     setView]     = useState<"overview" | "files" | "projects">("overview");
  const [openProj, setOpenProj] = useState<string | null>(null);
  const [projRange, setProjRange] = useState("30");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Load bookmarks from API
  const loadBookmarks = useCallback(() => {
    fetch("/api/bookmarks")
      .then(r => r.json())
      .then(d => {
        const paths = new Set<string>((d.bookmarks || []).map((b: Bookmark) => b.path));
        setBookmarks(paths);
      })
      .catch(() => {});
  }, []);

  const loadBookmarkedProjects = useCallback(() => {
    fetch(`/api/bookmarked_projects?range=${projRange}`)
      .then(r => r.json())
      .then(d => setBookmarkedProjects(d.projects || []))
      .catch(() => {});
  }, [projRange]);

  const toggleBookmark = async (path: string, display: string) => {
    if (bookmarks.has(path)) {
      await fetch(`/api/bookmarks?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      setBookmarks(prev => { const s = new Set(prev); s.delete(path); return s; });
    } else {
      await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, display }),
      });
      setBookmarks(prev => new Set([...prev, path]));
    }
    // Refresh bookmarked projects list if on that tab
    loadBookmarkedProjects();
  };

  const deleteFolder = async (path: string) => {
    await fetch(`/api/folder?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    setConfirmDelete(null);
    setOpenProj(null);
    setBookmarks(prev => { const s = new Set(prev); s.delete(path); return s; });
    load(); // refresh files list
  };

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/stats?range=${range}`).then(r => r.json()),
      fetch(`/api/projects?range=${range}`).then(r => r.json()),
      fetch("/api/hourly").then(r => r.json()),
    ])
      .then(([s, p, h]) => {
        setStats(s);
        setProjects(p);
        setHourly(h);
        setError(null);
        setPing(new Date().toLocaleTimeString());
      })
      .catch(e => setError(e.message));
  }, [range]);

  useEffect(() => { load(); loadBookmarks(); }, [load, loadBookmarks]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [live, load]);

  useEffect(() => {
    if (view === "projects") loadBookmarkedProjects();
  }, [view, projRange, loadBookmarkedProjects]);

  const pie = stats
    ? Object.entries(stats.categoryBreakdown)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value }))
    : [];

  const maxApp    = stats?.topApps[0]?.total_seconds    || 1;
  const maxDetail = stats?.topDetails[0]?.total_seconds || 1;
  const totalCat  = pie.reduce((s, d) => s + d.value, 0);
  const maxHour   = hourly ? Math.max(...hourly.hourly.map(h => h.seconds), 1) : 1;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Syne:wght@400;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background:#080b0f;color:#e2e8f0;font-family:'JetBrains Mono',monospace;min-height:100vh}
        .scan{position:fixed;inset:0;pointer-events:none;z-index:9999;
          background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,157,.011) 2px,rgba(0,255,157,.011) 4px)}

        .hdr{display:flex;align-items:center;justify-content:space-between;
          padding:14px 28px;border-bottom:1px solid rgba(0,255,157,.12);background:rgba(0,255,157,.025)}
        .logo{font-family:'Syne',sans-serif;font-weight:800;font-size:18px;color:#00ff9d;
          display:flex;align-items:center;gap:9px}
        .dot{width:8px;height:8px;border-radius:50%;background:#00ff9d;
          box-shadow:0 0 8px #00ff9d;animation:blink 2s infinite}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
        .hdr-r{display:flex;align-items:center;gap:12px}
        .ping{font-size:10px;color:#2d3748}
        .badge{display:flex;align-items:center;gap:5px;font-size:10px;padding:4px 10px;
          border-radius:20px;cursor:pointer;border:1px solid;transition:all .2s;font-family:inherit}
        .badge.on{color:#00ff9d;border-color:rgba(0,255,157,.3);background:rgba(0,255,157,.07)}
        .badge.off{color:#4a5568;border-color:rgba(255,255,255,.08);background:transparent}
        .bdot{width:6px;height:6px;border-radius:50%}
        .badge.on .bdot{background:#00ff9d;animation:blink 1s infinite}
        .badge.off .bdot{background:#4a5568}
        .rtabs{display:flex;gap:3px}
        .rtab{padding:4px 11px;border-radius:4px;font-size:10px;font-family:inherit;cursor:pointer;
          border:1px solid rgba(255,255,255,.07);background:transparent;color:#64748b;transition:all .15s}
        .rtab:hover{color:#00ff9d;border-color:rgba(0,255,157,.25)}
        .rtab.on{background:rgba(0,255,157,.09);color:#00ff9d;border-color:rgba(0,255,157,.35)}

        .vnav{display:flex;gap:2px;padding:10px 28px 0;border-bottom:1px solid rgba(255,255,255,.04)}
        .vtab{padding:7px 18px;font-size:11px;font-family:inherit;cursor:pointer;border:none;
          background:transparent;color:#4a5568;border-bottom:2px solid transparent;transition:all .15s}
        .vtab:hover{color:#00ff9d}
        .vtab.on{color:#00ff9d;border-bottom-color:#00ff9d}

        .now{display:flex;align-items:center;gap:14px;margin:12px 28px 0;
          padding:11px 16px;background:rgba(0,255,157,.04);
          border:1px solid rgba(0,255,157,.18);border-radius:10px}
        .now-lbl{font-size:9px;color:#4a5568;text-transform:uppercase;letter-spacing:1.5px}
        .now-app{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#00ff9d}
        .now-det{font-size:11px;color:#94a3b8;margin-top:2px}
        .now-t{font-size:10px;color:#4a5568;margin-left:auto;white-space:nowrap}

        .main{padding:14px 28px 40px;display:flex;flex-direction:column;gap:14px;max-width:1400px;margin:0 auto}

        .sgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
        .sc{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);
          border-radius:10px;padding:14px 16px;transition:border-color .2s}
        .sc:hover{border-color:rgba(0,255,157,.22)}
        .sl{font-size:9px;color:#4a5568;text-transform:uppercase;letter-spacing:1.2px}
        .sv{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;
          color:#00ff9d;margin:4px 0 2px;line-height:1}
        .ss{font-size:9px;color:#2d3748}
        .sc.focus .sv{color:var(--fc)}

        .card{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);
          border-radius:10px;padding:15px 17px}
        .ct{font-family:'Syne',sans-serif;font-size:10px;font-weight:700;color:#4a5568;
          text-transform:uppercase;letter-spacing:2px;margin-bottom:12px}
        .row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}

        .itabs{display:flex;gap:5px;margin-bottom:11px}
        .itab{padding:3px 10px;border-radius:4px;font-size:10px;font-family:inherit;cursor:pointer;
          border:1px solid rgba(255,255,255,.06);background:transparent;color:#4a5568;transition:all .15s}
        .itab:hover{color:#00ff9d}
        .itab.on{background:rgba(0,255,157,.07);color:#00ff9d;border-color:rgba(0,255,157,.28)}

        .ar{display:flex;align-items:center;gap:9px;padding:6px 0;
          border-bottom:1px solid rgba(255,255,255,.035)}
        .ar:last-child{border-bottom:none}
        .ar.hi{background:rgba(0,255,157,.04);border-radius:6px;padding:6px 6px;margin:0 -6px}
        .ai{font-size:14px;width:20px;text-align:center;flex-shrink:0}
        .an{flex:1;font-size:11px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .at{font-size:11px;color:#00ff9d;font-weight:600;min-width:34px;text-align:right;flex-shrink:0}
        .bw{width:100%;background:rgba(255,255,255,.04);height:2px;border-radius:2px;margin-top:3px}
        .bb{height:2px;border-radius:2px;background:linear-gradient(90deg,#00ff9d,#00c8ff);transition:width .5s ease}
        .sub{font-size:9px;color:#4a5568;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

        .feed{display:flex;flex-direction:column}
        .fr{display:flex;align-items:center;gap:8px;padding:5px 2px;
          border-bottom:1px solid rgba(255,255,255,.035)}
        .fr:last-child{border-bottom:none}
        .ft{font-size:10px;color:#2d3748;width:40px;flex-shrink:0}
        .fi{font-size:13px;width:17px;text-align:center;flex-shrink:0}
        .fb{flex:1;overflow:hidden}
        .fa{font-size:9px;color:#4a5568}
        .fd{font-size:11px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .fdur{font-size:10px;color:#00ff9d;font-weight:600;flex-shrink:0}

        .pleg{display:flex;flex-direction:column;gap:7px;justify-content:center}
        .pli{display:flex;align-items:center;gap:7px;font-size:10px}
        .pld{width:7px;height:7px;border-radius:50%;flex-shrink:0}
        .plv{color:#e2e8f0;font-weight:600;min-width:30px;text-align:right}
        .pln{color:#94a3b8;flex:1;text-transform:capitalize}
        .plp{font-size:9px;color:#4a5568;min-width:26px;text-align:right}

        /* ── Files view (renamed from Projects & Files) */
        .proj-item{border:1px solid rgba(255,255,255,.06);border-radius:8px;
          margin-bottom:8px;overflow:hidden;transition:border-color .15s}
        .proj-item:hover{border-color:rgba(0,255,157,.25)}
        .proj-item.open{border-color:rgba(0,255,157,.35)}
        .proj-item.bookmarked-item{border-color:rgba(255,215,0,.2)}
        .proj-hdr{display:flex;align-items:center;gap:10px;padding:10px 14px;
          background:rgba(255,255,255,.02);cursor:pointer}
        .proj-name{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#e2e8f0;flex:1}
        .proj-path{font-size:9px;color:#2d3748;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
        .proj-time{font-size:12px;color:#00ff9d;font-weight:600}
        .proj-bar{height:3px;background:rgba(255,255,255,.05)}
        .proj-fill{height:3px;background:linear-gradient(90deg,#00ff9d,#00c8ff);transition:width .5s}
        .proj-files{padding:8px 14px 10px;background:rgba(0,0,0,.15)}
        .pf-row{display:flex;align-items:center;gap:8px;padding:4px 0;
          border-bottom:1px solid rgba(255,255,255,.03)}
        .pf-row:last-child{border-bottom:none}
        .pf-name{flex:1;font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .pf-time{font-size:10px;color:#00c8ff;font-weight:600;flex-shrink:0}
        .pf-bar{width:80px;height:2px;background:rgba(255,255,255,.05);border-radius:2px;flex-shrink:0}
        .pf-fill{height:2px;border-radius:2px;background:#00c8ff;transition:width .4s}

        /* ── Bookmark button */
        .bm-btn{display:flex;align-items:center;gap:4px;padding:3px 9px;border-radius:4px;
          font-size:10px;font-family:inherit;cursor:pointer;transition:all .18s;border:1px solid;
          flex-shrink:0;white-space:nowrap}
        .bm-btn.active{color:#ffd700;border-color:rgba(255,215,0,.4);background:rgba(255,215,0,.08)}
        .bm-btn.active:hover{background:rgba(255,107,107,.12);border-color:rgba(255,107,107,.3);color:#ff6b6b}
        .bm-btn.inactive{color:#4a5568;border-color:rgba(255,255,255,.07);background:transparent}
        .bm-btn.inactive:hover{color:#ffd700;border-color:rgba(255,215,0,.3);background:rgba(255,215,0,.06)}

        /* ── Projects view (bookmarked) */
        .proj-card{border:1px solid rgba(255,215,0,.15);border-radius:10px;
          margin-bottom:14px;overflow:hidden;background:rgba(255,215,0,.02)}
        .proj-card:hover{border-color:rgba(255,215,0,.3)}
        .proj-card.open{border-color:rgba(255,215,0,.4)}
        .proj-card-hdr{display:flex;align-items:center;gap:12px;padding:14px 16px;
          background:rgba(0,0,0,.2);cursor:pointer}
        .proj-card-name{font-family:'Syne',sans-serif;font-size:15px;font-weight:800;color:#e2e8f0;flex:1}
        .proj-card-path{font-size:9px;color:#2d3748;margin-top:2px;white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis}
        .proj-card-time{font-size:18px;color:#00ff9d;font-weight:700;font-family:'Syne',sans-serif}
        .proj-card-body{padding:14px 16px;background:rgba(0,0,0,.1)}
        .proj-stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
        .proj-stat{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);
          border-radius:8px;padding:10px 12px;text-align:center}
        .proj-stat-val{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:#00ff9d}
        .proj-stat-lbl{font-size:9px;color:#4a5568;margin-top:3px;text-transform:uppercase;letter-spacing:1px}
        .proj-zero{color:#2d3748;font-size:11px;padding:20px;text-align:center;
          border:1px dashed rgba(255,255,255,.06);border-radius:8px}

        /* Heatmap */
        .heatmap{display:flex;gap:3px;align-items:flex-end;padding:4px 0 0}

        /* Error */
        .err{background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.18);
          border-radius:10px;padding:14px 18px;font-size:11px;line-height:2}
        .err strong{color:#ff6b6b}
        .err code{background:rgba(255,255,255,.07);padding:1px 5px;border-radius:3px;font-size:10px}
        .empty{color:#2d3748;font-size:11px;padding:16px 0;text-align:center}

        .proj-range-tabs{display:flex;gap:3px;margin-bottom:14px}

        @media(max-width:1100px){.row3{grid-template-columns:1fr 1fr}.sgrid{grid-template-columns:repeat(3,1fr)}}
        @media(max-width:700px){.row3{grid-template-columns:1fr}.row2{grid-template-columns:1fr}.hdr{flex-direction:column;gap:10px;align-items:flex-start}.sgrid{grid-template-columns:repeat(2,1fr)}}
      `}</style>

      <div className="scan" />

      {/* ── Header */}
      <header className="hdr">
        <div className="logo"><div className="dot" />DevTracker</div>
        <div className="hdr-r">
          {ping && <span className="ping">updated {ping}</span>}
          <button className={`badge ${live ? "on" : "off"}`} onClick={() => setLive(v => !v)}>
            <span className="bdot" />{live ? "LIVE" : "PAUSED"}
          </button>
          <div className="rtabs">
            {[["1", "Today"], ["7", "7d"], ["30", "30d"]].map(([v, l]) => (
              <button key={v} className={`rtab ${range === v ? "on" : ""}`} onClick={() => setRange(v)}>{l}</button>
            ))}
          </div>
        </div>
      </header>

      {/* ── View nav */}
      <nav className="vnav">
        <button className={`vtab ${view === "overview" ? "on" : ""}`} onClick={() => setView("overview")}>📊 Overview</button>
        <button className={`vtab ${view === "files" ? "on" : ""}`} onClick={() => setView("files")}>📂 Files</button>
        <button className={`vtab ${view === "projects" ? "on" : ""}`} onClick={() => setView("projects")}>
          🔖 Projects {bookmarks.size > 0 && <span style={{ marginLeft: 5, background: "rgba(255,215,0,.15)", color: "#ffd700", borderRadius: 10, padding: "0 6px", fontSize: 9 }}>{bookmarks.size}</span>}
        </button>
      </nav>

      {/* ── Currently tracking */}
      {stats?.lastApp && (
        <div className="now">
          <span style={{ fontSize: 20 }}>{getIcon(stats.lastApp)}</span>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div className="now-lbl">currently tracking</div>
            <div className="now-app">{stats.lastApp}</div>
            {stats.lastDetail && <div className="now-det">{stats.lastDetail}</div>}
          </div>
          {stats.lastUpdated && <span className="now-t">@ {fmtT(stats.lastUpdated)}</span>}
        </div>
      )}

      <main className="main">
        {error && (
          <div className="err">
            <strong>⚠ Could not connect to API</strong><br />
            Make sure these are running:<br />
            <code>python tracker/tracker.py</code><br />
            <code>python tracker/api.py</code><br />
            Error: {error}
          </div>
        )}

        {/* ══════════════════════════════════════════════════
            OVERVIEW
        ══════════════════════════════════════════════════ */}
        {view === "overview" && stats && (() => {
          const avg = stats.dailyTotals.length
            ? Math.round(stats.dailyTotals.reduce((a, d) => a + d.total_seconds, 0) / stats.dailyTotals.length) : 0;
          const focusColor = stats.focusScore >= 70 ? "#00ff9d" : stats.focusScore >= 40 ? "#ffd93d" : "#ff6b6b";

          return (<>
            <div className="sgrid">
              {[
                ["Today",      fmt(stats.todayTotal), "screen time"],
                ["Avg / day",  fmt(avg),              `over ${range}d`],
                ["Streak",     `${stats.streak}d`,    "consecutive days"],
                ["Categories", `${pie.length}`,       "active today"],
              ].map(([l, v, s]) => (
                <div key={l as string} className="sc">
                  <div className="sl">{l}</div>
                  <div className="sv">{v}</div>
                  <div className="ss">{s}</div>
                </div>
              ))}
              <div className="sc focus" style={{ "--fc": focusColor } as React.CSSProperties}>
                <div className="sl">Focus Score</div>
                <div className="sv" style={{ color: focusColor }}>{stats.focusScore}%</div>
                <div className="ss">code + productivity</div>
              </div>
            </div>

            <div className="card">
              <div className="ct">Daily Activity</div>
              {stats.dailyTotals.length === 0
                ? <div className="empty">No data yet — switch between a few apps</div>
                : <ResponsiveContainer width="100%" height={130}>
                    <BarChart data={stats.dailyTotals.map(d => ({ day: d.day.slice(5), seconds: d.total_seconds }))} barSize={18}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.035)" />
                      <XAxis dataKey="day" tick={{ fill: "#4a5568", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<Tip />} cursor={{ fill: "rgba(0,255,157,.035)" }} />
                      <Bar dataKey="seconds" fill="#00ff9d" radius={[3, 3, 0, 0]} opacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
              }
            </div>

            {hourly && (
              <div className="card">
                <div className="ct">Today — Hourly Activity</div>
                <div className="heatmap">
                  {hourly.hourly.map(h => (
                    <HeatmapBar key={h.hour} hour={h.hour} seconds={h.seconds} max={maxHour} />
                  ))}
                </div>
              </div>
            )}

            <div className="row3">
              <div className="card">
                <div className="itabs">
                  {(["apps", "sites", "recent"] as const).map(t => (
                    <button key={t} className={`itab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
                      {t === "apps" ? "Apps" : t === "sites" ? "Sites & Files" : "Recent"}
                    </button>
                  ))}
                </div>

                {tab === "apps" && (stats.topApps.length === 0
                  ? <div className="empty">Waiting for data…</div>
                  : stats.topApps.slice(0, 9).map(a => (
                    <div key={a.app} className={`ar ${a.app === stats.lastApp ? "hi" : ""}`}>
                      <span className="ai">{getIcon(a.app)}</span>
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span className="an">{a.app}</span>
                          <span className="at">{fmtS(a.total_seconds)}</span>
                        </div>
                        <div className="bw"><div className="bb" style={{ width: `${(a.total_seconds / maxApp) * 100}%` }} /></div>
                      </div>
                    </div>
                  ))
                )}

                {tab === "sites" && (stats.topDetails.length === 0
                  ? <div className="empty">No detail data yet</div>
                  : stats.topDetails.slice(0, 10).map((d, i) => (
                    <div key={i} className="ar">
                      <span className="ai">{getIcon(d.app)}</span>
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span className="an" style={{ fontSize: 11 }}>{d.detail}</span>
                          <span className="at">{fmtS(d.total_seconds)}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span className="sub">{d.app}</span>
                          <div className="bw" style={{ marginTop: 0 }}><div className="bb" style={{ width: `${(d.total_seconds / maxDetail) * 100}%` }} /></div>
                        </div>
                      </div>
                    </div>
                  ))
                )}

                {tab === "recent" && (stats.recentActivity.length === 0
                  ? <div className="empty">No activity yet</div>
                  : <div className="feed">
                      {stats.recentActivity.slice(0, 18).map((r, i) => (
                        <div key={i} className="fr">
                          <span className="ft">{fmtT(r.started)}</span>
                          <span className="fi">{getIcon(r.app)}</span>
                          <div className="fb">
                            <div className="fa">{r.app}{r.category ? ` · ${r.category}` : ""}</div>
                            <div className="fd">{r.detail || r.title || "—"}</div>
                          </div>
                          <span className="fdur">{fmtS(r.duration)}</span>
                        </div>
                      ))}
                    </div>
                )}
              </div>

              <div className="card" style={{ display: "flex", flexDirection: "column" }}>
                <div className="ct">By Category</div>
                {pie.length === 0
                  ? <div className="empty">Waiting…</div>
                  : <>
                      <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                        <PieChart width={110} height={110}>
                          <Pie data={pie} cx={50} cy={50} innerRadius={28} outerRadius={46} dataKey="value" stroke="none">
                            {pie.map((d, i) => (
                              <Cell key={i} fill={catColor(d.name) || PALETTE[i % PALETTE.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </div>
                      <div className="pleg">
                        {pie.map((d, i) => (
                          <div key={d.name} className="pli">
                            <div className="pld" style={{ background: catColor(d.name) || PALETTE[i % PALETTE.length] }} />
                            <span className="pln">{d.name}</span>
                            <span className="plp">{totalCat ? `${Math.round(d.value / totalCat * 100)}%` : ""}</span>
                            <span className="plv">{fmtS(d.value)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                }
              </div>

              <div className="card">
                <div className="ct">Top Sites / Files</div>
                {stats.topDetails.length === 0
                  ? <div className="empty">Waiting for data…</div>
                  : stats.topDetails.slice(0, 8).map((d, i) => (
                    <div key={i} className="ar">
                      <span className="ai" style={{ fontSize: 12 }}>{getIcon(d.app)}</span>
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                          <span className="an" style={{ fontSize: 10, color: "#94a3b8" }}>{d.detail}</span>
                          <span className="at">{fmtS(d.total_seconds)}</span>
                        </div>
                        <span className="sub">{d.app}</span>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </>);
        })()}


        {/* ══════════════════════════════════════════════════
            FILES VIEW  (renamed from Projects & Files)
        ══════════════════════════════════════════════════ */}
        {view === "files" && projects && (() => {
          const maxProjSec = projects.projects[0]?.seconds || 1;

          return (
            <div className="row2">
              {/* Left: all detected folders */}
              <div>
                <div className="card" style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div className="ct" style={{ marginBottom: 0 }}>Folders — VS Code</div>
                    <div style={{ fontSize: 9, color: "#4a5568" }}>🔖 bookmark to track as project</div>
                  </div>
                  {projects.projects.length === 0
                    ? <div className="empty">No folder data yet. Start coding in VS Code!</div>
                    : projects.projects.map(p => {
                        const projKey  = p.path || p.project;
                        const isOpen   = openProj === projKey;
                        const isBm     = bookmarks.has(projKey);
                        const maxFile  = p.topFiles[0]?.seconds || 1;
                        return (
                          <div key={projKey} className={`proj-item ${isOpen ? "open" : ""} ${isBm ? "bookmarked-item" : ""}`}>
                            <div className="proj-hdr" onClick={() => setOpenProj(isOpen ? null : projKey)}>
                              <span style={{ fontSize: 14 }}>{isBm ? "🔖" : "📂"}</span>
                              <div style={{ flex: 1, overflow: "hidden" }}>
                                <div className="proj-name">{p.project}</div>
                                {p.path && p.path !== p.project && (
                                  <div className="proj-path" title={p.path}>{p.path}</div>
                                )}
                              </div>
                              <span className="proj-time">{fmtS(p.seconds)}</span>
                              <span style={{ color: "#4a5568", fontSize: 10, marginLeft: 6 }}>{isOpen ? "▲" : "▼"}</span>
                            </div>

                            {/* Action buttons row */}
                            <div style={{ padding: "0 14px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              {/* Delete */}
                              {confirmDelete === projKey ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontSize: 10, color: "#ff6b6b" }}>Delete all sessions for this folder?</span>
                                  <button
                                    style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(255,107,107,.4)", background: "rgba(255,107,107,.12)", color: "#ff6b6b", cursor: "pointer", fontFamily: "inherit" }}
                                    onClick={(e) => { e.stopPropagation(); deleteFolder(projKey); }}
                                  >Yes, delete</button>
                                  <button
                                    style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(255,255,255,.07)", background: "transparent", color: "#4a5568", cursor: "pointer", fontFamily: "inherit" }}
                                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                                  >Cancel</button>
                                </div>
                              ) : (
                                <button
                                  style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(255,255,255,.06)", background: "transparent", color: "#4a5568", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}
                                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(projKey); }}
                                >🗑 Delete</button>
                              )}
                              {/* Bookmark */}
                              <button
                                className={`bm-btn ${isBm ? "active" : "inactive"}`}
                                onClick={(e) => { e.stopPropagation(); toggleBookmark(projKey, p.project); }}
                              >
                                {isBm ? "🔖 Bookmarked as Project" : "＋ Bookmark as Project"}
                              </button>
                            </div>

                            <div className="proj-bar">
                              <div className="proj-fill" style={{ width: `${(p.seconds / maxProjSec) * 100}%` }} />
                            </div>
                            {isOpen && (
                              <div className="proj-files">
                                {p.topFiles.length === 0
                                  ? <div className="empty" style={{ padding: "8px 0" }}>No file detail</div>
                                  : p.topFiles.map(f => (
                                    <div key={f.file} className="pf-row">
                                      <span style={{ fontSize: 11 }}>{getFileIcon(f.file)}</span>
                                      <span className="pf-name">{f.file}</span>
                                      <div className="pf-bar">
                                        <div className="pf-fill" style={{ width: `${(f.seconds / maxFile) * 100}%` }} />
                                      </div>
                                      <span className="pf-time">{fmtS(f.seconds)}</span>
                                    </div>
                                  ))
                                }
                              </div>
                            )}
                          </div>
                        );
                      })
                  }
                </div>

              </div>

              {/* Right: Languages */}
              <div>
                <div className="card">
                  <div className="ct">Languages Used</div>
                  {projects.languages.length === 0
                    ? <div className="empty">No language data</div>
                    : (() => {
                        const maxL = projects.languages[0]?.seconds || 1;
                        return projects.languages.map(l => (
                          <div key={l.language} className="ar">
                            <span className="ai">{getLangIcon(l.language)}</span>
                            <div style={{ flex: 1, overflow: "hidden" }}>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span className="an">{l.language}</span>
                                <span className="at">{fmtS(l.seconds)}</span>
                              </div>
                              <div className="bw"><div className="bb" style={{ width: `${(l.seconds / maxL) * 100}%` }} /></div>
                            </div>
                          </div>
                        ));
                      })()
                  }
                </div>
              </div>
            </div>
          );
        })()}


        {/* ══════════════════════════════════════════════════
            PROJECTS VIEW  (bookmarked projects only)
        ══════════════════════════════════════════════════ */}
        {view === "projects" && (() => {
          const totalProjectSecs = bookmarkedProjects.reduce((s, p) => s + p.seconds, 0);
          const maxProjSec = bookmarkedProjects[0]?.seconds || 1;

          return (
            <>
              {/* Range selector */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 11, color: "#4a5568" }}>
                  {bookmarks.size === 0
                    ? "No projects bookmarked yet — go to 📂 Files and bookmark folders"
                    : `${bookmarks.size} bookmarked project${bookmarks.size !== 1 ? "s" : ""} · ${fmt(totalProjectSecs)} total`}
                </div>
                <div className="proj-range-tabs" style={{ margin: 0 }}>
                  {[["7", "7d"], ["30", "30d"], ["90", "90d"]].map(([v, l]) => (
                    <button key={v} className={`rtab ${projRange === v ? "on" : ""}`} onClick={() => setProjRange(v)}>{l}</button>
                  ))}
                </div>
              </div>

              {bookmarks.size === 0 ? (
                <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ fontSize: 40, marginBottom: 14 }}>🔖</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>No Projects Bookmarked</div>
                  <div style={{ fontSize: 11, color: "#4a5568", lineHeight: 1.8 }}>
                    Head to the <strong style={{ color: "#94a3b8" }}>📂 Files</strong> tab<br />
                    and click <strong style={{ color: "#ffd700" }}>＋ Bookmark as Project</strong> on any folder<br />
                    to start tracking it here.
                  </div>
                </div>
              ) : (
                <>
                  {/* Summary cards */}
                  {bookmarkedProjects.filter(p => p.seconds > 0).length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                      {bookmarkedProjects.filter(p => p.seconds > 0).slice(0, 5).map((p, i) => (
                        <div key={p.path} className="sc" style={{ borderColor: i === 0 ? "rgba(255,215,0,.25)" : "" }}>
                          <div className="sl" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.project}</div>
                          <div className="sv" style={{ color: i === 0 ? "#ffd700" : "#00ff9d", fontSize: 18 }}>{fmtS(p.seconds)}</div>
                          <div className="ss">{Object.keys(p.tree?.dirs || {}).length + (p.tree?.files?.length || 0)} entr{(Object.keys(p.tree?.dirs || {}).length + (p.tree?.files?.length || 0)) !== 1 ? "ies" : "y"}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Project cards */}
                  {bookmarkedProjects.map(p => {
                    const projKey = p.path || p.project;
                    const isOpen  = openProj === projKey;
                    const avgPerDay = p.dailySeconds && p.dailySeconds.length > 0
                      ? Math.round(p.seconds / p.dailySeconds.length)
                      : 0;
                    const activeDays = p.dailySeconds?.length || 0;

                    return (
                      <div key={projKey} className={`proj-card ${isOpen ? "open" : ""}`}>
                        <div className="proj-card-hdr" onClick={() => setOpenProj(isOpen ? null : projKey)}>
                          <span style={{ fontSize: 18 }}>🔖</span>
                          <div style={{ flex: 1, overflow: "hidden" }}>
                            <div className="proj-card-name">{p.project}</div>
                            {p.path && p.path !== p.project && (
                              <div className="proj-card-path" title={p.path}>{p.path}</div>
                            )}
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div className="proj-card-time">{fmtS(p.seconds)}</div>
                            <div style={{ fontSize: 9, color: "#4a5568" }}>last {projRange}d</div>
                          </div>
                          <span style={{ color: "#4a5568", fontSize: 10, marginLeft: 10 }}>{isOpen ? "▲" : "▼"}</span>
                        </div>

                        {/* Progress bar */}
                        <div className="proj-bar" style={{ background: "rgba(255,215,0,.06)" }}>
                          <div style={{ height: 3, background: "linear-gradient(90deg,#ffd700,#00ff9d)", width: `${(p.seconds / maxProjSec) * 100}%`, transition: "width .5s" }} />
                        </div>

                        {isOpen && (
                          <div className="proj-card-body">
                            {p.seconds === 0 ? (
                              <div className="proj-zero">No activity in the last {projRange} days for this project.</div>
                            ) : (
                              <>
                                {/* ── Stat cards row ── */}
                                <div className="proj-stats-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
                                  <div className="proj-stat">
                                    <div className="proj-stat-val">{fmtS(p.seconds)}</div>
                                    <div className="proj-stat-lbl">Total Time</div>
                                  </div>
                                  <div className="proj-stat">
                                    <div className="proj-stat-val">{activeDays}d</div>
                                    <div className="proj-stat-lbl">Active Days</div>
                                  </div>
                                  <div className="proj-stat">
                                    <div className="proj-stat-val">{fmtS(avgPerDay)}</div>
                                    <div className="proj-stat-lbl">Avg / Day</div>
                                  </div>
                                  <div className="proj-stat">
                                    <div className="proj-stat-val" style={{ fontSize: 12 }}>{p.peakWindow ?? "—"}</div>
                                    <div className="proj-stat-lbl">Peak Hours</div>
                                  </div>
                                </div>

                                {/* ── Two-column layout: left = charts, right = languages ── */}
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 14 }}>

                                  {/* Left column */}
                                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                                    {/* Daily activity chart */}
                                    {p.dailySeconds && p.dailySeconds.length > 0 && (
                                      <div>
                                        <div style={{ fontSize: 9, color: "#4a5568", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 6 }}>Daily Activity</div>
                                        <ResponsiveContainer width="100%" height={70}>
                                          <AreaChart data={p.dailySeconds.map(d => ({ day: d.day.slice(5), seconds: d.seconds }))}>
                                            <defs>
                                              <linearGradient id={`grad-${projKey}`} x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#ffd700" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#ffd700" stopOpacity={0} />
                                              </linearGradient>
                                            </defs>
                                            <XAxis dataKey="day" tick={{ fill: "#2d3748", fontSize: 8 }} axisLine={false} tickLine={false} />
                                            <YAxis hide />
                                            <Tooltip content={<Tip />} cursor={{ stroke: "rgba(255,215,0,.2)" }} />
                                            <Area type="monotone" dataKey="seconds" stroke="#ffd700" strokeWidth={2} fill={`url(#grad-${projKey})`} dot={false} />
                                          </AreaChart>
                                        </ResponsiveContainer>
                                      </div>
                                    )}

                                    {/* Hourly heatmap */}
                                    {p.hourly && (
                                      <div>
                                        <div style={{ fontSize: 9, color: "#4a5568", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 6 }}>
                                          Time of Day
                                          {p.peakWindow && <span style={{ color: "#ffd700", marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>⚡ Most productive: {p.peakWindow}</span>}
                                        </div>
                                        <MiniHeatmap hourly={p.hourly} />
                                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 8, color: "#2d3748" }}>
                                          <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                                        </div>
                                      </div>
                                    )}

                                    {/* Best day */}
                                    {p.bestDay?.day && (
                                      <div style={{ background: "rgba(255,215,0,.04)", border: "1px solid rgba(255,215,0,.1)", borderRadius: 6, padding: "8px 10px" }}>
                                        <div style={{ fontSize: 9, color: "#4a5568", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 3 }}>Best Session Day</div>
                                        <div style={{ fontSize: 12, color: "#ffd700", fontWeight: 700 }}>{p.bestDay.day}</div>
                                        <div style={{ fontSize: 10, color: "#4a5568" }}>{fmtS(p.bestDay.seconds)} coded</div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Right column — Languages */}
                                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                                    {/* This week breakdown */}
                                    {p.weekLangs && p.weekLangs.length > 0 && (
                                      <div>
                                        <div style={{ fontSize: 9, color: "#4a5568", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 8 }}>This Week — Time Spent On</div>
                                        {p.weekLangs.map(l => <LangBar key={l.lang} lang={l.lang} pct={l.pct} seconds={l.seconds} />)}
                                      </div>
                                    )}

                                    {/* All-time language breakdown */}
                                    {p.languages && p.languages.length > 0 && (
                                      <div>
                                        <div style={{ fontSize: 9, color: "#4a5568", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 8 }}>
                                          Languages Used
                                          {p.firstSeen && <span style={{ float: "right", textTransform: "none", letterSpacing: 0, color: "#2d3748" }}>since {p.firstSeen}</span>}
                                        </div>
                                        {/* Language dot legend */}
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginBottom: 10 }}>
                                          {p.languages.map(l => (
                                            <div key={l.lang} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: langColor(l.lang), flexShrink: 0 }} />
                                              <span style={{ fontSize: 10, color: "#94a3b8" }}>{l.lang}</span>
                                            </div>
                                          ))}
                                        </div>
                                        {/* Segmented bar */}
                                        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1, marginBottom: 8 }}>
                                          {p.languages.map(l => (
                                            <div key={l.lang} title={`${l.lang}: ${l.pct}%`} style={{ width: `${l.pct}%`, background: langColor(l.lang), minWidth: l.pct > 2 ? 2 : 0 }} />
                                          ))}
                                        </div>
                                        {p.languages.map(l => <LangBar key={l.lang} lang={l.lang} pct={l.pct} seconds={l.seconds} />)}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* ── File tree (full width) ── */}
                                {p.tree && p.tree.seconds > 0 && (
                                  <div style={{ borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 14 }}>
                                    <div style={{ fontSize: 9, color: "#4a5568", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 8 }}>File Tree</div>
                                    <FileTree node={p.tree} maxSecs={p.tree.seconds} depth={0} />
                                  </div>
                                )}
                              </>
                            )}

                            {/* Unbookmark */}
                            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
                              <button
                                className="bm-btn active"
                                style={{ fontSize: 9 }}
                                onClick={() => toggleBookmark(projKey, p.project)}
                              >
                                🗑 Remove Bookmark
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </>
          );
        })()}
      </main>
    </>
  );
}