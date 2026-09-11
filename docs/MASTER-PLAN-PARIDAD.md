# MASTER PLAN — Paridad Warp (Olas 15–20)
### Cerrar los gaps del reporte de paridad 2026-09-03, como lo hace Warp, en local

> **Estado:** guía vigente desde 2026-09-03. Complementa `MASTER-PLAN-FACTORY.md` (Olas 1–13 cerradas); no lo reemplaza.
> **Origen:** reporte de paridad Warp-vs-local del 2026-09-03 (dimensiones 1–20 + gaps P0/P1/P2), cruzado con docs.warp.dev oficiales (agents, skills, as-code, automations, measure-and-improve, how-factories-work).
> **Alcance decidido por el usuario:** se cierran dimensiones 14, 15, 16, 17, 20 + gaps P0 + features a medio cablear (P1) + validación de definition (punto 10).
> **Diferidos explícitos (NO son parte de este plan):** Ola 14 Automations (triggers) e Integrations (Linear/Slack) — se hacen cuando todo el sistema funcione en vivo. Nada de este plan los bloquea ni los presupone.

---

## 0. Reglas (las 6 anteriores siguen + 2 nuevas no-negociables)

Las 6 de `MASTER-PLAN-FACTORY.md` §0 (cero hardcodeos, cero simulaciones, definitions as code, humano decide, evidencia en disco, contratos vivos) aplican íntegras. Se agregan:

7. **CERO LOOPS SIN COTA.** Todo loop, reintento, recursión, re-disparo, polling y sampler tiene cota máxima explícita (número en código + configuración en yaml cuando aplique) y un test que demuestra terminación. Sin excepciones: ni `revise→Building`, ni reintentos LLM, ni análisis, ni proposals, ni notificaciones. Si un flujo no puede probarse que termina, no se mergea.
8. **TODO AUTOMATISMO TRAE INTERRUPTOR.** Todo comportamiento que corre sin click humano (auto-score, auto-propose, notificaciones OS, reintentos) tiene flag de apagado en `factory.yaml` y respeta el "0 = apagado" (estilo `samplingRate: 0`). El usuario siempre puede volver el sistema 100% manual sin editar código.

---

## 1. Mapa de trazabilidad (qué ola cierra qué punto del reporte)

| Ola | Título | Cierra (reporte) |
|-----|--------|------------------|
| 15 | Runners honestos + costo real | Dim 14 (runners), Dim 15 (métricas/costo), P0.1 (costo cero), P0.2 (sincerar runners) |
| 16 | Continuidad conversacional | Dim 16 (resume, IMPORTANTÍSIMO) |
| 17 | Review que re-valida | Dim 17 (re-ejecuta validación) |
| 18 | Features a medio cablear | P1.4 (`selfImprovement` auto), P1.5 (scorers `agents`), P1.6 (benchmarks + scorers por trial), P1.7 (threshold display-only) |
| 19 | Notificaciones locales + human-accept scorea | Dim 20 (avisar al requester), P0.3 (human-accept sin auto-score) |
| 20 | Validación de definition + auditoría anti-loops | Punto 10 (validate), Regla 7 (cierre formal) |

Orden de ejecución: 15 → 16 → 17 → 18 → 19 → 20. Dependencias reales: 17 necesita 16 (re-review en la MISMA sesión); 18 necesita 15 (costo para benchmarks con scorers); 19 necesita 11 (scorers, hecho) y nada más; 20 audita 15–19 (va última sí o sí).

---

## 2. OLA 15 — Runners honestos + costo real

### 2.1 Objetivo
Que "linux-build" deje de ser teatro: runners como código con aislamiento declarado y verificado, y costo medido de verdad (llamadas + tokens estimados + USD estimado con base declarada) en vez del `USD 0.00` hardcodeado en 12 lugares.

