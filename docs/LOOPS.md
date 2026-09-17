# LOOPS — Inventario de cotas del daemon (Ola 20, Regla 7)

> **Regla 7 (cero loops sin cota):** todo loop, reintento, polling y sampler del
> daemon tiene cota máxima explícita (número en código) y un test que demuestra
> terminación (`tests/no-unbounded-loops.test.ts`). Si un flujo no puede probarse
> que termina, no se mergea.
>
> **Cómo leer este doc:** una fila por mecanismo. "Cota" cita la constante EXACTA
> del código con su valor (verificada por el meta-test contra el fuente: si alguien
> sube una cota sin actualizar esta tabla, el test falla). "Línea" es aproximada
> (honestidad documentada, igual que `definitionValidate`). Alcance = daemon:
> `headless-runtime/factory|sesions|measure|notify|runner|cost|review|implement|`
> `foreman|spec|triage|workItem` + servidores del mismo runtime
> (`opencodeServerManager`, `notification-transport`, `heartbeat`, `lifecycle`,
> `api-server`) + subsistema `interview/*` (mismo runtime, fuera del path factory
> en vivo — marcado con `[interview]`). La UI (`src/`) NO se inventaría acá
> (sus pollings viven en sus componentes con sus propios tests), salvo el tick
> reutilizado por el badge de definition (fila B01, documentada por trazabilidad).

## B — Budgets de revisión (revise / reverify; sin budget de revisiones)

| # | Dónde (línea aprox) | Mecanismo | Cota exacta | Regla / interruptor |
|---|---|---|---|---|
| B01 | `shared/types/review.ts` (`decideReviewNext`, `MAX_REVIEW_ROUNDS = 1`) → `headless-runtime/review/reviewService.ts` (`isPostReviseReview`), `factory/reviewRaw.ts`, `factory/review/reviewActions.ts` | flujo simple: review 1 puede dar `revise` (count 0<1 → Building), review 2 terminal (solo `accept`/`ask_human`); reintentos humanos (`POST /review/retry`, `POST /review/retry-review`, `POST /review/verify-retry`) siguen disponibles | COTA 1 ronda automática: `revise` vuelve a Building con count<1; agotada → stay `ask_human` parado sin LLM-call extra (decide el humano, nunca accept forzado). `checkRetryReviewGuards` solo valida existencia + status Review (404/409 honestos, nunca por contador) | ninguno (reverify eliminado) |
| B02 | ELIMINADO — flujo simple sin reintentos (antes: `maybeRunReverify`) | sin re-verificación del reviewer; revise clásico directo a Building con findings | sin cota (código recto, 0 llamadas) | ninguno |
| B03 | `shared/types/review.ts` + `review/reverifyAllowlist.ts:45` + `review/reviewDisk.ts:66` | topes del reverify y del raw (seguridad de ejecución/disco, no límites de fase) | `REVERIFY_MAX_COMMANDS = 20`, `REVERIFY_MAX_COMMAND_LEN = 500`, `REVERIFY_EVIDENCE_MAX_BYTES = 8KB`, `REVIEW_RAW_MAX_BYTES = 64KB` | allowlist cerrada de 5 comandos (fail-closed con nota) |
| B04 | `headless-runtime/review/reviewAgent.ts` | contador del intento de review | `reviewAttempt` con clamp inferior (sin techo): mínimo 1, el intento N es válido; la cota del loop automático vive en B01 (`MAX_REVIEW_ROUNDS = 5`, intento 6+ con revise previo = post-cap → `ask_human` sin LLM-call) | ninguno (contador local, sin costo extra) |
| B05 | `headless-runtime/factory/factoryServer.ts:955-974,1105` | dedupe de `verify-retry` en vuelo | `verifyRetryInFlight: Set` (1 ejecución por job a la vez; se borra en `finally`) | ninguno (dedupe estructural, no flag) |

## L — Reintentos LLM / sesión (todos con retry ≤ 1 salvo arranque de server)

