# Warp Factories — Historias de Usuario para TermCanvas Web

> **Fuente**: `WarpFactories.md` v2026-08-29 (basado en `https://docs.warp.dev/factories/` Early Access, Last updated 2026-08-28) + `platform/*` + `warp-factory-examples`.
> **Propósito**: Backlog completo, trazable al documento maestro, listo para sprint planning. Cada historia cumple **INVEST** (Independent, Negotiable, Valuable, Estimable, Small, Testable) y usa formato **As a / I want / So that** + **Criterios de Aceptación Gherkin**.
> **Convenciones**: `Puntos` en Fibonacci (1,2,3,5,8,13). `Prioridad`: Critical / High / Medium / Low. `Traza`: referencia a sección de `WarpFactories.md`. `SLO` funcional donde aplica.

---

## Índice de Épicas

| # | Épica | Historias | Prioridad Épica |
|---|-------|-----------|-----------------|
| E01 | Factory Core y Foreman | US-001 → US-006 | Critical |
| E02 | Ciclo de Vida del Work Item (SDLC) | US-007 → US-016 | Critical |
| E03 | Agentes de Fábrica | US-017 → US-027 | Critical |
| E04 | Skills | US-028 → US-033 | High |
| E05 | Automations (Triggers y Filtros) | US-034 → US-045 | Critical |
| E06 | Definitions as Code | US-046 → US-058 | Critical |
| E07 | Runners e Infra | US-059 → US-066 | High |
| E08 | Integraciones — Slack | US-067 → US-072 | High |
| E09 | Integraciones — GitHub | US-073 → US-080 | Critical |
| E10 | Integraciones — GitLab | US-081 → US-085 | Medium |
| E11 | Integraciones — Linear / Jira / Schedule / Factory | US-086 → US-093 | High |
| E12 | Factory Dashboard y Observabilidad | US-094 → US-108 | Critical |
| E13 | Measure and Improve (Scorers/Benchmarks/Self-Improvement) | US-109 → US-120 | High |
| E14 | Factory MCP | US-121 → US-130 | High |
| E15 | Infraestructura, Seguridad y Gobernanza | US-131 → US-139 | High |
| E16 | Sizing, Deployment y Quickstart | US-140 → US-144 | Medium |
| E17 | Troubleshooting | US-145 → US-148 | Medium |
| E18 | Factory API | US-149 → US-155 | High |

**Total: 155 historias** (algunas épicas agrupan variantes; cada ID es entregable en ≤1 sprint).

> **Cómo usar**: Cada historia es un ticket listo para `To Tickets`. Estimación relativa; recalibrar en refinement. Dependencias explícitas para ordenar el grafo.

---

## E01 — Factory Core y Foreman

### US-001 — Crear factory Warp-managed

**As a** Team Owner  
**I want** crear una factory eligiendo team, repos y nombre  
**So that** tengo una instancia desplegada lista para recibir trabajo

**Traza**: §2, §7, §14 — Sizing por product surface, una policy por factory  
**Puntos**: 5 | **Prioridad**: Critical | **Dep**: ninguna

**Criterios de Aceptación:**
```gherkin
Scenario: Crear factory mínima
  Given estoy en "Factories > New"
  When completo name="payments-factory" y selecciono 1 repo acme/payments-service
  And confirmo
  Then veo la factory en el sidebar y abre en Dashboard
  And su alias inicial copia el name

Scenario: Alias inválido es rechazado
  Given intento crear alias con caracteres no permitidos "pay/mnts!"
  When valido
  Then veo error "alias solo [A-Za-z0-9 ._-], max 60"
```

**Notas**: Validar `name` requerido, `alias` charset y unicidad case-insensitive por workspace.

---

### US-002 — Validar Foreman name (alias)

**As a** Admin  
**I want** que el Foreman name valide charset, longitud y unicidad  
**So that** las menciones @ en Slack/Linear routeen sin ambigüedad

**Traza**: §2 Foreman — alias ≤60, `[A-Za-z0-9 ._-]`, único case-insensitive  
**Puntos**: 3 | **Prioridad**: Critical

**Criterios:**
```gherkin
Scenario: Duplicado case-insensitive rechazado
  Given existe foreman alias "Payments"
  When creo alias "payments"
  Then el sistema rechaza por unicidad

Scenario: Longitud límite
  Given alias de 61 caracteres
  When guardo Settings > Identity
  Then veo error de longitud
```

---

### US-003 — Ver identidad preservada del Work Item

**As a** Developer  
**I want** que un work item mantenga identidad de intake a handoff aunque pasen varios agentes  
**So that** no pierdo contexto ni duplico trabajo

**Traza**: §2 Work Item, §3 SDLC  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Un work item spanea varios runs
  Given un work item creado desde GitHub issue
  When Triage, Spec, Implement y Review contribuyen
  Then Activity muestra un solo work item con Event history de 4 runs
  And cada run es inspeccionable (timeline + costo)
```

---

### US-004 — Ver detalle de Run

**As a** Developer  
**I want** abrir un run y ver timeline, costo y sub-agents si es orchestrator  
**So that** audito qué hizo cada agente

**Traza**: §2 Run  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Run con sub-agents
  Given un run orchestrator
  When abro Runs > detalle
  Then veo tab Sub-agents con child runs y costos
```

---

### US-005 — Enforce una policy por factory

**As a** Architect  
**I want** que una factory aplique una sola policy a todas sus work sources  
**So that** evito fragmentación por equipo

**Traza**: §2 Factory, §14 Sizing  
**Puntos**: 2 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: Intento de segunda policy
  Given factory con policy A
  When configuro work source con policy distinta
  Then el sistema sugiere crear factory separada y no permite dos policies
```

---

### US-006 — Diferenciar producto vs factory vs foreman

**As a** New user  
**I want** ver explicado qué es Warp Factories (producto) vs factory (instancia) vs foreman (agente)  
**So that** no confundo conceptos

**Traza**: §2  
**Puntos**: 1 | **Prioridad**: Low

**Criterios:**
```gherkin
Scenario: Onboarding explica triada
  Given abro docs/help
  Then veo glosario con Factory / Foreman / Work Item diferenciados
```

---

## E02 — Ciclo de Vida del Work Item (SDLC)

### US-007 — Intake preserva source context

**As a** Foreman  
**I want** que el intake conserve el source context (Slack thread, GitHub issue, etc.)  
**So that** el agente arranca con contexto real

**Traza**: §3 Intake  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Intake desde Slack
  Given mensaje en Slack #support
  When crea work item
  Then detail pane muestra ticket/thread origen y prompt inicial
```

---

### US-008 — Foreman skipea Triage cuando el request ya es claro

**As a** Requester  
**I want** que el foreman omita Triage si mi request ya explica problema y cambio esperado  
**So that** no pierdo tiempo

**Traza**: §3 Triage skipeable  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Request claro skipea Triage
  Given request "Fix checkout race at app/checkout.ts line 42, repro steps included"
  When foreman evalúa
  Then el work item pasa directo a Planning o Building sin Triage
```

---

### US-009 — Triage investiga antes de reproducir

**As a** Triage agent  
**I want** investigar codebase + issues relacionados antes de reproducir  
**So that** solo reproduzco si la investigación no alcanza

**Traza**: §3 Triage  
**Puntos**: 5 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Triage reporta evidence
  Given work item en Triage
  When triage completa
  Then produce evidence, scope, complexity y open questions
```

---

### US-010 — Planning escribe draft PR con validation criteria

**As a** Spec agent  
**I want** escribir product + technical specs + validation criteria en un draft PR  
**So that** Building tiene contrato claro

**Traza**: §3 Planning  
**Puntos**: 5 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Spec crea draft PR
  Given work item en Planning
  When spec termina
  Then existe draft PR en branch factory/<slug> con specs y criteria
```

---

### US-011 — Planning skipeable para cambios pequeños

**As a** Foreman  
**I want** skipear Planning para cambios pequeños bien entendidos  
**So that** acelero el SDLC

**Traza**: §3 Planning skipeable  
**Puntos**: 2 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: Cambio de 1 archivo skipea Planning
  Given issue "Add Local development section, 1 file, lint check"
  When foreman decide
  Then va directo a Building
```

---

### US-012 — Human approval gate antes de Building si pasó por Planning

**As a** Human reviewer  
**I want** aprobar el spec antes de que Building empiece (si hubo Planning)  
**So that** mantengo control de requisitos

**Traza**: §3 Approval, control humano  
**Puntos**: 3 | **Prioridad**: Critical | **Dep**: US-010

**Criterios:**
```gherkin
Scenario: Gate bloquea Building
  Given work item completó Planning
  When no hay approval humano
  Then Building no inicia y Activity muestra estado "Waiting for approval"
```

---

### US-013 — Building continúa branch del spec

**As a** Implement agent  
**I want** continuar el branch y draft PR del spec, no empezar de cero  
**So that** preservo historial y contexto

**Traza**: §3 Building  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Implement reusa branch
  Given draft PR de spec en factory/add-local-dev
  When implement inicia
  Then sus commits van al mismo branch/PR
