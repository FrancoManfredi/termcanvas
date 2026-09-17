/**
 * Derivación pura de Agent Progress + Agent Sessions desde el contrato del
 * engine (`engineRun` + `sessions` + gate). Una etapa por nodo EXACTO del
 * workflow elegido, más Foreman como etapa de ruteo:
 *
 * - Sin workflow elegido (job recién creado): SOLO Foreman (routing).
 * - Con `engineRun`: Foreman (done) + nodos del workflow con estado real
 *   (`nodeStates` / `completedNodes` / `currentNodeId`) y su sesión.
 * - Gate humano pendiente: el nodo del gate queda `waiting-gate`.
 *
 * Pura y tolerante: nunca lanza, nunca inventa nodos ni sesiones.
 */
import type { IssueFactoryJob } from "../types";

export type AgentStageState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "waiting-gate";

export interface AgentStage {
  /** id de la etapa: "foreman" o el id del nodo del workflow. */
  id: string;
  /** label visible en el stepper: "Foreman" o el nodeId crudo. */
  label: string;
  /**
   * `agent` = etapa que corre en una sesión OpenCode; `system` = etapa
   * system-owned sin agente (ej. verify-runner): no tiene sesión que abrir.
   * Heurística honesta: terminada + sin agente + sin sesión.
   */
  kind: "agent" | "system";
  /** Agente que ejecuta la etapa (`nodeAgents`), null si aún se desconoce. */
  agent: string | null;
  state: AgentStageState;
  /** URL de la sesión OpenCode (habilitada desde el envío del mensaje). */
  sessionUrl: string | null;
  /**
   * Rondas previas del nodo dentro de un loop, ordenadas R1 → Rn. Vacío =
   * ejecución única o job sin historial de rondas.
   */
  rounds: Array<{ round: number; sessionUrl: string }>;
  /**
   * Ronda de la sesión vigente (la que abre VIEW AGENT por defecto).
   * null cuando el daemon no la informó (jobs previos al historial).
   */
  currentRound: number | null;
}

export interface AgentSessionSummary {
  /** Etapas de agente con sesión disponible. */
  available: number;
  /** Total de etapas de agente (denominador del contador). */
  agentTotal: number;
  /** Etapas system-owned (sin sesión por diseño). */
  systemTotal: number;
}

/** Conteo honesto para el header de Agent Sessions (solo filas de agente). */
export function agentSessionSummary(stages: AgentStage[]): AgentSessionSummary {
  let available = 0;
  let agentTotal = 0;
  let systemTotal = 0;
  for (const stage of stages) {
    if (stage.kind === "system") {
      systemTotal += 1;
      continue;
    }
    agentTotal += 1;
    if (typeof stage.sessionUrl === "string" && stage.sessionUrl !== "") {
      available += 1;
    }
  }
  return { available, agentTotal, systemTotal };
}

/**
 * Separa etapas de agente (stepper principal) de las system-owned (indicador
 * compacto al costado): las sys no se intercalan en el progreso de agentes.
 */
export function splitStageKinds(stages: AgentStage[]): {
  agent: AgentStage[];
  system: AgentStage[];
} {
  const agent: AgentStage[] = [];
  const system: AgentStage[] = [];
  for (const stage of stages) {
    (stage.kind === "system" ? system : agent).push(stage);
  }
  return { agent, system };
}

/** Etapa terminada sin agente ni sesión = system-owned (verify-runner, …). */
function stageKind(
  state: AgentStageState,
  agent: string | null,
  sessionUrl: string | null,
): "agent" | "system" {
  const terminal = state === "completed" || state === "skipped";
  return terminal && agent === null && sessionUrl === null ? "system" : "agent";
}

export interface AgentTimelineModel {
  /** true = workflow aún no elegido (solo Foreman en pantalla). */
  routing: boolean;
  workflow: string | null;
  stages: AgentStage[];
}

function asStageState(value: unknown): AgentStageState | null {
  return value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "skipped" ||
    value === "cancelled"
    ? value
    : null;
}

