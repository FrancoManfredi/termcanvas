/**
 * WorkItem disk persistence — job.json + prompt.md + logs.ndjson + .done
 * Reutiliza layout {worktree}/.agents/factory/{id}/ y es compatible con FactoryJob viejo.
 * Escritura atómica para .done y job.json (tmp + rename).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { WorkItem, WorkItemStatus } from "../../shared/types/workItem";
import type { CostSummary } from "../../shared/types/workItem";
import {
  mapLegacyStateToStatus,
  mapStatusToLegacyState,
} from "../../shared/types/workItem";
import { ensureResultJsonCompat } from "./resultStore";

function getRepoRootFallback(): string {
  try {
    // workItemDisk.ts vive en headless-runtime/workItem/
    const current = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
    if (fs.existsSync(path.join(current, "package.json"))) return current;
  } catch {}
  try {
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, "package.json"))) return cwd;
  } catch {}
  return process.cwd();
}

/**
 * Ensures {worktree}/.agents/factory/{id}/ exists and writes initial files:
 * job.json, prompt.md, logs.ndjson (empty or with initial log), ensures .done not present unless Complete.
 * Ola 3: también asegura logs/build.log vacío y respeta result.json existente (no borra si ya existe con pass/fail).
 */
export function ensureWorkItemDir(item: WorkItem): void {
  if (!item.dir) return;
  try {
    fs.mkdirSync(item.dir, { recursive: true });
    writeWorkItemJsonAtomic(item);
    // prompt.md utf8
    fs.writeFileSync(path.join(item.dir, "prompt.md"), item.prompt, "utf-8");
    // logs.ndjson from item.logs if present, else empty
    const logsPath = path.join(item.dir, "logs.ndjson");
    const logsContent =
      Array.isArray(item.logs) && item.logs.length > 0
        ? item.logs.join("\n") + "\n"
        : "";
    // Only write logs.ndjson if not exists or if we have logs to write; preserve existing append behavior
    if (!fs.existsSync(logsPath) || logsContent.length > 0) {
      if (!fs.existsSync(logsPath)) {
        fs.writeFileSync(logsPath, logsContent, "utf-8");
      } else if (logsContent.length > 0) {
        // overwrite with current logs (idempotent for ensure)
        fs.writeFileSync(logsPath, logsContent, "utf-8");
      }
    }
    // Ola 3: ensure logs/build.log exists (empty) for new items
    try {
      const buildLogPath = path.join(item.dir, "logs", "build.log");
      fs.mkdirSync(path.dirname(buildLogPath), { recursive: true });
      if (!fs.existsSync(buildLogPath)) fs.writeFileSync(buildLogPath, "", "utf-8");
    } catch {}
    // Ensure .done state matches status + result.json
    const donePath = path.join(item.dir, ".done");
    const resultPath = path.join(item.dir, "result.json");
    if (item.status === "Complete") {
      // Only ensure .done if result.json is pass or no result.json yet (compat Ola2)
      let shouldCreateDone = true;
      try {
        if (fs.existsSync(resultPath)) {
          const raw = fs.readFileSync(resultPath, "utf-8");
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed.status === "fail") shouldCreateDone = false;
        }
      } catch {
        // ignore corrupt result.json — keep done based on status
      }
      if (shouldCreateDone) {
        if (!fs.existsSync(donePath)) fs.writeFileSync(donePath, "", "utf-8");
      } else {
        try {
          fs.unlinkSync(donePath);
        } catch {}
      }
      // keep result.json if already exists (Ola3), don't overwrite with dummy
      if (!fs.existsSync(resultPath)) ensureResultJsonCompat(item);
    } else {
      try {
        fs.unlinkSync(donePath);
      } catch {}
      // Do NOT delete result.json if it exists with fail (triage evidence) — only if no result at all
      // For non-Complete statuses, keep result.json if it exists (allows Triage to have result)
      // But if item is fresh Intake/Foreman/Building, no result yet — ensure no stale file from previous run
      // Check if status is Intake/Foreman and result exists with old id mismatch -> keep? For now keep file if exists.
      // We will NOT delete result.json here for Ola3 to preserve triage evidence.
      // Only delete if result doesn't match current id? Keep conservative: don't delete.
    }
  } catch (e) {
    console.warn("[WorkItemDisk] ensureWorkItemDir failed", e);
  }
}

/**
 * Atomic write of job.json via tmp + rename.
 */