```

---

### US-014 — Building agrega tests + validation + evidencia visual

**As a** Implement agent  
**I want** hacer code + tests + validación del repo y capturar evidencia visual si hay computer use  
**So that** el PR es mergeable con pruebas

**Traza**: §3 Building — nunca mergea  
**Puntos**: 5 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Evidencia visual
  Given cambio user-facing y computer use disponible
  When implement termina
  Then el PR incluye screenshot/video como evidencia
  And nunca hace merge (solo handoff)
```

---

### US-015 — Reviewing advisory (accept/revise/ask human)

**As a** Review agent  
**I want** chequear requirements, conventions, tests, security y recomendar accept/revise/ask human  
**So that** el PR tiene gate de calidad sin auto-merge

**Traza**: §3 Reviewing  
**Puntos**: 5 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Review encuentra falta de tests
  Given PR sin tests
  When review evalúa
  Then recomienda "revise" y lista "tests missing"
  And no aprueba ni mergea
```

---

### US-016 — Human handoff y estados terminales

**As a** Developer  
**I want** recibir handoff con evidencia y findings y ver Complete/Cancelled como terminales  
**So that** decido merge con toda la info

**Traza**: §3 Handoff, §10 Activity  
**Puntos**: 2 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Complete no implica merge
  Given work item en Reviewing con recommend accept
  When foreman hace handoff
  Then estado pasa a Complete y veo evidencia + findings
  And el PR sigue open (no mergeado)
```

---

## E03 — Agentes de Fábrica

### US-017 — Configurar agentes default (1 a 4)

**As a** Owner  
**I want** elegir de 1 a 4 agents default (Triage/Spec/Implement/Review) al crear factory  
**So that** arranco con SDLC completo o minimal

**Traza**: §4 Defaults  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Mínimo 1 agente además de foreman
  Given creo factory
  When deselecciono todos los default
  Then veo error "al menos 1 agente además de foreman"
```

---

### US-018 — Editar configuración por agente en dashboard

**As a** Admin  
**I want** editar en Factory > Agents: description, harness, model, runner, workerHost, mcpServers, secrets, instructions  
**So that** ajusto cada rol sin tocar YAML

**Traza**: §4 Configuración por agente, Warp-managed  
**Puntos**: 5 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Edición Warp-managed
  Given factory Warp-managed
  When edito reviewer > model y guardo
  Then valida y commitea en un paso, sin estado inválido
```

---

### US-019 — Read-only en GitHub-backed

**As a** Developer  
**I want** que en GitHub-backed Agents/Automations/Scorers sean read-only en dashboard  
**So that** no haya divergencia con el repo

**Traza**: §4, §7, §10  
**Puntos**: 2 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: GitHub-backed bloquea edición
  Given factory GitHub-backed
  When abro Agents
  Then veo banner "managed in GitHub, edit via PR" y campos deshabilitados con link al repo
```

---

### US-020 — Model y harness distinto por agente

**As a** Admin  
**I want** asignar modelo y harness distinto por agente (oz, claude, codex, gemini)  
**So that** optimizo cada stage

**Traza**: §4 Model y Harness  
**Puntos**: 5 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Review usa harness distinto a Implement
  Given implement en oz, review en claude
  When configuro
  Then cada agente corre en su harness/model sin compartir blind spots
```

---

### US-021 — Gate Build plan para third-party harness

**As a** Free plan user  
**I want** que third-party harnesses requieran Build plan  
**So that** entiendo límites del plan

**Traza**: §4 — Free solo oz  
**Puntos**: 2 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: Free intenta claude
  Given plan Free
  When elijo harness claude
  Then veo upsell "Requires Build plan"
```

---

### US-022 — reasoningLevel solo para codex

**As a** Configurer  
**I want** que `reasoningLevel` solo aparezca para type codex y sea validado  
**So that** no configuro campos inválidos

**Traza**: §4, §7 agentDefaults.harness  
**Puntos**: 2 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: reasoningLevel en oz rechazado
  Given harness type oz con reasoningLevel high
  When valido factory.yaml
  Then error "reasoningLevel only for codex"
```

---

### US-023 — Configurar auth third-party via managedSecret

**As a** Admin  
**I want** configurar harness auth con `managedSecret` o `workerEnvironment`  
**So that** terceros autentican seguro

**Traza**: §4, §7, §13  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Codex con managedSecret
  Given factory.yaml con harness codex auth source managedSecret secretName CODEX_API_KEY
  When valido
  Then pasa y el secret debe estar en allowlist
```

---

### US-024 — Optimización por rol (foreman/triage/spec/implement/review)

**As a** Owner  
**I want** ver guía de qué optimizar por agente (orchestration, research, technical reasoning, coding, blind spots)  
**So that** elijo modelos adecuados

**Traza**: §4 Qué optimizar por agente  
**Puntos**: 1 | **Prioridad**: Low

**Criterios:**
```gherkin
Scenario: Tooltip en Agents
  Given abro Agents > Foreman
  Then veo hint "Optimizar para orchestration / long-running conversations"
```

---

### US-025 — Crear custom agent VERIFY

**As a** Owner  
**I want** agregar un custom agent de tipo VERIFY para jobs no cubiertos (security, docs, migrations)  
**So that** extiendo SDLC más allá de review

**Traza**: §4 Custom, §7 agentType VERIFY  
**Puntos**: 3 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: Custom agent no required para todo work item
  Given custom agent "security-check"
  When creo work item simple
  Then no es requerido; puedo dispararlo solo por automation
```

---

### US-026 — Validar exactamente un foreman

**As a** Validator  
**I want** que la factory tenga exactamente un `agentType: FOREMAN` (alias MAIN)  
**So that** el routing es determinístico

**Traza**: §7 agents/<name>/agent.md — exactly one foreman  
**Puntos**: 2 | **Prioridad**: Critical

**Criterios:**
```gherkin
Scenario: Cero foreman
  Given factory.yaml sin FOREMAN
  When valido con warp/factory-config
  Then error file+line "exactly one foreman required"

Scenario: Dos foreman
  Given dos agents con FOREMAN
  Then error similar
```

---

### US-027 — Setup no elige modelos por defecto

**As a** New factory creator  
**I want** que el wizard no elija modelos y me obligue a configurar cada agente  
**So that** decido costos consciente

**Traza**: §4 Setup no elige modelos  
**Puntos**: 1 | **Prioridad**: Low

**Criterios:**
```gherkin
Scenario: Agente sin modelo
  Given factory recién creada
  When veo Agents
  Then cada agente muestra "model not configured"
```

---

## E04 — Skills

### US-028 — Crear skill factory-wide

**As a** Admin  
**I want** crear un skill en `skills/<name>/SKILL.md` disponible para todos los agents  
**So that** comparto procedimientos (ej. repository-conventions)

**Traza**: §5 Scoping  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Skill global visible para todos
  Given skill skills/repository-conventions/SKILL.md
  When listo skills del foreman
  Then lo veo heredado
```

---

### US-029 — Crear skill per-agent

**As a** Admin  
**I want** crear skill en `agents/foreman/skills/incident-triage/SKILL.md` solo para foreman  
**So that** especializo un rol

**Traza**: §5  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Skill per-agent aislado
  Given skill en foreman/skills/incident-triage
  When listo skills de review
  Then no aparece
```

---

### US-030 — Preview de SKILL.md (frontmatter + args)

**As a** Developer  
**I want** previsualizar `SKILL.md` con frontmatter y argument syntax  
**So that** entiendo el contrato reusable

**Traza**: §5, §16 reference  
**Puntos**: 2 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: Preview renderiza SKILL.md
  Given SKILL.md con frontmatter YAML
  When abro Skills registry
  Then veo render markdown + frontmatter validado
```

---

### US-031 — Skills extienden baseline, no reemplazan

**As a** Developer  
**I want** que customs extiendan GitHub/Slack/tracker built-ins  
**So that** no pierdo capacidades base

**Traza**: §5 Built-ins  
**Puntos**: 1 | **Prioridad**: Low

**Criterios:**
```gherkin
Scenario: Custom + built-in coexisten
  Given factory con custom skill
  When corro agent
  Then tiene tanto GitHub skill como custom
```

---

### US-032 — Skill no amplía acceso

**As a** Security reviewer  
**I want** que un skill solo cambie qué sabe hacer, no qué puede alcanzar  
**So that** el scoping sigue en secrets/MCPs

**Traza**: §5  
**Puntos**: 2 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Skill sin secret
  Given skill que pide SENTRY
  When agent no tiene secret allowlist
  Then falla por falta de credential, no por skill
```

---

### US-033 — Self-improvement edita skill responsable

**As a** Self-improvement run  
**I want** poder editar la skill responsable de un failure recurrente y abrir PR  
**So that** la mejora es versionada y reviewable

**Traza**: §5, §11 Self-improvement  
**Puntos**: 5 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: PR de skill
  Given scorer con selfImprovement true y failures agrupados
  When follow-up run propone fix
  Then abre PR contra skills/<name>/SKILL.md con section Regressions addressed
```

---

## E05 — Automations (Triggers y Filtros)

### US-034 — Crear automation con trigger y filtro

**As a** Admin  
**I want** definir automation con `provider`, `event`, `filter` y `agent` target  
**So that** ruteo eventos a agentes

**Traza**: §6, §7 automation.md  
**Puntos**: 5 | **Prioridad**: Critical

**Criterios:**
```gherkin
Scenario: Labeled issue
  Given automation labeled-issue con provider github event issue_labeled filter repos [acme/payments-service] labels [factory-ready] agent foreman
  When etiqueto issue con factory-ready
  Then inicia run en foreman
