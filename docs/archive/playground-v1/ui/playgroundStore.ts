import { create } from "zustand";
import { PLAYGROUND_FS } from "../lib/factory/playgroundData";

/**
 * Verdict given by the user for a given F after manual testing.
 * Persisted in localStorage under `factory-playground-verdicts`.
 * Since 2026-08-31 the store is versioned: each F keeps a history array.
 * Old localStorage shape (single object per F) is migrated automatically.
 * Since 2026-09-01: extended with rawOutput, criterionSnapshot, codeHash, testedBy,
 * updated VerdictStatus with aprobado_con_reservas / bloqueado / flaky.
 */
export type VerdictStatus =
  | "aprobado"
  | "aprobado_con_reservas"
  | "pendiente"
  | "fallo"
  | "bloqueado"
  | "flaky";

export interface CriterionSnapshot {
  criterio: string;
  warpBehavior: string;
  localBehavior: string;
  inputsOutputs: Array<{ label: string; value: string }>;
  timeoutMs: number;
}

export interface PlaygroundVerdict {
  status: VerdictStatus;
  notes: string;
  updatedAt: number;
}

export interface PlaygroundVerdictEntry {
  status: VerdictStatus;
  notes: string;
  updatedAt: number;
  version: number;
  /** Pegado crudo de PowerShell (curl sin .exe, etc). Opcional para compatibilidad. */
  rawOutput?: string;
  /** Snapshot del criterio en el momento de guardar veredicto (versionado del criterio). */
  criterionSnapshot?: CriterionSnapshot;
  /** Hash de commit truncado 7 chars o "unknown". */
  codeHash?: string;
  /** Quién probó: humano (UI) vs script (Correr todos / verify script). */
  testedBy?: "humano" | "script";
  /** Deprecated alias: humanVerdict is notes; kept to support future rename */
  humanVerdict?: string;
}

export type PlaygroundVerdicts = Record<string, PlaygroundVerdictEntry[]>;

const STORAGE_KEY = "factory-playground-verdicts";
const ACTIVE_KEY = "factory-playground-active";
const SELECTED_KEY = "factory-playground-selected";
const LEFT_COLLAPSED_KEY = "factory-playground-left-collapsed";
const LEFT_WIDTH_KEY = "factory-playground-left-width";

function isValidStatus(v: unknown): v is VerdictStatus {
  return (
    v === "aprobado" ||
    v === "aprobado_con_reservas" ||
    v === "fallo" ||
    v === "pendiente" ||
    v === "bloqueado" ||
    v === "flaky"
  );
}

function toCriterionSnapshot(raw: unknown): CriterionSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.criterio !== "string") return undefined;
  return {
    criterio: String(r.criterio ?? ""),
    warpBehavior: String(r.warpBehavior ?? ""),
    localBehavior: String(r.localBehavior ?? ""),
    inputsOutputs: Array.isArray(r.inputsOutputs)
      ? (r.inputsOutputs as Array<{ label: string; value: string }>).filter(
          (x) => x && typeof x.label === "string" && typeof x.value === "string"
        )
      : [],
    timeoutMs: typeof r.timeoutMs === "number" && Number.isFinite(r.timeoutMs) ? r.timeoutMs : 500,
  };
}

function toEntry(raw: Record<string, unknown>, fallbackVersion: number): PlaygroundVerdictEntry | null {
  const status = raw.status as unknown;
  if (!isValidStatus(status)) return null;
  const notesRaw = typeof raw.notes === "string" ? raw.notes : (typeof raw.humanVerdict === "string" ? raw.humanVerdict : "");
  const rawOutput = typeof raw.rawOutput === "string" ? raw.rawOutput : undefined;
  const codeHash = typeof raw.codeHash === "string" ? raw.codeHash : undefined;
  const testedRaw = raw.testedBy as unknown;
  const testedBy: "humano" | "script" | undefined =
    testedRaw === "script" || testedRaw === "humano" ? testedRaw : undefined;
  const snap = toCriterionSnapshot(raw.criterionSnapshot);
  return {
    status,
    notes: notesRaw,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    version: typeof raw.version === "number" && Number.isFinite(raw.version) ? Math.max(1, Math.round(raw.version)) : fallbackVersion,
    rawOutput: rawOutput && rawOutput.trim() ? rawOutput.slice(0, 4000) : undefined,
    humanVerdict: typeof raw.humanVerdict === "string" ? raw.humanVerdict.slice(0, 4000) : undefined,
    criterionSnapshot: snap,
    codeHash,
    testedBy,
  };
}

function buildSnapshotForF(fId: string): CriterionSnapshot | undefined {
  const f = PLAYGROUND_FS.find((x) => x.id === fId);
  if (!f) return undefined;
  return {
    criterio: f.whatToTest.criterio,
    warpBehavior: f.whatToTest.warpBehavior,
    localBehavior: f.whatToTest.localBehavior,
    inputsOutputs: [...f.whatToTest.inputsOutputs],
    timeoutMs: typeof f.timeoutMs === "number" ? f.timeoutMs : 500,
  };
}

