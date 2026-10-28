@echo off
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0scripts\stop.mjs"
if errorlevel 1 pause