```

---

### US-035 — Matching AND/OR: todos los filtros AND, dentro OR

**As a** Automation designer  
**I want** que todos los filtros deban matchear (AND) pero dentro de un filtro cualquier valor matchee (OR)  
**So that** controlo combinaciones precisas

**Traza**: §6 Cómo funciona el matching  
**Puntos**: 3 | **Prioridad**: Critical

**Criterios:**
```gherkin
Scenario: labels [bug, regression] matchea cualquiera
  Given trigger filter labels [bug, regression]
  When issue tiene bug
  Then matchea

Scenario: team + label requieren ambos
  Given filter teams [ENG] labels [bug]
  When issue es ENG sin bug
  Then no matchea
```

---

### US-036 — Filtro vacío = match todo

**As a** Designer  
**I want** que trigger sin filtros dispare por cada evento de su tipo  
**So that** puedo escuchar todo

**Traza**: §6  
**Puntos**: 1 | **Prioridad**: Low

**Criterios:**
```gherkin
Scenario: Trigger sin filter
  Given automation con provider github event issue_created sin filter
  When cualquier issue se crea
  Then dispara
```

---

### US-037 — Un evento dispara N automations → N runs

**As a** Operator  
**I want** ver que un evento puede matchear múltiples automations y genera N runs  
**So that** detecto duplicados

**Traza**: §6  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Slack app_mention + message_posted
  Given dos automations en mismo channel con app_mention y message_posted
  When mensaje menciona app
  Then se crean 2 runs (warning de overlapping en UI)
```

---

### US-038 — Usar in / not_in

**As a** Admin  
**I want** filtrar con `in` / `not_in` para incluir/excluir  
**So that** excluyo wip etc.

**Traza**: §6 Filtros en Definitions  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Excluir wip
  Given filter labels not_in [wip] base_branches [main]
  When PR contra main con label wip
  Then no matchea
```

---

### US-039 — Slack/Linear filters toman nombres y Warp resuelve a IDs

**As a** Configurer  
**I want** usar nombres de channels/users/teams en filters y que Warp resuelva a IDs  
**So that** configuro legible

**Traza**: §6, §7 triggers[].filter  
**Puntos**: 2 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: Slack channel por nombre
  Given filter channels [your-intake-channel]
  When valido
  Then no exige ID, Warp resuelve
```

---

### US-040 — Schedule trigger UTC con cron y descriptores

**As a** Admin  
**I want** trigger schedule con cron 5 campos o `@daily`/`@every 1h`, siempre UTC, con optional name  
**So that** automatizo tareas recurrentes

**Traza**: §6, §7 triggers[].schedule, §9  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Weekly audit
  Given trigger provider schedule event cron_fired schedule cron "0 9 * * 1" name weekly-dependency-audit
  When llega lunes 09:00 UTC
  Then dispara

Scenario: Descriptor @daily
  Given schedule @daily
  Then dispara diario 00:00 UTC
```

---

### US-041 — Factory trigger work_item_stage_changed

**As a** Admin  
**I want** trigger `provider: factory event: work_item_stage_changed`  
**So that** automatizo sobre el pipeline

**Traza**: §6, §7, §9 Factory provider  
**Puntos**: 3 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: Stage change
  Given automation con factory work_item_stage_changed
  When work item pasa de Building a Reviewing
  Then dispara
```

---

### US-042 — Filtros no controlan acceso (separación)

**As a** Security reviewer  
**I want** ver que ajustar un filtro no cambia qué puede alcanzar un agent en runtime  
**So that** no confundo routing con permisos

**Traza**: §6 Filtros no controlan acceso  
**Puntos**: 2 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Filtro no da acceso
  Given automation sin acceso a repo B
  When filtro matchea evento de repo B
  Then run falla por falta de perm del GitHub App, no por filtro
```

---

### US-043 — Control quién inicia runs: author/member/branch

**As a** Owner  
**I want** usar filtros author/member/branch porque anyone puede iniciar (GitHub/GitLab author no necesita ser Warp member)  
**So that** restrinjo quién dispara

**Traza**: §6, §13  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Solo authors allowlist
  Given filter authors [alice]
  When bob crea issue
  Then no dispara
```

---

### US-044 — Editar filtros en dashboard con More filters

**As a** Admin  
**I want** editar en Factory > Automations > Triggers con picker de filtros y More filters por evento  
**So that** configuro sin YAML

**Traza**: §6 Editar filtros  
**Puntos**: 3 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: Probar con test event
  Given edito automation
  When guardo y creo test issue con label factory-ready
  Then veo work item arrancado
```

---

### US-045 — Catálogo 06-common-automations

**As a** Designer  
**I want** ver ejemplos branches/paths/workflow conclusions/emoji reactions  
**So that** copio patrones probados

**Traza**: §6  
**Puntos**: 1 | **Prioridad**: Low

**Criterios:**
```gherkin
Scenario: Catálogo visible
  Given abro Automations > Examples
  Then veo snippets para paths, conclusions [failure], emojis [ticket]
```

---

## E06 — Definitions as Code

### US-046 — Validar factory.yaml con schemaVersion v1alpha1

**As a** Validator  
**I want** que `schemaVersion` solo acepte `v1alpha1` y keys sean case-sensitive  
**So that** evito typos silenciosos

**Traza**: §7 factory.yaml Keys  
**Puntos**: 2 | **Prioridad**: Critical

**Criterios:**
```gherkin
Scenario: schemaVersion inválido
  Given factory.yaml con schemaVersion v2
  When valido
  Then error "only v1alpha1"

Scenario: Key case-sensitive
  Given Name con mayúscula
  Then error
```

---

### US-047 — Requerir repositories y agentDefaults con model|xor harness

**As a** Validator  
**I want** que `repositories` sea required y `agentDefaults` declare exactamente uno de `model` o `harness`  
**So that** la factory es deployable

**Traza**: §7 Keys  
**Puntos**: 3 | **Prioridad**: Critical

**Criterios:**
```gherkin
Scenario: Sin repositories
  Given factory.yaml sin repositories
  Then error

Scenario: Ambos model y harness
  Given agentDefaults con model auto y harness oz
  Then error "mutually exclusive"
```

---

### US-048 — Validar alias y credentialStrategy

**As a** Admin  
**I want** `alias` ≤60 `[A-Za-z0-9 ._-]` y `credentialStrategy` en EXECUTOR|CREATOR  
**So that** foreman mencionable y creds determinísticas

**Traza**: §7  
**Puntos**: 2 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: alias largo
  Given alias 61 chars
  Then error
```

---

### US-049 — Validar integrations solo slack/linear/jira y mutual exclusión

**As a** Validator  
**I want** que `integrations` solo acepte slack/linear/jira y rechace linear+jira juntos  
**So that** evito tracker duplicado

**Traza**: §7 — omitir tracker válido, GitHub no se declara  
**Puntos**: 2 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: linear + jira
  Given integrations [{type: linear},{type: jira}]
  Then error "mutually exclusive"

Scenario: type github
  Given integrations [{type: github}]
  Then error "GitHub via repositories"
```

---

### US-050 — Resolver mcpServers por warpId y secrets scoping

**As a** Admin  
**I want** `mcpServers: {sentry: {warpId: SENTRY_MCP_SERVER_ID}}` y `secrets` factory-wide + per-agent con reemplazo  
**So that** scoping es explícito

**Traza**: §7  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Per-agent secrets reemplaza, no agrega
  Given factory secrets [A,B] y agent secrets [C]
  When resuelvo
  Then agent ve [A,B] factory-wide + [C] (no A,B,C duplicados) — per-agent reemplaza agentDefaults
```

---

### US-051 — Federation cloudProviders quoted projectNumber

**As a** Admin Enterprise  
**I want** `gcp.projectNumber` quoted string + pool/provider ids + optional serviceAccountEmail, y `aws.roleArn`  
**So that** WIF funciona

**Traza**: §7 cloudProviders  
**Puntos**: 2 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: projectNumber sin quotes
  Given gcp projectNumber: 123456 (number)
  Then warning "must be quoted string"
```

---

### US-052 — Estructura de directorios como identidad

**As a** Developer  
**I want** que cada resource tome nombre del path (`agents/reviewer/agent.md` → reviewer)  
**So that** renombrar es mover directorio

**Traza**: §7 Estructura  
**Puntos**: 2 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Nombre por path
  Given file agents/reviewer/agent.md
  Then agent name es reviewer
```

---

### US-053 — agents/<name>/agent.md frontmatter

**As a** Developer  
**I want** frontmatter con `description`, `agentType` (CUSTOM default, FOREMAN alias MAIN, TRIAGE/SPEC/IMPLEMENT/REVIEW/VERIFY), `credentialStrategy` y overrides de execution  
**So that** defino rol durable

**Traza**: §7  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: agentType default
  Given agent.md sin agentType
  Then es CUSTOM

Scenario: Alias MAIN es FOREMAN
  Given agentType MAIN
  Then valido como FOREMAN
