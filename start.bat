@echo off
setlocal
REM start.bat — levanta backend :8787 + frontend :5174 en 2 ventanas (local, sin credenciales)
REM Uso: doble click en start.bat  o  .\start.bat  desde C:\Users\Estudiante UCU\WorkBuddy\Worktrees\web\main-c2128e3a

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo [termcanvas] ROOT=%ROOT%

REM 1) instalar deps si faltan (web + server)
if not exist "%ROOT%\web\node_modules" (
  echo [termcanvas] instalando web deps...
  call pnpm --filter web install
)
if not exist "%ROOT%\server\node_modules" (
  echo [termcanvas] instalando server deps...
  call pnpm --filter termcanvas-server install
)

REM 2) backend :8787 en nueva ventana (fail-closed local, dry_run sin GITHUB_* )
echo [termcanvas] levantando backend :8787 ...
start "termcanvas-server :8787" cmd /k "cd /d "%ROOT%\server" && pnpm dev"

REM esperar a que Hono responda /health (max 15s)
echo [termcanvas] esperando backend /health ...
for /L %%i in (1,1,15) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://localhost:8787/health -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto :backend_ok
  timeout /t 1 /nobreak >nul
)
echo [termcanvas] WARN: backend no respondio en 15s — igual levanto frontend (usa localStorage)

:backend_ok
echo [termcanvas] backend OK (o timeout) — levantando frontend ...

REM 3) frontend :5174 en nueva ventana, modo remote contra Hono local
REM    (VITE_FACTORY_BACKEND=remote -> FetchTransport + vite proxy /api -> :8787)
echo [termcanvas] levantando frontend :5174 (remote)...
start "termcanvas-web :5174" cmd /k "cd /d "%ROOT%" && set VITE_FACTORY_BACKEND=remote&& pnpm --filter web dev --port 5174"

REM 4) abrir browser cuando frontend responda (max 20s)
echo [termcanvas] esperando frontend :5174 ...
for /L %%i in (1,1,20) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://localhost:5174/ -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto :frontend_ok
  timeout /t 1 /nobreak >nul
)
echo [termcanvas] WARN: frontend no respondio en 20s — abrilo manual en http://localhost:5174
goto :end

:frontend_ok
echo [termcanvas] frontend OK — abriendo http://localhost:5174 ...
start "" "http://localhost:5174"

:end
echo.
echo [termcanvas] Listo. Ventanas:
echo   - termcanvas-server :8787  (Hono, SQLite data/termcanvas.db, /health)
echo   - termcanvas-web :5174     (Vite, proxy /api -^> :8787)
echo.
echo Para modo solo-local (sin server):  set VITE_FACTORY_BACKEND=local ^&^& pnpm --filter web dev --port 5174
echo Para parar: cerrar ambas ventanas o Ctrl+C en cada una.
endlocal
