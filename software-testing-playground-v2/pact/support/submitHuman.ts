#!/usr/bin/env tsx
/**
 * submitHuman.ts — submitHumanVerdict desde PowerShell/CLI sin abrir la UI
 *
 * Envuélve el mismo handler de electron/playground-ipc.ts:playground:submitHumanVerdict
 * pero como script Node directo (sin Electron), usando pactVerdictStore.writePactVerdict.
 *
 * Uso PowerShell (sin UI):
 *   pnpm human:submit -- --feature F05 --conclusion pass --checklist "gate fail fast,2x POST diag+tools,cero PTY" --evidence "C:\tmp\playground-F05\job.json + logs 12 líneas" --notes "validado en PowerShell"
 *   npx tsx software-testing-playground-v2/pact/support/submitHuman.ts --feature F03 --conclusion pass --checklist "tail vivo 5 líneas,cancel sin PTY" --evidence "curl.exe SSE 7 data: + event:done"
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writePactVerdict } from "./pactVerdictStore.js";
import { getCommitSha, isDirty } from "./git.js";
import { derivePactStatus } from "./pactState.js";

function printHelp(): void {
  console.log(`
submitHuman.ts — submitHumanVerdict desde CLI (sin UI) — UTF-8

Uso:
  npx tsx software-testing-playground-v2/pact/support/submitHuman.ts --feature F05 --conclusion pass --checklist "a,b,c" --evidence "evidencia ≥10 chars" [--notes "..."] [--reason "..."] [--auto]
  pnpm human:submit -- --feature F05 --conclusion pass --checklist "a,b,c" --evidence "path..." --auto

Flags:
  --feature Fxx            requerido: F01..F99 (ej F05, F06, F07)
  --conclusion pass|fail   requerido
  --checklist "a,b,c"      requerido: mínimo 1 item, comma-separated
  --evidence "texto"       requerido: mínimo 10 chars (path, job.json, logs, URL) — tu declaración humana
  --notes "texto"          opcional: notas libres
  --reason "texto"         opcional: motivo si fail
  --auto                   opcional: además de guardar tu evidencia, intenta verificar contra Factory real (health + logs/SSE) y guarda el output real separado — cruza tu declaración vs sistema

Ejemplos PowerShell (UTF-8):
  # IMPORTANTE en Windows: antes de ver JSON con tildes → chcp 65001 o usá Get-Content -Encoding UTF8
  # chcp 65001; Get-Content software-testing-playground-v2\\verdicts\\F05\\*.json -Encoding UTF8 | ConvertFrom-Json | ConvertTo-Json -Depth 8

  npx tsx software-testing-playground-v2/pact/support/submitHuman.ts --feature F05 --conclusion pass --checklist "gate valid→201,gate gpt-99→400,2x POST sin PTY" --evidence "Invoke-RestMethod POST valid 201 + invalid 400 en C:\\tmp\\playground-F05" --auto

  npx tsx software-testing-playground-v2/pact/support/submitHuman.ts --feature F03 --conclusion pass --checklist "tail vivo 5 líneas,done+result.json" --evidence "curl.exe --silent -H Accept:text/event-stream http://127.0.0.1:17680/factory/jobs/job-abc123/events --max-time 4 -> 7 data: + event:done" --auto

  npx tsx software-testing-playground-v2/pact/support/submitHuman.ts --feature F05 --conclusion fail --checklist "gate fail fast" --evidence "Get-Content logs.ndjson 0 líneas, falta .done" --reason "timeout 5s"

Ver (siempre con -Encoding UTF8 en PowerShell 5.1):
  Get-Content software-testing-playground-v2\\verdicts\\F05\\*.json -Encoding UTF8 | Select-Object -Last 1 | Get-Content -Encoding UTF8 | ConvertFrom-Json | ConvertTo-Json -Depth 8
  Get-Content software-testing-playground-v2\\state.json -Encoding UTF8 | ConvertFrom-Json | ConvertTo-Json -Depth 8
`);
}

function parseArgs(argv: string[]): { feature?: string; conclusion?: string; checklistRaw?: string; evidence?: string; notes: string; reason: string; auto: boolean } {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h") || args.includes("/?")) {
    printHelp();
    process.exit(0);
  }
  const get = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    const pref = `${name}=`;
    const hit = args.find((a) => a.startsWith(pref));
    if (hit) return hit.slice(pref.length);
    return undefined;
  };
  return {
    feature: get("--feature"),
    conclusion: get("--conclusion"),
    checklistRaw: get("--checklist"),
    evidence: get("--evidence"),
    notes: get("--notes") ?? "",
    reason: get("--reason") ?? "",
    auto: args.includes("--auto"),
  };
}

async function collectAutoProviderOutput(featureId: string, providerBaseUrl: string | null): Promise<{ realOutput: string; success: boolean; details: string }> {
  if (!providerBaseUrl) return { realOutput: "auto: no hay Factory (providerBaseUrl null) — no se pudo verificar contra sistema real. Tu evidence queda como única fuente.", success: false, details: "no_factory" };
  const lines: string[] = [];
  let success = true;
  // 1) Health siempre
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(`${providerBaseUrl}/factory/health`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    const text = await res.text();
    lines.push(`GET /factory/health → ${res.status} ${text.slice(0, 400)}`);
    if (!res.ok) success = false;
  } catch (e) {
    lines.push(`GET /factory/health → ERROR ${String(e).slice(0, 200)}`);
    success = false;
  }
  // 2) Por feature: intenta endpoint relevante
  try {
    if (featureId === "F03") {
      // Intenta listar jobs y luego logs/SSE del primero
      const listRes = await fetch(`${providerBaseUrl}/factory/jobs`, { headers: { Accept: "application/json" } });
      const listText = await listRes.text();
      lines.push(`GET /factory/jobs → ${listRes.status} ${listText.slice(0, 500)}`);
      if (listRes.ok) {
        const data = JSON.parse(listText) as { jobs?: Array<{ id: string }> };
        const firstId = data.jobs?.[0]?.id ?? "job-abc123";
        // Intenta GET logs
        try {
          const logsRes = await fetch(`${providerBaseUrl}/factory/jobs/${firstId}/logs`, { headers: { Accept: "application/json" } });
          const logsText = await logsRes.text();
          lines.push(`GET /factory/jobs/${firstId}/logs → ${logsRes.status} ${logsText.slice(0, 600)}`);
        } catch (e) {
          lines.push(`GET /logs ERROR ${String(e).slice(0, 200)}`);
        }
        // Intenta SSE handshake (no stream completo, solo headers)
        try {
          const ctrl2 = new AbortController();
          const t2 = setTimeout(() => ctrl2.abort(), 1500);
          const sseRes = await fetch(`${providerBaseUrl}/factory/jobs/${firstId}/events`, { headers: { Accept: "text/event-stream" }, signal: ctrl2.signal });
          clearTimeout(t2);
          const ct = sseRes.headers.get("content-type") ?? "";
          lines.push(`GET /factory/jobs/${firstId}/events → ${sseRes.status} Content-Type: ${ct}`);
          try { await sseRes.body?.cancel(); } catch {}
          if (!ct.includes("text/event-stream")) success = false;
        } catch (e) {
          lines.push(`GET /events ERROR ${String(e).slice(0, 200)}`);
          success = false;
        }
      }
    } else if (featureId === "F05") {
      // Gate: intenta POST valid e invalid (sin crear ruido, worktree tmp)
      const tmpBase = `C:\\tmp\\playground-auto-${featureId.toLowerCase()}`;
      try {
        const validBody = JSON.stringify({ prompt: `auto-${Date.now()}`, worktree: `${tmpBase}-valid`, phase: "diagnosisLlm", modelRef: { providerID: "openai", modelID: "gpt-4o", variant: "default" }, cli: "claude" });
        const validRes = await fetch(`${providerBaseUrl}/factory/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: validBody });
        const validText = await validRes.text();
        lines.push(`POST /factory/jobs gpt-4o → ${validRes.status} ${validText.slice(0, 400)}`);
        if (validRes.status !== 201) success = false;
      } catch (e) {
        lines.push(`POST valid ERROR ${String(e).slice(0, 200)}`);
        success = false;
      }
      try {
        const invalidBody = JSON.stringify({ prompt: `auto-${Date.now()}`, worktree: `${tmpBase}-invalid`, phase: "diagnosisLlm", modelRef: { providerID: "openai", modelID: "gpt-99", variant: "default" }, cli: "claude" });
        const invalidRes = await fetch(`${providerBaseUrl}/factory/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: invalidBody });
        const invalidText = await invalidRes.text();
        lines.push(`POST /factory/jobs gpt-99 → ${invalidRes.status} ${invalidText.slice(0, 400)}`);
        if (invalidRes.status !== 400) success = false;
      } catch (e) {
        lines.push(`POST invalid ERROR ${String(e).slice(0, 200)}`);
        success = false;
      }
    } else if (featureId === "F06") {
      const listRes = await fetch(`${providerBaseUrl}/factory/jobs/job-abc123/logs`);
      const t = await listRes.text();
      lines.push(`GET /factory/jobs/job-abc123/logs → ${listRes.status} ${t.slice(0, 600)}`);
      if (!listRes.ok) success = false;
    }
  } catch (e) {
    lines.push(`auto detail ERROR ${String(e).slice(0, 300)}`);
    success = false;
  }
  return { realOutput: lines.join("\n"), success, details: success ? "auto_ok" : "auto_mismatch" };
}

async function main(): Promise<void> {
  const { feature, conclusion, checklistRaw, evidence, notes, reason, auto } = parseArgs(process.argv);

  if (!feature || !/^F\d{2}$/i.test(feature)) {
    console.error(`[submitHuman] --feature requerido F01..F99 (recibí: ${feature ?? "∅"})`);
    printHelp();
    process.exit(1);
  }
  const normalized = feature.toUpperCase();
  if (conclusion !== "pass" && conclusion !== "fail") {
    console.error(`[submitHuman] --conclusion debe ser pass|fail (recibí: ${conclusion ?? "∅"})`);
    process.exit(1);
  }
  const checklist = (checklistRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (checklist.length < 1) {
    console.error(`[submitHuman] --checklist requerido mínimo 1 item (comma-separated)`);
    process.exit(1);
  }
  if (!evidence || evidence.trim().length < 10) {
    console.error(`[submitHuman] --evidence requerido mínimo 10 chars (recibí: ${evidence ? `${evidence.length} chars` : "∅"})`);
    process.exit(1);
  }

  // Resolve pact file
  let pactFileAbsolute = path.resolve(`software-testing-playground-v2/pacts/playground-${normalized}-FactoryProvider.json`);
  try {
    const critFile = path.resolve(`software-testing-playground-v2/criteria/${normalized}.json`);
    if (fs.existsSync(critFile)) {
      const crit = JSON.parse(fs.readFileSync(critFile, "utf-8")) as Record<string, unknown>;
      if (typeof crit.pact === "string" && crit.pact) pactFileAbsolute = path.resolve(crit.pact);
    }
  } catch {}

  // Discover providerBaseUrl best-effort
  let providerBaseUrl: string | null = null;
  const portCandidates: string[] = [
    path.join(os.homedir(), ".termcanvas", "factory-port"),
    path.join(os.homedir(), ".termcanvas-dev", "factory-port"),
    path.join(os.homedir(), ".termcanvas", "port"),
    path.join(os.homedir(), ".termcanvas-dev", "port"),
  ];
  if (process.env.TERMCANVAS_PORT_FILE) portCandidates.unshift(process.env.TERMCANVAS_PORT_FILE);
  if (process.env.FACTORY_PORT_FILE) portCandidates.unshift(process.env.FACTORY_PORT_FILE);
  for (const pf of portCandidates) {
    try {
      if (!fs.existsSync(pf)) continue;
      const raw = fs.readFileSync(pf, "utf-8").trim().split("\n")[0]?.trim();
      const p = Number(raw);
      if (Number.isInteger(p) && p >= 17680 && p <= 17690) { providerBaseUrl = `http://127.0.0.1:${p}`; break; }
    } catch {}
  }
  if (!providerBaseUrl) {
    for (let p = 17680; p <= 17690; p++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 400);
        const res = await fetch(`http://127.0.0.1:${p}/factory/health`, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) { providerBaseUrl = `http://127.0.0.1:${p}`; break; }
      } catch {}
    }
  }

  const commitSha = getCommitSha();
  const dirty = isDirty();
  const startedAt = new Date().toISOString();
  const finishedAt = new Date().toISOString();

  let criteria: unknown = null;
  try {
    const critFile = path.resolve(`software-testing-playground-v2/criteria/${normalized}.json`);
    if (fs.existsSync(critFile)) criteria = JSON.parse(fs.readFileSync(critFile, "utf-8"));
  } catch {}

  // Si --auto, cruza tu evidence vs sistema real (no reemplaza tu declaración, la complementa)
  let autoRealOutput: string | null = null;
  let autoSuccess: boolean | null = null;
  let autoDetails: string | null = null;
  if (auto) {
    console.log(`[submitHuman] --auto activo → verificando contra Factory real ${providerBaseUrl ?? "∅"}...`);
    const autoRes = await collectAutoProviderOutput(normalized, providerBaseUrl);
    autoRealOutput = autoRes.realOutput;
    autoSuccess = autoRes.success;
    autoDetails = autoRes.details;
    console.log(`[submitHuman] --auto resultado: ${autoSuccess ? "OK" : "MISMATCH"} — ${autoRealOutput.split("\n")[0]?.slice(0, 120)}`);
    if (!autoSuccess && conclusion === "pass") {
      console.warn(`[submitHuman] ⚠ ADVERTENCIA: --auto detectó mismatch pero tu conclusion es pass. Revisá tu evidence vs output real abajo.`);
      console.warn(autoRealOutput);
    }
  }

  const rawOutput: Record<string, unknown> = {
    humanChecklist: checklist,
    evidence: evidence.slice(0, 4000), // tu declaración humana — siempre se guarda tal cual (UTF-8)
    notes: notes.slice(0, 4000),
    criterionSnapshot: criteria,
    codeHash: dirty ? `dirty-${commitSha.slice(0, 8)}` : commitSha.slice(0, 8),
    providerBaseUrl,
    // Si --auto, guardamos también el output real del sistema separado de tu evidence
    ...(auto ? { providerRealOutput: autoRealOutput, autoSuccess, autoDetails } : {}),
    reason: reason ? reason.slice(0, 800) : (conclusion === "pass" ? "human pass — checklist + evidencia OK (CLI)" : "human fail — CLI"),
  };

  // providerResult.rawOutput: por diseño humano es responsable de que evidence sea verdadera.
  // Sin --auto, repetimos evidence (con marca explícita). Con --auto, guardamos el output REAL del sistema.
  const providerRawOutputForStore = auto && autoRealOutput
    ? `=== HUMAN EVIDENCE (tu declaración) ===\n${evidence.slice(0, 4000)}\n\n=== AUTO REAL OUTPUT (sistema, --auto) ===\n${autoRealOutput.slice(0, 4000)}\n\n=== AUTO success: ${autoSuccess} ===`
    : `HUMAN EVIDENCE (no verificado contra sistema real — humano responsable de veracidad):\n${evidence.slice(0, 8000)}`;

  const providerStatus: "pass" | "fail" = conclusion === "pass" ? "pass" : "fail";

  const verdict = writePactVerdict({
    featureId: normalized,
    pactFileAbsolute,
    providerBaseUrl,
    consumerPassed: fs.existsSync(pactFileAbsolute),
    providerStatus,
    providerRawOutput: providerRawOutputForStore,
    rawOutput,
    conclusion,
    reason: reason || (rawOutput.reason as string),
    startedAt,
    finishedAt,
    durationMs: 0,
    actor: "humano",
    actorDetail: notes ? `human:${notes.slice(0, 80)}` : (auto ? "human:cli:auto" : "human:cli"),
  });

  console.log(`[submitHuman] ✓ ${normalized} → ${conclusion} id=${verdict.id}`);
  console.log(`[submitHuman]   pactFile: ${verdict.pactFile}`);
  console.log(`[submitHuman]   providerBaseUrl: ${providerBaseUrl ?? "∅ (no factory, pero guardado)"}`);
  console.log(`[submitHuman]   verdict: software-testing-playground-v2/verdicts/${normalized}/${verdict.id}.json`);
  console.log(`[submitHuman]   actor: humano (CLI) — ${evidence.length} chars, ${checklist.length} checklist${auto ? " + --auto real output" : ""}`);
  if (auto) console.log(`[submitHuman]   autoSuccess: ${autoSuccess} — providerResult.rawOutput ahora contiene HUMAN + AUTO separados`);
  else console.log(`[submitHuman]   Tip: usá --auto para cruzar tu evidence vs Factory real automáticamente (providerResult.rawOutput incluirá ambos)`);
  console.log(`[submitHuman]   Ver (UTF-8): Get-Content software-testing-playground-v2\\verdicts\\${normalized}\\${verdict.id}.json -Encoding UTF8 | ConvertFrom-Json | ConvertTo-Json -Depth 8`);
  console.log(`[submitHuman]   chcp 65001 antes de ver tildes/→ en PowerShell 5.1, o usa Windows Terminal/PowerShell 7`);
  const status = derivePactStatus(normalized);
  console.log(`[submitHuman]   pactStatus: ${status.pactStatus} (pactExists=${status.pactExists}, latest=${status.latestVerdictId ?? "∅"})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[submitHuman] error: ${e instanceof Error ? e.message : String(e)}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