```

---

### US-054 — automations/<name>/automation.md frontmatter

**As a** Developer  
**I want** frontmatter con `enabled` default true, `agent` default foreman, `triggers` required con provider/event/filter/schedule y execution overrides  
**So that** defino routing declarativo

**Traza**: §7  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Sin triggers
  Given automation.md sin triggers
  Then error "triggers required"
```

---

### US-055 — runners/<name>.yaml

**As a** Admin  
**I want** `setupCommands`, `instanceShape {vcpus, memoryGb}` juntos, `platform {os, arch, linux.dockerImage|mac.version}`  
**So that** compute es declarativo

**Traza**: §7, §8  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Solo vcpus sin memoryGb
  Given instanceShape vcpus 4
  Then error "must set together"

Scenario: Linux sin dockerImage
  Given platform os linux sin dockerImage
  Then error "requires dockerImage"

Scenario: mac.version default 26 quoted
  Given platform os macos sin mac.version
  Then default "26"
```

---

### US-056 — scorers/<name>/scorer.md con invariantes

**As a** Admin  
**I want** `name` identity, `agents` ≥1, `labels` con score 0..1, `passingScore` threshold, `samplingRate` default 25 (0 stop auto), `model` required, `selfImprovement` default false, y al menos 1 label ≥ passing y 1 por debajo  
**So that** el judge es bien formado

**Traza**: §7 scorers  
**Puntos**: 5 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Sin label failing
  Given labels todas score 1 con passingScore 1
  Then error "need at least one below passing"

Scenario: Renombrar scorer es content edit no move
  Given muevo dir sin cambiar name
  Then identity no cambia
```

---

### US-057 — Ejemplo completo factory definition

**As a** Developer  
**I want** ver ejemplo mínimo `01-single-repo-quickstart` y completo `02-sdlc-issue-to-pr` copiable  
**So that** arranco rápido

**Traza**: §7 Ejemplo completa  
**Puntos**: 1 | **Prioridad**: Low

**Criterios:**
```gherkin
Scenario: Ejemplo copiable
  Given abro docs > Examples
  Then veo YAML/MD listos para copy-paste con factory.yaml + agents/foreman/agent.md + automation + runner
```

---

### US-058 — Pull request checks y validación atómica

**As a** Reviewer  
**I want** que PR contra `main` reciba `warp/factory-config` con anotaciones file+line y que merge aplique atómico o nada  
**So that** nunca hay factory medio válida

**Traza**: §7 PR checks  
**Puntos**: 5 | **Prioridad**: Critical

**Criterios:**
```gherkin
Scenario: PR con field inválido
  Given PR modifica factory.yaml con alias inválido
  Then check annota file+line y resume "qué aplicaría" como failed
  And merge bloqueado por branch protection

Scenario: Definición inválida no aplica parcial
  Given definición inválida mergeada (simulado)
  Then factory sigue en última válida
```

**Edge**: Warp-managed nunca queda inválida (valida al guardar).

---

### US-059 — JSON Schema unauthenticated y validate_factory_files

**As a** Editor  
**I want** schemas en `https://app.warp.dev/api/v1/factory-files/schemas[/v1alpha1]` unauthenticated y tool `validate_factory_files`  
**So that** valido sin login

**Traza**: §7 Machine-readable schema, §12  
**Puntos**: 2 | **Prioridad**: Medium

---

## E07 — Runners e Infra

### US-060 — Crear runner Linux y macOS

**As a** Admin  
**I want** crear runner con `os` linux/macos, `arch` x86_64/aarch64, y `linux.dockerImage` o `mac.version` 14/15/26/27 default 26 quoted  
**So that** cubro builds y UI verification

**Traza**: §8  
**Puntos**: 3 | **Prioridad**: High

---

### US-061 — Enforce máximo 32 vCPU / 64 GiB hosted

**As a** Admin  
**I want** que shapes por encima de 32 vCPU / 64 GiB sean rechazados en hosted y self-hosted exempt  
**So that** respeto límites y entiendo Enterprise override

**Traza**: §8 Sizing y límites, §13  
**Puntos**: 2 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Hosted exceso
  Given runner instanceShape 64 vCPU
  When valido en hosted
  Then error "exceeds hosted max 32/64, contact support"

Scenario: Self-hosted exempt
  Given workerHost self-hosted con mismo shape
  Then pasa
```

---

### US-062 — Concurrencia queueada por team

**As a** Operator  
**I want** ver que concurrencia Warp-hosted limitada por team queuea exceso  
**So that** planifico capacidad

**Traza**: §8  
**Puntos**: 2 | **Prioridad**: Medium

**Criterios:**
```gherkin
Scenario: Queue
  Given 10 runs concurrentes y límite 5
  Then 5 corren y 5 pending queued
```

---

### US-063 — Environment vs Runner vs Host

**As a** Architect  
**I want** ver tabla Environment (repos/setupCommands/image) vs Runner (compute) vs Host (warp/ID) en docs y UI  
**So that** entiendo qué configurar dónde

**Traza**: §8 — Factory colapsa Env+Runner pero plataforma separa  
**Puntos**: 1 | **Prioridad**: Low

---

### US-064 — Selección per-agent / per-automation de runner

**As a** Admin  
**I want** que `agentDefaults.runner` sea default pero cada agent/automation pueda overridear  
**So that** foreman va a Linux y implement a macOS

**Traza**: §8 — `02-sdlc-issue-to-pr` con 3 runners  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Override
  Given agentDefaults runner linux-build
  And implement runner macos
  Then implement corre en macOS y triage en linux-build
```

---

### US-065 — Platform runners CLI (`oz runner`)

**As a** Platform operator  
**I want** `oz runner create/list/update/delete` con `--arch auto` y diferencia con `runners/*.yaml` (`arch: x86_64/aarch64`)  
**So that** orquesto fuera de factory

**Traza**: §8  
**Puntos**: 2 | **Prioridad**: Low

---

### US-066 — Métricas OTel en self-hosted

**As a** SRE  
**I want** métricas OpenTelemetry de self-hosted: worker health, task throughput, capacity saturation  
**So that** opero el worker

**Traza**: §8, §13  
**Puntos**: 3 | **Prioridad**: Medium

---

## E08 — Integraciones — Slack

### US-067 — Conectar Slack y reaccionar 👀

**As a** Admin  
**I want** conectar Slack vía `Add to Slack` (admin approval si requiere) e invitar app a cada channel (privado siempre) y confirmar con mention → 👀  
**So that** Slack routea

**Traza**: §9 Slack — prereqs, connect  
**Puntos**: 3 | **Prioridad**: High

---

### US-068 — Automation Slack con filtros de conversations/authors/keywords/emoji

**As a** Admin  
**I want** triggers `app_mention` / `message_posted` / `message_dm` / `reaction_added` / `member_joined_channel` con filtros conversations/authors/members/keywords/emoji/reacted-message authors  
**So that** intake es preciso

**Traza**: §9 Slack Automations  
**Puntos**: 5 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Reaction intake ticket
  Given trigger reaction_added channels [your-intake-channel] emojis [ticket]
  When reacción ticket en ese channel
  Then dispara (ej. file GitHub issue)
```

---

### US-069 — Constraint Slack: picker solo channels invitados + 2 runs si overlapping

**As a** Operator  
**I want** ver warning si un mensaje matchea `app_mention` + `message_posted` en mismo channel → 2 runs  
**So that** angosto overlapping

**Traza**: §9 Slack Constraints  
**Puntos**: 3 | **Prioridad**: High

---

### US-070 — Start/continue desde Slack (new content only)

**As a** User  
**I want** mention en channel/thread o DM para start (con history + attachments), y plain reply solo continúa si thread ya tiene work item  
**So that** no duplico

**Traza**: §9 Slack Start/continue — edits ignorados  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Plain reply sin work item no crea
  Given thread sin factory work item
  When hago plain reply
  Then no crea work item (requiere mention)

Scenario: Edit ignorado
  Given edito mensaje
  Then no dispara
```

---

### US-071 — Follow y Home tab en Slack

**As a** User  
**I want** que el thread donde empezó sea el seguimiento y ver Home tab agrupado por Triage…Cancelled con filters + links  
**So that** sigo progreso sin salir de Slack

**Traza**: §9 Slack Follow  
**Puntos**: 3 | **Prioridad**: Medium

---

### US-072 — Quién puede iniciar y privacy

**As a** Security owner  
**I want** que mentions/DMs requieran Slack account linkeada a Warp team member y que app solo lea donde es mencionada/DM/suscripta, con email mapeado  
**So that** privacy es clara

**Traza**: §9 Slack Who can start, Privacy  
**Puntos**: 3 | **Prioridad**: High

---

## E09 — Integraciones — GitHub

### US-073 — Conectar GitHub App y automations por defecto

**As a** Admin  
**I want** instalar Warp GitHub App (una install para platform+fábricas), seleccionar repos y recibir 2 automations ON: mentions+assignments start + PR merges close tracker  
**So that** GitHub routea out-of-the-box

**Traza**: §9 GitHub Prereqs/Connect  
**Puntos**: 3 | **Prioridad**: Critical

---

### US-074 — Supported triggers por categoría

**As a** Designer  
**I want** triggers Issues (created/labeled/assigned/mentioned), PRs (opened/ready/reopened/synchronized/assigned/labeled/mentioned/closed/merged/review_requested/review_submitted), Reviews y Code/CI (push/check_suite_completed/check_run_rerequested/check_suite_rerequested/workflow_run_completed)  
**So that** cubro todo el SDLC

