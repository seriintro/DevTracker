
const vscode = require("vscode");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");

const HEARTBEAT_PATH = path.join(os.homedir(), ".devtracker_vscode.json");
let lastWritten = "";

const PROJECT_MARKERS = [
  ".git", ".devtracker-project",
  "package.json", "pyproject.toml", "Cargo.toml", "go.mod",
  "pom.xml", "build.gradle", "Makefile", "CMakeLists.txt",
  "composer.json", "requirements.txt", "setup.py", "setup.cfg",
  "tsconfig.json", "vite.config.js", "vite.config.ts",
  "next.config.js", "nuxt.config.js", "angular.json",
  ".flake8", "manage.py",
];

// Containers = filesystem organisers, never project names. Stop climbing here.
const CONTAINER_FOLDERS = new Set([
  "desktop", "documents", "downloads", "pictures", "videos", "music",
  "users", "home", "onedrive", "dropbox", "googledrive", "icloud",
  "appdata", "program files", "program files (x86)", "windows",
  "system32", "usr", "etc", "var", "tmp", "opt",
  "visual studio code", "code", "vscode", "cursor",
]);

// Generic subfolder names that are parts of a project, not the project itself
const GENERIC_SUBFOLDERS = new Set([
  "frontend", "backend", "src", "lib", "app", "api", "server", "client",
  "core", "main", "utils", "helpers", "common", "components", "pages",
  "views", "routes", "models", "controllers", "services", "middleware",
  "static", "public", "assets", "styles", "css", "js", "ts",
  "dist", "build", "out", "output", "test", "tests", "__tests__", "spec",
  "docs", "scripts", "config", "types", "hooks", "store", "context",
  // Common module/feature names that aren't top-level projects
  "authentication", "auth", "authorization", "login", "register",
  "dashboard", "admin", "user", "users", "profile", "settings",
]);

const isContainer = d => CONTAINER_FOLDERS.has(path.basename(d).toLowerCase());
const isGeneric   = d => GENERIC_SUBFOLDERS.has(path.basename(d).toLowerCase());
const hasMarker   = d => PROJECT_MARKERS.some(m => {
  try { return fs.existsSync(path.join(d, m)); } catch (_) { return false; }
});


function resolveProject(workspaceFolder) {
  if (!workspaceFolder) return null;

  let best = null;   // best candidate found so far
  let dir  = workspaceFolder;

  for (let i = 0; i < 14; i++) {
    if (isContainer(dir)) break;

    const generic = isGeneric(dir);
    const marker  = hasMarker(dir);

    if (!generic) {

      if (!best || marker) {
        best = dir;
      }

      if (best && hasMarker(best) && !marker) break;
    }


    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (best) return { name: path.basename(best), root: best };


  return { name: path.basename(workspaceFolder), root: workspaceFolder };
}

function writeHeartbeat(editor) {
  try {
    const doc      = editor?.document;
    const filePath = doc?.uri?.fsPath || null;
    const language = doc?.languageId  || null;
    const fileName = filePath ? path.basename(filePath) : null;


    const wsFolder = doc
      ? vscode.workspace.getWorkspaceFolder(doc.uri)?.uri?.fsPath ?? null
      : (vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? null);

    const resolved    = resolveProject(wsFolder);
    const projectRoot = resolved?.root ?? null;
    const projectName = resolved?.name ?? null;

    const payload = JSON.stringify({
      file:          filePath,      // full path to open file
      fileName:      fileName,      // e.g. "App.jsx"
      language:      language,      // e.g. "javascript"
      workspaceRoot: projectRoot,   // resolved real project root
      workspaceName: projectName,   // resolved project name (never "Desktop" etc.)
      openedFolder:  wsFolder,      // raw workspace folder for this file
      ts:            Date.now(),
    });

    if (payload === lastWritten) return;
    lastWritten = payload;
    fs.writeFileSync(HEARTBEAT_PATH, payload, "utf8");

  } catch (err) {
    console.error("[DevTracker]", err.message);
  }
}

function activate(context) {
  console.log("[DevTracker] Extension active");
  writeHeartbeat(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => writeHeartbeat(editor)),
    { dispose: () => clearInterval(
        setInterval(() => writeHeartbeat(vscode.window.activeTextEditor), 5000)
      )
    },
  );

  // Keep heartbeat alive on interval
  const interval = setInterval(() => writeHeartbeat(vscode.window.activeTextEditor), 5000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

function deactivate() {
  try { fs.writeFileSync(HEARTBEAT_PATH, JSON.stringify({ closed: true, ts: Date.now() }), "utf8"); }
  catch (_) {}
}

module.exports = { activate, deactivate };
