# PRD — Playground de Validación v2 (software-testing-playground-v2)

> **Reconstrucción desde cero** del sistema que valida cada feature `F01, F02, F03...` antes de integrarla a Factory. Este PRD describe **solo el playground** — no la Factory en sí — como input directo para el arquitecto (Gao).

---

## 1. Información del proyecto

| Campo | Valor |
|---|---|
| **Idioma** | Español rioplatense (esta es la lengua del PRD y de la respuesta) |
| **Lenguaje / Stack** | TypeScript + Electron + Vite + React + Tailwind CSS + Node `http` (daemon Factory). MUI opcional solo si aporta al playground. Scripts de verificación en `.mjs` con `node` nativo. |
| **Project Name** | `software_testing_playground_v2` |
| **Ubicación del PRD** | `software-testing-playground-v2/docs/prd-playground-v2.md` |
| **Estado** | Borrador para revisión de arquitectura |

### Demanda original (reescrita)

Reconstruir desde cero el playground de testing que valida cada feature `F` de Factory. El playground anterior fallaba porque: adelantaba resultados de fases posteriores (F02 mostraba `done` cuando solo debía validar `queued`), simulaba ejecuciones sin ejecutor real, mezclaba estados simulados con reales sin distinción visual, no versionaba criterios, no tenía trazabilidad (commit, humano vs script, output crudo vs veredicto) ni manejo de flaky. Hoy ya existe infra real — puerto `17680-17690`, `GET /factory/health`, `POST /factory/jobs`, `GET /factory/jobs/:id`, SSE `GET /factory/jobs/:id/events`, artefactos en disco `job.json / prompt.md / logs.ndjson / result.json / .done` — sobre la que debe montarse el nuevo playground cumpliendo 7 reglas no negociables.

### Entorno mandatorio

- **Windows únicamente.** Todos los ejemplos, scripts y docs usan **PowerShell** con `Invoke-RestMethod` o `curl.exe` (con `.exe` explícito). Nunca `curl` a secas (es alias a `Invoke-WebRequest` y rompe JSON), nunca comandos bash (`ls`, `cat`, `grep`, `tail -f`). Equivalente correcto: `Get-Content ... -Wait`, `Get-ChildItem`, `Select-String`.
- Puerto Factory: `17680` por defecto, fallback secuencial hasta `17690` si está ocupado. El playground debe descubrir el puerto vía archivo `factory-port` o `GET /factory/health` en rango, no hardcodear solo `17680`.

---

## 2. Contexto y problema actual

### Qué existe hoy (y se reutiliza)

- `headless-runtime/factory/factoryServer.ts` — singleton HTTP minimal, estado `queued/running/done/error`, SSE, persistencia en `{worktree}/.agents/factory/<id>/`.
- `src/lib/factory/playgroundCriteria.json` — definición de `F01`–`F05` con `id, title, blockedBy, timeoutMs, expectedJson, whatToTest.criterio, humanSteps`.
- `scripts/verify-F01.mjs` — único script que sí compara output real contra criterio (fetch + `performance.now()` + retry). Es el modelo a generalizar.
- Reportes en `docs/wiki Warp/reporte-F*.md`.

### Qué está roto (y por qué se reconstruye)

| Problema | Ejemplo concreto |
|---|---|
| **Adelantamiento** | F02 validaba `queued` pero la UI mostraba `done` porque el stub worker cambiaba a `running/done` a los 700/2200 ms sin que F02 lo pidiera. |
| **Simulación silenciosa** | El worker era `setTimeout` que inventaba logs/result sin invocar ejecutor real. El test pasaba aunque no existiera `opencode`. |
| **Mezcla real/simulado** | Mismo badge verde `verificado` para ambos. |
| **Criterio no versionado** | Si cambiaba `playgroundCriteria.json`, no quedaba registro contra qué versión se aprobó un veredicto viejo. |
| **Sin trazabilidad** | No se guardaba commit SHA, ni si lo corrió humano o script, ni output crudo. |
| **Sin flaky** | Un test que pasa 1 de 3 veces quedaba como `pendiente` o `verificado` sin matiz. |
| **Verificación manual** | F03–F05 dependían de que el humano leyera logs y decidiera a ojo. |

---

## 3. Producto objetivo

### Qué ES el Playground v2

Un **sistema de validación aislado** que, para cada `F`, responde una sola pregunta: *¿el contrato versionado de esta F se cumple contra el sistema real, ahora mismo, en este commit, con evidencia reproducible?* Gestiona criterios versionados, ejecuta verificadores automáticos (o guía humana cuando no se puede automatizar), emite veredictos trazables y los exhibe con distinción visual inequívoca entre real / simulado / flaky.

### Qué NO es

- No es la Factory. No encola jobs productivos, no ejecuta prompts de usuario, no reemplaza `factoryServer.ts`.
- No es un dashboard de métricas generales ni un CI externo.
- No simula éxito para desbloquear flujo.

---

## 4. Las 7 reglas no negociables → trazabilidad a requisitos

