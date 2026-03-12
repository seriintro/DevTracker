# DevTracker — VS Code Extension

The extension gives DevTracker accurate project tracking inside VS Code.  
**Without it**, DevTracker guesses the project from the window title — which is often wrong.  
**With it**, DevTracker knows the exact file and real project folder at all times.

---

## Why you need it

When VS Code has `project-A` open as a workspace but you open a file from `project-B`, the window title still says `project-A`. Without the extension, DevTracker logs that time under the wrong project.

The extension bypasses the window title entirely — it writes the real file path and project root directly to `~/.devtracker_vscode.json` every time you switch files.

---

## Install

You have two options. **Option A is recommended** — no tools needed.

### Option A — Copy the folder directly (easiest)

Copy the `vscode-extension/` folder into your VS Code extensions directory and rename it to `devtracker-vscode`:

**Windows**
```
%USERPROFILE%\.vscode\extensions\devtracker-vscode\
```

**macOS / Linux**
```
~/.vscode/extensions/devtracker-vscode/
```

Then **restart VS Code**. No npm install needed — the extension has zero dependencies.

---

### Option B — Build and install a `.vsix` package

If you prefer a proper install via the VS Code UI:

```bash
cd vscode-extension
npm install -g @vscode/vsce
vsce package --no-dependencies
# Produces: devtracker-vscode-1.0.0.vsix
```

Then in VS Code:
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type **Install from VSIX**
3. Select the `devtracker-vscode-1.0.0.vsix` file
4. Reload VS Code when prompted

---

## Verify it's working

Once VS Code is open with the extension installed, check that the heartbeat file exists:

**macOS / Linux**
```bash
cat ~/.devtracker_vscode.json
```

**Windows (PowerShell)**
```powershell
cat $env:USERPROFILE\.devtracker_vscode.json
```

You should see output like this:
```json
{
  "file":          "C:/Users/you/dev/my-project/src/app.py",
  "fileName":      "app.py",
  "language":      "python",
  "workspaceRoot": "C:/Users/you/dev/my-project",
  "workspaceName": "my-project",
  "openedFolder":  "C:/Users/you/dev/my-project",
  "ts":            1700000000000
}
```

If the file exists and the `workspaceName` matches your actual project — it's working.

---

## How project detection works

The extension uses `vscode.workspace.getWorkspaceFolder(document.uri)` — the correct VS Code API that returns the workspace folder owning the **currently open file**, not just `workspaceFolders[0]`.

It then walks up the directory tree from that folder looking for any of these project root markers:

```
.git            package.json      pyproject.toml    Cargo.toml
go.mod          pom.xml           build.gradle      Makefile
requirements.txt   setup.py       tsconfig.json     next.config.js
```

The first non-generic folder containing one of these markers becomes the project root. Generic subfolder names like `src`, `frontend`, `auth`, `components` are always skipped — so `my-project/frontend/` is never mistaken for the project root when `my-project/` has a `.git`.

---

## Fallback behaviour

If the extension is not installed, or VS Code is closed, `tracker.py` automatically falls back to parsing the window title. You'll see this in the tracker console:

```
[DevTracker] VS Code extension heartbeat lost — using title parsing
```

Tracking continues — it just won't be as accurate for project names.

---

## Cursor IDE

The extension works with **Cursor** in exactly the same way. Copy the folder into:

**Windows**
```
%USERPROFILE%\.cursor\extensions\devtracker-vscode\
```

**macOS / Linux**
```
~/.cursor/extensions/devtracker-vscode/
```
