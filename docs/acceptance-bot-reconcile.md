# Acceptance live — Reconciliación post-bot automática

Runbook para validar end-to-end la ronda de reconciliación post-bot del
factory (`startBotReconcileRun`), con daemon, GitHub y bot reales. Los tests
offline cubren la lógica con fakes; esto valida la integración real.

## Qué valida

El ciclo completo: publish bloqueado por findings del bot → hook → reapertura
de Building → run nuevo de `fix-issue` con `bot_findings` → commit/push en el
PR abierto (sin PR duplicado) → segundo publish con reconciliación mecánica
`Taken/Open` → cap 1.

## Pre-requisitos

- `gh` autenticado con scope sobre el repo de prueba (`test-orquestador`) y
  `git` disponible en el PATH del daemon.
- Daemon de TermCanvas corriendo con estas variables en el entorno (el gate
  también se prende por el setting persistido, ver abajo):

| Variable | Valor sugerido | Para qué |
|---|---|---|
| `TERMCANVAS_BOT_RECONCILE` | `1` | Override de env del gate (default off; gana sobre el setting) |
| `TERMCANVAS_REVIEW_WAIT_MS` | `120000` | Acorta el wait del bot para iterar (default 20 min) |
| `TERMCANVAS_REVIEW_BOTS` | `pullfrog` | Un solo bot para reducir ruido (default incluye CodeRabbit) |

- Un issue en el repo de prueba apto para el flujo (reusar uno chico o crear
  uno con prefijo conventional: `bug: ...`). La rama y el PR los deriva el
  engine (`issue-<N>-<slug>`).

### Cómo prender el gate (Windows)

Dos caminos; el env gana si está seteado (`1`/`0`), si no vale el setting:

1. **Setting persistido (recomendado, sin reinicio)**: toggle en Settings del
   panel o por API.

   ```powershell
   curl.exe -s -X POST http://127.0.0.1:17680/factory/settings `
     -H "Content-Type: application/json" --data "{\"botReconcile\":true}"
   ```

   Se guarda en `<repo>/factory/.settings.json` (gitignored) y la política se
   lee por llamada: el cambio aplica en el momento, sin reiniciar el daemon.

2. **Override de entorno (exige reiniciar el proceso del factory)**:

   ```powershell
   [Environment]::SetEnvironmentVariable('TERMCANVAS_BOT_RECONCILE','1','User')
   # y relanzar el proceso que corre el factory (dev: `npm run dev` COMPLETO,
   # desde una terminal NUEVA abierta después de setear la variable).
   ```

   Ojo con Windows: una terminal abierta antes del `SetEnvironmentVariable`
   no ve el cambio (los hijos heredan el env viejo). En dev el factory corre
   IN-PROCESS en Electron (`ensureFactoryServer`), así que el proceso que
   importa es Electron, no un daemon standalone.

### Cómo verificar el gate en el PROCESO VIVO (obligatorio)

`/factory/health` expone el gate efectivo y su fuente. Verificá contra el
proceso que sirve el puerto, no contra logs de otro daemon:

```powershell
# 1) PID que sirve el factory (dev: electron.exe; en cada config el archivo
#    de puerto se escribe en ~/.termcanvas-dev o ~/.termcanvas)
Get-Content "$env:USERPROFILE\.termcanvas-dev\factory-port"   # → PID
Get-Content "$env:USERPROFILE\.termcanvas-dev\port"           # → puerto

# 2) Gate efectivo del proceso vivo (usá el puerto del archivo de arriba;
#    17680 es el default)
curl.exe -s http://127.0.0.1:17680/factory/health
#    esperado: "botReconcile":{"enabled":true,"source":"env"|"setting"}
```

Si `source` es `"env"`, el setting persistido no tiene efecto hasta apagar la
variable (y reiniciar); si es `"setting"`/`"default"`, manda el setting.
Para apagarlo: POST `{"botReconcile":false}` o borrar la variable de usuario
(y reiniciar si venía del env).


## Pre-flight (sin efectos)

Con el daemon apagado o en otra carpeta de factory, verificá que el engine
arranca con los cambios:

```
npm run smoke:factory
```

Esperado: `[wf-daemon-smoke] OK` con la lista de workflows
(`factory-default, fix-issue, ...`). Es un smoke hermético (factory dir
temporal, mata su propio proceso).

## Procedimiento

1. Prender el gate (setting por API/UI o env) y verificar
   `/factory/health` como indica la sección anterior — el PID verificado debe
   ser el que sirve el factory.
2. Crear el job sobre el issue de prueba y dejarlo correr:
   triage → implement → verify → review → `Complete` → PR abierto.
3. Esperar el primer publish (comentario canónico en el PR). Debe traer:
   `verdict: REVIEW INCOMPLETE`, `readiness: blocked` y la sección
   `## 6. Bot review` con el/los findings `Open`.
