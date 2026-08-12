// Label watcher para terminales de flujo de issue (resolve/fix/conflicto).
//
// Los prompts de esos flujos ya NO tocan labels del ciclo de review: la app
// los materializa sola mientras el terminal está vivo. Este módulo vigila el
// PR asociado al issue del terminal y aplica:
//   - review:pendiente: un PR recién creado (sin label del ciclo ni review)
//     arranca el ciclo pendiente de revisión;
//   - review:fix-aplicado: el head del PR pasó el commit que evaluó la review
//     más reciente (push del fix o la resolución de conflicto) y queda a la
//     espera de re-review.
// Es convergente: corta cuando aplicó el label buscado (o ya está puesto),
// cuando el terminal deja de estar vivo o cuando expira el timeout.
import {
  REVIEW_LABEL_FIX_APPLIED,
  REVIEW_LABEL_PENDING,
  canonicalReviewLabel,
} from "./reviewVerdict";

export type CycleLabel = "review:pendiente" | "review:fix-aplicado";

export interface PrLookupResult {
  ok: boolean;
  pr?: { number: number; state: string } | null;
  error?: string;
}

export interface PrDecisionResult {
  ok: boolean;
  reviewDecision?:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "REVIEW_REQUIRED"
    | "COMMENTED"
    | "FIX_APPLIED"
    | null;
  labels?: string[];
  error?: string;
}

export interface ApplyLabelResult {
  ok: boolean;
  error?: string;
}

export interface IssueLabelWatcherDeps {
  findPrForIssue: (
    repoPath: string,
    issueNumber: number,
  ) => Promise<PrLookupResult>;
  getPrReviewDecision: (
    repoPath: string,
    prNumber: number,
  ) => Promise<PrDecisionResult>;
  applyCycleLabel: (
    repoPath: string,
    prNumber: number,
    issueNumber: number | null,
    label: CycleLabel,
  ) => Promise<ApplyLabelResult>;
  isLive: () => boolean;
  notify: (kind: "info" | "warn" | "error", message: string) => void;
}

export interface WatchIssuePrLabelsOptions {
  repoPath: string;
  issueNumber: number;
  intervalMs?: number;
  timeoutMs?: number;
}

export const DEFAULT_WATCH_INTERVAL_MS = 10_000;
export const DEFAULT_WATCH_TIMEOUT_MS = 45 * 60_000;

export function watchIssuePrLabels(
  deps: IssueLabelWatcherDeps,
  options: WatchIssuePrLabelsOptions,
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WATCH_TIMEOUT_MS;
  const startedAt = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const materialize = async (
    prNumber: number,
    label: CycleLabel,
  ): Promise<void> => {
    const result = await deps.applyCycleLabel(
      options.repoPath,
      prNumber,
      options.issueNumber,
      label,
    );
    if (result.ok) {
      deps.notify("info", `${label} aplicado al PR #${prNumber}`);
    } else {
      deps.notify("error", `no se pudo aplicar ${label} al PR #${prNumber}: ${result.error ?? "error desconocido"}`);
    }
    stop();
  };

  const poll = async () => {
    if (stopped || !deps.isLive()) {
      stop();
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      deps.notify("warn", "label watch expiró sin materializar el ciclo");
      stop();
      return;
    }
    const found = await deps.findPrForIssue(options.repoPath, options.issueNumber);
    if (!found.ok) {
      deps.notify("warn", `no se pudo buscar el PR del issue (${found.error ?? "error"}); reintento`);
      return;
    }
    if (!found.pr || found.pr.state === "CLOSED" || found.pr.state === "MERGED") {
      // resolve flow: el PR todavía no existe, o ya cerró; seguir esperando
      // mientras el terminal siga vivo.
      return;
    }
    const decision = await deps.getPrReviewDecision(
      options.repoPath,
      found.pr.number,
    );
    if (!decision.ok) {
      deps.notify("warn", `no se pudo leer la decisión del PR #${found.pr.number} (${decision.error ?? "error"}); reintento`);
      return;
    }
    const canonical = canonicalReviewLabel(decision.labels ?? []);
    const pendingDecision =
      decision.reviewDecision === null ||
      decision.reviewDecision === "REVIEW_REQUIRED";
    if (canonical === null && pendingDecision) {
      await materialize(found.pr.number, REVIEW_LABEL_PENDING);
      return;
    }
    if (
      decision.reviewDecision === "FIX_APPLIED" &&
      canonical !== REVIEW_LABEL_FIX_APPLIED
    ) {
      await materialize(found.pr.number, REVIEW_LABEL_FIX_APPLIED);
      return;
    }
    if (
      canonical === REVIEW_LABEL_FIX_APPLIED ||
      canonical === REVIEW_LABEL_PENDING
    ) {
      // Ya está materializado por esta u otra vigilancia; convergió.
      stop();
    }
  };

  timer = setInterval(() => void poll(), intervalMs);
  void poll();
  deps.notify("info", `label watch activo para issue #${options.issueNumber}`);
  return stop;
}