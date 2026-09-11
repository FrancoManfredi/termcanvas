# MASTER PLAN — E2E Lab del Software Factory
### Probar el sistema de muchas formas distintas, en vivo, con Playwright MCP y lupa

> **Estado:** guÃ­a vigente desde 2026-09-03. Complementa `MASTER-PLAN-FACTORY.md` y `MASTER-PLAN-PARIDAD.md`; no los reemplaza.
> **QuÃ© es:** el plan de corridas E2E en vivo (navegador real + daemon real + disco real) para comprobar quÃ© funciona y quÃ© no.
> **QuÃ© NO es:** no diseÃ±a features, no fija bugs, no pule UI. Los bugs que aparecen van a `docs/E2E-HALLAZGOS.md` y se arreglan en otro flujo.
> **Nota LAB (decisión del usuario 2026-09-03):** esto es un LAB, no la UI final ni cerca. Los hallazgos cosméticos de UI son P2 salvo que bloqueen un flujo (ej. tapan el camino a un `ask_human` → eso es P1). No se pule UI por pulir; el foco es comportamiento del sistema.

---

## 0. Reglas (las 8 de los planes + 6 propias del lab, todas no-negociables)

Las 8 reglas de `MASTER-PLAN-FACTORY.md` Â§0 + `MASTER-PLAN-PARIDAD.md` Â§0 valen Ã­ntegras (cero hardcodeos, cero simulaciones, definitions as code, humano decide, evidencia en disco, contratos vivos, cero loops sin cota, todo automatismo con interruptor). Se agregan para el lab:

- **E1. Playwright MCP obligatorio.** NingÃºn caso se da por PASS por relato, por logs solos ni por "lo vi pasar". Todo PASS exige assert sobre el Ã¡rbol de accesibilidad (`browser_snapshot` + `browser_click`/`browser_type` por ref) MÃS assert en disco (`job.json`, `scores.json`, `.notifications.json`, timelines). Screenshot solo como evidencia adjunta, jamÃ¡s como Ãºnico assert.
- **E2. Un caso a la vez.** Nada de jobs en paralelo durante la corrida (cuota + determinismo). Un caso termina (PASS/FAIL/BLOQUEADO) antes de lanzar el siguiente. ExcepciÃ³n: el caso que pida rodaje lo dice explÃ­cito.
- **E3. E2E no toca cÃ³digo.** La corrida es lectura + clicks + crear jobs + editar lo que el caso pida (ej. romper un scorer a propÃ³sito). Si algo se rompe de verdad, se anota y se sigue; el fix es otro flujo.
- **E4. Cuota es recurso escaso.** Cada caso declara su costo estimado en llamadas LLM. Si la corrida entera estima mÃ¡s de 50 llamadas, el orquestador pide confirmaciÃ³n al usuario ANTES de arrancar (precedente: plan de paridad Â§10.7).
- **E5. Veredicto por caso, sin grises.** `PASS` (todo lo esperado con evidencia), `FAIL` (algo material no cumplió → nace o se reabre hallazgo en `E2E-HALLAZGOS.md`), `BLOQUEADO` (infra caída: daemon muerto, servidor de modelos caído, red — se reintenta 1 vez y si repite se cierra el caso como BLOQUEADO, no como FAIL del Factory).
- **E6. Trazabilidad total.** Cada caso registra: `buildId` del daemon, job ids, timestamps, screenshots y el veredicto. Si no estÃ¡ registrado, no pasÃ³.

---

## 1. Precondiciones de corrida (checklist, en orden)

1. Terminal del usuario en el repo, daemon vivo: `node scripts/factory.mjs status` → `OK ... buildId=<id>`. **Anotar el `buildId`: vale para toda la corrida.** Si el daemon está caído, lo levanta el USUARIO (`restart`); el orquestador y los agentes jamás lo reinician (cuelga los tool calls por el job object de Windows).
2. `node scripts/factory.mjs validate` → exit 0 (`0 errores`). Si da rojo, la corrida no arranca (primero se entiende por qué).
3. FactoryLab abierta en el navegador (la URL del dev habitual). Playwright MCP conectado a esa pÃ¡gina.
4. Worktree de pruebas definido y VACÃO de corridas anteriores (se recomienda uno descartable, ej. `test-orquestador`). Los casos crean y leen ahÃ­; nada de probar sobre el repo del Factory.
5. Anotar cuota inicial si el proveedor la muestra (para el reporte de costo posterior).

