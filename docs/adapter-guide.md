# Harness Adapter Guide — Cómo agregar un nuevo CLI sin romper nada

> **Objetivo:** Tu caja neutra (`engram`, `codegraph`, `context7`, `skills diag-*`, `AGENTS.md`) vive una sola vez. Cada harness (opencode, codebuddy, claude, el próximo) es solo un **traductor**. Agregar el 3º harness no debe tocar el core.

Este documento se escribe en cada paso de la migración. Si lo rompes, el próximo harness pagará los mismos bugs que ya pagamos.

---

## 1. Arquitectura — Core neutro + Adapter

```
[Tus cosas neutras]
  shared/neutral/mcp.ts          — ProjectMcpConfig, McpCatalogEntry (supabase, github, filesystem, postgres + customs)
  shared/neutral/skills.ts       — NeutralSkill {name, description, body, raw}
  shared/neutral/instructions.ts — InstructionBlock {id: codegraph|engram|persona|project}
         |
         |  (traducción pura, sin lógica de negocio)
         v
[Adapters por harness]
  electron/mcp/adapters/opencode.ts   — escribe <project>/.opencode/opencode.json  {mcp:{...}}
  electron/mcp/adapters/codebuddy.ts  — ejecuta `codebuddy mcp add --scope project ...`
  src/skills/adapters/opencode.ts     — crea .agents/planning/.scope-<runId>/SKILL.md + OPENCODE_CONFIG (deny-all)
  src/skills/adapters/codebuddy.ts    — escribe .codebuddy/skills/<name>/SKILL.md (1 nivel)
```

**Reglas:**
- El **manager** (`electron/mcp/manager.ts`) nunca importa `opencode-sync` directo. Llama al **registry** `electron/mcp/adapters/index.ts` que itera todos los harnesses vía `syncToAllHarnesses()`.
- Los **secretos** nunca se persisten en el archivo neutro. Van en `McpVault` (device-local) y se inyectan como `--env KEY=val` / `--header` (codebuddy) o `{env:VAR}` (opencode).
- Agregar un harness = crear 3 archivos nuevos + 1 línea en cada `index.ts`. Cero cambios en `shared/neutral/*` ni en `manager.ts`.

---

## 2. Checklist para un nuevo harness (copiar/pegar)

1. **Descubrir el storage real** — no asumir archivo:
   - MCP: `codebuddy mcp add --help` → `--scope project|user|local`, `--transport stdio|http|ssec`, `--env`, `--header`, `-- <command>`. Verificar con `codebuddy mcp list --scope project` después de un `add` dummy.
   - Skills: `https://www.codebuddy.ai/docs/cli/skills` → `.codebuddy/skills/<name>/SKILL.md` con frontmatter `name/description`. Verificar `ls .codebuddy/skills/` tras crear una.
   - Instrucciones: `https://www.codebuddy.ai/docs/ide/User-guide/Rules` → `<project>/AGENTS.md` o `.codebuddy/rules/*.md`.
2. **Crear `HarnessMcpAdapter`:** `electron/mcp/adapters/<harness>.ts` implementa `syncToHarness()` (add), `removeFromHarness()` (remove), `syncAllToHarness()` (loop). Usar `execFileSync("codebuddy", args, {cwd: projectPath})` con `windowsHide:true`.
3. **Crear `HarnessSkillAdapter`:** `src/skills/adapters/<harness>.ts` implementa `prepareScope()` que escribe en el path correcto (1 nivel para codebuddy, no `.scope-*`). `renderSkillMd()` puro para tests.
4. **Crear `HarnessInstructionAdapter`:** `shared/neutral/instructions.ts` → `syncToHarness()` concatena bloques `codegraph+engram+persona` y escribe a `AGENTS.md` / `CLAUDE.md` / `.codebuddy/rules`.
5. **Registrar:** `electron/mcp/adapters/index.ts` + `src/skills/adapters/index.ts` (cuando exista).
6. **Tests:** Agregar caso en `tests/neutral-harness.test.ts` y prueba manual `codebuddy mcp list --scope project` + `ls .codebuddy/skills/`.

---

## 3. Paso a paso — Fase 1 (esta migración) documentado

### Fase 1.0 — Validación (2026-08-28)
- Confirmado `codebuddy 2.141.0` funciona en Windows (`codebuddy --version` + `trustedDirectories` incluye `termcanvas/**`).
- `/model` lista 17 built-ins pero no `hy4` — Hy4 gratis es vía CodeBuddy/WorkBuddy app por 2 semanas (anuncio Tencent 2026-08-28), no vía API. El adapter debe soportar cualquier `modelId` vía `--model`.

