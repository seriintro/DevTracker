"""
seed_demo.py — Populates devtracker.db with 7 days of realistic demo data.

FIXED vs old version:
  - Schema now includes 'detail' and 'category' columns (matches tracker.py)
  - Chrome tabs tracked with realistic site names and correct categories
  - Includes games, WhatsApp, File Explorer, Snipping Tool, Photos
  - Sessions are weighted by time-of-day (work hours = more coding)
  - No hardcoded continue-bias that caused unrealistic gaps
  - Summary shows VS Code project breakdown on completion

Run once: python3 seed_demo.py
"""

import sqlite3, random, datetime, os

DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "devtracker.db"))

# ── Window titles / details per app ───────────────────────────────────────────
# Each entry: (detail_string, category)
DETAILS = {
    "VS Code": [
        ("devtracker / tracker.py",         "code"),
        ("devtracker / api.py",             "code"),
        ("devtracker / seed_demo.py",       "code"),
        ("dashboard / page.tsx",            "code"),
        ("dashboard / layout.tsx",          "code"),
        ("dashboard / package.json",        "code"),
        ("my-portfolio / index.html",       "code"),
        ("my-portfolio / styles.css",       "code"),
        ("my-portfolio / app.js",           "code"),
        ("backend-api / models.py",         "code"),
        ("backend-api / routes.py",         "code"),
        ("notes / scratch.md",              "code"),
    ],
    "Terminal": [
        ("python3 tracker.py",   "code"),
        ("npm run dev",          "code"),
        ("git status",           "code"),
        ("git commit",           "code"),
        ("pip install",          "code"),
        ("bash",                 "code"),
        ("npm install",          "code"),
        ("python3 api.py",       "code"),
    ],
    "Google Chrome": [
        ("GitHub · devtracker/pulls",           "code"),
        ("GitHub · devtracker/issues",          "code"),
        ("Stack Overflow · KeyError python",    "code"),
        ("MDN · fetch API reference",           "code"),
        ("Vercel · Dashboard",                  "code"),
        ("YouTube · Python asyncio explained",  "media"),
        ("YouTube · Lo-fi beats to study",      "media"),
        ("YouTube · Rocket League highlights",  "media"),
        ("LinkedIn · Feed",                     "social"),
        ("Twitter · Home",                      "social"),
        ("Reddit · r/programming",              "social"),
        ("Instagram · Home",                    "social"),
        ("Gmail · Inbox",                       "communication"),
        ("Google Docs · Sprint Notes",          "productivity"),
        ("Notion · Project Roadmap",            "productivity"),
        ("ChatGPT · New chat",                  "productivity"),
        ("Google · search results",             "browse"),
        ("Amazon · cart",                       "browse"),
        ("claude.ai · conversation",            "productivity"),
    ],
    "WhatsApp": [
        ("Ahmed",         "communication"),
        ("Sara",          "communication"),
        ("Family Group",  "communication"),
        ("Work Team",     "communication"),
    ],
    "Slack": [
        ("#general",    "communication"),
        ("#dev-team",   "communication"),
        ("DM: Alice",   "communication"),
        ("#random",     "communication"),
    ],
    "Discord": [
        ("Programming · #help",    "communication"),
        ("Gaming · #general",      "communication"),
        ("Friends · general",      "communication"),
    ],
    "Notion": [
        ("Sprint Notes",     "productivity"),
        ("Project Roadmap",  "productivity"),
        ("Daily Journal",    "productivity"),
        ("Reading List",     "productivity"),
    ],
    "Figma": [
        ("Dashboard Design · Components",  "productivity"),
        ("App Mockup · Screens",           "productivity"),
        ("Logo Design",                    "productivity"),
    ],
    "Microsoft Word": [
        ("CV_2025.docx",         "productivity"),
        ("Project Report.docx",  "productivity"),
    ],
    "Spotify": [
        ("Lo-fi Beats",    "media"),
        ("Top Hits 2025",  "media"),
        ("Focus Music",    "media"),
    ],
    "VLC": [
        ("tutorial_video.mp4",    "media"),
        ("lecture_recording.mp4", "media"),
    ],
    "Rocket League": [
        ("Rocket League",  "other"),
    ],
    "Minecraft": [
        ("Minecraft",  "other"),
    ],
    "File Explorer": [
        ("Downloads",          "other"),
        ("Documents",          "other"),
        ("devtracker folder",  "other"),
        ("Pictures",           "other"),
        ("Desktop",            "other"),
    ],
    "Photos": [
        ("screenshot_2025.png",  "other"),
        ("vacation_photo.jpg",   "other"),
    ],
    "Snipping Tool": [
        ("Snipping Tool",  "other"),
    ],
}

# ── Time-of-day weighted app selection ────────────────────────────────────────

