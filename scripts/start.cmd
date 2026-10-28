@echo off
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul
"%~dp0runtime\node.exe" "%~dp0app\server\index.js" --open
if errorlevel 1 (
  echo Failed to start Mayhem Pocket. Please check this folder and try again.
  pause
)
