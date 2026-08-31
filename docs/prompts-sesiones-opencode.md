# Prompts inyectados en sesiones de opencode (TermCanvas)

Reporte de todos los prompts que el proyecto TermCanvas inyecta al abrir
sesiones de opencode, agrupados por propósito. Cada sección indica el archivo
fuente y cómo llega el prompt a la sesión.

## 1. Inyección permanente — TODA sesión de opencode en el repo

Se inyectan automáticamente sin importar el propósito del terminal.

| Prompt | Fuente | Cómo se inyecta |
|---|---|---|
| `AGENTS.md` (raíz) | `AGENTS.md` (Hydra Orchestration Toolkit + TermCanvas Pin System) | opencode lo lee del cwd; es idéntico a `CLAUDE.md` (mismo tamaño 9238 B) |
| Skills del repo | `skills/skills/*/SKILL.md` (`using-termcanvas` con `alwaysApply: true`, `hydra`, `challenge`, `investigate`, `security-audit`, `code-review`, `qa`) | Expuestos vía `.agents/skills/termcanvas` → symlink a `../../skills/skills`; el CLI de agente los carga como skill |
| Índice de memoria | `skills/scripts/memory-session-start.sh` | Hook `SessionStart` (`skills/hooks/hooks.json`) → GET `http://127.0.0.1:<port>/api/memory/index?worktree=...` (servido por `headless-runtime/api-server.ts:489`) → se inyecta como `additionalContext` (bloque `<memory-graph>`) |

## 2. Prompt del asistente embebido (Agent Bubble / sesiones internas)

| Prompt | Fuente |
|---|---|
| `SYSTEM_PROMPT` estático ("You are an AI assistant embedded in TermCanvas...") | `electron/agent-service.ts:36` — se pasa como `systemPrompt` a `agentLoop` |
| Compresión de contexto ("You are a conversation summarizer. Be concise...") | `agent/src/compaction.ts:121` |

## 3. Prompts de orquestación de issues (worktrees de issues en el canvas)

Prompts de UNA línea (separador ` | `, porque opencode rompe `--prompt` con
saltos de línea en Windows). Se pasan como `initialPrompt` del terminal
(`--prompt` en `terminal create`), desde el worktree del issue.

| Propósito | Constructor | Archivo | Notas |
|---|---|---|---|
| **Planificación** (roadmap/audit) | `buildPlanningPrompt()` | `src/planner/planningPrompt.ts` | Entregable: JSON en `.agents/planning/plan-<ts>.json`; schema de proposals/findings con `blockedBy/blocking/duplicateOf/existingIssueNumber` |
| **Resolver issue** (nuevo) | `buildIssueResolvePrompt(mode: "new")` | `src/canvas/issueResolvePrompt.ts` | TDD, work-unit commits, logging con prefijo `[fix-...]`, no cerrar issue manualmente |
| **Retomar issue** (resume) | `buildIssueResolvePrompt(mode: "resume")` | `src/canvas/issueResolvePrompt.ts` | Mismo prompt + "retomá el trabajo en curso"; `resolveIssueWorktree.ts:188` usa `resumePrompt ?? initialPrompt` |
| **Revisar solución** | `buildIssueReviewPrompt()` | `src/canvas/issueReviewPrompt.ts` | Postea review vía `gh api /pulls/{pr}/reviews`; veredicto binario `VEREDICTO: APROBADO/CAMBIOS_PEDIDOS`; anti-duplicado por `headRefOid`; reglas `NO_WRAPPER_RULE`, `VERDICT_RULE`, `NO_DUP_BY_OID_RULE` |
| **Aplicar fix de review** | `buildIssueFixPrompt()` | `src/canvas/issueFixPrompt.ts` | Aplica cambios al MISMO PR; clasifica observaciones bloqueantes/no bloqueantes; reply punto por punto con `gh pr comment` |
| **Resolver conflicto de merge** | `buildResolveConflictPrompt()` | `src/canvas/resolveConflictPrompt.ts` | Merge manual de `origin/main` en la rama del PR, commit `merge: resolve conflicts...`, push al PR existente |

### Sección compartida en los 5 flujos

`buildRepoContextSection()` (`src/utils/repoContext.ts:21`) — antecede a cada
prompt de orquestador con la referencia a `.agents/repo-context.md` (propósito
e intenciones del repo escritas por el usuario). No se inyecta el contenido:
el agente lo lee desde el worktree.


## 5. Prompts de evaluación (eval/ — no son sesiones interactivas)

| Propósito | Prompt | Archivo |
|---|---|---|
| Agente único | "You are a senior software engineer. Fix the following issue in this repository." | `eval/src/agents/single.ts:14` (`buildPrompt`) |
| Descomposición | "You are a task decomposition engine. Analyze this issue and break it into independent sub-tasks." (responde solo JSON array) | `eval/src/agents/hydra.ts:216` |
| Sub-agente eval | "You are working on a sub-task for the {repo} repository..." | `eval/src/agents/hydra.ts:300` |

## 6. Otros prompts de soporte

| Propósito | Prompt | Archivo |
|---|---|---|
| Spike de subprocess | `TASK_MD` (crear 3 archivos: hello.txt, report.md, result.json con schema exacto) | `hydra/scripts/spike-subprocess-worker.ts:66` |
| Prompt del coordinador | `buildCoordinatorPrompt()` — agente que orquesta workers (secciones: Role, Available Tools, Worker Capabilities, Task Workflow, Worker Prompts, Continue vs Spawn, Failure Handling, Cost Awareness, Approval Handling) | `agent/src/coordinator-prompt.ts:19` (exportado; es la pieza "coordinator agent" del runtime) |
| Compresión estática/dinámica | `buildFullSystemPrompt()` (parte estática + `<!-- dynamic-boundary -->` + parte dinámica) y `buildSystemReminder()` (`<system-reminder>` como mensaje user efímero) | `agent/src/context-injection.ts:20,25` |

## Resumen de rutas

```
AGENTS.md / CLAUDE.md                    → toda sesión (contexto de repo)
skills/skills/*/SKILL.md                 → toda sesión (skills)
skills/scripts/memory-session-start.sh   → SessionStart → <memory-graph>
electron/agent-service.ts:36             → SYSTEM_PROMPT asistente embebido
src/planner/planningPrompt.ts            → terminal planning (roadmap/audit)
src/canvas/issueResolvePrompt.ts         → terminal resolver issue (new/resume)
src/canvas/issueReviewPrompt.ts          → terminal revisar solución
src/canvas/issueFixPrompt.ts             → terminal aplicar fix
src/canvas/resolveConflictPrompt.ts      → terminal resolver conflicto
src/utils/repoContext.ts                 → sección CONTEXTO DEL REPOSITORIO (compartida)
hydra/src/roles/builtin/*.md             → persona de workers Hydra (lead/dev/designer/reviewer/qa/janitor)
hydra/src/run-task.ts                    → task.md de cada run Hydra
hydra/src/prompt.ts                      → task file + input de spawn
agent/src/context-injection.ts           → system prompt estático/dinámico + system-reminders
agent/src/coordinator-prompt.ts          → prompt del agente coordinador
agent/src/compaction.ts                  → prompt de resumen/compresión
eval/src/agents/{single,hydra}.ts        → prompts de evaluación
hydra/scripts/spike-subprocess-worker.ts → spike de subprocess worker
```
