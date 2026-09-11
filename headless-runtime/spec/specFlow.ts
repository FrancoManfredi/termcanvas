/**
 * SpecFlow — Ola 8.
 * Orquestación del Spec-agent + approval gate humano (POST .../spec/approve).
 * Guards puros/testeables (estilo reviewRaw) + persistencia best-effort
 * (timeline meta + spec.md). Nunca lanza hacia el flujo principal.
 */

import fs from "node:fs";
import path from "node:path";
import type { WorkItem } from "../../shared/types/workItem";
import type { ModelRef } from "../../shared/types/workItem";
import type { TriageFindings } from "../../shared/types/triage";
import type { SpecBrief } from "../../shared/types/spec";
import {
  SpecBriefSchema,
  getLatestSpecApprovalRequest,
} from "../../shared/types/spec";
import { specAgent } from "./specAgent";
import { resolveJobModel } from "../triage/triageFlow";
// B2: session cwd = isolation jail when recorded, else the anchor.
import { resolveSessionWorktree } from "../factory/isolation/sessionWorktree";
import { isSafeJobId } from "../factory/reviewRaw";
import { workItemStore } from "../workItem/workItemStore";

/** Nombre del archivo de brief en el dir del job. */
export const SPEC_MD_FILE = "spec.md";

// ── Lectura de spec desde timeline ──

/**
 * Extrae el último brief de spec desde la meta del timeline.
 * Puro, nunca lanza (devuelve null si no hay o si no valida).
 */
