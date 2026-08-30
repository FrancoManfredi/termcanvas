# Backend Trigger — cuándo codear backend real (P2-04)

> **Fecha trigger:** **2026-11-01**  
> **Estado actual:** LOCAL-only por diseño (spike de puertos sin backend — ADR-001)  
> **Fuente:** `PLAN-OLAS-WARP-FACTORIES.md` §9 Trigger para backend real · PRD §6.2

No se escribe ni una línea de backend hasta que se cumplan **las dos puertas P0 y al menos una señal de negocio**. Este doc define esas puertas, esas señales y qué hacer si Warp abre Early Access.

## Puertas técnicas — deben estar verdes antes de siquiera evaluar backend

| Puerta | Criterio | Verifica | Owner |
|--------|----------|----------|-------|
| **G-T1** | `tsc -b 0` + `pnpm check` verde en `main` | `pnpm --filter web check` (`tsc --noEmit && tsc -b && vitest --pool=threads && vite build && oxlint`) | Eng |
| **G-T2** | `docs/RECEIPT.md` con commit + salida pegable, 0 docs con "build verde" sin comando | `grep -r "build verde" web/docs web/*.md` sin match sin comando | Eng |
| **G-T3** | `docs/ADR-001-ports-backend.md` + `ports/*.ts` tipos + `featureFlags.ts` merged | `pnpm --filter web exec tsc -b` con ports | Architect |
| **G-T4** | Demo 5 min ejecutable por tercero (`docs/DEMO-5MIN.md`) | Checklist manual: `pnpm i && pnpm --filter web dev` → factory → routing dual-label → Factory API → Quickstart en 5 min sin `warp_local_api_key` | PM + Eng |

Si alguna G-T está roja, **no se evalúa backend** — se cierra hardening primero.

## Señales de negocio — al menos una debe darse

| Señal | Qué significa | Acción si se da | Si no se da |
|-------|---------------|-----------------|-------------|
| **S-N1** | Warp **sigue en Early Access cerrado** al **2026-11-01** (sin apertura pública, docs siguen en `v1alpha1`, sin `v1` estable) | Spike backend 2 semanas: implementar `FetchTransport` + `RemoteFactoryRepo` contra credenciales B1–B3 disponibles. Scope mínimo: Factory API live + GitHub routing live (no MCP live aún). | Si Warp abrió antes del 2026-11-01, **congelar réplica** como `TermCanvas — Warp Factories Simulator (LOCAL)` (ver § "Si Warp abre"). |
| **S-N2** | Hay **pedido explícito con credenciales B1–B3 disponibles** (GitHub App + Slack + Linear/Jira) y 2+ repos con demanda | Implementar backend con scope mínimo contra esas credenciales. Si solo B1 (GitHub App) → solo `Factory API live` + `routing`. Si B1+B2+B3 → sumar MCP live. | Sin credenciales (B1–B3 no disponibles), no hay backend que codear — LOCAL es el producto. |
| **S-N3** | Warp actualiza docs a **`v1` estable** con breaking changes (`v1alpha1` → `v1`) | Mantener `v1alpha1` congelado, documentar diff en `docs/WARP-V1-DIFF.md`, decidir si se migra. No migrar sin señal Warp. | Si no hay `v1`, no migrar. |

**Fecha trigger:** **2026-11-01** — si al 2026-11-01 Warp sigue cerrado **y** hay demanda (S-N2), se abre spike backend. Si Warp abrió antes, se congela aunque no haya llegado la fecha. La fecha es arbitraria pero útil: evita scope creep R7 y da 2 meses desde 2026-08-30 para hardening LOCAL.

## Bloqueantes B1–B8 — disponibilidad

Ver `docs/ENV-MAP.md`. Resumen: LOCAL no necesita B1–B8; REMOTE sí.