### Fase 1.1 — Mapeo
- **MCP:** `shared/mcp.ts:136` ya es neutro. `electron/mcp/manager.ts:47` es neutro. El acople era `electron/mcp/opencode-sync.ts:178` y `opencode-reader.ts:68` que leen/escriben `opencode.json` directo.
- **Skills:** `src/skills/registry.ts:47` (diag-*) + `vendorSkills.ts:163` (descubrimiento) son neutros. El acople era `src/skills/scopedSession.ts:57` (`OPENCODE_CONFIG`, `permission.skill: {"*":"deny"}` solo para opencode).
- **Instrucciones:** `~/.config/opencode/AGENTS.md:1` contiene 3 bloques (`codegraph-guidance`, `engram-protocol`, `persona`). Solo opencode los lee vía `agent.gentleman.prompt: {file:./AGENTS.md}`.

### Fase 1.2 — MCP a neutro
- Creado `shared/neutral/mcp.ts:1` fachada que re-exporta `shared/mcp.ts` y define `HarnessMcpAdapter`, `SUPPORTED_HARNESS_IDS`.
- Creado `electron/mcp/adapters/types.ts`, `opencode.ts` (wrapper), `codebuddy.ts` (stub file) y `index.ts` (registry con `syncToAllHarnesses()`).
- **Error descubierto y corregido (2026-08-28) — archivo equivocado:** El stub inicial de `codebuddy.ts` escribía `.codebuddy/mcp.json` (`codebuddyMcpPath()`) que CodeBuddy nunca lee. El store real es `<project>/.mcp.json` (`{mcpServers:{...}}`) creado por `codebuddy mcp add --scope project` — verificado con `Added stdio MCP server filesystem with command: npx ... to project config / File modified: .mcp.json`. Corregido a `execFileSync("codebuddy", ["mcp","add","--scope","project",...])` usando `--transport`, `--env`, `--header`, `--` como documenta `codebuddy mcp add --help`. Ver `electron/mcp/adapters/codebuddy.ts:1`.
- **Error descubierto y corregido (2026-08-28) — orden de args:** `codebuddy mcp add [options] <name>` exige `options` **antes** de `<name>`. El stub ponía `mcp add <name> --scope project` (scope después) y fallaba con `unknown option '--scope'` / `unknown option '-y'`. Corregido a `mcp add --scope project --transport stdio <name> -- <command>`.

### Fase 1.3 — Skills a neutro
- Creado `shared/neutral/skills.ts:1` con `NeutralSkill`, `HarnessSkillAdapter`, helpers `toNeutralSkillFromRegistry/Vendor`.
- Creado `src/skills/adapters/opencode.ts` (wrapper de `scopedSession.ts`) y `src/skills/adapters/codebuddy.ts` (stub).
- **Error descubierto y corregido (2026-08-28):** El stub de `codebuddy.ts` escribía `.codebuddy/skills/.scope-<runId>/<name>/SKILL.md` (2 niveles) que CodeBuddy no descubre (solo 1 nivel: `.codebuddy/skills/<name>/SKILL.md` según `https://www.codebuddy.ai/docs/cli/skills`). Corregido a escritura directa a `.codebuddy/skills/<name>/SKILL.md` con `fs.mkdir(skillsDir, name)` y `sweepStaleScopes()` para limpiar `.scope-*` huérfanos del bug.

### Fase 1.4 — Instrucciones a neutro
- Creado `shared/neutral/instructions.ts:1` con `InstructionBlock`, `parseAgentsMdIntoBlocks()`, `concatBlocksToAgentsMd()`, `HarnessInstructionAdapter`. `DEFAULT_BLOCK_ORDER` preserva `codegraph(10) < engram(20) < persona(30) < project(40)`.
- Preserva `engram`/`codegraph` como bloques de primera clase, no como "MCPs de opencode".

