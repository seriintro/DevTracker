"""
DevTracker - Desktop Activity Tracker
Polls active window every 3s, logs app + parsed detail to SQLite.
Works on Windows (no pip needed), macOS, Linux (needs xdotool).

VS Code accuracy:
  When the DevTracker VS Code extension is installed, tracker.py reads the
  heartbeat file (~/.devtracker_vscode.json) to get the REAL file path and
  project — even when a file from a different folder is opened in the same
  VS Code window.  Falls back to window-title parsing if the extension isn't
  running or the heartbeat is stale (> 10 seconds old).
"""

import sqlite3, time, datetime, subprocess, sys, os, platform, signal, re, json

POLL_INTERVAL     = 3
DB_PATH           = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "devtracker.db"))
OS                = platform.system()
VSCODE_HEARTBEAT  = os.path.join(os.path.expanduser("~"), ".devtracker_vscode.json")
HEARTBEAT_MAX_AGE = 20   # seconds — extension writes every 5s, so 20s gives 3 missed writes before fallback


PROJECT_MARKERS = {
    ".git", ".devtracker-project",
    "package.json", "pyproject.toml", "Cargo.toml", "go.mod",
    "pom.xml", "build.gradle", "Makefile", "CMakeLists.txt",
    "composer.json", "requirements.txt", "setup.py", "setup.cfg",
    "tsconfig.json", "vite.config.js", "vite.config.ts",
    "next.config.js", "nuxt.config.js", "angular.json",
    ".flake8", "manage.py",
}

def _norm(p: str) -> str:
    return p.strip().replace("\\\\", "/").replace("\\", "/").rstrip("/").lower()


# PROJECT ROOT DETECTION  (fallback only — used when no workspace is open)


CONTAINER_FOLDERS = {
    "desktop", "documents", "downloads", "pictures", "videos", "music",
    "users", "home", "onedrive", "dropbox", "googledrive", "icloud",
    "appdata", "program files", "program files (x86)", "windows",
    "system32", "usr", "etc", "var", "tmp", "opt",
    # VS Code itself is not a project
    "visual studio code", "code", "vscode", "cursor",
}

GENERIC_SUBFOLDERS = {
    "frontend", "backend", "src", "lib", "app", "api", "server", "client",
    "core", "main", "utils", "helpers", "common", "components", "pages",
    "views", "routes", "models", "controllers", "services", "middleware",
    "static", "public", "assets", "styles", "css", "js", "ts",
    "dist", "build", "out", "output", "test", "tests", "__tests__", "spec",
    "docs", "scripts", "config", "types", "hooks", "store", "context",
    # Common module/feature names — parts of a project, not the project itself
    "authentication", "auth", "authorization", "login", "register",
    "dashboard", "admin", "user", "users", "profile", "settings",
}

def _is_container(dir_path: str) -> bool:
    return os.path.basename(dir_path).lower() in CONTAINER_FOLDERS

def _is_generic(dir_path: str) -> bool:
    return os.path.basename(dir_path).lower() in GENERIC_SUBFOLDERS

def _has_marker(dir_path: str) -> bool:
    return any(os.path.exists(os.path.join(dir_path, m)) for m in PROJECT_MARKERS)


def find_project_root_by_markers(start_path: str) -> tuple:
    """
    Resolve the real project root using a single unified upward walk.

    Rule: a folder is a valid candidate only if its name is NOT generic and
    NOT a container. Generic folders (frontend, src, auth ...) are NEVER the
    project root — even if they contain package.json or .git.

    Walk from start_path upward:
      - container  → stop, use best found so far
      - generic    → skip always, keep climbing
      - real name  → candidate; prefer one with a marker; stop when we have
                     a marker candidate and the next level has none

    Examples:
      mock1/frontend/   frontend has package.json, mock1 has .git
        frontend → generic, SKIP (package.json inside generic = irrelevant)
        mock1    → not generic, has marker → best = mock1  ✅
        Desktop  → container, stop

      mock1/frontend/   no markers at all (brand new project)
        frontend → generic, skip
        mock1    → not generic → best = mock1  ✅
        Desktop  → container, stop
    """
    if not start_path:
        return None, None

    start_abs = os.path.abspath(start_path)
    if os.path.isfile(start_abs):
        start_abs = os.path.dirname(start_abs)

    best = None
    dir_ = start_abs

    for _ in range(14):
        if _is_container(dir_):
            break

        generic = _is_generic(dir_)
        marker  = _has_marker(dir_)

        if not generic:
            # Real folder name — valid candidate
            if best is None or marker:
                best = dir_
            # Stop if best already has a marker and this level has none
            if best and _has_marker(best) and not marker:
                break

        parent = os.path.dirname(dir_)
        if parent == dir_:
            break
        dir_ = parent

    if best:
        return os.path.basename(best), best

    return os.path.basename(start_abs), start_abs


