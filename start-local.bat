@echo off
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if not exist "%ROOT%\web\node_modules" call pnpm --filter web install
set "VITE_FACTORY_BACKEND=local"
call pnpm --filter web dev --port 5174
endlocal