### Fase 1.5 — Dual-write y migración retroactiva
- `electron/mcp/ipc.ts:20` ahora hace dual-write: `mcp:status` y `mcp:hydrate-config` llaman `syncAllToAllHarnesses()` (opencode + codebuddy) además del legacy `syncAllEnabledToOpencode()` para rollback seguro. `mcp:set-enabled` y `mcp:set-secret` llaman `syncToAllHarnesses()`.
- El primer `mcp:status` post-migración copia tus MCPs ya `enabled:true` (engram/codegraph/context7) a CodeBuddy sin togglear manual.
- **Fix CLI Tools (2026-08-28):** `src/components/SettingsModal.tsx:423` `AGENT_TYPES` ahora incluye `"codebuddy"` — antes solo listaba 6 (`claude,codex,kimi,gemini,opencode,wuu`) por lo que Settings > CLI Tools nunca mostraba CodeBuddy. `electron/process-detector.ts:27` `CLI_PATTERNS` ahora incluye `codebuddy` y `cbc` para que el detector marque `codebuddy` como `cliType` y no como shell genérico.

### Fase 1.6 — Tests y verificación (lo que hizo que funcionara)

**Antes — tests de baja calidad (falsos positivos):**
- `tests/neutral-harness.test.ts:4` inicial solo probaba `codebuddy adapter stub does not throw on sync` con `syncToHarness("", "github")` y `projectPath=""` (no-op). Nunca tocaba filesystem ni CLI, por eso no detectó que escribíamos a `.codebuddy/mcp.json` inexistente ni el `.scope-*` anidado. Pasaban en CI pero el usuario veía `No MCP servers configured`.

**Después — tests de integración con CLI y FS reales (gate de calidad):**
- `tests/codebuddy-adapter.integration.test.ts:1` — 3 tests con `execSync("codebuddy ...")` y `fs` reales, `shell:false` evitado via `execSync` string para Windows `.cmd` (corrige `ENOENT` y `DEP0190`):
  1. `MCP: codebuddy mcp add --scope project writes <project>/.mcp.json and is listed` → verifica `Added stdio MCP server ... to project config / File modified: .mcp.json`, `fs.existsSync(.mcp.json)`, `mcpServers.test-filesystem.command === "npx"`, `!exists(.codebuddy/mcp.json)` y `mcp list` no vacío. Atrapó el bug de archivo.
  2. `MCP: engram/codegraph stdio commands are correct` → llama al adapter real `codebuddyMcpAdapter.syncToHarness(tmpDir, "test-engram")` y verifica `command === "engram.exe"` en Windows.
  3. `Skills: CodeBuddy discovers .codebuddy/skills/<name>/SKILL.md at 1 level` → mockea `window.termcanvas.fs` con `fs` real, llama `prepareScope` y verifica `Exists .codebuddy/skills/diag-testskill/SKILL.md` a 1 nivel y `!exists(.scope-*)`.

- `tests/codebuddy-global-sync.integration.test.ts:1` — 3 tests para el caso `education-games` (proyecto fresco sin toggle):
  1. `MCP global: 3 global opencode MCPs appear without per-project toggle` → `syncGlobalMcpToCodebuddy()` debe crear `~/.codebuddy/.mcp.json` con `context7/engram/codegraph` y `mcp list` los muestra `✓ Connected`.
  2. `Skills global: branch-pr appears in any fresh project` → `syncGlobalSkillsToCodebuddy(tmpDir)` copia `~/.config/opencode/skills/branch-pr` y `~/.agents/skills/*` (52 skills) a `<tmp>/.codebuddy/skills/<name>/SKILL.md` a 1 nivel, verifica `frontmatter name:` y que no haya `.scope-*`.
  3. `Windows: verify correct path handling (no ls needed)` → documenta que en Windows `ls` no existe, usar `dir .codebuddy\skills\branch-pr` o `Get-ChildItem` o `fs.existsSync` — el código usa `path.join` y `fs`, no shell.

**Cómo correrlos sin gastar créditos de CodeBuddy:**
- Estos tests solo usan `codebuddy mcp add/remove/list` y `fs` — **no llaman al modelo** (`--model`, `-p`, `codebuddy "prompt"`), por lo que no consumen créditos. Son seguros para CI.
- Comandos:
  ```powershell
  pnpm exec tsc --noEmit
  pnpm exec tsx --test tests/codebuddy-adapter.integration.test.ts tests/codebuddy-global-sync.integration.test.ts
  pnpm exec tsx --test tests/neutral-harness.test.ts
  # Full suite (878/884 pasan, 3 fallos pre-existentes por node:sqlite y pty-launch Windows)
  pnpm test
  ```
- En Windows, verificar manual con `dir` no `ls`:
  ```powershell
  dir .codebuddy\skills\branch-pr
  Get-Content .codebuddy\skills\branch-pr\SKILL.md | Select-Object -First 10
  Get-Content .mcp.json | Select-Object -First 20
  codebuddy mcp list
  ```