---

## 2. Protocolo Playwright MCP (cÃ³mo se opera, siempre igual)

1. `playwright_browser_navigate` a la URL de FactoryLab. `playwright_browser_snapshot` para conocer refs (nunca adivinar selectores ni clickear por coordenadas).
2. Crear job: `playwright_browser_type` en el campo de prompt (ref del snapshot) + submit. **Anotar el job id en cuanto aparezca.**
3. Esperas con `playwright_browser_wait_for` (texto esperado, ej. `Complete`, `ask_human`, `Triage`) o `time` corto y acotado. **Prohibido `sleep` fijo largo**: si el texto no aparece en el plazo del caso, es FAIL o BLOQUEADO, no "espero mÃ¡s".
4. Asserts = substrings exactos del snapshot (estados, badges `sin tarifa`, `local Â· sin aislamiento`, contadores de campana, eventos `cost:`/`reverify:`/`sesiÃ³n renovada` en el timeline visible).
5. `playwright_browser_take_screenshot` al cierre de cada caso (evidencia, 1 por caso como mÃ­nimo).
6. Verificación en disco por cada caso (el agente lee `job.json`, `scores.json`, `.notifications.json` del worktree de pruebas y contrasta contra lo visto en UI — si UI y disco divergen, es FAIL aunque la UI se vea linda).
7. Timeouts explÃ­citos y cortos en todo comando propio o delegado; ante flake de red/browser: 1 reintento, si repite es hallazgo, no "reintento hasta que pase".

---

## 3. Matriz de casos (14, de barato a caro)

> ConvenciÃ³n por caso: **Objetivo** / **Pre** / **Pasos UI** (Playwright) / **Disco** / **PASS** / **FAIL** / **Cuota est.**.

### E2E-01 — Trivial happy path (el caso de hoy, que salga verde)
- **Objetivo:** job claro → `Complete` con `accept`, costo medido, aislamiento visible.
- **Pre:** Â§1 listo.
- **Pasos UI:** 1) crear job con `CreÃ¡ la carpeta demo-e2e con un archivo leeme.txt que explique en 2 lÃ­neas para quÃ© sirve la carpeta`. 2) `wait_for` `Complete` (plazo 8 min). 3) assert snapshot: veredicto `accept`, badge costo con `llamadas` N>0 y `sin tarifa`, badge aislamiento. 4) assert timeline visible con evento `cost:`. 5) screenshot.
- **Disco:** `job.json`: `status Complete`, `costSummary.llmCalls>0`, `estimatedUSD null`, `ratesRef null`; `agentSessions` con las 4 sesiones; `createdFiles` con rutas reales (NO texto del prompt).
- **PASS:** todo lo anterior + en el worktree existe `demo-e2e/leeme.txt` con el contenido pedido.
- **FAIL:** reproduce H-001 si aparece carpeta literal o `createdFiles` con texto del prompt; cualquier `ask_human` por infra va a E2E-04, no falla este caso (se marca BLOQUEADO-infra y se sigue).
- **Cuota est.:** 3-6 llamadas.

### E2E-02 — Bug real → revise → rebuild → accept
- **Objetivo:** el loop de correcciÃ³n funciona con findings accionables (E2E-perfecto Â§5.2).
- **Pre:** E2E-01 PASS.
- **Pasos UI:** 1) crear job que pida algo verificable y meterle una condiciÃ³n que falle (ej. pedir archivo con contenido exacto X peroLiquido... en la prÃ¡ctica: job claro sobre un archivo, y si el implement lo deja mal, el review debe marcar `revise` Unambiguous). 2) `wait_for` `revise` o `accept`. 3) si `revise`: assert finding con archivo+motivo accionable; `wait_for` segundo veredicto (plazo 8 min). 4) screenshot por veredicto.
- **Disco:** `review.json` con findings tipados; timeline con el ciclo Building→Review→Building→Review; `reviewCount` ≤ 2.
- **PASS:** `accept` final con el defecto corregido en disco (contenido del archivo verificado por lectura, no por relato).
- **FAIL:** `revise` sin finding accionable, `reviewCount` > 2, o loop que no termina.
- **Cuota est.:** 6-12 llamadas.

