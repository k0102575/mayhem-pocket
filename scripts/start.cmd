@echo off
cd /d "%~dp0"
if exist "%~dp0Mayhem Pocket.exe" (
  start "" "%~dp0Mayhem Pocket.exe"
  exit /b 0
)
echo Mayhem Pocket.exe is missing. Extract the complete release ZIP and try again.
pause
exit /b 1
