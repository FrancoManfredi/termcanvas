// Contratos de la pantalla de Planificación.
// Estos tipos son el esquema que la sesión de opencode debe escribir
// en <repo>/.agents/planning/plan-<timestamp>.json. La UI los consumió
// directamente para renderizar la lista de resultados.

export type PlannerMode = "roadmap" | "audit";

export type IssueSeverity = "critical" | "high" | "medium" | "low";

// Campos del formulario de bug report (ver bug_report.yml de gentle-ai)
// que la sesión de opencode completa en cada issue del plan; la app los
// compone después en el body exacto del template.
export interface IssueTemplateFields {
  stepsToReproduce?: string[];
  expectedBehavior?: string;
  actualBehavior?: string;
  version?: string;
  os?: string;
  agent?: string;
  area?: string;
  logs?: string;
  additionalContext?: string;
}

export interface RoadmapProposal {
  title: string;
  body: string;
  labels: string[];
  status: string;
  priority: string;
  size: string;
  estimate?: number;
  parent?: number;
  blockedBy: number[];
  blocking: number[];
  related?: number[];
  // Mismo problema ya planteado por otra propuesta del plan (índice
  // 0-based del item canónico, el que aparece PRIMERO en el array):
  // mejor redacción, mismo bug. El usuario decide en la UI si lo crea
  // igual o lo descarta.
  duplicateOf?: number;
  // El problema ya está cubierto por un issue ABIERTO del repo: el
  // agente lo marcó mirando <owner/repo>/issues. Crearlo volvería a
  // duplicar trabajo ya pedido. Número real de GitHub, no índice.
  existingIssueNumber?: number;
  template?: IssueTemplateFields;
}

export interface RoadmapPlan {
  mode: "roadmap";
  repo: string;
  proposals: RoadmapProposal[];
}

export interface AuditFinding {
  title: string;
  severity: IssueSeverity;
  file: string;
  line: number;
  description: string;
  // Labels temáticas (bug, security, docs, perf…). El agente las escribe
  // si quiere; si no, la app las deriva por severidad/area/archivo al
  // parsear (ver deriveAuditLabels.ts). Opcional: los planes viejos no la
  // traen y los datos salen igual.
  labels?: string[];
  // Ver RoadmapProposal: mismo problema ya propuesto en el plan.
  duplicateOf?: number;
  // Ver RoadmapProposal: problema ya cubierto por un issue abierto.
  existingIssueNumber?: number;
  template?: IssueTemplateFields;
}

export interface AuditPlan {
  mode: "audit";
  repo: string;
  findings: AuditFinding[];
}

export type PlanningResult = RoadmapPlan | AuditPlan;

export function isRoadmapPlan(result: PlanningResult): result is RoadmapPlan {
  return result.mode === "roadmap";
}

export function isAuditPlan(result: PlanningResult): result is AuditPlan {
  return result.mode === "audit";
}