export function writeWorkItemJsonAtomic(item: WorkItem): void {  if (!item.dir) return;
  try {
    fs.mkdirSync(item.dir, { recursive: true });
    const target = path.join(item.dir, "job.json");
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const payload = {
      id: item.id,
      prompt: item.prompt,
      worktree: item.worktree,
      phase: item.phase,
      status: item.status,
      state: item.state ?? mapStatusToLegacy(item.status),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      timeline: item.timeline,
      cost: item.cost,
      // Ola 15 E2 (aditivo): null explícito se persiste (tracking apagado =
      // "—"); undefined se omite (sin datos todavía, jobs viejos).
      ...(item.costSummary !== undefined ? { costSummary: item.costSummary } : {}),
      // Ola 16 E1 (aditivo): sesiones por (job, rol). undefined se omite
      // (job viejo o rol que aún no habló); presente → evidencia en disco.
      ...(item.agentSessions !== undefined ? { agentSessions: item.agentSessions } : {}),
      // Hooks declarativos (aditivo): última corrida por hook, cap 20.
      // undefined se omite (job viejo o sin hooks todavía).
      ...((item as unknown as Record<string, unknown>).hookRuns !== undefined
        ? { hookRuns: (item as unknown as Record<string, unknown>).hookRuns }
        : {}),
      dir: item.dir,
      dotDonePath: item.dotDonePath,
      runnerId: item.runnerId,
      logsNdjsonPath: item.logsNdjsonPath ?? (item.dir ? path.join(item.dir, "logs.ndjson") : undefined),
      reviewCount: item.reviewCount ?? 0,
      ...(item.lastReview ? { lastReview: item.lastReview } : {}),
      ...(item.sessionId ? { sessionId: item.sessionId } : {}),
      ...(item.dashboardUrl ? { dashboardUrl: item.dashboardUrl } : {}),
      ...(item.directory ? { directory: item.directory } : {}),
      ...(item.modelRef ? { modelRef: item.modelRef } : {}),
      ...(item.reviewerRef ? { reviewerRef: item.reviewerRef } : {}),
      // H-001 (aditivo): createdFiles top-level para igualdad exacta contra
      // disco (E2E-05). undefined se omite (jobs viejos, sin datos todavía).
      ...(item.createdFiles !== undefined ? { createdFiles: item.createdFiles } : {}),
      ...(Array.isArray(item.logs) ? { logsCount: item.logs.length } : {}),
    };
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
    fs.renameSync(tmp, target);

    // .done handling atomically after job.json — Ola 3: keep result.json for Triage, only manage .done
    const donePath = path.join(item.dir, ".done");
    const resultPath = path.join(item.dir, "result.json");
    if (item.status === "Complete") {
      // Ola 3: only create .done if result.json is pass or no result yet (compat)
      let shouldCreateDone = true;
      try {
        if (fs.existsSync(resultPath)) {
          const raw = fs.readFileSync(resultPath, "utf-8");
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          // Ola 3 shape uses status pass/fail; old shape uses status Complete
          const st = (parsed.status as string) ?? "";
          if (st === "fail") shouldCreateDone = false;
        }
      } catch {}
      if (shouldCreateDone) {
        if (!fs.existsSync(donePath)) fs.writeFileSync(donePath, "", "utf-8");
      } else {
        try {
          fs.unlinkSync(donePath);
        } catch {}
      }
      if (!fs.existsSync(resultPath)) ensureResultJsonCompat(item);
      // ensure logs/build.log exists
      try {
        const bl = path.join(item.dir, "logs", "build.log");
        fs.mkdirSync(path.dirname(bl), { recursive: true });
        if (!fs.existsSync(bl)) fs.writeFileSync(bl, "", "utf-8");
      } catch {}
    } else {
      try {
        fs.unlinkSync(donePath);
      } catch {}
      // Ola 3: do NOT delete result.json for Triage/Building (keep triage evidence)
      // Only delete if it's old Ola1 dummy and no verification? Keep file for now.
      // Ensure logs/build.log exists for Building
      if (item.status === "Building") {
        try {
          const bl = path.join(item.dir, "logs", "build.log");
          fs.mkdirSync(path.dirname(bl), { recursive: true });
          if (!fs.existsSync(bl)) fs.writeFileSync(bl, "", "utf-8");
        } catch {}
      }
    }
  } catch (e) {
    console.warn("[WorkItemDisk] writeWorkItemJsonAtomic failed", e);
  }
}

function mapStatusToLegacy(status: WorkItemStatus): string {
  switch (status) {
    case "Intake":
      return "queued";
    case "Foreman":
      return "queued";
    case "Triage":
      return "queued";
    case "Building":
      return "running";
    case "Review":
      return "running";
    case "Complete":
      return "done";
    case "Cancelled":
      return "error";
    default:
      return "queued";
  }
}

