/**
 * Helpers to resolve report paths for the playground.
 * Reports live under docs/wiki Warp/ with a space — all helpers
 * return a human-readable path and a file: URL hint for traceability.
 * The actual existence check is best-effort (renderer has no direct fs);
 * we expose the expected path so the UI can show "pending" vs "exists".
 * Also hosts the traceability sync to the markdown file (best-effort via
 * window.termcanvas.fs when running in Electron).
 */

import { PLAYGROUND_FS } from "./playgroundData";
import type { PlaygroundVerdict, PlaygroundVerdictEntry, CriterionSnapshot } from "../../stores/playgroundStore";

export function getReportPath(fId: string): string | null {
  const entry = PLAYGROUND_FS.find((f) => f.id === fId);
  return entry ? entry.reportPath : null;
}

export function getReportDisplayPath(fId: string): string {
  return getReportPath(fId) ?? `docs/wiki Warp/reporte-${fId.toLowerCase()}-*.md (desconocido)`;
}

export function getReportSummary(): { total: number; paths: string[] } {
  return {
    total: PLAYGROUND_FS.length,
    paths: PLAYGROUND_FS.map((f) => f.reportPath),
  };
}

// ── Traceability ──

const TRACE_MARKER = "## Trazabilidad";

function formatDateLocale(ts: number): string {
  return new Date(ts).toLocaleString("es-AR", { hour12: false });
}

function formatIso(ts: number): string {
  return new Date(ts).toISOString().slice(0, 19).replace("T", " ");
}