**Resultado:** `6/6` integración + `5/5` unitarios pasan. La próxima vez que agregues un harness, si el test de integración no pasa, no mergeas.

---

## 4. Pitfalls — lo que ya nos dolió (leer antes de agregar el 3º harness)

| Pitfall | Qué pasó | Cómo evitar |
|---|---|---|
| **Asumir archivo JSON** | CodeBuddy MCP no usa `.codebuddy/mcp.json` sino `<project>/.mcp.json` vía `codebuddy mcp add --scope project` (verificado: `File modified: .mcp.json`) | Siempre hacer `--help` y `mcp list` dummy antes de escribir adapter; verificar `Get-Content .mcp.json` tras `add` |
| **Orden de args** | `mcp add <name> --scope project` falla `unknown option '--scope'`; la CLI exige `mcp add [options] <name>` (`--scope`/`--transport` antes de `<name>`) | Usar `mcp add --scope project --transport stdio <name> -- <cmd>` — probar con `node bin/codebuddy mcp add --scope project --transport stdio test -- node --version` |
| **Asumir scope ephemeral** | CodeBuddy skills no usan `OPENCODE_CONFIG`/`permission.skill` ni `.scope-*`. Son persistentes `.codebuddy/skills/<name>/` | Leer `https://www.codebuddy.ai/docs/cli/skills` — 1 nivel, frontmatter `name/description` |
| **No migrar lo ya enabled** | Dual-write solo en `set-enabled` no copia los que ya estaban prendidos | En `mcp:status`/`hydrate-config`, si `codebuddy mcp list` vacío pero neutral `enabled:true`, hacer `syncAll` una vez |
| **Tokens en claro** | `opencode-sync.ts:92` escribe `Authorization: Bearer <token>` para remote; para codebuddy usar `--header`/`--env` | Nunca persistir token en neutral; pasar via `McpVault` → `--env`/`--header` |
| **Escribir en cwd equivocado** | `codebuddy mcp add --scope project` usa `cwd` para resolver el proyecto | Siempre pasar `{cwd: projectPath}` al `execFileSync` |
| **Borrar skills en release** | CodeBuddy no tiene `release()` ephemeral; borrar en `release()` borra la skill global | Hacer `release()` no-op para `project` scope; documentar si el nuevo harness soporta scopes |

---

## 5. Matriz de capacidades (actualizar al agregar harness)

| Harness | MCP remote | MCP local stdio | Skill deny-all | Skill scope | Instruction file | Resume |
|---|---|---|---|---|---|---|
| opencode | `type: remote, headers` en `opencode.json` | `command: ["npx",...]` | Sí (`permission.skill: {"*":"deny"}`) | Ephhemeral `.scope-<runId>` + `OPENCODE_CONFIG` | `AGENTS.md` | Sí (`--resume`) |
| codebuddy | `--transport http --header` | `--transport stdio -- <cmd>` | No (global) | Persistent `.codebuddy/skills/<name>/` + global sync | `.codebuddy/skills/` + `AGENTS.md` | Parcial (`--resume`) |
| <next> |  |  |  |  |  |  |

---

## 6. Fase 2 — Harness CodeBuddy sin gastar créditos (siguiente, sin llamadas al modelo)

**Objetivo:** Dejar CodeBuddy 100% lanzable desde TermCanvas (pty + Hydra + skills) pero **sin invocar el modelo** (`--model`, `-p`, `codebuddy "prompt"`), para no gastar créditos hasta que el usuario lo pida.

**No se hará en esta fase (para no gastar):**
- Ningún `codebuddy --model <id>`, `codebuddy -p "prompt"`, `codebuddy "hello"` ni `codebuddy --print` con prompt.
- Ningún `codebuddy mcp add` con token real que requiera validación contra servicio externo (solo los 3 globales ya sincronizados).

