# DevTracker VS Code Extension

This tiny extension fixes the core accuracy problem with tracking VS Code:

**The problem:** When you open a single file from folder `project2` inside a VS Code
window that has `project1` open as its workspace, the window title still shows
`filename — project1`. DevTracker (and WakaTime) would incorrectly log this as
time spent in `project1`.

**The fix:** This extension watches `onDidChangeActiveTextEditor` and writes the
**real file path** to `~/.devtracker_vscode.json` every time you switch files (and
every 5 seconds while editing). `tracker.py` reads this file and uses the actual
project folder — not the window title.

---

## Install (no VS Code Marketplace needed)

### Option A — Install from `.vsix` file (easiest)

1. Open VS Code
2. Press `Ctrl+Shift+P` → type **"Install from VSIX"**
3. Select `devtracker-vscode-1.0.0.vsix`
4. Reload VS Code when prompted

### Option B — Install as a development extension (no packaging needed)

1. Copy the `vscode-extension/` folder into your VS Code extensions directory:

   **Windows:**
   ```
   %USERPROFILE%\.vscode\extensions\devtracker-vscode\
   ```
   **macOS / Linux:**
   ```
   ~/.vscode/extensions/devtracker-vscode/
   ```

2. Restart VS Code.

That's it — no npm install needed, the extension uses only Node.js built-ins.

---

## How to build the `.vsix` yourself (optional)

```bash
cd vscode-extension
npm install -g @vscode/vsce
vsce package --no-dependencies
# → devtracker-vscode-1.0.0.vsix
```

---

## Verify it's working

Once installed and VS Code is open, check that this file exists and updates:

```bash
# macOS / Linux
cat ~/.devtracker_vscode.json

# Windows (PowerShell)
cat $env:USERPROFILE\.devtracker_vscode.json
```

You should see something like:
```json
{
  "file":      "C:/Users/you/projects/project2/abc.py",
  "fileName":  "abc.py",
  "project":   "project2",
  "workspace": "project1",
  "language":  "python",
  "ts":        1700000000000
}
```

Notice `project` is `project2` (where the file actually lives) even though
`workspace` is `project1` (what VS Code has open). DevTracker uses `project`.

---

## How project detection works

The extension walks up the directory tree from the open file looking for:

```
package.json   pyproject.toml   Cargo.toml   go.mod
pom.xml        build.gradle     Makefile     .git
requirements.txt   setup.py    composer.json
```

The **nearest** matching folder becomes the project name. If none is found,
it falls back to the file's immediate parent folder.

---

## Fallback behavior

If the extension is not installed (or VS Code is closed), `tracker.py` falls back
to parsing the window title exactly as before. You'll see this message in the
tracker console:

```
[DevTracker] VS Code extension heartbeat lost — using title parsing
```
