# ENV-MAP — B1–B8 → env vars / secrets scoping (P2-03)

> **Fuente:** `PLAN-OLAS-WARP-FACTORIES.md` §8.4 Feature flag + Apéndice B · `ADR-001`  
> **Objetivo:** mapear los 8 bloqueantes de backend a env vars/secrets, ports y credential boundaries, para que el día del swap el cambio sea `port` + env y no rewrite.  
> **Hoy:** LOCAL no necesita ninguna de estas vars. Este doc es solo tabla de diseño.

## Resumen — ¿por qué este mapa?

LOCAL demoa sin credenciales (0 vars requeridas). Cada bloqueante B1–B8 corresponde a una integración externa que Warp ya resuelve en su control plane. Cuando exista `VITE_FACTORY_BACKEND=remote`, cada `Remote*Adapter` leerá estas vars y las enviará por el **boundary** correcto (no todas al mismo sitio).

## Tabla canónica B1–B8

| Bloqueante | Env var / secret | Port | Boundary | Estrategia | Scoping |
|------------|------------------|------|----------|------------|---------|
| **B1** GitHub App | `GITHUB_APP_ID` · `GITHUB_APP_PRIVATE_KEY` · `GITHUB_INSTALLATION_ID` | `FactoryApiTransportPort` (repos, `GET /api/v1/factory?search`, `POST /factory/:uid/runs`) | **execution** — `Repository identity` | `EXECUTOR` (default) — runs actúan con auth del worker/app, no del creador | Por repo: la install debe tener acceso a `owner/repo` de la factory. Rotación vía GitHub App private key. |
| **B2** Slack OAuth | `SLACK_BOT_TOKEN` · `SLACK_SIGNING_SECRET` | `McpTransportPort` (`send_task` notifications, `list_notification_routes` best-effort) | **execution** — `Execution secrets` | `EXECUTOR` | Allowlist per-agent (`secrets: [...]` en `factory.yaml` + `agent.md`). Warp redacta valores en output (backstop). |
| **B3** Linear/Jira | `LINEAR_OAUTH_TOKEN` · `JIRA_ROVO_API_KEY` · `JIRA_PROJECT_KEYS` (ej. `ENG,PROJ`) | `FactoryApiTransportPort` (`ticket_ref` `linear:` / `jira:` + `POST /agent/runs/:id/followups`) | **execution** — `Execution secrets` | `EXECUTOR` | Scopes por Linear team / Jira project. `B3` es B1-like: sin token, `ticket_ref` es solo string validado (`TICKET_REF_PATTERN`) sin live lookup. |
| **B4** GitLab | `GITLAB_MANAGER_TOKEN` · `GITLAB_BOT_NAME` · `GITLAB_GROUP_ID` | `FactoryApiTransportPort` (repos GitLab + `GITLAB_BOT_RESPONSE`) | **execution** — `Repository identity` | `EXECUTOR` vs `CREATOR` configurable | Bot name `formatGitLabBotName()`; `GITLAB_DEFINITION_HOSTING_SUPPORTED` check. |
| **B5** Factory MCP live | `WARP_API_KEY` (`Bearer`) | `McpTransportPort` (`POST https://app.warp.dev/api/v1/mcp/factory` streamable) | **harness auth** — `Harness authentication` (solo `oz`) | `Bearer` headless | En `web`, `Authorization: Bearer $WARP_API_KEY`. En stub, `FactoryMcpStub.authenticate()` es best-effort local; en prod requiere Bearer siempre. |
| **B6** Factory API live | `WARP_API_KEY` (misma que B5) | `FactoryApiTransportPort` (`GET /api/v1/factory`, `POST /factory/:uid/runs`, Agent API) | **harness auth** | `Bearer` | Misma key que B5; si se rotan, rotan juntas. `DEFAULT_API_KEY="warp_local_api_key"` solo para LOCAL. |
| **B7** Harness credentials | `ANTHROPIC_API_KEY` · `CODEX_API_KEY` · `GEMINI_API_KEY` | `McpTransportPort` (inference routing) | **inference** — `Inference credentials` | Nunca en sandbox | Solo en inference boundary; nunca inyectadas en execution sandbox. ZDR si provider lo soporta. Customer-supplied inference es Enterprise. |
| **B8** Self-hosted runner | `SELF_HOSTED_WORKER_ID` · `OTEL_ENDPOINT` (· `workerHost`) | `WorkItemRepositoryPort` (execution plane) | **execution** — `Worker` (self-hosted vs Warp-hosted) | `EXECUTOR` | Worker outbound a Warp (sin inbound firewall). OTEL metrics: `worker health`, `task throughput`, `capacity saturation`. |