export function getLatestSpec(
  workItem: Pick<WorkItem, "timeline"> | null | undefined,
): SpecBrief | null {
  try {
    const timeline = workItem?.timeline;
    if (!Array.isArray(timeline)) return null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const meta = timeline[i]?.meta as Record<string, unknown> | undefined;
      if (!meta || !("spec" in meta)) continue;
      const parsed = SpecBriefSchema.safeParse(meta.spec);
      if (parsed.success) return parsed.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True si el job está en Triage con un pedido de aprobación de spec pendiente.
 * Puro, nunca lanza.
 */
export function hasPendingSpecApproval(
  workItem: Pick<WorkItem, "status" | "timeline"> | null | undefined,
): boolean {
  try {
    if (!workItem || workItem.status !== "Triage") return false;
    return getLatestSpecApprovalRequest(workItem.timeline) !== null;
  } catch {
    return false;
  }
}

// ── spec.md ──

/**
 * Construye el contenido de spec.md (brief) a partir del SpecBrief.
 * Puro y testeable.
 */
export function buildSpecMarkdown(brief: SpecBrief, workItemId = ""): string {
  const lines: string[] = [];
  lines.push(`# Spec ${workItemId}`.trim());
  lines.push("");
  lines.push("## Resumen");
  lines.push("");
  lines.push(brief.summary);
  lines.push("");
  lines.push("## Criterios de aceptación");
  lines.push("");
  for (const criterion of brief.acceptanceCriteria) {
    lines.push(`- [ ] ${criterion}`);
  }
  lines.push("");
  lines.push("## Archivos objetivo");
  lines.push("");
  if (brief.targetFiles.length === 0) {
    lines.push("(sin archivos objetivo declarados)");
  } else {
    for (const file of brief.targetFiles) {
      lines.push(`- ${file}`);
    }
  }
  lines.push("");
  if (brief.openQuestions.length > 0) {
    lines.push("## Preguntas abiertas");
    lines.push("");
    for (const question of brief.openQuestions) {
      lines.push(`- ${question}`);
    }
    lines.push("");
  }
  lines.push(`trivial: ${brief.trivial ? "sí (auto-skip trazado)" : "no (requiere aprobación humana)"}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Escribe spec.md en el dir del job (tmp + rename, best-effort).
 * Nunca lanza.
 */
export function persistSpecMarkdown(dir: string, brief: SpecBrief, workItemId = ""): boolean {
  try {
    if (!dir || typeof dir !== "string") return false;
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, SPEC_MD_FILE);
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmp, buildSpecMarkdown(brief, workItemId), "utf-8");
    fs.renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persiste brief en timeline meta + spec.md. Best-effort, nunca lanza.
 */
export function persistSpec(workItemId: string, brief: SpecBrief, message?: string): void {
  try {
    const msg =
      message ??
      `spec ${brief.trivial ? "trivial" : "no-trivial"} (${brief.acceptanceCriteria.length} criterios, ${brief.targetFiles.length} archivos) — ${brief.summary.slice(0, 120)}`;
    try {
      workItemStore.appendEvent(workItemId, "system", msg, {
        spec: brief,
      } as unknown as Record<string, unknown>);
    } catch {}
    try {
      const wi = workItemStore.get(workItemId);
      if (wi?.dir) persistSpecMarkdown(wi.dir, brief, workItemId);
    } catch {}
  } catch {}
}

export interface SpecPreStepResult {
  brief: SpecBrief | null;
  raw: string | null;
  skipped: boolean;
  skipReason: string | null;
}

/**
 * Corre el Spec-agent para un work item. Fallo-sano: ante cualquier error
 * devuelve skip (el llamador sigue a Foreman con evento trazado). Nunca lanza.
 * Pact jobs no deben llamar acá (bypass total en el llamador vía isPactTriageJob).
 */
export async function runSpecForJob(
  workItem: Pick<WorkItem, "id" | "prompt" | "worktree"> & {
    modelRef?: ModelRef;
    isolation?: WorkItem["isolation"];
    timeline?: WorkItem["timeline"];
  },
  triage?: TriageFindings,
  feedback?: string,
): Promise<SpecPreStepResult> {
  try {
    const model = resolveJobModel(workItem.modelRef);
    const out = await specAgent.consume({
      workItemId: workItem.id,
      // B2: the jail when recorded (isolation worktree), else the anchor.
      worktreePath: resolveSessionWorktree(workItem),
      model,
      prompt: workItem.prompt,
      ...(triage ? { triage } : {}),
      ...(typeof feedback === "string" && feedback.trim().length > 0 ? { feedback: feedback.trim().slice(0, 500) } : {}),
    });
    return { brief: out.brief, raw: out.raw, skipped: out.skipped, skipReason: out.skipReason };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { brief: null, raw: null, skipped: true, skipReason: msg.slice(0, 200) };
  }
}

// ── Guards puros del endpoint POST .../spec/approve ──

export type SpecApprovePathOk = { id: string; isWorkItemsAlias: boolean };
export type SpecApprovePathErr = { error: string };
/**
 * Parsea el pathname de POST .../spec/approve.
 * Espejo del estilo de POST .../review/retry-review: split("/").filter(Boolean),
 * alias work-items (len 4) vs factory (len 5), rechaza traversal.
 */
export function parseSpecApprovePath(pathname: unknown): SpecApprovePathOk | SpecApprovePathErr {
  if (typeof pathname !== "string") return { error: "invalid pathname" };
  const isFactory = pathname.startsWith("/factory/jobs/");
  const isAlias = pathname.startsWith("/work-items/");
  if (!isFactory && !isAlias) return { error: "not spec-approve route" };
  if (!pathname.endsWith("/spec/approve")) return { error: "not spec-approve route" };
  const parts = pathname.split("/").filter(Boolean);
  const expectedLen = isAlias ? 4 : 5;
  if (parts.length !== expectedLen) return { error: "unexpected path length for spec approve" };
  if (parts[expectedLen - 2] !== "spec" || parts[expectedLen - 1] !== "approve") {
    return { error: "not spec-approve route" };
  }
  const id = isAlias ? parts[1] : parts[2];
  if (!id || id === "spec" || id === "approve") {
    return { error: "missing id for spec approve" };
  }
  if (!isSafeJobId(id)) {
    return { error: `invalid id: ${String(id).slice(0, 60)}` };
  }
  return { id, isWorkItemsAlias: isAlias };
}

export type SpecRejectPathOk = { id: string; isWorkItemsAlias: boolean };
export type SpecRejectPathErr = { error: string };

/**
 * Parsea el pathname de POST .../spec/reject (rechazo humano del brief).
 * Espejo exacto de parseSpecApprovePath: split("/").filter(Boolean),
 * alias work-items (len 4) vs factory (len 5), rechaza traversal.
 */
export function parseSpecRejectPath(pathname: unknown): SpecRejectPathOk | SpecRejectPathErr {
  if (typeof pathname !== "string") return { error: "invalid pathname" };
  const isFactory = pathname.startsWith("/factory/jobs/");
  const isAlias = pathname.startsWith("/work-items/");
  if (!isFactory && !isAlias) return { error: "not spec-reject route" };
  if (!pathname.endsWith("/spec/reject")) return { error: "not spec-reject route" };
  const parts = pathname.split("/").filter(Boolean);
  const expectedLen = isAlias ? 4 : 5;
  if (parts.length !== expectedLen) return { error: "unexpected path length for spec reject" };
  if (parts[expectedLen - 2] !== "spec" || parts[expectedLen - 1] !== "reject") {
    return { error: "not spec-reject route" };
  }
  const id = isAlias ? parts[1] : parts[2];
  if (!id || id === "spec" || id === "reject") {
    return { error: "missing id for spec reject" };
  }
  if (!isSafeJobId(id)) {
    return { error: `invalid id: ${String(id).slice(0, 60)}` };
  }
  return { id, isWorkItemsAlias: isAlias };
}

export type SpecApproveGuardOk = { ok: true; specSummary: string };
export type SpecApproveGuardErr = { ok: false; code: 404 | 409; error: string };
export type SpecApproveGuard = SpecApproveGuardOk | SpecApproveGuardErr;

/**
 * Guards puros de POST .../spec/approve:
 * - 404 si no existe el job
 * - 409 si status !== "Triage"
 * - 409 si no hay pedido de aprobación de spec pendiente (meta needsSpecApproval)
 */
export function checkSpecApproveGuards(
  job: Pick<WorkItem, "status" | "timeline"> | null | undefined,
  idForMsg = "",
): SpecApproveGuard {
  const suffix = idForMsg ? `: ${idForMsg}` : "";
  if (!job) {
    return { ok: false, code: 404, error: `job not found${suffix}` };
  }
  const status = typeof job.status === "string" ? job.status : "";
  if (status !== "Triage") {
    return { ok: false, code: 409, error: `job not in Triage (status=${status || "?"})` };
  }
  const pending = getLatestSpecApprovalRequest(job.timeline);
  if (!pending) {
    return { ok: false, code: 409, error: `no pending spec approval${suffix}` };
  }
  return { ok: true, specSummary: pending.specSummary };
}