def pick_app(hour: int) -> tuple:
    """Return (app_name, detail, category) weighted by hour of day."""
    if 9 <= hour <= 17:       # work hours
        weights = {
            "VS Code": 40, "Terminal": 18, "Google Chrome": 22,
            "Slack": 8, "Notion": 5, "Figma": 4, "WhatsApp": 5,
            "Spotify": 4, "File Explorer": 3, "Discord": 2,
            "Microsoft Word": 3, "Snipping Tool": 2, "Photos": 1,
            "Rocket League": 1, "Minecraft": 1, "VLC": 1,
        }
    elif hour >= 20 or hour < 6:   # evening / night
        weights = {
            "VS Code": 8, "Terminal": 4, "Google Chrome": 20,
            "WhatsApp": 14, "Discord": 10, "Rocket League": 14,
            "Minecraft": 10, "Spotify": 12, "VLC": 5,
            "Notion": 3, "File Explorer": 2, "Photos": 2,
            "Slack": 1, "Figma": 1, "Microsoft Word": 1, "Snipping Tool": 1,
        }
    else:                           # morning / late afternoon
        weights = {
            "VS Code": 20, "Terminal": 10, "Google Chrome": 28,
            "WhatsApp": 10, "Slack": 6, "Spotify": 8, "Notion": 4,
            "Discord": 5, "File Explorer": 3, "Photos": 2,
            "Rocket League": 4, "Minecraft": 2, "Figma": 3,
            "Microsoft Word": 2, "VLC": 2, "Snipping Tool": 1,
        }

    app_name = random.choices(list(weights.keys()), weights=list(weights.values()))[0]
    detail, category = random.choice(DETAILS[app_name])
    return app_name, detail, category


# ── Database setup ────────────────────────────────────────────────────────────

conn = sqlite3.connect(DB_PATH)

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

# Safe column upgrades (in case running against an old DB)
for col in ["detail TEXT", "category TEXT"]:
    try:
        conn.execute(f"ALTER TABLE sessions ADD COLUMN {col}")
    except Exception:
        pass

conn.execute("CREATE INDEX IF NOT EXISTS idx_started ON sessions(started)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_app     ON sessions(app)")
conn.execute("DELETE FROM sessions")
conn.commit()

# ── Generate sessions ─────────────────────────────────────────────────────────

today = datetime.date.today()
rows  = []
project_seconds: dict[str, int] = {}

for day_offset in range(6, -1, -1):
    day = today - datetime.timedelta(days=day_offset)

    start_h = random.randint(8, 10)
    end_h   = random.randint(18, 22)

    current    = datetime.datetime(day.year, day.month, day.day, start_h, random.randint(0, 59))
    end_of_day = datetime.datetime(day.year, day.month, day.day, end_h,   random.randint(0, 59))

    # Lunch gap
    lunch_start = datetime.datetime(day.year, day.month, day.day, random.randint(12, 13), 0)
    lunch_end   = lunch_start + datetime.timedelta(minutes=random.randint(30, 70))

    while current < end_of_day:
        if lunch_start <= current < lunch_end:
            current = lunch_end
            continue

        app_name, detail, category = pick_app(current.hour)

        # Session length by app type
        if app_name in ("VS Code", "Terminal") and random.random() < 0.35:
            duration = random.randint(600, 3600)   # deep work: 10–60 min
        elif app_name in ("Rocket League", "Minecraft"):
            duration = random.randint(900, 5400)   # gaming: 15–90 min
        elif app_name == "Spotify":
            duration = random.randint(300, 1800)   # music: 5–30 min
        else:
            duration = random.randint(60, 1200)    # normal: 1–20 min

        ended = current + datetime.timedelta(seconds=duration)

        rows.append((
            app_name, detail, detail, category,
            current.isoformat(timespec="seconds"),
            ended.isoformat(timespec="seconds"),
            duration,
        ))

        # Track VS Code project totals for summary
        if app_name == "VS Code" and "/" in detail:
            project = detail.split("/")[0].strip()
            project_seconds[project] = project_seconds.get(project, 0) + duration

        # Small idle gap between sessions
        current = ended + datetime.timedelta(seconds=random.randint(0, 60))

# ── Write ─────────────────────────────────────────────────────────────────────

conn.executemany(
    "INSERT INTO sessions (app, title, detail, category, started, ended, duration) "
    "VALUES (?, ?, ?, ?, ?, ?, ?)",
    rows,
)
conn.commit()
conn.close()

# ── Summary ───────────────────────────────────────────────────────────────────

print(f"\n✅  Seeded {len(rows)} sessions into:\n    {DB_PATH}\n")
if project_seconds:
    print("📂  VS Code project breakdown:")
    for proj, secs in sorted(project_seconds.items(), key=lambda x: -x[1]):
        h, m = divmod(secs // 60, 60)
        print(f"    {proj:<28} {h}h {m:02d}m")
    print()
