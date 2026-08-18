import { create } from "zustand";

// Estado del GATE DE CALIDAD determinista por issue/PR.
//
// El gate corre cuando aparece un PR nuevo (o un push nuevo tras review) y
// decide si el PR puede entrar al ciclo de review:
//   - PASS  → se aplica review:pendiente (flujo normal).
//   - FAIL  → se aplica gate:fallo (la review queda bloqueada; el reporte
//             queda disponible en reportPath; "Revisar igual" fuerza el paso).
//   - error de infraestructura → status idle + error (la review avanza igual:
//             el gate no debe romper el flujo por problemas de entorno).
//
// Cache por headRefOid: el gate corre UNA vez por commit del PR. El reporte
// persiste en disco (.agents/planning/gate-pr-<N>-<sha>.json) como audit
// trail; este store es el estado en memoria para la UI.

export type IssueGateStatus = "idle" | "running" | "pass" | "fail";

export interface IssueGateState {
  status: IssueGateStatus;
  verdict: "PASS" | "FAIL" | null;
  failedChecks: string[];
  reportPath: string | null;
  evaluatedHeadRefOid: string | null;
  error: string | null;
}

export const initialGateState: IssueGateState = {
  status: "idle",
  verdict: null,
  failedChecks: [],
  reportPath: null,
  evaluatedHeadRefOid: null,
  error: null,
};

interface IssueGateStore {
  // issueNumber → prNumber → estado del gate (patrón del issueReviewStore:
  // maps anidados para soportar multi-PR por issue).
  gateByPr: Record<number, Record<number, IssueGateState>>;
  getGate: (issueNumber: number, prNumber: number) => IssueGateState | undefined;
  setGate: (
    issueNumber: number,
    prNumber: number,
    partial: Partial<IssueGateState>,
  ) => void;
  clearGate: (issueNumber: number, prNumber: number) => void;
}

export const useIssueGateStore = create<IssueGateStore>((set, get) => ({
  gateByPr: {},

  getGate: (issueNumber, prNumber) =>
    get().gateByPr[issueNumber]?.[prNumber],

  setGate: (issueNumber, prNumber, partial) =>
    set((state) => {
      const byIssue = state.gateByPr[issueNumber] ?? {};
      return {
        gateByPr: {
          ...state.gateByPr,
          [issueNumber]: {
            ...byIssue,
            [prNumber]: { ...initialGateState, ...byIssue[prNumber], ...partial },
          },
        },
      };
    }),

  clearGate: (issueNumber, prNumber) =>
    set((state) => {
      const byIssue = state.gateByPr[issueNumber];
      if (!byIssue || !byIssue[prNumber]) return state;
      const { [prNumber]: _removed, ...rest } = byIssue;
      return {
        gateByPr: { ...state.gateByPr, [issueNumber]: rest },
      };
    }),
}));
