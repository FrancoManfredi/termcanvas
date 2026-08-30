// infra.derive — pure, no I/O, SRP each derive
// DIP: pages read from here, not hardcode — OCP: add pattern without touching other code
// Source: WarpFactories.md §8 Runners + §13 Infra & Seguridad + §14 Deployment patterns
//         WarpFactories-UserStories.md E15 US-131→139, E07 US-059→066

import { HOSTED_MAX_VCPUS, HOSTED_MAX_MEMORY_GB, ENVIRONMENT_VS_RUNNER_VS_HOST } from "./runner.derive";

export const HOSTED_MAX = { vcpus: HOSTED_MAX_VCPUS, memoryGb: HOSTED_MAX_MEMORY_GB } as const;

// §14 — 3 deployment patterns (platform/deployment-patterns)
export const DEPLOYMENT_PATTERNS = [
  {
    id: "cli-only",
    pattern: "1 — CLI-only",
    trigger: "CLI / script / oz agent run",
    orchestration: "Bring your own (CI, K8s, dev)",
    execution: "Anywhere (local/CI/K8s)",
    visibility: "Transcript local",
    note: "Bring-your-own-orchestrator — unmanaged oz agent run cannot be factory execution host but can exchange via Factory MCP",
  },
  {
    id: "warp-hosted",
    pattern: "2 — Warp-hosted",
    trigger: "GitHub/Slack/Linear/Jira/MCP/API/schedule",
    orchestration: "Warp control plane",
    execution: "Warp-hosted sandbox",
    visibility: "Dashboard + session",
    note: "Control plane = Warp coordination",
  },
  {
    id: "self-hosted",
    pattern: "3 — Self-hosted",
    trigger: "Igual que 2",
    orchestration: "Warp control plane",
    execution: "Managed self-hosted worker (Docker/K8s/Direct)",
    visibility: "Dashboard + session",
    note: "Worker outbound to Warp; no inbound firewall port",
  },
] as const;

export type DeploymentPattern = (typeof DEPLOYMENT_PATTERNS)[number];

// §8 / §14 — control vs execution plane
export const CONTROL_VS_EXECUTION = [
  {
    plane: "Control plane",
    responsibilities: "Warp: coordina runs, identity/config, observabilidad, integrations, storage, inference routing",
  },
  {
    plane: "Execution plane",
    responsibilities: "Warp-hosted sandbox o managed self-hosted worker: checkout, setup, tools, build, commands",
  },
] as const;

// §13 — Runners deep dive: backends + OTel
export const RUNNER_BACKENDS = ["Docker", "Kubernetes", "Direct"] as const;
export type RunnerBackend = (typeof RUNNER_BACKENDS)[number];

export const OTEL_METRICS = ["worker health", "task throughput", "capacity saturation"] as const;
export type OtelMetric = (typeof OTEL_METRICS)[number];

export const CONCURRENCY_NOTE =
  "Concurrencia Warp-hosted limitada por team → exceso queueado. Self-hosted depende de tu capacidad.";

export const EXECUTION_HOST_COMPARISON = [
  {
    area: "Compute",
    warpHosted: "Warp lo provisiona",
    selfHosted: "Vos lo provisionás",
  },
  {
    area: "Checkout y commands",
    warpHosted: "Corren en Warp-managed compute",
    selfHosted: "Corren en tu infra",
  },
  {
    area: "Control plane",
    warpHosted: "Vía Warp",
    selfHosted: "Vía Warp",
  },
  {
    area: "Network",
    warpHosted: "Warp maneja sandbox connectivity",
    selfHosted: "Worker se conecta outbound a Warp; sin inbound firewall port",
  },
  {
    area: "Private services",
    warpHosted: "Deben ser alcanzables desde hosted sandbox",
    selfHosted: "Alcanzables vía network access del worker",
  },
  {
    area: "Operations",
    warpHosted: "Warp maneja capacity/lifecycle, concurrencia queue",
    selfHosted: "Vos manejás capacity, isolation, updates, availability",
  },
] as const;

// §13 — 3 choices independientes (execution/inference/storage) — todas Enterprise only
export const TEAM_CHOICES = [
  {
    choice: "Execution",
    options: "Warp-hosted / managed self-hosted",
    whatChanges: "Dónde corren checkout, commands y sandbox filesystem",
    whatStaysWithWarp: "Coordinación, configuración, observabilidad, inference routing",
    enterpriseOnly: true,
  },
  {
    choice: "Inference",
    options: "Warp-managed / customer-supplied",
    whatChanges: "Provider account, model routing, billing, provider-side retention",
    whatStaysWithWarp: "Run coordination e inference routing",
    enterpriseOnly: true,
    note: "Customer-supplied limitado a providers que soportan cloud agents (bring-your-own-llm); retention sigue tu contrato; ZDR solo si provider lo soporta",
  },
  {
    choice: "Storage",
    options: "Warp / customer-owned",
    whatChanges: "Dónde persisten supported transcripts, artifacts y run attachments",
    whatStaysWithWarp: "Orchestration, write path y otro factory/control-plane state",
    enterpriseOnly: true,
    note: "Customer-owned via S3/GCS bucket; config/run metadata permanece con Warp",
  },
] as const;

