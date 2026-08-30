---
title: "WARP-OPEN-NOTE — Placeholder si Warp abre Early Access"
status: "placeholder"
date: "2026-08-30"
related: ["docs/BACKEND-TRIGGER.md:47", "WarpFactories.md §1", "docs/DEMO-5MIN.md"]
lang: "es"
---

# WARP-OPEN-NOTE — Qué hacer si Warp abre Early Access

> **Estado:** placeholder — no hay acción hasta que Warp abra Early Access público.
> **Fuente de verdad:** `WarpFactories.md §1` (Early Access por team, $10k qualifying, launch 2026-08-18).

Si Warp abre Early Access público, **congelar esta réplica como Simulator LOCAL** y **no invertir en backend**. Ver árbol de decisión en `docs/BACKEND-TRIGGER.md:47` — rama `¿Warp abrió? → Sí → CONGELAR como simulador`.

**Por qué congelar:** Warp real ya resuelve control plane + execution + billing con credits; un backend propio quedaría obsoleto (alto arrepentimiento). El valor del simulador pasa a **onboarding sin credits**: training, demo offline y contraste "qué aprendimos replicando" (ver `docs/BACKEND-TRIGGER.md` § "Si Warp abre").

**Valor sin credits:** cualquier persona puede clonar y recorrer el flujo completo sin `warp_local_api_key` ni OAuth siguiendo `docs/DEMO-5MIN.md` (5 min: factory → routing dual-label → Factory API → Quickstart → Activity). Ese guion es el activo que se preserva.

**Acción al abrir:** publicar como `TermCanvas — Warp Factories Simulator (LOCAL)` en `v1alpha1` congelado, documentar aprendizajes aquí y mantener `docs/ADR-001-ports-backend.md` como referencia de diseño aunque no se use `remote`.

**No hacer:** no migrar a `v1`, no codear `FetchTransport`/`Remote*Repo`, no añadir credenciales B1–B8. Si hay diff de schema, registrarlo en `docs/WARP-V1-DIFF.md`.
