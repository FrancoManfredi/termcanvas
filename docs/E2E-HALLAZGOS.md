# E2E — Hallazgos del Lab (bitácora viva del orquestador)
### Cada error que aparece corriendo E2E se anota acá, con evidencia, sin arreglar en caliente

> **Estado:** vigente desde 2026-09-03. Lo escribe el orquestador a medida que las corridas de `MASTER-PLAN-E2E.md` (y el uso manual) muestran errores.
> **Reglas que valen acá:** las 8 de los master plans + E1–E6 del plan E2E. En particular: evidencia sobre relato (job id + timestamps + archivos, o no pasó) y E3 (acá se anota, no se arregla).
> **Nota LAB:** severidad calibrada a lab (ver §0.3). Lo cosmético no frena corrida salvo que bloquee flujo.

---

## 0. Cómo se usa este archivo

### 0.1 Template de hallazgo (copiar para cada nuevo)

```markdown
## H-### — <título corto>
- **Fecha:** AAAA-MM-DD · **Origen:** E2E-XX o manual · **Estado:** ABIERTO | REPRODUCIDO | EN FIX | VERIFICADO | DIFERIDO
- **Severidad:** P0 (frena corrida / rompe contrato) | P1 (flujo degradado o bloqueado con workaround) | P2 (cosmético / lab)
- **Síntoma:** qué se vio, en criollo, 2-3 líneas.
- **Evidencia:** job ids, timestamps, rutas, comandos y salidas exactas.
- **Sospechosos:** archivos probables (rutas), sin acusar sin grep.
- **Hipótesis:** qué creemos que pasa (1-2, numeradas si hay más de una).
- **Fix propuesto:** idea de arreglo + qué test lo cubriría (se implementa en otro flujo, no acá).
```

### 0.2 Estados (flujo)

`ABIERTO` (visto 1 vez) → `REPRODUCIDO` (visto ≥2 veces o con repro determinístico) → `EN FIX` (hay flujo de arreglo) → `VERIFICADO` (el caso E2E que lo cubre da PASS). `DIFERIDO` solo con motivo escrito (ej. "requiere rodaje", "decisión de producto").

### 0.3 Severidad en clave LAB

P0 = la corrida no puede cerrar (contrato roto, loop sin cota, pérdida de datos). P1 = algo del sistema no anda pero hay workaround humano (aceptar igual, reintentar). P2 = cosmético o pulido de lab (no se arregla "porque queda lindo", solo si sobra ciclo o bloquea flujo — entonces sube a P1).

---

## H-001 — Fallback del implement crea carpeta literal con el texto del prompt (doble escritura)
- **Fecha:** 2026-09-03 · **Origen:** manual (corrida 0, paso trivial) · **Estado:** VERIFICADO (fix 2026-09-04, QA 518/518)
- **Severidad:** P1 (el lab sigue usable; el E2E-perfecto no cierra hasta arreglarlo)
- **Síntoma:** job trivial `Creá la carpeta demo-e2e con un archivo leeme.txt...` produjo DOS carpetas en el worktree: `demo-e2e` (correcta, con `leeme.txt` de 168 bytes) y `demo-e2e con un archivo leemetxt` (literal del prompt, VACÍA). El `createdFiles` del job registra solo la literal.
- **Evidencia:** job `job-mtlx4ogw-gtc2` (worktree `test-orquestador`, `buildId=15fece3e`). `implement:changed 1 files strategy=fallback duration=17371ms` (timeline t10, 16:30:36). En disco: `demo-e2e` CreationTime 16:29:25 (con `leeme.txt` 168B), `demo-e2e con un archivo leemetxt` CreationTime 16:30:36 (vacía, coincide con el fin del implement). `job.json` → `createdFiles: ["demo-e2e con un archivo leemetxt"]`. Caso E2E que lo cubre: E2E-05.
- **Sospechosos:** `headless-runtime/implement/minimalChange.ts` (parser de intención / estrategia fallback), `headless-runtime/implement/implementAgent.ts` (qué registra en `createdFiles`), `headless-runtime/implement/verification.ts` (dio `pass` con skips a una entrega con carpeta fantasma).
- **Hipótesis:** (1) el LLM creó lo correcto y el fallback corrió ADEMÁS creando la carpeta literal + el parser registró el prompt crudo en vez de las rutas reales; (2) el fallback parseó mal de cero y `demo-e2e/leeme.txt` vino de otro camino. La (1) es favorita por los timestamps (lo correcto a las 16:29, lo literal a las 16:30:36). Pendiente: reproducir con E2E-05 y mirar orden exacto de escrituras.
- **Fix propuesto:** fallback que jamás use texto del prompt como ruta (si no puede parsear intención → `needs_triage`/`ask_human` con la razón, no carpeta inventada) + `createdFiles` verificado contra disco (solo rutas existentes) + test con prompt carpeta+archivo que assert equality exacta. Cubre H2 de la Ola 6 (sigue vivo en este camino).
- **Fix aplicado 2026-09-04 (E2, QA PASS):** `stripFileClause` + `isUnconfidentFolderName` (residuo >3 palabras → null) en `minimalChange.ts`; sin parse → Triage directo sin correr implement (`implementService.ts`); `filterExistingCreatedFiles` con nota en timeline; `createdFiles` top-level aditivo en tipos/store/disk + expuesto en `toJSON` y GET list (micro-fix orquestador); verification ante fantasma/literal vacía → `fail` (jamás pass ciego). Suite `implement-fallback-literal` 8/8. Cambio de comportamiento visible: prompts de carpeta sin nombre extraíble (ej. "Creá una carpeta") ahora van a Triage en vez de crear `docs/implement-ola3-*.md`.
- **Reverdecido en vivo 2026-09-04 (corrida 2, E2E-05 PASS, job `job-mtm9mfbc-15ar`):** `strategy=llm`, `createdFiles: ["lab3-notas"]` top-level con igualdad exacta contra disco, cero carpeta literal. H-001 cerrado de verdad.
- **Repro corrida 1 (2026-09-04, `buildId=15fece3e`):** job `job-mtm7dk61-ez8n` (prompt `demo-e2e2/leeme.txt`): existe `demo-e2e2/leeme.txt` correcta Y `demo-e2e2 con un archivo leemetxt/` vacía; timeline `t10 strategy=fallback` con `meta.createdFiles: ["demo-e2e2 con un archivo leemetxt"]`; `job.json` SIN clave `createdFiles` (falla la igualdad exacta); la UI renderiza la ruta literal. Idem job `job-mtm7pndk-c4sc` (`e2e02-rev/` + `e2e02-rev con un archivo exactotxt/` vacía). Agrava: reviewer `accept` + verification `pass` ("skipped (folder exists)") a ciegas. Hipótesis (1) confirmada en el patrón (doble escritura sistemática, ya no es 1 caso).