/**
 * FASE 4 E1 — Entierro del escritor legacy jubilado (las 8 + C3/C7/C10):
 * `ensureResultJson` extirpado (uso-cero verificado: ningún importador fuera
 * de este archivo; los 2 llamados internos ahora van directo a la tienda
 * única `resultStore.ensureResultJsonCompat`). Un solo escritor (`resultStore`),
 * una sola proyección (`jobView`). Ver tests/legacy-zero-use.test.ts.
 */

/**
 * Append a single line to logs.ndjson (utf8) and update job.json updatedAt.
 */
export function appendWorkItemLog(item: WorkItem, line: string): void {
  if (!item.dir) return;
  try {
    const logsPath = path.join(item.dir, "logs.ndjson");
    fs.appendFileSync(logsPath, line + "\n", "utf-8");
  } catch {}
}

/**
 * Reads WorkItem from disk directory (for restore). Returns null if invalid.
 * Handles migration from legacy FactoryJob (sin timeline/cost/runnerId).
 */
export function readWorkItemFromDir(jobDir: string): WorkItem | null {
  const jobJsonPath = path.join(jobDir, "job.json");
  if (!fs.existsSync(jobJsonPath)) return null;
  try {
    const raw = fs.readFileSync(jobJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const id = typeof parsed.id === "string" ? parsed.id : path.basename(jobDir);
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
    const worktree = typeof parsed.worktree === "string" ? parsed.worktree : "";
    const phase = typeof parsed.phase === "string" ? parsed.phase : "diagnosisLlm";
    const statusRaw = typeof parsed.status === "string" ? parsed.status : undefined;
    const stateRaw = typeof parsed.state === "string" ? parsed.state : undefined;
    const createdAtRaw =
      typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString();
    const updatedAtRaw =
      typeof parsed.updatedAt === "string" ? parsed.updatedAt : createdAtRaw;
    const timelineRaw = Array.isArray(parsed.timeline)
      ? (parsed.timeline as WorkItem["timeline"])
      : undefined;
    const costRaw = parsed.cost as WorkItem["cost"] | undefined;
    const runnerId =
      typeof parsed.runnerId === "string" ? parsed.runnerId : "linux-build";
    const dir = typeof parsed.dir === "string" ? parsed.dir : jobDir;
    const dotDonePath =
      typeof parsed.dotDonePath === "string"
        ? parsed.dotDonePath
        : path.join(jobDir, ".done");
    const sessionId =
      typeof parsed.sessionId === "string" ? parsed.sessionId : undefined;
    const dashboardUrl =
      typeof parsed.dashboardUrl === "string" ? parsed.dashboardUrl : undefined;
    const directory =
      typeof parsed.directory === "string" ? parsed.directory : undefined;
    const modelRefRaw = parsed.modelRef as
      | { providerID?: unknown; modelID?: unknown; variant?: unknown }
      | undefined;
    let modelRef: WorkItem["modelRef"] | undefined;
    if (
      modelRefRaw &&
      typeof modelRefRaw === "object" &&
      typeof (modelRefRaw as Record<string, unknown>).providerID === "string" &&
      typeof (modelRefRaw as Record<string, unknown>).modelID === "string"
    ) {
      const pID = String(
        (modelRefRaw as Record<string, unknown>).providerID,
      ).trim();
      const mID = String(
        (modelRefRaw as Record<string, unknown>).modelID,
      ).trim();
      const vRaw = (modelRefRaw as Record<string, unknown>).variant;
      const variant =
        typeof vRaw === "string" && vRaw.trim() ? vRaw.trim() : undefined;
      if (pID && mID) {
        modelRef = {
          providerID: pID,
          modelID: mID,
          ...(variant ? { variant } : {}),
        };
      }
    }

    // Revisor explícito elegido por el usuario (Ola 4.1) — opcional, jobs viejos no lo tienen
    const reviewerRefRaw = parsed.reviewerRef as
      | { providerID?: unknown; modelID?: unknown; variant?: unknown }
      | undefined;
    let reviewerRef: WorkItem["reviewerRef"] | undefined;
    if (
      reviewerRefRaw &&
      typeof reviewerRefRaw === "object" &&
      typeof (reviewerRefRaw as Record<string, unknown>).providerID === "string" &&
      typeof (reviewerRefRaw as Record<string, unknown>).modelID === "string"
    ) {
      const pID = String(
        (reviewerRefRaw as Record<string, unknown>).providerID,
      ).trim();
      const mID = String(
        (reviewerRefRaw as Record<string, unknown>).modelID,
      ).trim();
      const vRaw = (reviewerRefRaw as Record<string, unknown>).variant;
      const variant =
        typeof vRaw === "string" && vRaw.trim() ? vRaw.trim() : undefined;
      if (pID && mID) {
        reviewerRef = {
          providerID: pID,
          modelID: mID,
          ...(variant ? { variant } : {}),
        };
      }
    }

    let status: WorkItemStatus;
    if (
      statusRaw &&
      ["Intake", "Foreman", "Triage", "Building", "Review", "Complete", "Cancelled"].includes(
        statusRaw,
      )
    ) {
      status = statusRaw as WorkItemStatus;
    } else if (stateRaw) {
      status = mapLegacyStateToStatus(stateRaw);
    } else {
      status = "Intake";
    }

    // If .done exists, force Complete (source of truth on disk)
    try {
      if (fs.existsSync(path.join(jobDir, ".done"))) status = "Complete";
    } catch {}

    let timeline: WorkItem["timeline"];
    if (timelineRaw && timelineRaw.length > 0) {
      timeline = timelineRaw;
    } else {
      // Migration: create minimal timeline from legacy state
      const nowIso = createdAtRaw as string;
      if (status === "Complete") {
        timeline = [
          {
            id: `${id}-t0`,
            from: "Intake",
            to: "Foreman",
            at: nowIso,
            actor: "system",
            message: "migrated from legacy queued",
          },
          {
            id: `${id}-t1`,
            from: "Foreman",
            to: "Building",
            at: nowIso,
            actor: "foreman",
            message: "migrated foreman → building",
          },
          {
            id: `${id}-t2`,
            from: "Building",
            to: "Complete",
            at: updatedAtRaw as string,
            actor: "system",
            message: "migrated Building → Complete",
          },
        ];
      } else if (status === "Intake") {
        timeline = [
          {
            id: `${id}-t0`,
            from: "Intake",
            to: "Intake",
            at: nowIso,
            actor: "user",
            message: "migrated Intake",
          },
        ];
      } else {
        timeline = [
          {
            id: `${id}-t0`,
            from: "Intake",
            to: status,
            at: nowIso,
            actor: "system",
            message: `migrated ${status}`,
          },
        ];
      }
    }

    const cost: WorkItem["cost"] =
      costRaw && typeof costRaw.estimatedUSD === "number"
        ? costRaw
        : { estimatedUSD: 0, currency: "USD", breakdown: [] };

    // Ola 15 E2 (aditivo, restore tolerante): costSummary opcional.
    // - ausente → undefined (job viejo, "sin datos todavía", no rompe).
    // - null explícito → null (tracking apagado, UI muestra "—").
    // - objeto válido → se usa; inválido → undefined (tolerante, no throw).
    let costSummary: CostSummary | null | undefined;
    try {
      const raw = (parsed as Record<string, unknown>).costSummary;
      if (raw === null) {
        costSummary = null;
      } else if (raw && typeof raw === "object") {
        const o = raw as Record<string, unknown>;
        const llmCalls = o.llmCalls;
        const inT = o.estimatedInputTokens;
        const outT = o.estimatedOutputTokens;
        const usd = o.estimatedUSD;
        const basis = o.basis;
        const ref = o.ratesRef;
        const okCalls =
          typeof llmCalls === "number" && Number.isInteger(llmCalls) && llmCalls >= 0;
        const okIn =
          typeof inT === "number" && Number.isInteger(inT) && inT >= 0;
        const okOut =
          typeof outT === "number" && Number.isInteger(outT) && outT >= 0;
        const okUsd =
          usd === null || (typeof usd === "number" && Number.isFinite(usd) && usd >= 0);
        const okBasis = basis === "estimated-chars/4";
        const okRef =
          ref === null || (typeof ref === "string" && ref.trim().length > 0);
        const consistent =
          (usd === null && ref === null) ||
          (typeof usd === "number" && typeof ref === "string" && ref.trim().length > 0);
        if (okCalls && okIn && okOut && okUsd && okBasis && okRef && consistent) {
          costSummary = {
            llmCalls: llmCalls as number,
            estimatedInputTokens: inT as number,
            estimatedOutputTokens: outT as number,
            estimatedUSD: usd as number | null,
            basis: "estimated-chars/4",
            ratesRef: ref as string | null,
          };
          // T4 (aditivo, restore tolerante): `actual` medido por el server.
          // Inválido/ausente → se omite (forma intacta); nunca rompe.
          try {
            const a = o.actual;
            if (a && typeof a === "object" && !Array.isArray(a)) {
              const ar = a as Record<string, unknown>;
              const num = (v: unknown): number | null =>
                typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
              const aIn = num(ar.inputTokens);
              const aOut = num(ar.outputTokens);
              const aRea = num(ar.reasoningTokens);
              const aCr = num(ar.cacheReadTokens);
              const aCw = num(ar.cacheWriteTokens);
              const aCalls = num(ar.calls);
              const aUsd =
                ar.usd === null || ar.usd === undefined
                  ? null
                  : typeof ar.usd === "number" && Number.isFinite(ar.usd) && ar.usd >= 0
                    ? (ar.usd as number)
                    : undefined;
              const aSrc =
                ar.usdSource === null || ar.usdSource === undefined
                  ? null
                  : ar.usdSource === "server" || ar.usdSource === "rates"
                    ? (ar.usdSource as "server" | "rates")
                    : undefined;
              if (
                aIn !== null &&
                aOut !== null &&
                aRea !== null &&
                aCr !== null &&
                aCw !== null &&
                aCalls !== null &&
                aUsd !== undefined &&
                aSrc !== undefined &&
                !(aUsd !== null && aSrc === null) &&
                ar.basis === "opencode-session"
              ) {
                costSummary = {
                  ...(costSummary as CostSummary),
                  actual: {
                    inputTokens: aIn,
                    outputTokens: aOut,
                    reasoningTokens: aRea,
                    cacheReadTokens: aCr,
                    cacheWriteTokens: aCw,
                    calls: aCalls,
                    usd: aUsd,
                    usdSource: aSrc,
                    basis: "opencode-session",
                  },
                };
              }
            }
          } catch {
            // sin actual: forma intacta
          }
        } else {
          costSummary = undefined;
        }
      } else {
        costSummary = undefined;
      }
    } catch {
      costSummary = undefined;
    }

    // Ola 16 E1 (aditivo, restore tolerante): `agentSessions` opcional.
    // - ausente/inválido → undefined (job viejo, nunca rompe).
    // - objeto parcial con roles conocidos y sids no vacíos → se usa;
    //   entradas desconocidas/vacías se ignoran (tolerante, no throw).
    // - sin entradas válidas → undefined.
    let agentSessions: WorkItem["agentSessions"];
    try {
      const rawSessions = (parsed as Record<string, unknown>).agentSessions;
      if (rawSessions && typeof rawSessions === "object" && !Array.isArray(rawSessions)) {
        const o = rawSessions as Record<string, unknown>;
        const out: Record<string, string> = {};
        for (const role of ["foreman", "triage", "spec", "implement", "review"] as const) {
          const v = o[role];
          if (typeof v === "string" && v.length > 0) out[role] = v;
        }
        agentSessions = (Object.keys(out).length > 0 ? out : undefined) as WorkItem["agentSessions"];
      } else {
        agentSessions = undefined;
      }
    } catch {
      agentSessions = undefined;
    }

    // Hooks declarativos (aditivo, restore tolerante): array de resúmenes
    // validados (nombre/stage/status no vacíos, cap 20); ausente/inválido →
    // undefined (job viejo, nunca rompe).
    let hookRuns: WorkItem["hookRuns"];
    try {
      const rawHr = (parsed as Record<string, unknown>).hookRuns;
      if (Array.isArray(rawHr)) {
        const clean = rawHr
          .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
          .map((r) => {
            const out: Record<string, unknown> = {};
            if (typeof r.name === "string" && r.name.trim()) out.name = r.name.trim().slice(0, 64);
            if (typeof r.stage === "string" && r.stage.trim()) out.stage = r.stage.trim().slice(0, 32);
            if (typeof r.status === "string" && r.status.trim()) out.status = r.status.trim().slice(0, 16);
            if (typeof r.blocking === "boolean") out.blocking = r.blocking;
            if (typeof r.sessionId === "string" && r.sessionId) out.sessionId = r.sessionId.slice(0, 128);
            if (typeof r.at === "string" && r.at) out.at = r.at.slice(0, 64);
            return out;
          })
          .filter((r) => typeof r.name === "string" && typeof r.stage === "string" && typeof r.status === "string")
          .slice(-20);
        if (clean.length > 0) hookRuns = clean as unknown as WorkItem["hookRuns"];
      }
    } catch {
      hookRuns = undefined;
    }

    let logs: string[] = [];
    try {
      const logsPath = path.join(jobDir, "logs.ndjson");
      if (fs.existsSync(logsPath)) {
        const content = fs.readFileSync(logsPath, "utf-8");
        logs = content.split("\n").filter((l) => l.length > 0);
      }
    } catch {}

    // Ola 4: reviewCount + lastReview (con fallback a review.json en disco)
    let reviewCount = 0;
    try {
      const rc = (parsed as Record<string, unknown>).reviewCount;
      if (typeof rc === "number" && Number.isInteger(rc) && rc >= 0) reviewCount = rc;
    } catch {}
    let lastReview: WorkItem["lastReview"];
    try {
      const lr = (parsed as Record<string, unknown>).lastReview as WorkItem["lastReview"];
      if (lr && typeof lr === "object" && typeof (lr as Record<string, unknown>).verdict === "string") {
        lastReview = lr;
      } else {
        const rp = path.join(jobDir, "review.json");
        if (fs.existsSync(rp)) {
          try {
            const rraw = fs.readFileSync(rp, "utf-8");
            const rparsed = JSON.parse(rraw) as WorkItem["lastReview"];
            if (rparsed && typeof (rparsed as Record<string, unknown>).verdict === "string") lastReview = rparsed;
          } catch {}
        }
      }
    } catch {}
    // H-001 (aditivo, restore tolerante): `createdFiles` top-level opcional.
    // Ausente/inválido → undefined (job viejo, nunca rompe); array de strings
    // → se usa (cap 50, espejo del writer).
    let createdFiles: WorkItem["createdFiles"];
    try {
      const rawCf = (parsed as Record<string, unknown>).createdFiles;
      if (Array.isArray(rawCf)) {
        const clean = rawCf.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 50);
        if (clean.length > 0) createdFiles = clean;
      }
    } catch {}
    const item: WorkItem = {
      id,
      prompt,
      worktree,
      phase,
      status,
      state: mapStatusToLegacyState(status),
      createdAt: createdAtRaw as string,
      updatedAt: updatedAtRaw as string,
      timeline,
      cost,
      // Ola 15 E2: solo se incluye si está definido (null incluido).
      ...(costSummary !== undefined ? { costSummary } : {}),
      // Ola 16 E1: solo se incluye si está definido (restore tolerante).
      ...(agentSessions !== undefined ? { agentSessions } : {}),
      // Hooks declarativos: última corrida por hook (validada, cap 20).
      ...(hookRuns !== undefined ? { hookRuns } : {}),
      dir: jobDir,
      dotDonePath,
      runnerId,
      logsNdjsonPath: path.join(jobDir, "logs.ndjson"),
      reviewCount,
      ...(lastReview ? { lastReview } : {}),
      ...(createdFiles ? { createdFiles } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(dashboardUrl ? { dashboardUrl } : {}),
      ...(directory ? { directory } : {}),
      ...(modelRef ? { modelRef } : {}),
      ...(reviewerRef ? { reviewerRef } : {}),
      logs,
    };
    return item;
  } catch (e) {
    console.warn(`[WorkItemDisk] readWorkItemFromDir failed ${jobDir}: ${String(e)}`);
    return null;
  }
}

/**
 * Scan multiple bases for work items and return count restored.
 * Bases include repo/.agents/factory and known tmp locations.
 */
export function scanAndRestoreBases(
  storeMap: Map<string, WorkItem>,
): number {
  const repoRoot = path.resolve(getRepoRootFallback());
  const bases = new Set<string>();
  bases.add(path.join(repoRoot, ".agents", "factory"));
  // factory-lab-test and generic tmp
  bases.add(path.resolve("C:\\tmp\\factory-lab-test\\.agents\\factory"));
  bases.add(path.join(os.tmpdir(), "factory-lab-test", ".agents", "factory"));
  bases.add(path.join(repoRoot, ".worktrees"));
  // Scan C:\tmp and os.tmpdir for playground- dirs
  try {
    const tmpEntries = fs.readdirSync(os.tmpdir(), { withFileTypes: true });
    for (const e of tmpEntries) {
      if (
        e.isDirectory() &&
        (e.name.startsWith("playground-") ||
          e.name.startsWith("factory-lab") ||
          e.name.startsWith("factory-"))
      ) {
        bases.add(path.join(os.tmpdir(), e.name, ".agents", "factory"));
      }
    }
  } catch {}
  try {
    const cTmp = "C:\\tmp";
    if (fs.existsSync(cTmp)) {
      const entries = fs.readdirSync(cTmp, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const cand = path.join(cTmp, e.name, ".agents", "factory");
          try {
            if (fs.existsSync(cand)) bases.add(path.resolve(cand));
          } catch {}
        }
      }
    }
  } catch {}
  // Scan .worktrees
  try {
    const wtBase = path.join(repoRoot, ".worktrees");
    if (fs.existsSync(wtBase)) {
      const entries = fs.readdirSync(wtBase, { withFileTypes: true });
      for (const e of entries)
        if (e.isDirectory())
          bases.add(path.join(wtBase, e.name, ".agents", "factory"));
    }
  } catch {}

  let restored = 0;
  // Perf boot (A3): dirs tmp no-indexados (playgrounds muertos) se saltean
  // acá también — mismo predicado que el loop del cascarón. Nada se borra.
  const indexed = readJobIndexDirs();
  for (const base of bases) {
    try {
      if (!fs.existsSync(base)) continue;
      // base may be .worktrees parent — handle differently
      if (base.endsWith(".worktrees")) continue;
      const jobDirs = fs
        .readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("job-"));
      for (const jd of jobDirs) {
        const jobDir = path.join(base, jd.name);
        if (!shouldRestoreJobDir(jobDir, indexed)) continue;
        if (storeMap.has(jd.name)) continue;
        const item = readWorkItemFromDir(jobDir);
        if (item) {
          storeMap.set(item.id, item);
          restored++;
        }
      }
    } catch {}
  }
  // Also scan .worktrees/*/ .agents/factory
  try {
    const wtBase = path.join(repoRoot, ".worktrees");
    if (fs.existsSync(wtBase)) {
      const entries = fs.readdirSync(wtBase, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const cand = path.join(wtBase, e.name, ".agents", "factory");
        if (!fs.existsSync(cand)) continue;
        const jobDirs = fs
          .readdirSync(cand, { withFileTypes: true })
          .filter((d) => d.isDirectory() && d.name.startsWith("job-"));
        for (const jd of jobDirs) {
          const jobDir = path.join(cand, jd.name);
          if (!shouldRestoreJobDir(jobDir, indexed)) continue;
          if (storeMap.has(jd.name)) continue;
          const item = readWorkItemFromDir(jobDir);
          if (item) {
            storeMap.set(item.id, item);
            restored++;
          }
        }
      }
    }
  } catch {}

  // Índice de job-dirs (P3b): cubre worktrees arbitrarios fuera de las bases
  // fijas. Entradas sin dir en disco se saltan (self-cleaning por omisión).
  try {
    readJobIndexBases().forEach((base) => {
      try {
        if (!fs.existsSync(base)) return;
        const jobDirs = fs
          .readdirSync(base, { withFileTypes: true })
          .filter((d) => d.isDirectory() && d.name.startsWith("job-"));
        jobDirs.forEach((jd) => {
          try {
            if (!shouldRestoreJobDir(path.join(base, jd.name), indexed)) return;
            if (storeMap.has(jd.name)) return;
            const item = readWorkItemFromDir(path.join(base, jd.name));
            if (item) {
              storeMap.set(item.id, item);
              restored++;
            }
          } catch {}
        });
      } catch {}
    });
  } catch {}

  return restored;
}