### E2E-03 — Ambiguo → Triage con preguntas (responde H-002)
- **Objetivo:** el pedido vago termina en Triage-humano CON preguntas concretas y camino de respuesta.
- **Pre:** ninguna extra.
- **Pasos UI:** 1) crear job con `MejorÃ¡ algo del proyecto donde veas oportunidad`. 2) `wait_for` `Triage`. 3) assert snapshot: hay preguntas concretas visibles (quÃ© parte, con quÃ© objetivo, con quÃ© criterio) y algÃºn control para responder/derivar. 4) screenshot.
- **Disco:** decisiÃ³n `needs_triage` con `openQuestions` no vacÃ­o.
- **PASS:** preguntas concretas visibles + `openQuestions` poblado.
- **FAIL:** Triage sin preguntas ni forma de responder (es H-002; si sigue abierto, este caso lo reproduce y lo deja documentado).
- **Cuota est.:** 1-3 llamadas.

### E2E-04 — Infra caída del reviewer → ask_human honesto + aceptar igual
- **Objetivo:** el fallo del servidor de modelos se maneja como freno de seguridad, no como bug (el caso vivido el 2026-09-03).
- **Pre:** ninguna (si el servidor anda bien, este caso se salta y se marca BLOQUEADO-buena-infra con nota).
- **Pasos UI:** 1) job trivial (reutilizar prompt E2E-01 con otra carpeta). 2) si el review falla con error de servidor: assert mensaje accionable ("no es de tu cambio", "aceptá igual o reintentá"), 0 findings inventados. 3) click "Aceptar igual" → `wait_for` `Complete`. 4) screenshot.
- **Disco:** `review.json` con `ask_human` + summary del error tÃ©cnico; evento de accept humano en timeline; `costSummary` con las llamadas intentadas (los intentos fallidos tambiÃ©n cuentan, es honesto).
- **PASS:** mensaje honesto + 0 findings + accept humano completa.
- **FAIL:** findings inventados sobre un review que nunca corriÃ³, o accept que no completa.
- **Cuota est.:** 3-8 llamadas (los reintentos cuentan).

### E2E-05 — Parser de intención fallback (reproduce H-001, estricto)
- **Objetivo:** el prompt carpeta+archivo NUNCA produce carpetas literales.
- **Pre:** worktree limpio de `demo-e2e*` (borrar restos de corridas anteriores a mano antes de arrancar).
- **Pasos UI:** 1) crear job E2E-01. 2) `wait_for` estado terminal. 3) screenshot del `createdFiles` mostrado.
- **Disco + filesystem:** existe `demo-e2e/leeme.txt` con 2 lÃ­neas afines al pedido; NO existe ninguna carpeta cuyo nombre contenga mÃ¡s de 3 palabras del prompt; `createdFiles` == rutas reales existentes (igualdad exacta, no "contiene").
- **PASS:** todo lo anterior, byte a byte.
- **FAIL:** cualquier carpeta literal o `createdFiles` con texto del prompt (H-001; adjuntar listing con timestamps).
- **Cuota est.:** 3-6 llamadas (combinable con E2E-01 en la misma corrida: mismo job vale para ambos).

### E2E-06 — Misma sesión en revise→rebuild (responde E2E v2.8)
- **Objetivo:** el rebuild continÃºa la conversaciÃ³n (Ola 16 viva).
- **Pre:** hace falta un `revise` natural (sale de E2E-02 o de rodaje; no se fuerza).
- **Pasos UI:** 1) ante un `revise`, `wait_for` segundo veredicto. 2) assert timeline: reutilizaciÃ³n de sesiÃ³n o evento `sesiÃ³n renovada (la anterior expirÃ³)` si el daemon se reiniciÃ³ en el medio. 3) screenshot.
- **Disco:** `agentSessions` del job con 1 sesiÃ³n por rol como mÃ¡ximo + evento de renovaciÃ³n si aplicÃ³.
- **PASS:** evidencia de continuidad en timeline + disco.
- **FAIL:** sesiÃ³n nueva silenciosa por turno sin evento (amnesia = la Ola 16 no estarÃ­a viva).
- **Cuota est.:** 0 extra (observacional sobre otro caso).