| # | Dónde (línea aprox) | Mecanismo | Cota exacta | Regla / interruptor |
|---|---|---|---|---|
| L01 | `headless-runtime/factory/factoryServer.ts` (create del intake) | `session.create` con el transporte único | 1 reintento SOLO ante error de transporte (≤ 2 creates; ante timeout se falla limpio sin reenviar) — ver L11 | `SESSION_CREATE_FUSE_MS = 30000` (fusible único, en código) |
| L02 | `headless-runtime/factory/factoryServer.ts:1633-1664` | fallback de forma SDK (v2 `{title,directory}` → `{body:{...}}`) | ≤ 2 formas × L01 (≤ 4 creates por job-create, acotado y sin loop) | ninguno |
| L03 | `headless-runtime/sessions/agentSessions.ts:257-318` (`promptInAgentSession`) | resume de sesión por (job, rol); renovación lazy ante sesión muerta | ≤ 1 `create` y ≤ 2 `promptWith` por llamada, siempre; UN solo renewal ante `session not found` (cero `while`/`for`/polling) | `agentSessions: true\|false` (yaml; apagado = sesión por llamada) |
| L04 | `headless-runtime/llm/agentTransport.ts` (`withTimeout`) | race única contra el prompt para todos los agentes (antes: `withTimeout` local por agente, eliminado) | 0 reintentos (1 solo intento + fusible; el wrapper `withTransportRetry` agrega 1 SOLO ante fallo de transporte: ver L11) | `GLOBAL_AGENT_FUSE_MS = 600000` (fusible único; `tactics` conserva su `SESSION_CREATE_TIMEOUT_MS = 60000` propio de interview) |
| L05 | `headless-runtime/implement/implementAgent.ts:73-78` (`withTimeout`) | race del implement contra el LLM | 0 reintentos (`Promise.race`, 1 intento) | `IMPLEMENT_LLM_TIMEOUT_MS = 3600000` |
| L06 | `headless-runtime/opencodeServerManager.ts` (spawner propio + health-check) | arranque del server efímero + health-check | `SERVER_START_RETRIES = 3`, `HEALTH_RETRIES = 3`, `SERVER_START_TIMEOUT_MS = 30000`, `HEALTH_TIMEOUT_MS = 3000`; backoff `400ms × (attempt+1)`; sleep cold-start 800ms + 300ms entre intentos; spawner propio: un solo timeout de arranque (windowsHide, sin SDK cross-spawn) | ninguno (arranque, no tarea) |
| L07 | `headless-runtime/interview/harness/opencode.ts:15-16,37` `[interview]` | arranque del server de interview | `SERVER_START_RETRIES = 2`, `SERVER_START_TIMEOUT_MS = 30000`; backoff `400ms × (attempt+1)` | ninguno |
| L08 | `headless-runtime/interview/engine.ts:278-279,1002,1074` `[interview]` | arranque + reintentos de output estructurado | `SERVER_START_RETRIES = 2` / `SERVER_START_TIMEOUT_MS = 30000`; `MAX_STRUCTURED_RETRIES = 2` (≤ 3 intentos: `attempt <= 2`) | ninguno |
| L09 | `headless-runtime/notification-transport.ts:19,128-141` | reintentos de POST (heartbeat/notificaciones cloud) | `DEFAULT_RETRY_DELAYS_MS = [1000, 4000, 16000]` (1 intento + 3 reintentos = ≤ 4 envíos; `attempt >= length` → se rinde) | `stop()` cancela pendientes |
| L10 | `headless-runtime/heartbeat.ts:28,46-60` | heartbeat a callback cloud | `DEFAULT_INTERVAL_MS = 10000` + `stop()` con `clearInterval` (corre mientras el proceso vive; lifecycle con apagado explícito) | `stop()` (lifecycle) |
| L11 | `headless-runtime/llm/agentTransport.ts` (`withTransportRetry`, `withTimeoutNoResend`, `attemptPromptOnce`) — delegan `foreman/foreman.ts`, `spec/specAgent.ts`, `triage/triageAgent.ts`, `review/reviewAgent.ts`, `measure/scorerEngine.ts`, `measure/improvementEngine.ts` | transporte único (doctrina no-resend): UN intento por turno; 1 reintento SOLO ante error de transporte (econn/fetch/UnknownError/`{}`); timeout/abort → abort + lanza, CERO reenvíos (antes: cada agente reenviaba ante timeout y clonaba el mensaje en la sesión) | `transporte único (agentTransport)` — ≤ 2 envíos por llamada solo cuando el 1º no fue timeout; ante timeout siempre 1 | `GLOBAL_AGENT_FUSE_MS = 600000` (sin timeouts por fase) |
| L12 | ELIMINADO — flujo simple sin reintentos (antes: `consume` strictSecondPass) | un solo turno LLM por `consume`; prosa sin tool writes o error → lista vacía y el job queda parado en Building (sin second pass, sin patch-apply ni fallback) | sin cota (código recto, 1 intento) | ninguno |
| L13 | `headless-runtime/llm/agentTransport.ts` (`withTimeoutNoResend`, `attemptPromptOnce`, `attemptJsonPromptOnce`) — usado por los 6 agentes LLM | timeout del prompt SIN reenvío idéntico (generalización del fix que nació en review): thinking alto ≈ timeout → se aborta la request zombie y NO se reenvía el mismo prompt (el transcript no acumula texto duplicado); `attemptJsonPromptOnce` suma el fallback structured→texto plano | `retry ≤ 1 (sin reenvío en timeout)` — 1 reintento SOLO ante error de transporte; timeout/abort → abort + lanza (0 reenvíos); el fallback de modelo (review/foreman) solo corre ante error de auth/modelo, nunca ante timeout | `TERMCANVAS_STRUCTURED_OUTPUT` opt-in del camino `format` |

## M — Medida: benchmarks, sampler, proposals, scorers

| # | Dónde (línea aprox) | Mecanismo | Cota exacta | Regla / interruptor |
|---|---|---|---|---|
| M01 | `shared/types/benchmark.ts:23` → `measure/benchmarkEngine.ts:321-331` + `factory/factoryServer.ts:3790-3794` | trials de benchmark (tasks × configs × repetitions) | `BENCHMARK_MAX_TRIALS = 50` (excederlo → 400/409 honesto, no ejecución parcial) | ninguno (cap duro) |
| M02 | `shared/types/benchmark.ts:25,27,29` | tamaño por task | `BENCHMARK_TASK_MAX_FILES = 5`, `BENCHMARK_FILE_MAX_BYTES = 2048`, `BENCHMARK_RAW_SNIPPET_MAX = 2048` | ninguno |
| M03 | `headless-runtime/factory/definitionValidate.ts:157,1184` | archivos `.json` de benchmarks a validar | `BENCHMARKS_MAX_FILES = 50` (slice antes de iterar) | ninguno |
| M04 | `headless-runtime/measure/sampler.ts:38-50` + `factory/agentLoader.ts:364` | sampler de auto-scoring (`hash(jobId) % 100 < rate`) | default `samplingRate: 25` (25%); `0` = apagado (solo manual), `100` = siempre; rate inválido → `false` (fail-closed) | `scorers.samplingRate` 0-100 (yaml, Regla 8 estilo `0 = apagado`) |
| M05 | `headless-runtime/measure/scorerEngine.ts:1440-1518` (`maybeAutoProposeForScorer`) | auto-propose por scorer (Ola 18 P1.4) | ≤ 1 `createProposal` por scorer por corrida + cooldown: si las abiertas (`pending\|ready`) ≥ `improveProposalCooldown` (yaml, default `1`; `0` = apagado) no se crea nada; dispara con ≥ 2 failures NUEVOS | `selfImprovement` por scorer + `improveProposalCooldown` (yaml, clamp ≤ 100) |
| M06 | `shared/types/scorer.ts:15` + `measure/scorerLoader.ts:44` | tamaño de scorers | `SCORER_MAX_LABELS = 10`, `SCORER_MAX_FILE_BYTES = 64KB` (excederlo → el loader lo ignora; el validador grita) | ninguno |
| M07 | `shared/types/improvement.ts:20,22,26` | tamaño de proposals | `IMPROVEMENT_MAX_CONTENT = 16384`, previews 200, `regressionsAddressed` ≤ 50 | ninguno |
| M09 | `headless-runtime/measure/improvementHttp.ts` (`RETRY_ANALYSIS_MAX`) → `measure/improvementEngine.ts` (`retryAnalysisForProposal`), `factory/measure/improvementRoutes.ts` (single-shot `POST .../proposals/:id/retry-analysis`) | re-análisis humano de propuestas `failed` (precedente `retry-review-only`: re-corre solo el análisis con los mismos fails, misma allowlist, sin escribir targets) | `RETRY_ANALYSIS_MAX = 1` (1 retry-analysis por propuesta: `retryCount` ≥ 1 → 409 `budget reached`; solo `status=failed` reintenta, resto → 409; cada intento consumido queda en `retryCount` + `lastRetriedAt`) | ninguno (single-shot humano, sin timers; ver Exención 3) |
| M08 | `headless-runtime/factory/agentLoader.ts:954,1085-1087` | tamaño de skills | `SKILL_MAX_BYTES = 8KB` (excederlo → truncado con nota, nunca corte silencioso) | ninguno |

