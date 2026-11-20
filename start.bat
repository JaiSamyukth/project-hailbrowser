@echo off
rem HailBrowser start script (Windows). Checks GitHub for updates, then opens your browser.
rem Options: --start  --update  --settings  --doctor  --no-update  --menu
setlocal
cd /d "%~dp0"
chcp 65001 >nul 2>&1
where node >nul 2>&1
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo HailBrowser needs Node.js 18 or newer. Install it from https://nodejs.org and run this again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
if not defined NODE_USE_ENV_PROXY set "NODE_USE_ENV_PROXY=1"
rem Everything after node is on one line: cmd has already read it if an update replaces this file.
node launcher\hailbrowser.mjs %* & if defined HAILBROWSER_NO_PAUSE (exit /b) else if errorlevel 1 (pause & exit /b 1) else (timeout /t 6 >nul 2>&1 & exit /b 0)