function loadVerdicts(): PlaygroundVerdicts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: PlaygroundVerdicts = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v !== "object") continue;
      if (Array.isArray(v)) {
        const entries: PlaygroundVerdictEntry[] = [];
        for (let i = 0; i < v.length; i++) {
          const item = v[i] as unknown;
          if (!item || typeof item !== "object") continue;
          const e = toEntry(item as Record<string, unknown>, i + 1);
          if (e) entries.push(e);
        }
        if (entries.length === 0) continue;
        entries.sort((a, b) => a.version - b.version || a.updatedAt - b.updatedAt);
        const normalized = entries.map((e, idx) => ({ ...e, version: idx + 1 }));
        out[k] = normalized;
        continue;
      }
      const r = v as Record<string, unknown>;
      const single = toEntry(r, 1);
      if (single) {
        single.version = 1;
        out[k] = [single];
      }
    }
    return out;
  } catch {
    return {};
  }
}

function loadActive(): boolean {
  try {
    return localStorage.getItem(ACTIVE_KEY) === "true";
  } catch {
    return false;
  }
}

function loadSelected(): string {
  try {
    const v = localStorage.getItem(SELECTED_KEY);
    if (v && /^F0[1-5]$/.test(v)) return v;
    return "F01";
  } catch {
    return "F01";
  }
}

function loadLeftCollapsed(): boolean {
  try {
    const v = localStorage.getItem(LEFT_COLLAPSED_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
    return false;
  } catch {
    return false;
  }
}

function loadLeftWidth(): number {
  try {
    const raw = localStorage.getItem(LEFT_WIDTH_KEY);
    const n = raw ? Number(raw) : 280;
    if (!Number.isFinite(n)) return 280;
    return Math.max(200, Math.min(420, Math.round(n)));
  } catch {
    return 280;
  }
}

function persistVerdicts(v: PlaygroundVerdicts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // quota or privacy mode — silently ignore
  }
}

export function getLatestVerdict(verdicts: PlaygroundVerdicts, fId: string): PlaygroundVerdictEntry | undefined {
  const hist = verdicts[fId];
  if (!hist || hist.length === 0) return undefined;
  return hist[hist.length - 1];
}

export function getLatestFromHistory(history: PlaygroundVerdictEntry[] | undefined): PlaygroundVerdictEntry | undefined {
  if (!history || history.length === 0) return undefined;
  return history[history.length - 1];
}

/**
 * Flaky detection: last up to 3 entries contain at least one approved (aprobado or aprobado_con_reservas)
 * and at least one fallo → flaky.
 */
export function isFlaky(verdicts: PlaygroundVerdicts, fId: string): boolean;
export function isFlaky(history: PlaygroundVerdictEntry[]): boolean;
export function isFlaky(arg1: PlaygroundVerdicts | PlaygroundVerdictEntry[], arg2?: string): boolean {
  let hist: PlaygroundVerdictEntry[] | undefined;
  if (Array.isArray(arg1)) {
    hist = arg1;
  } else if (arg2) {
    hist = arg1[arg2];
  } else {
    hist = undefined;
  }
  if (!hist || hist.length === 0) return false;
  const last3 = hist.slice(-3);
  const hasApproved = last3.some((e) => e.status === "aprobado" || e.status === "aprobado_con_reservas");
  const hasFallo = last3.some((e) => e.status === "fallo");
  return hasApproved && hasFallo;
}

/** Helper to list rollback warnings for a given upstream F */
export function getRollbackWarnings(
  fId: string,
  verdicts: PlaygroundVerdicts
): Array<{ downstream: string; downstreamStatus: VerdictStatus }> {
  const downstream = PLAYGROUND_FS.filter((f) => (f.blockedBy ?? []).includes(fId));
  const latest = getLatestVerdict(verdicts, fId);
  const isApproved = latest?.status === "aprobado" || latest?.status === "aprobado_con_reservas";
  if (!isApproved) return [];
  const warnings: Array<{ downstream: string; downstreamStatus: VerdictStatus }> = [];
  for (const d of downstream) {
    const lv = getLatestVerdict(verdicts, d.id);
    if (lv?.status === "fallo") {
      warnings.push({ downstream: d.id, downstreamStatus: lv.status });
    }
  }
  return warnings;
}

interface PlaygroundStore {
  playgroundActive: boolean;
  selectedFId: string;
  leftCollapsed: boolean;
  leftWidth: number;
  verdicts: PlaygroundVerdicts;

  setPlaygroundActive: (active: boolean) => void;
  togglePlayground: () => void;
  setSelectedFId: (id: string) => void;
  setLeftCollapsed: (collapsed: boolean) => void;
  setLeftWidth: (width: number) => void;
  setVerdict: (
    fId: string,
    verdict: Pick<PlaygroundVerdictEntry, "status" | "notes"> &
      Partial<Pick<PlaygroundVerdictEntry, "updatedAt" | "version" | "rawOutput" | "criterionSnapshot" | "codeHash" | "testedBy" | "humanVerdict">>
  ) => void;
  clearVerdict: (fId: string) => void;
}

