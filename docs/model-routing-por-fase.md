# Routing de modelo por fase (multi-CLI)

> **Estado (agosto 2026):** implementado WU1-WU7 + Fase B multi-CLI (opencode + codebuddy, extensible). Cada fase puede elegir **CLI** y **proveedor/modelo**, con validación ANTES de gastar llamadas. Config: **Settings → Agent → Models per phase**.

## Problema que resuelve

Tres caminos de IA conviven y ninguno era cambiable sin editar código:

1. **Motor de entrevista** (brief, requirements, synthesis, gapCheck, asrReview, tactics): `opencode-go/hy3` / `deepseek-v4-flash`.
2. **Fases CLI** (Diagnóstico LLM): sesiones `opencode run` SIN pin — usaban el default global.
3. **Agente embebido** (chat): BYOK global, fuera del routing.

Si un modelo desaparecía, la fase fallaba a mitad con error crudo. Con multi-CLI, elegir `codebuddy/fast-model` contra el catálogo de `opencode` daba `[diagnosisLlm] El proveedor "codebuddy" no está disponible en esta instalación de opencode.` **en todas las fases** — el gate validaba siempre contra `opencode`.

## Cómo funciona (actualizado)

```
Settings UI ──setPhaseModel/setPhaseCli──> preferencesStore (localStorage)
      │                                          │  │
      │                     models:set-phase-overrides│  └─ models:set-phase-clis (IPC)
      v                                          v     v
PhaseModelsSection (CLI per phase)      main process (engine gate + CLI gate)
      ^                                          │
      └── models:listAvailable(cli) ─── model-catalog.ts (cache TTL 5min POR CLI)
           models:validate-phase(cli)
```

- **Contrato**: `shared/phaseModels.ts` — `PhaseId`×7, `ModelRef`, `PhaseCli`, `PHASE_CLIS`, `DEFAULT_PHASE_MODELS/CLIS`, `resolveModelForPhase`/`resolveCliForPhase`. Fuente única: agregar un CLI = añadir 1 string a `PHASE_CLIS`.
- **Catálogo** (`electron/model-catalog.ts`): cache + TTL + cooldown **por CLI** (`Map<CliCatalogSource, PerCliState>`). Registry `CLI_FETCHERS`:
  - `opencode`: server efímero `provider.list()` normalizado.
  - `codebuddy`: `isCliAvailable("codebuddy")` + 17 built-ins + `~/.codebuddy/models.json` opcional. `connected = binary disponible`.
  - Otros (`claude/codex/gemini/kimi/wuu`): stub genérico `isCliAvailable(cli)` + provider vacío conectado si el binario existe. Añadir fetcher real = 1 entrada en `CLI_FETCHERS`, cero cambios en callers.
  - IPC (`model-catalog-ipc.ts`) valida `cli` vía `sanitizeCliParam` (derivado de `PHASE_CLIS`), default `opencode` por compat.
- **Motor SDK** (`headless-runtime/interview/engine.ts`): `promptStructured` resuelve `phaseModelRef` y hace gate contra `fetchModelCatalog(false, phaseCliRef(phaseId) ?? "opencode")`. Best-effort: catálogo caído no bloquea.
- **Fases CLI** (`src/planner/modelPin.ts` + `planningSession.ts`):
  - Gate `assertPhaseModelAvailable(phaseId)` resuelve `resolveCliForPhase` y valida contra ese CLI (fix del bug en todas las fases).
  - Flags: `runModelFlagArgs(ref, cli)` usa `formatModelForCli` — `codebuddy` → `modelID` solo (`fast-model`, no `codebuddy/fast-model` — error 400), otros → `provider/model`; variant ignorada solo en `codebuddy`.
  - Headless: `buildHeadlessArgsForCli(cli, flags, prompt, resumeId)` registry (`opencode: run --auto`, `codebuddy: -p --output-format json`, `claude: -p ...`, `codex: exec --json`...). Desconocido → cae a TUI.

## Fases y defaults (sin cambios)

| PhaseId | Fase | Default | CLI default |
|---|---|---|---|
| `brief` | Brief | `opencode-go/hy3` | `null` → opencode |
| `requirements` | Turnos | `opencode-go/hy3` | `null` |
| `synthesis` | Síntesis (+ gapCheck `deepseek` sin variant, ASR `hy3`, tactics `hy3`) | `opencode-go/deepseek-v4-flash`+`max` | `null` |
| `diagnosisLlm` | Diagnóstico LLM | `null` (global del CLI) | `null` |

`null` = sin pin: usa default global del CLI elegido. Sin overrides, nada cambia.

## Uso

1. Settings → Agent → Models per phase: por cada fase elegir **CLI** (dropdown `opencode (default)` + `codebuddy/claude/...`) y luego **provider/model**.
2. El `ModelCombobox` muestra el catálogo del CLI elegido; proveedores sin auth deshabilitados.
3. Validación inline: `validatePhase(phaseId, overrides, cli)` contra el catálogo de ese CLI; `Probar` dry-run muestra el comando exacto sin gastar créditos (`codebuddy -p --output-format json --model fast-model "<prompt>"` vs `opencode run --model opencode-go/hy3 --auto "<prompt>"`).
4. Refresh invalida cache del CLI correspondiente.

## Guía para añadir un CLI (patrón Fase C)

1. `shared/phaseModels.ts`: añadir id a `PHASE_CLIS` (ej. `"mycli"`).
2. `shared/modelCatalog.ts`: `CliCatalogSource` se deriva solo — no tocar.
3. `electron/model-catalog.ts`: si tiene catálogo real, implementar `fetchMyCliRaw()` y registrarlo en `CLI_FETCHERS["mycli"] = fetchMyCliRaw`. Si no, el stub genérico ya funciona (binary check).
4. `src/planner/modelPin.ts`: si el CLI tiene dialecto distinto, añadir a `CLI_MODEL_ID_ONLY` / `CLI_IGNORES_VARIANT`.
5. `src/planner/planningSession.ts`: añadir caso en `buildHeadlessArgsForCli` para su headless.
6. `electron/model-catalog-ipc.ts` y `headless-runtime/interview/engine.ts`: ya genéricos (vía `PHASE_CLIS`/`phaseCliRef`) — no tocar.
7. Tests: añadir casos en `tests/cli-adapter.test.ts` (cache per-CLI, validación cruzada, flags).

## Límites

- TUI ignora `--variant` en todos los CLIs.
- Stub genérico para CLIs sin fetcher: provider existe si el binario está en PATH, pero sin modelos listados — el gate fallará por modelo inexistente (más accionable que provider inexistente).
- `isCliAvailable` usa `execSync("cli --version")` + fallback `where/which`; en Electron el PATH puede diferir de la shell — override testeable vía `__setCliAvailableOverride` para tests.

## Tests

- `tests/phase-models.test.ts`, `preferences-store.test.ts`, `model-catalog.test.ts`, `interview-model-routing.test.ts`, `planner-model-pin.test.ts`, `phase-model-options.test.ts` — base.
- `tests/cli-adapter.test.ts` (nuevo, 15 tests): cache aislado por CLI, builtins codebuddy, bug reproduce (opencode vs codebuddy), stub genérico, engine gate con CLI, flags por CLI, assert con CLI, headless registry, extensibility.