def read_vscode_heartbeat() -> tuple:
    """
    Read the heartbeat file written by the VS Code extension.
    Returns (project_name, detail_string, language) or (None, None, None).

    ── How project root is determined ──────────────────────────────────────────

    Case 1 — User has a folder open in VS Code (normal usage):
        workspaceRoot from the extension = the project root. Period.
        No guessing. The user explicitly opened that folder — it IS the project.

        mock2/ opened as workspace:
          file mock2/authentication/frontend/App.jsx  →  project = "mock2"  ✅
          file mock2/backend/models.py                →  project = "mock2"  ✅

    Case 2 — Single file opened with NO folder/workspace open:
        Walk up from the file looking for .git / package.json etc.
        Less common, but handles drag-and-drop file opens.

    ── DB key format ────────────────────────────────────────────────────────────
    detail stored in DB:  "normalised_root_path||ProjectName / filename.ext"
    Normalised = lowercase, forward slashes, no trailing slash.
    This makes "C:\\Mock2" and "c:/mock2/" the same key → no duplicates.
    """
    try:
        if not os.path.exists(VSCODE_HEARTBEAT):
            return None, None, None

        age = time.time() - os.path.getmtime(VSCODE_HEARTBEAT)
        if age > HEARTBEAT_MAX_AGE:
            return None, None, None

        with open(VSCODE_HEARTBEAT, "r", encoding="utf-8") as fh:
            data = json.load(fh)

        if data.get("closed"):
            return None, None, None

        file_path      = data.get("file")
        fname          = data.get("fileName")
        language       = data.get("language")
        workspace_root = data.get("workspaceRoot")
        workspace_name = data.get("workspaceName")

        if not file_path or not fname:
            return None, None, None

        if workspace_root and workspace_name:
            # ── Case 1: workspace open ────────────────────────────────────────
            opened_folder = data.get("openedFolder")
            if opened_folder and _norm(opened_folder) != _norm(workspace_root):
                project_name = workspace_name
                project_path = workspace_root
            else:
                walked_name, walked_path = find_project_root_by_markers(
                    workspace_root or opened_folder
                )
                project_name = walked_name or workspace_name
                project_path = walked_path or workspace_root
        else:
            # ── Case 2: single file opened, no workspace ──────────────────────
            project_name, project_path = find_project_root_by_markers(file_path)
            if not project_name or not project_path:
                return None, None, None

        # Normalise the path key
        key = _norm(project_path)

        # Compute relative path from project root → file so folder structure is preserved.
        try:
            rel_file = os.path.relpath(file_path, project_path)
            # Normalise separators
            rel_file = rel_file.replace("\\", "/")
        except ValueError:
            # os.path.relpath can fail across Windows drives — fall back to basename
            rel_file = fname

        detail = f"{key}||{project_name} / {rel_file}"
        return project_name, detail, language

    except Exception:
        return None, None, None

# APP TYPE DETECTION

def is_browser(app: str) -> bool:
    return bool(re.search(
        r'chrom|firefox|edge|brave|opera|vivaldi|safari|arc|browser', app.lower()))

def is_editor(app: str) -> bool:
    return bool(re.search(
        r'code|studio|idea|pycharm|webstorm|clion|rider|goland|'
        r'phpstorm|atom|sublime|vim|nvim|emacs|cursor|zed|notepad\+\+', app.lower()))

def is_terminal(app: str) -> bool:
    return bool(re.search(
        r'terminal|cmd|powershell|bash|zsh|wt$|alacritty|hyper|'
        r'iterm|konsole|xterm|mintty|conhost|windowsterminal', app.lower()))