| # | Regla | Resumen operativo |
|---|---|---|
| **R1** | Aislamiento por F | Cada F prueba **únicamente** su propio contrato. No depende de ni exhibe resultados de una F bloqueada. Si `blockedBy` no está en `verificado`, la F dependiente queda `bloqueado` y no ejecutable. |
| **R2** | Prohibido simular | Si no hay ejecutor/componente real para el criterio, el test **falla o queda en espera** — nunca inventa `done`, `result.json` o logs. |
| **R3** | Mock marcado | Si hay mock temporal para que el frontend no se rompa, debe verse **inconfundible**: badge `SIMULADO`, borde rayado, fondo ámbar, tooltip `no validado contra sistema real`. Nunca verde ni `verificado`. |
| **R4** | Criterio versionado | Cada veredicto referencia `criteriaVersion` (hash o semver del criterio). Si cambia el criterio, veredictos viejos quedan `desactualizado` hasta revalidar. |
| **R5** | Trazabilidad completa | Cada veredicto guarda: **(a)** commit SHA + `criteriaVersion`, **(b)** `actor: humano | script | ci`, **(c)** `rawOutput` separado de `conclusion`. |
| **R6** | Automatización primero | Preferir script que compara contra criterio. Si requiere ojo humano, la UI lo declara: `requiere verificación humana` + checklist + campo `evidencia` obligatorio. |
| **R7** | Flaky explícito | Poder marcar `flaky` si bajo mismas condiciones a veces pasa y a veces falla. No es `verificado` ni `fallido` — es estado propio con contador `pasa/total`. |

---

## 5. Definición formal: ¿qué es una `F`?

Una `F` es un **contrato versionado, testeable y aislado** que describe una capacidad incremental de Factory.

```ts
// playground/criteria/Fxx.json  (uno por F, versionado en git)
interface FeatureContract {
  id: `F${string}`;              // ej "F01"
  version: string;               // semver "1.0.0" — bump en cada cambio de criterio
  title: string;
  wave: string;                  // ej "Ola 1 — Servidor único + health"
  blockedBy: FeatureContract["id"][]; // dependencias duras
  timeoutMs: number;
  criterio: string;              // frase única, imperativa: "GET /factory/health debe..."
  inputs: { label: string; value: string }[];
  expected: {
    httpStatus?: number;
    jsonShape?: unknown;         // shape mínimo, no snapshot completo
    fileArtifacts?: string[];    // ej ["job.json","prompt.md"]
    sse?: boolean;
    latencyMs?: number;
  };
  verifier: {
    kind: "script" | "human" | "hybrid";
    entry: string;               // ej "scripts/verify-F01.mjs" o "playground/verifiers/F03.ts"
    humanChecklist?: string[];   // solo si kind !== "script"
  };
  reportPath?: string;
}
```

**Invariantes:**

- Un archivo por `F` en `software-testing-playground-v2/criteria/F01.json` (no un array monolítico). Facilita diff, blame y version por F.
- `version` cambia **solo** si cambia `criterio`, `expected` o `verifier`. Cambios de `title`/`wave` no bumpean versión.
- `playgroundCriteria.json` legacy se considera **fuente congelada** — el v2 lo importa una vez y lo parte en archivos por F con `version: "1.0.0"`.
- El hash `criteriaHash = sha256(canonicalJson(contract))` se persiste en cada veredicto además del semver, para detectar drift aunque no se haya bumpeado a mano.

---

## 6. Modelo de estados

### 6.1 Estados de una `F` (estado del contrato)

Son **excluyentes** y visibles como badge principal.

| Estado | Color/Badge | Significado | ¿Automatizable? |
|---|---|---|---|
| `pendiente` | gris `○ Pendiente` | Nunca se ejecutó veredicto para esta versión del criterio | — |
| `bloqueado` | gris oscuro `⊘ Bloqueado por Fxx` | Algún `blockedBy` no está `verificado` | No ejecutable (R1) |
| `en_ejecucion` | azul animado `◐ Ejecutando…` | Verificador corriendo (script o humano en curso) | — |
| `verificado` | verde `✓ Verificado` | Último veredicto `pass` contra `criteriaVersion` actual + `rawOutput` evidencia + commit actual | Sí |
| `fallido` | rojo `✗ Fallido` | Último veredicto `fail` contra versión actual | Sí |
| `flaky` | violeta `≈ Flaky (2/5)` | Múltiples veredictos mixtos bajo mismo `criteriaVersion + commit` (R7) | Sí |
| `simulado` | ámbar rayado `⚠ SIMULADO` | Solo hay mock temporal, no validado contra sistema real (R3) | N/A |
| `desactualizado` | ámbar `◑ Desactualizado` | Había `verificado` pero el criterio subió de versión y no se revalidó (R4) | — |
| `expirado` | gris-ámbar `◷ Expirado` | `verificado` con más de N días o commit desfasado (configurable, ej 7 días) — pide revalidar | — |

> `error` del job (`FactoryJobState`) **no** es estado de `F`. Un job puede estar `error` y la `F` quedar `fallido`. No mezclar capas.

### 6.2 Veredicto (cada ejecución)

