#!/usr/bin/env tsx
/**
 * GC — garbage collector for playground artifacts
 *
 * Limpia:
 *  - C:\tmp\playground-F* >7d (os.tmpdir() + subdirs matching /^playground-F\d{2}-/)
 *  - .agents/factory/playground-* >7d (repo .agents y tmp worktrees)
 *  - verdicts archive >50 por F (mantiene 50 más nuevos, archiva resto a .archive/)
 *
 * Uso PowerShell:
 *   pnpm p:gc --dry-run          # muestra qué borraría, no borra
 *   pnpm p:gc                    # borra realmente
 *   pnpm playground:gc --dry-run # alias
 *   node --loader tsx software-testing-playground-v2/pact/support/gc.ts --dry-run
 *   tsx software-testing-playground-v2/pact/support/gc.ts --days 3 --dry-run
 *
 * Windows only — usa os.tmpdir() (C:\Users\...\AppData\Local\Temp) y path.resolve(".agents")
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
const VERDICTS_KEEP = 50;

interface GcOptions {
  dryRun: boolean;
  days: number;
  verbose: boolean;
}

function parseArgs(): GcOptions {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("--dryRun");
  const verbose = args.includes("--verbose") || args.includes("-v");
  let days = DEFAULT_DAYS;
  const daysIdx = args.findIndex((a) => a === "--days" || a === "-d");
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    const v = Number(args[daysIdx + 1]);
    if (Number.isInteger(v) && v >= 0) days = v;
  }
  const daysEq = args.find((a) => a.startsWith("--days="));
  if (daysEq) {
    const v = Number(daysEq.split("=")[1]);
    if (Number.isInteger(v) && v >= 0) days = v;
  }
  return { dryRun, days, verbose };
}

function log(msg: string): void {
  console.log(`[gc] ${msg}`);
}
function logDry(msg: string, dryRun: boolean): void {
  if (dryRun) console.log(`[gc][dry-run] WOULD DELETE: ${msg}`);
  else console.log(`[gc] DELETED: ${msg}`);
}

function isOlderThan(filePath: string, cutoffMs: number): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtimeMs < cutoffMs;
  } catch {
    return false;
  }
}

function rmRecursive(target: string, dryRun: boolean): boolean {
  if (dryRun) return true;
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch (e) {
    console.warn(`[gc] Failed to delete ${target}: ${String(e)}`);
    return false;
  }
}

function scanAndCleanTmp(playgroundTmpPattern: RegExp, cutoffMs: number, opts: GcOptions): { scanned: number; deleted: number; wouldDelete: number } {
  let scanned = 0;
  let deleted = 0;
  let wouldDelete = 0;

  const candidates: string[] = [];

  // 1. os.tmpdir() — C:\Users\...\AppData\Local\Temp
  const tmpRoot = os.tmpdir();
  try {
    const entries = fs.readdirSync(tmpRoot, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && playgroundTmpPattern.test(e.name)) {
        candidates.push(path.join(tmpRoot, e.name));
      }
    }
  } catch {}

  // 2. C:\tmp fallback (Windows common)
  const cTmp = "C:\\tmp";
  if (fs.existsSync(cTmp)) {
    try {
      const entries = fs.readdirSync(cTmp, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && playgroundTmpPattern.test(e.name)) {
          candidates.push(path.join(cTmp, e.name));
        }
      }
    } catch {}
  }

  // 3. .agents/factory/playground-* relative to repo root and also under each tmp worktree
  // Repo .agents
  const repoAgentsFactory = path.resolve(".agents/factory");
  if (fs.existsSync(repoAgentsFactory)) {
    try {
      const entries = fs.readdirSync(repoAgentsFactory, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && (e.name.startsWith("playground-") || playgroundTmpPattern.test(e.name) || e.name.startsWith("job-"))) {
          const full = path.join(repoAgentsFactory, e.name);
          // Only consider playground-prefixed dirs for gc, but also job-* older than cutoff if parent is playground?
          // For GC, we check if dir name starts with playground- or job- and is older
          candidates.push(full);
        }
      }
    } catch {}
  }
  // Also .agents/factory under C:\Users\...\ .termcanvas?
  // Skip for now.

  // Deduplicate
  const unique = [...new Set(candidates)];

  for (const dir of unique) {
    scanned++;
    const older = isOlderThan(dir, cutoffMs);
    if (older) {
      if (opts.dryRun) {
        wouldDelete++;
        logDry(dir, true);
      } else {
        const ok = rmRecursive(dir, false);
        if (ok) {
          deleted++;
          console.log(`[gc] DELETED dir >${opts.days}d: ${dir}`);
        }
      }
    } else if (opts.verbose) {
      log(`keep (recent ≤${opts.days}d): ${dir}`);
    }
  }

  // Also scan inside each candidate for nested .agents/factory/playground-* older than cutoff
  // e.g., C:\tmp\playground-F02-abc\.agents\factory\job-xxx (these are job dirs, not playground dirs themselves)
  // For GC we treat job dirs inside playground worktrees as part of worktree deletion above, already covered.

  return { scanned, deleted, wouldDelete };
}

function cleanVerdicts(opts: GcOptions): { scanned: number; archived: number; wouldArchive: number } {
  let scanned = 0;
  let archived = 0;
  let wouldArchive = 0;

  const verdictsBase = path.resolve("software-testing-playground-v2/verdicts");
  if (!fs.existsSync(verdictsBase)) return { scanned: 0, archived: 0, wouldArchive: 0 };

  const featureIds = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09", "F10", "F11", "F12", "F13", "F14"];

  for (const fid of featureIds) {
    const dir = path.join(verdictsBase, fid);
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f));

    scanned += files.length;

    if (files.length <= VERDICTS_KEEP) {
      if (opts.verbose) log(`verdicts ${fid}: ${files.length} ≤${VERDICTS_KEEP}, keep all`);
      continue;
    }

    // Sort newest first by mtime or finishedAt
    const withTime = files.map((full) => {
      let t = 0;
      try {
        const raw = JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
        t = raw.finishedAt ? Date.parse(raw.finishedAt as string) : fs.statSync(full).mtimeMs;
      } catch {
        try {
          t = fs.statSync(full).mtimeMs;
        } catch {
          t = 0;
        }
      }
      return { full, t };
    });
    withTime.sort((a, b) => b.t - a.t);

    const toArchive = withTime.slice(VERDICTS_KEEP);
    const archiveDir = path.join(dir, ".archive");
    if (!opts.dryRun) {
      try {
        fs.mkdirSync(archiveDir, { recursive: true });
      } catch {}
    }

    for (const { full, t } of toArchive) {
      const base = path.basename(full);
      const dest = path.join(archiveDir, base);
      const age = new Date(t).toISOString();
      if (opts.dryRun) {
        wouldArchive++;
        logDry(`${fid}/${base} (age ${age}) → ${fid}/.archive/${base}`, true);
      } else {
        try {
          // Move to archive (rename); if cross-device, copy+unlink
          try {
            fs.renameSync(full, dest);
          } catch {
            fs.copyFileSync(full, dest);
            fs.unlinkSync(full);
          }
          archived++;
          if (opts.verbose) log(`archived ${fid}/${base} → .archive/`);
          else console.log(`[gc] ARCHIVED verdict ${fid}/${base} (keep ${VERDICTS_KEEP} newest)`);
        } catch (e) {
          console.warn(`[gc] Failed to archive ${full}: ${String(e)}`);
        }
      }
    }
  }

  return { scanned, archived, wouldArchive };
}

function main(): void {
  const opts = parseArgs();
  const cutoffMs = Date.now() - opts.days * MS_PER_DAY;

  console.log(`[gc] Playground GC — tmp playground dirs >${opts.days}d + .agents/factory + verdicts >${VERDICTS_KEEP} — dryRun=${opts.dryRun}`);
  console.log(`[gc] Cutoff: ${new Date(cutoffMs).toISOString()} (now ${new Date().toISOString()})`);
  console.log(`[gc] os.tmpdir(): ${os.tmpdir()}`);
  console.log(`[gc] Verdicts base: ${path.resolve("software-testing-playground-v2/verdicts")}`);

  const playgroundPattern = /^playground[ -]F\d{2}/;

  const tmpRes = scanAndCleanTmp(playgroundPattern, cutoffMs, opts);
  console.log(`[gc] Tmp scan: scanned=${tmpRes.scanned} deleted=${tmpRes.deleted} wouldDelete=${tmpRes.wouldDelete}`);

  const verdictRes = cleanVerdicts(opts);
  console.log(
    `[gc] Verdicts: scanned=${verdictRes.scanned} archived=${verdictRes.archived} wouldArchive=${verdictRes.wouldArchive} (keep ${VERDICTS_KEEP} per F)`,
  );

  // Summary
  if (opts.dryRun) {
    console.log(`[gc] DRY-RUN PASS — would delete ${tmpRes.wouldDelete} tmp dirs and archive ${verdictRes.wouldArchive} verdicts`);
    console.log(`[gc] Run without --dry-run to actually clean. PowerShell: pnpm p:gc`);
  } else {
    console.log(`[gc] GC DONE — deleted ${tmpRes.deleted} tmp dirs, archived ${verdictRes.archived} verdicts`);
  }

  // Also regenerate state.json after gc (best-effort) — skipped here, will regen on next p:verify/p:consumer
  log("state.json — will be regenerated on next p:verify/p:consumer (verdicts changed)");

  process.exit(0);
}

// ESM entry check
const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].replace(/\\/g, "/").endsWith("gc.ts") ||
    process.argv[1].replace(/\\/g, "/").endsWith("gc.js") ||
    process.argv[1].replace(/\\/g, "/").endsWith("gc.mjs"));

if (isDirect) {
  main();
}

export { parseArgs as parseGcArgs };
export type { GcOptions };