def is_communication(app: str) -> bool:
    return bool(re.search(
        r'slack|discord|teams|telegram|whatsapp|zoom|skype|'
        r'signal|mattermost|rocket|meet|webex|viber|line', app.lower()))

def is_media(app: str) -> bool:
    return bool(re.search(
        r'spotify|vlc|mpv|itunes|music|winamp|foobar|'
        r'netflix|plex|kodi|stremio|video|player|mpc|quicktime', app.lower()))

def is_productivity(app: str) -> bool:
    return bool(re.search(
        r'notion|obsidian|onenote|evernote|word|excel|'
        r'powerpoint|writer|calc|impress|figma|canva|miro|'
        r'xd|sketch|blender|inkscape|gimp|photoshop|'
        r'illustrator|premiere|resolve|davinci|affinity|'
        r'todoist|trello|asana|clickup|linear|jira', app.lower()))

def is_mail(app: str) -> bool:
    return bool(re.search(
        r'outlook|thunderbird|mail|gmail|mailbird|postbox|spark', app.lower()))

def is_game(app: str) -> bool:
    return bool(re.search(
        r'steam|epic|rocketleague|minecraft|fortnite|valorant|'
        r'csgo|cs2|leagueoflegends|dota|overwatch|apex|'
        r'gta|rdr|cyberpunk|elden|game|play', app.lower()))

def is_file_manager(app: str) -> bool:
    return bool(re.search(
        r'explorer|finder|nautilus|thunar|nemo|dolphin|'
        r'konqueror|pcmanfm|files', app.lower()))

def is_image_viewer(app: str) -> bool:
    return bool(re.search(
        r'photos|preview|irfan|imagemagick|snipping|snip|'
        r'screenshot|greenshot|lightroom|darktable', app.lower()))


# CATEGORY DETECTION

def detect_category(app: str, detail: str) -> str:
    combined = (app + " " + (detail or "")).lower()

    if is_game(app):
        return "other"
    if is_editor(app) or is_terminal(app):
        return "code"
    if is_browser(app):
        if re.search(
            r'github|gitlab|bitbucket|stackoverflow|codepen|replit|'
            r'vercel|netlify|render|railway|supabase|jira|linear|'
            r'devdocs|mdn|docs\.|documentation', combined):
            return "code"
        if re.search(
            r'youtube|twitch|netflix|prime video|disney\+|hulu|'
            r'soundcloud|bandcamp|podcast|spotify', combined):
            return "media"
        if re.search(
            r'twitter|instagram|facebook|tiktok|reddit|linkedin|'
            r'snapchat|pinterest|tumblr|x\.com', combined):
            return "social"
        if re.search(
            r'gmail|mail\.|outlook\.com|inbox', combined):
            return "communication"
        if re.search(
            r'notion|docs\.google|sheets\.google|slides\.google|'
            r'figma\.com|canva|miro|claude\.ai|chatgpt', combined):
            return "productivity"
        return "browse"
    if is_communication(app):
        return "communication"
    if is_mail(app):
        return "communication"
    if is_media(app):
        return "media"
    if is_productivity(app):
        return "productivity"
    if is_file_manager(app) or is_image_viewer(app):
        return "other"

    return "other"


# TITLE PARSING

_BROWSER_SUFFIX = re.compile(
    r'\s*[-—–|]\s*(Google Chrome|Mozilla Firefox|Microsoft Edge|'
    r'Brave|Opera( GX)?|Vivaldi|Safari|Arc|Firefox[\s\w]*)$',
    re.IGNORECASE
)

_SITE_PATTERNS = [
    (re.compile(r'^(.+?)\s*[·•]\s*(.+)$',   re.I), lambda m: f"{m.group(2).strip()} · {m.group(1).strip()}"),
    (re.compile(r'^(.+?)\s*[-—–]\s*([^-—–]{2,50})$', re.I), lambda m: f"{m.group(2).strip()} · {m.group(1).strip()}"),
]

_EDITOR_PATTERN = re.compile(
    r'^[●•✎\*]?\s*(.+?)\s*[-—–]\s*(.+?)(?:\s*[-—–]\s*.+)?$'
)