## H-002 — Triage-humano sin preguntas ni forma de responder
- **Fecha:** 2026-09-03 · **Origen:** manual (corrida 0, job ambiguo) · **Estado:** VERIFICADO (fix UI+endpoint 2026-09-04, QA 518/518; el fallback sin preguntas con LLM caído sigue como mejora futura, no bloquea E2E-03 con LLM sano)
- **Severidad:** P1 (el ruteo a Triage anda; la interacción no existe)
- **Síntoma:** job `Mejorá algo del proyecto donde veas oportunidad` → `needs_triage` correcto (conf 0.86, razón sensata) pero la UI no muestra preguntas concretas ni ningún control para responder/derivar. Triage es hoy un estado terminal de solo lectura.
- **Evidencia:** job `job-mtlxblzm-6vn3`, decisión `needs_triage`, `openQuestions: []` (vacío). Agravante: el triage-agent LLM estaba caído (mismo `UnknownError` del servidor de modelos que H-005) y cayó al fallback del foreman sin preguntas. Caso E2E que lo cubre: E2E-03.
- **Sospechosos:** `headless-runtime/triage/*` (findings/`openQuestions` vacíos en fallback), `headless-runtime/foreman/foreman.ts` (fallback sin preguntas), UI del panel de Triage (sin render de preguntas ni endpoint de respuesta — verificar si existe endpoint para responder).
- **Hipótesis:** (1) el fallback foreman nunca genera `openQuestions` (solo razón); (2) aunque existieran, la UI no las renderiza ni hay endpoint para contestar y reanudar. Ambas pueden ser ciertas a la vez.
- **Fix propuesto:** fallback que derive 2-3 preguntas genéricas útiles (qué parte / con qué objetivo / con qué criterio) + endpoint `POST /:id/triage/respond` + UI mínima + test E2E-03 en verde. Si hay endpoint existente, el fix es solo UI.
- **Fix aplicado 2026-09-04 (E2, QA PASS):** `TriageQuestions.tsx` (preguntas + Responder/Derivar, visible sin expandir) + `POST /factory/jobs/:id/triage/respond` (nuevo, reutiliza Triage→Foreman existente; Derivar reusa POST /cancel) + `readCreatedFiles` top-level-first. Suite `triage-questions-ui` 17/17.
- **Reverdecido en vivo 2026-09-04 (corrida 2, E2E-03 PASS, job `job-mtma46zk-ma7c`):** 4 preguntas visibles sin expandir + inputs + ambos botones; respuesta a Q1 → evento `triage respond (1 respuestas)` → job avanzó a Foreman (luego cancelado controlado para no quemar cuota). Full-loop confirmado.
- **Refinamiento corrida 1 (2026-09-04, job `job-mtm7uuhe-o5aw`, LLM sano):** el backend SÍ genera `openQuestions` con 3 preguntas concretas (área / criterio / restricciones) — la mitad del fix ya anda y la hipótesis del fallback vacío queda descartada con LLM sano. La UI sigue mostrando solo reason/confidence, cero preguntas y cero control de respuesta. Pendiente: solo UI (+ endpoint de respuesta si no existe).

