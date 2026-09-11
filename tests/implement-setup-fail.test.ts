/**
 * H-008 (parte 2, backend) — el path de setup-fail escribe `result.json`
 * vía `resultWriter.buildPayload` igual que el path de éxito.
 *
 * Cubre el camino real `ImplementService.handleBuilding` con el executor
 * mockeado (mocks solo en tests): setup `corepack enable` exit 127 →
 * `result.json` existe con overall fail + evidence `note` (comando, exit y
 * fallback) + `createdFiles: []`, el job queda parado en Building con la
 * razón en el timeline (flujo simple, sin Triage) y el setup se ejecuta UNA
 * sola vez (terminación: sin reintentos en este nivel; el reintento H-009
 * vive dentro del executor, no acá).
 *
 * Nota de alcance: este test prueba la escritura del path. En producción de
 * corrida 6 el archivo no llegó a disco porque el writer legacy
 * `writeJobJson` (factoryServer, prohibido en este flujo) lo borra cuando el
 * status no es Complete — ver carry-over en la entrega.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { implementService } from "../headless-runtime/implement/implementService.ts";
import { runnerExecutor } from "../headless-runtime/runner/runnerExecutor.ts";

const SETUP_FAIL_ID = "job-h08setup01";

function withTempWorktree(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "implement-setup-fail-"));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // noop: limpieza best-effort
      }
    },
  };
}

test("setup-fail → result.json existe con overall fail + evidence, parado en Building, 1 solo setup", async () => {
  const tmp = withTempWorktree();
  workItemStore.clear();
  // Mock del executor SOLO en este test: setup roto exit 127 (H-009 real).
  let setupCalls = 0;
  const holder = runnerExecutor as unknown as Record<string, unknown>;
  const prevExecuteSetup = holder["executeSetup"];
  holder["executeSetup"] = async () => {
    setupCalls++;
    return {
      name: "setup",
      command: "corepack enable",
      exitCode: 127,
      durationMs: 50,
      status: "fail",
      logSnippet: "sh: 1: corepack: not found\n",
      logPath: "logs/build.log",
      isolation: "docker",
    };
  };
  try {
    // Prompt de archivo simple: pasa el guard H-001 (no es carpeta sin parse)
    // y llega al setup.
    const created = workItemStore.create({
      id: SETUP_FAIL_ID,
      prompt: "Creá el archivo lab8-setup-fail.txt con el texto hola mundo",
      worktree: tmp.dir,
    });
    workItemStore.transition(created.id, "Foreman", "foreman", "test → Foreman");
    const building = workItemStore.transition(SETUP_FAIL_ID, "Building", "foreman", "test → Building");

    const out = await implementService.handleBuilding(building);
    assert.ok(out, "handleBuilding debe devolver el work item");
    assert.equal(workItemStore.get(SETUP_FAIL_ID)?.status, "Building");

    // result.json existe con overall fail + evidence (igual que el éxito).
    const resultPath = path.join(tmp.dir, ".agents", "factory", SETUP_FAIL_ID, "result.json");
    assert.ok(fs.existsSync(resultPath), "setup-fail escribe result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as Record<string, unknown>;
    assert.equal(result.status, "fail");
    const verification = result.verification as Record<string, unknown>;
    assert.equal(verification.overall, "fail");
    const steps = verification.steps as Array<Record<string, unknown>>;
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.command, "corepack enable");
    assert.equal(steps[0]?.exitCode, 127);
    const evidence = verification.evidence as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(evidence) && evidence.length >= 1, "evidence note presente");
    assert.equal(evidence[0]?.kind, "note");
    assert.equal(evidence[0]?.status, "fail");
    assert.match(String(evidence[0]?.summary ?? ""), /corepack enable/);
    assert.match(String(evidence[0]?.summary ?? ""), /127/);
    assert.deepEqual(result.createdFiles, []);

    // verify.json hermano también existe (no regresión del path).
    const verifyPath = path.join(tmp.dir, ".agents", "factory", SETUP_FAIL_ID, "verify.json");
    assert.ok(fs.existsSync(verifyPath), "verify.json se sigue escribiendo");

    // Parado en Building con la razón en el timeline (flujo simple, sin Triage).
    const stoppedEvent = (workItemStore.get(SETUP_FAIL_ID)?.timeline ?? []).find(
      (e) => e.message.includes("queda parado en Building"),
    );
    assert.ok(stoppedEvent, "evento de parado en Building existente (no varado silencioso)");
    assert.match(stoppedEvent?.message ?? "", /corepack enable/);
    assert.match(stoppedEvent?.message ?? "", /127/);

    // Terminación: el setup se ejecutó UNA sola vez en este nivel.
    assert.equal(setupCalls, 1);
  } finally {
    if (prevExecuteSetup === undefined) delete holder["executeSetup"];
    else holder["executeSetup"] = prevExecuteSetup;
    workItemStore.clear();
    tmp.cleanup();
  }
});