def parse_detail(app: str, title: str) -> str:
    if not title or title.strip() == app.strip():
        return ""

    # ── Browser ──────────────────────────────────────────────────────────────
    if is_browser(app):
        clean = _BROWSER_SUFFIX.sub("", title).strip()
        if not clean:
            return ""
        for pattern, formatter in _SITE_PATTERNS:
            m = pattern.match(clean)
            if m:
                result = formatter(m)
                parts  = result.split(" · ")
                if len(parts) == 2 and parts[0].lower() == parts[1].lower():
                    return parts[0][:100]
                return result[:100]
        return clean[:100]

    # ── Code editor ──────────────────────────────────────────────────────────
    if is_editor(app):
        m = _EDITOR_PATTERN.match(title)
        if m:
            filename = m.group(1).lstrip("●•✎* ").strip()
            folder   = m.group(2).strip()
            if folder and folder.lower() not in app.lower() and len(folder) > 1:
                return f"{folder} / {filename}"[:100]
            return filename[:100]
        # Try "filename - folder" pattern
        parts = re.split(r'\s*[-—–]\s*', title)
        if len(parts) >= 2:
            fname   = parts[0].lstrip("●•✎* ").strip()
            project = parts[1].strip()
            if project and project.lower() not in app.lower():
                return f"{project} / {fname}"[:100]
        return title[:100]

    # ── Terminal ─────────────────────────────────────────────────────────────
    if is_terminal(app):
        clean = re.sub(r'^[\w\s]+ [-—] ', '', title).strip()
        # Show the running command if it looks like one
        if re.match(r'^(python|node|npm|git|bash|zsh|cargo|go|make)\b', clean):
            return clean[:100]
        return (clean or title)[:100]

    # ── File manager ─────────────────────────────────────────────────────────
    if is_file_manager(app):
        clean = re.sub(rf'\s*[-—–]\s*{re.escape(app)}.*$', '', title, flags=re.IGNORECASE).strip()
        return (clean or title)[:100]

    # ── Generic fallback ─────────────────────────────────────────────────────
    clean = re.sub(
        rf'\s*[-—–]\s*{re.escape(app)}.*$', '', title, flags=re.IGNORECASE
    ).strip()
    if clean and clean != title:
        return clean[:100]
    m = re.match(r'^(.+?)\s*[-—–|:]\s*.+$', title)
    if m:
        return m.group(1).strip()[:100]
    return title[:100]


# ACTIVE WINDOW DETECTION

def _get_active_window_windows() -> tuple[str, str]:
    import ctypes, ctypes.wintypes
    user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
    hwnd   = user32.GetForegroundWindow()
    length = user32.GetWindowTextLengthW(hwnd)
    buf    = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    title  = buf.value or ""
    pid    = ctypes.wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    h_proc = kernel32.OpenProcess(0x1000, False, pid.value)
    app    = "Unknown"
    if h_proc:
        buf2 = ctypes.create_unicode_buffer(260)
        size = ctypes.wintypes.DWORD(260)
        if kernel32.QueryFullProcessImageNameW(h_proc, 0, buf2, ctypes.byref(size)):
            app = buf2.value.split("\\")[-1].replace(".exe", "")
        kernel32.CloseHandle(h_proc)
    return (app, title)

def _get_active_window_mac() -> tuple[str, str]:
    script = ('tell application "System Events" to set frontApp to '
              'name of first application process whose frontmost is true\nreturn frontApp')
    app = subprocess.check_output(["osascript", "-e", script], text=True).strip()
    try:
        ts    = f'tell application "{app}" to get name of front window'
        title = subprocess.check_output(["osascript", "-e", ts], text=True).strip()
    except Exception:
        title = app
    return (app, title)

def _get_active_window_linux() -> tuple[str, str]:
    win_id = subprocess.check_output(["xdotool", "getactivewindow"], text=True).strip()
    title  = subprocess.check_output(["xdotool", "getwindowname", win_id], text=True).strip()
    pid    = subprocess.check_output(["xdotool", "getwindowpid",  win_id], text=True).strip()
    try:    app = subprocess.check_output(["ps", "-p", pid, "-o", "comm="], text=True).strip()
    except: app = title[:30]
    return (app, title)

