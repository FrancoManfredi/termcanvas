---
name: termcanvas-workflows
description: Descubrir y ejecutar workflows declarativos del engine de TermCanvas (runs, gates, DAG) desde la terminal. Usar cuando pidan un pipeline de agentes por fases (plan -> implement -> review), correr un workflow existente o resolver un gate.
---

# TermCanvas Workflows

El engine declarativo ejecuta pipelines de agentes definidos en YAML, con runs
en background, gates humanos, loops y fan-out. Toda la interacción es por CLI
contra el daemon local.

**Pipeline oficial**: la factory corre `factory-default`
(`triage → spec → aprobación → implement → verify → review`) como workflow.
Todo job del panel (Resolve Issue, automations) se ejecuta con ese workflow y
se espeja en el panel. `TERMCANVAS_FACTORY_ENGINE=legacy` vuelve al pipeline
viejo.

## Cuándo usarla

- El usuario pide "workflow", "pipeline", "plan -> implement -> review", o
  correr fases con varios agentes.
- Hay que resolver un gate humano de un run pausado.
- Hay que inspeccionar el estado de un run.

## Cómo usarla

1. Descubrir workflows disponibles:

   ```
   termcanvas workflow list
   ```

2. Lanzar un run (args libres + inputs declarados):

   ```
   termcanvas workflow run <name> --args "texto" --input clave=valor
   ```

3. Seguir el run:

   ```
   termcanvas workflow watch <runId>
   ```

   `watch` sale con código 3 cuando el run queda esperando un gate humano,
   ‎1 si falló y 0 si completó.

4. Resolver un gate:

   ```
   termcanvas workflow approve <runId> --text "comentario"
   termcanvas workflow reject <runId> --text "razón del rechazo"
   ```

5. Detalle y aborto:

   ```
   termcanvas workflow status <runId>
   termcanvas workflow cancel <runId>
   ```

## Dónde viven los workflows

- Proyecto: `.agents/workflows/<pack>/<workflow>/workflow.yaml`
- Global: `~/.termcanvas/workflows/`
- Bundled: `factory/workflows/` (defaults: `plan-approve-implement`,
  `parallel-reviews`, `review-lens`, `fix-issue`, `smoke`)

Precedencia: repo > global > bundled. Un workflow puede incluir comandos
Markdown (`commands/<name>.md`) y scripts propios.
