"""
DevTracker API — pure Python stdlib, no pip needed.

Endpoints:
  GET /stats?range=1        — main dashboard stats (today/7d/30d)
  GET /projects?range=7     — WakaTime-style project/file breakdown
  GET /hourly?date=YYYY-MM-DD — hourly activity heatmap for a day
  GET /timeline?date=YYYY-MM-DD — full session timeline for a day
  GET /bookmarks            — list all bookmarked project folders
  POST /bookmarks           — bookmark a folder (body: {"path":"...", "display":"..."})
  DELETE /bookmarks?path=.. — remove a bookmark
  GET /bookmarked_projects?range=30 — stats only for bookmarked projects

Listens on http://localhost:5050
"""

import sqlite3, json, os, re
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import date, timedelta, datetime

DB_PATH      = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "devtracker.db"))
API_HOST     = os.environ.get("DEVTRACKER_HOST", "localhost")
API_PORT     = int(os.environ.get("DEVTRACKER_PORT", "5050"))


# ── DB helpers ────────────────────────────────────────────────────────────────

def query(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    conn.close()
    return rows

def execute(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(sql, params)
    conn.commit()
    conn.close()

def ensure_bookmarks_table():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bookmarked_projects (
            path    TEXT PRIMARY KEY,
            display TEXT NOT NULL,
            added   TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


# ── Project extraction ────────────────────────────────────────────────────────

def extract_project(detail: str, app: str):
    if not detail:
        return None
    app_l = (app or "").lower()
    if re.search(r'code|studio|cursor|zed|sublime|atom|vim|nvim|emacs|notepad\+\+|idea|pycharm', app_l):
        if " / " in detail:
            return detail.split(" / ")[0].strip()
        if " - " in detail:
            return detail.split(" - ")[0].strip()
        return detail.split(".")[0]
    if re.search(r'chrome|firefox|edge|brave|opera|vivaldi|safari|arc|browser', app_l):
        if " · " in detail:
            return detail.split(" · ")[0].strip()
        if " - " in detail:
            return detail.split(" - ")[0].strip()
        return detail
    return None


# ── /stats ────────────────────────────────────────────────────────────────────

def get_stats(range_days=1):
    since = (date.today() - timedelta(days=int(range_days))).isoformat()
    today_str = date.today().isoformat()

    top_apps = query(
        "SELECT app, SUM(duration) as total_seconds, COUNT(*) as sessions "
        "FROM sessions WHERE started >= ? GROUP BY app ORDER BY total_seconds DESC LIMIT 15",
        (since,))

    daily_totals = query(
        "SELECT DATE(started) as day, SUM(duration) as total_seconds "
        "FROM sessions WHERE started >= ? GROUP BY day ORDER BY day ASC",
        (since,))

    try:
        cat_rows = query(
            "SELECT category, SUM(duration) as total FROM sessions "
            "WHERE started >= ? AND category IS NOT NULL GROUP BY category",
            (since,))
        category_breakdown = {r["category"]: r["total"] for r in cat_rows}
    except Exception:
        category_breakdown = {}

    top_details = query(
        "SELECT app, detail, SUM(duration) as total_seconds "
        "FROM sessions WHERE started >= ? AND detail IS NOT NULL AND detail != '' "
        "GROUP BY app, detail ORDER BY total_seconds DESC LIMIT 20",
        (since,))

    recent = query(
        "SELECT app, detail, title, category, started, ended, duration "
        "FROM sessions WHERE started >= ? ORDER BY started DESC LIMIT 40",
        (since,))

    today_rows = query(
        "SELECT SUM(duration) as total FROM sessions WHERE DATE(started) = ?",
        (today_str,))
    today_total = (today_rows[0]["total"] or 0) if today_rows else 0

    days = query("SELECT DISTINCT DATE(started) as day FROM sessions ORDER BY day DESC")
    streak, check = 0, date.today()
    day_set = {row["day"] for row in days}
    # If today has no data yet, start checking from yesterday so a real streak isn't broken
    if check.isoformat() not in day_set:
        check -= timedelta(days=1)
    while check.isoformat() in day_set:
        streak += 1
        check -= timedelta(days=1)

    last = query("SELECT app, detail, title, ended FROM sessions ORDER BY ended DESC LIMIT 1")

    focus_cats = {"code", "productivity"}
    focus_secs = sum(v for k, v in category_breakdown.items() if k in focus_cats)
    total_secs = sum(category_breakdown.values()) or 1
    focus_score = round((focus_secs / total_secs) * 100)

    return {
        "topApps":           top_apps,
        "dailyTotals":       daily_totals,
        "categoryBreakdown": category_breakdown,
        "topDetails":        top_details,
        "recentActivity":    recent,
        "todayTotal":        today_total,
        "streak":            streak,
        "focusScore":        focus_score,
        "lastApp":    last[0]["app"]                            if last else None,
        "lastDetail": last[0]["detail"] or last[0]["title"]    if last else None,
        "lastUpdated":last[0]["ended"]                         if last else None,
    }


# ── /projects ─────────────────────────────────────────────────────────────────

def get_projects(range_days=7):
    since = (date.today() - timedelta(days=int(range_days))).isoformat()

    sessions = query(
        "SELECT app, detail, category, duration FROM sessions "
        "WHERE started >= ? AND duration > 0",
        (since,))

    projects = {}
    sites    = {}

    # EXTENSION_LANG is defined at module level — no local copy needed

    GARBAGE_NAMES = {
        "visual studio code", "code", "cursor", "vscodium", "desktop",
        "onedrive", "documents", "downloads", "users", "home", "appdata",
        "program files", "windows", "system32",
    }

    def _norm_key(p):
        return p.strip().replace("\\\\", "/").replace("\\", "/").rstrip("/").lower()

    lang_totals = {}

    for s in sessions:
        app    = s["app"] or ""
        detail = s["detail"] or ""
        dur    = s["duration"] or 0
        app_l  = app.lower()

        if re.search(r'code|studio|cursor|zed|sublime|atom|vim|nvim|idea|pycharm', app_l):
            if not detail or detail.lower() in GARBAGE_NAMES:
                continue

            if "||" in detail:
                path_key, display = detail.split("||", 1)
            elif "::" in detail:
                path_key, display = detail.split("::", 1)
            else:
                path_key = None
                display  = detail

            if " / " in display:
                parts           = display.split(" / ", 1)
                project_display = parts[0].strip()
                fname           = parts[1].strip()
            elif " - " in display:
                parts           = display.split(" - ", 1)
                project_display = parts[0].strip()
                fname           = parts[1].strip() if len(parts) > 1 else ""
            else:
                if re.search(r'\.\w{1,5}$', display.strip()):
                    continue
                project_display = display.strip() or app
                fname           = ""

            if not project_display:
                continue
            if re.search(r'\.\w{1,5}$', project_display):
                continue
            if project_display.lower() in GARBAGE_NAMES:
                continue

            project_key = _norm_key(path_key) if path_key else project_display.lower()

            if project_key not in projects:
                projects[project_key] = {
                    "display": project_display,
                    "path":    project_key,
                    "seconds": 0,
                    "files":   {},
                    "app":     app,
                }
            projects[project_key]["seconds"] += dur

            if fname:
                projects[project_key]["files"][fname] = (
                    projects[project_key]["files"].get(fname, 0) + dur
                )
                ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
                if ext in EXTENSION_LANG:
                    lang = EXTENSION_LANG[ext]
                    lang_totals[lang] = lang_totals.get(lang, 0) + dur

        elif re.search(r'chrome|firefox|edge|brave|opera|vivaldi|safari|arc|browser', app_l):
            if " · " in detail:
                site = detail.split(" · ")[0].strip()
            elif " - " in detail:
                site = detail.split(" - ")[0].strip()
            else:
                site = detail or "Browser"
            sites[site] = sites.get(site, 0) + dur

    name_to_pathkey = {}
    for key, data in projects.items():
        if "/" in key or "\\" in key:
            name_to_pathkey[data["display"].lower()] = key

    keys_to_delete = []
    for key, data in projects.items():
        if "/" not in key and "\\" not in key:
            target = name_to_pathkey.get(data["display"].lower())
            if target and target in projects:
                projects[target]["seconds"] += data["seconds"]
                for fname, secs in data["files"].items():
                    projects[target]["files"][fname] = (
                        projects[target]["files"].get(fname, 0) + secs
                    )
                keys_to_delete.append(key)

    for key in keys_to_delete:
        del projects[key]

    projects_out = []
    for key, data in sorted(projects.items(), key=lambda x: -x[1]["seconds"]):
        top_files = sorted(data["files"].items(), key=lambda x: -x[1])[:10]
        projects_out.append({
            "project":  data["display"],
            "path":     data["path"],
            "app":      data["app"],
            "seconds":  data["seconds"],
            "topFiles": [{"file": f, "seconds": s} for f, s in top_files],
        })

    top_sites = sorted(
        [{"site": k, "seconds": v} for k, v in sites.items()],
        key=lambda x: -x["seconds"]
    )[:15]

    top_langs = sorted(
        [{"language": k, "seconds": v} for k, v in lang_totals.items()],
        key=lambda x: -x["seconds"]
    )

    return {
        "projects":  projects_out,
        "topSites":  top_sites,
        "languages": top_langs,
        "rangeDays": range_days,
    }


# ── /bookmarks ────────────────────────────────────────────────────────────────

def get_bookmarks():
    ensure_bookmarks_table()
    rows = query("SELECT path, display, added FROM bookmarked_projects ORDER BY added DESC")
    return {"bookmarks": rows}

def add_bookmark(path, display):
    ensure_bookmarks_table()
    added = datetime.now().isoformat()
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO bookmarked_projects (path, display, added) VALUES (?, ?, ?)",
        (path, display, added)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "path": path, "display": display, "added": added}

def delete_bookmark(path):
    ensure_bookmarks_table()
    execute("DELETE FROM bookmarked_projects WHERE path = ?", (path,))
    return {"ok": True, "deleted": path}

def delete_folder_sessions(path):
    """
    Delete all sessions belonging to the given project path key.
    Handles two formats stored in the detail column:

      New format (extension active):
        "c:/users/dev/mock2||mock2 / Authpage.jsx"
        matched by:  detail LIKE 'c:/users/dev/mock2||%'

      Old format (title-parsing fallback, no path prefix):
        "mock2 / Authpage.jsx"
        matched by:  detail LIKE 'mock2 / %'  OR  detail = 'mock2'

    Also removes any bookmark for this path.
    """
    def _norm(p):
        return p.strip().replace("\\\\", "/").replace("\\", "/").rstrip("/").lower()

    norm_path    = _norm(path)
    display_name = norm_path.rstrip("/").rsplit("/", 1)[-1]

    conn = sqlite3.connect(DB_PATH)

    cur1 = conn.execute(
        "DELETE FROM sessions WHERE detail LIKE ?",
        (norm_path + "||%",)
    )

    cur2 = conn.execute(
        "DELETE FROM sessions WHERE lower(detail) LIKE ? OR lower(detail) = ?",
        (display_name + " / %", display_name)
    )

    deleted_sessions = cur1.rowcount + cur2.rowcount

    conn.execute("DELETE FROM bookmarked_projects WHERE path = ?", (norm_path,))
    conn.commit()
    conn.close()

    return {"ok": True, "path": norm_path, "displayName": display_name, "deletedSessions": deleted_sessions}


# ── /bookmarked_projects ──────────────────────────────────────────────────────

def _build_tree(file_seconds: dict) -> dict:
    """
    Turn a flat {rel_path: seconds} dict into a nested tree.

    Input:  {"auth.py": 180, "mock2/auth.py": 180, "mock2/models.py": 60}
    Output: {
      "seconds": 420,
      "files": [{"name": "auth.py", "seconds": 180}],
      "dirs": {
        "mock2": {
          "seconds": 240,
          "files": [{"name": "auth.py", "seconds": 180},
                    {"name": "models.py", "seconds": 60}],
          "dirs": {}
        }
      }
    }
    """
    root = {"seconds": 0, "files": [], "dirs": {}}

    for rel_path, secs in file_seconds.items():
        parts = rel_path.replace("\\", "/").split("/")
        node = root
        # Walk/create intermediate dir nodes
        for part in parts[:-1]:
            if part not in node["dirs"]:
                node["dirs"][part] = {"seconds": 0, "files": [], "dirs": {}}
            node["dirs"][part]["seconds"] += secs
            node = node["dirs"][part]
        # Leaf = file
        fname = parts[-1]
        node["files"].append({"name": fname, "seconds": secs})
        # Bubble seconds up already done via dir walk above — add to root separately
        root["seconds"] += secs

    # Sort files inside each node by seconds desc
    def _sort_node(node):
        node["files"].sort(key=lambda x: -x["seconds"])
        for child in node["dirs"].values():
            _sort_node(child)

    _sort_node(root)
    return root


EXTENSION_LANG = {
    "py": "Python", "js": "JavaScript", "ts": "TypeScript",
    "tsx": "TypeScript/React", "jsx": "JavaScript/React",
    "html": "HTML", "css": "CSS", "scss": "SCSS", "sass": "SCSS",
    "json": "JSON", "md": "Markdown", "sh": "Shell", "bash": "Shell",
    "go": "Go", "rs": "Rust", "cpp": "C++", "c": "C", "h": "C/C++",
    "java": "Java", "kt": "Kotlin", "rb": "Ruby", "php": "PHP",
    "sql": "SQL", "yaml": "YAML", "yml": "YAML", "toml": "TOML",
    "env": "Config", "vue": "Vue", "svelte": "Svelte", "dart": "Dart",
    "swift": "Swift", "cs": "C#", "fs": "F#", "ex": "Elixir",
    "exs": "Elixir", "r": "R", "lua": "Lua", "zig": "Zig",
}

def _ext_to_lang(filename):
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return EXTENSION_LANG.get(ext)

def _peak_hours(hourly_dict):
    """Return the 3-hour window with highest total seconds, as a readable string."""
    if not hourly_dict:
        return None
    # Build 24-slot array
    slots = [hourly_dict.get(h, 0) for h in range(24)]
    best_start, best_total = 0, 0
    for start in range(24):
        total = sum(slots[(start + i) % 24] for i in range(3))
        if total > best_total:
            best_total = total
            best_start = start
    if best_total == 0:
        return None
    def _fmt_h(h):
        h = h % 24
        if h == 0:   return "12am"
        if h < 12:   return f"{h}am"
        if h == 12:  return "12pm"
        return f"{h-12}pm"
    return f"{_fmt_h(best_start)}–{_fmt_h(best_start+3)}"

def get_bookmarked_projects(range_days=30):
    since = (date.today() - timedelta(days=int(range_days))).isoformat()
    # Also get "this week" window for the language breakdown widget
    week_since = (date.today() - timedelta(days=7)).isoformat()
    ensure_bookmarks_table()

    bookmarks = query("SELECT path, display FROM bookmarked_projects")
    if not bookmarks:
        return {"projects": [], "rangeDays": range_days}

    def _norm(p):
        return p.strip().replace("\\\\", "/").replace("\\", "/").rstrip("/").lower()

    bookmark_map = {_norm(b["path"]): b["display"] for b in bookmarks}

    sessions = query(
        "SELECT app, detail, category, duration, "
        "DATE(started) as day, strftime('%H', started) as hour, started "
        "FROM sessions WHERE started >= ? AND duration > 0",
        (since,))

    projects = {}

    for s in sessions:
        app    = s["app"] or ""
        detail = s["detail"] or ""
        dur    = s["duration"] or 0
        day    = s["day"] or ""
        hour   = int(s["hour"] or 0)
        app_l  = app.lower()

        if not re.search(r'code|studio|cursor|zed|sublime|atom|vim|nvim|idea|pycharm', app_l):
            continue
        if not detail:
            continue

        if "||" in detail:
            path_key, display = detail.split("||", 1)
            path_key = _norm(path_key)
        elif "::" in detail:
            path_key, display = detail.split("::", 1)
            path_key = _norm(path_key)
        else:
            continue

        if path_key not in bookmark_map:
            continue

        proj_display = bookmark_map[path_key]

        rel_file = ""
        if " / " in display:
            rel_file = display.split(" / ", 1)[1].strip()
        elif " - " in display:
            parts = display.split(" - ", 1)
            rel_file = parts[1].strip() if len(parts) > 1 else ""

        if path_key not in projects:
            projects[path_key] = {
                "display":       proj_display,
                "path":          path_key,
                "seconds":       0,
                "file_seconds":  {},
                "dailySeconds":  {},
                "hourlySeconds": {},   # hour(int) → seconds
                "langSeconds":   {},   # lang → seconds (full range)
                "weekLangSecs":  {},   # lang → seconds (this week only)
                "app":           app,
                "firstSeen":     day,
                "lastSeen":      day,
            }

        p = projects[path_key]
        p["seconds"]  += dur
        p["lastSeen"]  = max(p["lastSeen"],  day) if day else p["lastSeen"]
        p["firstSeen"] = min(p["firstSeen"], day) if day else p["firstSeen"]

        if day:
            p["dailySeconds"][day] = p["dailySeconds"].get(day, 0) + dur
        p["hourlySeconds"][hour] = p["hourlySeconds"].get(hour, 0) + dur

        if rel_file:
            p["file_seconds"][rel_file] = p["file_seconds"].get(rel_file, 0) + dur
            lang = _ext_to_lang(rel_file.rsplit("/", 1)[-1])
            if lang:
                p["langSeconds"][lang]  = p["langSeconds"].get(lang, 0)  + dur
                if day >= week_since:
                    p["weekLangSecs"][lang] = p["weekLangSecs"].get(lang, 0) + dur

    projects_out = []
    for key, data in sorted(projects.items(), key=lambda x: -x[1]["seconds"]):
        daily       = [{"day": d, "seconds": s} for d, s in sorted(data["dailySeconds"].items())]
        tree        = _build_tree(data["file_seconds"])
        active_days = len(data["dailySeconds"])
        avg_per_day = round(data["seconds"] / active_days) if active_days else 0

        # Peak 3-hour window
        peak_window = _peak_hours(data["hourlySeconds"])

        # Best single day
        best_day_entry = max(data["dailySeconds"].items(), key=lambda x: x[1]) if data["dailySeconds"] else (None, 0)

        # Languages sorted by time (full range)
        total_lang_secs = sum(data["langSeconds"].values()) or 1
        languages = sorted(
            [{"lang": l, "seconds": s, "pct": round(s / total_lang_secs * 100)}
             for l, s in data["langSeconds"].items()],
            key=lambda x: -x["seconds"]
        )

        # This-week language breakdown
        total_week = sum(data["weekLangSecs"].values()) or 1
        weekLangs = sorted(
            [{"lang": l, "seconds": s, "pct": round(s / total_week * 100)}
             for l, s in data["weekLangSecs"].items()],
            key=lambda x: -x["seconds"]
        )

        # Hourly array for heatmap
        hourly_arr = [{"hour": h, "seconds": data["hourlySeconds"].get(h, 0)} for h in range(24)]

        projects_out.append({
            "project":      data["display"],
            "path":         data["path"],
            "app":          data["app"],
            "seconds":      data["seconds"],
            "tree":         tree,
            "dailySeconds": daily,
            "hourly":       hourly_arr,
            "activeDays":   active_days,
            "avgPerDay":    avg_per_day,
            "peakWindow":   peak_window,
            "bestDay":      {"day": best_day_entry[0], "seconds": best_day_entry[1]},
            "firstSeen":    data["firstSeen"],
            "lastSeen":     data["lastSeen"],
            "languages":    languages,
            "weekLangs":    weekLangs,
        })

    # Bookmarked projects with zero activity
    found_paths = {p["path"] for p in projects_out}
    for norm_path, display in bookmark_map.items():
        if norm_path not in found_paths:
            projects_out.append({
                "project":      display,
                "path":         norm_path,
                "app":          "",
                "seconds":      0,
                "tree":         {"seconds": 0, "files": [], "dirs": {}},
                "dailySeconds": [],
                "hourly":       [{"hour": h, "seconds": 0} for h in range(24)],
                "activeDays":   0,
                "avgPerDay":    0,
                "peakWindow":   None,
                "bestDay":      {"day": None, "seconds": 0},
                "firstSeen":    None,
                "lastSeen":     None,
                "languages":    [],
                "weekLangs":    [],
            })

    return {"projects": projects_out, "rangeDays": range_days}


# ── /hourly ───────────────────────────────────────────────────────────────────

def get_hourly(target_date=None):
    day = target_date or date.today().isoformat()
    rows = query(
        "SELECT strftime('%H', started) as hour, SUM(duration) as total "
        "FROM sessions WHERE DATE(started) = ? GROUP BY hour ORDER BY hour",
        (day,))
    hourly = {str(h).zfill(2): 0 for h in range(24)}
    for r in rows:
        hourly[r["hour"]] = r["total"] or 0
    cat_rows = query(
        "SELECT strftime('%H', started) as hour, category, SUM(duration) as total "
        "FROM sessions WHERE DATE(started) = ? AND category IS NOT NULL "
        "GROUP BY hour, category",
        (day,))
    hourly_cats = {str(h).zfill(2): {} for h in range(24)}
    for r in cat_rows:
        hourly_cats[r["hour"]][r["category"]] = r["total"] or 0
    return {
        "date":   day,
        "hourly": [{"hour": h, "seconds": hourly[h]} for h in sorted(hourly)],
        "hourlyByCategory": [
            {"hour": h, "breakdown": hourly_cats[h]} for h in sorted(hourly_cats)
        ],
    }


# ── /timeline ─────────────────────────────────────────────────────────────────

def get_timeline(target_date=None):
    day = target_date or date.today().isoformat()
    rows = query(
        "SELECT app, detail, title, category, started, ended, duration "
        "FROM sessions WHERE DATE(started) = ? ORDER BY started ASC",
        (day,))
    return {"date": day, "sessions": rows}


# ── /raw ──────────────────────────────────────────────────────────────────────

def get_raw(qs):
    limit  = min(int(qs.get("limit",  ["200"])[0]), 1000)
    offset = int(qs.get("offset", ["0"])[0])
    search = qs.get("search",   [None])[0]
    app_f  = qs.get("app",      [None])[0]
    cat_f  = qs.get("category", [None])[0]
    since  = qs.get("since",    [None])[0]

    where_clauses, params = [], []
    if search:
        where_clauses.append("(app LIKE ? OR detail LIKE ? OR title LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like, like])
    if app_f:
        where_clauses.append("app = ?")
        params.append(app_f)
    if cat_f:
        where_clauses.append("category = ?")
        params.append(cat_f)
    if since:
        where_clauses.append("started >= ?")
        params.append(since)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    total = query(f"SELECT COUNT(*) as n FROM sessions {where_sql}", params)[0]["n"]
    rows  = query(
        f"SELECT id, app, title, detail, category, started, ended, duration "
        f"FROM sessions {where_sql} ORDER BY started DESC LIMIT ? OFFSET ?",
        params + [limit, offset]
    )
    apps       = [r["app"]      for r in query("SELECT DISTINCT app      FROM sessions ORDER BY app")]
    categories = [r["category"] for r in query("SELECT DISTINCT category FROM sessions WHERE category IS NOT NULL ORDER BY category")]
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "apps": apps, "categories": categories}


# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type",  "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        qs     = parse_qs(parsed.query)
        ROUTES = {
            "/stats":               lambda: get_stats(qs.get("range", ["1"])[0]),
            "/projects":            lambda: get_projects(qs.get("range", ["7"])[0]),
            "/hourly":              lambda: get_hourly(qs.get("date", [None])[0]),
            "/timeline":            lambda: get_timeline(qs.get("date", [None])[0]),
            "/bookmarks":           lambda: get_bookmarks(),
            "/bookmarked_projects": lambda: get_bookmarked_projects(qs.get("range", ["30"])[0]),
        }
        fn = ROUTES.get(parsed.path)
        if fn:
            try:    self._send(200, fn())
            except Exception as e: self._send(500, {"error": str(e)})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(length) if length else b""
        try:    payload = json.loads(body_bytes) if body_bytes else {}
        except: payload = {}

        if parsed.path == "/bookmarks":
            path    = payload.get("path", "").strip()
            display = payload.get("display", path).strip()
            if not path:
                self._send(400, {"error": "path required"})
            else:
                self._send(200, add_bookmark(path, display))
        else:
            self._send(404, {"error": "not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        qs     = parse_qs(parsed.query)
        path   = qs.get("path", [None])[0]

        if parsed.path == "/bookmarks":
            if not path:
                self._send(400, {"error": "path required"})
            else:
                self._send(200, delete_bookmark(path))
        elif parsed.path == "/folder":
            if not path:
                self._send(400, {"error": "path required"})
            else:
                self._send(200, delete_folder_sessions(path))
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *_):
        pass


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        conn = sqlite3.connect(DB_PATH)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app TEXT NOT NULL, title TEXT, detail TEXT, category TEXT,
                started TEXT NOT NULL, ended TEXT, duration INTEGER DEFAULT 0
            )
        """)
        conn.commit()
        conn.close()

    ensure_bookmarks_table()

    print(f"[API] Database : {DB_PATH}")
    print(f"[API] Endpoints:")
    print(f"       GET    /stats?range=1|7|30")
    print(f"       GET    /projects?range=7")
    print(f"       GET    /hourly?date=YYYY-MM-DD")
    print(f"       GET    /timeline?date=YYYY-MM-DD")
    print(f"       GET    /bookmarks")
    print(f"       POST   /bookmarks  {{path, display}}")
    print(f"       DELETE /bookmarks?path=...")
    print(f"       GET    /bookmarked_projects?range=7|30|90")
    print(f"[API] Listening: http://{API_HOST}:{API_PORT}\n")

    HTTPServer((API_HOST, API_PORT), Handler).serve_forever()