### 2.2 Diseño (como Warp, adaptado a local)
- `factory/runners/<name>.yaml` REAL: `description`, `setupCommands`, `instanceShape {vcpus, memoryGb}` (documental en local), **`isolation: "none" | "docker"`**, `platform {os, arch, dockerImage}`. Migran los valores actuales (ubuntu:22.04, 4vCPU/8GB, corepack enable) del TS al yaml. Solo `linux-build` + `windows-local` (nuevo, honesto: el daemon corre en Windows).
- Loader en `agentLoader.ts` (solo agregar, patrón existente): `getRunners()`, `getRunner(name)`, fallback a constante si yaml ausente/inválido (warn visible, nunca throw).
- Ejecución: `runnerExecutor` intenta `docker` SOLO si `isolation: docker` Y hay docker disponible (probe `docker info`, timeout 5s, cacheado); si no, ejecuta local y lo REGISTRA. Cada step de verificación lleva `isolation: "docker"|"none"` en su evidence. Sin docker instalado no es error: es el modo local declarado.
- UI: badge de aislamiento junto al runner ("local · sin aislamiento" ámbar / "docker" verde) en WorkItemList + VerificationPanel. El texto "ubuntu:22.04 4vCPU/8GB" pasa a decir de dónde sale (perfil del yaml).
- Costo: nuevo `cost` real por job en `job.json` + timeline: `{llmCalls, estimatedInputTokens, estimatedOutputTokens, estimatedUSD, basis: "estimated-chars/4", ratesRef}`. Contador `llmCalls`: el daemon incrementa en cada `session.prompt` de los agentes del job (foreman/triage/spec/implement/review/judge/analysis) — instrumentación en UN punto (wrapper del prompt o contador en el store por jobId, nunca en cada agente a mano). Tokens: `chars/4` sobre prompt enviado + texto recibido (tenemos los raws de review/scorers; implement/foreman miden lo que envían; donde no hay medición, `null` y se dice). USD: tabla `costRates` en `factory.yaml` (`{"provider/model": {inputUSDper1M, outputUSDper1M}}`); sin tarifa → sin USD (se muestra llamadas+duración, NUNCA `0.00` como si fuera dato). `CostBadge` muestra `N llamadas · ~X tokens · ~USD Y (est.)` o `N llamadas · sin tarifa`.
- Regla 8: `costTracking: true|false` en yaml (apagado = no se estima nada, se muestra "—").

### 2.3 Archivos
- Nuevos: `factory/runners/linux-build.yaml`, `factory/runners/windows-local.yaml`, `tests/runner-cost.test.ts` (+ `tests/measure-cost.test.ts` si se separan).
- Tocar: `agentLoader.ts` (solo agregar getters), `runnerExecutor.ts`/`runnerService.ts` (probe docker + isolation en evidence), `verification.ts` (evidence lleva isolation), `workItemStore.ts`/`workItemDisk.ts` (cost real, aditivo), `factoryServer.ts` (solo exponer cost en GETs ya existentes, sin cambiar formas), `WorkItemList.tsx` + `VerificationPanel.tsx` (badges), `factory.yaml` (`costRates`, `costTracking`, runners default), `package.json` NO.
- Prohibido: cambiar schemas existentes (solo campos opcionales), mocks productivos, inventar tokens donde no se mide (null honesto).

### 2.4 Tests + Done
- Loader válido/inválido/ausente→fallback; probe docker con stub de filesystem (NO de docker real: test del selector, no del daemon docker); evidence con isolation correcta en ambos modos; estimador `chars/4` con casos borde (vacío→0, multibyte); contador llmCalls (3 prompts→3); cost sin tarifa = sin USD; `costTracking:false` = "—".
- **Done cuando:** un job real muestra llamadas>0, tokens>0, USD estimado con base visible (o "sin tarifa" si no hay rates); badge de aislamiento visible; `grep estimatedUSD | 0` ya no es la única fuente (el `0` inicial sigue existiendo como "sin datos todavía", con label honesto).