```ts
interface Veredicto {
  id: string;                    // ulid
  featureId: `F${string}`;
  criteriaVersion: string;       // semver del contrato al momento de ejecutar
  criteriaHash: string;          // sha256 del contrato
  commitSha: string;             // git rev-parse HEAD (o "dirty-..." si hay cambios sin commitear)
  commitDirty: boolean;
  actor: "script" | "humano" | "ci";
  actorDetail?: string;          // ej "Xu — PowerShell" o "scripts/verify-F01.mjs@1.2.0"
  startedAt: string;             // ISO
  finishedAt: string;
  durationMs: number;
  rawOutput: unknown;            // JSON/text crudo tal cual devolvió el sistema (R5c) — nunca editado
  conclusion: "pass" | "fail" | "inconclusive";
  reason?: string;               // por qué falló / por qué inconclusive
  artifacts?: string[];          // paths a job.json, logs.ndjson, capturas
  flakyRun?: { attempt: number; total: number };
}
```

**Reglas de almacenamiento:**

- `rawOutput` y `conclusion` son campos **separados** y ambos obligatorios (R5). La UI muestra `rawOutput` en panel colapsable `Output crudo` y `conclusion` como badge.
- Cada veredicto es **append-only** en `software-testing-playground-v2/verdicts/F01/<veredictoId>.json`. Nunca se sobrescribe.
- El **estado actual de la F** se deriva del último veredicto + `criteriaVersion` + `blockedBy` — no se guarda duplicado salvo caché `state.json` regenerable.

### 6.3 Detección de `flaky` (R7)

- Si en ventana de `N=5` últimos veredictos con **mismo** `criteriaHash + commitSha` hay al menos 1 `pass` y 1 `fail`, la F pasa a `flaky`.
- La UI muestra `≈ Flaky (2/5)` y lista los 5 veredictos con timestamp.
- Acción: botón `Re-ejecutar ×5` que corre el verificador 5 veces seguidas y reporta tasa.
- Un `flaky` **nunca** desbloquea dependientes. `blockedBy` exige `verificado` puro, no `flaky`.

---

## 7. Principios anti-contaminación (cómo se evita que F02 vea `done`)

1. **Verificador estricto por F.** Cada `verify-Fxx.mjs` valida **exactamente** lo que dice `expected` de su `Fxx.json`. F02 solo valida `state === "queued"` inmediatamente tras `POST /factory/jobs` + existencia de `job.json` y `prompt.md` con prompt exacto. **No** espera a `running`/`done`, **no** lee `result.json`, **no** hace polling a `GET /factory/jobs/:id` más allá de confirmar `queued`. Si el worker avanza a `done` por el stub, al verificador no le importa — ya validó `queued` en `t=0`.
2. **Ventana de observación acotada.** Cada verificador tiene `timeoutMs` propio y no reutiliza jobs de otra F. Cada F crea **su propio job efímero** con `prompt` único (`playground-F02-<uuid>`) para no colisionar.
3. **Prohibición de `result.json` / `.done` en Fs tempranas.** El linter del playground (`scripts/lint-criteria.mjs`) falla si `F01` o `F02` mencionan `result.json`, `.done` o `logs` en `expected`. Solo `F03` en adelante pueden exigirlos.
4. **Stub worker deshabilitable.** El `factoryServer.ts` expone flag `PLAYGROUND_ISOLATION=1` que desactiva las transiciones automáticas `queued→running→done` (los `setTimeout` de 700/2200 ms). En modo aislamiento, el job queda `queued` para siempre a menos que un ejecutor real lo mueva. Los verificadores de F02 corren con este flag; los de F03 sin él (o con ejecutor real inyectado). Esto elimina el falso positivo raíz.
5. **UI con filtro por F.** El playground no tiene vista "todo verde" global que mezcle Fs. Cada F se renderiza en su propia card con su badge y su veredicto. No hay contador agregado que oculte que `F01` pasó pero `F02` está `simulado`.
6. **Dependencias bloqueantes en UI y CLI.** Si `blockedBy` no está `verificado`, el botón `Verificar F03` está deshabilitado con tooltip `Bloqueado por F02 — verificá F02 primero`. El CLI `pnpm playground:verify F03` falla fast con `ERR_BLOCKED_BY`.

---

## 8. Objetivos del producto (3, ortogonales)

1. **Confianza:** cada `verificado` debe ser evidencia irrefutable — reproducible, versionada y trazable — de que el contrato de esa `F` se cumple contra el sistema real en el commit declarado. Nada de "andaba ayer".
2. **Aislamiento:** ninguna `F` puede contaminarse con resultados de otra — ni en datos, ni en UI, ni en tiempo de ejecución. Un verde en `F05` nunca implica que `F02` esté bien.
3. **Automatización con honestidad:** maximizar verificadores automáticos que comparan contra criterio, y cuando no se pueda, declararlo en la UI sin disimular verificación humana como automática.

---

## 9. Usuarios