### E2E-07 — Reverify con evidencia (responde E2E v2.9)
- **Objetivo:** reviewer que duda → evento `reverify` con evidencia ANTES del veredicto final, todo dentro de 2 revisiones.
- **Pre:** observacional (no se fuerza; si no ocurre en la corrida, queda diferido).
- **Pasos UI:** assert timeline con `reverify: ejecutados N comando(s)` + bloque de evidencia en WorkItemList + veredicto final posterior.
- **Disco:** meta `reverify: {commands, evidence}` en el evento; `reviewCount` ≤ 2.
- **PASS/FAIL:** segÃºn lo observado; la ausencia del fenÃ³meno no es FAIL.
- **Cuota est.:** 0 extra.

### E2E-08 — Scorers + baseline + accept humano (desempata H-004)
- **Objetivo:** el loop de medida vive: jobs scoreados, baseline visible, accept humano que scorea (P0.3).
- **Pre:** ≥1 job en `Complete` (sale de E2E-01).
- **Pasos UI:** 1) abrir ScorersPanel: assert baseline con scores del job. 2) Si hay `ask_human` en otro job, "Aceptar igual" y verificar que tambiÃ©n deja scores. 3) screenshots.
- **Disco:** `scores.json` con entradas `{label, score, passing}`; si un job no tiene scores, verificar en el log del daemon si fue sampled-out (25%) o juez-caído (unscored) — el reporte del caso debe decir cuál fue, con evidencia.
- **PASS:** scores presentes + baseline + causa documentada de los ausentes.
- **FAIL:** hook de accept que no dispara (log sin intento) o scores mal etiquetados (passing que contradice el threshold actual).
- **Cuota est.:** 0-2 llamadas por job scoreado (juez). **Aviso:** si tras 4 accepts no hay scores, parar y escalar (cuota).

### E2E-09 — Auto-propuesta ante fails reales (rodaje, corrida larga)
- **Objetivo:** un scorer con `selfImprovement:true` genera propuesta sola ante 2 fails nuevos (E2E v2.10).
- **Pre:** solo en corrida de rodaje (no en la corrida estÃ¡ndar). Requiere 2+ jobs con fails genuinos del mismo scorer.
- **Pasos UI:** SelfImprovementPanel con propuesta en `ready` + notificaciÃ³n `proposal-ready` en la campana.
- **Disco:** `.proposals/*.json` con `Regressions addressed` linkeando runs; jamÃ¡s auto-adoptada.
- **PASS/FAIL:** segÃºn rodaje. No bloquea el cierre de la corrida estÃ¡ndar.
- **Cuota est.:** 10-25 llamadas. **Pide confirmaciÃ³n aparte.**

### E2E-10 — Definition roja → badge rojo → verde (el paso 7 vivido)
- **Objetivo:** degradaciÃ³n visible sin caÃ­da (E2E v2.11).
- **Pre:** ninguna (0 cuota, es lo mÃ¡s barato y lo mÃ¡s valioso).
- **Pasos:** 1) backup del scorer (`Copy-Item ...scorer.md ...scorer.md.bak`). 2) `samplingRate: 25` → `999`. 3) `node scripts/factory.mjs validate` → exit 1 con `file:line rule`. 4) UI: badge rojo con el error (hasta 30s o recargar). 5) crear job trivial → debe andar igual (fallback visible). 6) restaurar backup, validate exit 0, badge verde. 7) verificar que no quede `.bak`.
- **Disco:** nada persiste roto; el `.bak` no debe ser leído como definition (glob `*.md` no lo matchea — verificarlo).
- **PASS:** rojo CLI + rojo UI + flujo vivo + verde restaurado.
- **FAIL:** badge que no cambia, flujo caÃ­do con definition rota, o `.bak` colgado.
- **Cuota est.:** 0-5 llamadas (0 sin el paso 5).