## N — Notificaciones (ring + polling)

| # | Dónde (línea aprox) | Mecanismo | Cota exacta | Regla / interruptor |
|---|---|---|---|---|
| N01 | `headless-runtime/notify/notifications.ts:70,276-277,491,519-531` | centro persistido (`factory/.notifications.json`) | `NOTIFICATIONS_MAX = 100` (ring: al llegar se descartan las más viejas; `while(store.length > MAX)` termina porque cada iteración reduce `length`; cap param clamp a 100) | `notificationsEnabled` (yaml) |
| N02 | `src/features/factoryLab/components/notificationsUi.ts:51` (renderer; se cita por trazabilidad, no es daemon) | polling de la campana | `POLL_MS = 5000` (UN solo `setInterval` con cleanup) + dedupe toast `TOASTED_IDS_CAP = 200` | `osNotifications` (yaml) |
| N03 | `src/features/factoryLab/hooks/useWorkItemsPolling.ts:11` (renderer; trazabilidad) | polling vivo de jobs/logs | `POLL_INTERVAL_MS = 2500` (UN solo intervalo con cleanup + AbortController por tick) | ninguno (la página lo monta siempre) |
| N04 | `src/features/factoryLab/FactoryLabPage.tsx:519-523` (renderer; trazabilidad del badge) | tick de salud del daemon (`GET /factory/health` 30s) | período fijo 30000ms, best-effort (fallo → conserva lo último, cero throw). **El badge de definition reutiliza ESTE tick (cero intervalos nuevos)** | ninguno |

## P — Probe docker + ejecución

| # | Dónde (línea aprox) | Mecanismo | Cota exacta | Regla / interruptor |
|---|---|---|---|---|
| P01 | `headless-runtime/runner/runnerExecutor.ts:45-49,98-132` | probe `docker info` | `DOCKER_PROBE_TIMEOUT_MS = 5000` (+500ms de gracia con `SIGKILL`), `DOCKER_PROBE_TTL_MS = 60000` (cache 60s), `DOCKER_PROBE_MAX_ATTEMPTS = 1` (1 intento, cero reintentos; nunca lanza) | `isolation: none` salta el probe (Regla 8); sin docker → local declarado (fail-open registrado) |
| P02 | `headless-runtime/runner/runnerExecutor.ts:372-385` | timeout por comando setup/verificación | `timeoutMs + 500` → `SIGTERM` + resolve (nunca cuelga el job) | `IMPLEMENT_SETUP_TIMEOUT_MS = 15000`, `IMPLEMENT_VERIFY_TIMEOUT_MS = 120000`, `IMPLEMENT_MAX_CREATED_FILES = 50` |
| P03 | `headless-runtime/implement/verification.ts:968-987` (`spawnStep`) | timeout de pasos de verificación con kill en 2 fases | `timeoutMs + 500` → `SIGTERM`, +2000ms → `SIGKILL`; output en memoria acotado (head+tail 500KB) | `verifyMs` yaml (default 120000) |
| P04 | `headless-runtime/interview/harness/codebuddy.ts:150-158` `[interview]` | kill de seguridad del CLI | `opts.timeoutMs + 5000` → `SIGKILL` (margen 5s sobre el timeout del engine) | `signal` de cancelación del usuario |
| P05 | ELIMINADO — flujo simple sin reintentos (antes: pre-verify late-flush rescan) | una sola verificación con la lista conciliada tal cual; sin sleeps ni re-descubrimiento | sin cota (código recto, 1 pasada) | ninguno |
| P06 | `headless-runtime/implement/implementAgent.ts` (awaitPromptWithProgress + intentos en línea recta + `readLateAssistantText`, watchdog por progreso) | poll 20s de partes del mensaje: con progreso el turno vive hasta el absoluto 1h; sin progreso 180s aborta; ante timeout NO se reenvía (una lectura tardía rescata la respuesta ya aterrizada) y sin timeout hay UN solo reenvío en línea recta (sin loop) | `IMPLEMENT_PROGRESS_POLL_MS = 20000`, `IMPLEMENT_PROGRESS_IDLE_MS = 180000`, `IMPLEMENT_LLM_TIMEOUT_MS = 3600000` |

## S — Servidor: bind, SSE, limpieza, costos, logs