| Usuario | Contexto Windows | Necesidad |
|---|---|---|
| **Dev local (vos)** | Corre `pnpm dev` en PowerShell, valida antes de pushear | Saber en < 30 s si `Fxx` está `verificado` contra el criterio actual, ver `rawOutput` si falló, y no perder tiempo con falsos verdes |
| **Revisor / Tech Lead** | Revisa PR, no confía en capturas | Auditar cada `verificado`: ¿contra qué commit? ¿quién lo corrió? ¿qué devolvió el sistema crudo? ¿sigue vigente el criterio? |
| **CI / Agente (Gao/Hydra)** | Corre `pnpm playground:verify --ci` en runner Windows | Salir con exit code `0/1`, emitir `verdicts/*.json`, y bloquear merge si alguna `F` no está `verificado` o está `flaky`/`simulado` |

---

## 10. Historias de usuario

**HU1 — Validación atómica sin contaminación**
> Como dev local, quiero correr `Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health | ConvertTo-Json` vía `pnpm playground:verify F01` y que el playground valide **solo** `{queue:{pending,running}}` en `<500 ms` contra el criterio versionado de `F01`, sin crear ni mirar jobs, para tener certeza de que el health check funciona aislado.

**HU2 — F02 valida únicamente `queued`**
> Como dev local, quiero que `pnpm playground:verify F02` cree un job con `prompt: "playground-F02-<uuid>"`, valide que quedó `queued` y que existen `job.json` + `prompt.md` con contenido exacto, y que **no** espere ni valide `running/done/result.json`, para no heredar falsos positivos del stub worker.

**HU3 — Distinción visual real vs simulado**
> Como revisor, quiero que si `F04` aún no tiene backend real y usa mock de frontend, su card se vea con borde rayado ámbar, badge `⚠ SIMULADO` y tooltip `no validado contra sistema real`, nunca verde, para no confundir demo con verificación.

**HU4 — Trazabilidad y criterio versionado**
> Como Tech Lead, quiero abrir un veredicto de `F03` y ver `criteriaVersion: 1.2.0`, `criteriaHash: abc123`, `commitSha: 9f3a...`, `actor: script (verify-F03.mjs)`, `rawOutput` con `logs.ndjson` crudo y `conclusion: pass` separados, para auditar contra qué se aprobó y poder reproducirlo.

**HU5 — Flaky y reintentos**
> Como dev local, quiero que si corro `F03` cinco veces y 3 pasan y 2 fallan con mismo commit y criterio, la F quede `≈ Flaky (3/5)` con lista de veredictos y opción `Re-ejecutar ×5`, y que siga bloqueando a `F04`, para no esconder inestabilidad bajo un verde.

---

## 11. Backlog — Requirements Pool

### P0 — Must have (sin esto no hay v2)

| ID | Requisito | Regla | Criterio de aceptación |
|---|---|---|---|
| **P0-1** | **Criterios por archivo versionado** — migrar `playgroundCriteria.json` a `software-testing-playground-v2/criteria/F01.json … F05.json` con `version` + `criteriaHash` | R4 | Existen 5 archivos, cada uno con `version: "1.0.0"`, `criterio` imperativo y `expected` mínimo. `pnpm playground:lint` valida schema y que `F01/F02` no mencionen `result.json/.done`. |
| **P0-2** | **Verificadores atómicos por F** — `scripts/verify-F01.mjs` como plantilla, nuevos `verify-F02.mjs … F05.mjs` que validan **solo** su `expected` | R1,R2 | `verify-F02.mjs` pasa con `PLAYGROUND_ISOLATION=1` (sin transiciones) y falla si falta `job.json`/`prompt.md`. No hace polling a `done`. `verify-F03.mjs` sí valida `logs.ndjson` + `result.json` + `.done` + SSE. |
| **P0-3** | **Prohibición de simulación** — flag `PLAYGROUND_ISOLATION=1` en `factoryServer.ts` que desactiva `setTimeout` stub; verificadores lo usan por defecto en Fs tempranas | R2 | Con `PLAYGROUND_ISOLATION=1`, `POST /factory/jobs` deja job en `queued` >10 s. Sin flag, avanza a `done` en ~3 s. Documentado en `factoryServer.ts` y README. |
| **P0-4** | **Modelo de veredicto trazable** — cada ejecución escribe `verdicts/Fxx/<ulid>.json` con `criteriaVersion, criteriaHash, commitSha, actor, rawOutput, conclusion` separados | R5 | `git rev-parse HEAD` se captura; `rawOutput` contiene body HTTP crudo sin transformar; `conclusion` es `pass/fail` derivado por comparación; ambos campos presentes y distintos. |
| **P0-5** | **Estados del playground** — implementar máquina de estados `pendiente/bloqueado/en_ejecucion/verificado/fallido/flaky/simulado/desactualizado` derivada de veredictos + `blockedBy` | R1,R7 | Si `F02` está `fallido`, `F03` aparece `⊘ Bloqueado por F02` y su botón `Verificar` está disabled con tooltip. |
| **P0-6** | **UI de playground aislada** — página/ruta `/playground` o panel dedicado (fuera de Factory) con una card por F, sin agregados engañosos | R1,R3 | Cada card muestra badge de estado, `criteriaVersion`, último veredicto y botón `Verificar`. No hay "X/5 passing" que oculte simulados. |
| **P0-7** | **Distinción visual simulado** — `simulado` con estilo inconfundible (borde dashed, fondo ámbar, badge `⚠ SIMULADO`) | R3 | Snapshot test o revisión visual: `simulado` nunca usa verde/✓. |
| **P0-8** | **Automatización primero** — todos los `verifier.kind === "script"` comparan automáticamente contra `expected`; si es `human`, la UI exige checklist + evidencia | R6 | `F04`/`F05` (que hoy son `human`) muestran `requiere verificación humana` + checkboxes + campo `evidencia` (URL/captura) obligatorio para emitir `pass`. |