function escapeNotes(notes: string): string {
  const raw = notes.trim();
  if (!raw) return "—";
  return raw.replace(/"/g, '\\"').replace(/\n/g, " ").slice(0, 800);
}

function formatRawOutputBlock(rawOutput?: string): string[] {
  if (!rawOutput || !rawOutput.trim()) return [];
  const trimmed = rawOutput.trim().slice(0, 2000);
  // Indent as blockquote code fence
  const lines = trimmed.split("\n").slice(0, 30);
  const out: string[] = [];
  out.push("> Output crudo:");
  out.push("> ```");
  for (const l of lines) out.push(`> ${l}`);
  out.push("> ```");
  return out;
}

function formatCriterionSnapshot(snap?: CriterionSnapshot): string[] {
  if (!snap) return [];
  const out: string[] = [];
  out.push(`> Criterio snapshot: "${escapeNotes(snap.criterio).slice(0, 300)}"`);
  out.push(`> timeoutMs: ${snap.timeoutMs}`);
  return out;
}

function buildTraceabilityBlock(fId: string, verdict: PlaygroundVerdict): string {
  const statusUpper = verdict.status.toUpperCase();
  const dateLocale = formatDateLocale(verdict.updatedAt);
  const iso = formatIso(verdict.updatedAt);
  const safeNotes = escapeNotes(verdict.notes);
  const quotedNotes = verdict.notes.trim() ? `"${safeNotes}"` : "—";
  return [
    "## Trazabilidad — Veredictos del tester",
    "",
    `> Último veredicto: **${statusUpper}** — ${dateLocale}`,
    `> Notas: ${quotedNotes}`,
    "> Tester: humano (localStorage)",
    "> Historial:",
    `> - ${iso} — ${statusUpper} — ${quotedNotes}`,
    "",
  ].join("\n");
}

function buildTraceabilityBlockFromHistory(fId: string, history: PlaygroundVerdictEntry[]): string {
  if (history.length === 0) {
    return ["## Trazabilidad — Veredictos del tester", "", "> Sin veredictos aún.", ""].join("\n");
  }
  const latest = history[history.length - 1];
  const latestUpper = latest.status.toUpperCase();
  const latestLocale = formatDateLocale(latest.updatedAt);
  const latestSafe = escapeNotes(latest.notes);
  const latestQuoted = latest.notes.trim() ? `"${latestSafe}"` : "—";
  const latestHash = latest.codeHash ? ` — Commit: \`${latest.codeHash.slice(0, 7)}\`` : "";
  const latestBy = latest.testedBy ? ` — Probar: ${latest.testedBy}` : " — Probar: humano";
  const lines: string[] = [];
  lines.push("## Trazabilidad — Veredictos del tester");
  lines.push("");
  lines.push(`> Último veredicto: **${latestUpper}** — ${latestLocale} — v${latest.version}${latestHash}${latestBy}`);
  lines.push(`> Notas: ${latestQuoted}`);
  if (latest.rawOutput) {
    lines.push(...formatRawOutputBlock(latest.rawOutput));
    lines.push(`> Veredicto: ${latestQuoted}`);
  }
  if (latest.criterionSnapshot) {
    lines.push(...formatCriterionSnapshot(latest.criterionSnapshot));
  }
  lines.push(`> Tester: ${latest.testedBy ?? "humano"} (localStorage)${latestHash}`);
  lines.push("> Historial:");
  for (const e of history) {
    const iso = formatIso(e.updatedAt);
    const safe = escapeNotes(e.notes);
    const quoted = e.notes.trim() ? `"${safe}"` : "—";
    const upper = e.status.toUpperCase();
    const hash = e.codeHash ? ` — \`${e.codeHash.slice(0, 7)}\`` : "";
    const by = e.testedBy ? ` [${e.testedBy}]` : "";
    const snapTag = e.criterionSnapshot ? ` — criterio: "${escapeNotes(e.criterionSnapshot.criterio).slice(0, 60)}…"` : "";
    lines.push(`> - v${e.version} — ${iso} — ${upper}${hash}${by} — ${quoted}${snapTag}`);
    if (e.rawOutput) {
      const firstLine = e.rawOutput.trim().split("\n")[0]?.slice(0, 120) ?? "";
      lines.push(`>   Output crudo: \`${firstLine.replace(/`/g, "'")}\``);
    }
    // Show diff if criterio changed from previous version
    const idx = history.indexOf(e);
    if (idx > 0) {
      const prevSnap = history[idx - 1].criterionSnapshot;
      const curSnap = e.criterionSnapshot;
      if (prevSnap && curSnap && prevSnap.criterio !== curSnap.criterio) {
        lines.push(`>   ⚠️ Criterio cambió entre v${history[idx - 1].version} y v${e.version}`);
        lines.push(`>   - antes: "${escapeNotes(prevSnap.criterio).slice(0, 80)}"`);
        lines.push(`>   - ahora: "${escapeNotes(curSnap.criterio).slice(0, 80)}"`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

type FsApi = {
  readFile: (path: string) => Promise<{ type: string; content: string } | { error: string; size?: string }>;
  writeFile: (path: string, content: string) => Promise<{ changed: boolean }>;
};

function getFs(): FsApi | null {
  try {
    if (typeof window === "undefined") return null;
    const tc = (window as unknown as { termcanvas?: { fs?: FsApi } }).termcanvas;
    if (!tc?.fs?.readFile || !tc?.fs?.writeFile) return null;
    return tc.fs;
  } catch {
    return null;
  }
}

function normalizeHistory(
  verdict: PlaygroundVerdict | PlaygroundVerdictEntry | PlaygroundVerdictEntry[]
): PlaygroundVerdictEntry[] {
  if (Array.isArray(verdict)) {
    return verdict.map((e, idx) => ({
      status: e.status,
      notes: e.notes ?? "",
      updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : Date.now(),
      version: typeof e.version === "number" ? e.version : idx + 1,
      rawOutput: typeof e.rawOutput === "string" ? e.rawOutput : undefined,
      criterionSnapshot: (e as unknown as { criterionSnapshot?: CriterionSnapshot }).criterionSnapshot,
      codeHash: typeof e.codeHash === "string" ? e.codeHash : undefined,
      testedBy: (e as unknown as { testedBy?: "humano" | "script" }).testedBy,
      humanVerdict: typeof (e as unknown as { humanVerdict?: string }).humanVerdict === "string" ? (e as unknown as { humanVerdict?: string }).humanVerdict : undefined,
    }));
  }
  const v = verdict as PlaygroundVerdictEntry;
  if (typeof v.version === "number" && typeof v.updatedAt === "number") {
    return [v as PlaygroundVerdictEntry];
  }
  const legacy = verdict as PlaygroundVerdict;
  return [{ status: legacy.status, notes: legacy.notes ?? "", updatedAt: legacy.updatedAt ?? Date.now(), version: 1 }];
}

/**
 * Best-effort helper to obtain git commit hash (7 chars) for traceability.
 * Tries multiple strategies, never throws, falls back to "unknown".
 */
export async function getCodeHash(): Promise<string> {
  try {
    if (typeof window !== "undefined") {
      const tc = (window as unknown as {
        termcanvas?: {
          git?: { log?: (path: string, n: number) => Promise<unknown> };
          fs?: FsApi;
        };
      }).termcanvas;
      // Strategy 1: window.termcanvas.git.log
      if (tc?.git?.log) {
        try {
          const res = (await tc.git.log(".", 1)) as unknown;
          if (Array.isArray(res) && res.length > 0) {
            const first = res[0] as Record<string, unknown>;
            const h = (first.hash ?? first.oid ?? first.commit ?? "") as string;
            if (h && typeof h === "string" && h.length >= 7) return h.slice(0, 7);
          }
          if (typeof res === "string" && res.length >= 7) return res.slice(0, 7);
          if (res && typeof res === "object" && "hash" in (res as Record<string, unknown>)) {
            const h = String((res as Record<string, unknown>).hash);
            if (h.length >= 7) return h.slice(0, 7);
          }
        } catch {}
      }
      // Strategy 2: fetch /api/git/commit if exposed
      try {
        const ac = new AbortController();
        const t = window.setTimeout(() => ac.abort(), 800);
        const resp = await fetch("/api/git/commit", { signal: ac.signal });
        window.clearTimeout(t);
        if (resp.ok) {
          const j = (await resp.json()) as Record<string, unknown>;
          const h = (j.hash ?? j.commit ?? j.oid ?? "") as string;
          if (h && typeof h === "string" && h.length >= 7) return h.slice(0, 7);
        }
      } catch {}
      // Strategy 3: read .git/HEAD and then ref file (best-effort via fs)
      if (tc?.fs?.readFile) {
        try {
          const head = await tc.fs.readFile(".git/HEAD");
          if (head && "content" in head && typeof head.content === "string") {
            const content = head.content.trim();
            if (/^[0-9a-f]{40}$/i.test(content)) return content.slice(0, 7);
            const m = content.match(/^ref:\s*(.+)$/);
            if (m) {
              const refPath = `.git/${m[1]}`;
              try {
                const refContent = await tc.fs.readFile(refPath);
                if (refContent && "content" in refContent && typeof refContent.content === "string") {
                  const h = refContent.content.trim();
                  if (/^[0-9a-f]{40}$/i.test(h)) return h.slice(0, 7);
                }
              } catch {}
            }
          }
        } catch {}
      }
    }
  } catch {}
  return "unknown";
}

export async function syncVerdictToReportMd(
  fId: string,
  verdict: PlaygroundVerdict | PlaygroundVerdictEntry | PlaygroundVerdictEntry[]
): Promise<{ ok: boolean; reason?: string }> {
  const fs = getFs();
  if (!fs) {
    console.warn("[playgroundReports] syncVerdictToReportMd: FS not available (web mode), skipping md write for", fId);
    return { ok: false, reason: "no_fs" };
  }

  const reportPath = getReportPath(fId);
  if (!reportPath) {
    console.warn("[playgroundReports] syncVerdictToReportMd: unknown report path for", fId);
    return { ok: false, reason: "no_path" };
  }

  try {
    let existingContent = "";
    let hadFile = false;

    try {
      const readResult = await fs.readFile(reportPath);
      if ("content" in readResult && typeof readResult.content === "string") {
        existingContent = readResult.content;
        hadFile = true;
      } else if ("error" in readResult) {
        hadFile = false;
        existingContent = "";
      }
    } catch (readErr) {
      console.warn("[playgroundReports] readFile failed for", reportPath, readErr);
      hadFile = false;
      existingContent = "";
    }

    const history = normalizeHistory(verdict);
    const block =
      history.length === 1 && (history[0] as PlaygroundVerdictEntry).version === 1 && !Array.isArray(verdict)
        ? buildTraceabilityBlock(fId, history[0])
        : buildTraceabilityBlockFromHistory(fId, history);

    const finalBlock = history.length > 1 ? buildTraceabilityBlockFromHistory(fId, history) : buildTraceabilityBlockFromHistory(fId, history);

    let newContent: string;

    if (hadFile && existingContent.includes(TRACE_MARKER)) {
      const idx = existingContent.indexOf(TRACE_MARKER);
      const before = existingContent.slice(0, idx).trimEnd();
      newContent = before + "\n\n" + finalBlock + "\n";
    } else if (hadFile && existingContent.trim().length > 0) {
      newContent = existingContent.trimEnd() + "\n\n" + finalBlock + "\n";
    } else {
      const titleMap: Record<string, string> = {
        F01: "F01 — Servidor único + health",
        F02: "F02 — Job en disco",
        F03: "F03 — Worker + logs vivos (SSE)",
        F04: "F04 — Panel Factory + Implementar sin terminal",
        F05: "F05 — Planning/Tools vía Factory + gate",
      };
      const title = titleMap[fId] ?? fId;
      newContent = `# Reporte ${title}\n\n${finalBlock}\n`;
    }

    void block;

    await fs.writeFile(reportPath, newContent);
    return { ok: true };
  } catch (err) {
    console.warn("[playgroundReports] syncVerdictToReportMd: write failed for", reportPath, err);
    return { ok: false, reason: "write_failed" };
  }
}

export function _buildBlockForTest(fId: string, history: PlaygroundVerdictEntry[]): string {
  return buildTraceabilityBlockFromHistory(fId, history);
}