## H-003 — Panel de la campana cortado a mitad de pantalla
- **Fecha:** 2026-09-03 · **Origen:** manual (corrida 0, click en campana) · **Estado:** VERIFICADO (clamp verificado en vivo en corrida 3, 1280 + 375)
- **Severidad:** P1 en lab (tapa la puerta a los `ask_human`)
- **Síntoma:** al clickear la campana, el panel se corta a mitad de pantalla y no se puede leer completo. Se alcanzó a ver la notificación de `ask_human` y el botón de ack (el ack anda).
- **Evidencia:** viewport del usuario (ancho habitual desktop); sin screenshot (corrida manual). Caso E2E que lo cubre: E2E-11 (screenshots 1280px + 375px obligatorios).
- **Sospechosos:** `src/features/factoryLab/components/NotificationsBell.tsx` (posicionamiento/overflow del panel, contenedor padre con `overflow-hidden`?).
- **Hipótesis:** (1) el panel es `absolute` dentro de un contenedor con overflow que lo recorta; (2) falta `max-height` + scroll interno + `z-index`.
- **Fix propuesto:** panel con `max-height` + scroll + posicionamiento que no dependa del overflow del padre + test E2E-11 con asserts de visibilidad total en 2 viewports.
- **Fix aplicado 2026-09-04 (E2, QA PASS):** causa exacta = `absolute` dentro de dos ancestros `overflow-hidden` (App root + main del Lab). Panel `fixed` posicionado por `getBoundingClientRect` + `max-h-[min(70vh,400px)]` + `overflow-auto` + `z-[100]` + ancho responsive. Guards estáticos en suite (el panel no se monta en tests).
- **Reapertura 2026-09-04 (corrida 2, E2E-11 FAIL, notif `n-1788484834676-63`):** el `fixed` se alinea a la derecha de la campana SIN clamp de viewport; campana en x≈167 < 320px de ancho → clip izquierdo (@1280px x=-130, @375px x=-175, re-medido). Screenshots en ambos viewports. Verde: contador, filas, links y Ack andan (62→61, `acked:true` en disco). Lección: los guards unitarios no montan el panel — el posicionamiento real solo se ve en vivo. Fix propuesto: `left = max(rect.right - width, 8)` + `max-width: min(320px, calc(100vw - 16px))` + caso E2E-11 en verde.
- **Fix clamp 2026-09-04 (QA 240/240):** `left = max(8, rect.right - width)` + `width = min(320, vw-16)` + flip vertical + consts espejadas en CSS; verificación numérica independiente [8,328] en ambos viewports.
- **Reverdecido en vivo 2026-09-04 (corrida 3, E2E-11 PASS):** panel `[8,328]` íntegro medido en 1280 y 375 + screenshots; Ack 61→60 con `acked:true` en disco.

## H-004 — Sin scores tras "Aceptar igual" (a desempatar)
- **Fecha:** 2026-09-03 · **Origen:** manual (corrida 0, accept humano de job-mtlx4ogw-gtc2) · **Estado:** ABIERTO
- **Severidad:** P1 si es hook roto; no-severidad si es sampling (a desempatar)
- **Síntoma:** tras el accept humano → Complete, no hay `scores.json` en el worktree ni en `factory/.scores/`.
- **Evidencia:** job `job-mtlx4ogw-gtc2`, evento `humano acepta igual (POST /review/accept)` 16:33:21; glob `scores.json` vacío en worktree y repo. Caso E2E que lo cubre: E2E-08.
- **Sospechosos:** hook P0.3 en `factoryServer.ts` (¿disparó?), sampler 25% (¿lo dejó afuera por diseño?), juez LLM (¿murió con el `UnknownError` de H-005 → `unscored` que no persiste?).
- **Hipótesis:** (1) favorita: sampled-out determinístico (3 de cada 4 jobs no se scorean, por diseño tal cual Warp); (2) el hook disparó pero el juez cayó con el servidor de modelos. Desempate: buscar `autoScore`/`score` en el log del daemon para ese job, o 2-3 accepts más (≈1 de cada 4 scorea).
- **Fix propuesto:** ninguno hasta desempatar. Si es (1): documentar en UI que "sin score = fuera de muestra" (evita este susto a futuro). Si es (2): el `unscored` por juez caído debería dejar traza visible (hoy es indistinguible del sampling).
- **Aporte corrida 1 (2026-09-04, E2E-08 PASS):** el hook SÍ dispara (eventos `score review-formato-valido=valido/passing` e `=infra-formato (failing)` en timelines, ambos `scores.json` con `{label, score, passing}`, baseline `50% (1/2)`). Job de Triage sin scores = por diseño (nunca llegó a review; el panel lo dice). Conclusión: hook sano; la ausencia de corrida 0 apunta a sampling-25% de otros scorers o juez caído entonces. H-004 queda como mejora de visibilidad (trazar sampled-out vs unscored), no como bug del hook.
- **DESEMPATADO 2026-09-04 (corrida 8, E2E-08 PASS):** `scores.json` con 2 entries `{label,score,passing}` + hashes FNV-1a calculados (job1 OUT 56, job2 IN 9, rate 25) = sampled-out determinista, NO juez-caído. **H-004 → CERRADO** (era visibilidad del sampling por diseño; la mejora de traza queda como P2 opcional, no como hallazgo abierto).