**Traza**: §9 GitHub Supported triggers — 20 events  
**Puntos**: 5 | **Prioridad**: High

---

### US-075 — Filters por event (12 filtros con Appears on)

**As a** Admin  
**I want** 12 filtros: Branches, Base branches, Paths, Labels, Authors, Assignees, Mentioned users/teams, Reviewers/Reviewer teams, Review states, Workflows, Conclusions — cada uno con columna Appears on  
**So that** filtro es preciso por event type

**Traza**: §9 Filters por event  
**Puntos**: 5 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Labels en CI matchea PR linkeado
  Given check_suite_completed con filter labels [factory-ready]
  When PR linkeado tiene ese label
  Then matchea (no el run itself)
```

---

### US-076 — Routing dual: label + @warp-factory

**As a** Developer  
**I want** que un evento solo dispare si tiene **ambos**: label `factory:<foremanName>` (auto-creada, auto-borrada al disconnect) **y** mention/assign `@warp-factory` en new content  
**So that** la cuenta compartida routea a la factory correcta

**Traza**: §9 Mencionar la factory — P0  
**Puntos**: 5 | **Prioridad**: Critical

**Criterios:**
```gherkin
Scenario: Mention sin label no dispara
  Given issue con @warp-factory sin label factory:payments
  Then no dispara

Scenario: Label sin mention no dispara
  Given issue con label factory:payments sin mention
  Then no dispara

Scenario: Code block ignorado
  Given mention dentro de ```code```
  Then ignorado

Scenario: Edit y bot mentions ignorados
  Given edito comentario existente con mention
  Then ignorado
```

---

### US-077 — Remover/customizar handle y label

**As a** Admin  
**I want** poder editar mentions automation para responder a `@org/team` o remover label filter para any mention  
**So that** customizo routing

**Traza**: §9 Detalles finos  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-078 — CI re-run solo Warp checks

**As a** Operator  
**I want** que re-run solo funcione para checks que Warp itself creó (GitHub no envía re-run para otros)  
**So that** no espero re-runs imposibles

**Traza**: §9 Code and CI  
**Puntos**: 1 | **Prioridad**: Low

---

### US-079 — Responder en thread correcto y respetar branch protection

**As a** Developer  
**I want** que progreso se postee en originating issue/PR thread con links a run/branch/PR y que branches/PRs respeten branch protection  
**So that** flujo GitHub intacto

**Traza**: §9 Cómo responde  
**Puntos**: 3 | **Prioridad**: High

---

### US-080 — Permissions: App decide reach, anyone puede disparar → filter authors

**As a** Security owner  
**I want** entender que runs auth con GitHub App (no author) y que anyone que cree matching activity puede disparar → usar author/label/branch filters  
**So that** controlo superficie

**Traza**: §9 Permissions  
**Puntos**: 3 | **Prioridad**: High

---

## E10 — Integraciones — GitLab

### US-081 — Conectar GitLab group (top-level, owner, Premium/Ultimate)

**As a** Admin  
**I want** conectar un top-level GitLab group que own (one-to-one workspace↔group, Owner role) y ver que requiere Premium/Ultimate para service accounts + group webhooks  
**So that** GitLab routea

**Traza**: §9 GitLab Prereqs — GitLab.com only  
**Puntos**: 5 | **Prioridad**: High

---

### US-082 — Manager + bot accounts

**As a** System  
**I want** un manager account per workspace (Owner, token 1y, mantiene webhook) + un bot per factory nombrado `<alias>-warp-<shortID>` con Developer role en selected projects  
**So that** creds son scoped

**Traza**: §9 GitLab Service accounts  
**Puntos**: 3 | **Prioridad**: High

---

### US-083 — Triggers Merge request y Bot mentioned con filtros limitados

**As a** Admin  
**I want** `merge_request` (opened/updated/closed/reopened/merged/approved) y `bot_mentioned` (new comment menciona bot username) con filtros Project + Actions + Base branch (y bot solo repos)  
**So that** routeo MRs

**Traza**: §9 GitLab Supported triggers  
**Puntos**: 3 | **Prioridad**: High

---

### US-084 — Bot responde con branch factory/<slug> draft y nunca mergea

**As a** Developer  
**I want** que replies sean en thread mencionado con links, pushes a `factory/<slug>` y draft MRs (ready al terminar), posts review como note + inline discussions, y **never merges/approves**  
**So that** flujo GitLab fiel

**Traza**: §9 GitLab Cómo responde  
**Puntos**: 5 | **Prioridad**: High

---

### US-085 — GitLab no puede hostear definition

**As a** Configurer  
**I want** que GitLab aún no pueda ser repo host de definition (declarar en Warp-managed o GitHub-hosted)  
**So that** no intento flujo no soportado

**Traza**: §9 GitLab Definitions as code  
**Puntos**: 1 | **Prioridad**: Low

---

## E11 — Integraciones — Linear / Jira / Schedule / Factory

### US-086 — Linear: conectar workspace y teams

**As a** Admin  
**I want** OAuth Linear workspace + elegir teams que disparan factory, con default automation `agent_session_created` de esos teams  
**So that** Linear routea

**Traza**: §9 Linear Prereqs/Connect  
**Puntos**: 3 | **Prioridad**: High

---

### US-087 — Linear: agent_session_created routing no editable desde editor

**As a** Admin  
**I want** que narrow por creator/keyword para `agent_session_created` solo sea posible en definition files, no en automation editor  
**So that** entiendo limitación

**Traza**: §9 Linear Route agent sessions  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-088 — Linear: triggers issue/comment + tabla events/outputs + loop caution

**As a** Designer  
**I want** triggers `issue_created/labeled/state_changed/assigned` y `comment_created` con filters teams/labels/project/workflow state/assignee/mentioned user + tabla de qué recibe/manda cada event, y warning que comment que crea agent session también matchea `comment_created` → 2 runs si ambos a factory  
**So that** evito duplicados

**Traza**: §9 Linear Configure + Supported events/outputs  
**Puntos**: 5 | **Prioridad**: High

---

### US-089 — Linear: issue linkeada continúa mismo work item

**As a** Developer  
**I want** que later matching events en misma issue continúen el mismo work item  
**So that** no duplico

**Traza**: §9 Linear Follow-up  
**Puntos**: 2 | **Prioridad**: High

---

### US-090 — Jira: Cloud only + Rovo + projects/keywords

**As a** Admin  
**I want** Jira Cloud only (no Server/DC), Warp como Rovo agent, y filtros `project_keys` + `keywords` case-insensitive en `agent_session_created` (only event), con automations offered to every automation en workspace  
**So that** Jira routea correcto

**Traza**: §9 Jira Prereqs/Filters  
**Puntos**: 5 | **Prioridad**: High

---

### US-091 — Jira: statuses y capacidades del agent

**As a** Developer  
**I want** ver statuses submitted/working/waiting for input/completed/failed/cancelled y que agent pueda leer details/comments/transitions y post/edit comments, change workflow, add/remove labels, reassign (según perms)  
**So that** full Jira lifecycle

**Traza**: §9 Jira Qué pasa durante run  
**Puntos**: 3 | **Prioridad**: Medium

---

### US-092 — Schedule trigger

**As a** Admin  
**I want** provider `schedule` event `cron_fired` con `schedule.cron` 5 campos o `@daily/@every 1h` UTC y optional `name`  
**So that** weekly-dependency-audit corre lunes 09:00 UTC

**Traza**: §6, §9 Schedule  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-093 — Factory trigger stage change

**As a** Admin  
**I want** `provider: factory event: work_item_stage_changed` para automatizar sobre el pipeline  
**So that** reacciono a transiciones

**Traza**: §6, §9 Factory  
**Puntos**: 2 | **Prioridad**: Low

---

## E12 — Factory Dashboard y Observabilidad

### US-094 — Navegación sidebar y scopes team vs factory

**As a** User  
**I want** sidebar con selección de factory → páginas de esa factory, y arriba team-level pages `Runs`, `MCPs and apps`, `Secrets`, `Integrations`  
**So that** no confundo scopes

**Traza**: §10 Getting oriented  
**Puntos**: 3 | **Prioridad**: High

---

### US-095 — Factory definition tab visibility por modo

**As a** User  
**I want** `Factory definition` solo en Warp-managed; en GitHub-backed no aparece (Settings linkea repo); en Live-managed no existe  
**So that** entiendo dónde editar

**Traza**: §10  
**Puntos**: 2 | **Prioridad**: High

---

### US-096 — Metric Total runs con breakdowns y warning flat PRs

**As a** Operator  
**I want** `Total runs` con breakdowns por agent type/status/source/model y tooltip "incluye evaluation/benchmark/self-improvement → flat PRs + ↑ runs = harder tasks/retries"  
**So that** no concluyo causalidad errónea

**Traza**: §10 Dashboard — uso correcto: elegir qué runs investigar  
**Puntos**: 3 | **Prioridad**: High

---

### US-097 — Metrics PRs opened/merged y merged > opened posible

**As a** Operator  
**I want** `PRs opened` contado una vez en periodo first observed y `PRs merged` de esos PRs, con disclaimer "data sources distintos → merged puede > opened" y requiere code host  
**So that** interpreto bien

**Traza**: §10  
**Puntos**: 2 | **Prioridad**: High

---

### US-098 — Metric Autonomy (push semantics)

**As a** Owner  
**I want** `Autonomy` = % merged sin human code push (open PR cuenta como push; comments/reviews/merge no) y requiere code host  
**So that** mido autonomía real

**Traza**: §10  
**Puntos**: 3 | **Prioridad**: High

---

### US-099 — Metric PR cycle time medianas independientes

**As a** Owner  
**I want** `PR cycle time` mediana kickoff→PR→first review→merge con medianas por stage que no suman al headline  
**So that** no sumo mal

**Traza**: §10  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-100 — Metric Cost per PR estimate y breakdown S/M/L/XL

**As a** FinOps  
**I want** `Cost per PR` mediana spliteada si 1 run→N PRs, breakdown por cost component o por size S/M/L/XL (100/500/1000 lines), y disclaimer "estimate, no billing, puede undercount" + expande a Most expensive PRs  
**So that** estimo costo no facturo

**Traza**: §10  
**Puntos**: 5 | **Prioridad**: High

---

### US-101 — Cards Scorers y 3 newest Self-improvement PRs sin date filter

**As a** Owner  
**I want** `Scorer cards` y `Self-improvement PRs` = 3 newest sin importar date range  
**So that** veo calidad y mejoras

**Traza**: §10  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-102 — Activity kanban por stages con filtros

**As a** Developer  
**I want** Activity agrupado `Triage/Planning/Building/Reviewing` + terminales `Complete/Cancelled`, default `Created by = you` + 4 active stages, filtros `Created by`, `Stage`, text search  
**So that** encuentro mis work items

**Traza**: §10 Activity  
**Puntos**: 3 | **Prioridad**: Critical

---

### US-103 — Detail pane con View agent / Event history / Stop task sin confirmación

**As a** Operator  
**I want** click en work item → prompt, ticket/thread, PRs, cost, `View agent`, `Event history`, `Stop task` inmediato sin confirmación (Caution explícito)  
**So that** controlo rápido

**Traza**: §10 Activity  
**Puntos**: 3 | **Prioridad**: High

---

### US-104 — Runs team-level vs factory-level y New → foreman

**As a** Developer  
**I want** Runs team-level (todos) vs factory Runs (solo esa), y `New` para prompt al foreman  
**So that** navego runs correcto

**Traza**: §10 Runs  
**Puntos**: 2 | **Prioridad**: High

---

### US-105 — Timeline + cost + Sub-agents

**As a** Developer  
**I want** al abrir run ver timeline, cost y tab Sub-agents si orchestrator con child runs, y acciones view session / stop / score / convert to benchmark task  
**So that** audito completo

**Traza**: §10 Runs  
**Puntos**: 3 | **Prioridad**: High

---

### US-106 — View session steering sin chat en run page

**As a** Developer  
**I want** run pages sin chat input pero `View session` abre shared session (follow-ups en vivo si sandbox activo, luego transcript)  
**So that** steereo sin confundir UI

**Traza**: §10 Runs — `platform/viewing-cloud-agent-runs/`  
**Puntos**: 3 | **Prioridad**: High

---

### US-107 — Agents/Automations read-only si file-managed + editor no cambia execution

**As a** Configurer  
**I want** Agents/Automations read-only si definition en repo externo y que el automation editor NO cambie execution settings (solo overrides en files)  
**So that** no hay drift

**Traza**: §10 Agents y Automations  
**Puntos**: 3 | **Prioridad**: High

---

### US-108 — Settings (Identity, Repos, PW authorship, Analysis model, Runners, Integrations, Deletion)

**As a** Admin  
**I want** Settings con Identity (name, avatar, Foreman name alias), Repositories, Pull request authorship (credentialStrategy EXECUTOR default vs CREATOR), Analysis model, Runners (read-only si file-managed), Integrations, Deletion no reversible (remueve bot/app)  
**So that** administro factory

**Traza**: §10 Factory Settings, §7 credentialStrategy, §13 credential boundaries  
**Puntos**: 5 | **Prioridad**: High

---

## E13 — Measure and Improve (Scorers / Benchmarks / Self-Improvement)

### US-109 — Crear scorer con judge instructions y classifications

**As a** Owner  
**I want** crear scorer `Factory > Scorers` con `Agent(s) ≥1`, `Judge instructions`, `Judge model`, `Classifications {value, score 0..1, description?}`, `Pass threshold 0..1`, `Sample rate %`  
**So that** mido calidad de runs

**Traza**: §11 Scorers config, §7 scorer.md  
**Puntos**: 5 | **Prioridad**: High

---

### US-110 — Invariante scorer: ≥1 passing y ≥1 failing

**As a** Validator  
**I want** validar que al menos un label ≥ passingScore y al menos uno por debajo  
**So that** el scorer discrimina

**Traza**: §7, §11  
**Puntos**: 2 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Solo passing
  Given labels [a:1, b:1] passingScore 1
  Then error
```