### P1 — Should have (sin esto el v2 duele)

| ID | Requisito | Regla | Criterio |
|---|---|---|---|
| **P1-1** | **Detección de flaky** — ventana 5 últimos veredictos mismo `criteriaHash+commitSha`, auto `flaky` + botón `Re-ejecutar ×5` | R7 | 3 pass + 2 fail → badge `≈ Flaky (3/5)` y `F` sigue bloqueando dependientes. |
| **P1-2** | **CLI unificado** — `pnpm playground:verify [F01\|F02\|...] [--isolation] [--json] [--ci]` con exit codes y output JSON para CI | R6 | `pnpm playground:verify F01 --json` emite `{ featureId, conclusion, rawOutput, criteriaVersion }` y `exit 0` solo si `pass`. `--ci` falla si `simulado/flaky/desactualizado`. |
| **P1-3** | **Descubrimiento de puerto** — resolver `17680–17690` leyendo `factory-port` o probando `GET /factory/health` en rango, con mensaje PowerShell-friendly si no hay daemon | Entorno | Si `17680` no responde, prueba `17681…17690` antes de fallar. Mensaje: `No hay Factory en 17680-17690. Corré pnpm dev o node scripts/start-factory.mjs`. |
| **P1-4** | **Panel de output crudo** — en cada card, colapsable `Ver output crudo` con JSON/text sin truncar + botón `Copiar` + `Abrir job en disco` (`Get-ChildItem` path) | R5 | `rawOutput` nunca se mezcla con `conclusion` en el mismo bloque. |
| **P1-5** | **Versionado y desactualizado** — al bumpear `criteria/F03.json` a `1.1.0`, `F03` pasa a `desactualizado` hasta revalidar; veredictos viejos quedan legibles | R4 | Badge `◑ Desactualizado — criterio 1.1.0, último veredicto contra 1.0.0` + botón `Revalidar`. |
| **P1-6** | **Linter de criterios** — `pnpm playground:lint` valida schema, `blockedBy` acíclico, `F02` no exige `done`, timeouts razonables | R1 | `pnpm playground:lint` falla si `F03.blockedBy` no incluye `F02`. |
| **P1-7** | **Historial de veredictos por F** — lista de últimos 20 veredictos con `timestamp, actor, commit, conclusion` + link a JSON | R5 | Click en veredicto abre `verdicts/Fxx/<id>.json` raw. |

### P2 — Nice to have (pulido)

| ID | Requisito | Criterio |
|---|---|---|
| **P2-1** | **Modo watch** — `pnpm playground:watch` re-ejecuta verificadores al cambiar `criteria/*.json` o `factoryServer.ts` | Polling o `fs.watch` Windows-safe |
| **P2-2** | **Export de reporte** — `pnpm playground:report --md` genera `docs/playground-report.md` con tabla de estados + trazabilidad para adjuntar a PR | Markdown con badges en texto |
| **P2-3** | **Semáforo de commit dirty** — si `commitDirty === true`, badge `⚠ dirty` y warning `veredicto no reproducible — commiteá antes` | `git status --porcelain` check |
| **P2-4** | **Integración con Factory real** — cuando `F04/F05` tengan backend, `verifier.kind` pasa de `human` a `script` sin cambiar UI | Solo cambia `criteria/F04.json` |
| **P2-5** | **Métricas de latencia** — gráfico de `durationMs` últimos 20 runs por F para detectar regresiones | Sparkline simple |
| **P2-6** | **Notificación toast** — al pasar de `fallido` a `verificado`, toast `F03 verificado contra 1.0.0` | No bloqueante |

---

## 12. UI Design Draft — Playground (input para Gao)

### Layout general

