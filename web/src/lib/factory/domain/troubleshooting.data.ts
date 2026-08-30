// SRP: static troubleshooting content — pure data, no I/O, no store, no side effects
// Fuente: WarpFactories.md §18 Troubleshooting (Last updated Aug 27, 2026) + WarpFactories-UserStories.md E17 US-145→US-148
// DIP: datos puros; UI depende de abstracción (props), no de store.

export interface SetupRow {
  symptom: string;
  cause: string;
  fix: string;
}

export interface WorkSourceRow {
  source: string;
  causes: string;
}

export interface RunsRow {
  symptom: string;
  fix: string;
}

export const SETUP_ROWS: readonly SetupRow[] = [
  {
    symptom: "Don't have access",
    cause: "Early Access por team",
    fix: "Request access; admin confirme team membership",
  },
  {
    symptom: "Repo no aparece en picker",
    cause: "Code host connection no cubre repo",
    fix: "Confirmar org/group + app coverage; owner/GitLab group owner/Warp admin extienda",
  },
  {
    symptom: "Setup stops at agent limit",
    cause: "Plan limits",
    fix: "Admin confirme capacity; contactar sales",
  },
  {
    symptom: "Web app sigue mostrando setup wizard después de que agent creó factory vía MCP",
    cause: "Browser page abierta no se actualiza",
    fix: "Refresh; link que compartió el agent abre la misma factory",
  },
] as const;

export const WORK_NOT_STARTING_LEAD =
  "Casi siempre es automation mismatch, no conexión rota. Confirmar: enabled + event type matchea, check every filter AND (single mismatch frena), confirm source conectado a esta factory (conectar al workspace no adjunta a todas).";

export const WORK_SOURCES: readonly WorkSourceRow[] = [
  {
    source: "Slack",
    causes: "App isn't in channel, pending admin approval, account no linkeada a Warp team member",
  },
  {
    source: "GitHub",
    causes:
      "App no cubre repo o repo no pertenece a factory, routing label factory:<alias> missing, event type no incluido, single filter mismatch (Authors, Labels, etc.)",
  },
  {
    source: "GitLab",
    causes:
      "Mention es edit no new comment, username inexacto, project no seleccionado, automation disabled; si nada dispara y conectado → plan sin group webhooks (upgrade Premium/Ultimate)",
  },
  {
    source: "Linear",
    causes:
      "Agent session requiere linked Warp account, teams/filters mismatch, agent_session_created routing solo editable en files",
  },
  {
    source: "Jira",
    causes:
      "Warp app no conectada, no run porque agent_session_created disabled o sin agent available o filters project/keywords mismatch",
  },
] as const;

export const TWO_RUNS_WARNING =
  "Un action que dispara dos runs → dos automations matchean mismo event (común app_mention + message_posted mismo channel) → angostar/remover overlapping (how matching works).";

export const RUNS_ROWS: readonly RunsRow[] = [
  {
    symptom: "Need to stop run",
    fix: "Activity → select work item → Stop task (inmediato, sin confirmación)",
  },
  {
    symptom: "Work item looks stuck",
    fix: "A menudo esperando a persona, no fallando: default pausa para spec approval / clarifying questions / PR. Fix: Activity → event history ver último agent, View agent donde la pregunta es visible/respondible, steer si activo vía cloud agent session sharing",
  },
  {
    symptom: "No pull request",
    fix: "Confirmar Implement agent enabled, code host write access, work item llegó a Building stage; branch protection aplica",
  },
] as const;

export const TROUBLESHOOTING_META = {
  title: "Help / Troubleshooting",
  subtitle: "WarpFactories.md §18 Troubleshooting — Last updated Aug 27, 2026",
  sourceNote: "Fuente: factories/troubleshooting",
} as const;