| # | Dónde (línea aprox) | Mecanismo | Cota exacta | Regla / interruptor |
|---|---|---|---|---|
| S01 | `headless-runtime/factory/factoryServer.ts:647-660` (`findAvailablePort`) | escaneo de puerto libre | `for(p = start; p <= end)` sobre el rango efectivo de `factory.yaml` (default `17680-17690` = 11 puertos; termina sí o sí, lanza si no hay libre) | `ports` en yaml |
| S02 | `headless-runtime/factory/factoryServer.ts:4533-4536,4568` | bind con retry ante `EADDRINUSE` | `maxAttempts = 3` + `probeExistingFactory(700)` (700ms) con reutilización de instancia existente | ninguno |
| S03 | `headless-runtime/factory/factoryServer.ts:2982-3007` | SSE de logs por job | heartbeat `: heartbeat` cada `15000ms` + `finiteCloseTimer` 4000ms (los jobs terminales cierran en 300ms con evento `done`; cleanup en `close`/`error` hace `clearInterval+clearTimeout`) | ninguno |
| S04 | `headless-runtime/factory/factoryServer.ts:4540` | timeout de socket HTTP | `server.timeout = 30000` | ninguno |
| S05 | `headless-runtime/api-server.ts:67,842` | conexiones SSE máximas | `MAX_SSE_CONNECTIONS = 50` (excederlo → 503, no cola infinita) | ninguno |
| S06 | `headless-runtime/api-server.ts:87-92` | limpieza del rate-limit map | `setInterval` fijo `60_000ms` (solo barre entradas expiradas; termina porque el map es finito) | `rateLimit` (0 = sin limpieza porque no hay map) |
| S07 | `headless-runtime/api-server.ts:893-895` | refresco de uso de disco | `setInterval` fijo `30_000ms` con `update()` idempotente | ninguno |
| S08 | `headless-runtime/cost/costTracker.ts:30,166` | contadores de costo por job | `COST_TRACKER_MAX_ENTRIES = 10000` (FIFO: al llegar se evicta antes de insertar) | `costTracking: true\|false` (yaml; apagado = "—") |
| S09 | `headless-runtime/foreman/foremanLog.ts:9,19-20` | ring de logs del foreman | `RING_MAX = 500` (slice al exceder) | ninguno |
| S10 | `headless-runtime/event-bus.ts:20-22,33-43` | rings del bus de eventos | `MAX_RECENT_EVENTS = 100`, `MAX_TERMINAL_EVENTS = 200`, `MAX_TERMINAL_BUFFERS = 100` | ninguno |
| S11 | `headless-runtime/factory/factoryServer.ts:394,460,484` + `foreman/foreman.ts:83` | sondas de URLs / listados | `for` sobre arrays fijos (2 URLs opencode, jobs en memoria, work items) — iteración acotada, ver Exenciones | ninguno |
| S12 | `headless-runtime/foreman/foreman.ts` (`pollForAssistantJson`) | espera de JSON del asistente (último recurso cuando no hay `session.prompt`) | `while(Date.now() - start < timeoutMs)` (acotado por el fusible global del caller) + fetch con abort 2000ms + sleep 500ms entre polls | `GLOBAL_AGENT_FUSE_MS = 600000` (fusible único, en código) |
| S13 | `headless-runtime/implement/implementService.ts:142-155` | holds de sincronización (path pact-mock) | sleeps ÚNICOS de 8000ms (ventana de cancel F04) / 1000ms (sin loop; re-chequean estado y salen) | ninguno |
| S14 | ELIMINADO — worker-kick legacy retirado (engine) | el worker legacy ya no existe: el engine corre los nodos por su cuenta, sin timer que re-dispare | sin cota (código recto, 0 timers) | ninguno |
| S15 | `headless-runtime/lifecycle.ts:51-87` (`createPersistenceController`) | debounce de persistencia de estado | `delayMs = 500` (re-programa con `clearTimeout`; `flush()`/`cancel()` explícitos; 1 timer vivo como máximo) | ninguno |
| S16 | `headless-runtime/factory/factoryServer.ts:397-403,1784,1902-1904` | aborts de fetch internos | 800ms ×2 (sonda web), 1000ms (abort control), 12000ms (`opencode prompt` + `timeout 12000ms waiting`) | timeouts yaml |
| S17 | `headless-runtime/opencodeServerManager.ts:115` | búsqueda de puerto efímero | `encontrarPuertoServidor(20000, 45000, 12)` (≤ 12 intentos) | `OPENCODE_EPHEMERAL_HINT` (hint, no hardcodeo) |
| S18 | `headless-runtime/factory/factoryServer.ts:2499` + `api-server.ts:370,398` | topes de lectura de logs/límites | `limit` clamp `1-500` (default 100); `lines`/`limit` default 50 | ninguno |
| S19 | `headless-runtime/api-server.ts` (PTY destroy) | gracia de cierre tras destruir PTY | PTY destroy grace 500ms: `setTimeout` single-shot (1 disparo, sin re-arme; si el kill no reporta, cierra igual para no colgar el socket) | ninguno |

## A — Automations (Wave 14 triggers; contracts land in T01, effects in T02)

| # | Where (approx line) | Mechanism | Exact bound | Rule / kill-switch |
|---|---|---|---|---|
| A01 | `headless-runtime/factory/automations/automationTypes.ts` (`AUTOMATION_TICK_DEFAULT_MS`; ticker lands in `automationService.ts`, T02) | single automation ticker (`AUTOMATION_TICK`, one `setInterval` + `clearInterval`) | `AUTOMATION_TICK_DEFAULT_MS = 30000` (fixed period; `tickMs: 0` = ticker off) | `automations.enabled` (yaml global kill-switch, Rule 8); `tickMs` (yaml) |
| A02 | `headless-runtime/factory/automations/automationService.ts` (T02; pure contract `triggerEngine.ts`) | one bounded pass per tick (`tickOnce`: at most 1 action per trigger per tick, never self-reschedules) | ≤1 action per trigger per tick (structural) | per-trigger `enabled: false` skips that trigger |
| A03 | `headless-runtime/factory/automations/automationTypes.ts` (`baseTrigger`) | per-trigger fire quota | `maxFires` default `5`; `0` = never fires | `maxFires: 0` (yaml, Rule 8 `0 = off` style) |
| A04 | `headless-runtime/factory/automations/automationTypes.ts` (`baseTrigger`) | per-trigger cooldown between fires | `cooldownMs` default `60000`; `0` = quota-only bound | `cooldownMs` (yaml) |
| A05 | `headless-runtime/factory/automations/automationTypes.ts` (`AutomationsSectionSchema`) | cap on configured triggers | `AUTOMATIONS_MAX_TRIGGERS = 20` (excess rejected by the validator) | validator (fail-closed with file:line) |
| A06 | `headless-runtime/factory/automations/automationTypes.ts` (`AutomationsFileShape`; writer `automationStore.ts`, T02) | central evidence ring (`factory/.automations.json`, oldest evicted first) | `AUTOMATIONS_MAX_ENTRIES = 200` | single writer `automationStore` (C3) |