- **B1** GitHub App (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`) — Factory API repos
- **B2** Slack OAuth (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`) — MCP
- **B3** Linear/Jira (`LINEAR_OAUTH_TOKEN`, `JIRA_ROVO_API_KEY`, `JIRA_PROJECT_KEYS`) — Factory API
- **B4** GitLab (`GITLAB_MANAGER_TOKEN`, `GITLAB_BOT_NAME`, `GITLAB_GROUP_ID`) — Factory API
- **B5** Factory MCP live (`WARP_API_KEY` Bearer) — MCP
- **B6** Factory API live (`WARP_API_KEY`) — Factory API
- **B7** Harness credentials (`ANTHROPIC_API_KEY`, `CODEX_API_KEY`, `GEMINI_API_KEY`) — inference (nunca en sandbox)
- **B8** Self-hosted runner (`SELF_HOSTED_WORKER_ID`, `OTEL_ENDPOINT`) — WorkItem execution

Sin B1–B3 no hay "backend con valor" que codear (Factory API y routing son el slice mínimo).

## Árbol de decisión

```
¿G-T1..G-T4 verdes?
├─ No  → cerrar hardening (Olas 5–7) primero, no evaluar backend
└─ Sí  → ¿Warp abrió Early Access público antes de 2026-11-01?
         ├─ Sí → CONGELAR como simulador LOCAL (ver abajo) — no invertir en backend
         └─ No  → ¿S-N2 con B1–B3 disponibles al 2026-11-01?
                  ├─ Sí → Spike 2 semanas: FetchTransport + RemoteFactoryRepo (Factory API live + GitHub routing live)
                  └─ No → Seguir LOCAL, re-evaluar en 2026-12-01 o ante S-N3
```

## Qué hacer si Warp abre Early Access público (escenario de alto arrepentimiento)

| Acción | Por qué |
|--------|---------|
| **Congelar** réplica en `v1alpha1` y publicarla como **`TermCanvas — Warp Factories Simulator (LOCAL)`** — "simulador sin credits para training/onboarding, offline demo, y contraste qué aprendimos replicando" | Warp real requiere team + credits ($10k qualifying); el simulador no. No compite como reemplazo, compite como onboarding. |
| **No invertir** en backend — Warp abierto hace que backend propio sea obsoleto (reimplementar lo que Warp ya da). | Evita coste hundido. |
| **Documentar** `docs/WARP-OPEN-NOTE.md` con qué se aprendió y qué diff hay con Warp real. | Capitaliza la inversión LOCAL. |
| **Mantener** `ADR-001` y ports — sirven como documentación de diseño aunque no se use REMOTE. | Valor didáctico. |

## Checklist de evaluación (para 2026-11-01)

- [ ] `pnpm --filter web check` verde en `main` (G-T1)
- [ ] `docs/RECEIPT.md` con commit + salida pegable (G-T2)
- [ ] `ADR-001` + `ports/*.ts` + `featureFlags.ts` merged y `tsc -b 0` (G-T3)
- [ ] `docs/DEMO-5MIN.md` ejecutado por tercero sin preguntar (G-T4)
- [ ] Warp Early Access: ¿abierto o cerrado? (S-N1) — fecha consulta: 2026-11-01
- [ ] Credenciales B1–B3: ¿disponibles y con repos con demanda? (S-N2)
- [ ] Versión Warp docs: ¿`v1alpha1` o `v1`? (S-N3)

Si G-T verdes + (S-N1 cerrado o S-N2 con credenciales) → abrir spike. Si Warp abierto → congelar.

## Qué NO se hace antes del trigger

- No DB, no auth server, no deploy, no secrets server, no OTel real, no metering real.
- No `FetchTransport` ni `Remote*Repo` (requieren `fetch` real + env + deploy).
- No `IndexedDB` (re-evaluar solo si > 500 factories).

Ver `docs/ADR-001-ports-backend.md` y `docs/ENV-MAP.md` para diseño listo para swap.