def get_active_window() -> tuple[str, str]:
    try:
        if OS == "Windows": return _get_active_window_windows()
        if OS == "Darwin":  return _get_active_window_mac()
        if OS == "Linux":   return _get_active_window_linux()
    except Exception as e:
        print(f"[WARN] {e}")
    return ("Unknown", "")


# DATABASE

def init_db(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            app      TEXT NOT NULL,
            title    TEXT,
            detail   TEXT,
            category TEXT,
            started  TEXT NOT NULL,
            ended    TEXT,
            duration INTEGER DEFAULT 0
        )
    """)
    for col in ["detail TEXT", "category TEXT"]:
        try:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {col}")
        except Exception:
            pass
    conn.execute("CREATE INDEX IF NOT EXISTS idx_started  ON sessions(started)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_app      ON sessions(app)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_category ON sessions(category)")
    conn.commit()

def insert_session(conn, app, title, detail, category, started, ended, duration):
    conn.execute(
        "INSERT INTO sessions (app, title, detail, category, started, ended, duration) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (app, title, detail, category, started, ended, duration)
    )
    conn.commit()


# MAIN LOOP

def main():
    print(f"[DevTracker] OS       : {OS}")
    print(f"[DevTracker] Database : {DB_PATH}")
    print(f"[DevTracker] Interval : {POLL_INTERVAL}s")
    print("[DevTracker] Ctrl+C to stop\n")

    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    cur_app = cur_title = cur_detail = cur_category = session_start = None

    def flush(now_str):
        nonlocal cur_app, cur_title, cur_detail, cur_category, session_start
        if cur_app and session_start:
            dur = int((datetime.datetime.fromisoformat(now_str) -
                       datetime.datetime.fromisoformat(session_start)).total_seconds())
            if dur >= POLL_INTERVAL:   # discard sub-interval blips
                insert_session(conn, cur_app, cur_title, cur_detail,
                               cur_category, session_start, now_str, dur)
                print(f"  ✓ [{cur_category:<14}] {cur_app:<22} {dur:>5}s  "
                      f"{(cur_detail or cur_title or '')[:55]}")

    def on_exit(*_):
        flush(datetime.datetime.now().isoformat(timespec="seconds"))
        conn.close()
        print("\n[DevTracker] Stopped. Data saved.")
        sys.exit(0)

    signal.signal(signal.SIGINT,  on_exit)
    signal.signal(signal.SIGTERM, on_exit)

    ext_active = False   # tracks whether VS Code extension is providing data

    while True:
        now        = datetime.datetime.now().isoformat(timespec="seconds")
        app, title = get_active_window()

        # ── VS Code: prefer heartbeat over window-title parsing ───────────────
        if is_editor(app):
            proj, hb_detail, hb_lang = read_vscode_heartbeat()
            if hb_detail:
                detail = hb_detail
                if not ext_active:
                    print(f"  [DevTracker] VS Code extension detected ✓")
                    ext_active = True
                    if cur_detail and "||" not in cur_detail and cur_app == app:
                        # Extract project name from both and compare
                        old_proj = cur_detail.split(" / ")[0].strip().lower() if " / " in cur_detail else ""
                        new_proj = hb_detail.split("||")[-1].split(" / ")[0].strip().lower() if "||" in hb_detail else ""
                        if old_proj and new_proj and old_proj == new_proj:
                            # Same project — just upgrade the detail, keep session_start
                            cur_detail = hb_detail
                            cur_category = detect_category(app, hb_detail)
                            time.sleep(POLL_INTERVAL)
                            continue
            else:
                # Fallback: parse window title
                detail = parse_detail(app, title)
                if ext_active:
                    print(f"  [DevTracker] VS Code extension heartbeat lost — using title parsing")
                    ext_active = False

                if detail and detail.lower() in (
                    app.lower(), "visual studio code", "code", "cursor", "vscodium",
                ):
                    detail = ""
        else:
            detail     = parse_detail(app, title)
            ext_active = False

        category = detect_category(app, detail)

        if app != cur_app or detail != cur_detail:
            flush(now)
            cur_app, cur_title, cur_detail = app, title, detail
            cur_category, session_start    = category, now
            print(f"[{now}] → {app:<22}  {detail[:55]}")

        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()