## I — Integrations (Wave 14 mock-local; contracts land in T01, effects in T03)

| # | Where (approx line) | Mechanism | Exact bound | Rule / kill-switch |
|---|---|---|---|---|
| I01 | `headless-runtime/factory/integrations/integrationTypes.ts` (`IntegrationsSectionSchema`) | mock-only gate: single mode + single provider, secret fields rejected fail-closed | `mode: "mock-local"` only, `provider: "linear"` only (`live`/`slack`/secret key = validator error) | `integrations.enabled` (yaml; `false` = outbound refused with an honest 409) |
| I02 | `headless-runtime/factory/integrations/integrationTypes.ts` (`IntegrationsMockFileShape`; writer `mockAdapter.ts`, T03) | local mock evidence ring (`factory/.integrations-mock.json`, oldest evicted first) | `INTEGRATION_MOCK_MAX = 100` | single writer `mockAdapter` (C3); zero network/tokens |
| I03 | `headless-runtime/factory/integrations/integrationTypes.ts` (`MockPostInputSchema`) | mock post payload size caps | `INTEGRATION_TITLE_MAX = 200`, `INTEGRATION_BODY_MAX = 2000` | schema `min(1)` title (empty refused) |

## L-IN — Live intake (F1 webhook-in + post-back; reconcile direction)

| # | Dónde (línea aprox) | Mecanismo | Cota exacta | Regla / interruptor |
|---|---|---|---|---|
| L-IN-01 | `headless-runtime/factory/integrations/integrationService.ts` (`pushSeenIntakeEvent`) + `headless-runtime/factory/automations/triggerEngine.ts` (`pushSeenEvent`) | webhook/event-id dedupe FIFO (caller-held ring, oldest evicted first; re-push keeps first occurrence) | `WEBHOOK_DEDUPE_MAX = 500` (`while(length > MAX) splice(0,1)` — each pass shrinks `length`, terminates; twin `AUTOMATION_SEEN_EVENT_CAP = 500`) | `integrations.enabled:false`→409, `live.liveMode:false`→409 mock-local exact, per-trigger `enabled:false`/`maxFires:0` |
| L-IN-02 | `headless-runtime/factory/integrations/liveAdapter.ts` (`postBack`) | post-back attempts (sequential `for`, no timers re-armed, no sleeps, no backoff) | `POSTBACK_MAX_ATTEMPTS = 3` (1 try + 2 attempts, then honest failed event); per-attempt explicit timeout `LIVE_ADAPTER_DEFAULT_TIMEOUT_MS = 15000` (AbortController + race, timer cleared in `finally`); remote-id pick over 4 fixed keys | `live.allowPostBack:false`→409, unset `vaultRef`→refused without network, `integrations.enabled:false`→409 |

## F3-T3 — Human-in-the-measure wiring (+0, 2026-09-05)

F3-T3 suma 0 mecanismos con cota: los flujos de decisión reutilizan polls
existentes (propuestas 15s, detalle 5s solo si pending/running, notificaciones
on-demand por clic) y el validador nuevo (`decisions-proposal-link`,
`decisions-benchmark-record`) itera con `for` estructural sobre listados
finitos con tope (`DECISION_SCAN_MAX = 50`) en `definitionValidate.ts`, archivo
ya exento (Exención 1). Sin reintentos, sin anillos, sin intervalos nuevos:
+0-note, el meta-test no necesita entradas nuevas.

## Exenciones (falsos positivos legítimos — el meta-test no ladra acá)
Estas formas matchean los patrones del meta-test pero NO son loops sin cota.
Viven como lista explícita en `tests/no-unbounded-loops.test.ts` (documentada
ahí mismo) y se resumen acá para el lector humano:

