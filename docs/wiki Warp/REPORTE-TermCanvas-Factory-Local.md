# Reporte: Warp Factories → TermCanvas Factory Local (Nube Local Gratis con OpenCode)

> **Fecha:** 2026-08-31 — **Fuentes:** `docs/wiki Warp/WarpFactories.md` (19 secciones, basado en `https://docs.warp.dev/factories/` Early Access 2026-08-18, docs actualizadas 2026-08-28), `WarpFactories-UserStories.md` (155 US, 18 épicas, ~410 puntos), `WarpFactories-Tickets.md` (16 tickets T01–T16, 39 archivos / 902 tests, `pnpm --filter web check` verde)  
> **Objetivo del solicitante:** no abrir terminales/headless dispersos; tener **un servidor OpenCode corriendo en local (127.0.0.1)** al que se le mandan sesiones y fases como jobs en background, chequeables en vivo (logs como TUI) — gratis, sin cloud. Al dar “Implementar” se lanza un agente con su sesión en la “nube local” y se puede tail -f.  
> **Método de investigación:** 3 agentes en paralelo (core SDLC + skills/automations/definitions/runners + API/MCP/infra/dashboard) + 1 agente TermCanvas (lectura de `electron/*`, `headless-runtime/*`, `shared/*`, `src/planner/*`, `docs/*.md`, `harness-design-essay.md`, `server/Dockerfile`). Este reporte sintetiza todo.

---

