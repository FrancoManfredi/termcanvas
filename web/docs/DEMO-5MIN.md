# Demo 5 minutos — TermCanvas Warp Factories Simulator (LOCAL, sin credenciales)

> **Objetivo:** cualquier persona clona, instala y en 5 min recorre factory → routing → Factory API → Quickstart sin `warp_local_api_key` ni OAuth.
> **Gate canónico:** `pnpm --filter web check` verde (ver `docs/RECEIPT.md`). Este guion es ejecutable sin preguntar.

## Requisitos

- Node 20+ y pnpm 9+
- Sin credenciales (todo LOCAL)

## 0. Setup (30s)

```bash
git clone <repo> && cd web
pnpm i
pnpm --filter web dev   # http://localhost:5174
# Alternativa single-command:
pnpm --filter web check  # tsc --noEmit && tsc -b && vitest --pool=threads && vite build && oxlint
```

Abrí http://localhost:5174 — verás Sidebar con factories seed (`payments-factory`) y Dashboard.

## 1. Crear factory — 1 campo (30s)

1. Click **+ Add factory** (Sidebar › Factories) o **Quickstart** (team nav).
2. Escribí `search-factory` → alias se auto-copia a `search-factory`.
3. Click **Crear factory** — queda seleccionada, Dashboard muestra 0 runs.

> **A11y:** el input tiene foco automático, `Enter` crea, alias en disclosure. OCP: validación reuse `validateFactoryCreate`.

## 2. GitHub dual-label routing — simulador (60s)

Ruta: **Factory › GitHub routing** (Avanzado › GitHub routing si está colapsado, o Sidebar › GitHub routing).

1. Verificá **5 presets de 1 clic** (factory-aware, 1 válido + 4 negativos):
   - `Caso válido — Enruta` → “✓ Enruta” con 5 checks verdes (factory-aware: adapta `factory:<alias>` a la factory seleccionada — hotfix valid_routing)
   - `Mention sin label` → “No enruta” (falta label)
   - `Label sin mention` → “No enruta” (falta mention)
   - `Mention en code block` → “No enruta” (code block ignorado)
   - `Edit con mention` → “No enruta” (solo new content)
2. Con `Caso válido — Enruta` (o preset default `factory:<alias>` + `@warp-factory` + new content) → “✓ Enruta” con 5 checks verdes; probá cambiar Factory y ver que el preset válido sigue enrutando (label se adapta).
3. Copiá **`factory:<alias>`** con botón **Copiar label** (clipboard).
4. Verificá **`continuationKey`** visible (`acme/payments-service#42`) y copiable — dedupe estable.
5. Si `Enruta` → verás **matched automations** (si bundle tiene automations) y `reason` ES.

> Traza: cada check cita `WarpFactories.md §9` y muestra detail.

## 3. Factory API — dispatch sin credenciales (60s)

Ruta: **Factory › Factory API**.

1. Selector Factory → elegí `search-factory`.
2. Prompt: `Fix checkout race — add retry with backoff` (title se deriva).
3. Ticket ref opcional: `linear:PAY-123` (regex `^[a-z]+:[A-Za-z0-9-_]+$`).
4. Click **Crear run** → verás **Run creado** con `id`, `status: queued`, `work_item_id`, `stage: Triage`.
5. Verificá que el run aparece en **Activity** (Triage) y **Runs** (factory scope).
6. Revisá **Snippets**: `curl` y `OzAPI Python` copiables para el mismo request.

> Contrato drop-in: paths idénticos a Warp `§19` (`/api/v1/factory/:uid/runs`, `/agent/runs/:runId`).

## 4. Quickstart 7 pasos — límite 2 repos (60s)

Ruta: **Team › Quickstart** (o `+ Add factory → Usar wizard`).

1. **Source:** elegí GitHub.
2. **Repos:** seleccioná 2 (ej. `acme/payments-service` + `acme/payments-api`) → verás feedback **“2 máx — el 3º reemplaza al más viejo”**. El 3er chip muestra tooltip al hover y reemplaza al más viejo si lo clickeás (reducer puro).
3. **Identity:** nombre `demo-factory` (alias auto-copia, editable).
4. **Slack / Agents / Tracker:** dejar defaults (Implement ON, tracker none).
5. **Review:** click **Crear factory y enviar el primer work item** → verbatim `Add a "Local development" section to README.md...` se crea y navega a Activity.

> Valida: Activity muestra work item nuevo en Triage con `source: direct`.

## 5. Dashboard — 8 métricas con disclaimers (45s)

Ruta: **Factory › Dashboard**.

- Hover/focus en **ⓘ** de cada métrica para ver tooltip (no texto inline):
  - **Total runs** — breakdown por stage/source/status
  - **PRs opened** — contados una vez
  - **PRs merged** — puede ser > opened si datasource distinto (`merged>opened`)
  - **Autonomy %** — `Autonomy push`: human push antes de merge anula autonomía
  - **PR cycle time** — mediana run kickoff → merge, median por stage
  - **Cost per PR** — `Cost S/M/L/XL 100/500/1000` estimate, spliteado equitativo
  - **Scorer cards** — agents/model/sampling
  - **Self-improvement PRs** — 3 newest sin date filter
  - **Most expensive PRs** — requiere code host

> Diseño: `MetricCard` con info icon ⓘ tooltip on hover/focus, sin inline.

## 6. Troubleshooting linkeado — ? donde duele (30s)

Cada página con contexto tiene **?** que abre **Help › Troubleshooting** en anchor correcto:

- **Activity** → `Two runs warning` (`two-runs`)
- **Runs** → `Runs stuck` (`runs-stuck`)
- **Automations** → `Work isn't starting` (`work-not-starting`)
- **Factory API** → `Factory API` (`factory-api`)
- **GitHub routing** → `Work isn't starting`

Click **?** en Activity → navega a Troubleshooting y hace scroll suave al anchor (lazy-safe: `HelpLink` usa `onNavigate + location.hash + useEffect`).

Verificá que `docs` cita `TROUBLESHOOTING_ANCHORS: Record<TroubleshootingAnchor,string>` y que `TroubleshootingPage` tiene ids `setup`, `work-not-starting`, `two-runs`, `runs-stuck`, `no-pr`, `factory-api`.

## 7. A11y / i18n polish (extra, no bloquea demo)

- Sidebar activo: `aria-current="page"` y foco visible.
- Factory node expand: `aria-expanded`.
- HelpSection: `children?` opcional, `aria-labelledby`.
- Quickstart steps: `aria-current="step"` en paso activo, `aria-pressed` en chips.
- Botones y tooltips con `focus-visible:ring-2`.

## Comandos de verificación

```bash
pnpm --filter web exec tsc --noEmit   # 0
pnpm --filter web exec tsc -b          # 0
pnpm --filter web exec vitest run --pool=threads  # 902 verde (39 archivos)
pnpm --filter web build                # verde (2319 modules)
pnpm --filter web exec oxlint          # 0
pnpm --filter web check                # atajo gate canónico (commit·pnpm check·39/902)
```

## Qué NO hace la demo (fuera de scope LOCAL)

- No DB, no deploy, no OAuth real, no secrets server, no OTel real, no metering real.
- No live GitHub App / Slack / Linear / Jira (slices LOCAL con stub).
- No Playwright E2E (jsdom + vitest).

---

*Generado Ola 7 POLISH DEMO — P0-06 + P1-02→P1-05 + hotfix valid_routing 5 presets factory-aware. Frontier 3. OCP, 902 tests verdes (39 archivos), tsc -b 0, vite 2319 modules, pnpm check verde.*
