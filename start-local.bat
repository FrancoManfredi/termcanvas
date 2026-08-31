@echo off
setlocal
REM start-local.bat — solo frontend :5174 en modo local (sin backend, localStorage)
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if not exist "%ROOT%\web\node_modules" call pnpm --filter web install
start "termcanvas-web :5174 local" cmd /k "cd /d "%ROOT%" && set VITE_FACTORY_BACKEND=local&& pnpm --filter web dev --port 5174"
for /L %%i in (1,1,20) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://localhost:5174/ -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto :ok
  timeout /t 1 /nobreak >nul
)
goto :end
:ok
start "" "http://localhost:5174"
:end
endlocal