/** Una sesión registrada para un rol: la vigente (sin round) + rondas previas. */
export interface AgentSessionRef {
  sessionUrl: string;
  round?: number;
}

/** Rango honesto de round reportado por el daemon. */
function asRound(value: unknown): number | undefined {
  try {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Resuelve la URL vigente y las rondas de un rol: la entrada sin round es
 * la sesión vigente (fallback: última registrada); las numeradas son
 * rondas previas ordenadas R1 → Rn.
 */
function resolveStageSessions(refs: AgentSessionRef[]): {
  sessionUrl: string | null;
  rounds: Array<{ round: number; sessionUrl: string }>;
  currentRound: number | null;
} {
  try {
    if (!Array.isArray(refs) || refs.length === 0) {
      return { sessionUrl: null, rounds: [], currentRound: null };
    }
    const unnumbered =
      refs.find((ref) => asRound(ref?.round) === undefined) ?? null;
    let main: AgentSessionRef | null = unnumbered;
    if (main === null) {
      // Todo numerado (la vigente también trae su ronda): manda la más alta.
      let best: AgentSessionRef | null = null;
      for (const ref of refs) {
        try {
          const round = asRound(ref?.round);
          if (round === undefined) continue;
          const bestRound = best !== null ? (asRound(best.round) ?? 0) : 0;
          if (best === null || round > bestRound) best = ref;
        } catch {
          // una entrada rota nunca aborta la resolución
        }
      }
      main = best ?? refs[refs.length - 1] ?? null;
    }
    const sessionUrl =
      main !== null &&
      typeof main.sessionUrl === "string" &&
      main.sessionUrl !== ""
        ? main.sessionUrl
        : null;
    const rounds: Array<{ round: number; sessionUrl: string }> = [];
    for (const ref of refs) {
      try {
        const round = asRound(ref?.round);
        const url =
          typeof ref?.sessionUrl === "string" ? ref.sessionUrl : "";
        if (round === undefined || url === "") continue;
        if (url === sessionUrl) continue;
        rounds.push({ round, sessionUrl: url });
      } catch {
        // una ronda rota nunca aborta a las demás
      }
    }
    rounds.sort((a, b) => a.round - b.round);
    const currentRound =
      main !== null ? (asRound(main.round) ?? null) : null;
    return { sessionUrl, rounds, currentRound };
  } catch {
    return { sessionUrl: null, rounds: [], currentRound: null };
  }
}

/** Label corto para ids namespaced de loop_group (`build.review` → `review`). */
function shortLabel(id: string): string {
  try {
    const leaf = id.includes(".") ? id.slice(id.lastIndexOf(".") + 1) : id;
    return leaf.length > 0 ? leaf : id;
  } catch {
    return id;
  }
}

export function buildAgentTimeline(
  factory: IssueFactoryJob | null | undefined,
): AgentTimelineModel {
  const sessions = new Map<string, AgentSessionRef[]>();
  try {
    for (const entry of factory?.sessions ?? []) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.role === "string" &&
        entry.role.trim() !== "" &&
        typeof entry.sessionUrl === "string" &&
        entry.sessionUrl.trim() !== ""
      ) {
        const role = entry.role.trim();
        const ref: AgentSessionRef = {
          sessionUrl: entry.sessionUrl.trim(),
        };
        const round = asRound(
          (entry as { round?: unknown } | null | undefined)?.round,
        );
        if (round !== undefined) ref.round = round;
        sessions.set(role, [...(sessions.get(role) ?? []), ref]);
      }
    }
  } catch {
    // honest-empty: sin sesiones legibles
  }

  const run = factory?.engineRun ?? null;
  const hasRun = !!run && typeof run.runId === "string" && run.runId !== "";
  const stage = typeof factory?.stage === "string" ? factory.stage : "";
  const terminal = factory?.terminal === true;
  const cancelled = stage === "Cancelled";
  const gateNodeId =
    typeof factory?.engineGateNodeId === "string" &&
    factory.engineGateNodeId !== ""
      ? factory.engineGateNodeId
      : null;

  const foremanRefs = sessions.get("foreman") ?? [];
  const foremanSessions = resolveStageSessions(foremanRefs);
  // Cancelado ANTES de rutear (sin run): el Foreman no completó → failed.
  // Con run iniciado el ruteo ya ocurrió (aunque el job muera después por un
  // nodo del workflow): Foreman completed, nunca failed.
  const foremanState: AgentStageState = cancelled
    ? hasRun
      ? "completed"
      : "failed"
    : hasRun || terminal
      ? "completed"
      : "running";
  const foreman: AgentStage = {
    id: "foreman",
    label: "Foreman",
    kind: "agent",
    agent: "foreman",
    state: foremanState,
    sessionUrl: foremanSessions.sessionUrl,
    rounds: foremanSessions.rounds,
    currentRound: foremanSessions.currentRound,
  };

  if (!hasRun || run === null) {
    // Ruteo (o job histórico sin run): solo Foreman + sesiones legacy
    // registradas, para no perder la historia de jobs viejos.
    const legacy: AgentStage[] = terminal
      ? [...sessions.keys()]
          .filter((role) => role !== "foreman" && !role.startsWith("hook:"))
          .slice(0, 12)
          .map((role) => {
            const resolved = resolveStageSessions(sessions.get(role) ?? []);
            return {
              id: role,
              label: role,
              kind: "agent" as const,
              agent: role,
              state: "completed" as AgentStageState,
              sessionUrl: resolved.sessionUrl,
              rounds: resolved.rounds,
              currentRound: resolved.currentRound,
            };
          })
      : [];
    return { routing: !terminal, workflow: null, stages: [foreman, ...legacy] };
  }

  const order =
    Array.isArray(run.nodes) && run.nodes.length > 0
      ? run.nodes
      : [
          ...Object.keys(run.nodeStates ?? {}),
          ...(run.completedNodes ?? []),
        ].filter((v, i, a) => a.indexOf(v) === i);
  const completed = new Set(run.completedNodes ?? []);
  const states = run.nodeStates ?? {};
  const agents = run.nodeAgents ?? {};

  const stages: AgentStage[] = [foreman];
  const seen = new Set<string>(["foreman"]);
  for (const nodeId of order.slice(0, 50)) {
    if (typeof nodeId !== "string" || nodeId === "" || seen.has(nodeId)) continue;
    seen.add(nodeId);
    let state: AgentStageState =
      asStageState(states[nodeId]) ??
      (completed.has(nodeId)
        ? "completed"
        : run.currentNodeId === nodeId
          ? "running"
          : "pending");
    if (
      gateNodeId === nodeId &&
      state !== "completed" &&
      state !== "failed" &&
      state !== "skipped"
    ) {
      state = "waiting-gate";
    }
    if (cancelled && state === "running") state = "cancelled";
    const agent = agents[nodeId];
    const agentName = typeof agent === "string" && agent !== "" ? agent : null;
    const resolved = resolveStageSessions(sessions.get(nodeId) ?? []);
    stages.push({
      id: nodeId,
      label: shortLabel(nodeId),
      kind: stageKind(state, agentName, resolved.sessionUrl),
      agent: agentName,
      state,
      sessionUrl: resolved.sessionUrl,
      rounds: resolved.rounds,
      currentRound: resolved.currentRound,
    });
  }
  // Sesiones registradas fuera del orden del DAG (resume/legacy): fila
  // honesta al final, nunca se oculta una sesión viva.
  for (const role of sessions.keys()) {
    if (seen.has(role) || role.startsWith("hook:")) continue;
    seen.add(role);
    const resolved = resolveStageSessions(sessions.get(role) ?? []);
    stages.push({
      id: role,
      label: shortLabel(role),
      kind: "agent",
      agent: role,
      state: "running",
      sessionUrl: resolved.sessionUrl,
      rounds: resolved.rounds,
      currentRound: resolved.currentRound,
    });
    if (stages.length >= 60) break;
  }
  return { routing: false, workflow: run.workflow, stages };
}