export type TeamChoice = (typeof TEAM_CHOICES)[number];

// §13 — Credential boundaries: 4 types
export const CREDENTIAL_BOUNDARIES = [
  {
    credential: "Inference credentials",
    para: "Model provider requests",
    boundary: "Solo en el inference boundary; nunca inyectadas en el sandbox",
  },
  {
    credential: "Execution secrets",
    para: "APIs, package registries, tools que usa el agent",
    boundary:
      "Delivered desde un explicit per-agent allowlist; agents que no actúan como specific user no reciben managed secrets por default. Declarados en secrets (factory-wide) y per-agent secrets (reemplazo). Warp redacta known secret values en output boundaries (backstop, no sustituto de narrow external permissions y rotación).",
  },
  {
    credential: "Harness authentication",
    para: "Solo oz (Warp Agent) - sin harness externo",
    boundary:
      "En este workspace solo oz: harness.auth y reasoningLevel no aplican. oz no requiere credenciales externas; ver WarpFactories.md seccion 4 (harness oz).",
  },
  {
    credential: "Repository identity",
    para: "Checkout y push",
    boundary:
      "Runs actúan con la authorization del creating user (changes atribuidos a ellos) o como el agent itself para unattended work; set por credentialStrategy (EXECUTOR default vs CREATOR).",
  },
] as const;

export type CredentialBoundary = (typeof CREDENTIAL_BOUNDARIES)[number];

// §13 ZDR
export const ZDR_NOTE =
  "Self-hosting mueve solo el execution plane: checkouts, command execution y sandbox filesystem quedan en tu infra, pero prompts/results/transcripts/artifacts/telemetry siguen fluyendo por Warp y los providers bajo Zero Data Retention (ZDR) — self-hosted no es fully offline. Session transcripts via Warp backend también bajo ZDR. Code context en LLM prompts siempre fluye a Warp/providers bajo ZDR cuando el provider lo soporta.";

export const ZDR_KEYWORDS = ["Zero Data Retention", "ZDR", "self-hosted no es fully offline", "Session transcripts"] as const;

// §13 Governance
export const GOVERNANCE_NOTE =
  "Factories usan existing team roles (Team Owners/Admins controlan factory definitions, runners, secrets, provider config). Warp Factories no agrega un factory-specific approval role → quién reviewea specs y quién approves merges queda como workflow + repository policy decision. Tratar factory-definition changes como ops code: reviewear como cualquier change.";

// §13 Metering
export const METERING_NOTE =
  "Warp metea hosted compute, Warp-provided inference y platform services (credits). Managed self-hosted mueve compute costs a tu infra; customer-supplied inference billa model usage vía tu provider account. Platform services consumen credits independientemente de esas choices. Ver support-and-community/plans-and-billing/platform-credits.";

export const METERING_KEYWORDS = ["credits", "hosted compute", "Platform services"] as const;

// §13 Deployment checklist — 7 steps
export const DEPLOYMENT_CHECKLIST = [
  {
    step: 1,
    title: "Classify workload",
    detail: "Identificar repos, data, servicios internos y regulated systems que la factory puede alcanzar.",
  },
  {
    step: 2,
    title: "Choose execution",
    detail: "Decidir dónde deben correr checkout/commands/sandbox filesystem (Warp-hosted vs managed self-hosted).",
  },
  {
    step: 3,
    title: "Configure factory y runners",
    detail: "Setear repos, setup commands y secrets en la definition; elegir OS/arch/image/compute de cada runner.",
  },
  {
    step: 4,
    title: "Choose inference y storage",
    detail: "Seleccionar provider routing y dónde persiste supported run data (Warp-managed vs BYO inference, Warp vs S3/GCS).",
  },
  {
    step: 5,
    title: "Scope credentials",
    detail: "Setear cada agent's secret allowlist, harness auth y repository identity (credentialStrategy).",
  },
  {
    step: 6,
    title: "Set review gates",
    detail: "Decidir dónde los humanos reviewean specs y PRs, y enforcear en workflow y repo policy.",
  },
  {
    step: 7,
    title: "Validate operations",
    detail: "Testear network egress, isolation, rotación, redaction, capacity, observabilidad y metering antes de escalar volumen.",
  },
] as const;

export type DeploymentChecklistStep = (typeof DEPLOYMENT_CHECKLIST)[number];

// Re-export for pages that want it together
export { ENVIRONMENT_VS_RUNNER_VS_HOST };

// Helpers for tests / OCP: add pattern without touching others
export function getDeploymentPatternById(id: string): DeploymentPattern | undefined {
  return DEPLOYMENT_PATTERNS.find((p) => p.id === id);
}

export function getTeamChoice(name: string): TeamChoice | undefined {
  return TEAM_CHOICES.find((c) => c.choice.toLowerCase() === name.toLowerCase());
}

export function getCredentialBoundary(name: string): CredentialBoundary | undefined {
  return CREDENTIAL_BOUNDARIES.find((b) => b.credential.toLowerCase().includes(name.toLowerCase()));
}