## H-005 — Servidor de modelos inestable (`UnknownError` en review/triage/spec, foreman OK)
- **Fecha:** 2026-09-03 · **Origen:** manual (corrida 0) · **Estado:** ABIERTO
- **Severidad:** INFRA (no es bug del Factory; se anota porque condiciona las corridas)
- **Síntoma:** `review prompt fallo (20000ms+retry): {"name":"UnknownError","data":{"message":"Unexpected server error...","ref":"err_e37cf327"}}`. Triage y spec LLM también caídos (fallbacks honestos con la razón visible). Foreman con el MISMO modelo sí responde. Patrón: prompts grandes (review con skills, triage) mueren, prompts chicos viven.
- **Evidencia:** jobs job-mtlx4ogw-gtc2 (t14/t15: 2 intentos de review contados en costo), job-mtlxblzm-6vn3 (`triage LLM no disponible, defiere al foreman`). Revisores: `opencode-go/muse-spark-1.3-contributor`.
- **Sospechosos:** ninguno del repo (servidor opencode local / proveedor). Del lado Factory solo verificar que el conteo de intentos fallidos en costo y los fallbacks sean los diseñados (lo son: t14/t15 cuentan 2 intentos, mensajes accionables).
- **Hipótesis:** (1) el server local se ahoga con prompts grandes; (2) flake del proveedor. Probar con otro `reviewerRef`/modelo si hay cuota, o reintentar en otro momento.
- **Fix propuesto:** ninguno en código. Acción: reintentar E2E-02/E2E-06 cuando el servidor esté sano; si persiste, escalar a cambio de modelo default (decisión del usuario, tradeoff cuota).
- **Dato corrida 2 (2026-09-04):** H-005 es flaky intermitente, no caída dura — el mismo revisor (big-pickle) falló 22:20 y aceptó 22:31. Condiciona corridas (E2E-01 → BLOQUEADO-infra, E2E-04 → PASS) pero el sistema lo maneja honesto en ambos caminos.
- **Dato rodaje (2026-09-04):** racha dura 8/8 fallos + `gemini-3-flash` explícito falla idéntico → H-005 es del SERVIDOR, no del modelo. La acción "probar otro reviewerRef" queda ensayada con resultado negativo.

## H-007 — Botón de modelo con provider+modelo concatenados + "Failed to fetch" (cosmético)
- **Fecha:** 2026-09-04 · **Origen:** corrida 2 · **Estado:** VERIFICADO-parcial (label verificado en vivo en corrida 3; fetch diagnosticado-sin-fix por diseño)
- **Severidad:** P2 (cosmético de lab, no bloquea flujo)
- **Síntoma:** el botón de modelo renderiza `muse-spark-1.2-contributoropencode-go` (concatenados sin separador) + aviso `Failed to fetch — usando lista mínima`.
- **Evidencia:** snapshot corrida 2 (sin job id asociado; es del header del Lab).
- **Sospechosos:** componente del selector de modelo en `src/features/factoryLab/` (formato del label + fetch de la lista de modelos con fallback).
- **Hipótesis:** (1) template del label sin separador; (2) el endpoint de modelos no responde desde el browser (¿puerto? ¿ruta?) y cae al fallback mínimo.
- **Fix propuesto:** separador en el label + revisar por qué falla el fetch (si es el puerto por discovery, 1 línea). Caso E2E: assert del label en E2E-11 o nuevo.
- **Fix label 2026-09-04 (QA 240/240):** formato `modelo (provider)` en `ModelCombobox.tsx` + guard. **Fetch diagnosticado-sin-fix:** opencode server 4096 caído (ambiental) y el daemon no expone `/provider` por diseño (404 esperado, no bug); exponerlo sería feature nueva. Fallback mínimo honesto, se deja.
- **Verificado en vivo 2026-09-04 (corrida 3, E2E-11):** label `muse-spark-1.2-contributor (opencode-go)` + banner honesto de lista mínima.

