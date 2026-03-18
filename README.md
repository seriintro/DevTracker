# DevTracker

A privacy-first activity tracker that monitors applications, websites, and coding activity — with all data stored locally on your machine.
Visualize productivity, project activity, and language usage through a local analytics dashboard.

![DevTracker Dashboard](https://img.shields.io/badge/stack-Python%20%7C%20Next.js%20%7C%20SQLite-00ff9d?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)

---

## Why DevTracker?

Many activity trackers rely on cloud services and require user accounts,
which means your usage data is sent to external servers.
DevTracker was built to provide a simpler and more private alternative.

- No accounts
- No cloud services
- No subscriptions
- Your data never leaves your machine

Everything runs locally using Python, SQLite, and a self-hosted dashboard.

---

## What it does

DevTracker tracks applications, websites, and coding activity to help you understand where your time is actually spent.

DevTracker runs silently in the background and records which applications, websites, and files you interact with — every 3 seconds. It then displays everything in a live dashboard you open in your browser.

### Dashboard Sections

📊 **Overview**
Shows today's activity summary including screen time, focus score,
hourly heatmap, app usage breakdown, and category distribution.

<img width="900" height="889" alt="Screenshot 2026-03-11 224047" src="https://github.com/user-attachments/assets/9bf97977-8f42-4183-a781-24f5725712bb" />


📂 **Files**
Displays every folder detected from VS Code, with file-level time tracking


<img width="900" height="904" alt="Screenshot 2026-03-11 233647" src="https://github.com/user-attachments/assets/bc8b6d6c-da65-446f-8ff9-fe60d6a42f91" />


🔖 **Projects**
Track and manage your bookmarked projects.

**All Bookmarked Projects**
<img width="900" height="905" alt="Screenshot 2026-03-11 224159" src="https://github.com/user-attachments/assets/3078f05e-525a-49f6-9487-8fdfd86ef1e1" />

Select any project to explore detailed analytics 👇

**Project Analytics View**
languages used, activity patterns, peak hours, and per-file time analysis, and a navigable project folder tree.

<img width="900" height="914" alt="Screenshot 2026-03-11 224219" src="https://github.com/user-attachments/assets/dd8a8b07-3b18-45c8-93ba-a06d8e59cbcd" />


---

## Features

- ⏱ **Automatic tracking** — polls active window every 3 seconds, zero manual input
- 🗂 **Real project detection** — uses the VS Code extension to identify the true project root, not just the window title
- 📁 **Full folder tree** — see time spent per file with the actual `subfolder/file.ext` structure preserved
- 🔖 **Project bookmarks** — mark any folder as a project to unlock deep analytics
- 🌐 **Browser tracking** — records which sites you visit, categorised automatically
- 📈 **Language breakdown** — Python, JavaScript, TypeScript etc. with `█` bar charts (WakaTime-style)
- 🕐 **Time patterns** — peak coding hours, best day, average per day
- 🗑 **Delete entries** — remove unwanted or renamed folders from the database
- 💾 **All data local** — stored in a single `devtracker.db` SQLite file you own completely

---

## Architecture

```
devtracker/
├── tracker/
│   ├── tracker.py       # Background poller — watches active window, writes to DB
│   └── api.py           # Local HTTP server (port 5050) — serves JSON to dashboard
├── dashboard/           # Next.js frontend
│   └── src/app/page.tsx # Single-page dashboard
├── vscode-extension/    # VS Code extension for accurate project detection
│   └── extension.js
├── devtracker.db        # SQLite database (created automatically on first run)
├── start.sh             # One-command start (macOS/Linux)
└── run.bat              # One-command start (Windows)
```

Three processes run together:

| Process | What it does | Port |
|---|---|---|
| `tracker.py` | Polls active window every 3s, writes sessions to SQLite | — |
| `api.py` | Reads DB, serves JSON endpoints | 5050 |
| `dashboard` (Next.js) | Browser UI, proxies API calls | 3000 |

---

## Requirements

- **Python 3.10+** — no pip packages needed, uses only stdlib
- **Node.js 18+** — for the Next.js dashboard
- **VS Code** (optional but recommended) — for accurate project root detection

**OS support:**
- Windows — works out of the box (uses Win32 API)
- macOS — works out of the box (uses AppleScript)
- Linux — requires `xdotool` (`sudo apt install xdotool`)

---

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/devtracker.git
cd devtracker
```

### 2. Install dashboard dependencies (once)

```bash
cd dashboard
npm install
cd ..
```

### 3. Install the VS Code extension (recommended)

The extension gives DevTracker the real file path and project root — without it, tracking falls back to window title parsing which is less accurate.

**Option A — Copy the folder directly (easiest, no tools needed)**

Copy the `vscode-extension/` folder into your VS Code extensions directory and rename it to `devtracker-vscode`:

macOS / Linux:
```bash
cp -r vscode-extension ~/.vscode/extensions/devtracker-vscode
```

Windows — paste this path into the File Explorer address bar and copy the folder there:
```
%USERPROFILE%\.vscode\extensions\devtracker-vscode\
```

Then **restart VS Code**. Done.

---

**Option B — Build and install a `.vsix` package**

```bash
cd vscode-extension
npm install -g @vscode/vsce
vsce package --no-dependencies
code --install-extension devtracker-vscode-1.0.0.vsix
```

Or manually in VS Code:
1. Open VS Code → Extensions (`Ctrl+Shift+X`)
2. Click `···` → **Install from VSIX...**
3. Select the `.vsix` file generated above

---

## Running

### Windows — single command

```bat
run.bat
```

### macOS / Linux — single command

```bash
./start.sh
```

### Manual (3 separate terminals)

**Terminal 1 — tracker:**
```bash
python tracker/tracker.py
```

**Terminal 2 — API:**
```bash
python tracker/api.py
```

**Terminal 3 — dashboard:**
```bash
cd dashboard
npm run dev
```

Then open **[http://localhost:3000](http://localhost:3000)** in your browser.

Switch between apps and watch the dashboard update live every 5 seconds.

### Stopping

Press `Ctrl+C` in each terminal window. Your data stays safely in `devtracker.db`.

---

## How project detection works

When the VS Code extension is active, every file you open writes a heartbeat to `~/.devtracker_vscode.json` containing:

- The full file path (`C:/dev/myproject/src/auth.py`)
- The resolved project root (`C:/dev/myproject`)
- The workspace name (`myproject`)

`tracker.py` reads this heartbeat and stores sessions in the format:

```
c:/dev/myproject||myproject / src/auth.py
```

This means:
- Two folders with the same name in different locations are always treated as separate projects
- Renaming a file doesn't create a duplicate — the project key is the folder path, not the name
- The full subfolder path is preserved, so the file tree shows `src/auth.py` not just `auth.py`

**Without the extension**, tracker falls back to parsing the VS Code window title (`project - VS Code`) which only gives the folder name, no full path.

---

## Bookmarking a project

In the **📂 Files** tab, every detected folder has a **＋ Bookmark as Project** button. Clicking it adds the folder to the **🔖 Projects** tab where you get:

- Total time invested (with 7d / 30d / 90d range selector)
- Active days + average time per day
- **Peak coding hours** (e.g. `8pm–11pm`)
- **Daily activity** bar chart
- **Time of day** heatmap
- **Best single day**
- **This week — languages used** with `█` block bars
- **All-time languages** with colour-coded segmented bar
- **Full file tree** with time per file and folder

Bookmarks are stored in the `bookmarked_projects` table inside `devtracker.db`.

---

## API endpoints

The Python API server runs on `http://localhost:5050`. All endpoints return JSON.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/stats?range=1\|7\|30` | Overview stats (apps, categories, daily totals) |
| GET | `/projects?range=7` | All detected VS Code folders with file breakdown |
| GET | `/hourly?date=YYYY-MM-DD` | Hourly activity for a specific day |
| GET | `/timeline?date=YYYY-MM-DD` | Full session list for a day |
| GET | `/bookmarks` | List all bookmarked project folders |
| POST | `/bookmarks` | Add bookmark `{"path": "...", "display": "..."}` |
| DELETE | `/bookmarks?path=...` | Remove a bookmark |
| GET | `/bookmarked_projects?range=30` | Deep analytics for bookmarked projects only |
| DELETE | `/folder?path=...` | Delete all sessions for a folder from the DB |

---

## Database schema

A single SQLite file `devtracker.db` in the project root.

```sql
-- Every active window session
CREATE TABLE sessions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    app       TEXT NOT NULL,          -- e.g. "Code", "Google Chrome"
    title     TEXT,                   -- raw window title
    detail    TEXT,                   -- parsed: "path||Project / file.ext"
    category  TEXT,                   -- code | browse | productivity | communication | media | other
    started   TEXT NOT NULL,          -- ISO datetime
    ended     TEXT,                   -- ISO datetime
    duration  INTEGER DEFAULT 0       -- seconds
);

-- Folders you've bookmarked as projects
CREATE TABLE bookmarked_projects (
    path     TEXT PRIMARY KEY,        -- normalised full path key
    display  TEXT NOT NULL,           -- display name shown in UI
    added    TEXT NOT NULL            -- ISO datetime when bookmarked
);
```

---

## Privacy

All data is stored locally in `devtracker.db`. Nothing is sent anywhere. The API only listens on `localhost` so it is not accessible from outside your machine.

To delete all your data: just delete `devtracker.db`. It will be recreated empty on next run.

---

## Troubleshooting

**Dashboard shows "Could not connect to API"**
Make sure `tracker/api.py` is running (`python tracker/api.py`) and check that port 5050 is not blocked by a firewall.

**VS Code project shows wrong name / duplicate entries**
Install the VS Code extension for accurate tracking. Without it, tracker relies on window title parsing which can misidentify project names.

**Renamed a folder and now there are two entries**
The tracker keys projects by their full path, so renaming creates a new entry. Use the 🗑 **Delete** button in the Files tab to remove the old entry.

**Linux: "xdotool not found"**
```bash
sudo apt install xdotool       # Debian/Ubuntu
sudo pacman -S xdotool         # Arch
sudo dnf install xdotool       # Fedora
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Tracker | Python 3 (stdlib only) |
| Database | SQLite |
| API server | Python 3 `http.server` (stdlib only) |
| Frontend | Next.js 14, TypeScript, Recharts |
| VS Code extension | VS Code Extension API |

---

## License

MIT License — free to use, modify, and distribute.