---

### US-111 — Sample rate 0 = stop auto, manual scoring y re-score reemplaza

**As a** Operator  
**I want** `samplingRate 0` detenga scoring automático, poder scorear on demand y que re-score reemplace previo, y que cambiar `passingScore` solo cambie display histórico  
**So that** itero sin ruido

**Traza**: §11 Scorers  
**Puntos**: 3 | **Prioridad**: High

---

### US-112 — Scoring automático con reasoning

**As a** System  
**I want** poco después de sampled run completo: judge evalúa y registra classification + score + reasoning visible en dashboard  
**So that** debuggeo failures

**Traza**: §11  
**Puntos**: 3 | **Prioridad**: High

---

### US-113 — Crear benchmark (single agent, fixed tasks, configs, repetitions, scorers)

**As a** Owner  
**I want** benchmark de un solo agente con `Tasks {prompt + success criteria}`, `Configurations {harness/model/runner}`, `Scorers`, `Repetitions` por task+config  
**So that** comparo configs antes de adoptar

**Traza**: §11 Benchmarks  
**Puntos**: 5 | **Prioridad**: High

---

### US-114 — Task desde run detail pane (copia input)

**As a** Developer  
**I want** crear benchmark task desde completed run detail pane (copia input; agrego success criteria antes de launch)  
**So that** reutilizo prompts reales

**Traza**: §11 Benchmarks  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-115 — Correctness built-in y no elegir ganador

**As a** Operator  
**I want** que cada benchmark corra `Correctness` built-in vs success criteria, muestre pass rates/cost/quality per config con per-task detail, y **no combine en score ni elija ganador** (humano pondera)  
**So that** decisión es humana

**Traza**: §11 Benchmarks  
**Puntos**: 3 | **Prioridad**: High

---

### US-116 — Credit totals benchmarks no incluyen model usage

**As a** FinOps  
**I want** disclaimer "credit totals no incluyen model usage → costo real mayor" en benchmarks y Cost per PR  
**So that** no subestimo costo

**Traza**: §11  
**Puntos**: 1 | **Prioridad**: Low

---

### US-117 — Self-improvement por scorer agrupa failures → PRs

**As a** Owner  
**I want** toggle `selfImprovement: true` por scorer; que agrupe related failures y filee follow-up tasks como ordinary runs que pueden editar app code o factory definition  
**So that** failures se convierten en mejora

**Traza**: §11 Self-improvement, §7  
**Puntos**: 5 | **Prioridad**: High

---

### US-118 — PR self-improvement con Regressions addressed

**As a** Reviewer  
**I want** cada self-improvement PR con section `Regressions addressed` linkeando failing runs + Scorer results (traceability)  
**So that** entiendo por qué se propone

**Traza**: §11  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-119 — Nada se adopta sin review (app y factory)

**As a** Owner  
**I want** que ni cambios a app code ni a factory definition se adopten sin review humano  
**So that** gobierno intacto

**Traza**: §11  
**Puntos**: 2 | **Prioridad**: High

---

### US-120 — Improvement loop 6 pasos medible

**As a** Owner  
**I want** guía `Define Scorer → Collect baseline → Inspect failures → Benchmark candidate → Review and adopt → Keep monitoring` con loop Repeated failures → Self-improvement y principio "cambiar una cosa medible a la vez"  
**So that** mejoro sistemático

**Traza**: §11 Improvement loop mermaid  
**Puntos**: 2 | **Prioridad**: Low

---

## E14 — Factory MCP

### US-121 — Conectar MCP desde Warp (cero config)

**As a** Warp user  
**I want** que Factory MCP en `https://app.warp.dev/api/v1/mcp/factory` (streamable HTTP) requiera nada si ya tengo acceso — Warp maneja auth  
**So that** onboarding es instantáneo

**Traza**: §12 Conexión en Warp  
**Puntos**: 2 | **Prioridad**: High

---

### US-122 — Onboarding coding agent con prompt canónico

**As a** New user  
**I want** pegar `Set up a factory for me. Read https://docs.warp.dev/factories/factory-mcp.md...` y que el agent me guíe por team/code host/repos/agents/integrations y al terminar linkee dashboard  
**So that** setup sin wizard

**Traza**: §12  
**Puntos**: 3 | **Prioridad**: High

---

### US-123 — MCP clients externos y headless bearer