## H-013 — Verify-retry pass no reconcilia `createdFiles` (Complete con entrega sin trackear)
- **Fecha:** 2026-09-04 · **Origen:** corrida 8, E2E-05 FAIL · **Estado:** VERIFICADO (fix + QA PASS 397/397; pendiente reverdecer en vivo con late-write)
- **Severidad:** P1 (el job termina Complete con `createdFiles: []` y el archivo correcto en disco: éxito sin trackear)
- **Síntoma:** fallback → carpeta vacía → H-012 fail honesto → sesión async escribe el archivo 2s DESPUÉS → verify-retry `pass` → `accept` → nadie reconcilia: `createdFiles: []` en `job.json` y `result.json` con el archivo existiendo.
- **Evidencia:** `job-mtngz1t6-6vob` (`lab8c-notas/leeme.txt` 113B correcto, 18:33:04Z vs verify 18:33:02Z) y `job-mtnh7s35-1uxb` (`lab8e-rev/dato.txt` 18:40:10Z); finding f1-info del propio reviewer lo confirma. H-001 core verde (cero literal, nada del prompt en metadata).
- **Causa probable:** el camino verify-retry→pass no pasa por el punto único de conciliación (`reconcileCreatedFiles` corre en `transitionWithVerification`, no en el reintento). El late-write (sesión async tardía) + retry que no reconcilia = entrega fantasma.
- **Sospechosos:** camino verify-retry en `implementService.ts`/`factory/verify/verifyService.ts` (reintento que no reconcilia), punto de conciliación no invocado tras retry.
- **Fix propuesto:** verify-retry pass → reconciliar contra disco (mismo punto único) antes de seguir a Review/accept + test con late-write mockeado; si el retry no puede reconciliar por diseño, que no dé `pass` sino estado parcial honesto.
 - **Fix aplicado 2026-09-04 (causa corregida, QA PASS):** NO era que el retry salteara el punto único (sí pasa por él): era input stale + filtro solo-conserva (leía `prevCreatedFiles=[]` y el late-write jamás entraba). Ahora `resolveVerifyRetryCreatedFiles` (prev + tardías descubiertas vía rutas pedidas que existen; sin archivo pedido no propone ni carpeta) corre ANTES de persistir (kept en result.json + verify.json + transición + nota `reconciledLateFiles`). Decisión: en el reintento, no en accept. Suite `verify-retry-reconcile` 7/7.
 - **F5-T3 offline re-check 2026-09-05 (E2, daemon live `buildId=15fece3e == HEAD`, zero daemon traffic in suites):** `verify-retry-reconcile` 7/7 green + new offline late-write matrix `tests/e2e-f5-teeth.asserts.ts` 9/9 green (M1 late discovered+kept+cited, M2 still-empty stays H-012 fail, M3 no dup, M4 no invention, M5 prompt-aware drop with legacy intact, bundle PASS plus ghost/literal/on-time FAIL shapes). Live re-green (E2E-05 late-write PASS with the `reconciledLateFiles` note on disk) stays owned by F5-T1 — NOT claimed here.

## H-012 — Fallback crea carpeta VACÍA + verification da `pass` (sistemático 6/6 con servidor caído)
- **Fecha:** 2026-09-04 · **Origen:** rodaje de revises · **Estado:** VERIFICADO (fix + QA PASS; pendiente reverdecer en vivo con LLM sano)
- **Severidad:** P0 lab (con el servidor de modelos caído, TODO implement cae a este camino: entrega vacía con `pass`)
- **Síntoma:** los 6 jobs `revrod-*` existen como carpetas VACÍAS (verificado por orquestador: `archivos=0` en las 6) aunque el timeline dice `implement:changed 1 files strategy=fallback duration=2ms` + `verification passed → Review`. El LLM del implement nunca corrió (2ms = fallback inmediato).
- **Evidencia:** jobs `job-mtmhfu5t-fcax`, `job-mtmhmski-3dao`, `job-mtmhsidu-rbze`, `job-mtmhwdqg-7ay2`, `job-mtmi18y2-p8gy`, `job-mtmi30u5-kq8j` (worktree Temp/opencode, nombres jamás usados); 8/8 intentos de review fallidos (`UnknownError` + retry 20s, refs `err_01e1a7b5`…; gemini-3-flash falla idéntico → H-005 es del servidor, no del modelo); 0 accepts dados (cambio nunca verificado, correcto no aceptar).
- **Causa probable (a confirmar en fix):** el fallback parsea la carpeta con confianza (nombre exacto, no literal → no dispara el guard H-001), crea la carpeta pero NUNCA el archivo (ese era trabajo del LLM caído), reporta `changed 1 files`, y el detector de anomalías no lo caza porque solo mira fantasma/literal-vacía, no "archivo pedido ausente". Cadena completa con infra caída: implement-LLM down → fallback Carpeta-vacía → verification ciega → review down → ask_human honesto (lo único que anduvo bien).
- **Sospechosos:** `minimalChange.ts` (fallback sin archivo), `verification.ts` (pass con carpeta vacía sin chequear el archivo pedido), `implementService.ts` (no distingue LLM-caído de éxito-parcial).
- **Fix propuesto:** fallback que no crea el archivo pedido → Triage/fail honesto (no `changed 1`); verification que exige el ARCHIVO pedido en disco, no la carpeta; test con servidor mockeado-caído de punta a punta. Caso E2E: el propio rodaje (debe dar revises o Triage honestos, jamás pass vacío).
- **Fix aplicado 2026-09-04 (encima del refactor ①, QA PASS):** `stripEmptyFolderPlaceholder` (carpetas vacías fuera del conteo solo con archivo pedido ausente) + `detectCreatedFilesAnomaly` con rama H-012 (carpeta existe + archivo ausente → fail, también con `kept=[]`) + `reconcileCreatedFiles` con `prompt?` opcional + conteo honesto (`changed 0`) + cero-kept → Triage por camino existente (sin transiciones nuevas). Suite `empty-folder-fallback` 8/8.
 - **F5-T3 offline re-check 2026-09-05 (E2):** `empty-folder-fallback` 8/8 green + `implement-fallback-literal` 8/8 green (H-001 no-regression) + teeth matrix M2/M5 green (empty folder → zero kept → honest H-012 fail). Live re-green (empty-folder→fail observed with healthy LLM, or honestly absent) stays owned by F5-T1 — NOT claimed here.