// ── Índice de job-dirs (P3b: worktrees arbitrarios) ──

/**
 * Nombre del índice junto al resto del estado factory.
 * Vive en `<factoryDir>/.job-index.json` donde factoryDir es
 * `TERMCANVAS_FACTORY_DIR` (los tests lo apuntan a tmp) o `<repo>/factory`.
 */
export const JOB_INDEX_FILE = ".job-index.json";

/** Tope de entradas del índice (FIFO por fecha: lo viejo sale primero). */
export const JOB_INDEX_MAX_ENTRIES = 500;

function resolveJobIndexPath(): string | null {
  try {
    const override =
      typeof process.env.TERMCANVAS_FACTORY_DIR === "string" && process.env.TERMCANVAS_FACTORY_DIR.trim().length > 0
        ? process.env.TERMCANVAS_FACTORY_DIR.trim()
        : null;
    const factoryDir = override ?? path.join(getRepoRootFallback(), "factory");
    return path.join(factoryDir, JOB_INDEX_FILE);
  } catch {
    return null;
  }
}

interface JobIndexEntry {
  id: string;
  dir: string;
  at: string;
}

function readJobIndexEntries(): JobIndexEntry[] {
  try {
    const indexPath = resolveJobIndexPath();
    if (!indexPath || !fs.existsSync(indexPath)) return [];
    const parsed: unknown = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const list = (parsed as Record<string, unknown>).jobs;
    if (!Array.isArray(list)) return [];
    return (list as unknown[]).filter(
      (e): e is JobIndexEntry =>
        !!e &&
        typeof e === "object" &&
        !Array.isArray(e) &&
        typeof (e as Record<string, unknown>).id === "string" &&
        typeof (e as Record<string, unknown>).dir === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Dirs del índice normalizados (para el filtro de restore A3). Nunca lanza.
 */
export function readJobIndexDirs(): Set<string> {
  const out = new Set<string>();
  try {
    readJobIndexEntries().forEach((e) => {
      try {
        if (typeof e.dir === "string" && e.dir.length > 0) {
          out.add(path.resolve(e.dir).toLowerCase());
        }
      } catch {}
    });
  } catch {}
  return out;
}

/**
 * Perf boot (A3): ¿se restaura este job-dir? Los dirs bajo os.tmpdir() o
 * `C:\tmp` que NO están en el índice son playgrounds muertos de tests
 * (cientos de `playground-*` con job.json que igual se parseaban +
 * migraban + logueaban por boot). Se saltean salvo override
 * `RESTORE_TMP_FULL=1`. Repo/`.worktrees`/index siempre restauran. Nada se
 * borra: el job.json queda en disco. Nunca lanza (ante duda, restaura).
 */
export function shouldRestoreJobDir(
  jobDir: unknown,
  indexedDirs: Set<string> | unknown,
): boolean {
  try {
    if (typeof jobDir !== "string" || jobDir.length === 0) return false;
    if (process.env.RESTORE_TMP_FULL === "1") return true;
    const norm = path.resolve(jobDir).toLowerCase();
    const repo = path.resolve(getRepoRootFallback()).toLowerCase();
    if (norm === repo || norm.startsWith(repo + path.sep)) return true;
    const tmpRoot = path.resolve(os.tmpdir()).toLowerCase();
    const cTmp = `c:${path.sep}tmp`;
    const underTmp =
      norm.startsWith(tmpRoot + path.sep) ||
      norm.startsWith(cTmp + path.sep) ||
      norm === cTmp;
    if (!underTmp) return true;
    if (indexedDirs instanceof Set && indexedDirs.has(norm)) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Resuelve el job-dir de un id vía el índice (solo dirs existentes en
 * disco). Para el fallback de lectura de `get()` cuando el item salió de
 * memoria por retención (C1): el detalle de jobs viejos sigue 200 honesto
 * sin mantenerlos a todos en RAM. Nunca lanza.
 */
export function resolveJobDir(id: string): string | null {
  try {
    if (typeof id !== "string" || id.length === 0) return null;
    const found = readJobIndexEntries().find((e) => e.id === id) ?? null;
    if (!found || typeof found.dir !== "string" || found.dir.length === 0) {
      return null;
    }
    return fs.existsSync(found.dir) ? found.dir : null;
  } catch {
    return null;
  }
}

/**
 * Registra el job-dir en el índice (upsert por id, FIFO acotado, tmp+rename).
 * Best-effort: el restore salta entradas sin dir en disco. Nunca lanza.
 */
export function recordJobDirInIndex(id: string, dir: string): void {
  try {
    if (typeof id !== "string" || id.length === 0) return;
    if (typeof dir !== "string" || dir.length === 0) return;
    const indexPath = resolveJobIndexPath();
    if (!indexPath) return;
    const at = new Date().toISOString();
    const kept = readJobIndexEntries().filter((e) => e.id !== id);
    kept.push({ id, dir, at });
    const capped =
      kept.length > JOB_INDEX_MAX_ENTRIES ? kept.slice(kept.length - JOB_INDEX_MAX_ENTRIES) : kept;
    try {
      fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    } catch {}
    const tmp = `${indexPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, jobs: capped }, null, 2), "utf-8");
    fs.renameSync(tmp, indexPath);
  } catch {}
}

/**
 * Saca el job-dir del índice (teardown del discard: sin entrada no hay
 * base fantasma; el restore además salta dirs sin job.json). Nunca lanza.
 */
export function removeJobDirFromIndex(id: string): void {
  try {
    if (typeof id !== "string" || id.length === 0) return;
    const indexPath = resolveJobIndexPath();
    if (!indexPath || !fs.existsSync(indexPath)) return;
    const kept = readJobIndexEntries().filter((e) => e.id !== id);
    const tmp = `${indexPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, jobs: kept }, null, 2), "utf-8");
    fs.renameSync(tmp, indexPath);
  } catch {}
}

/**
 * Bases (`.../.agents/factory`) derivadas del índice, solo las que existen
 * en disco. El restore las suma a sus bases fijas: así cubre worktrees
 * arbitrarios fuera de los paths escaneados. Nunca lanza.
 */
export function readJobIndexBases(): string[] {
  try {
    const out: string[] = [];
    const seen = new Set<string>();
    readJobIndexEntries().forEach((e) => {
      try {
        const base = path.dirname(e.dir);
        if (!base || seen.has(base)) return;
        seen.add(base);
        if (fs.existsSync(base)) out.push(base);
      } catch {}
    });
    return out;
  } catch {
    return [];
  }
}