**As a** Developer  
**I want** conectar Claude Code (`claude mcp add --transport http ...`), Cursor (`mcpServers` JSON) o Codex vía URL, y en CI usar `Authorization: Bearer YOUR_API_KEY`  
**So that** cualquier coding agent conecta

**Traza**: §12  
**Puntos**: 3 | **Prioridad**: High

---

### US-124 — Warning sin scopes read-only/per-factory

**As a** Security owner  
**I want** ver warning "Factory MCP no tiene read-only ni per-factory scopes: full permissions del account" y guardar keys en secret storage nunca en repo  
**So that** no expongo creds

**Traza**: §12  
**Puntos**: 1 | **Prioridad**: Low

---

### US-125 — Send work in (factory task)

**As a** Developer local  
**I want** `send_task` con target factory, title y note (goal + context + constraints + work done) y que foreman reporte progress en conversation  
**So that** delego bug/half-finished change

**Traza**: §12 Mandar nuevo trabajo  
**Puntos**: 5 | **Prioridad**: High

---

### US-126 — Push branch/PR antes de send si hay local changes

**As a** Developer  
**I want** recomendación "push branch o abrir PR primero y referenciarlo en note para que factory vea trabajo"  
**So that** contexto no se pierde

**Traza**: §12  
**Puntos**: 1 | **Prioridad**: Low

---

### US-127 — Pick up task y trabajar local en worktree

**As a** Developer  
**I want** `list_tasks`/`search_task`/`get_task` (por ID o reference: URL, PR, Slack permalink, Linear/Jira issue, branch) y `get_task(start_working=true)` que retorne status+run history+guidance de Git worktree aislado (MCP nunca modifica files)  
**So that** continúo local con mis tools

**Traza**: §12 Tomar task  
**Puntos**: 5 | **Prioridad**: High

---

### US-128 — Mensajear foreman y leer conversación sin mover task

**As a** Developer local  
**I want** `message_foreman` y `get_conversation` que no muevan la task ni hagan handoff  
**So that** coordino sin side-effects

**Traza**: §12  
**Puntos**: 3 | **Prioridad**: High

---

### US-129 — Commit/push + hand-back con branch/PR URL + note; complete_task cierra

**As a** Developer  
**I want** validar, commit+push, luego `send_task` con task ID + pushed branch/PR URL + note (qué cambió/validé/quedó) y que foreman decida next step; factory no ve uncommitted; picking up no claim/lock/pause (warning chequear active runs); `complete_task` cierra  
**So that** hand-back es trazable

**Traza**: §12  
**Puntos**: 5 | **Prioridad**: High

---

### US-130 — Notificaciones best-effort y tool reference 19 tools

**As a** Operator  
**I want** `list_notification_routes` (Slack DM/Linear issue) → elección a `send_task`, delivery best-effort, y referencia 19 tools con onboarding `list_teams`→`create_factory` que requieren browser sign-in  
**So that** opero MCP completo

**Traza**: §12 Tool reference  
**Puntos**: 2 | **Prioridad**: Medium

---

## E15 — Infraestructura, Seguridad y Gobernanza

### US-131 — Entender control vs execution plane

**As a** Architect  
**I want** ver split: control plane (Warp coordina identity/config/observabilidad/integrations/storage/inference routing) vs execution plane (Warp-hosted sandbox o managed self-hosted worker)  
**So that** elijo hosting consciente

**Traza**: §13 Control plane vs Execution plane — diagrama Mermaid  
**Puntos**: 2 | **Prioridad**: High

---

### US-132 — ZDR: code context siempre viaja a Warp/providers

**As a** Security owner  
**I want** disclaimer "Self-hosting mueve solo execution; prompts/results/transcripts/artifacts/telemetry siguen por Warp + providers bajo Zero Data Retention (ZDR) — self-hosted no es offline; session transcripts via Warp backend bajo ZDR"  
**So that** evalúo data flow

**Traza**: §13  
**Puntos**: 3 | **Prioridad**: High

---

### US-133 — Elegir execution host (outbound only, backends)

**As a** Platform engineer  
**I want** tabla Warp-hosted vs managed self-hosted (compute, checkout, control plane, network outbound sin inbound port, private services, operations) y pasos: deploy `oz-agent-worker` con agent API key (`linux/amd64|arm64`) → pair runner compatible → `workerHost: ID`, con backends Docker/K8s/Direct y OTel metrics  
**So that** despliego self-hosted

**Traza**: §13 Elegir execution host  
**Puntos**: 5 | **Prioridad**: High

---

### US-134 — Unmanaged no puede ser factory execution host pero sí MCP

**As a** Developer  
**I want** `oz agent run` directo (unmanaged) y otros CLI agents no puedan ser factory host pero sí exchange via Factory MCP, y pattern CLI-only = bring-your-own-orchestrator  
**So that** entiendo límites

**Traza**: §13, §14 Deployment patterns  
**Puntos**: 1 | **Prioridad**: Low

---

### US-135 — Tres elecciones independientes (execution/inference/storage) Enterprise only

**As a** Buyer  
**I want** ver que execution/inference/storage son independientes, todas requieren Enterprise, customer-supplied inference limitado a providers que soportan cloud agents, retention sigue mi contrato, storage S3/GCS bucket mío pero config/run metadata queda en Warp  
**So that** planifico Enterprise

**Traza**: §13 Elegir execution/inference/storage  
**Puntos**: 3 | **Prioridad**: Medium

---

### US-136 — Credential boundaries 4 tipos

**As a** Security reviewer  
**I want** tabla: Inference creds (solo inference, nunca sandbox), Execution secrets (per-agent allowlist, redaction backstop), Harness auth (separado), Repo identity (EXECUTOR default vs CREATOR)  
**So that** scopeo correcto

**Traza**: §13 Credential boundaries, §7 credentialStrategy  
**Puntos**: 3 | **Prioridad**: High

---

### US-137 — Governance sin factory-specific role

**As a** Owner  
**I want** governance use existing Team Owners/Admins (no factory-specific approval); tratar definition changes como ops code con review  
**So that** gobierno simple

**Traza**: §13 Governance  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-138 — Metering credits

**As a** FinOps  
**I want** metering: hosted compute/Warp inference/platform services consumen credits; self-hosted compute + BYO inference billan en mi account pero platform services siempre credits  
**So that** presupuesto correcto

**Traza**: §13 Metering — `support-and-community/plans-and-billing/platform-credits`  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-139 — Deployment checklist 7 pasos

**As a** Operator  
**I want** checklist: Classify workload → Choose execution → Configure factory+runners → Choose inference/storage → Scope credentials → Set review gates → Validate operations (egress/isolation/rotation/redaction/capacity/observabilidad/metering)  
**So that** deploy seguro

**Traza**: §13 checklist  
**Puntos**: 2 | **Prioridad**: High

---

## E16 — Sizing, Deployment y Quickstart

### US-140 — Sizing por product surface anti-patrón por equipo

**As a** Architect  
**I want** guidance: 1 factory por app/marketing site/data pipelines; anti-patrón partir mismos repos por team (frontend vs platform) → agregar agents/skills  
**So that** sizeo correcto

**Traza**: §14 Sizing, §2  
**Puntos**: 1 | **Prioridad**: Low

---

### US-141 — 3 deployment patterns

**As a** Architect  
**I want** matriz CLI-only (trigger CLI, bring-your-own, anywhere) vs Warp-hosted (Warp control, hosted sandbox) vs Self-hosted (Warp control, managed worker Docker/K8s/Direct)  
**So that** elijo pattern

**Traza**: §14 Deployment patterns — `platform/deployment-patterns`  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-142 — Quickstart wizard 7 pasos

**As a** New user  
**I want** wizard: `+ Factories → GitHub/GitLab org/group → Select 1-2 repos focused → Factory name+alias → Slack optional → toggle agents (Triage/Spec/Implement/Review, min1, Implement ON) → tracker Linear/Jira optional` + conectar providers y verificar con test mention  
**So that** creo factory en minutos

**Traza**: §14 Quickstart — `factories/quickstart`  
**Puntos**: 3 | **Prioridad**: High

---

### US-143 — First work item verbatim

**As a** New user  
**I want** ejemplo canónico first request: `Add a "Local development" section to README.md... Keep change to that one file, run lint, open PR` (single file, expected change, verification command)  
**So that** pruebo factory con tarea acotada

**Traza**: §14 Quickstart  
**Puntos**: 1 | **Prioridad**: Low

---

### US-144 — Factory MCP onboarding alternativa al wizard

**As a** Developer  
**I want** usar el prompt MCP setup como alternativa al wizard UI  
**So that** creo factory desde mi coding agent

**Traza**: §14  
**Puntos**: 1 | **Prioridad**: Low

---

## E17 — Troubleshooting

### US-145 — Setup troubleshooting (4 casos)

**As a** Support engineer  
**I want** help para: Don't have access (Early Access per team → Request access), Repo no aparece (app no cubre → owner extienda), Agent limit (plan → sales), Wizard no actualiza tras MCP (refresh)  
**So that** resuelvo setup sin ticket

**Traza**: §18 Setting up  
**Puntos**: 2 | **Prioridad**: Medium

---

### US-146 — Work isn't starting: automation mismatch + per-source causes