1. **`for` de iteración acotada sobre colecciones finitas** (arrays en memoria,
   `readdirSync`, rangos numéricos cerrados, líneas de un texto, entries de un
   `Map`, `tasks×configs×repetitions` del benchmark —este último además bajo el
   cap M01): cada iteración avanza un índice/iterador finito → terminación
   estructural. Archivos (auditoría 2026-09-03, espejo de `FOR_EXEMPT_FILES` en
   el test): `factory/factoryServer.ts`, `factory/agentLoader.ts`,
   `factory/definitionValidate.ts`, `implement/verification.ts`,
   `implement/minimalChange.ts`, `foreman/foreman.ts`, `foreman/foremanLog.ts`,
   `measure/scorerEngine.ts`, `measure/sampler.ts`, `measure/benchmarkEngine.ts`,
   `measure/improvementEngine.ts`, `measure/scorerLoader.ts`,
   `notify/notifications.ts`, `review/reviewService.ts`,
   `review/reverifyAllowlist.ts`, `review/reviewModelSelector.ts`,
   `runner/runnerConfig.ts`, `runner/runnerExecutor.ts`, `spec/specFlow.ts`,
    `spec/specPrompt.ts`, `triage/triageFlow.ts`, `workItem/workItemDisk.ts`,
    `workItem/workItemStore.ts`, `workItem/resultStore.ts` (barrido reverso del timeline en memoria con `break`, refactor ①), `workItem/jobView.ts` (pure projection `for...of` over fixed `ISOLATION_TEXT_KEYS` = 6 keys, sync trim+slice only, no awaits/timers),     `factory/routing/routeTable.ts` (barridos `for...of` de la tabla fija de 43 rutas, FASE 1 + Ola 14 R1–R4 + F1 webhook-in/post-back + P4c retry-analysis), `sessions/agentSessions.ts` (array fijo de 5
   roles), `opencodeServerManager.ts` e `interview/harness/opencode.ts` (fors
   de reintento acotados por `SERVER_START_RETRIES`/`HEALTH_RETRIES`),
   `api-server.ts`, `event-bus.ts`, `project-store.ts`,
   `artifact-collector.ts`, `index.ts`, `interview/brief.ts`,
   `interview/curation.ts`, `interview/engine.ts` (incluye su for de
   `MAX_STRUCTURED_RETRIES`), `interview/tactics.ts`,
    `notification-transport.ts` (entries del Map + set de timers pendientes).
    `factory/integrations/liveAdapter.ts`, `factory/integrations/integrationTypes.ts`
    y `factory/jobs/jobCreate.ts` (F1: `for` sobre listas fijas/finitas —
    4 claves de remote-id, claves del objeto validado, timeline finito con
    barrido reverso acotado; los intentos con cota viven en L-IN-02, no acá),
    más auditoría 2026-09-10: `factory/agents/agentFileRoutes.ts` (líneas de
    texto en splitAgentRaw), `factory/jobs/jobService.ts` (barrido reverso de
    timeline con break + answers finitas), `factory/opencodeAgentSync.ts`
    (listas/mapas/readdir finitos + denies estáticos), `review/reviewDiff.ts`
    (líneas de `git status` + lista acotada slice 0,50),
    `factory/agents/agentHooks.ts` (dir entries, findings slice 0,20, lista
    de hooks descubierta) y `runner/toolPolicy.ts` (tokens de frontmatter),
    más auditoría 2026-09-16: `factory/mcps/mcpFileRoutes.ts` (entries de
    mapas validados + readdir), `factory/github/runnersService.ts` (labels y
    runners del JSON de la API), `factory/isolation/isolationStore.ts`
    (líneas de texto), `factory/isolation/mergeReconcile.ts` (listado de jobs
    con TTL `MERGE_RECONCILE_TTL_MS`) y `workItem/workerActivity.ts` (array
    de jobs en memoria). Los `for` de `engineBridge.ts` NO van por exención:
    tienen entradas individuales E01-E09 (ver sección E).
   El test lo enforcea por archivo + prohíbe `for(;;)` en todo el daemon.
2. **`setTimeout` one-shot sin reintento** (no re-programa: dispara 1 vez):
   AbortController de fetch (S16, L04), sleeps únicos de sincronización (S13),
   auto-resume del engine (E10), restart del runner supervisor (RS01),
   debounce con cleanup (S15), kill-timers de spann
   (P02-P04, que además resuelven la promesa). Un `setTimeout` que no se
   re-programa a sí mismo no es un loop.
3. **Nombres con "retry" que no son loops**: rutas y handlers single-shot
     (`POST /review/retry`, `/review/retry-review`, `/review/verify-retry`,
     `POST /improve/proposals/:id/retry-analysis` —1 intento humano por
     llamada, tope M09 `RETRY_ANALYSIS_MAX = 1` por propuesta—,
     incluidos sus mensajes de error `"verify retry"`/`"missing id for verify
     retry"`), guards puros (`checkRetryReviewGuards`, `checkVerifyRetryGuards`,
     `checkRetryAnalysisGuards`, `parseProposalRetryAnalysisPath`,
     `parseVerifyRetryPath`), header HTTP `Retry-After`,
     comentarios/logs que DESCRIBEN una política ya inventariada (`1 retry`,
     `retry o fallback`, `retry, etc.` → todos apuntan a L11/N01/S02 según
     el caso) y comentarios
     F1 que describen la cota L-IN-02 (`retry cap 3`, `adapter with retry` →
     apuntan a L-IN-02, intentos acotados sin reintento libre) y etiquetas de
     intento humano en comentarios (`A-retry`: nombre del intento, no loop).
    Auditoría 2026-09-16: `accept/retry` (acciones del panel en docs/comentarios),
    `Retry review` (guard G1 en comentarios y mensajes 409), `review retry legacy`
    (handlers 410 retirados) y `VERIFY-RETRY` (comentario de retirados) → strings
    y comentarios, no loops.
    Su cota real es B01 (sin budget: el humano reintenta siempre) o la fila correspondiente y
    está inventariada arriba.
4. **`while` de truncado con progreso garantizado**: `while(store.length >
   NOTIFICATIONS_MAX) store.splice(0,1)` (N01) — cada iteración reduce `length`
   en ≥ 1 → termina. Mismo patrón en `costTracker` (FIFO S08) y anillos S09-S10.
5. **Intervalos de lifecycle con apagado explícito**: heartbeat cloud (L10,
   `stop()`), limpieza rate-limit (S06), refresco disco (S07), SSE heartbeat
   (S03, `clearInterval` en cleanup). Período fijo + `clear*` documentado =
   polling acotado por lifecycle, no loop infinito sin dueño.
6. **Polling del renderer citado por trazabilidad** (N02-N04): vive en `src/`,
   fuera del daemon; cada uno tiene UN solo intervalo con cleanup y su propio
   test (NotificationsBell 5s, workItems 2.5s, daemon-health 30s). El badge de
   definition NO agrega polling: reutiliza N04.

## D18 — Automations fresh-yaml reader (+0, 2026-09-05)

D18 suma 0 mecanismos con cota: el lector fresco de `automations:` en
`headless-runtime/factory/automations/automationService.ts`
(`sliceAutomationsSection` + `parseAutomationsBlock` +
`parseAutomationsYamlText`, una lectura de archivo por llamada + un `forEach`
estructural sobre las líneas finitas del yaml + `safeParse` contra el
vocabulario único de `automationTypes.ts`) es código recto — sin timers, sin
reintentos, sin dedupe nuevo, sin cache (cada tick lee disco fresco, espejo
de `getIntegrationsConfig`). El `skip` de `parseFactoryYaml`
(`agentLoader.ts`) queda intacto: el lector fresco es la única fuente (cero
vocabulario duplicado: los schemas se importan, no se copian). +0-note, el
meta-test no necesita entradas nuevas (`forEach` no matchea `for\s*\(`; cero
`setInterval`/`setTimeout`/`while(`/`retry` nuevos en el archivo).