```
┌─ Header ──────────────────────────────────────────────────────────┐
│  🧪 Playground v2 — Validación por Contrato    [pnpm playground:verify --ci]  [Lint]  [Report .md]  [Ayuda PowerShell ▼] │
│  Commit: 9f3a2c1 (clean)  •  Factory: http://127.0.0.1:17680 ✓  •  Criterios: 5  •  Última corrida: hace 3 min             │
└─────────────────────────────────────────────────────────────────┘
┌─ Filtros ─────────────────────────────────────────────────────────┐
│  [Todos] [Pendiente] [Verificado] [Fallido] [Flaky] [Simulado] [Desactualizado]   [x] Solo bloqueables  [Buscar F...]     │
└─────────────────────────────────────────────────────────────────┘
┌─ Grid de Cards (una por F, orden topológico) ───────────────────┐
│ ┌─ F01 ──────────────────────┐ ┌─ F02 ──────────────────────┐   │
│ │ ○/✓/✗/≈/⚠ badge grande      │ │ ⊘ Bloqueado por F01         │   │
│ │ Servidor único + health     │ │ Job en disco                │   │
│ │ Ola 1 • v1.0.0 • <500 ms    │ │ Ola 2 • v1.0.0 • <2000 ms    │   │
│ │ Criterio: GET /health ...   │ │ Criterio: POST /jobs →      │   │
│ │ Último: ✓ Verificado        │ │  queued + job.json          │   │
│ │ hace 2 min • script         │ │ Último: ⊘ Bloqueado          │   │
│ │ Ver output crudo ▼          │ │ [Verificar] disabled        │   │
│ │ [Verificar] [Historial]     │ │ Ver output crudo —          │   │
│ └─────────────────────────────┘ └─────────────────────────────┘   │
│ ┌─ F03 ───────────── SIMULADO ──────────────┐                    │
│ │ ██████████████████████████████████████████ │  ← borde dashed ámbar, fondo #fffbeb |
│ │ ⚠ SIMULADO — no validado contra sistema real  │  tooltip: "Hay mock temporal para frontend" |
│ │ Worker + logs vivos (SSE)  •  v1.0.0            │                    │
│ │ [Verificar] disabled — configurá ejecutor real  │                    │
│ └───────────────────────────────────────────┘                    │
│ ┌─ F05 ───────────── FLAKY ─────────────────┐                    │
│ │ ≈ Flaky (2/5) — 2 pass, 3 fail             │  ← violeta, no verde |
│ │ Planning/Tools vía Factory  •  v1.0.0       │                    │
│ │ [Re-ejecutar ×5] [Ver 5 veredictos ▼]      │                    │
│ └───────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
┌─ Drawer: Veredicto ─────────────────────────────────────────────┐
│  F01 — Veredicto #01J...  •  2026-05-13 14:22  •  script          │
│  criteriaVersion 1.0.0 (abc123)  •  commit 9f3a2c1 (clean)        │
│  conclusion: ✓ pass  •  duration: 42 ms                          │
│  ┌─ Output crudo (rawOutput) ────────────────────────────────┐   │
│  │ { "queue": { "pending": 0, "running": 0 },                │   │
│  │   "uptime": 12345, "version": "local" }                   │   │
│  └───────────────────────────────────────────────────────────┘   │
│  ┌─ Conclusión (conclusion) ────────────────────────────────┐   │
│  │ PASS — queue.pending y queue.running numéricos, <500 ms  │   │
│  └───────────────────────────────────────────────────────────┘   │
│  Artifacts: .agents/factory/job-xxx/job.json  [Abrir carpeta]    │
│  [Copiar rawOutput] [Copiar veredicto JSON]                      │
└─────────────────────────────────────────────────────────────────┘
```

### Reglas visuales mandatorias

- **Verde solo para `verificado`.** `simulado`, `flaky`, `desactualizado`, `bloqueado` nunca usan verde.
- **`simulado`** — borde `2px dashed #f59e0b`, fondo `#fffbeb`, icono `⚠`, badge `SIMULADO` en mayúsculas. Hover: `Este resultado es simulado y no fue validado contra el sistema real. No desbloquea Fs dependientes.`
- **`flaky`** — violeta `#8b5cf6`, icono `≈`, contador `pasa/total`.
- **`bloqueado`** — gris, icono `⊘`, lista `Bloqueado por Fxx` con links a esas cards.
- Cada card muestra: `id`, `title`, `wave`, `version`, `timeoutMs`, `criterio` (1 línea), badge de estado grande, último veredicto resumido, botones `Verificar` / `Historial` / `Ver output crudo`.
- **Ayuda PowerShell** — dropdown fijo con snippets copiables:
  ```powershell
  # Health
  Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health | ConvertTo-Json
  # o
  curl.exe --silent http://127.0.0.1:17680/factory/health

  # Crear job
  Invoke-RestMethod -UseBasicParsing -Uri http://127.0.0.1:17680/factory/jobs -Method Post -ContentType "application/json" -Body '{"prompt":"playground-F02-test","worktree":"C:\\tmp\\repo-prueba","phase":"diagnosisLlm"}' | ConvertTo-Json -Depth 5

  # Ver job
  Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/jobs/<id> | ConvertTo-Json -Depth 5

  # Logs SSE (alternativa PowerShell a curl SSE)
  # En otra terminal:
  Get-Content C:\tmp\repo-prueba\.agents\factory\<id>\logs.ndjson -Wait
  ```
  Nunca mostrar `curl` sin `.exe` ni `cat`/`grep`/`ls`.

### Interacciones clave

- Click `Verificar` → card pasa a `en_ejecucion` (spinner azul), corre `verify-Fxx.mjs` vía IPC o `node` spawn, al terminar actualiza badge + agrega veredicto a historial.
- Si `blockedBy` no está `verificado`, `Verificar` disabled con tooltip y el CLI falla fast.
- `Re-ejecutar ×5` (solo en `flaky` o manual) corre 5 veces y actualiza contador.
- `Ver output crudo` expande panel con `rawOutput` formateado + `Copiar`.

---

## 13. Arquitectura implicada — input para Gao