4. Verificar el disparo de la ronda en el timeline del job:
   - `bot reconcile: N open finding(s) prepared for a new revise round (cap 1)`
   - `engine: run de reconciliación <runId>`
   - el job pasa a `Building` (el panel lo muestra In Progress de nuevo).
5. Seguir el run de reconciliación: workflow `fix-issue`, input
   `bot_findings` con el bloque `- f1 (archivo) — mensaje` (visible en el
   prompt del agente). El agente debe corregir o disponer cada `fN` en
   `## Dispositions`.
6. Al terminar el run: commit(s) nuevos en la rama del PR (con
   `## Commit units` si el agente lo emitió), push al mismo PR, sin PR nuevo.
7. Esperar el segundo publish (nuevo head):
   - el finding cuyo archivo fue tocado pasa a `Taken`;
   - si no quedan `Open`, `readiness: ready`;
   - si el agente no tocó el archivo, sigue `Open` y el cap impide otra ronda
     (queda para decisión humana).

### Variantes de recuperación (P2/P3)

- **Gate off con findings abiertos**: el publish sigue igual y el timeline
  deja `bot reconcile skipped: N open finding(s) sin ronda (gate off)`. Es la
  traza que distingue "no había findings" de "la ronda estaba apagada".
- **Ronda perdida** (se publicó con el gate off, o el hook murió antes de
  arrancar el run): prendé el gate y reiniciá el proceso del factory; el boot
  corre `resumeMissedBotReconcileRounds` y para los jobs `Complete`/`pr-open`
  con reporte publicado y findings `Open` estructurados deja
  `bot reconcile: ... (cap 1, boot recovery)` + `engine: run de
  reconciliación <runId>`. Nota: reports publicados antes de la persistencia
  `botFindings` (2026-09-17) no se recuperan automáticamente.
- **Starter sin arrancar**: el timeline explica el motivo con
  `reconciliación post-bot no arrancó: <reason>` (`flag-off`,
  `not-complete:<status>`, `not-isolated`, `no-bot-round`, `run-active`,
  `no-findings`, `start-failed`).

## Checklist de verificación

| # | Verificación | Cómo mirarlo |
|---|---|---|
| 1 | Gate del proceso vivo | `GET /factory/health` → `botReconcile.enabled` + `source`, contra el PID del `factory-port` |
| 2 | Ronda disparada una sola vez | un único evento `botReconcile` en el timeline |
| 3 | Run correcto | `engine: run de reconciliación`, workflow `fix-issue`, input `bot_findings` con `- f1` |
| 4 | Estado coherente | `Building` durante la ronda; `Complete` al terminar |
| 5 | Sin PR duplicado | `gh pr list --head <rama>` devuelve 1 solo PR |
| 6 | Fix en la rama | `git log origin/<rama> -2` muestra el commit nuevo |
| 7 | Reconciliación mecánica | segundo reporte: `` | `bot-1` — ... | Taken | `` si el archivo cambió |
| 8 | Cap 1 | con findings nuevos post-ronda NO hay tercer run automático |
| 9 | Trazas honestas (P2) | gate off → `bot reconcile skipped`; start fallido → `reconciliación post-bot no arrancó: <reason>` |
| 10 | Boot recovery (P3) | apagá el gate, publicá un reporte con findings, prendé el gate y reiniciá: el boot prepara la ronda (`boot recovery`) |
| 11 | Guard de cierre (opcional) | mergear/cerrar el PR durante la ronda → `reconciliación abortada: el PR de la rama está merged/closed`, sin push |

## Criterios de éxito

1–9 en verde. El 10 es una prueba controlada de recuperación; el 11 es
destructiva y opcional.

## Rollback / limpieza

- Apagar el gate: POST `{"botReconcile":false}` (o borrar
  `factory/.settings.json`); si además hay `TERMCANVAS_BOT_RECONCILE` en el
  entorno, borrarla y reiniciar el proceso del factory.
- Cerrar el PR/rama del job de prueba; el issue queda abierto para reusar.

## Costos y tiempos

- 1 ronda LLM extra (implement + verify + review) y 2 waits acotados al bot
  (con `120000` cada uno, la corrida completa se mide en minutos, no horas).
- Tokens del agente de fix sobre los findings del bot.

## Qué NO cubre

- Los callers humanos (`reviewService` accept automático y el "Aceptar igual"
  del panel): cableados y cubiertos por tests unitarios
  (`reconcileFromAnyCaller`). Para validarlos en vivo, repetir el flujo con un
  run que termine en rojo y aceptarlo igual desde el panel.
