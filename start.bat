@echo off
setlocal
REM start.bat — backend :8787 + frontend :5174 en LA MISMA terminal (local, sin credenciales)
REM Uso: doble click en start.bat  o  .\start.bat

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo [termcanvas] ROOT=%ROOT%

if not exist "%ROOT%\web\node_modules" (
  echo [termcanvas] instalando web deps...
  call pnpm --filter web install
)
if not exist "%ROOT%\server\node_modules" (
  echo [termcanvas] instalando server deps...
  call pnpm --filter termcanvas-server install
)

echo [termcanvas] levantando backend :8787 + frontend :5174 en la misma terminal...
echo [termcanvas] logs con prefijo [server] y [web] — Ctrl+C para parar ambos
echo.

REM pnpm --parallel levanta ambos en el mismo proceso con logs multiplexados
REM VITE_FACTORY_BACKEND=remote solo lo usa web (server lo ignora)
set "VITE_FACTORY_BACKEND=remote"
call pnpm --filter termcanvas-server --filter web --parallel dev

endlocal