## H-011 — `pnpm dev` se cae por `taskkill` en restart de Electron (infra dev-tooling)
- **Fecha:** 2026-09-04 · **Origen:** reporte del usuario con stack · **Estado:** CERRADO como WORKAROUND-DOCUMENTED (veredicto F5-T3 2026-09-05, sin fix en config)
- **Severidad:** INFRA P1 para el workflow del lab (mata dev + daemon juntos; no es bug del Factory)
- **Síntoma:** al guardar cambios (cada implement de agentes), vite reinicia Electron y `vite-plugin-electron@0.29.1` (`treeKillSync`, `dist/index.mjs:147`) corre `taskkill /pid <PID> /T /F` contra hijos YA muertos → `No hay ninguna instancia activa` → status 255 → `ELIFECYCLE Command failed` → muere todo `pnpm dev` (y con él el daemon 17680).
- **Evidencia:** stack del usuario (`treeKillSync` → `startup.exit` → `startup`, Node 20.20.2). Config del repo: `vite.config.ts:134-154` usa el plugin con defaults (sin overrides de restart) → aplica el comportamiento default con la race de Windows.
- **Hipótesis:** race clásica: el hijo de Electron ya exiteó cuando el plugin intenta matarlo; el plugin no tolera el "ya muerto" y la excepción tumba el proceso vite.
 - **Fix propuesto:** ninguno todavía (está en `node_modules`, no se toca). Opciones a evaluar: override de restart/exit del plugin en `vite.config.ts` si la versión lo soporta, o separar el daemon del `pnpm dev` (volver al standalone vía `factory.mjs`, que ya lanza vía WMI fuera del job). Workaround vigente: re-levantar `pnpm dev` a mano y seguir.
 - **Veredicto F5-T3 2026-09-05 (E2, investigación cerrada):** `vite-plugin-electron@0.29.1` does NOT support restart/exit overrides — `ElectronOptions` is exactly `{ entry, vite, onstart }` (`node_modules/vite-plugin-electron/dist/index.d.ts:4-28`); `startup.exit` unconditionally calls `treeKillSync` → `taskkill /pid <PID> /T /F` with zero already-dead tolerance (`dist/index.mjs:145-151,291-299`). No version-supported hook exists to override; monkey-patching the imported `startup` is NOT a supported API. Per PLAN-100 §5-assumption-7: `vite.config.ts` left UNTOUCHED by F5-T3 (zero config lines changed for H-011).
 - **Modo soportado (standalone, documentado):** lab daemon via `node scripts/factory.mjs status|validate` (detached process, outside `pnpm dev`/Electron) + health gate `/factory/health buildId == HEAD`. Verificado en vivo 2026-09-05: `buildId=15fece3e == HEAD`, `validate` exit 0, opencode healthy. Re-levantar `pnpm dev` a mano queda como procedimiento con el daemon a salvo, no como fix.