### E2E-11 — Notificaciones de punta a punta + regresión campana (responde H-003)
- **Objetivo:** `ask_human` → campana + toast + ack limpia; panel legible en desktop y móvil.
- **Pre:** un job en `ask_human` (sale de E2E-04 o de rodaje).
- **Pasos UI:** 1) viewport 1280px: assert campana con contador, abrir panel, assert filas (kind, título, fecha, link al job) SIN corte ni overflow (screenshot a 1280 y a 375px). 2) toast OS si la ventana pierde foco (quitar foco 10s, volver). 3) Ack → contador en 0. 4) screenshots de los 3 momentos.
- **Disco:** `.notifications.json` con la entrada + `acked:true` tras el ack.
- **PASS:** contador, toast, ack y panel Ã­ntegro en ambos viewports.
- **FAIL:** panel cortado (H-003), toast duplicado por evento, o ack que no limpia.
- **Cuota est.:** 0 extra.

### E2E-12 — Aislamiento declarado (parametrizado por máquina)
- **Objetivo:** el badge dice la verdad en esta mÃ¡quina (E2E v2.7 parcial).
- **Pre:** saber si hay docker (`docker info`, timeout 5s, 1 intento).
- **Pasos UI:** en cualquier job con steps: assert badge (docker verde si hay daemon, `local Â· sin aislamiento` Ã¡mbar si no) + evidence con `isolation` (+ `isolationFallback` si aplicÃ³).
- **Disco:** steps con `isolation` correcta en ambos modos.
- **PASS:** badge == realidad de la mÃ¡quina.
- **FAIL:** badge docker sin docker, o job roto POR docker (el fallback fail-open lo prohÃ­be).
- **Cuota est.:** 0 extra.

### E2E-13 — Racha de costo (E2E v2.7)
- **Objetivo:** N jobs seguidos con `llmCalls>0` y badge visible (rodaje liviano, sale gratis de los demÃ¡s casos).
- **Pre:** ninguno (usa los jobs de la corrida).
- **PASS:** todos los jobs de la corrida con costo medido; si alguno marca 0 con LLM usado, es FAIL del contador.
- **Cuota est.:** 0 extra.

### E2E-14 — Puerta de salida (siempre último)
- **Objetivo:** nada de la corrida rompiÃ³ los contratos.
- **Pasos (terminal del usuario o agentes con timeout corto):** `npx tsc --noEmit` (0 errores), suites tocadas por los hallazgos en verde, pacts F01–F14 verdes.
- **PASS:** todo verde. **FAIL:** cualquier rojo (nace hallazgo P0 y la corrida no cierra).

---

## 4. Presupuesto de corrida estÃ¡ndar (E2E-01..08 + E2E-10..12, sin E2E-09)

| Caso | Cuota est. |
|------|-----------|
| E2E-01/05 (mismo job) | 3-6 |
| E2E-02 | 6-12 |
| E2E-03 | 1-3 |
| E2E-04 (si aplica) | 3-8 |
| E2E-08 | 0-8 |
| E2E-10 (+paso 5) | 0-5 |
| Resto | 0 |
| **Total** | **13-42 llamadas** |

Bajo el umbral de 50: la corrida estÃ¡ndar NO necesita confirmaciÃ³n extra. E2E-09 (rodaje) siempre pide confirmaciÃ³n aparte.

---

## 5. Cierre de corrida (obligatorio)

1. Tabla de veredictos por caso (PASS/FAIL/BLOQUEADO + job ids + `buildId`).
2. Hallazgos nuevos o reabiertos en `docs/E2E-HALLAZGOS.md` (1 entrada por hallazgo, con evidencia).
3. Reporte corto al usuario: quÃ© se probÃ³, quÃ© anda, quÃ© no, cuota gastada.
4. Memoria Engram (`session_summary` + saves de bugfix/discovery).

## 6. BitÃ¡cora de corridas (append-only)

