@echo off
setlocal EnableDelayedExpansion
title DevTracker

echo.
echo  ==========================================
echo   DevTracker - Starting up...
echo  ==========================================
echo.

:: Store the folder this bat file lives in (no trailing backslash)
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

:: ── Check Python ──────────────────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python not found.
    echo  Download it from: https://www.python.org/downloads/
    echo  Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

:: ── Check Node ────────────────────────────────────────────────────────────────
node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found.
    echo  Download it from: https://nodejs.org/
    pause
    exit /b 1
)

echo  [OK] Python and Node.js found.
echo.

:: ── Install VS Code extension ─────────────────────────────────────────────────
set "EXT_SRC=%ROOT%\vscode-extension"
set "EXT_DST=%USERPROFILE%\.vscode\extensions\devtracker-vscode"

if not exist "%EXT_DST%" (
    echo  [SETUP] Installing VS Code extension...
    xcopy /E /I /Q /Y "%EXT_SRC%" "%EXT_DST%" >nul
    echo  [OK] VS Code extension installed. Restart VS Code once to activate it.
) else (
    xcopy /E /I /Q /Y "%EXT_SRC%" "%EXT_DST%" >nul
    echo  [OK] VS Code extension is up to date.
)
echo.

:: ── Install dashboard npm packages (only if node_modules missing) ─────────────
if not exist "%ROOT%\dashboard\node_modules" (
    echo  [SETUP] Installing dashboard packages (first time only, ~1 min^)...
    cd /d "%ROOT%\dashboard"
    call npm install --silent
    cd /d "%ROOT%"
    echo  [OK] Dashboard packages installed.
    echo.
)


:: ── Write helper scripts so paths with spaces work cleanly ───────────────────
set "RUN_TRACKER=%ROOT%\run_tracker.bat"
set "RUN_API=%ROOT%\run_api.bat"
set "RUN_DASH=%ROOT%\run_dashboard.bat"

echo @echo off > "%RUN_TRACKER%"
echo python "%ROOT%\tracker\tracker.py" >> "%RUN_TRACKER%"

echo @echo off > "%RUN_API%"
echo python "%ROOT%\tracker\api.py" >> "%RUN_API%"

echo @echo off > "%RUN_DASH%"
echo cd /d "%ROOT%\dashboard" >> "%RUN_DASH%"
echo npm run dev >> "%RUN_DASH%"

:: ── Start all three ───────────────────────────────────────────────────────────
echo  [START] Tracker...
start "DevTracker - Tracker" /min cmd /c "%RUN_TRACKER%"

timeout /t 1 /nobreak >nul

echo  [START] API server...
start "DevTracker - API" /min cmd /c "%RUN_API%"

timeout /t 1 /nobreak >nul

echo  [START] Dashboard...
start "DevTracker - Dashboard" /min cmd /c "%RUN_DASH%"

:: ── Wait for dashboard then open browser ──────────────────────────────────────
echo.
echo  [....] Waiting for dashboard to be ready (may take 30 seconds first time^)...
:WAIT_LOOP
timeout /t 2 /nobreak >nul
curl -s http://localhost:3000 >nul 2>&1
if errorlevel 1 goto WAIT_LOOP

echo  [OK] Dashboard is ready!
echo.
start "" "http://localhost:3000"

:: ── Running ───────────────────────────────────────────────────────────────────
echo  ==========================================
echo   DevTracker is running!
echo.
echo   Dashboard : http://localhost:3000
echo   API       : http://localhost:5050
echo.
echo   Press Ctrl+C or close this window to stop.
echo  ==========================================
echo.

:KEEP_ALIVE
timeout /t 5 /nobreak >nul
goto KEEP_ALIVE

:CLEANUP
echo.
echo  Stopping DevTracker...
taskkill /f /fi "WindowTitle eq DevTracker - Tracker*"   >nul 2>&1
taskkill /f /fi "WindowTitle eq DevTracker - API*"       >nul 2>&1
taskkill /f /fi "WindowTitle eq DevTracker - Dashboard*" >nul 2>&1
taskkill /f /im "python.exe" >nul 2>&1
taskkill /f /im "node.exe"   >nul 2>&1
del "%RUN_TRACKER%" "%RUN_API%" "%RUN_DASH%" >nul 2>&1
echo  Stopped. Your data is saved in devtracker.db
pause
exit /b 0