## Índice

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Warp Factories — Cómo Funciona (extraído de los 3 docs)](#2-warp-factories--cómo-funciona)
3. [Inputs / Outputs / Formatos Exactos (qué se le pasa, qué devuelve, cómo se gestiona)](#3-inputs--outputs--formatos-exactos)
4. [TermCanvas Hoy — Arquitectura OpenCode Real](#4-termcanvas-hoy--arquitectura-opencode-real)
5. [Tu Objetivo Traducido: Warp → TermCanvas Factory Local](#5-tu-objetivo-traducido-warp--termcanvas-factory-local)
6. [Propuesta Arquitectura Factory Local Gratis (diseño concreto)](#6-propuesta-arquitectura-factory-local-gratis)
7. [Qué Extraer YA de Warp y Qué Descartar](#7-qué-extraer-ya-de-warp-y-qué-descartar)
8. [Plan Incremental (Tracer Bullets)](#8-plan-incremental-tracer-bullets)
9. [Riesgos, Decisiones y Próximos Pasos](#9-riesgos-decisiones-y-próximos-pasos)
10. [Referencias y Evidencia](#10-referencias-y-evidencia)

---

## 1. Resumen Ejecutivo

**Warp Factories** no es “un agente que corre en tu laptop”. Es **una fleet en la nube** donde:
- Una **factory** = instancia desplegada (repos + agents + runners + automations + skills) con **una sola policy**.
- Un **foreman** (único que habla con el humano) enruta work entre agentes especialistas (`triage → spec → implement → review` + custom `VERIFY`).
- Cada **work item** mantiene identidad de intake a handoff aunque lo toquen N agentes; cada **run** (ejecución de un agente) es un cloud agent run inspeccionable (timeline, costo, sub-agents, `View session`).
- Todo se define **as code** (`factory.yaml` + `agents/*/agent.md` + `automations/*/automation.md` + `runners/*.yaml` + `scorers/*/scorer.md` + `skills/*/SKILL.md`) versionado en Git, validado con `warp/factory-config` file+line y JSON Schema `v1alpha1` unauthenticated.
- El routing es por **automations**: `provider + event + filters` con matching **AND entre filtros, OR dentro de filtro, vacío = match todo**. Slack/Linear resuelven nombres → IDs. Un evento puede disparar **N automations → N runs** (overlapping warning).
- La factory expone **Factory MCP** (19 tools, `https://app.warp.dev/api/v1/mcp/factory` streamable HTTP, `Bearer` para headless) y **Factory API REST** (`GET /factory?search`, `POST /factory/{uid}/runs` con `prompt` required + `ticket_ref` regex `^[a-z]+:[A-Za-z0-9-_]+$`).
- Infra es **control plane (Warp siempre) vs execution plane (Warp-hosted sandbox o managed self-hosted worker Docker/K8s/Direct, outbound only, OTel)**. Metering por credits; self-hosted/BYO mueve compute/inference pero platform services siempre consumen credits.

**TermCanvas hoy** es lo opuesto: **disperso y efímero**. Cada fase levanta su propio PTY (`node-pty`, `xterm.js`, `OutputBatcher` 8ms) o su propio `createOpencodeServer({hostname:"127.0.0.1", port:20000-45000, timeout:30s})` random, sin queue, sin logs persistentes, con argv 32K cap que obliga a `prompt.md` sidecar, y con polling file `/.agents/planning/diagnostico-*.json` 30min. Headless en nube sí tiene `HeadlessApiServer` en `7080` con `Bearer`, WebSocket `/pty/stream` y SSE, pero desktop no.

**Tu idea (nube local gratis) es exactamente el Pattern 3 de Warp llevado a local:** un **único daemon OpenCode persistente en 127.0.0.1** (reemplaza los servers efímeros), con **queue + job store + logs streaming** (reemplaza PTYs dispersos). Cada “Implementar” encola un **job** (`prompt` + `repo/worktree` + `phase/model/cli`) que un worker pool ejecuta contra el daemon, escribiendo `logs.ndjson` taileable y `result.json + .done` como contrato. La UI deja de ser xterm y pasa a ser **Factory Dashboard local** (lista queue/running/done + drawer de logs SSE). Es gratis porque el execution plane es tu máquina; el control plane también es local (no hay Warp coordination ni credits).

Este reporte detalla **qué valores y archivos Warp consume/devuelve, en qué formato y cómo se gestiona**, y propone **cómo replicarlo en TermCanvas con OpenCode sin pagar Warp**.

---

## 2. Warp Factories — Cómo Funciona

### 2.1 Visión y Entidades Core

| Entidad | Definición precisa (doc §2) | Cardinalidad / Identity |
|---|---|---|
| **Warp Factories (producto)** | Fleet de agentes en nube que convierte requests → PRs mergeables. Early Access por team, credits, $10k qualifying. Coordina en `build.warp.dev`. | Producto único |
| **Factory** | Instancia desplegada: repos + tools + agents + runners. **Una policy por factory**; si necesitas policies distintas → factories separadas. Sizing por **product surface** (app / marketing / pipelines), anti-patrón partir mismos repos por equipo. | `factory.yaml: name` + `alias` (Foreman name). N por team |
| **Foreman** | **Único que habla con humano** (Slack/Linear/GitHub/Jira/MCP). Despacha, pasa contexto, **continúa conversaciones existentes** (reply en mismo thread/issue/PR continúa mismo work item). Presenta PR final + marca `Complete` (handoff, **no merge**). | `alias` máx 60 chars regex `[A-Za-z0-9 ._-]` + espacios, único case-insensitive por workspace. Default copia `factory.name`. `Settings → Identity → Foreman name`. `agentType: FOREMAN` alias `MAIN` |
| **Work Item / Task** | Request individual (issue, ticket, PR, MCP task). **Mantiene identidad intake → handoff** aunque N agentes contribuyan. “Task” es el nombre en Factory MCP. | ID interno. Estados `Triage → Planning → Building → Reviewing → Complete / Cancelled` (Activity kanban). Cada stage-run inspeccionable |
| **Run** | Ejecución individual de un agente. Un work item spanea N runs. Cada run es **ordinary cloud agent run** (timeline, costo, sub-agents si orchestrator). `View session` abre shared session (steer en vivo si sandbox activo, luego transcript). Run pages **no incluyen chat input**. | ID run, inspeccionable |
| **Agent** | LLM + harness + instrucciones durables + runner + secrets + MCPs + skills | Nombre = directorio `agents/<name>/` |
| **Skill** | Directorio con `SKILL.md` (frontmatter + argument syntax Warp estándar). Factory-wide o per-agent | `skills/<name>/SKILL.md` o `agents/<name>/skills/<name>/SKILL.md` |
| **Automation** | Resource que inicia runs desde trigger → agente, con filtros + optional schedule | Nombre = directorio `automations/<name>/` |
| **Runner** | Compute: OS, arch, image, shape | Nombre = filename `runners/<name>.yaml` |
| **Environment** | Workspace: repos, setupCommands, image. **Distinto de Runner y Host** | `factory.yaml: repositories`, `agentDefaults.environmentId` |
| **Host / workerHost** | Dónde ejecuta: `warp` vs `SELF_HOSTED_WORKER_ID` | `agentDefaults.workerHost` / per-agent / per-automation |
| **Scorer / Benchmark / Self-Improvement** | Medición y mejora continua (LLM judge, comparativa, PRs auto) | `scorers/<name>/scorer.md` |

### 2.2 SDLC — Ciclo de Vida del Work Item (§3)

```
Intake → Foreman → Triage → Decision{¿Plan needed?} ──No──→ Building → Reviewing → Revision{¿needed?} ─Sí→ Building
                        │Sí                                └─No→ Human Handoff → Complete / Cancelled
                        └──→ Planning → Human Approval Gate ──→ Building
```

Loop extendido Warp: `triage → spec → implement → review → verify → ship → monitor` (defaults cubren triage→review; `VERIFY` existe como `agentType` pero no es default).

| Stage | Agente | Qué produce | Skip / Gate |
|---|---|---|---|
| **Intake** | — | Work item con source context (Slack thread, GitHub issue, Linear, etc.). Repeated deliveries **no duplican**: reply continúa mismo work item | — |
| **Triage** | Triage | `evidence`, `scope`, `complexity`, `open questions`. **Reproduce solo si investigación no alcanza** | **Foreman skipea** si request ya explica problema + cambio esperado |
| **Planning** | Spec | Product + technical specs + **validation criteria** en **draft PR** (`factory/<slug>` branch) | **Foreman skipea** para cambios pequeños bien entendidos |
| **Building** | Implement | **Continúa branch/PR del spec (no de cero)**. Code + tests + validación repo + **evidencia visual** si `computer use` + user-facing. **Nunca mergea**. Si review pide cambios → implement revisa | Approval gate: si pasó por Planning, **Building no inicia sin approval humano** (`Waiting for approval`) |
| **Reviewing** | Review | Check requirements/conventions/tests/security/evidencia. Re-ejecuta validación si evidencia fina. Recommendation `accept / revise / ask human`. **Advisory — no aprueba ni mergea** | — |
| **Handoff** | Foreman | Presenta evidencia + findings. `Complete` = handoff, **no merge**. `Cancelled` terminal | Branch protection + repo permissions enforcean merge (no las instructions) |

**Invariante de seguridad (§3):** qué puede alcanzar un agente viene de **configuración** y permisos del provider (GitHub App, bot membership, secrets allowlist, MCPs), **nunca de instructions**.

### 2.3 Agentes (§4)

| Agente | Built-ins | Qué optimizar |
|---|---|---|
| Foreman | GitHub + Slack | Orchestration, long-running conversations |
| Triage | GitHub | Research, evidence gathering |
| Spec | GitHub | Síntesis requirements, technical reasoning |
| Implement | GitHub | Coding strength, harness que matchee toolchain |
| Review | GitHub | **Modelo/harness distinto a Implement** para evitar blind spots |
| Custom `VERIFY` | Ninguno (definir skills) | Docs, security, migrations, release checks; no required para todo work item |

**Config por agente (`Factory → Agents → <agent>`):** `description`, `harness`, `model`, `runner`, `workerHost`, `mcpServers`, `secrets`, `instructions` (body Markdown de `agent.md`).

**Dónde vive según modo:**

| Modo | Dónde | Dashboard |
|---|---|---|
| Warp-managed (default) | Repo hosteado por Warp | Editable, valida+commitea en un paso, nunca inválido |
| GitHub-backed | `factory.yaml` + `agents/<name>/agent.md` en tu repo | **Read-only**, linkea archivos |
| Live-managed | Sin archivos (API) | No existe Factory definition tab |

**Harness por agente:** `Warp Agent` (`oz`), `Claude Code` (`claude`/`claude-code`), `Codex`, `Gemini`. Free → solo `oz`; desde Build plan → third-party. `reasoningLevel` **solo para `codex`** (`high`); `auth` **solo para third-party** (`managedSecret` con `secretName` o `workerEnvironment` que requiere self-hosted `workerHost`). Foreman en Claude/Codex igual despacha a otros.

### 2.4 Skills (§5)

```
skills/repository-conventions/SKILL.md          # factory-wide → todos
agents/foreman/skills/incident-triage/SKILL.md  # per-agent → solo foreman
```

Mismo formato `SKILL.md` que en cualquier parte de Warp (frontmatter + argument syntax). Customs **extienden** baseline (GitHub/Slack/tracker), no lo reemplazan. **Skill cambia qué sabe hacer, no qué puede alcanzar** (scoping via `secrets`/`mcpServers`). Self-improvement puede **editar la skill** y abrir PR con `Regressions addressed`.

### 2.5 Automations (§6)

**Matching formal:**

- **Todos los filtros deben matchear (AND).** Trigger con `team` + `label` → solo eventos con ambos.
- **Dentro de un filtro, cualquier valor matchea (OR).** `labels: [bug, regression]` → con cualquiera.
- **Filtro vacío = match todo.**
- **Un evento puede matchear N automations → N runs.** Overlapping `app_mention` + `message_posted` en mismo channel → 2 runs → narrow/remove.

**Filtros no controlan acceso.** Acceso viene de provider authorization. Filtros sí controlan **quién inicia runs** (GitHub/GitLab author no necesita ser Warp member → usar `author/member/branch`).

**Qué puede filtrar cada source:**

| Source | Filtros |
|---|---|
| Slack | Conversations, authors/members, keywords, emoji, reacted-message authors |
| GitHub | Repository, branches, base branches, paths, labels, authors, assignees, mentioned users/teams, reviewers, review states, workflows, conclusions |
| GitLab | Project, actions, base branch |
| Linear | Teams, labels, project, workflow state, assignee, mentioned user (+ specific issue para comment events) |
| Jira | Jira projects, assignment keywords (case-insensitive) |

Slack/Linear filters toman **nombres** y Warp resuelve a IDs. Schedule: `provider: schedule, event: cron_fired, schedule: {name, cron: "0 9 * * 1" | "@daily" | "@every 1h"}` siempre UTC. Factory: `provider: factory, event: work_item_stage_changed`.

### 2.6 Definitions as Code (§7) — ver detalles en §3

### 2.7 Runners e Infra (§8)

- Runner = compute (`os`, `arch`, `dockerImage`/`mac.version`, `instanceShape`).
- Límites hosted: **32 vCPUs / 64 GiB** (todos los planes igual; Enterprise hasta 32/64, más requiere soporte; **self-hosted exempt**).
- Concurrencia Warp-hosted **limitada por team → exceso queueado**. Self-hosted OTel: `worker health, task throughput, capacity saturation`.

**Environment vs Runner vs Host:**

| Concepto | Qué es | Dónde |
|---|---|---|
| Environment | Workspace: repos, setupCommands, secrets, image | `factory.yaml` + repo |
| Runner | Compute: OS/arch, shape, image | `runners/<name>.yaml` |
| Host | Dónde ejecuta: `warp` o `SELF_HOSTED_WORKER_ID` | `agentDefaults.workerHost` / per-agent / per-automation |

Un run = `Environment + Runner + Host`. CLI `oz runner create --arch auto` vs factory `arch: x86_64/aarch64`.

### 2.8 Integraciones (§9)

**Mapa general:** `Event → Matching automation → Foreman → Work Item → Results posted back`. Reply en mismo thread/issue/PR **continúa** work item. Repeated deliveries no duplican.

| Provider | Ruta | Filtra | Notas |
|---|---|---|---|
| Slack | `app_mention`, `message_posted`, `message_dm`, `reaction_added`, `member_joined_channel` | Conversations/authors/keywords/emoji | App invitada por channel + `linked account` required + Home tab kanban + edits ignorados |
| GitHub | 20 events (issues 4 + PRs 9 + reviews 2 + code/CI 5) | 12 filtros (Branches, Base branches, Paths, Labels, Authors, Assignees, Mentioned, Reviewers, Review states, Workflows, Conclusions) | **Dual requirement**: `factory:<alias>` label **y** `@warp-factory` mention en new content (edits/code blocks/bots ignorados). App installation decide reach. `warp/factory-config` check file+line. PRs respetan branch protection |
| GitLab | `merge_request`, `bot_mentioned` | Project/Actions/Base branch (bot_mentioned solo repos) | GitLab.com only + Premium/Ultimate, manager + bot `<alias>-warp-<id>` Developer, `GitLab no puede hostear definition` |
| Linear | `issue_created/labeled/state_changed/assigned`, `comment_created`, `agent_session_created` | Teams/labels/project/workflow/assignee/mentioned + specific issue | OAuth, default `agent_session_created` narrow solo en files, warning `agent_session + comment_created` → 2 runs |
| Jira | `agent_session_created` only | `project_keys` + `keywords` case-insensitive | Cloud only + Rovo, offered to every automation |
| Schedule/Factory | `cron_fired` / `work_item_stage_changed` | Cron UTC | — |
| Factory MCP/API/Direct | — | — | — |

### 2.9 Factory MCP (§12)

- Endpoint: `https://app.warp.dev/api/v1/mcp/factory` (streamable HTTP). Warp maneja auth; headless usa `Bearer YOUR_API_KEY`. **Sin read-only ni per-factory scopes** (full permissions).
- Prompt onboarding canónico: `Set up a factory for me. Read https://docs.warp.dev/factories/factory-mcp.md...`
- **19 tools:** `list_factories`, `get_factory_file_schema`, `validate_factory_files`, `list_teams`, `create_team`, `join_team`, `get_team_funding_status`, `list_forge_repositories`, `list_tracker_scopes`, `start_connection`, `get_connection_status`, `create_factory`, `list_tasks`, `search_task`, `get_task`, `message_foreman`, `get_conversation`, `send_task`, `list_notification_routes`, `complete_task` (doc lista 20 pero stub local son 19).
- **Flujo 5 pasos:** `send_task {factory, title, note}` (push branch/PR primero si hay local changes, referenciar en note) → `get_task {start_working:true}` → worktree guidance (factory **nunca modifica files**) → `message_foreman`/`get_conversation` (sin mover task) → commit+push → `send_task {taskID, branch/PR URL, note}` hand-back → `complete_task`. **Picking up no claimea/lockea/pausa** → chequear active runs.

### 2.10 Factory API (§19)

| Endpoint | Método | Qué recibe | Qué devuelve |
|---|---|---|---|
| `/api/v1/factory` | GET | `?search=` case-insensitive sobre `name`/`alias` | `{factories: [{uid, name, alias, repositories}]}` |
| `/api/v1/factory/{uid}` | GET | `uid` | factory detail |
| `/api/v1/factory/{uid}/runs` | POST | `prompt` **required**, `title` optional (derivado de prompt si omitido), `ticket_ref` optional `^[a-z]+:[A-Za-z0-9-_]+$` (ej `linear:PAY-123`), `ticket_url` optional URL | `{runId, taskId, status: queued|running, dashboardUrl}`. Server resuelve foreman |
| `/api/v1/agent/runs/{runId}` | GET | `runId` | `{status, cost, timeline, outputs:{prUrl}}` |
| `/api/v1/agent/runs/{runId}/followups` | POST | `{prompt}` | continue |
| `/api/v1/agent/runs/{runId}/cancel` | POST | — | cancel |
| `/api/v1/agent/run` | POST | `{prompt}` | standalone run |

Auth `Authorization: Bearer YOUR_API_KEY`. Run dispatched = **ordinary cloud agent run**. SDK `OzAPI` (`client.factories.runs.create`). Curl ejemplos en §19. Stub local usa mismos paths para swap drop-in.

### 2.11 Infra/Deployment/Dashboard/Measure

- **Control vs Execution:** Control (coordina, identity, observabilidad, inference routing) siempre Warp. Execution (checkout, commands, filesystem) en Warp-hosted sandbox **o** managed self-hosted worker (Docker/K8s/Direct). Worker **outbound a Warp, sin inbound port**. Private services vía worker network.
- **ZDR warning:** self-hosting mueve **solo execution**; prompts/results/transcripts/artifacts/telemetry **siguen por Warp/providers bajo ZDR** — no es offline. Transcripts vía Warp backend ZDR.
- **3 choices independientes (Enterprise):** Execution / Inference (BYO limitado a providers cloud agents) / Storage (S3/GCS para transcripts/artifacts, pero config/metadata queda en Warp).
- **4 credential boundaries:** Inference (solo inference, nunca sandbox), Execution secrets (per-agent allowlist + redaction backstop), Harness auth (separado), Repository identity (`EXECUTOR` default vs `CREATOR`).
- **Deployment patterns:** 1 CLI-only (bring your own), 2 Warp-hosted, 3 Self-hosted (managed worker).
- **Dashboard (Activity/Runs/Settings):** 8 métricas con disclaimers (Total runs, PRs opened/merged `merged puede > opened`, Autonomy `open=push`, Cycle time medianas no suman, Cost per PR `estimate S/M/L/XL 100/500/1000`, Most expensive, Scorer cards, 3 newest Self-improvement sin date filter). Activity kanban `Created by=you` default + 4 active stages, detail `View agent / Event history / Stop task` **sin confirmación**. Runs team vs factory, `New → foreman`, timeline/cost/Sub-agents/`View session` steer. Factory definition solo Warp-managed; Settings `Identity/Foreman name/Repositories/PW authorship/Analysis model/Runners/Integrations/Deletion` no reversible.
- **Scorers:** LLM judge `scorers/<name>/scorer.md` (identity = `name` field). Campos: `agents ≥1`, `labels {value, score 0..1}`, `passingScore`, `samplingRate` default 25 (0 = stop auto, manual sigue), `model`, `selfImprovement` default false. Invariante **≥1 label ≥ passing y ≥1 < passing**. Scoring auto poco después de run, re-score reemplaza, cambiar threshold solo display.
- **Benchmarks:** single-agent, Tasks `{prompt + success criteria}`, Configs `{harness/model/runner}`, Scorers, Repetitions. Correctness built-in. Results pass rates/cost/quality per config, **Warp no elige ganador; humano pondera**. Credit totals **no incluyen model usage**.
- **Self-improvement:** toggle por scorer, agrupa failures → follow-up ordinary runs que pueden editar app o factory definition; PR con `Regressions addressed` links. **Nada se adopta sin review**. Loop 6 pasos: Define Scorer → Baseline → Inspect → Benchmark → Adopt → Monitor (cambiar una cosa medible a la vez).

---

## 3. Inputs / Outputs / Formatos Exactos

### 3.1 `factory.yaml` (root)

```yaml
# docs/wiki Warp/WarpFactories.md:474-522 — todas las keys case-sensitive, YAML
schemaVersion: v1alpha1          # required, solo v1alpha1
name: payments-factory            # required
description: Processes approved work # optional
alias: payments                   # optional, Foreman name, max 60, regex [A-Za-z0-9 ._-], único case-insensitive, default copia name
credentialStrategy: EXECUTOR      # optional, EXECUTOR (default) | CREATOR, agents pueden override
repositories:                     # required, lista {owner, name}
  - owner: acme
    name: payments-service
secrets: [SENTRY_AUTH_TOKEN]      # optional, factory-wide (siempre aplican además de per-agent)
mcpServers:                       # optional, map nombre→warpId
  sentry: { warpId: SENTRY_MCP_SERVER_ID }
cloudProviders:                   # optional, federation
  gcp:
    projectNumber: "123456"       # required quoted string (!)
    workloadIdentityFederationPoolId: "..."
    workloadIdentityFederationProviderId: "..."
    serviceAccountEmail: "..."    # optional
  aws: { roleArn: "arn:..." }
integrations:                     # optional, solo slack/linear/jira, linear y jira mutuamente excluyentes, GitHub no se declara
  - type: slack
agentDefaults:                    # required, exactamente uno de model o harness
  model: auto                     # shorthand para harness:{type:oz, model:auto}, mutuamente excluyente con harness
  # harness: {type: codex, model: gpt-5, reasoningLevel: high, auth: {source: managedSecret, secretName: CODEX_API_KEY}}
  # harness: {type: claude, model: sonnet, auth: {source: workerEnvironment}} # requiere self-hosted
  runner: linux-build
  environmentId: PAYMENTS_ENVIRONMENT_ID
  secrets: [SENTRY_AUTH_TOKEN]    # per-agent lo reemplaza (no agrega), factory-wide siempre aplica
  mcpServers: { sentry: { warpId: ID } }
  workerHost: warp                # warp | SELF_HOSTED_WORKER_ID
```

**Qué devuelve:** factory desplegada, repo `factory:<alias>` labels auto-creadas en cada repo conectado, dashboard creado.

**Validaciones clave:** `schemaVersion` solo `v1alpha1`; todas las keys case-sensitive; `repositories` required; `agentDefaults` exactamente uno de `model`/`harness`; `alias` charset + longitud + unicidad; `integrations` solo `slack|linear|jira` y mutual exclusión; `cloudProviders.gcp.projectNumber` quoted string; `secrets` vs `harness.auth` separados.

### 3.2 `agents/<name>/agent.md`

```markdown
---
description: Reviews factory-produced pull requests  # optional
agentType: REVIEW                                   # optional, CUSTOM(default)|FOREMAN(alias MAIN)|TRIAGE|SPEC|IMPLEMENT|REVIEW|VERIFY, exactamente uno FOREMAN por factory
credentialStrategy: EXECUTOR                        # optional override
model: auto                                         # xor harness, igual que agentDefaults
# harness: {type: codex, model: gpt-5, reasoningLevel: high, auth: {source: managedSecret, secretName: X}}
runner: linux-build                                 # optional override
environmentId: ENV_ID                               # optional override
secrets: [SENTRY_AUTH_TOKEN]                        # optional, reemplaza agentDefaults.secrets
mcpServers: { sentry: { warpId: ID } }              # optional, reemplaza
workerHost: warp                                    # optional override
---

Review each pull request against the repository's standards. Request
changes when tests are missing; never approve your own edits.
# ↑ body Markdown = prompt durable del rol (instrucciones que el LLM ve cada run)
```

**Qué devuelve:** agente listo para ser invocado por foreman o automation. Identidad = nombre del directorio. Wizard no pre-elige modelos; cada agente debe configurarse.

### 3.3 `automations/<name>/automation.md`

```markdown
---
enabled: true                    # optional, default true
agent: foreman                   # optional, default foreman
triggers:                        # required, uno o más
  - provider: github
    event: issue_labeled
    filter:                      # optional, every key AND, omitted = match all, lista OR, soporta in/not_in
      repos: [acme/payments-service]
      labels: [factory-ready]
      # labels: {not_in: [wip]} + base_branches: [main]  # ejemplo P0
  - provider: schedule
    event: cron_fired
    schedule:
      name: weekly-dependency-audit  # optional cuando múltiples crons en una automation
      cron: "0 9 * * 1"              # 5-field cron o @daily/@every 1h, siempre UTC
  - provider: factory
    event: work_item_stage_changed   # sin filter
# execution overrides opcionales: model/harness, runner, environmentId, secrets, mcpServers, workerHost (solo para runs de esta automation)
---

Review the labeled issue and decide the next required stage. Preserve the
issue's acceptance criteria and return unresolved product questions to a human.
# ↑ body = prompt con que arranca cada run de esta automation
```

**Providers/events completos (§7):** github 20 (`issue_created/labeled/assigned/mentioned`, `pull_request_opened/closed/merged/labeled/assigned/mentioned/ready/reopened/synchronized/review_requested/review_submitted`, `push`, `check_suite_completed`, `check_run_rerequested`, `check_suite_rerequested`, `workflow_run_completed`), gitlab 2 (`merge_request`, `bot_mentioned`), linear 6 (`issue_created/labeled/assigned/state_changed`, `comment_created`, `agent_session_created`), jira 4 (`issue_created/labeled/status_changed/agent_session_created`), slack 7 (`app_mention/message_posted/message_dm/message_im/message_mpim/member_joined_channel/reaction_added`), schedule 1 (`cron_fired`), factory 1 (`work_item_stage_changed`).

**Qué devuelve/maneja:** crea **N runs** (uno por automation que matchee). Editor `Factory → Automations → Triggers → More filters → Save`; probar con test event; warning si overlapping (ej Slack `app_mention+message_posted` → 2 runs). Editor no cambia execution settings.

### 3.4 `runners/<name>.yaml`

```yaml
description: Linux runner for payments builds and tests
setupCommands:            # optional, shell commands en orden durante sandbox prep
  - corepack enable
instanceShape:            # optional, ambos juntos o nada (default workspace)
  vcpus: 4
  memoryGb: 8
platform:                 # optional
  os: linux               # linux (default) | macos
  arch: x86_64            # x86_64 (default linux) | aarch64 (solo aarch64 en macOS)
  linux:
    dockerImage: ubuntu:22.04  # required si os linux, cualquier image con bash+coreutils
  # mac:
  #   version: "26"       # "14"|"15"|"26"|"27" quoted string, default "26"
```

**Qué devuelve:** compute para agents. Máximo hosted **32/64** (Warp rechaza por encima; self-hosted exempt). Varios runners por factory (ej `02-sdlc-issue-to-pr` con 3 runners, foreman Linux + implement macOS). `Settings → Runners` muestra OS/arch/setup/size. CLI `oz runner create --os linux --arch auto --docker-image ... --vcpus 4 --memory-gb 8` vs factory `arch: x86_64/aarch64`.

### 3.5 `scorers/<name>/scorer.md`

```markdown
---
name: tests-run                                           # required, identity (renombrar = content edit)
description: Checks whether implementation runs include test evidence.
agents: [reviewer]                                        # required ≥1
labels:                                                   # required, cada {value, score 0..1, description?}
  - value: tests_run
    description: The transcript contains a test command and its result.
    score: 1
  - value: tests_skipped
    score: 0
passingScore: 1                                           # required 0..1, ≥ = pass
samplingRate: 25                                          # optional 0..100, default 25, 0 = stop auto (manual sigue)
model: claude-4-5-haiku                                   # required judge model
selfImprovement: false                                    # optional default false
# output: classification                                  # optional, hoy solo classification
---

Evaluate whether the agent ran the relevant tests before finishing. Return
exactly one declared label.
# ↑ body = rubric / judge instructions
```

**Invariante:** ≥1 label ≥ passingScore y ≥1 < passingScore. Re-score reemplaza; cambiar threshold solo display.

### 3.6 Skills (`SKILL.md`)

```markdown
---
name: repository-conventions  # frontmatter Warp estándar + argument syntax
description: Enforce repo conventions before considering change complete
---

# repository-conventions
Follow these steps: `pnpm test`, `pnpm lint:check`, etc.
```

Factory-wide en `skills/<name>/SKILL.md` (todos), per-agent en `agents/<name>/skills/<name>/SKILL.md` (solo ese agente). Extienden baseline GitHub/Slack/tracker.

### 3.7 Schemas y Validación

- JSON Schema unauthenticated: `https://app.warp.dev/api/v1/factory-files/schemas` (versiones) y `https://app.warp.dev/api/v1/factory-files/schemas/v1alpha1` (docs).
- Validación sin guardar: `validate_factory_files` (MCP tool).
- GitHub-backed: PR check `warp/factory-config` annota file+line y resume “qué aplicaría”; aplica **atómico o nada** al mergear a `main`; Warp-managed nunca queda inválido (valida al guardar).

### 3.8 Factory MCP — Qué se le pasa y qué devuelve

| Tool | Input (qué le pasás) | Output (qué te devuelve) |
|---|---|---|
| `send_task` (new) | `{factoryUid, title, note: goal+context+constraints+work done, notificationRoute?}` + **push branch/PR primero si hay local changes** | `{taskId, runId, dashboardLink}` — foreman toma control, reporta en conversation |
| `send_task` (hand-back) | `{taskId, branchOrPrUrl: pushed URL, note: qué cambió/validó/quedó}` | mismo task, foreman decide next step |
| `get_task` | `{taskIdOrReference: ID | URL PR | Slack permalink | Linear/Jira key | branch, start_working?: boolean}` | `{status, runHistory: [{runId, agent, cost, timeline}], outputs: {prs, branches}}` + si `start_working:true` → `worktreeGuidance: {suggested Git commands para isolated worktree}` (MCP nunca modifica files) |
| `message_foreman` | `{taskId, message}` | `{messageId, conversationUpdated}` — no mueve task ni hace handoff |
| `get_conversation` | `{taskId}` | `{messages: [{from, text, timestamp, runLinks}]}` |
| `list_tasks` | `{factoryUid, filters: {creator?, stage?, dateFrom?, dateTo?}}` | `[{taskId, title, stage, creator, createdAt, cost, prUrl}]` |
| `search_task` | `{query}` | `[{taskId, factoryUid, title, stage}]` case-insensitive |
| `list_notification_routes` | `{factoryUid}` | `[{id, type: slack_dm|linear_issue, name}]` best-effort |
| `complete_task` | `{taskId}` | `{status: Complete}` — hand-back no completa solo |
| `validate_factory_files` | `{files: {path:content}}` árbol completo | `{valid, errors: [{file,line,field,message}], summary}` |

Onboarding (`list_teams → create_factory` etc.) requiere browser sign-in; headless usa `Authorization: Bearer YOUR_API_KEY` header.

### 3.9 Factory API — Qué se le pasa y qué devuelve

```bash
# List/search
GET /api/v1/factory?search=payments  # case-insensitive sobre name/alias
→ {factories: [{uid, name, alias, repositories}]}

# Get one
GET /api/v1/factory/{uid}
→ {uid, name, alias, repositories, agents, runners}

# Dispatch al foreman
POST /api/v1/factory/{uid}/runs
Body: {
  prompt: "Fix checkout race at app/checkout.ts:42",  # required
  title?: "Checkout fix",                               # optional, derivado de prompt si omitido
  ticket_ref?: "linear:PAY-123",                        # optional, regex ^[a-z]+:[A-Za-z0-9-_]+$
  ticket_url?: "https://linear.app/..."                 # optional, URL
}
→ {runId, taskId, status: queued|running, dashboardUrl}

# Continue/monitor (Agent API, run es ordinary cloud agent run)
GET /api/v1/agent/runs/{runId}              → {status, cost, timeline, outputs:{prUrl}}
POST /api/v1/agent/runs/{runId}/followups {prompt}
POST /api/v1/agent/runs/{runId}/cancel
POST /api/v1/agent/run {prompt}             # standalone sin factory
```

Auth: `Authorization: Bearer YOUR_API_KEY`. SDK `OzAPI`: `client.factories.list/get` y `client.factories.runs.create(uid, prompt, title, ticket_ref)`.

### 3.10 Cómo se Gestiona Todo (runtime)

1. **Definitions as Code** son source of truth. Warp-managed: save valida+commitea+aplica en un paso. GitHub-backed: PR `warp/factory-config` + merge atómico. Live-managed: API.
2. **Automations** rutean eventos a agents; foreman coordina stages y decide skip/gate; humanos controlan spec approval y merge vía branch protection.
3. **Runners** asignan compute per-agent/automation; Host decide ejecución (warp vs self-hosted worker `workerHost: ID` con platform matched, outbound only).
4. **Dashboard** observa (Total runs, PRs, Autonomy, Cycle time, Cost per PR S/M/L/XL, Scorers, Self-improvement 3 newest, Activity kanban, Runs timeline/Sub-agents/View session, Settings).
5. **Measure & Improve:** Scorers muestrean runs (default 25%), Benchmarks comparan configs single-agent (sin elegir ganador), Self-improvement agrupa failures → PRs con `Regressions addressed`.
6. **Factory MCP** permite a cualquier coding agent mandar/tomar trabajo manteniendo **un solo record por task** (send → pick with worktree guidance → message → hand-back → complete).
7. **Troubleshooting** es automation mismatch casi siempre (check `enabled + event + every filter AND + source conectada a esta factory`), overlapping → 2 runs, `Stop task` sin confirmación, stuck = `waiting on person`.

---

## 4. TermCanvas Hoy — Arquitectura OpenCode Real

### 4.1 Stack y Singletons

- **Stack:** `Electron 41 + Vite 7 + React 19 + Zustand 5 + xterm 6 + xyflow 12 + node-pty 1.1.0 + @opencode-ai/sdk@1.18.18` (`package.json:1-20`, `pnpm-workspace.yaml`, `shared/termcanvas-instance.ts` → `~/.termcanvas/port`, `~/.termcanvas-dev/port`).
- **Main singletons (`electron/main.ts` ~3000 LOC):** `PtyManager` (Map pty + outputBuffers 1000 líneas), `ProjectScanner`, `StatePersistence` (500ms debounce), `TelemetryService`, `HookReceiver` (`TERMCANVAS_SOCKET`), `McpManager` (`McpVault`), `ApiServer` (`http.createServer().listen(0,"127.0.0.1")` → `writePortFile`).
- **PtyManager (`electron/pty-manager.ts`):** `pty.spawn({name:"xterm-256color", cols:80, rows:24, cwd, env})`, `onData` → `captureOutput` → `OutputBatcher` flush 8ms → `sendToWindow("terminal:output")` → `xterm.write`, `onExit` → status, `killProcessTree` (`taskkill /PID /T /F` en win32), `MAX 1000 líneas` RAM, `waitForOutput`, `destroy` con 5s deadline + SIGKILL.

### 4.2 Cómo se Lanza OpenCode Hoy (2 mundos dispersos)

| Modo | Cómo corre OpenCode | Dónde | Protocolo |
|---|---|---|---|
| **Canvas TUI** (default para resolve/fix/review/planning) | `PtyManager.create({shell:"opencode", args:["--prompt", prompt, "--auto", "-s", id], cwd, env:{TERMCANVAS_SOCKET}})` → cada tile es un PTY xterm | Proceso PTY por tile | `ipcRenderer` `terminal:create` → `node-pty` → `OutputBatcher 8ms` → `xterm.js 50k scrollback + WebGL + FitAddon` |
| **Entrevista** (brief/requirements/synthesis/gapCheck/asrReview/tactics) | `createOpencodeServer({hostname:"127.0.0.1", port:20k-45k random, timeout:30s})` **efímero por llamada** (`headless-runtime/interview/harness/opencode.ts:34-60`) → `client.session.create` → `client.session.prompt({format:{type:"json_schema", schema}, parts:[{text}], tools:{}})` | Server levantado **on-demand por fase**, 2 retries 400ms backoff, cerrado al finalizar | HTTP SDK `http://127.0.0.1:<port>` random, JSON schema |
| **Headless Cloud** (Docker) | `HeadlessApiServer` + `PtyManager` + `ProjectStore` puro Node (`headless-runtime/index.ts`) | Contenedor `node:22-slim` + `tini`, `7080` fijo | HTTP `Bearer TERMCANVAS_API_TOKEN` + WS `/pty/stream?ptyId=` + SSE `/api/terminal/:id/events` |
| **API Local Electron** | `ApiServer` (`electron/api-server.ts`) sobre `http://127.0.0.1:0` random | Main process | HTTP localhost sin auth (excepto rateLimit), `port` file en `~/.termcanvas/port` |

**Config TUI (`src/terminal/cliConfig.ts`):** `TERMINAL_CONFIG.opencode = {launch:{shell:"opencode", resumeArgs:id=>["-s",id], newArgs:()=>[], promptArgs:p=>["--prompt",p], autoApproveArgs:()=>["--auto"], promptOnResume:true}, composer:{...}, MAX_PROMPT_ARG_CHARS=28000}`. Headless: `buildHeadlessArgsForCli` (`opencode: ["run", ...flags, "-s", id, "--auto", prompt]`, `codebuddy: ["-p","--output-format","json", ...]`).

**Flujos concretos:**

- **Planning (`src/planner/planningSession.ts` ~400 LOC):** `launchPlanningSession({mode:"roadmap"|"audit", repoPath, cli, headless?, model, category, allowedSkills})` → `buildPlanningPrompt` → si `prompt.length>12000` escribe `<repo>.prompt.md` y manda instrucción corta “lee ESE archivo” (no `@ruta`) → `modelPinFlags` (`runModelFlagArgs`) → `skillScope` (`prepareSkillScope`) → `createTerminal(cli, title, promptRef, autoApprove, "agent")` + `headlessArgs` si headless → `ensureTerminalRuntime` → `pollForOutput(outputPath, 1.5s, timeout 30min, MAX_STALE_INVALID_READS=8)` → al `exit 0` sin archivo → `findOpenCode(worktree, startedAt)` → resume `-s <id>` con mensaje “escribí el plan ahora”.
- **Tools (`src/planner/toolsSession.ts`):** `launchToolsSession` → `headlessShell="node"`, `headlessArgs=[run-diagnostico-tools.mjs, "--repo", repo, "--out", findingsDir, "--category", id]` → `poll 500ms + headlessGate({onArtifactReady, onCompleted})` → artefacto `tool-findings-<cat>-<ts>.json`.
- **TerminalRuntimeStore (`src/terminal/terminalRuntimeStore.ts` 1732 LOC):** `ManagedTerminalRuntime {ptyId, xterm, fitAddon, previewAnsi 200k, mode live|parked, watchedSessionId, hookFallbackTimer, ...}`, `ensureTerminalRuntime` → `buildLaunchSpec` → `ptyManager.create` → `onData` (appendPreview, xterm.write, telemetry, detect, status active, waitingTimer), `onExit`, `pollSessionId`, `watchSession`, `syncPermissionMode`. Headless `non-interactive` → `xterm.onData` no forward a pty (bloquea Ctrl+C).
- **Issue flows (`src/canvas/resolveIssueWorktree.ts`):** `CASE C created: git worktree add + createTerminal(opencode, Issue #N, buildIssueResolvePrompt("new"))`, `CASE A resumed: reuse tile + resumePrompt`, `CASE B reused: live opencode ya existe`. Prompts: `issueResolvePrompt.ts`, `issueReviewPrompt.ts` (`gh api /pulls/reviews`, `VEREDICTO: APROBADO/CAMBIOS_PEDIDOS`), `issueFixPrompt.ts`, `resolveConflictPrompt.ts`.
- **Entrevista (`headless-runtime/interview/engine.ts` 1128 LOC):** scheduler determinístico (`TOPICS=["problema","usuarios",...]`, `MAX_QUESTIONS_PER_TOPIC=3`), `startInterview` → `harness.createSession` → ledger `entrevista-<ts>.json` en `.agents/interview/` → `askQuestion` → `promptStructuredRaw` con `phaseModelRef("requirements")` + 3 reintentos Zod + `Session not found` recrea → `synthesizeInterview` (360s, variant max), `gapCheck`, `asrReview`, `interview-service.ts` IPC `interview:*` + `interview:activity` feed.
- **Model routing (`shared/phaseModels.ts`, `docs/model-routing-por-fase.md`):** `PHASE_IDS=["brief","requirements","synthesis","gapCheck","asrReview","tactics","diagnosisLlm"]`, `DEFAULT_PHASE_MODELS`, `PHASE_CLIS`, `phaseModelRef` → `gateModeloDeFase` valida contra `fetchModelCatalog(false, phaseCliRef)`. Catalog cache 5min TTL por `CliCatalogSource` (`electron/model-catalog.ts`).
- **Sesiones (`electron/session-discovery.ts`, `opencode-session.ts`):** `findBestOpenCodeSession(cwd, startedAt)` → SQLite `~/.local/share/opencode/opencode.db` `SELECT id,directory ... LIMIT 32`, confidence weak/medium, `TelemetryService` 1453 LOC (estados `starting|progressing|idle|awaiting_input|error|exited|stall_candidate`).

**Puertos y comandos que realmente spawnean:**

- Electron random: `http.createServer().listen(0,"127.0.0.1")` → `~/.termcanvas/port`
- Headless: `TERMCANVAS_PORT=7080` → `0.0.0.0:7080` (`/health` público, resto Bearer)
- Entrevista efímero: `encontrarPuertoServidor(20000,45000)` → `createOpencodeServer` → SDK `http://127.0.0.1:<rand>`
- `opencode --prompt "<multilinea>" --auto -s <id>` (TUI), `opencode run --auto "<prompt>"` (headless legacy), `codebuddy -p --output-format json --model fast-model "<prompt>"`, `node scripts/run-diagnostico-tools.mjs --repo ... --out ... --category ...`
- CLI `termcanvas` es **solo HTTP client** (`cli/termcanvas.ts` 792 LOC): `getConnection` lee `~/.termcanvas/port` → `http|https.request` con `Bearer`, retries 3× 1s*2, sin streaming `tail -f` (solo `terminal output --lines` polling).

### 4.3 Pain Points Que Justifican Factory Local

| Dolor | Evidencia | Warp fix que inspires |
|---|---|---|
| **Server efímero por fase (30s startup × N)** | `opencode.ts:34-60` cada `ensureClient()` sorte port + bind + SDK | **Server único persistente** (una vez, warm cache) |
| **5 PTYs simultáneos → thrash host** | `resolveIssueWorktree` + `planningSession` sin queue, stagger 150ms solo | **Queue con concurrency 2-3** + priority |
| **Logs no persistentes, xterm heavy** | `outputBuffers 1000 líneas RAM`, `eventBus 100 recent`, `xterm 50k scrollback + WebGL atlas + mousePatch` para jobs que usuario ni mira | **`logs.ndjson` persistente + SSE tail sin xterm** |
| **Argv 32K trunc + prompt.md adhoc** | `MAX_PROMPT_ARG_CHARS=28000`, `threshold 12000 → prompt.md` no uniforme | **Prompt siempre file `job/prompt.md`** , sin cap |
| **Session find polling débil** | `findBestOpenCodeSession` fuzzy por `directory` exact match, confidence weak/medium, `isResumeAttempt` bool, `onExitedWithoutFile` 1 retry | **Factory owns jobId → sessionId mapeo determinístico**, no fuzzy |
| **TUI vs headless diverge** | Ramas separadas en `planningSession.ts` y `cliConfig.ts`; `headlessArgs` vs `launch.args` | **Job único con contract `result.json + .done`**; TUI solo viewer |
| **Gate tras spawn paga tokens** | `gateModeloDeFase → fetchModelCatalog → validatePhaseAgainstCatalog` best-effort **después** de elegir | **Gate previo a enqueue**, fail fast con alternatives |
| **API dual divergente** | `electron/api-server.ts` (via execRenderer) vs `headless-runtime/api-server.ts` (direct) | **Factory API local única** |
| **No tail -f** | `terminal output --lines N` polling; observado en entrevista no hay `logs --follow` | **SSE/WS streaming** como `warp factory logs --follow` |

---

## 5. Tu Objetivo Traducido: Warp → TermCanvas Factory Local

> “No quiero que se abran terminales, que se reproduzca Headless, no. Quiero que haya en mi compu corriendo el servidor de OpenCode y se le vayan mandando las sesiones y las fases de este proyecto. Si quiero implementar un issue, al darle al botón de implementar se va a lanzar un agente con su sesión que va a tener su corrida de fondo. O sea, va a estar en la nube y yo voy a poder chequear esa sesión en vivo. Puedo chequear los logs, como si estuviera hablando con la TUI, pero nada, va a estar trabajando de fondo en la nube. Obviamente quiero que sea gratis. Así que debería levantar algún servidor en local.”

### 5.1 Mapping Exacto Warp → TermCanvas Factory Local (gratis)

| Warp Factories (cloud pago) | TermCanvas Factory Local (tu “nube local” gratis) | Por qué es equivalente y qué cambia |
|---|---|---|
| **Control plane siempre en Warp** (coordina, identity, observabilidad, inference routing) + **Execution plane Warp-hosted o self-hosted worker (outbound only, `workerHost: ID`, Docker/K8s)** | **Control plane local:** `TermCanvas main process` (Electron `electron/main.ts` + `ApiServer` + `FactoryServer` nuevo) coordina queue + job store + logs. **Execution plane local:** `opencode serve` persistente en `127.0.0.1` (único, como `headless-runtime/interview/puerto-libre.ts` pero una vez, no por fase) + opcional `PtyManager` fallback para CLIs sin serve (claude/codex TUI) | Cambia: sin Warp, sin credits, sin ZDR, sin multi-host. Ganas: gratis, sin latencia, sin metering |
| **Factory** con `factory.yaml` + `agents/` + `automations/` + `runners/` + `scorers/` + `skills/` (policy única, sizing por product surface) | **No necesitas replicar `factory.yaml` completo día 1.** Para “nube local” alcanza con **una Factory por workspace/repo** (tu canvas ya tiene `ProjectStore` con `projects[].worktrees`). Tus “agents” hoy son **fases**: `brief, requirements, synthesis, gapCheck, asrReview, tactics, diagnosisLlm` + `resolveIssue, review, fix, conflict`. Tus `runners` hoy son **PTys**; pasan a ser **slots del queue** (concurrency). Tus `skills` ya existen (`skills/skills/*`). | Simplifica: una factory = un repo/workspace. No pagar policy splitting. Reusa `shared/phaseModels.ts` + `harness/index.ts` |
| **Work Item** (issue/ticket/MCP task) con `Triage→Planning→Building→Reviewing→Complete` + skip logic + human gates | **Tu Work Item = tu Issue/Canvas node + fases Hydra + planning sessions.** Hoy ya tienes `useIssueReviewStore`, `resolveIssueWorktree` (CASE A/B/C), `planningSession` (roadmap/audit), `toolsSession`. Factory Local les da **identity preservada**: un `jobId` (como Warp `taskId`) que spanea N runs (ej: triage run + implement run) y es lo que “chequeás en vivo”. | Ganas: en vez de N PTYs huérfanos, 1 work item con `Event history` de N runs taileable |
| **Run** (una ejecución de un agente, timeline, costo, `View session` steer) | **Run = una invocación `client.session.prompt` o un `PtyManager.create` contra el server local**. Hoy `TelemetryService` + `HookReceiver` + `session-discovery` intentan derivar status; con Factory Local el **FactoryServer es fuente de verdad**: `job.state = queued|running|success|error`, `runId = sessionId`, `logs.ndjson` streaming, `View session` = drawer SSE (no chat input en run page, igual que Warp) | Cambia `View session` de “compartir sandbox cloud” a “tail local logs” |
| **Automation** (`provider/event/filter` → agent, AND/OR, `in`/`not_in`, schedule UTC `@daily`) | **No necesitas Slack/GitHub automations día 1.** Tu `automation` día 1 es **el botón “Implementar”** (`src/canvas/resolveIssueWorktree.ts: CASE C` + `src/planner/planningSession.ts`). Ese botón hoy hace `createTerminal` directo; con Factory Local hace **`POST /factory/jobs`** (equivalente a `POST /factory/{uid}/runs` de Warp pero local). La nube local **sí quiere** el matching después (ej: “si PR labeled `factory-ready` → encola job”), pero es Wave 2. | Empieza por **automation manual** (botón) = tu “direct runs” Warp (`New → foreman`) |
| **Factory MCP** 19 tools, `send_task` (factory,title,note → foreman) / `get_task(start_working:true)` → worktree guidance / `message_foreman` / `complete_task` | **Reusá el contrato Factory MCP localmente.** Tu `send_task` ya existe conceptualmente: es `buildIssueResolvePrompt` + `createTerminal`. Formalízalo: `POST /api/factory/jobs {prompt, worktree, phase, cli, modelRef}` = Warp `send_task`; `GET /api/factory/jobs/:id?logs=tail` = `get_task` + logs; `POST /jobs/:id/message` = `message_foreman` (opcional). Warp MCP nunca modifica files; tu factory tampoco (escribe `prompt.md` y lee `result.json`). | Te deja **swap a Warp real más tarde** manteniendo mismos paths (como Warp recomienda “stubs drop-in” US-155) |
| **Factory API** `GET /factory?search`, `POST /factory/{uid}/runs {prompt, title, ticket_ref}` + `GET /agent/runs/{id}`/`followups`/`cancel` | **Implementa Factory API local idéntica pero sin `ticket_ref` externo día 1.** `POST /api/factory/local/runs` = tu `enqueueFactoryJob`. Validar `prompt` required (igual que Warp), `ticket_ref` regex `^[a-z]+:[A-Za-z0-9-_]+$` lo puedes reusar para linkear issues locales (`github:123`, `linear:PAY-1`). `GET /api/factory/local/runs/:id` para polling; `POST /cancel` = `ptyManager.destroy` | Misma DX que Warp; luego puedes delegar a Warp cloud sin cambiar UI |
| **Runners / Sizing / Deployment** (3 patterns CLI-only/Warp-hosted/Self-hosted, límites 32/64, OTel) | **Tus runners = `PtyManager` slots + `opencode serve` concurrency.** Límite no es 32/64 sino `CPU-1` o `Settings → concurrency` (ej 3). OTel hoy no; alcanza con `GET /factory/health → {queue:{pending,running}, workers}`. Deployment pattern tuyo es **Pattern 3 Self-hosted pero 100% local** (sin Warp, sin Docker obligatorio). | Gratis porque execution es tu máquina; no hay metering |
| **Dashboard / Measure** (8 métricas, Activity kanban, Runs timeline/Sub-agents, Scorers, Benchmarks, Self-improvement) | **Dashboard local mínimo viable:** `Factory → Jobs` (lista queue/running/done), `GET /api/memory/index` ya existe, `GET /api/status` ya existe, `telemetry/terminal/:id` ya existe. Para logs en vivo reusá `SSE /api/terminal/:id/events` (`headless-runtime/api-server.ts: SSE`) pero para jobs: `SSE /api/factory/jobs/:id/events`. Scorers/Benchmarks es Wave 3 (igual que Warp). `Stop task` sin confirmación (Caution) lo mantienes igual. | No necesitas 8 métricas día 1; alcanza con `queue + cost + duration` |

---

## 6. Propuesta Arquitectura Factory Local Gratis

### 6.1 Componentes (nuevo código, reuso máximo)

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Main Process (control plane local)                │
│  electron/main.ts                                           │
│   ├─ ApiServer (existente, 127.0.0.1:0 random → ~/.termcanvas/port)
│   ├─ FactoryServer (NUEVO, 127.0.0.1:17680 o 20k-45k único) │
│   │    ├─ JobStore (persistido ~/.termcanvas/factory-queue.json)
│   │    ├─ Queue (in-memory, concurrency 3, FIFO + priority)
│   │    ├─ WorkerPool (dequeue → harness adapter)
│   │    └─ LogStore (append logs.ndjson, SSE broadcaster)
│   ├─ PtyManager (existente, fallback para CLIs sin serve)
│   ├─ HarnessRegistry (existente, headless-runtime/interview/harness/index.ts)
│   └─ EventBus (existente, headless-runtime/event-bus.ts)
└─────────────────────────────────────────────────────────────┘
                         │  SDK / PTY
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Execution Plane Local (gratis)                             │
│   ├─ opencode serve (UNO solo, 127.0.0.1:17680)  ← ensureClient() pero persistente
│   └─ codebuddy serve (opcional, si lo usás para diagnosis)
└─────────────────────────────────────────────────────────────┘
                         │  FS contract
                         ▼
<repo>/.agents/factory/<jobId>/                               │
  job.json, prompt.md, logs.ndjson, result.json, .done        │
```

**Nuevo módulo:** `headless-runtime/factory/factoryServer.ts` (reutiliza `headless-runtime/api-server.ts` + `headless-runtime/interview/harness/*` + `headless-runtime/event-bus.ts`).

**Server persistente vs efímero:** hoy `headless-runtime/interview/harness/opencode.ts:34-60` crea server por cada fase con `encontrarPuertoServidor(20000,45000)` + `timeout 30s`. Factory Local **reemplaza** eso por **una vez** al arrancar la app (`main.ts` `did-finish-load` junto a `apiServer.start()`), cacheado en `shared/termcanvas-instance.ts` `factory-port` file (`~/.termcanvas/factory-port`). Cierra con `createGracefulShutdown` (flush queue → destroy PTYs → unlink port).

**Queue:** `FactoryQueue` in-memory + `persistenceController` (`~/.termcanvas/factory-queue.json` similar a `electron/lifecycle.ts` 500ms debounce). Config `concurrency: 3` en `Settings → Factory` (`preferencesStore` + IPC `factory:set-concurrency`). `maxParallel = min(os.cpus().length -1, concurrencySetting)`. Jobs `pending` → `running` (asigna slot) → `success | error | cancelled`.

**Harnesses:** reusar `HARNESS_REGISTRY` (`opencode` real, `codebuddy` real, demás stub). Factory worker hace `getInterviewHarness(cli).promptStructuredRaw` para CLIs con serve; para CLIs TUI-only (claude/codex) hace **fallback PTY via Factory queue** (slot limitado, no spawn directo) — igual que Warp “unmanaged no puede ser factory host pero sí MCP”.

**Auth:** local no necesita `Bearer` día 1 (como `electron/api-server.ts` random port sin auth). Si lo expones en LAN/Docker, añade `Bearer` como `headless-runtime/api-server.ts` (env `TERMCANVAS_API_TOKEN`).

### 6.2 Contrato de Job (igual que Warp, gratis) — inspirado en `harness-design-essay.md` (“terminal prose is NOT source of truth; completar evidencia = result.json + done marker”)

```
<repo>/.agents/factory/<jobId>/
  job.json         # {id, factoryId:"local", phase:"resolveIssue"|"diagnosisLlm"|"planning"|"review"|..., cli:"opencode", model:{providerID,modelID,variant}, worktree:".../.worktrees/fix-...", promptPath:"prompt.md", createdAt, priority, repo:"c:/.../repo", issueNumber?, ticket_ref?, status:"queued|running|success|error|cancelled", sessionId?, cost?:{input,output}, durationMs?}
  prompt.md        # prompt multilínea completo (ya no 28K cap, siempre file)
  logs.ndjson      # streaming append (cada línea: {ts, kind:"pty_output"|"session_event"|"tool_use", data})
  result.json      # contrato schema del agente (parseable JSON) + done marker; si no parsea → error
  .done            # marker vacío (atomic rename, igual que planning pollForOutput)
  meta.json        # {ptyAlive, sessionId, exitCode, usage}
```

**Ventajas:** `logs.ndjson` persistente + taileable (reemplaza `outputBuffers 1000 RAM` + `xterm heavy`). `result.json + .done` evita polling frágil (`pollForOutput` 1.5s + `MAX_STALE_INVALID_READS=8`, `findBestOpenCodeSession` fuzzy).

**Polling unificado:** `headlessGate` pattern (`src/planner/toolsSession.ts` `headlessGate({onArtifactReady, onCompleted})`) se generaliza: `FactoryPoller` espera `logs.ndjson` streaming + `result.json` listo; UI consume `SSE GET /api/factory/jobs/:id/events` (reusa `HeadlessApiServer.handleSSE`, `MAX 50 conns`, replay 50 events).

### 6.3 Endpoints Locales (equivalente Factory API, drop-in para Warp)

| Endpoint (local) | Método | Qué recibe (Input) | Qué devuelve (Output) | Equivalente Warp |
|---|---|---|---|---|
| `/api/factory/local` | GET | — | `{factories:[{uid:"local", name:"local-factory", alias:"local", repositories:[{owner,name}]}]}` | `GET /factory` |
| `/api/factory/local/jobs` | GET | `?search=` case-insensitive sobre `phase`/`prompt` | `[{jobId, phase, status, createdAt, worktree, cost}]` | `GET /factory?search` |
| `/api/factory/local/jobs` | POST | `{prompt: string (required), title?: string, worktree: string (required), phase: PhaseId (required), cli?: "opencode"|"codebuddy"|"claude"... (default opencode), modelRef?: {providerID,modelID,variant}, ticket_ref?: string regex ^[a-z]+:[A-Za-z0-9-_]+$, ticket_url?: string}` | `{jobId, runId: sessionId, status: queued|running, dashboardUrl:"/factory/jobs/<id>"}` — server **valida phase/model contra catalog ANTES de encolar** (fail fast, no paga tokens) | `POST /factory/{uid}/runs` |
| `/api/factory/local/jobs/:id` | GET | — | `{job, logsTail: string, result: JSON|null, status, timeline:[]}` | `GET /agent/runs/:id` |
| `/api/factory/local/jobs/:id/logs` | GET | `?tail=100&follow=false` | `text/plain` o `ndjson` streaming | `get_task` + `View session` |
| `/api/factory/local/jobs/:id/events` | GET | SSE | `text/event-stream` (`terminal_output`, `session_event`, `job_status_changed`) | SSE `/api/terminal/:id/events` |
| `/api/factory/local/jobs/:id/followups` | POST | `{prompt: string}` | `{followupId}` — envía `client.session.prompt` en misma session | `POST /agent/runs/:id/followups` |
| `/api/factory/local/jobs/:id/cancel` | POST | — | `{status: cancelled}` — `ptyManager.destroy` + `harness.deleteSession` | `POST /agent/runs/:id/cancel` |
| `/api/factory/health` | GET | — | `{queue:{pending, running, concurrency}, workers: N, uptime}` | Warp Dashboard métricas |

**Validaciones copiadas de Warp:** `prompt` required non-empty, `ticket_ref` regex `^[a-z]+:[A-Za-z0-9-_]+$`, `search` case-insensitive, `prompt` siempre a file (sin truncation `[TRUNCADO]`). Diferencia: no validar `factory:<alias>` label ni `@warp-factory` (no hay GitHub routing día 1).

### 6.4 Flujo: Botón “Implementar” → Background + Live Logs (lo que pediste)

```
UI: Canvas IssueNode → Click "Implementar" (src/canvas/resolveIssueWorktree.ts: CASE C)
  ↓
FactoryClient.enqueueFactoryJob({phase:"resolveIssue", repoPath, worktree:".../.worktrees/fix-42", cli:"opencode", modelRef:phaseModelRef("diagnosisLlm"), prompt:buildIssueResolvePrompt("new"), ticket_ref:"github:42"})
  ↓ POST /api/factory/local/jobs → {jobId:"1756...", status:"queued"}
  ↓ WorkerPool dequeue (slot disponible)
  ↓ HarnessAdapter.promptStructuredRaw({sessionId, model, text: prompt.md, schema: result.json schema, signal:AbortSignal})
     → client.session.create({directory: worktree}) → sessionId
     → client.session.prompt({sessionID, model, variant, parts:[{text: prompt.md}], format:{type:"json_schema"}})
     → stream logs → append logs.ndjson + eventBus.emit("factory_job_output")
     → al completar → write result.json + .done + meta.json + cost
  ↓ SSE /api/factory/local/jobs/:id/events → UI Factory Drawer (FactoryLogViewer.tsx) auto-tail
  ↓ Usuario: click “Ver sesión” → drawer con `logs.ndjson` (grep `tool|error`) + `result.json` preview + botón `Cancelar` (POST /cancel sin confirmación, Caution igual que Warp `Stop task`)
  ↓ Handoff: result.json parseado → `useIssueReviewStore.requestPrLookup()` → PR linkeado, estado `Complete` (no auto-merge, igual que Warp)
```

**Logs en vivo como TUI pero sin xterm:** `FactoryLogViewer.tsx` consume `GET /api/factory/local/jobs/:id/events` SSE o `GET /logs?tail=100` polling 500ms (como `toolsSession` poller pero unificado). Sin `xterm.js`, `FitAddon`, `WebGL atlas`, sin PTY visible. Solo `tail -f` textual.

**Cancelación:** `DELETE /api/factory/local/jobs/:id` → `closeInterviewServer` + `ptyManager.destroy` + `EventBus emit cancelled` → UI pasa a `Cancelled` terminal (igual que Warp).

### 6.5 Persistencia y Observabilidad (reuso infraestructura existente)

| Necesidad | Reuso |
|---|---|
| **Persistencia queue** | `electron/lifecycle.ts` `createPersistenceController(statePath, getState, 500ms)` + `~/.termcanvas/factory-queue.json` |
| **Event streaming** | `headless-runtime/event-bus.ts` (`100 recent + 200 per-terminal`) + `HeadlessApiServer.handleSSE` (`text/event-stream`, 50 historic + live) |
| **Health** | `GET /health` / `/health/live` / `/health/ready` (público) + `GET /api/status` (full dump) ya en ambos ApiServers |
| **Port file** | `shared/termcanvas-instance.ts` `getTermCanvasDataDir` + `resolveTermCanvasPortFile` → añadir `factory-port` |
| **Telemetry** | `electron/telemetry-service.ts` + `session-discovery.ts` + `opencode-session.ts` (SQLite `opencode.db`) siguen para `awaiting_input`/`stall_candidate`, pero FactoryServer es fuente de verdad para `jobStatus` |
| **Hooks** | `TERMCANVAS_SOCKET` + `hook-receiver.ts` (`SessionStart|Stop|PreToolUse|PostToolUse|Notification`) siguen, pero no son requeridos para `logs.ndjson` (FactoryServer escribe directo) |
| **Memory index** | `skills/scripts/memory-session-start.sh` → `GET /api/memory/index?worktree=` sigue inyectando `<memory-graph>` |

### 6.6 Puertos y Deployment Local (gratis, sin Docker obligatorio)

- **Default local:** `127.0.0.1:17680` (elige fuera de `7080` headless y fuera de `20000-45000` efímero, y por debajo de `49152-65535` rango dinámico Windows). Config `TERMCANVAS_FACTORY_PORT` env.
- **Arranque:** `main.ts` `did-finish-load` → `factoryPort = await factoryServer.start(factoryPort)` junto a `apiServer.start()` (random port) + `writeFactoryPortFile(factoryPort)`. Health `GET /factory/health`.
- **En Docker cloud**, factory = `HeadlessApiServer` existente + queue worker (no duplicar).
- **CLI:** `termcanvas factory jobs list|logs <id> --follow | cancel <id>` (extiende `cli/termcanvas.ts` que hoy solo tiene `terminal create/list/status/output`).
- **MCP local (opcional Wave 2):** exponer `https://127.0.0.1:17680/mcp` (streamable HTTP) con los 19 tools pero auth `Bearer` local (mock). Permite que cualquier coding agent local haga `send_task` a tu factory local — misma DX que Warp Factory MCP pero sin Warp.

---

## 7. Qué Extraer YA de Warp y Qué Descartar

### Extraer con prioridad P0 (Wave 1) — Sin esto no es “Factory”

| Concepto Warp | Qué exacta copiar | En TermCanvas dónde |
|---|---|---|
| **Factory = control plane local + execution plane local persistente** | **Un único `opencode serve` + queue + job store**. Corta `ensureClient()` por fase | `headless-runtime/interview/harness/opencode.ts:34-60` → `factory/factoryServer.ts` |
| **Work Item mantiene identidad intake→handoff** | `jobId` preservado aunque N runs (ej: planning retry `MAX_STALE_INVALID_READS=8`) | `src/planner/planningSession.ts` + `resolveIssueWorktree.ts` |
| **Run = cloud agent run ordinario, `View session` sin chat input** | `GET /jobs/:id/logs` + SSE `View session` steer/full transcript | `headless-runtime/api-server.ts` SSE handler |
| **Definitions as Code contract `result.json + .done`** | Job escribe `result.json` parseable + `.done` atomic rename; terminal prose **no es source of truth** (`harness-design-essay.md`) | `<repo>/.agents/factory/<jobId>/result.json` |
| **Factory API `POST /runs {prompt required, title derived, ticket_ref regex}`** | Mismo body validado, mismo search case-insensitive | `factory/factoryApi.*` local stub |
| **Automations matching AND/OR, vacío=match todo, overlapping → N runs** | No día 1, pero guarda el engine para botón “Implementar” vs “Review” vs “Fix” (misma issue, 3 automations → 3 jobs) | `src/canvas/*Prompt.ts` |
| **Gate previo a enqueue (model routing por fase)** | `gateModeloDeFase` + `fetchModelCatalog` **antes** de encolar, no tras spawn | `shared/phaseModels.ts` + `electron/model-catalog.ts` |
| **`logs.ndjson` + SSE tail** | Reemplaza PTY xterm heavy cuando usuario no mira TUI | `FactoryLogViewer.tsx` |

### Extraer en Wave 2 (P1) — Multiplica valor

- **Factory MCP 19 tools** (`send_task`/`get_task(start_working:true)` worktree guidance / `message_foreman` / `complete_task` / `list_notification_routes` best-effort). Hace tu factory local interoperable con cualquier agente (`claude mcp add --transport http ...` local).
- **Automations filters por provider** (GitHub dual `factory:<alias>` + `@warp-factory`, Slack `reaction_added [ticket]`, Linear `agent_session_created`, Schedule `cron_fired @daily UTC`, Factory `work_item_stage_changed`). Hoy tu trigger es botón; Wave 2 añade `watch .agents/issues` o `github webhook → POST /factory/jobs`.
- **Runners selección per-agent** (foreman Linux, implement macOS fallback). En local es `opencode` vs `codebuddy` per-phase (`DEFAULT_PHASE_MODELS`, `PHASE_CLIS`).
- **Dashboard disclaimers** (`Cost per PR estimate S/M/L/XL 100/500/1000`, `merged>opened`, `Total runs incluye evaluation → flat PRs = harder tasks`). Para tu `Cost per PR` (tokens).

### Descartar / Dejar para Enterprise (no bloquea tu nube local)

- **Control plane siempre en Warp + metering credits** → tú eres tu control plane, gratis.
- **Customer-owned storage S3/GCS, BYO inference con enterprise/team-managed-keys, ZDR** → no necesitas; retené `logs.ndjson` local.
- **GitLab Premium/Ultimate + service accounts + group webhooks, Jira Cloud Rovo** → no día 1.
- **Self-hosted worker `workerHost: ID` + OTel `worker health/throughput/saturation` + backends Docker/K8s/Direct** → tu “worker” es tu laptop; OTel overkill día 1 (alcanza `health`).
- **Scorers `samplingRate 25` + Benchmarks `Repetitions` + Self-improvement `Regressions addressed` PRs** → Wave 3 (measure & improve) cuando tengas baseline.

---

## 8. Plan Incremental (Tracer Bullets)

> **Convención Warp:** vertical slices demoables, blocking edges explícitos, trabajar frontera. Inspirado en `WarpFactories-Tickets.md` T01–T16 pero recortado a tu “nube local”.

| # | Ticket | Puntos | Bloqueado por | Entrega demoable |
|---|---|---|---|---|
| F01 | **Factory Local Foundations** — `FactoryServer` singleton persistente, port file, health, queue in-memory + `~/.termcanvas/factory-queue.json` | 5 | — | App levanta `opencode serve` **una vez** (no por fase), `GET /factory/health` verde, `concurrency: 3` en Settings |
| F02 | **Job Contract** — `job.json`, `prompt.md` (siempre file, sin 28K trunc), `logs.ndjson`, `result.json + .done`, `meta.json` | 5 | F01 | `POST /factory/local/jobs` crea `<repo>/.agents/factory/<id>/` y se ve en FS |
| F03 | **Worker + Harness** — WorkerPool dequeue → `getInterviewHarness(cli).promptStructuredRaw` (opencode) o `PtyManager` fallback (claude/codex), streaming logs → `logs.ndjson` + SSE | 8 | F02 | Job `queued → running → success/error`, logs append en vivo |
| F04 | **Factory API Local Stub** — `GET /factory?search` case-insensitive, `POST /runs {prompt, worktree, phase}`, `GET /jobs/:id`, `POST /cancel`, `GET /jobs/:id/events` SSE | 5 | F03 | `curl -H "Authorization: Bearer..." http://127.0.0.1:17680/api/factory/local/jobs` lista jobs |
| F05 | **Botón Implementar → Factory** — `resolveIssueWorktree` CASE C ahora `enqueueFactoryJob` en vez de `createTerminal` directo; `FactoryClient.enqueueFactoryJob` valida `phaseModelRef` antes de encolar | 5 | F03 | Click “Implementar #42” → job en `pending`, no abre terminal, se puede chequear en `Factory → Jobs` |
| F06 | **FactoryLogViewer** — Drawer `View session` con SSE tail, `logs.ndjson` grep, `Cancel` sin confirmación (Caution), `result.json` preview | 5 | F04 | Usuario ve logs “como si hablara con la TUI” pero en background |
| F07 | **Gate Modelo por Fase previo** — `validatePhaseAgainstCatalog` antes de enqueue, `ModelUnavailableError` con alternatives, sin pagar tokens | 3 | F04 | Seleccionar modelo no conectado → error antes de encolar |
| F08 | **Planning/Tools vía Factory** — `launchToolsSession` + `launchPlanningSession` migran a `enqueueFactoryJob` (headless `run-diagnostico-tools.mjs` como job, `diagnosisLlm` como job) | 8 | F05 | `diagnostico-tools` y `diagnosisLlm` ya no abren PTY disperso, aparecen en cola Factory |
| F09 | **Factory MCP Local (opcional)** — exponer `/mcp` 19 tools local, `send_task`/`get_task(start_working:true)` worktree guidance, `message_foreman` | 8 | F04 | `claude mcp add --transport http ... http://127.0.0.1:17680/mcp` conecta |
| F10 | **CLI Factory** — `termcanvas factory jobs list|logs --follow|cancel` | 3 | F04 | `termcanvas factory logs <id> --follow` tailea `logs.ndjson` |
| F11 | **Dashboard Local** — `GET /api/status` ya existe + `GET /factory/health` con `pending/running`, `cost` por job, filtro `Created by=you` + 4 active stages | 3 | F06 | Sidebar `Factory → Jobs` kanban `queued/running/done` |

**Total inicial:** ~58 puntos, 3 Waves (F01-F04 foundations, F05-F07 botón + viewer, F08-F11 planning + MCP + CLI). Tras esto, decidir si replicar más de Warp (F12 Scorers, F13 Schedule `cron_fired` UTC `@daily`, F14 GitHub dual routing).

**Regla:** cada ticket corta `schema → API → UI → tests` (tracer bullet). No crear rama `feat/factory` gigante; cada F es PR mergeable.

---

## 9. Riesgos, Decisiones y Próximos Pasos

### Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Singleton port colisión Windows rango dinámico** | `ServeError` 1/8 veces (histórico `puerto-libre.ts:1-14` fix) | Reusa `encontrarPuertoServidor(20000,45000)` capped `49000` + `probarBind` pre-bind (ya existe) |
| **Opcod de 32K trunc deja de cubrir** | Prompt cortado `[TRUNCADO]` | Siempre file `job/prompt.md` (Worflow Factory nunca trunca prompt) |
| **Resumen sin archivo `diagnostico-*.json` tras exit 0** | Planning muere tras 30min `MAX_STALE_INVALID_READS=8` | Contrato `result.json + .done` determinístico, no fuzzy `findBestOpenCodeSession` |
| **CLIs sin serve (claude, codex) no pueden ser factory host** | Dead-end si se fuerza | Fallback `PtyManager` via queue (Warp lo confirma: unmanaged no puede ser host pero sí MCP) |
| **Bloquear UI si factory no levanta** | App no abre | Factory start **no bloquea** main; `health/live` probe + retry 2× 400ms backoff (como `opencode.ts:40-54`) |
| **Scopes sin `Bearer` en LAN** | Cualquiera en LAN postea jobs | Día 1 localhost only; si `TERMCANVAS_HOST=0.0.0.0` exigir `TERMCANVAS_API_TOKEN` como headless |

### Decisiones que tenés que confirmar (1 sola pregunta por turno, pero dejo lista)

1. **Puerto Factory:** ¿`17680` o reutilizar `7080` headless? Propuesta: `17680` evita choque con `server/Dockerfile` prod.
2. **Alcance factory inicial:** ¿una factory por repo (simple) o una global `local` para todos los repos? Propuesta: por repo (mapea `factory.yaml: repositories` 1:1 con tu `projects[]`).
3. **Fallback PTY:** ¿permitir claude/codex vía PTY queue desde día 1 o solo opencode? Propuesta: solo opencode día 1, PTY en F03 fallback si `HARNESS_REGISTRY` no tiene serve.
4. **Persistencia logs:** ¿`logs.ndjson` con ROTATE 10MB o sin límite? Propuesta: clamp 200k como `previewAnsi` (1732 LOC store) + truncate.

### Próximo paso inmediato (recomendado)

**F01** — Prueba de concepto 2 archivos + 1 endpoint:

```ts
// headless-runtime/factory/factoryServer.ts (nuevo, ~120 LOC)
import { encontrarPuertoServidor } from "../interview/puerto-libre.ts";
import { createOpencodeServer } from "@opencode-ai/sdk/v2";
// ensureFactoryServer() singleton, closeFactoryServer(), getFactoryPort()
// start en electron/main.ts junto a apiServer.start()
```

```ts
// shared/factory.ts (nuevo)
export type FactoryJob = {id, phase, worktree, prompt, status, createdAt, logsPath}
export const FACTORY_DEFAULT_PORT = 17680;
```

```ts
// electron/main.ts (add 10 líneas)
import { ensureFactoryServer } from "../headless-runtime/factory/factoryServer.ts";
// did-finish-load: factoryPort = await ensureFactoryServer()
// gracefulShutdown: closeFactoryServer()
```

Luego `curl http://127.0.0.1:17680/factory/health` debe responder `{queue:{pending:0, running:0}, workers:3}` → prueba que la “nube local” existe.

---

## 10. Referencias y Evidencia

### Fuentes Warp (docs/wiki Warp/)

| Archivo | Líneas | Qué cubre |
|---|---|---|
| `docs/wiki Warp/WarpFactories.md` | 1536 | Documento maestro Warp: 19 secciones, launch 2026-08-18, docs 2026-08-28, 700k devs, $10k Early Access, `build.warp.dev` |
| `docs/wiki Warp/WarpFactories-UserStories.md` | 2515 | 155 US, 18 épicas (E01 Factory Core … E18 Factory API), INVEST + Gherkin, matriz MoSCoW 32 Critical / 68 High / 35 Medium / 20 Low |
| `docs/wiki Warp/WarpFactories-Tickets.md` | 496 | 16 tickets T01–T16 (~410 puntos), grafo Mermaid, 39 archivos / 902 tests, `pnpm --filter web check` verde |

### Código TermCanvas Relevante (rutas absolutas, líneas críticas)

| Archivo | Qué demuestra |
|---|---|
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\headless-runtime\interview\harness\opencode.ts:34-60` | Server efímero por fase: `encontrarPuertoServidor(20000,45000)` + `createOpencodeServer({hostname:"127.0.0.1", port, timeout:30s})` + 2 retries |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\headless-runtime\interview\puerto-libre.ts:1-64` | Fix Windows rango dinámico: `LIMITE_RANGO_DINAMICO=49000` + `probarBind` pre-bind |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\electron\main.ts` | `PtyManager` + `ApiServer.listen(0)` + `~/.termcanvas/port` + `terminal:create` IPC |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\electron\pty-manager.ts` | `pty.spawn`, `outputBuffers 1000`, `OutputBatcher 8ms`, `killProcessTree taskkill /T /F` |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\electron\api-server.ts` | Bridge HTTP local via `execRenderer`, sin auth, random port |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\headless-runtime\api-server.ts` | `HeadlessApiServer` 7080 fijo, `Bearer`, WS `/pty/stream`, SSE `/api/terminal/:id/events`, `eventBus` |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\src\terminal\terminalRuntimeStore.ts:1732` | `ManagedTerminalRuntime` + `ensureTerminalRuntime` + `xterm 50k + FitAddon + WebGL + previewAnsi 200k` |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\src\planner\planningSession.ts` | `buildPlanningPrompt` + threshold 12000 → `prompt.md` file + `MAX_PROMPT_ARG_CHARS 28000` trunc + `pollForOutput 1.5s 30min` + resume `-s` |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\src\planner\toolsSession.ts` | `headlessShell="node"` + `run-diagnostico-tools.mjs` + `headlessGate` polling 500ms |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\src\canvas\resolveIssueWorktree.ts` | `CASE A/B/C` → `createTerminal(opencode, Issue #N, buildIssueResolvePrompt)` + `git worktree add` |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\headless-runtime\interview\engine.ts:1128` | Interview scheduler determinístico + `promptStructuredRaw` con `phaseModelRef` + `PhaseActivityEvent` |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\shared\phaseModels.ts` | `PHASE_IDS 7`, `DEFAULT_PHASE_MODELS`, `phaseModelRef`, `phaseCliRef` |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\docs\model-routing-por-fase.md` | Gate por fase, catalog TTL 5min, Flags `codebuddy --model fast-model` (sin provider/) |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\docs\headless-cloud-deployment.md` | Deployment Docker 7080, `Bearer`, `WORKSPACE_DIR=/workspace`, webhooks, `tini` |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\harness-design-essay.md` | “Terminal prose is NOT source of truth; result.json + done marker”; multi-agent cross-vendor |
| `C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\shared\termcanvas-instance.ts` | `getTermCanvasDataDir` + `resolveTermCanvasPortFile` |

### Schemas Publicados (referencia, unauthenticated)

- `https://app.warp.dev/api/v1/factory-files/schemas`
- `https://app.warp.dev/api/v1/factory-files/schemas/v1alpha1`
- Factory MCP: `https://app.warp.dev/api/v1/mcp/factory` (streamable HTTP)
- Control room: `https://build.warp.dev`
- Ejemplos: `https://github.com/warpdotdev/warp-factory-examples` (`00-warp-default-agents`, `01-single-repo-quickstart`, `02-sdlc-issue-to-pr`, `03-multi-harness`, `04-code-review-only`, `06-common-automations`, `07-self-hosted-worker`)

---

## Apéndice — Checklist de Replicación Rápida (copiado de Warp §17 para tu caso)

**P0 (fidelidad):** parser `factory.yaml` v1alpha1 + dual routing GitHub + Factory API local stub + automations engine + work item lifecycle (ya hecho en tu `wiki Warp` como slice local, pero llevarlo a **runtime Factory Local**).

**P1 (dashboard):** work item states + runner limits 32/64 + skills registry + Activity/Runs detail `Stop task` sin confirmación.

**P2 (measure):** scorers invariants + benchmark `Repetitions` + cost `S/M/L/XL`.

Para tu objetivo “gratis”, **P0 + F01-F07 de §8** es el MVP que te da la “nube local” pedida. El resto es hardening.

---

*Generado 2026-08-31. Investigación por 3 agentes en paralelo + síntesis. Próximo paso sugerido: ejecutar F01 (FactoryServer singleton) y validar `GET /factory/health` local antes de tocar UI.*