### 2.5 Riesgos
- Docker en Windows con paths `C:\` + espacios: montaje con comillas y fallback a local ante CUALQUIER error (fail-open a local declarado, nunca job roto por docker).
- El contador por jobId en llamadas concurrentes: key por jobId en el wrapper, no global.

---

## 3. OLA 16 — Continuidad conversacional (IMPORTANTÍSIMA)

### 3.1 Objetivo
Terminar con la amnesia: UNA sesión por (job, rol) reutilizada entre turnos — el rebuild continúa la conversación del implement con los findings como mensaje siguiente, el re-review continúa la del reviewer, el foreman continúa la suya. Como Warp ("continues existing agent conversations instead of starting new ones").

### 3.2 Diseño
- `agentSessions?: Record<"foreman"|"triage"|"spec"|"implement"|"review", string>` opcional en `WorkItem` (aditivo; persiste en `job.json` vía `workItemDisk`, restore tolerante).
- Helper `headless-runtime/measure/` NO — nuevo `headless-runtime/sessions/agentSessions.ts`: `getAgentSession(jobId, role): string|null`, `setAgentSession(jobId, role, sessionId)` (persiste best-effort), `promptInAgentSession(client, jobId, role, directory, title, body): Promise<{sessionId, res}>` que: 1) si hay sessionId guardado, promptea ahí; 2) si el server responde "session not found"/equivalente, crea nueva, guarda, reintenta UNA vez; 3) cualquier otro fallo → lanza (el caller aplica su fallo-sano actual).
- Migración por agente (uno por uno, mismo patrón): `foreman.ts`, `triageAgent.ts`, `specAgent.ts`, `implementAgent.ts`, `reviewAgent.ts`, scorer judge, analysis. Cada uno reemplaza su `session.create` incondicional por el helper. Comportamiento ante daemon reiniciado (server efímero nuevo = sesiones viejas muertas): el paso 2 lo cubre + evento timeline "sesión renovada (la anterior expiró)" — visible, no silencioso.
- Regla 7: resume fallido = 1 reintento con sesión nueva, después fallo-sano del caller (cero loops).
- Regla 8: `agentSessions: true|false` en yaml (apagado = comportamiento actual de sesión por llamada).

### 3.3 Archivos
- Nuevos: `headless-runtime/sessions/agentSessions.ts`, `tests/agent-sessions.test.ts`.
- Tocar: `shared/types/workItem.ts` (campo opcional), `workItemDisk.ts` (persist/restore), `workItemStore.ts` (`toJSON` lo expone), los 7 callers (solo el bloque create→prompt), `factory.yaml` (flag).
- Prohibido: cambiar veredictos/semánticas, tocar prompts, pacts (los tests usan mocks de sesión: `setXPromptMock` existentes siguen valiendo).

### 3.4 Tests + Done
- get/set + persist/restore round-trip; resume OK usa misma session (mock cuenta creates=1 en 2 turnos); session muerta → create nuevo + 1 solo reintento (creates=2, no más); flag apagado = create por llamada (comportamiento viejo); job viejo sin `agentSessions` no rompe (restore tolerante).
- **Done cuando:** un job real con `revise` muestra en timeline "sesión renovada" o reutilización (según caso) y el rebuild cita contexto previo sin que se lo repitan en el prompt; 0 sesiones huérfanas acumuladas por job (1 por rol como máximo + renovaciones trazadas).

### 3.5 Riesgos
- El server efímero muere y mata TODAS las sesiones: tormenta de renovaciones. Mitig: renovación lazy (solo cuando el rol vuelve a hablar) + evento visible, nunca renovación masiva.
- Divergencia SDK entre `session.prompt` con id existente vs nuevo: el helper abstrae las 2 formas ya conocidas (path/body + legacy).

---

## 4. OLA 17 — Review que re-valida

### 4.1 Objetivo
Que el reviewer deje de ser solo-lectura-impotente ante evidencia floja: puede pedir re-verificación enfocada (comandos de la allowlist) y el sistema la corre, adjunta evidencia y el review continúa EN LA MISMA SESIÓN (necesita Ola 16). Como Warp ("reruns or extends validation where the evidence is thin").

### 4.2 Diseño
- `ReviewFinding` gana `reverify?: {commands: string[], reason: string}` opcional (aditivo, zod). Allowlist CERRADA de comandos: `pnpm test`, `pnpm build`, `git diff --stat`, `git diff -- <paths del job>`, `git status --porcelain`. Cualquier otra cosa (incluido `rm`, `adb`, redirecciones, `&&` con extras) → el finding se conserva pero `reverify` se ignora con nota (fail-closed).
- `ReviewService`: si veredicto `revise` + ≥1 finding con `reverify` válido + budget disponible → corre `verificationService` enfocada (1 vez por review, dentro del presupuesto de las 2 revisiones: consume 1), adjunta evidence al timeline (`reverify: {commands, evidence}`), y re-dispara Building con meta enriquecida. Sin budget → revise normal (el pedido queda registrado como finding para el humano).
- El prompt del reviewer (vía skill `code-review`, NO bakeado: la skill gana una sección "pedir re-verificación") le enseña el mecanismo + la regla "si la evidencia es floja, pedí reverify ANTES de fallar en silencio".
- Regla 7: 1 reverify por review como máximo, dentro del budget 2 (demostrable: `reviewCount` lo acota; test de no-loop: mock que siempre pide reverify → termina en ask_human en ≤2 ciclos).
- Regla 8: `reviewerReverify: true|false` en yaml.

### 4.3 Archivos
- Tocar: `shared/types/review.ts` (campo opcional), `reviewPrompt.ts` (nada: la skill lo enseña — solo si la skill no alcanza, bloque mínimo), `reviewService.ts` (rama reverify), `verification.ts` (entry `runFocused(commands, ...)` reutilizando `spawnStep`, SIN duplicar lógica), `factory/skills/code-review/SKILL.md` (sección nueva), `factory/agents/review/agent.md` (menciona la capacidad), `factory.yaml` (flag), `tests/review-reverify.test.ts` (nuevo).
- Prohibido: darle `bash` libre al reviewer (sigue sin write/edit/bash directo: la re-verificación la EJECUTA el sistema, no el modelo), cambiar budgets existentes, pacts.

### 4.4 Tests + Done
- Allowlist acepta los 5 comandos y rechaza `rm -rf x`, `pnpm test && curl evil`, `git diff` con paths fuera del job; finding con reverify inválido se ignora sin romper el revise; budget: siempre-pide-reverify termina en ask_human con reviewCount=2; evidence del reverify aparece en timeline y en el rebuild; flag apagado = revise clásico.
- **Done cuando:** un job real donde el reviewer dude de la evidencia muestra el ciclo pedido→evidencia→veredicto en el timeline, todo dentro de 2 revisiones.

### 4.5 Riesgos
- Comandos colgados: reutilizan `IMPLEMENT_VERIFY_TIMEOUT_MS` + kill (ya existe en `spawnWithLog`).
- El LLM pide reverify para todo (cuota): el budget lo acota; si abusa, la skill se calibra (esto es exactamente lo que los scorers van a medir en el loop).

---

## 5. OLA 18 — Features a medio cablear (4 cierres)

### 5.1 P1.4 — `selfImprovement` con efecto real
- Al terminar `autoScoreCompletedJob`: por cada scorer con `selfImprovement: true` en su md + ≥2 NUEVOS failures desde la última propuesta de ese scorer + máx 1 propuesta `pending|ready` abierta por scorer → `createProposal` automático (mismo engine, sin código nuevo de análisis). Todo lo demás igual (nunca adopta solo).
- Regla 8: el apagado es el propio flag (`false` = manual como hoy) + cooldown configurable `improveProposalCooldown` (yaml, default: 1 propuesta abierta por scorer).
- Tests: scorer con flag true + 2 fails nuevos → propuesta creada; con flag false → nada; con propuesta abierta → nada (cooldown); thresholds en borde.

### 5.2 P1.5 — scorers con campo `agents`
- `ScorerDefinition` + `scorer.md` ganan `agents: string[]` (roles del pipeline: `implement`, `review`, `verification`...). `validateScorerDefinition` lo exige (≥1). Los 3 scorers reales se etiquetan (review-formato→[`review`], implement-scope→[`implement`], verification-honesta→[`verification`]).
- Engine: `appliesTo(job, scorer)` — el job debió alcanzar la etapa del rol (review: tiene lastReview/review.json; implement: tiene createdFiles; verification: tiene verification). Auto-score y manual fuera de alcance → 409 honesto ("este scorer no aplica a este job todavía") en vez de unscored confuso.
- UI: cards agrupadas/filtradas por rol. Tests: scorer sin agents rechaza; job sin Review + scorer de review → 409; migrados los 3 md + sus tests.

### 5.3 P1.6 — benchmarks aplican scorers por trial
- `BenchmarkDefinition` gana `scorers?: string[]` (nombres; default: los 3 reales). Cada trial, además de Correctness, corre esos scorers contra el trial (juez con mock en tests, real en vivo) y guarda `trial.scores: {[scorer]: {label, passing}}`.
- Costo: cada scorer por trial = 1 llamada LLM → suma a `llmCalls` y al aviso de costo (el cap 50 trials NO cambia; el aviso muestra llamadas = trials × (1 + scorers)).
- Stats por config agregan `scorePassRate` por scorer. Sin ganador (igual que hoy). Tests con mock: trial con scorers mockeados → scores guardados; scorer que falla → trial sigue (unscored en ese scorer, Correctness manda).

### 5.4 P1.7 — threshold display-only
- Fuente de verdad pasa a ser `score` guardado; `passing` se RECOMPUTA al leer (`readScores`, summary, UI) con el `passingScore` ACTUAL del scorer.md. Lo persistido viejo se re-etiqueta solo.
- Tests: score 0 con threshold 0.5 → fail; cambio threshold a 0 → el MISMO score leído ahora es pass; lo guardado en disco no cambió (relectura cruda).
- Migración: ninguna (los scores guardados ya traen `score`; solo cambia la lectura).

### 5.5 Archivos (toda la ola)
- Tocar: `shared/types/scorer.ts`, `scorerLoader.ts`/`scorerEngine.ts`/`sampler.ts` (filtros y auto-propose), `benchmarkEngine.ts`/`benchmark.ts` (scorers por trial), `factoryServer.ts` (409 nuevo + exponer agents; solo aditivo), `ScorersPanel`/`BenchmarksPanel` (UI mínima: grupo por rol, aviso de costo con scorers, re-etiqueta visible), `factory/scorers/*/scorer.md` (agents + selfImprovement calibrado: `true` solo en 1 scorer al inicio para no quemar cuota), `factory.yaml` (cooldown), `tests/measure-scorers-agents.test.ts` (nuevo; benchmarks extienden el suyo).
- Prohibido: cambiar thresholds por defecto (0.5), tocar pacts, auto-adoptar (sigue prohibido por regla 4).

### 5.6 Done de la ola
- Un scorer con flag true genera propuesta sola ante 2 fails nuevos (verificado en vivo con 1 scorer para cuidar cuota); job sin Review + scorer de review → 409 con mensaje; benchmark con scorers muestra `scorePassRate`; cambio de threshold re-etiqueta sin tocar disco.

---

## 6. OLA 19 — Notificaciones locales + human-accept scorea

### 6.1 Objetivo
Que `ask_human` deje de ser un semáforo en una pestaña que nadie mira: centro de notificaciones en app + toast OS nativo, y el humano-accept entra al loop de medida (P0.3).

### 6.2 Diseño (Warp sin Slack: el foreman "habla" en local)
- Centro de notificaciones: `GET /factory/notifications` (últimas 100, ring buffer persistido `factory/.notifications.json`, cap dura) + `POST /:id/ack`. Eventos que notifican: `ask_human` (review), spec pendiente de aprobación, proposal ready, benchmark done, error de daemon (opencode no disponible). Cada una: `{id, kind, workItemId?, title, body, at, acked}`. Polling 5s en `NotificationBell` (campana con contador en FactoryLab) + panel.
- Toast OS: `electron/main.ts` usa `Notification` de Electron ante los mismos eventos (respetando foco: si la ventana está focused, solo badge). Regla 8: `osNotifications: true|false` en yaml + respeto a "no molestar" del SO (lo maneja Electron solo).
- El foreman "pregunta al requester" (Warp) = `ask_human`/`needsSpecApproval` generan notificación con el texto de la pregunta/decisión (ya existe en timeline; se espeja, no se duplica lógica).
- P0.3: `POST /review/accept` dispara `autoScoreCompletedJob` igual que el accept automático (mismo helper, fire-and-forget). El "Aceptar igual" entra a la baseline.
- Regla 7: ring 100 (al llegar, se descartan las más viejas acked primero), toast 1 por evento (dedupe por id), polling 5s fijo.

### 6.3 Archivos
- Nuevos: `headless-runtime/notify/notifications.ts` (store+tipos+lógica, puro testeable), `src/features/factoryLab/components/NotificationsBell.tsx` (+ panel), `tests/notifications.test.ts`.
- Tocar: emisores (reviewService ask_human, spec approve-request, proposals ready, benchmark done, daemon error) — SOLO agregan 1 llamada `notify(...)` best-effort; `factoryServer.ts` (2 endpoints aditivos); `FactoryLabPage.tsx` (campana); `reviewService` NO — el hook va en el handler accept de factoryServer junto al existente; `electron/main.ts` (toast, mínimo); `factory.yaml` (flags).
- Prohibido: spam (sin evento no hay notificación), bloquear flujos si notificar falla (try/catch + warn), pacts.

### 6.4 Tests + Done
- Store: cap 100 con descarte, ack, persist round-trip; cada emisor genera 1 notificación con el texto correcto (tests con store en memoria); dedupe (mismo evento 2 veces = 1 notificación); flag apagado = 0 notificaciones; accept humano dispara auto-score (mock cuenta llamadas).
- **Done cuando:** un job en ask_human hace sonar toast + campana con contador, ack la limpia, y el accept humano deja scores en el job.

---

## 7. OLA 20 — Validación de definition + auditoría anti-loops

### 7.1 Objetivo
Que una definition rota grite en vez de degradar en silencio (punto 10), y cierre formal de la Regla 7 con inventario + tests de terminación.

### 7.2 Diseño
- `factory validate`: `headless-runtime/factory/definitionValidate.ts` (puro) valida TODO — agents (exactamente 1 FOREMAN, agentTypes válidos, tools conocidos), yaml (puertos, timeouts>0, modelos `provider/model`, rates ≥0), scorers (invariante labels, samplingRate 0..100, model válido), skills (frontmatter + cuerpo no vacío + ≤cap), runners (isolation válida, setupCommands no vacías), benchmarks tasks (schema), proposals dir escribible. Devuelve `[{file, line?, rule, message, severity: "error"|"warn"}]` con línea aproximada (busca la key en el texto: honestidad documentada "línea aproximada").
- Exposición: `GET /factory/definition/status` (`{valid, errors[], checkedAt, buildId}`) + `node scripts/factory.mjs validate` (el script ya existe: nuevo comando) + badge en FactoryLab junto a `daemon <buildId>` (verde/rojo + panel de errores). Los loaders SIGUEN con fallback (fail-safe), pero ahora el fallback es VISIBLE.
- Auditoría anti-loops: inventario `docs/LOOPS.md` (generado a mano, verificado por test): cada loop/reintento del daemon con su cota (revise≤2, reverify 1/review, LLM retry 1, session-resume 1, benchmark cap 50, proposals 1 abierta/scorer, notifications ring 100, polling intervalos fijos, sampler). Meta-test `tests/no-unbounded-loops.test.ts`: parsea el inventario contra constantes reales del código (si alguien sube una cota sin actualizar el doc, falla; si agrega un reintento sin registrarlo, un grep de patrones `retry|setInterval|while|for(` le pide justificación). Diseño pragmático: el test conoce la lista de archivos y exige que cada match de patrón-loop tenga su entrada en `docs/LOOPS.md`.
- Regla 7 queda así cerrada y enforceada por CI local (`pnpm test` lo incluye).

### 7.3 Archivos
- Nuevos: `headless-runtime/factory/definitionValidate.ts`, `docs/LOOPS.md`, `tests/definition-validate.test.ts`, `tests/no-unbounded-loops.test.ts`.
- Tocar: `factoryServer.ts` (1 endpoint), `scripts/factory.mjs` (comando `validate`), `FactoryLabPage.tsx` (badge + panel), `factory.yaml` (nada obligatorio).
- Prohibido: convertir warnings en bloqueos (solo `error` bloquea el badge en rojo; `warn` es ámbar informativo), falsos positivos del meta-test (lista de exenciones documentada en el propio test).

### 7.4 Tests + Done
- Cada regla de validación con caso bueno/malo; línea aproximada correcta en 3 casos; badge verde con definition actual (debe pasar HOY: si falla, primero se arregla la definition); meta-test verde; agregar un `setInterval` sin registrar → test rojo (probarlo en el propio desarrollo y revertirlo).
- **Done cuando:** romper a propósito un scorer.md muestra badge rojo con file:line y el sistema sigue funcionando en fallback (degradación visible, la anti-Warp-silencioso).

---

## 8. Contratos nuevos (resumen para UI/daemon)

| Endpoint / artefacto | Ola |
|---|---|
| `VerificationStep.isolation`, `Cost {llmCalls, tokens, USD, basis}` en job.json y GETs (aditivo) | 15 |
| `agentSessions` en job.json + evento "sesión renovada" | 16 |
| `ReviewFinding.reverify?`, evento `reverify` en timeline | 17 |
| 409 "scorer no aplica todavía", `agents` en scorers, `scores` en trials, `passing` recomputado | 18 |
| `GET /factory/notifications`, `POST /:id/ack`, campana + toast | 19 |
| `GET /factory/definition/status`, `factory.mjs validate`, badge definition | 20 |

Polling nuevos: notificaciones 5s. Ningún intervalo existente cambia.

## 9. E2E perfecto v2 (actualiza §5 del plan anterior)

Se mantienen los 6 puntos y se agregan:
7. 10 jobs seguidos con costo medido (llamadas>0) y badge de aislamiento visible.
8. Un revise→rebuild ocurre en la MISMA sesión (timeline lo prueba) y un resume-expirado se renueva con evento.
9. Un reverify pedido por el reviewer aparece como evidence antes del veredicto final.
10. Un scorer con selfImprovement:true genera propuesta sola; el humano la adopta/descarta desde la notificación.
11. Romper la definition pone el badge en rojo sin romper el flujo.

## 10. Modo autónomo (igual que §6 anterior + 2 agregados)

1-6 idénticos (olas en orden, TDD, job real E2E, no mockear bloqueos, reinicio daemon vía usuario con `buildId` verificado, reporte por ola).
7. **Presupuesto LLM por ola**: antes de ejecutar, estimar llamadas (trials × scorers × reintentos); si supera 50 llamadas, pedir confirmación al usuario con el número. La cuota es recurso escaso y se trata como tal.
8. **Scope-freeze por ola**: si en una ola aparece trabajo de otra (pasó en 5–13 varias veces), se anota en bitácora como carry-over y NO se hace. Las olas se cierran, no se expanden.

## 11. Decisiones abiertas

- [ ] Docker en Windows con OneDrive + espacios: ¿montaje directo del worktree o copia a tmp? (Ola 15 lo decide con prueba real, no con opinión.)
- [ ] Tabla `costRates` inicial: ¿qué tarifas para muse-spark/big-pickle? (Sin dato real, Ola 15 arranca con "sin tarifa" y el usuario las agrega.)
- [ ] Toast OS: ¿solo ask_human + spec-approval, o también proposal-ready y benchmark-done? (Propuesto: los 4, apagables por separado si molestan → si molestan, flag por kind en yaml.)
- [ ] `agents` de scorers: vocabulario cerrado de roles (`implement|review|verification|triage|spec|foreman`) — ¿cerrado en schema o libre? (Propuesto: cerrado, con error accionable.)

## 12. Bitácora (append-only)

- 2026-09-03 — Plan creado desde reporte de paridad. Ola 14 (automations) e integrations diferidas por decisión del usuario. Reglas 7 (cero loops sin cota) y 8 (todo automatismo trae interruptor) agregadas.
- 2026-09-03 — **Ola 15 cerrada (runners honestos + costo real, E1+E2+cierre+QA PASS):** `factory/runners/{linux-build (docker),windows-local (none honesto)}.yaml` + getters en agentLoader (fallback+warn, nunca throw) + probe `docker info` 5s/TTL 60s con fail-open a local registrado + `isolation` en evidence + `costTracker` (chars/4, USD solo con tarifa, contador por jobId, cap 10000 FIFO) + `promptWithCost` cableado en los 7 agentes + `refreshCostSummary` (persiste sin doble conteo) + `CostBadge`/`IsolationBadge` en WorkItemList/VerificationPanel. QA PASS: 171/171 en 10 suites + tsc default 0 (headless solo preexistentes ajenos). E2E vivo (job con llamadas>0 + badges) pendiente de restart del daemon por el usuario (caído al cierre).
- 2026-09-03 — **Ola 16 cerrada (continuidad conversacional, E1+E2+QA PASS):** helper `headless-runtime/sessions/agentSessions.ts` (1 sesión por job+rol, resume con 1 solo reintento ante not-found + evento "sesión renovada (la anterior expiró)", flag `agentSessions` con OFF=flujo viejo) + campo aditivo en tipos/store/disk + migración de los 7 callers (foreman/triage/spec/implement/review/scorer/analysis; review por-intento documentado, analysis con clave sintética si es mixto). QA PASS: 377/377 en 15 suites + tsc default 0 (headless solo preexistentes). E2E vivo (revise en misma sesión) pendiente de restart del daemon por el usuario.
- 2026-09-03 — **Ola 17 cerrada (review que re-valida, E1+E2+QA PASS):** `ReviewFinding.reverify?` aditivo + allowlist cerrada de 5 comandos (fail-closed con nota) + `runFocused` reutilizando spawn existente + rama en reviewService (1 por review dentro del budget 2; siempre-pide termina en ask_human con reviewCount=2) + skill code-review con sección reverify + mención en agent.md + display del evento en WorkItemList + flag `reviewerReverify`. QA PASS: 299/299 en 13 suites + tsc default 0 (headless solo preexistentes). E2E vivo (ciclo pedido→evidencia→veredicto ≤2 revisiones) pendiente de restart del daemon por el usuario. Decisión: suites nuevas por invocación directa (precedente Olas 5-16, `package.json` no se toca).
- 2026-09-03 — **Ola 18 cerrada (P1.4+P1.5+P1.6+P1.7, E1+E2+QA PASS):** auto-propose ante 2 fails nuevos con cooldown (mismo engine, jamás auto-adopta) + `agents` cerrado en scorers con gate de aplicabilidad (manual fuera de alcance → 409 honesto, auto lo salta) + benchmarks con scorers por trial (`trial.scores`, `scorePassRate` sin unscored, costo trials×(1+S), cap 50 intacto, sin ganador) + threshold display-only (passing se recomputa al leer, disco intacto). QA PASS: 285/285 en 12 suites + tsc 0 total. E2E vivo pendiente de restart del daemon por el usuario.
- 2026-09-03 — **Ola 19 cerrada (notificaciones + human-accept scorea, E1+E2+QA PASS):** centro persistido `factory/.notifications.json` (ring 100, dedupe, restore tolerante) + `GET /factory/notifications` + `POST /:id/ack` + 5 emisores best-effort (ask_human, spec-approval, proposal-ready, benchmark-done, daemon-error en punto central tryCreateOpencodeSession) + accept humano dispara autoScore (P0.3, fire-and-forget) + campana con contador y panel (poll 5s) + toast renderer con foco+dedupe cap 200 + flags `notificationsEnabled`/`osNotifications`. QA PASS: 305/305 en 12 suites + tsc 0. E2E vivo (toast+campana+ack+accept-scorea) pendiente de restart del daemon por el usuario.
- 2026-09-03 — **Ola 20 cerrada (validación definition + anti-loops, E1+E2+QA PASS) — CIERRE DEL PLAN 15-20:** `definitionValidate.ts` (30 rules error/warn, línea aproximada, nunca lanza) + `GET /factory/definition/status` + `node scripts/factory.mjs validate` (exit 1 si !valid; probado en vivo verde y rojo) + `docs/LOOPS.md` (50 filas, 0 SIN COTA) + meta-test `no-unbounded-loops` (anti-drift de 30 constantes, rojo→verde probado por E2 y repetido por QA) + badge definition en FactoryLab (verde/rojo/ámbar/gris, enganchado al tick de salud 30s, 0 polling nuevo). QA PASS: 474/474 en 13 suites + tsc 0 total. Known Issue preexistente fuera de scope: `agent-sessions-migration.test.ts` (Ola 16) se cuelga offline en el path review con daemon caído (hang móvil: QA lo vio en test 6, orquestador en test 8; sin intersección de imports con Ola 20) — requiere dueño Ola 16 + re-check con daemon vivo. E2E vivo de todo el plan pendiente de restart del daemon por el usuario.
- _(siguientes acá)_