> Esta sección es el **contrato con el arquitecto**. No prescribe implementación, pero fija invariantes que la arquitectura debe garantizar.

### 13.1 Fuentes de verdad

| Dato | Fuente | Formato | Versionado |
|---|---|---|---|
| Contrato de cada F | `software-testing-playground-v2/criteria/Fxx.json` | JSON schema validado por `playground:lint` | `version` + `criteriaHash` |
| Veredictos | `software-testing-playground-v2/verdicts/Fxx/<ulid>.json` | Append-only JSON | Referencia `criteriaVersion+Hash` y `commitSha` |
| Estado derivado de F | `software-testing-playground-v2/state.json` (caché regenerable) | Derivado de veredictos + criterios | No es fuente — se puede borrar y regenerar |
| Jobs efímeros | `{worktree}/.agents/factory/<id>/` (disco) | `job.json`, `prompt.md`, `logs.ndjson`, `result.json`, `.done` | Efímeros, con `prompt` prefijo `playground-Fxx-` para GC |

### 13.2 Componentes

1. **Criteria Store** — lee `criteria/*.json`, valida schema, calcula `criteriaHash`, expone `getCriteria(Fxx)`, `listCriteria()`, `lint()`. Detecta `desactualizado` comparando `criteriaHash` del último veredicto vs actual.
2. **Verifier Runner** — dado `Fxx`, resuelve `criteria.verifier.entry`, hace `spawn("node", [entry, "--json"])` o guía humana, captura `rawOutput`, compara contra `expected`, emite `Veredicto`. Debe soportar `PLAYGROUND_ISOLATION=1` y descubrimiento de puerto `17680-17690`.
3. **Verdict Store** — append `verdicts/Fxx/*.json`, lista historial, calcula estado de F (incluyendo `flaky` y `bloqueado` vía `blockedBy`), emite eventos para UI.
4. **Isolation Guard (Factory)** — flag `PLAYGROUND_ISOLATION` en `factoryServer.ts` que desactiva transiciones stub. Alternativa: inyección de `executor` real (cuando exista) para `F03+`.
5. **Playground UI** — ruta/panel `/playground` (React), consume `Criteria Store` + `Verdict Store` vía IPC o `fetch` a `http://127.0.0.1:1768x/playground/*` (si se expone) o lectura directa de disco en Electron. Debe renderizar estados con distinción visual mandatoria.
6. **CLI** — `scripts/playground.mjs` o `pnpm playground:*` que orquesta `lint`, `verify`, `report`, `watch`.

### 13.3 Contratos de API (si se expone HTTP para playground)

```
GET  /playground/criteria          → { criteria: FeatureContract[] }
GET  /playground/criteria/:id      → FeatureContract
GET  /playground/verdicts/:id      → { featureId, verdicts: Veredicto[] }  // historial
GET  /playground/state             → { states: Record<FeatureId, { status, lastVerdictId, criteriaVersion }> }
POST /playground/verify/:id        → { verdict: Veredicto }  // dispara verificador, stream opcional vía SSE
GET  /playground/verify/:id/events → SSE (progreso del verificador)
```

Si no se quiere exponer HTTP nuevo, el runner puede ser solo CLI + lectura de disco — decisión de Gao, pero el contrato de datos (`FeatureContract`, `Veredicto`) es fijo.

### 13.4 Flujo de verificación (secuencia)

```
Usuario click "Verificar F02"
  → UI deshabilita botón, muestra "en_ejecucion"
  → Runner: lee criteria/F02.json (v1.0.0, hash abc)
  → Runner: git rev-parse HEAD → 9f3a2c1, git status --porcelain → dirty?
  → Runner: verifica blockedBy (F01 debe estar verificado) — si no, fail fast ERR_BLOCKED_BY
  → Runner: spawn node scripts/verify-F02.mjs --isolation --json
      → verify-F02.mjs: POST /factory/jobs { prompt:"playground-F02-<uuid>", worktree:"C:\\tmp\\repo-prueba", phase:"diagnosisLlm" }
      → valida: HTTP 201 + state==="queued" + job.json existe + prompt.md === prompt
      → NO valida result.json/.done/logs
      → retorna { rawOutput: <body crudo>, conclusion: "pass"|"fail", reason }
  → Runner: construye Veredicto { criteriaVersion, criteriaHash, commitSha, actor:"script", rawOutput, conclusion }
  → Verdict Store: escribe verdicts/F02/<ulid>.json
  → recalcula estado F02 → verificado|fallido
  → recalcula bloqueos downstream (F03 pasa de bloqueado a pendiente si F02 ahora verificado)
  → UI actualiza card F02 + desbloquea F03 si corresponde + muestra drawer con rawOutput vs conclusion
```

### 13.5 Criterios de aceptación global (para Gao)