export const usePlaygroundStore = create<PlaygroundStore>((set, get) => ({
  playgroundActive: typeof window !== "undefined" ? loadActive() : false,
  selectedFId: typeof window !== "undefined" ? loadSelected() : "F01",
  leftCollapsed: typeof window !== "undefined" ? loadLeftCollapsed() : false,
  leftWidth: typeof window !== "undefined" ? loadLeftWidth() : 280,
  verdicts: typeof window !== "undefined" ? loadVerdicts() : {},

  setPlaygroundActive: (active) => {
    set({ playgroundActive: active });
    try {
      localStorage.setItem(ACTIVE_KEY, String(active));
    } catch {}
  },

  togglePlayground: () => {
    const next = !get().playgroundActive;
    set({ playgroundActive: next });
    try {
      localStorage.setItem(ACTIVE_KEY, String(next));
    } catch {}
  },

  setSelectedFId: (id) => {
    set({ selectedFId: id });
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {}
  },

  setLeftCollapsed: (collapsed) => {
    set({ leftCollapsed: collapsed });
    try {
      localStorage.setItem(LEFT_COLLAPSED_KEY, String(collapsed));
    } catch {}
  },

  setLeftWidth: (width) => {
    const clamped = Math.max(200, Math.min(420, Math.round(width)));
    set({ leftWidth: clamped });
    try {
      localStorage.setItem(LEFT_WIDTH_KEY, String(clamped));
    } catch {}
  },

  setVerdict: (fId, verdict) => {
    const prev = get().verdicts[fId] ?? [];
    const snapshot = verdict.criterionSnapshot ?? buildSnapshotForF(fId);
    const nextEntry: PlaygroundVerdictEntry = {
      status: verdict.status,
      notes: (verdict.notes ?? verdict.humanVerdict ?? "").slice(0, 4000),
      updatedAt: Date.now(),
      version: prev.length + 1,
      rawOutput: typeof verdict.rawOutput === "string" && verdict.rawOutput.trim() ? verdict.rawOutput.slice(0, 4000) : undefined,
      criterionSnapshot: snapshot,
      codeHash: typeof verdict.codeHash === "string" && verdict.codeHash.trim() ? verdict.codeHash.slice(0, 40) : undefined,
      testedBy: verdict.testedBy ?? "humano",
      humanVerdict: typeof verdict.humanVerdict === "string" && verdict.humanVerdict.trim() ? verdict.humanVerdict.slice(0, 4000) : undefined,
    };
    // Ensure notes mirrors humanVerdict if provided separately
    if (nextEntry.humanVerdict && !nextEntry.notes) nextEntry.notes = nextEntry.humanVerdict;
    const nextHist = [...prev, nextEntry];
    const next = { ...get().verdicts, [fId]: nextHist };
    set({ verdicts: next });
    persistVerdicts(next);
  },

  clearVerdict: (fId) => {
    const next = { ...get().verdicts };
    delete next[fId];
    set({ verdicts: next });
    persistVerdicts(next);
  },
}));

/**
 * Transitive blocked check.
 * An F is blocked if ANY of its ancestors transitively is not approved.
 * - Direct dependency missing or not aprobado/aprobado_con_reservas → blocked by that dep.
 * - Direct dependency approved but itself transitively blocked → blocked by that dep's blockers.
 * visited prevents cycles.
 */
export function isBlockedTransitive(
  fId: string,
  verdicts: PlaygroundVerdicts,
  visited: Set<string> = new Set()
): { blocked: boolean; blockedBy: string[] } {
  const entry = PLAYGROUND_FS.find((f) => f.id === fId);
  const direct = entry?.blockedBy ?? [];
  if (direct.length === 0) return { blocked: false, blockedBy: [] };
  const blockers: string[] = [];
  for (const bid of direct) {
    if (visited.has(bid)) continue;
    visited.add(bid);
    const latest = getLatestVerdict(verdicts, bid);
    // FLAKY does NOT block downstream — warning only (badge/banner), not hard lock.
    // Keep isFlaky detection intact; only effect on blocking is removed.
    if (
      !latest ||
      (latest.status !== "aprobado" &&
        latest.status !== "aprobado_con_reservas" &&
        latest.status !== "flaky")
    ) {
      if (!blockers.includes(bid)) blockers.push(bid);
    } else {
      const sub = isBlockedTransitive(bid, verdicts, visited);
      if (sub.blocked) {
        for (const b of sub.blockedBy) {
          if (!blockers.includes(b)) blockers.push(b);
        }
      }
    }
  }
  return { blocked: blockers.length > 0, blockedBy: blockers };
}

/**
 * Returns whether a given F is currently blocked by its dependencies (transitive).
 * An F is blocked if any of its `blockedBy` ids (or their ancestors) has latest verdict.status not in ["aprobado","aprobado_con_reservas"].
 * Missing verdict (never tested) counts as not approved → blocked.
 * If blockedBy is empty or undefined, never blocked.
 * This wrapper keeps the original API and delegates to the transitive helper.
 */
export function isBlocked(fId: string, verdicts: PlaygroundVerdicts): { blocked: boolean; blockedBy: string[] } {
  return isBlockedTransitive(fId, verdicts, new Set());
}