## Las 4 credential boundaries (de `CREDENTIAL_BOUNDARIES`)

Del dominio `infra.derive.ts` — definen **dónde** vive cada secret y qué garantías tiene:

1. **Inference credentials** — para model provider requests. **Solo en inference boundary; nunca inyectadas en el sandbox.** (B7)
2. **Execution secrets** — APIs, registries, tools del agent. **Allowlist explícita per-agent; agents que no actúan como specific user no reciben managed secrets por default.** Declarados en `secrets` (factory-wide) y `per-agent secrets` (reemplazo). Warp redacta known values en outputs (backstop, no sustituto de narrow permissions y rotación). (B2, B3, B4)
3. **Harness authentication** — solo `oz` (Warp Agent). **En este workspace solo `oz`: `harness.auth` y `reasoningLevel` no aplican.** `oz` no requiere credenciales externas; ver WarpFactories.md §4. (B5, B6)
4. **Repository identity** — checkout y push. **Runs actúan con la authorization del creating user (changes atribuidos a ellos) o como el agent itself para unattended work; set por `credentialStrategy` (`EXECUTOR` default vs `CREATOR`).** (B1, B4, B8)

## EXECUTOR vs CREATOR

- **EXECUTOR (default):** el run actúa con la identidad del **worker/app** (GitHub App, GitLab bot, Slack bot). Es el default porque es auditable y no requiere token personal del usuario.
- **CREATOR:** el run actúa como el **usuario que creó el work item** (ej. `createdBy: "Benjamin Holmes"`). Requiere OAuth del creador y es menos común (solo cuando el repo exige authorship del humano).

El flag `credentialStrategy: "EXECUTOR" | "CREATOR"` vive en `FactoryDefinition.agentDefaults.credentialStrategy` y se hereda per-agent. El port no decide la estrategia — la respeta.

## Scoping y allowlist

- **Factory-wide secrets:** `factory.yaml: secrets: ["SLACK_BOT_TOKEN", "LINEAR_OAUTH_TOKEN"]` — disponibles para todos los agents de esa factory.
- **Per-agent secrets:** `agents/<name>/agent.md` frontmatter `secrets: ["ANTHROPIC_API_KEY"]` — reemplazo, no merge (el agent solo ve sus secrets + factory-wide si no los sobre-escribe).
- **Least privilege:** si `B2` no está en `secrets`, el `McpTransportPort` no lo recibe aunque exista en el env — el allowlist es el gate.

## Qué significa para el spike (hoy)

- **0 env vars requeridas** para LOCAL. `VITE_FACTORY_BACKEND` default `local` y `isBackendEnabled() === false` sin env.
- Las 8 filas son **solo tabla de diseño** — no hay código que lea estas vars todavía (ver `ADR-001` D4: flag sin uso runtime aún, intencional).
- El día del trigger (ver `BACKEND-TRIGGER.md` 2026-11-01), el `RemoteAdapter` leerá `import.meta.env` y `process.env` según target (Vite client vs Node worker) y las pasará al `FetchTransport` correspondiente.

## Verificación

- `tsc -b 0` — ports solo tipos, sin importar `process.env` en dominio.
- `vitest` — `ports.contract.test.ts` verifica que `isBackendEnabled()` es `false` por defecto y que `InMemoryTransport` no necesita secrets.
- `grep -r "VITE_FACTORY_BACKEND" web/src` → solo `config/featureFlags.ts` + doc (no en stores).

## Referencias

- `PLAN-OLAS-WARP-FACTORIES.md` §8.4 (tabla original), §11 P7, Apéndice B
- `ADR-001` (decisión `handle` vs `fetch`, 4 puertos, IndexedDB)
- `BACKEND-TRIGGER.md` (cuándo se codea)
- `src/lib/factory/domain/infra.derive.ts` (`CREDENTIAL_BOUNDARIES`, `TEAM_CHOICES`, `DEPLOYMENT_PATTERNS`)
- `src/lib/factory/domain/factoryApi.types.ts` (`TICKET_REF_PATTERN`), `src/lib/factory/mcp/mcp.stub.ts` (`MCP_TOOL_NAMES`, `MCP_ENDPOINT`)