Efecto restart (para QA): el cambio de código toma efecto SOLO tras
reiniciar el daemon (carga TS una vez, sin watch); los cambios del yaml, en
cambio, se ven en el tick siguiente sin reinicio (lectura fresca por
llamada).

## D18 — Notify→automations event bridge (+0, 2026-09-05)

D18 suma 0 mecanismos con cota: el puente `notify → fireEvent`
(`headless-runtime/notify/notifications.ts` registro de created-listeners +
`headless-runtime/factory/automations/automationService.ts` suscriptor
`automationNotifyListener`, armado al importar, God +0, cero rutas nuevas)
es código recto — un `forEach` sincrónico sobre un registro acotado
(`NOTIFICATION_LISTENERS_MAX = 8`, producción usa 1 slot; excederlo es
fail-closed `false`), una sola emisión `fireEvent` por notificación creada
(los hits de dedupe y los nulls nunca emiten), y el resto lo ponen cotas ya
inventariadas: dedupe FIFO `AUTOMATION_SEEN_EVENT_CAP = 500` (L-IN-01),
quota `maxFires` (A03), cooldown `cooldownMs` (A04), kill-switches
`automations.enabled` (A01) y per-trigger `enabled` (A02). Sin timers, sin
reintentos, sin re-armados: la terminación del anti-loop (notificaciones
nacidas de trigger marcadas `fromAutomation:true` + guarda de
`dedupeKey:"automation:*"` + prefijos `[automation]`/`[integration-mock]`)
la prueba `tests/automations-notify-bridge.test.ts` ("anti-loop end to end:
a posting trigger terminates"). +0-note, el meta-test no necesita entradas
nuevas (`forEach`/`slice` no matchean `for\s*\(`; cero `setInterval` /
`setTimeout` / `while(` / `retry` nuevos en ambos archivos; el registro vive
en `notify/notifications.ts`, ya exento para `for(` por Exención 1).

Efecto restart (para QA): el puente arma al importar el módulo, así que
toma efecto SOLO tras reiniciar el daemon (igual que el lector D18); ningún
cambio de yaml adelanta el armado.

## G — Factory isolation (T01, 2026-09-07)

| # | Where (approx line) | Mechanism | Exact bound | Rule / kill-switch |
|---|---|---|---|---|
| G01 | `headless-runtime/factory/isolation/gitWorktree.ts` (`ensureIsolatedWorktree`) | `git worktree add` (+ rev-parse probes) per isolated create | `GIT_WORKTREE_ADD_TIMEOUT_MS = 30000` (1 attempt, `timeout` option, `maxBuffer 10 MB`); probes `GIT_PROBE_TIMEOUT_MS = 10000` | valid `issueRef` required (absent/junk = legacy path, no spawn); pact jobs excluded (`shouldIsolate=false`) |
| G02 | `headless-runtime/factory/isolation/gitHubPr.ts` (`openPrForJob` push) | `git push -u origin <branch>` once per job | `GIT_PUSH_TIMEOUT_MS = 30000` (1 attempt, then honest `pr:{error}`, no second attempt) | `prGuard` (timeline `pr` meta present = skip); never on non-`Complete` |
| G03 | `headless-runtime/factory/isolation/gitHubPr.ts` (`openPrForJob` create) | `gh pr create --head/--base/--title/--body-file` once per job | `GH_PR_CREATE_TIMEOUT_MS = 30000` (1 attempt, then honest `pr:{error}`, no second attempt) | same guard as G02; `gh` absent/offline = honest fallback + manual command hint |
| G04 | `headless-runtime/factory/isolation/gitHubPr.ts` (`readPrState`, DELETE guard) | `gh pr view --json state` per cleanup call | `GH_PR_VIEW_TIMEOUT_MS = 15000` (1 attempt; failure = guard refuses unless `force=true` + terminal) | DELETE guards (non-terminal → 409 always; open-PR + !force → 409) |
| G05 | `headless-runtime/factory/isolation/gitHubPr.ts` (`readWorktreeStatusPorcelain`, gate accept) | `git status --porcelain` read-only por accept/PR (1 intento) | `GIT_STATUS_TIMEOUT_MS = 10000` (fallo = null, caller fail-open) | probes de solo lectura (el gate bloquea accept solo con doble vacio probado) |
| G06 | `headless-runtime/factory/isolation/gitHubPr.ts` (`commitWorktreeChanges` en `openPrForJob`) | `git add -A` + `git commit` con identidad `-c` local (1 intento c/u, solo con status sucio) | `GIT_COMMIT_TIMEOUT_MS = 15000` (fallo = error honesto + hint manual, sin push) | el commit canonico lo hace el orquestador; ningun prompt LLM pide commit/push/PR |
| G07 | `headless-runtime/factory/engineBridge.ts` (`appendNodeSessionRound`) | cómputo de ronda sobre el historial de sesiones por nodo de loop (VIEW AGENT por ronda) | `NODE_SESSION_ROUNDS_MAX = 50` (`for...of` sobre array acotado con `slice(-50)`; termina por longitud) | solo nodos con `iteration` del evento (loops); dedupe por (nodo, sesión) |

No new `setInterval`/`setTimeout`/loop: all execs are single-shot with the
`timeout` option; per-job concurrency is an in-flight `Set` cleared in
`finally` (structural dedupe, same family as LOOPS.md B05).

## E — Engine bridge: auditoría de loops y auto-resume (2026-09-16)

| # | Where (approx line) | Mechanism | Exact bound | Rule / kill-switch |
|---|---|---|---|---|
| E01 | `headless-runtime/factory/engineBridge.ts` (`hydrateMap`) | hydrateMap — mapa finito (engine-map.json) + guard hydrated | `Object.entries` de un JSON parseado, una sola corrida (`hydrated = true`); sin re-arme | ninguno |
| E02 | `headless-runtime/factory/engineBridge.ts` (`renderFindingsText`) | renderFindingsText — array findings finito | `Array.isArray(findings)` acotado aguas arriba (findings ≤ 50 en el contrato del review) | ninguno |
| E03 | `headless-runtime/factory/engineBridge.ts` (`renderVerifyLog`) | renderVerifyLog — steps finitos (verify-runner) | `steps: Array<Record<string, unknown>>` (verify-runner ya slicea a 20) | ninguno |
| E04 | `headless-runtime/factory/engineBridge.ts` (`syncEngineRunFromRun`) | syncEngineRunFromRun — cap 50 por mapa + break | `Object.keys(nodeSessions).length < 50` por mapa y break al llenar ambos | ninguno |
| E05 | `headless-runtime/factory/engineBridge.ts` (`runInputsForWorkflowDef`) | runInputsForWorkflowDef — def.inputs finito | `def.inputs` es el record validado del workflow (keys declaradas, finito) | ninguno |
| E06 | `headless-runtime/factory/engineBridge.ts` (`countAutoResumes`) | countAutoResumes — timeline finito | `Array.isArray(timeline)`: timeline en memoria del work item, terminación por longitud | ninguno |
| E07 | `headless-runtime/factory/engineBridge.ts` (`interruptionMs`) | interruptionMs — barrido reverso del timeline | índice `for (let i = timeline.length - 1; i >= 0; i--)` sobre el timeline finito | ninguno |
| E08 | `headless-runtime/factory/engineBridge.ts` (`autoResumeParkedEngineJobs`) | autoResume candidatos — workItemStore.list() finito + AUTO_RESUME_MAX_ATTEMPTS = 3 | lista en memoria + `AUTO_RESUME_MAX_ATTEMPTS`; edad máxima `autoResumeMaxAgeMs()` (default 24h) | `TERMCANVAS_FACTORY_NO_AUTORESUME=1` |
| E09 | `headless-runtime/factory/engineBridge.ts` (`autoResumeParkedEngineJobs`) | autoResume resume — slice(0, autoResumeMaxPerBoot()) | `autoResumeMaxPerBoot()` (default 5, env `TERMCANVAS_FACTORY_AUTORESUME_MAX`); un resume por candidato en la pasada | `TERMCANVAS_FACTORY_NO_AUTORESUME=1` |
| E10 | `headless-runtime/factory/engineBridge.ts` (`autoResumeParkedEngineJobs`) | autoResumeParkedEngineJobs delayMs = 3000 | `setTimeout` one-shot de stagger (`delayMs = 3000`, un solo disparo, nunca re-armado) | `TERMCANVAS_FACTORY_NO_AUTORESUME=1` |

## RS — Runner supervisor (auditoría 2026-09-16)

| # | Where (approx line) | Mechanism | Exact bound | Rule / kill-switch |
|---|---|---|---|---|
| RS01 | `headless-runtime/factory/github/runnerSupervisor.ts` (`onChildExit`) | restart del runner con backoff | `this.deps.maxRestarts` (`RUNNER_MAX_RESTARTS = 5` por default) + `clearTimeout` en `stop()` + `unref()` (no sostiene el daemon) | `stop()` / `maxRestarts` inyectable |


## R — Review report publication / external reviewer wait (option A, 2026-09-16)

| # | Where (approx line) | Mechanism | Exact bound | Rule / kill-switch |
|---|---|---|---|---|
| R01 | `headless-runtime/review/botReview.ts` (`waitForBotReview`, `fetchBotFindings`) | espera acotada del revisor externo (pullfrog/CodeRabbit) antes de publicar el reporte: polls con sleep one-shot entre intentos (nunca re-armado); corta al primer lote de findings o al tope | `BOT_REVIEW_POLL_MS = 60000` (intervalo entre polls), `BOT_REVIEW_MAX_POLLS = 20` (≤ 20 polls ≈ 20 min); el tope global lo fija `TERMCANVAS_REVIEW_WAIT_MS` (default `BOT_REVIEW_WAIT_MS_DEFAULT = 1200000`, techo `BOT_REVIEW_WAIT_MS_MAX = 3600000`, `0` = publish inmediato legacy) | `TERMCANVAS_REVIEW_WAIT_MS=0` (kill-switch) o `TERMCANVAS_REVIEW_BOTS=""` (sin bots = publish inmediato) |

## SIN COTA — veredicto para QA

**Resultado de la auditoría 2026-09-03 (E2, código real, daemon offline): 0
loops sin cota.** Todos los sitios hallados con
`retry|setInterval|setTimeout|while|for\s*\(|poll|attempt|re-` tienen cota
explícita inventariada arriba o caen en las Exenciones 1-6. No hay `for(;;)`,
no hay `while(true)`, no hay recursión sin caso base, no hay reintento sin
tope en el path factory en vivo.

> Si en el futuro aparece un sitio sin cota: se agrega acá como
> `SIN COTA — FIX`, se reporta como FAIL a QA y el meta-test lo exige
> (un match sin justificación = rojo). No se esconde.

## Mantenimiento (cómo se enforcea)

- `tests/no-unbounded-loops.test.ts` escanea los archivos del daemon y exige
  que cada match de patrón-loop tenga su entrada justificada (con la constante
  real del código) o su exención documentada. Lee las constantes del fuente y
  las compara con los números de este doc (drift = rojo). Incluye la prueba
  rojo→verde hecha en desarrollo (ver resumen de la ola).
- `GET /factory/definition/status` + `node scripts/factory.mjs validate`
  (E1, no tocar) gritan cuando la definition se rompe; el badge (E2) lo muestra
  junto al `daemon <buildId>` reutilizando el tick N04 (30s, cero polling nuevo).
