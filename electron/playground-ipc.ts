import { ipcMain } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listPactContracts, getPactFor } from "../software-testing-playground-v2/pact/support/pactReader.js";
import { deriveState, deriveAllStates, derivePactStatus } from "../software-testing-playground-v2/pact/support/pactState.js";
import { listPactVerdicts, getLatestPactVerdict, writePactVerdict } from "../software-testing-playground-v2/pact/support/pactVerdictStore.js";
import { getCommitSha, isDirty } from "../software-testing-playground-v2/pact/support/git.js";

/**
 * Playground IPC — exposes window.playground.getPacts(), getState(), verifyPact(Fxx)
 * Architecture-pact-v2.md §2.1 + §2.6
 * Registered via registerPlaygroundIpc() called from electron/main.ts app.whenReady.
 */

function criteriaFor(featureId: string): Record<string, unknown> | null {
  const file = path.resolve(`software-testing-playground-v2/criteria/${featureId.toUpperCase()}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getFactoryPortSync(): number | null {
  // Try factory-port files then fallback to probing sequential — sync version for IPC
  // Mirrors pact/support/port.ts but sync + no fetch
  const candidates: string[] = [];
  if (process.env.TERMCANVAS_PORT_FILE) candidates.push(process.env.TERMCANVAS_PORT_FILE);
  if (process.env.FACTORY_PORT_FILE) candidates.push(process.env.FACTORY_PORT_FILE);
  for (const inst of ["dev", "prod"] as const) {
    const baseDir = inst === "dev" ? path.join(os.homedir(), ".termcanvas-dev") : path.join(os.homedir(), ".termcanvas");
    candidates.push(path.join(baseDir, "factory-port"));
    candidates.push(path.join(baseDir, "port"));
  }
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf-8").trim().split("\n")[0]?.trim();
      if (!raw) continue;
      const p = Number(raw);
      if (!Number.isInteger(p) || p < 17680 || p > 17690) continue;
      return p;
    } catch {}
  }
  return null;
}

export function registerPlaygroundIpc(): void {
  // Idempotent: remove previous handlers if re-registered (dev reload)
  const handlers = [
    "playground:getPacts",
    "playground:getPact",
    "playground:getState",
    "playground:getStates",
    "playground:getVerdicts",
    "playground:getLatestVerdict",
    "playground:getCriteria",
    "playground:listCriteria",
    "playground:verifyPact",
    "playground:getFactoryPort",
    "playground:getFactoryBaseUrl",
    "playground:submitHumanVerdict",
  ];
  for (const h of handlers) {
    try {
      ipcMain.removeHandler(h);
    } catch {}
  }

  ipcMain.handle("playground:getPacts", () => {
    try {
      return listPactContracts();
    } catch (e) {
      console.error("[playground-ipc] getPacts failed:", e);
      return [];
    }
  });

  ipcMain.handle("playground:getPact", (_event, featureId: string) => {
    try {
      return getPactFor(String(featureId));
    } catch (e) {
      console.error(`[playground-ipc] getPact ${featureId} failed:`, e);
      return null;
    }
  });

  ipcMain.handle("playground:getState", (_event, featureId: string) => {
    try {
      return deriveState(String(featureId));
    } catch (e) {
      console.error(`[playground-ipc] getState ${featureId} failed:`, e);
      return null;
    }
  });

  ipcMain.handle("playground:getStates", () => {
    try {
      return deriveAllStates();
    } catch (e) {
      console.error("[playground-ipc] getStates failed:", e);
      return {};
    }
  });

  ipcMain.handle("playground:getVerdicts", (_event, featureId: string) => {
    try {
      return listPactVerdicts(String(featureId));
    } catch (e) {
      console.error(`[playground-ipc] getVerdicts ${featureId} failed:`, e);
      return [];
    }
  });

  ipcMain.handle("playground:getLatestVerdict", (_event, featureId: string) => {
    try {
      return getLatestPactVerdict(String(featureId));
    } catch (e) {
      console.error(`[playground-ipc] getLatestVerdict ${featureId} failed:`, e);
      return null;
    }
  });

  ipcMain.handle("playground:getCriteria", (_event, featureId: string) => {
    try {
      return criteriaFor(String(featureId));
    } catch {
      return null;
    }
  });

  ipcMain.handle("playground:listCriteria", () => {
    const ids = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09"];
    return ids
      .map((id) => ({ id, criteria: criteriaFor(id) }))
      .filter((x) => x.criteria !== null);
  });

  ipcMain.handle("playground:getFactoryPort", async () => {
    try {
      const p = getFactoryPortSync();
      if (p !== null) return p;
      // fallback: try to import factoryServer getFactoryPort (if daemon running in same process)
      try {
        const mod = await import("../headless-runtime/factory/factoryServer.js");
        const port = (mod as { getFactoryPort?: () => number }).getFactoryPort?.();
        if (typeof port === "number" && port >= 17680 && port <= 17690) return port;
      } catch {}
      return null;
    } catch (e) {
      console.error("[playground-ipc] getFactoryPort failed:", e);
      return null;
    }
  });

  ipcMain.handle("playground:getFactoryBaseUrl", async () => {
    try {
      const p = getFactoryPortSync();
      let port: number | null = p;
      if (port === null) {
        try {
          const mod = await import("../headless-runtime/factory/factoryServer.js");
          const got = (mod as { getFactoryPort?: () => number }).getFactoryPort?.();
          if (typeof got === "number" && got >= 17680 && got <= 17690) port = got;
        } catch {}
      }
      if (port === null) return null;
      // Verify health quickly before returning (best-effort)
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 900);
        const res = await fetch(`http://127.0.0.1:${port}/factory/health`, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) return `http://127.0.0.1:${port}`;
      } catch {}
      // Still return port even if health not ok — caller can retry probing
      return `http://127.0.0.1:${port}`;
    } catch (e) {
      console.error("[playground-ipc] getFactoryBaseUrl failed:", e);
      return null;
    }
  });

  ipcMain.handle(
    "playground:submitHumanVerdict",
    async (
      _event,
      payload: {
        featureId: string;
        conclusion: "pass" | "fail";
        humanChecklist?: string[];
        evidence?: string;
        notes?: string;
        reason?: string;
      },
    ) => {
      const normalized = String(payload.featureId ?? "").toUpperCase();
      if (!/^F\d{2}$/.test(normalized)) {
        throw new Error(`Invalid featureId ${payload.featureId} — expected F01..F99`);
      }
      const conclusion = payload.conclusion === "pass" ? "pass" : "fail";
      const checklist = Array.isArray(payload.humanChecklist) ? payload.humanChecklist.map(String) : [];
      const evidence = typeof payload.evidence === "string" ? payload.evidence.trim() : "";
      const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
      const reasonInput = typeof payload.reason === "string" ? payload.reason.trim() : "";

      if (checklist.length < 1) {
        throw new Error("humanChecklist requerido — marcar checklist completo");
      }
      if (!evidence || evidence.length < 10) {
        throw new Error("evidencia obligatoria — mínimo 10 caracteres (path, logs, job.json, o URL)");
      }

      // Validate checklist completeness for F05/F04: expect 3 items; enforce that payload includes expected items if caller sent checklistIds
      // We don't hard-fail here; just ensure at least 1 and evidence present — UI enforces resto

      const startedAt = new Date().toISOString();
      const finishedAt = new Date().toISOString();
      const durationMs = 0;

      const criteria = criteriaFor(normalized);
      // Resolve pact file — even if null pact (F05), use conventional path for storage
      let pactFileAbsolute: string;
      const pactRel = (criteria as Record<string, unknown> | null)?.pact as string | null | undefined;
      if (typeof pactRel === "string" && pactRel) {
        pactFileAbsolute = path.resolve(pactRel);
      } else {
        pactFileAbsolute = path.resolve(`software-testing-playground-v2/pacts/playground-${normalized}-FactoryProvider.json`);
      }

      // Try to discover providerBaseUrl from factory if available
      let providerBaseUrl: string | null = null;
      try {
        const p = getFactoryPortSync();
        if (p !== null) providerBaseUrl = `http://127.0.0.1:${p}`;
        else {
          const mod = await import("../headless-runtime/factory/factoryServer.js");
          const got = (mod as { getFactoryPort?: () => number }).getFactoryPort?.();
          if (typeof got === "number") providerBaseUrl = `http://127.0.0.1:${got}`;
        }
      } catch {}

      const codeHashRaw = getCommitSha();
      const dirty = isDirty();

      const rawOutput: Record<string, unknown> = {
        humanChecklist: checklist,
        evidence: evidence.slice(0, 4000),
        notes: notes.slice(0, 4000),
        criterionSnapshot: criteria,
        codeHash: dirty ? `dirty-${codeHashRaw.slice(0, 8)}` : codeHashRaw.slice(0, 8),
        providerBaseUrl,
        factoryPort: providerBaseUrl,
        reason: reasonInput ? reasonInput.slice(0, 800) : (conclusion === "pass" ? "human pass — checklist + evidencia OK" : "human fail — checklist evidencia indica fallo"),
      };

      // Also enrich with evidence length hint
      const providerStatus: "pass" | "fail" = conclusion === "pass" ? "pass" : "fail";

      const verdict = writePactVerdict({
        featureId: normalized,
        pactFileAbsolute,
        providerBaseUrl,
        consumerPassed: fs.existsSync(pactFileAbsolute),
        providerStatus,
        providerRawOutput: evidence.slice(0, 8000),
        rawOutput,
        conclusion,
        reason: reasonInput || rawOutput.reason as string,
        startedAt,
        finishedAt,
        durationMs,
        actor: "humano",
        actorDetail: notes ? `human:${notes.slice(0, 80)}` : "human",
      });

      console.log(`[playground-ipc] submitHumanVerdict ${normalized} → ${conclusion} id=${verdict.id}`);

      // Derive fresh state for caller
      let state: unknown = null;
      try {
        state = deriveState(normalized);
      } catch {}

      return { verdict, state };
    },
  );

  // verifyPact: spawns p:verify for a single F, captures output, returns verdict summary
  ipcMain.handle("playground:verifyPact", async (_event, featureId: string) => {
    const normalized = String(featureId).toUpperCase();
    if (!/^F\d{2}$/.test(normalized)) {
      throw new Error(`Invalid featureId ${featureId} — expected F01..F99`);
    }

    const start = Date.now();
    // Use npx tsx to run verifier, mirroring package.json p:verify script
    // Windows PowerShell compatible: spawn node with --loader tsx
    const verifierPath = path.resolve("software-testing-playground-v2/pact/provider/verify.ts");
    // Prefer `pnpm p:verify -- Fxx` if pnpm available, fallback to tsx direct
    const usePnpm = fs.existsSync(path.resolve("pnpm-lock.yaml")) || process.env.TERMCANVAS_USE_PNPM === "1";

    return await new Promise((resolve, reject) => {
      let args: string[];
      let cmd: string;
      if (usePnpm) {
        cmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
        args = ["p:verify", "--", normalized];
      } else {
        cmd = process.execPath; // node
        args = ["--loader", "tsx", verifierPath, normalized];
      }

      console.log(`[playground-ipc] verifyPact ${normalized}: spawning ${cmd} ${args.join(" ")}`);

      const child = spawn(cmd, args, { windowsHide: true,
        cwd: path.resolve("."),
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      const timeout = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        reject(new Error(`[playground:verifyPact] Timeout verifying ${normalized} after 30s`));
      }, 30000);

      child.on("close", (code) => {
        clearTimeout(timeout);
        const durationMs = Date.now() - start;
        const rawOutput = (stdout + "\n" + stderr).slice(0, 9000);
        const isPass = code === 0;

        // After verifier, read latest verdict written by verifier itself
        let latestVerdict: unknown = null;
        try {
          latestVerdict = getLatestPactVerdict(normalized);
        } catch {}

        // Also derive fresh state
        let state: unknown = null;
        try {
          state = deriveState(normalized);
        } catch {}

        const pactStatus = derivePactStatus(normalized);

        resolve({
          featureId: normalized,
          exitCode: code,
          durationMs,
          rawOutput,
          stdout: stdout.slice(0, 8000),
          stderr: stderr.slice(0, 8000),
          conclusion: isPass ? "pass" : "fail",
          pactStatus,
          latestVerdict,
          state,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`[playground:verifyPact] spawn failed for ${normalized}: ${String(err)}`));
      });
    });
  });

  console.log("[playground-ipc] Handlers registered: playground:getPacts, getState, verifyPact, getFactoryBaseUrl, submitHumanVerdict, etc.");
}