**Sí se hará:**
1. **PTY plumbing:** Extender `electron/pty-launch.ts` y `headless-runtime/terminal-launch.ts` para `terminalType: "codebuddy"` → `codebuddy --help` y `codebuddy mcp list` como smoke test (no modelo), inyectar `getMcpEnvForCwd` y `OPENCODE_CONFIG` equivalente si aplica. Verificar `buildLaunchSpec` genera `extraPathEntries` correctos.
2. **Hydra roles:** `hydra/src/roles/loader.ts:27` añadir `RoleCli = "codebuddy"` y `hydra/src/roles/builtin/dev-codebuddy.md` con `terminals: [{cli: codebuddy, model: "auto"}]` pero sin `dispatch` real — solo `hydra init` + `hydra status` de prueba.
3. **Skills wiring:** Conectar `src/skills/adapters/codebuddy.ts:77` `prepareScope` al `terminal:create` flow (ya hecho para global, falta para per-session `diag-*`). Test con `prepareScope` que escribe `.codebuddy/skills/diag-test/SKILL.md` y `codebuddy` lo lista sin invocar modelo.
4. **Tests sin modelo (gate):** Nuevos `tests/codebuddy-pty.integration.test.ts` que verifican `buildLaunchSpec` para `codebuddy`, `hydra list-roles` incluye `codebuddy`, y `codebuddy --version`/`--help`/`mcp list` responden — todo sin `codebuddy -p`.

**Criterio de salida:** `pnpm exec tsx --test tests/codebuddy-pty.integration.test.ts` pasa, `codebuddy --version` y `mcp list` funcionan desde una shell de TermCanvas, y `docs/adapter-guide.md` tiene la nueva sección. Cero llamadas a modelo.

**Estado Fase B — COMPLETADA (2026-08-28, sin Hydra como pediste):**
- `shared/phaseModels.ts` → `PhaseCli` + `DEFAULT_PHASE_CLIS` (todo `null` = opencode global default, backward compat) + `sanitizePhaseClis`/`resolveCliForPhase`.
- `shared/modelCatalog.ts` → `CliCatalogSource` + `ModelCatalog.source`, `electron/model-catalog.ts` con `Map<CliCatalogSource, PerCliState>` y `fetchCodebuddyCatalog` (17 built-ins + `~/.codebuddy/models.json` custom, `connected` = `codebuddy --version` ok).
- `electron/model-catalog-ipc.ts` + `electron/preload.ts` → `models:list-available(force, cli?)` / `validate-phase(..., cli?)` con default `opencode` para compat.
- `src/stores/preferencesStore.ts` + `phaseModelSync.ts` → `phaseClis` persistido en `termcanvas-preferences` y sync a `models:set-phase-clis` (no bloqueante, engine aún no lo consume — Fase C lo hará, pero ya no se rompe).
- `src/components/settings/PhaseModelsSection.tsx` → `CliCombobox` por fase (7 cards, `opencode (default)` + 6 CLIs, `phaseCliTui` sigue global). Si el CLI no está en `PATH`, el `ModelCombobox` se deshabilita con `no auth` pero la card no se rompe.
- Tests: `tests/phase-cli-per-phase.test.ts` **7/7** (sanitize, isPhaseCli, resolve, defaults, `which`/`where` real, headless/TUI resilience, per-CLI cache isolation) + `tests/model-catalog-multi-cli.test.ts` **6/6** (opencode vs codebuddy isolation, custom models.json).

**Estado Fase C — FIX routing multi-CLI (2026-08-29, bug en TODAS las fases):**
- **Bug:** `assertPhaseModelAvailable("diagnosisLlm")` y `gateModeloDeFase` validaban siempre contra `opencode` aunque `phaseClis[diagnosisLlm]="codebuddy"` → `[diagnosisLlm] El proveedor "codebuddy" no está disponible en esta instalación de opencode` en brief/requirements/synthesis/gapCheck/asrReview/tactics/diagnosisLlm.
- **Fix patron extensible (3 archivos, 0 if-else hardcodeado extra):**
  1. `shared/modelCatalog.ts` → `CliCatalogSource = Exclude<PhaseCli, null>` derivado de `PHASE_CLIS` (agregar CLI = 1 línea en `phaseModels.ts`).
  2. `electron/model-catalog.ts` → registry `CLI_FETCHERS` (`opencode`/`codebuddy` reales, resto stub genérico `isCliAvailable(cli)` + provider vacío). Cache/cooldown ya por CLI (`Map<CliCatalogSource, PerCliState>`). Seams test `__setCliAvailableOverride`/`__injectMockCatalog`/`__resetCatalogTestState` (no spawns reales en tests).
  3. `electron/model-catalog-ipc.ts` → `sanitizeCliParam` genérico (vs `cli==="codebuddy"?`), default `opencode`.
  4. `headless-runtime/interview/engine.ts` → `gateModeloDeFase` ahora `fetchModelCatalog(false, phaseCliRef(phaseId) ?? "opencode")`.
  5. `src/planner/modelPin.ts` → `assertPhaseModelAvailable` ahora resuelve `resolveCliForPhase` y pasa `cli` a `validatePhase`; flags via `formatModelForCli` + sets `CLI_MODEL_ID_ONLY`/`CLI_IGNORES_VARIANT` (codebuddy → `fast-model`, no `codebuddy/fast-model` — error 400 `service info not found`).
  6. `src/planner/planningSession.ts` → `buildHeadlessArgsForCli` exportado + `HEADLESS_KNOWN_CLIS` (todos `PHASE_CLIS`), `modelOverride` respeta `codebuddy` id-only.
