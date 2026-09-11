# Agregar un agente nuevo

Un agente nuevo es UN archivo: `factory/agents/<nombre>/agent.md`. Ese archivo
es la única fuente de verdad y también es un agente opencode real (vía espejo
generado, ver abajo).

## 1. Crear `factory/agents/<nombre>/agent.md`

```md
---
description: Qué hace y cuándo se usa (requerido por opencode).
agentType: VERIFY
mode: subagent
model: opencode-go/muse-spark-1.2-contributor
tools: {read,glob,grep}
---

Reglas del rol en prosa breve, y cierre con UN bloque ```json con las keys
exactas de su schema (contrato en docs/agent-prompt-contract.md).
```

- `agentType`: vocabulario cerrado (`FOREMAN|TRIAGE|SPEC|IMPLEMENT|REVIEW|VERIFY`,
  fuente: `shared/roles.ts`). Exactamente un `FOREMAN` en el conjunto.
- `mode`: `subagent` (solo invocación por orquestador/`@mención`) o `all` (además en el picker de primarios, para hablarle directo sin intermediarios; el headless no lo lee).
- `model`: `provider/model`. Un nombre sin barra (ej. `auto-disjoint`) es interno
  del factory: el espejo lo omite y opencode usa su default.
- `tools`: subset de `{read,write,edit,bash,glob,grep}`. `{}` = solo enruta.
  Solo `implement` lleva escritura (compuerta en `headless-runtime/runner/toolPolicy.ts`).
- Sin `maxRetries` (los reintentos los decide el transporte).

## 2. Generar el espejo opencode

```
pnpm sync:agents            # espejos del proyecto (.opencode/agents|skills/)
pnpm sync:agents:global     # espejos globales (~/.config/opencode/)
pnpm sync:agents:check      # verifica sync sin escribir (para CI)
```

Los espejos del proyecto se COMMITTEAN (viajan con el repo; el `.gitignore`
solo deja fuera planes e imágenes). El espejo global vale para TODOS los
proyectos/sesiones; el del proyecto solo para ese repo (y pisa al global).
Tras sincronizar, commiteá los espejos y corré el check. Desde entonces el
agente existe en opencode vía picker (con `mode: all`), `@<nombre>` y Task
tool; el headless crea su sesión con esa identidad cuando el espejo está en
disco (con fallback a sesión plana si el server lo rechaza). Tras sincronizar,
reiniciar el server opencode (los agentes se cargan al inicio).

Mapeo `tools` → `permission` (default-deny primero, en opencode gana la última
regla): `write` se pliega en `edit`.

## 3. Cablear el rol

- Builder del prompt en `headless-runtime/<nombre>/` (inyecta el body vía
  `loadAgentDef`, mantiene camino bakeado si el md falta).
- Turno por `session.prompt` con `tools: toolsetFor("<nombre>")` (nunca
  `tools:{}` literal: no niega nada).
- Identidad en DOS niveles (el create solo etiqueta; el turno lo decide el prompt):
  `session.create({ ..., ...sessionAgentArgs("<nombre>") })` y
  `body = { ..., ...sessionAgentArgs("<nombre>"), parts }`. Sin espejo no se
  manda nada en ningún nivel.
- Continuidad: `promptInAgentSession({ ..., expectAgent: "<nombre>", getAgent })`
  verifica la sesión guardada con UNA lectura y la renueva por el canal normal
  ante mismatch explícito (las etiquetas viejas convergen en un turno).
- El validador (`factory validate`) descubre el dir solo: sin registro extra.
- Tests: frontmatter válido + espejo (ver `tests/opencode-agent-sync.test.ts`).