- [ ] `pnpm playground:lint` valida schema, aciclicidad de `blockedBy`, y que `F01/F02` no exijan `result.json`.
- [ ] `pnpm playground:verify F02 --isolation` pasa aunque no haya ejecutor real; `pnpm playground:verify F03 --isolation` falla (porque F03 exige ejecutor).
- [ ] Ningún verificador de `Fxx` lee artefactos de `Fyy` con `yy > xx`.
- [ ] `simulado` nunca se ve verde ni desbloquea.
- [ ] Cada `verdicts/Fxx/*.json` tiene `rawOutput` y `conclusion` separados.
- [ ] Cambiar `criteria/F01.json` bump a `1.1.0` hace que `F01` pase a `desactualizado` hasta revalidar, y `F02` a `bloqueado`.
- [ ] `flaky` se detecta y sigue bloqueando.
- [ ] Todos los ejemplos de docs/scripts usan `curl.exe` o `Invoke-RestMethod`, no `curl`/`ls`/`cat`.

---

## 14. Preguntas abiertas (para resolver con Gao / dueño de Factory)

1. **¿Dónde vive el runner?** ¿Como endpoints nuevos en `factoryServer.ts` (`/playground/*`) o como proceso CLI separado que lee disco? Tradeoff: endpoints dan SSE/remote, pero acoplan playground a Factory. ¿Preferimos desacoplado (solo disco + CLI) en v2?
2. **¿Worktree de pruebas fijo o efímero?** ¿Usamos siempre `C:\tmp\repo-prueba` (simple, Windows-friendly) o creamos temp `C:\tmp\playground-<uuid>` por corrida y lo limpiamos? ¿Quién hace GC de `playground-Fxx-*` jobs viejos?
3. **¿Fuente del `commitSha` cuando hay `dirty`?** ¿Bloqueamos `verificado` si `git status --porcelain` no está clean, o permitimos `verificado (dirty)` con badge `⚠ dirty`? ¿CI exige clean?
4. **¿Ejecutor real para F03+?** Hoy `F03` depende de stub `setTimeout`. ¿Cuándo habrá ejecutor real inyectable (opencode SDK) para que `verify-F03.mjs` valide contra ejecución auténtica? ¿El playground debe mockear ejecutor como `simulado` hasta entonces o marcar `F03` como `simulado` directamente?
5. **¿Persistencia de `factory-port` en Windows?** El archivo `factory-port` vive en `getTermCanvasDataDir()` — ¿el playground lo lee desde Electron main o hace probing `17680-17690`? ¿Qué pasa si hay dos instancias de TermCanvas?
6. **¿MUI o solo Tailwind?** El stack default propone MUI, pero TermCanvas usa Tailwind + Radix. ¿Usamos Radix + Tailwind para consistencia o introducimos MUI solo en playground?
7. **¿Cuándo expira un `verificado`?** ¿7 días, o solo por cambio de criterio/commit? ¿Queremos `expirado` como estado o alcanza con `desactualizado`?
8. **¿Playground en Electron o web?** ¿Panel dentro de TermCanvas (Electron) con acceso a disco directo, o ruta web `http://127.0.0.1:17680/playground` servida por `factoryServer.ts`? La segunda permite abrir en browser sin Electron.

---

## 15. Anexos

### A. Glosario

| Término | Definición |
|---|---|
| **F** | Feature contract versionado (`F01`…) — unidad mínima validable |
| **Criterio** | Frase imperativa + `expected` que define qué debe cumplir la F |
| **Verificador** | Script `.mjs` o guía humana que compara sistema real contra criterio |
| **Veredicto** | Registro append-only de una ejecución: `rawOutput + conclusion + trazabilidad` |
| **Estado de F** | Badge derivado (`verificado`, `fallido`, `flaky`, `simulado`…) |
| **RawOutput vs Conclusion** | `rawOutput` = lo que devolvió el sistema crudo; `conclusion` = `pass/fail` derivado por el verificador |
| **Simulado** | Mock temporal no validado contra sistema real — estilo ámbar, nunca verde |
| **Flaky** | Pasa y falla intermitente bajo mismas condiciones |
| **Bloqueado** | `blockedBy` no está `verificado` — no ejecutable (R1) |
| **Desactualizado** | Criterio subió de versión y el último veredicto es contra versión vieja |

### B. Checklist para Gao antes de codificar

- [ ] ¿El schema `FeatureContract` cubre todos los `whatToTest` actuales de `F01–F05`?
- [ ] ¿El flag `PLAYGROUND_ISOLATION` está implementado y testeado en `factoryServer.ts`?
- [ ] ¿El linter impide que `F02` valide `done`?
- [ ] ¿La UI distingue `simulado`/`flaky`/`verificado` sin ambigüedad cromática (accesible)?
- [ ] ¿Los scripts usan solo `Invoke-RestMethod` / `curl.exe` / `Get-Content` en ejemplos y código?
- [ ] ¿El probing `17680–17690` está en todos los verificadores?

### C. Referencias

- `src/lib/factory/playgroundCriteria.json` — fuente legacy (congelar, partir en `criteria/Fxx.json`)
- `headless-runtime/factory/factoryServer.ts` — daemon singleton, contratos HTTP y disco
- `scripts/verify-F01.mjs` — patrón oro de verificador automático (fetch + `performance.now()` + retry)
- `docs/wiki Warp/reporte-F*.md` — reportes existentes por ola

---

*PRD preparado por Xu (Product Manager) — input para Gao (Architect). Próximo paso: arquitectura del playground v2.*