## H-009 — `linux-build` roto bajo docker: setup `corepack enable` exit 127 + sin fail-open a local
- **Fecha:** 2026-09-04 · **Origen:** corrida 6, E2E-12 · **Estado:** VERIFICADO (fix + reverdecido en vivo en corrida 7, ambas mitades)
- **Severidad:** P0 lab (con docker corriendo, TODO job a linux-build muere en setup; el runner docker queda inutilizable)
- **Síntoma:** con docker 28.0.4 corriendo, el job usa docker de verdad (pull `ubuntu:22.04` OK, badge verde honesto) pero el setup `corepack enable` falla con exit 127 (`sh: 1: corepack: not found` — ubuntu:22.04 no trae node). No aparece ningún `isolationFallback` a local pese al diseño probe+fail-open; el job cae a Triage/queued.
- **Evidencia:** jobs `job-mtmdu116-9u37` (`lab6-dock`, 03:16:29→setup fail 03:17:36) y `job-mtme2xav-tlhl` (`lab6-e9a`, mismo fallo ~2 min después con imagen cacheada); `verify.json` con `overall fail`; `logs/build.log` con pull OK + exit 127 en 9233ms; `isolation:"docker"` sin fallback en timeline ni disco. Caso E2E-12 FAIL por esto (el badge PASSA).
- **Sospechosos:** `factory/runners/linux-build.yaml` (imagen sin node), setup/probe/fallback en `headless-runtime/runner/*` (el fail-open cubre docker-no-disponible pero NO fallo de comando DENTRO de docker).
- **Hipótesis:** (1) la imagen debería ser `node:22-bookworm` (trae node+corepack) en vez de `ubuntu:22.04`; (2) el fallo de setup debería hacer fail-open a local con evento `isolationFallback` en vez de Triage-varado. Ambas pueden aplicar (imagen correcta + fail-open real ante setup-roto).
- **Fix propuesto:** imagen con node + setup-roto → fail-open a local con evento (no Triage silencioso) + test E2E-12 en verde. Cuidado loop: responder un Triage de setup-fail y re-dispatchar al mismo setup roto quemaría cuota en ciclos — el fail-open lo rompe de raíz.
- **Reverdecido en vivo 2026-09-04 (corrida 7, E2E-12 PASS, job `job-mtmgfb9j-2xl7`):** pull real de `node:22-bookworm` intentado → timeout 15s durante el pull → 1 reintento local con evento `isolationFallback` → `corepack enable` exit 0 (badge ámbar honesto). Job 2 probó la otra mitad: setup DENTRO de docker con imagen cacheada (1991ms, `isolation:"docker"`). Observación menor: labels `ubuntu:22.04` stales en logs/header/perfil (cosmético) + `shared/types/runner.ts:21` con `z.literal("ubuntu:22.04")` contradice el yaml (limpieza sugerida, path vivo usa el loader).

## H-010 — Escrituras laterales al worktree fuera del runner (`createdFiles: []` con archivos reales)
- **Fecha:** 2026-09-04 · **Origen:** corrida 6, E2E-12 · **Estado:** VERIFICADO (fix + QA 262/262; pendiente ver E2E-12 sin escrituras laterales en vivo)
- **Severidad:** P1 (UI/disco divergen: éxito en disco, fail en sistema, archivos sin trackear)
- **Síntoma:** `lab6-dock/nota.txt` (03:17:02Z) y `lab6-e9a/ficha.txt` (03:17:39Z) aparecieron en el worktree DURANTE fase Foreman (antes del `worker picked` 03:17:26), con el contenido exacto pedido; el job reporta `createdFiles: []` + veredicto fail.
- **Evidencia:** timestamps de filesystem vs `worker picked job` del timeline en ambos jobs; contenido exacto del prompt en archivos correctos.
- **Sospechosos:** sesión opencode del foreman (¿tiene tools de escritura y las usa?), `implementAgent` temprano, o el propio harness de prueba. SIN diagnóstico todavía.
- **Hipótesis:** (1) la sesión del foreman escribe con sus tools directo al worktree; (2) otro agente/path escribe fuera del runner. Requiere diagnóstico con evidencia (qué sesión, qué tool-call, qué timestamp) ANTES de cualquier fix.
- **Fix propuesto:** ninguno hasta el diagnóstico. Opciones según causa: prohibir escritura fuera del runner, o conciliar `createdFiles` contra disco al cerrar.
- **Fix aplicado 2026-09-04 (QA 262/262):** causa confirmada = sesión MVP de ingesta (`tryCreateOpencodeSession` prompteaba `job.prompt` crudo con cwd=worktree; foreman exonerado: `tools: {}` + nace después del archivo). Ahora el prompt MVP es ping inocuo `sesión de seguimiento del job <id> lista — sin acción requerida` en las 7 variantes + allowlist `{read,glob,grep}` donde el shape lo admite (variante C sin slot: solo ping). Suite `mvp-prompt-inocuo` 10/10. Carry-over: `tools:{}` en `foreman.ts` e `interview/harness` si el foreman se confirma segundo escritor.
- **Sigue VERIFICADO en corrida 7 (2026-09-04):** cero escrituras en fase Foreman en ambos jobs (auditoría por timestamps; sesión creada 04:29:16Z, logs limpios). Observación menor (no reapertura): en job 1 el archivo llegó en fase Review por sesión async tardía (self-healed, contenido correcto) — la verificación trivial solo mira la carpeta, timing ciego documentado.

