import { useIssueGateStore } from "../stores/issueGateStore";
import { REVIEW_LABEL_GATE_FAIL, REVIEW_LABEL_PENDING } from "./reviewVerdict";

// Disparo del GATE DE CALIDAD desde el renderer.
//
// El label watcher detecta un PR nuevo (o un push nuevo tras review) sin
// label del ciclo y llama a runGateForIssue. El main process corre
// scripts/run-issue-gate.mjs en un worktree descartable (aislado del agente
// implementador) y devuelve el veredicto. Política de labels:
//   - PASS  → review:pendiente (flujo normal; applyCycleLabel limpia los
//             otros labels del ciclo y sincroniza el issue).
//   - FAIL  → gate:fallo (bloquea la review hasta resolver o "Revisar igual").
//   - error → la review avanza igual (el gate no rompe el flujo por
//             problemas de entorno; el watcher materializa review:pendiente).
//
// Cache por headRefOid: no se re-corre un gate ya evaluado para el mismo
// commit del PR.

export interface RunGateForIssueOptions {
  repoPath: string;
  issueNumber: number;
  prNumber: number;
  headRefOid: string | null;
}

export async function runGateForIssue(
  options: RunGateForIssueOptions,
): Promise<void> {
  const store = useIssueGateStore.getState();
  const existing = store.gateByPr[options.issueNumber]?.[options.prNumber];

  // Cache por sha: este commit ya fue evaluado (o ya hay un gate corriendo).
  if (existing?.status === "running") return;
  if (
    existing &&
    existing.evaluatedHeadRefOid === options.headRefOid &&
    existing.status !== "idle"
  ) {
    return;
  }
  if (
    existing &&
    existing.evaluatedHeadRefOid === options.headRefOid &&
    existing.status === "idle" &&
    existing.error
  ) {
    // Error de infra del gate anterior para este mismo commit: no re-disparar
    // en cada poll del watcher (el flujo sigue con review:pendiente).
    return;
  }

  store.setGate(options.issueNumber, options.prNumber, {
    status: "running",
    evaluatedHeadRefOid: options.headRefOid ?? null,
    error: null,
  });

  const result = await window.termcanvas.github.runIssueGate(
    options.repoPath,
    options.prNumber,
  );

  if (!result.ok) {
    // Error de infraestructura: no bloquear la review. El watcher materializa
    // review:pendiente en el próximo poll (el PR sigue sin label del ciclo).
    store.setGate(options.issueNumber, options.prNumber, {
      status: "idle",
      verdict: null,
      failedChecks: [],
      reportPath: null,
      error: result.error,
    });
    return;
  }

  store.setGate(options.issueNumber, options.prNumber, {
    status: result.verdict === "PASS" ? "pass" : "fail",
    verdict: result.verdict,
    failedChecks: result.failedChecks,
    reportPath: result.reportPath,
    evaluatedHeadRefOid: result.headRefOid,
    error: null,
  });

  const label =
    result.verdict === "PASS"
      ? REVIEW_LABEL_PENDING
      : REVIEW_LABEL_GATE_FAIL;
  try {
    await window.termcanvas.github.applyCycleLabel(
      options.repoPath,
      options.prNumber,
      options.issueNumber,
      label,
    );
  } catch {
    // El label lo re-materializa el watcher en el próximo poll; el estado del
    // store ya quedó persistido con el veredicto.
  }
}

// Escape manual: "Revisar igual". Quita gate:fallo, deja review:pendiente y
// devuelve el PR al flujo normal de review. El gate es una ayuda, no un
// dictador: el usuario puede forzar la revisión cuando lo considera.
export async function overrideGateForIssue(options: {
  repoPath: string;
  issueNumber: number;
  prNumber: number;
}): Promise<boolean> {
  try {
    await window.termcanvas.github.applyCycleLabel(
      options.repoPath,
      options.prNumber,
      options.issueNumber,
      REVIEW_LABEL_PENDING,
    );
  } catch {
    return false;
  }
  useIssueGateStore.getState().setGate(options.issueNumber, options.prNumber, {
    status: "idle",
    verdict: null,
    failedChecks: [],
    reportPath: null,
    error: null,
  });
  return true;
}