**As a** Operator  
**I want** guía "casi siempre es automation mismatch, no conexión rota: enabled + event type + every filter AND + source conectada a *esta* factory" + tabla Slack (app no en channel/pending/linked account), GitHub (app no cubre repo/label missing/event no incluido/single filter), GitLab (edit vs new, username, plan sin webhooks), Linear (linked account/teams/filters), Jira (app no conectada/project/keywords)  
**So that** diagnóstico en minutos

**Traza**: §18 Work isn't starting  
**Puntos**: 5 | **Prioridad**: High

---

### US-147 — One action → two runs

**As a** Operator  
**I want** explicación "Two automations matchean mismo event → 2 runs; narrow/remove overlapping" con ejemplo Slack app_mention+message_posted  
**So that** elimino duplicados

**Traza**: §18, §6  
**Puntos**: 2 | **Prioridad**: High

---

### US-148 — Runs/work items: Stop task, stuck vs waiting on human, no PR

**As a** Operator  
**I want** fixes: `Stop task` en Activity es inmediato sin confirmación; stuck a menudo es waiting on person (spec approval/questions/PR) → ver Event history/View agent/steer; No PR → Implement disabled o sin write access o no llegó a Building  
**So that** desbloqueo work

**Traza**: §18 Runs and work items  
**Puntos**: 3 | **Prioridad**: High

---

## E18 — Factory API

### US-149 — Listar y buscar factories

**As a** Integrator  
**I want** `GET /api/v1/factory?search=payments` case-insensitive sobre name/alias y `GET /api/v1/factory/{uid}`  
**So that** descubro factories por código

**Traza**: §19 Endpoints, `factories/factory-api`  
**Puntos**: 3 | **Prioridad**: High

**Criterios:**
```gherkin
Scenario: Search case-insensitive
  Given factories "payments-factory" alias "payments"
  When GET /factory?search=PAYMENTS
  Then la encuentra
```

---

### US-150 — Dispatch run al foreman

**As a** Integrator  
**I want** `POST /api/v1/factory/{uid}/runs` con `prompt` required, `title` opcional derivado, `ticket_ref` opcional `<source>:<id>` (linear:PAY-123), `ticket_url` opcional; server resuelve foreman  
**So that** disparo work programáticamente

**Traza**: §19  
**Puntos**: 5 | **Prioridad**: Critical

**Criterios:**
```gherkin
Scenario: Solo prompt
  Given POST con {prompt: "Fix checkout race"}
  Then crea run y title derivado de prompt

Scenario: Con ticket_ref case-sensitive check
  Given ticket_ref "linear:PAY-123" y ticket_url
  Then task linkeada a Linear
```

---

### US-151 — Auth Bearer y OzAPI SDK

**As a** Developer  
**I want** `Authorization: Bearer YOUR_API_KEY` y SDK `OzAPI` con `client.factories.list/get` y `client.factories.runs.create(uid, prompt, title, ticket_ref)` + ejemplo curl  
**So that** integro rápido

**Traza**: §19 Auth  
**Puntos**: 2 | **Prioridad**: High

---

### US-152 — Continuar via Agent API (ordinary run)

**As a** Integrator  
**I want** que dispatched run sea ordinary cloud agent run y poder `GET /agent/runs/{runId}`, `POST /followups`, `POST /cancel`  
**So that** monitoreo y cancelo

**Traza**: §19 Continue/monitor  
**Puntos**: 3 | **Prioridad**: High

---

### US-153 — Validar ticket_ref format

**As a** Validator  
**I want** `ticket_ref` regex `^[a-z]+:[A-Za-z0-9-_]+$` rechazado si no match y tabla Factory API vs Agent API  
**So that** input robusto

**Traza**: §19 Para TermCanvas  
**Puntos**: 1 | **Prioridad**: Low

---

### US-154 — Mattermost bot guide

**As a** Integrator  
**I want** link a `guides/external-tools/build-a-mattermost-bot-for-warp-factories` como ejemplo bot  
**So that** copio patrón

**Traza**: §19  
**Puntos**: 1 | **Prioridad**: Low

---

### US-155 — Stub mock para swap a Warp real

**As a** TermCanvas developer  
**I want** implementar `GET/POST /api/v1/factory` como mock con mismos paths/fields para que swap a Warp real sea drop-in  
**So that** desarrollo sin Warp

**Traza**: §19 Para TermCanvas  
**Puntos**: 2 | **Prioridad**: High

---

## Apéndice A — Matriz de Priorización (MoSCoW)

| Prioridad | Criterio | Cantidad |
|---|---|---|
| **Critical** | Sin esto la réplica no es reconocible como Factory (lifecycle, foreman, GitHub dual-label, scoring invariantes, PR checks, Activity/Runs core, Factory API dispatch) | 32 |
| **High** | Necesario para experiencia completa (runners, Slack, Linear, MCP send/pickup, dashboard metrics, scorer CRUD, cost estimate) | 68 |
| **Medium** | Valor claro pero postergable 1 sprint (GitLab premium, benchmarks repetitions, OTel, troubleshooting) | 35 |
| **Low** | Pulido/docs (glosario, ejemplos copiables, Jira keywords) | 20 |

**Orden sugerido de implementación** (value/risk):
1. E06 Definitions parser + E05 Automations engine + E02 SDLC skeleton → esqueleto anda
2. E03 Agents + E09 GitHub dual-label + E12 Dashboard Activity/Runs → flujo issue→PR visible
3. E18 Factory API stub + E14 MCP stub → intake programático
4. E08 Slack + E11 Linear/Jira/Schedule + E07 Runners → multi-source
5. E13 Scorers/Benchmarks/Self-improvement + E12 Metrics → measure loop
6. E10 GitLab + E15 Infra/ZDR + E17 Troubleshooting → enterprise completeness

---

## Apéndice B — Criterios de Aceptación Compartidos (Definition of Done)

- [ ] Criterios Gherkin pasan en `pnpm --filter web test` (o teatest golden donde aplique)
- [ ] Validación `warp/factory-config` style: annota file+line para inputs inválidos
- [ ] No hay secrets en repo; `factory.yaml` y `agent.md` parsean con JSON Schema `v1alpha1` unauthenticated
- [ ] Runner `arch`/`dockerImage`/`mac.version` constraints testeadas (incl. `projectNumber` quoted)
- [ ] Slack/GitHub filters: AND/OR + `in`/`not_in` + overlapping warning cubiertos por tests
- [ ] Dashboard metrics: disclaimers visibles (estimate, merged>opened, evaluation inclusion, 3 newest)
- [ ] A11y y i18n: labels en inglés (artefactos técnicos), UI copy consistente

---

## Apéndice C — Dependencias Clave (Grafo)

```
US-001 (crear factory) → US-002, US-017, US-046..US-059, US-094..US-108
US-026 (exactly one foreman) → US-018, US-053
US-034 (automation) → US-035..US-045 → US-073..US-093 (per-provider)
US-046..US-056 (parser) → US-058 (PR checks) → US-059 (schemas)
US-060..US-064 (runners) → US-108 (Settings Runners) / US-133 (self-hosted)
US-073 (GitHub App) → US-076 (dual label) → US-146 (troubleshoot)
US-094 (dashboard shell) → US-096..US-107
US-109..US-112 (scorers) → US-117..US-119 (self-improvement)
US-113..US-115 (benchmarks) ← US-105 (convert task)
US-121..US-130 (MCP) → US-155 (stub)
US-149..US-152 (Factory API) → US-155 (stub)
```

---

## Apéndice D — Historia de Ejemplo Completa (Referencia de Calidad)

> Esta historia muestra el estándar esperado para TODAS.

```markdown
## US-076 — Routing dual: label + @warp-factory

**As a** Developer
**I want** que un evento solo dispare si tiene ambos: label `factory:<foremanName>` y mention `@warp-factory`
**So that** la cuenta compartida routea a la factory correcta sin colisiones

**Traza**: §9 GitHub — Mencionar la factory (P0)
**Puntos**: 5 | **Prioridad**: Critical | **Dep**: US-073

**Criterios de Aceptación:**
```gherkin
Scenario: Mention sin label no dispara
  Given issue con "@warp-factory please fix" sin label factory:payments
  When el evento issue_mentioned llega
  Then no se crea work item
  And no se deducta crédito

Scenario: Mention en code block ignorada
  Given body "```\n@warp-factory\n```"
  Then ignorado

Scenario: Auto-creación y auto-borrado de label
  Given factory payments conectada a acme/api-service
  Then el repo tiene label factory:payments (creada por Warp)
  When desconecto factory o la borro
  Then label es removida

Scenario: PR de factory lleva su label
  Given implement abre PR
  Then PR tiene label factory:payments
```

**Notas**: Implementar como servicio `GitHubRoutingService.isRoutable(event)` puro y testeable. Ver `warp-factory-examples` `06-common-automations`.
```

---

*Total historias: 155 — Épicas: 18 — Puntos estimados totales: ~410 — Basado en `WarpFactories.md` 1187 líneas, 19 secciones — Última actualización: 2026-08-29 — Generado con skill `user-story-writing` (INVEST + Gherkin + Story Slicing).*

*Próximo paso: `To Tickets` — convertir cada US en ticket con blocking edges según Apéndice C, y priorizar Critical → High en refinement.*