## H-008 — `result.json` reescrito pobre en cada persist (VerificationPanel stale)
- **Fecha:** 2026-09-04 · **Origen:** corrida 3, observación QA · **Estado:** VERIFICADO (panel + guard + reverdecido en vivo en corrida 7)
- **Severidad:** P1 lab (el panel de verificación mentía "pendiente / CreatedFiles (0)" con verificación pasada)
- **Síntoma:** `VerificationPanel` mostró `pendiente / CreatedFiles (0)` para un job con `verification passed` en timeline. En disco, su `result.json` tenía forma pobre (sin `verification` ni `createdFiles`).
- **Evidencia:** job `job-mtmbdn0s-v8ua`, `result.json` con keys `jobId,phase,worktree,status,state,promptPreview,artifacts,createdAt,updatedAt,timeline,cost,runnerId,summary` (sin `verification`/`createdFiles`).
- **Causa raíz (1ª parte, fixeada):** `ensureResultJson` (`workItemDisk.ts`) reescribe `result.json` en CADA persist con forma pobre, pisando el archivo rico del `ResultWriter`.
- **Causa raíz (2ª parte, hallada en corrida 6):** `ensureResultJson` solo corre con status `Complete` (`workItemDisk.ts:86,170`); en jobs NO-terminales nunca hay `result.json` por diseño, y el panel SOLO lee ese archivo. Job `job-mtmdu116-9u37` (Triage por setup-fail): tiene `verify.json` + timeline con evidence, pero el panel muestra "Sin result.json todavía". Además el path de setup-fail de `implementService` no escribe `result.json` (sí escribe `verify.json`).
- **Fix aplicado (parte 1, suite 3/3):** `ensureResultJson` enriquecido + `createdFiles` en GET single.
- **Fix pendiente (parte 2):** panel con fallback a `verify.json` + timeline de `job.json` (mostrar "parcial" honesto) + `implementService` que escriba `result.json` también en el path de setup-fail.
- **Fix aplicado (parte 2, QA 262/262):** panel con `resolveVerificationView` (full→partial→empty) consumiendo GET `/verify` + timeline; `implementService` escribe `result.json` con evidence también en setup-fail. Suites `verification-panel-fallback` 7/7 + `verification-partial-fallback` 6/6. Pendiente solo ver en vivo (próxima corrida con daemon).
- **Guard aplicado 2026-09-04 (orquestador, suite 3/3):** `writeJobJson` ya NO borra `result.json` rico (predicado puro exportado `isRichResultJson`: conserva si hay clave `verification`; pobre/ausente/corrupto se sigue borrando). Sin esto, el fix de setup-fail no persistía en producción. Suite `writejobjson-result-guard` 3/3.
- **Reverdecido en vivo 2026-09-04 (corrida 7, job `job-mtmgfb9j-2xl7`):** `result.json` rico (`verification` 3 steps + `createdFiles`) ya en estado Review + panel en vista full con datos reales. El guard sobrevivió persists posteriores.

## H-006 — Revisor fallback igual al builder → ask_human sin gastar LLM (con servidor sano)
- **Fecha:** 2026-09-04 · **Origen:** corrida 1, E2E-02 · **Estado:** REVERDECIDO en vivo (corrida 8: review automático real disjunto muse-spark→big-pickle con `accept`, sin par fallback)
- **Severidad:** P1 (honesto pero frena el flujo automático sin causa de infra)
- **Síntoma:** con el servidor de modelos sano, el review cayó a `ask_human` con summary "revisor fallback igual al builder … sin gastar LLM" y 0 findings, mientras el badge UI decía `revisor: opencode/big-pickle` — contradicción entre selector y ejecutor a desempatar.
- **Evidencia:** job `job-mtm7pndk-c4sc`, review intento 1, `reviewCount: 1`, `llmCalls: 5` del job; "Aceptar igual" → Complete con archivo byte-exacto. Caso E2E que lo cubre: E2E-02 (necesita un caso que fuerce revise para ver si el fallback también muerde ahí).
- **Sospechosos:** `headless-runtime/review/reviewModelSelector.ts` (selector disjunto builder≠reviewer), `headless-runtime/review/reviewAgent.ts` (detección de "igual al builder"), `headless-runtime/review/reviewService.ts` (rama fallback).
- **Hipótesis:** (1) el selector eligió big-pickle pero el builder también lo era y el guard anti-auto-review lo volteó a fallback sin registrar bien la causa; (2) el fallback dispara por otra razón (cuota/modelo) y el mensaje miente. Desempate: leer el summary exacto + el par builder/reviewer del job en disco.
- **Fix propuesto:** mensaje que diga la causa exacta (mismo modelo / cuota / error) + test del selector disjunto con este par + E2E-02 en verde con review automático real.
- **Fix aplicado 2026-09-04 (E1, QA PASS):** causa desempatada del job real = selector eligió bien (muse-spark→big-pickle) pero el primario falló y su fallback inverso colisionó con el builder; el mensaje nombraba al fallback y el badge al primario. Ahora `fallbackFor` es builder-aware (disjunto de ambos; el caso da `openai/gpt-4o`) + mensaje que arranca con el primario y cita la causa del error primario (antes descartada). Suite `review-selector-fallback` 5/5.
- **Corrida 2 (2026-09-04):** sin fenómeno (revisor real ≠ builder en ambos jobs; E2E-04 mostró mensaje con primario+causa). H-006 sigue VERIFICADO-pendiente-vivo: falta ver un review automático real con este par.
