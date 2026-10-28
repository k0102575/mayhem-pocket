@echo off
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul
"%~dp0runtime\node.exe" "%~dp0app\server\index.js" --open