- 2026-09-03 — Corrida 0 (manual, sin este plan): job-mtlx4ogw-gtc2 (review caído por infra → accept humano → Complete; costo 5 llamadas OK; doble escritura H-001), job-mtlxblzm-6vn3 (ambiguo → Triage sin preguntas H-002), campana cortada H-003, scores ausentes H-004, validate rojo/verde OK. Detalle en `E2E-HALLAZGOS.md` H-001..H-005.
- 2026-09-04 — Corrida 1 (autónoma QA, E2E-01→08, `buildId=15fece3e`, servidor sano, 12 llamadas LLM): E2E-01 PASS, E2E-05 FAIL (H-001 reproducido 2/2 + `createdFiles` ausente en job.json), E2E-02 PASS por equivalencia (sin revise; H-006 nuevo por fallback de revisor), E2E-03 FAIL (H-002 refinado: backend con 3 preguntas, UI sin render), E2E-04 BLOQUEADO-buena-infra, E2E-06/07 DIFERIDOS (sin fenómeno), E2E-08 PASS (hook sano, H-004 → mejora de visibilidad), E2E-13 PASS (5/5/2). H-003/H-005 no observados.
- 2026-09-04 — Fixes H-001+H-002+H-003+H-006 (E1 backend + E2 UI sin solape + 2 micro-fixes orquestador + QA PASS 518/518, tsc 0): H-001/H-002/H-003/H-006 → VERIFICADO (pendiente reverdecer vivo en corrida 2: E2E-05, E2E-03, E2E-11, E2E-02). Nota: scorer `review-formato-valido` restaurado a `samplingRate: 25` (estaba en 100 del E2E-10 manual) + `.bak` eliminado.
- 2026-09-04 — Corrida 2 (autónoma QA, E2E-01→08+E2E-11, `buildId=15fece3e`, 12 llamadas): E2E-01 BLOQUEADO-infra (review caído, mitad verde), E2E-05 PASS (H-001 REVERDECIDO vivo), E2E-02 PASS equivalencia (accept big-pickle 0.95; H-005 = flaky), E2E-03 PASS (H-002 REVERDECIDO full-loop: 4 preguntas → respond → Foreman), E2E-04 PASS, E2E-06/07 DIFERIDOS, E2E-08 PASS (sampled-out `shouldSampleJob`, hook sano), E2E-11 FAIL (H-003 REABIERTO: fixed sin clamp, clip izquierdo en ambos viewports), E2E-13 PASS (5/4/3). H-007 nuevo (P2 cosmético label de modelo). Jobs: job-mtm9mfbc-15ar, job-mtma1291-6qhl, job-mtma46zk-ma7c.
- 2026-09-04 — Fix clamp H-003 + label H-007 (1 ingeniero + QA 240/240, tsc 0; fetch de modelos diagnosticado-sin-fix) + H-008 (panel stale por `ensureResultJson` pobre → `result.json` enriquecido + `createdFiles` en GET single + suite 3/3). Corrida 3 (E2E-11+E2E-02, 5 llamadas): E2E-11 PASS (H-003 REVERDECIDO [8,328] ambos viewports + H-007 label vivo), E2E-02 PASS equivalencia (infra cayó de nuevo → accept igual; H-006 sin fenómeno), E2E-13 PASS (5). Job: job-mtmbdn0s-v8ua.
- 2026-09-04 — Corrida 4 (E2E-10+E2E-12+E2E-14, 0 llamadas LLM): E2E-10 PASS (CLI rojo `scorer.md:7 scorers-sampling-rate [error]` + badge rojo con texto exacto + flujo vivo + restauración byte-idéntica + badge verde, sin `.bak`), E2E-12 PASS con limitación (sin docker en la máquina; disco `isolation=none` OK; UI sin badges falsos; falta ver badge ámbar en job fresco), E2E-14 PASS (tsc 0 + 194/194 con pacts cubiertos; sin runner dedicado de pacts). Obs: UI lista 275 items pero el daemon no conoce jobs de test-orquestador (404 en sus links); app raíz `/` crashea fuera de Electron (preexistente, el Lab vive en `/factory-harness.html`).
- 2026-09-04 — Corrida 5 BLOQUEADA-infra (chrome huérfano PID 9552 de corrida 3 tomaba el browser MCP; 0 jobs, 0 cuota): liberado por orquestador con kill al PID exacto verificado como `mcp-chrome-*` (daemon intacto, buildId igual). Propuesta: infra-case "browser ocupado" en el plan + preferir `--isolated` si el MCP lo expone.
- 2026-09-04 — Corrida 6 (E2E-12+E2E-09+E2E-06/07/13, 4 llamadas): E2E-12 FAIL (badge docker VERDE honesto —docker realmente usado— pero setup `corepack enable` exit 127 en ubuntu:22.04 sin node + sin fail-open → Triage; H-009 nuevo REPRODUCIDO 2/2) + H-010 nuevo (escrituras laterales en Foreman con `createdFiles: []`, causa sin diagnosticar) + H-008 reabierto con matiz (`ensureResultJson` solo corre en Complete; el panel necesita fallback + result.json en setup-fail). E2E-09 DIFERIDO correcto (0 fails nuevos, 1 job bastó para repro). E2E-06/07 DIFERIDOS. E2E-13 parcial (2/2 llmCalls>0, no terminales). Jobs: job-mtmdu116-9u37, job-mtme2xav-tlhl.
- 2026-09-04 — Caída de terminal (daemon + orquestador muertos): recuperación por memoria Engram + disco (H-009 y setup-fail intactos y verdes; panel fallback existía sin suite; H-010 sin diagnosticar). Fix H-009 (imagen `node:22-bookworm` + fail-open 1 reintento con evento) + H-008 resto (panel full→partial→empty + result.json en setup-fail) + H-010 (causa: sesión MVP prompteaba `job.prompt` crudo → ping inocuo + allowlist read-only) + QA 262/262 tsc 0. H-008/H-010 → VERIFICADO-pendiente-vivo; H-009 pendiente E2E-12 vivo. Corrida 7 pendiente de `pnpm dev` del usuario.
- 2026-09-04 — H-011 (infra: `vite-plugin-electron` mata `pnpm dev` con `taskkill` a hijos ya muertos en cada restart; workaround = re-levantar a mano). Guard H-008 del orquestador (`isRichResultJson` + suite 3/3). Corrida 7 (E2E-12+E2E-09+E2E-06/07/13, 10 llamadas, daemon fresco): E2E-12 PASS (H-009 REVERDECIDO ambas mitades: pull node:22-bookworm → timeout pull → fail-open local con evento; job2 setup en docker 1991ms; H-008 REVERDECIDO panel full en Review; H-010 sigue VERIFICADO cero writes Foreman), E2E-09 DIFERIDO (0 fails nuevos), E2E-06/07 DIFERIDOS (reviews caídos por infra), E2E-13 PASS (5/5). Jobs: job-mtmgfb9j-2xl7, job-mtmgmg1i-osdr.
- 2026-09-04 - Rodaje de revises SIN-MORDIDA (6 jobs exigentes revrod-a1..f6, 28/50 llamadas, stop por condicion c): 0 revises porque el servidor cayo duro 8/8 (H-005 = del servidor: gemini-3-flash explicito falla identico). H-012 nuevo REPRODUCIDO 6/6 (fallback carpeta VACIA + changed 1 files + verification pass ciega; orquestador verifico archivos=0 en las 6). Olas 16/17 siguen sin estrenar en vivo.
- 2026-09-04 - Refactor ①+③ (spec arquitecto + E1 resultStore/jobView + E2 toolPolicy/yaml-tipo + remate C1-C3 + QA 466/466 tsc 0) + H-012 encima del punto de conciliación (stripEmptyFolderPlaceholder + anomalía archivo-ausente + changed honesto + Triage existente; suite 8/8 + QA PASS). H-012 → VERIFICADO-pendiente-vivo. Pendiente: `pnpm dev` del usuario + corrida con LLM sano.
- 2026-09-04 - Corrida 8 (E2E-01→08 + E2E-10→14, 16/50 llamadas): E2E-01 BLOQUEADO-infra (resto verde), E2E-05 FAIL → H-013 nuevo (verify-retry pass no reconcilia; H-001 core verde), E2E-02 PASS (accept directo + H-006 REVERDECIDO vivo), E2E-03 PASS (H-002 sigue verde), E2E-04 PASS, E2E-06/07 DIFERIDOS (0 revises), E2E-08 PASS (H-004 DESEMPATADO: sampled-out determinista → CERRADO), E2E-10 PASS, E2E-11 PASS, E2E-12 PASS con matiz, E2E-13 PASS (5/2/6/3), E2E-14 PASS (tsc 0 + 329/329), E2E-09 DIFERIDO (0 fails). Jobs: job-mtngz1t6-6vob, job-mtnh7s35-1uxb (+mtnh60ld, mtnhbw5d).
- _(siguientes acÃ¡)_
