# Agregar un agente nuevo

Un agente nuevo es UN archivo: `factory/agents/<nombre>/agent.md`. Ese archivo
es la única fuente de verdad: los agentes viajan **INLINE** en el config del
server efímero de TermCanvas (`Config.agent`), así que el opencode del usuario
nunca los ve y **no se escriben espejos en disco**.

## 1. Crear `factory/agents/<nombre>/agent.md`

```md
---
description: Qué hace y cuándo se usa (requerido por opencode).
agentType: VERIFY
mode: primary
model: opencode-go/muse-spark-1.3-contributor
tools: {read,glob,grep}
skills: {code-review}
mcps: {github}
---

Reglas del rol en prosa breve, y cierre con UN bloque ```json con las keys
exactas de su schema (contrato en docs/agent-prompt-contract.md).
```

- `agentType`: vocabulario cerrado (`FOREMAN|TRIAGE|SPEC|IMPLEMENT|REVIEW|VERIFY`,
  fuente: `shared/roles.ts`). Exactamente un `FOREMAN` en el conjunto.
- `mode`: `primary` (default; los agentes de factory son primarios y se pueden
  elegir en las sesiones del server de TermCanvas), `subagent` o `all`.
- `model`: `provider/model`. Un nombre sin barra (ej. `auto-disjoint`) es interno
  del factory: el config inline lo omite y opencode usa su default.
- `tools`: subset de `{read,edit,bash,glob,grep,list,webfetch,websearch,todowrite,lsp}`.
  `{}` = solo enruta. `write` (legacy) sigue aceptado y se pliega en `edit`
  porque opencode fusiona write/edit/apply_patch; la UI ya no lo ofrece. Solo
  `implement` lleva escritura (compuerta en `headless-runtime/runner/toolPolicy.ts`).
  `task`/`skill`/`question` ni entran: los agentes factory no delegan, `skill`
  se otorga con la allowlist y `question` no tiene quién responda en un job.
- `icon`: clave opcional del set curado de la UI (p. ej. `icon: shield`).
  Metadata visual del editor; el runtime la ignora.
- `skills`: allowlist de `factory/skills/<name>/SKILL.md`. Deny-all primero;
  el agente solo puede cargar las listadas.
- `mcps`: allowlist de bundles `factory/mcps/<name>.json` (ver
  `factory/mcps/README.md`). Al correr un nodo del engine con este agente, el
  server scopeado recibe los servers MCP de esos bundles (live: se leen en cada
  spawn, no hace falta reciclar nada).
- Sin `maxRetries` (los reintentos los decide el transporte).

La sección Agents del WarpPanel edita todo esto contra el daemon
(`GET/PUT/POST/DELETE /factory/agents`, `GET /factory/skills` y CRUD
`/factory/mcps`); cada save marca `agentDirty` y se aplica al próximo job.

## 2. Validar (sin escribir nada)

```
pnpm validate:agents
```

No hay espejos que sincronizar ni commits de espejos. El daemon arma
`buildFactoryAgentsConfig()` al spawnear el server efímero y lo reconstruye al
reciclarlo (`agentDirty`) tras un alta/edición/baja desde la UI: un edit de
`agent.md` impacta en el próximo reciclado, sin reiniciar opencode.

## 3. Cablear el rol

- El body del `agent.md` es el system prompt real (viaja inline como
  `prompt` del agente). El mensaje del nodo solo lleva tarea + datos.
- Identidad por sesión: `sessionAgentArgs("<nombre>")` devuelve
  `{ agent: "<nombre>" }` si `factory/agents/<nombre>/agent.md` existe (el
  server efímero lo conoce inline); sin definición no se manda nada.
- Continuidad: `promptInAgentSession({ ..., expectAgent: "<nombre>", getAgent })`
  verifica la sesión guardada con UNA lectura y la renueva por el canal normal
  ante mismatch explícito.
- El validador (`factory validate`) descubre el dir solo: sin registro extra.
- Tests: frontmatter válido + config inline (ver `tests/opencode-agent-sync.test.ts`).
