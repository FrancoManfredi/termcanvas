// Quickstart data — SRP: canonical copy and demo choices, no state or I/O.
// Source: WarpFactories.md §14 "Quickstart conceptual" · US-142, US-143, US-144
// ADR-003: DEMO_REPOS queda solo para tests legacy, Wizard usa repos reales

import type { RepositoryRef } from "./types";
import type { QuickstartStep } from "./quickstart.wizard";

/** The first work item is intentionally preserved verbatim from the product brief. */
export const VERBATIM_FIRST_WORK_ITEM =
  'Add a "Local development" section to README.md that summarizes the setup steps from CONTRIBUTING.md. ' +
  "Keep the change to that one file, run the repo's lint check, and open a pull request.";

/** MCP route copy: no credentials or tokens are fabricated by the client. */
export const MCP_ONBOARDING_PROMPT =
  "Set up a factory for me. Read https://docs.warp.dev/factories/factory-mcp.md, follow the setup instructions " +
  "for your coding environment to connect to and authenticate with Factory MCP, then use Factory MCP to onboard me.";

export const STEP_COPY: Readonly<Record<QuickstartStep, { title: string; hint: string; trace: string }>> = {
  source: {
    title: "Conectá tu proveedor",
    hint: "Elegí dónde viven tus repositorios para empezar con el contexto correcto.",
    trace: "§14 · US-142",
  },
  repos: {
    title: "Elegí tus repositorios",
    hint: "Seleccioná uno o dos repositorios enfocados para esta factory.",
    trace: "§14 · US-142",
  },
  identity: {
    title: "Dale una identidad",
    hint: "El alias de Foreman se deriva del nombre y podés editarlo cuando quieras.",
    trace: "§10 · US-001",
  },
  slack: {
    title: "Conectá Slack",
    hint: "En local lo salteamos por ahora.",
    trace: "§9 · US-067→072",
  },
  agents: {
    title: "Elegí tus agentes",
    hint: "Implement queda activo para que la primera tarea pueda avanzar.",
    trace: "§14 · US-142",
  },
  tracker: {
    title: "Elegí tu tracker",
    hint: "En local lo salteamos — Tracker y Factory MSP no disponibles.",
    trace: "§9 · US-086→096",
  },
  review: {
    title: "Revisá y empezá",
    hint: "Confirmá el resumen y creá tu factory para ir al Dashboard.",
    trace: "§14 · US-143",
  },
};

/** Four small demo repositories keep tests useful without external credentials — not used in prod wizard (P0-5 repos reales). */
export const DEMO_REPOS: readonly RepositoryRef[] = [
  { owner: "acme", name: "payments-service" },
  { owner: "acme", name: "payments-api" },
  { owner: "acme", name: "termcanvas-web" },
  { owner: "acme", name: "platform-infra" },
];

/** Factory MCP dashboard path shown alongside the copied prompt. */
export const FACTORY_MCP_DASHBOARD_URL = "https://app.factory.ai/dashboard";

/** Stable display label for repository chips and the live summary. */
export function repositoryLabel(repository: RepositoryRef): string {
  return `${repository.owner}/${repository.name}`;
}