- **Por qué el stub importa:** un CLI futuro (`gemini`/`kimi`/`wuu`) sin fetcher no rompe: `isCliAvailable` true → provider `kimi` existe pero 0 modelos → error `no existe en proveedor "kimi"` (accionable) vs `no está disponible en opencode`.
- **Tests alta calidad** `tests/cli-adapter.test.ts` **15/15**: cache aislado, builtins codebuddy, reproduce bug cruzado opencode-vs-codebuddy en las 7 fases, stub genérico, engine gate con CLI, flags por CLI, assert con CLI, headless registry, extensibility (ver `docs/model-routing-por-fase.md`).
- **Comando que antes fallaba y ahora funciona:**
  ```
  codebuddy -p --output-format json --model fast-model "<prompt>"   # no codebuddy/fast-model
  opencode run --model opencode-go/hy3 --variant max --auto "<prompt>"
  ```

**Estado Fase D — Harness neutro para entrevistas (2026-08-29, opencode podría morir mañana):**
- **Bug 2:** `interview:create` con `codebuddy/fast-model` daba `UnknownError Unexpected server error` en `engine.ts:21659` porque `headless-runtime/interview/engine.ts:422` `ensureClient` siempre levantaba `createOpencodeServer` aunque `phaseClis[requirements]="codebuddy"`. El gate pasaba (catálogo codebuddy) pero el runtime pedía `providerID:codebuddy` al server de opencode.
- **Fix:** `shared/neutral/interview.ts` contrato `HarnessInterviewAdapter` (`ensureReady`/`createSession`/`promptStructuredRaw`/`deleteSession`/`close`) + `headless-runtime/interview/harness/opencode.ts` (server efímero movido tal cual) + `harness/codebuddy.ts` (`spawn("codebuddy", ["-p","--output-format","json","--model",modelID, promptConSchema])` + parse JSON con fallback ```json + heurisitca `{result}` + detecta `Authentication required`/`service info not found` con mensajes accionables) + `harness/index.ts` registry `getInterviewHarness(id)` + `engine.ts:407` `getHarnessForPhase(phaseId)` que elige harness vía `phaseCliRef` (opencode por default, codebuddy si el usuario lo eligió). `promptStructuredInner` ahora hace `await harness.ensureReady()` + `harness.promptStructuredRaw` con reintentos y `recreadaPorOverflow` preservados; `info.error` (model error) falla directo `error del modelo (APIError)` sin reintentar como antes, `respuesta.error` (red) sí reintenta.
- **Por qué cuesta pero vale:** el próximo `mycli` entra con `harness/mycli.ts` + `registerInterviewHarness(mycliHarness)` + `PHASE_CLIS.push("mycli")`, cero cambios en `engine.ts`. `interview-engine-mock.test.ts` **17/17** sigue pasando (APIError y overflow determinista preservados).
- **Tests:** `tests/cli-adapter.test.ts` **15/15** ahora mockea harnesses via `__setTestHarnessForInterview` y verifica que `codebuddy/fast-model` va a `codebuddy` harness y `opencode` va a `opencode` harness.

---

## 7. Referencias

- CodeBuddy MCP: `https://www.codebuddy.ai/docs/cli/mcp` + `codebuddy mcp add --help`
- CodeBuddy Skills: `https://www.codebuddy.ai/docs/cli/skills` + `https://www.codebuddy.ai/docs/ide/Features/Skills`
- CodeBuddy Models: `https://www.codebuddy.ai/docs/cli/models` (custom `models.json` con `url/apiKey/supportsToolCall`)
- CodeBuddy Dir: `https://www.codebuddy.ai/docs/cli/codebuddy-dir`
- Opencode MCP: `electron/mcp/opencode-sync.ts`, `opencode-reader.ts`
- Neutral: `shared/neutral/*`, `shared/mcp.ts`, `src/skills/registry.ts`

> **Regla de oro:** Si el próximo harness te hace dudar si es archivo o CLI, es CLI. Haz `help` primero.
