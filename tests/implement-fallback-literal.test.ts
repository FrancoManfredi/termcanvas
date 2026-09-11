import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseRequestedFromPrompt,
  fallbackMinimalChange,
  fallbackNeedsTriage,
  filterExistingCreatedFiles,
  isLiteralFolderName,
} from "../headless-runtime/implement/minimalChange.ts";
import {
  VerificationService,
  detectCreatedFilesAnomaly,
} from "../headless-runtime/implement/verification.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { readWorkItemFromDir } from "../headless-runtime/workItem/workItemDisk.ts";
import type { VerificationReport } from "../shared/types/implement.ts";

// H-001 — el fallback JAMÁS usa texto del prompt como ruta; createdFiles se
// verifica contra disco y vive en job.json; verification ante fantasma ≠ pass.
// Todo con worktree tmp, sin daemon, sin LLM (cero llamadas reales).

const PROMPT_EXACTO =
  "Creá la carpeta e2e02-rev con un archivo exacto.txt que contenga exactamente esta única línea: EL RESULTADO ES 42";
const PROMPT_DEMO =
  "Creá la carpeta demo-e2e2 con un archivo leeme.txt que explique en 2 líneas para qué sirve la carpeta";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "impl-lit-"));
}

test("H-001: prompt carpeta+archivo → ruta exacta (equality exacta, caso job-mtm7pndk-c4sc)", () => {
  const parsed = parseRequestedFromPrompt(PROMPT_EXACTO);
  assert.ok(parsed, "debe parsear");
  assert.equal(parsed?.relPath, "e2e02-rev");
  assert.equal(parsed?.isFolder, true);
});

test("H-001: prompt demo-e2e2 → ruta exacta, sin residuo de prompt", () => {
  const parsed = parseRequestedFromPrompt(PROMPT_DEMO);
  assert.ok(parsed, "debe parsear");
  assert.equal(parsed?.relPath, "demo-e2e2");
  assert.equal(parsed?.isFolder, true);
});

test("H-001: fallback crea SOLO la carpeta exacta, cero carpetas literales", () => {
  const wt = makeTmp();
  const created = fallbackMinimalChange({ id: "job-e1001lit", prompt: PROMPT_DEMO, worktree: wt });
  assert.deepEqual(created, ["demo-e2e2"]);
  assert.equal(fs.existsSync(path.join(wt, "demo-e2e2")), true);
  assert.equal(
    fs.existsSync(path.join(wt, "demo-e2e2 con un archivo leemetxt")),
    false,
    "no debe existir carpeta literal",
  );
  for (const p of created) {
    assert.equal(isLiteralFolderName(PROMPT_DEMO, p), false, `ruta literal: ${p}`);
  }
});

test("H-001: fallback sin parse confiable → triage con razón (no carpeta inventada)", () => {
  // Sin nombre extraíble: no hay nada confiable que crear.
  const reason = fallbackNeedsTriage("Creá una carpeta");
  assert.ok(typeof reason === "string" && reason.length > 0, "debe pedir triage");
  // Residuo multi-palabra sin comillas: tampoco es un nombre confiable.
  const reason2 = fallbackNeedsTriage(
    "Hacé una carpeta linda para el proyecto con muchas palabras descriptivas varias",
  );
  assert.ok(typeof reason2 === "string" && reason2.length > 0, "debe pedir triage");
  // Parse confiable o sin intención de carpeta: null (sigue el camino normal).
  assert.equal(fallbackNeedsTriage(PROMPT_DEMO), null);
  assert.equal(fallbackNeedsTriage("Agregá un log en docs/notas.md con el resumen"), null);
});

test("H-001: createdFiles se filtra contra disco (fantasma descartado)", () => {
  const wt = makeTmp();
  fs.writeFileSync(path.join(wt, "real.txt"), "hola\n", "utf-8");
  const checked = filterExistingCreatedFiles(wt, ["real.txt", "fantasma.txt", ""]);
  assert.deepEqual(checked.kept, ["real.txt"]);
  assert.ok(checked.dropped.includes("fantasma.txt"), "el fantasma se descarta");
});

test("H-001: createdFiles presente en job.json (top-level) y sobrevive restore", () => {
  const wt = makeTmp();
  const id = "job-e1001top";
  // Refactor ① E1 (A3): `transitionWithVerification` concilia contra disco
  // (filtra inexistentes "como hoy"). El fixture crea el archivo — igual que
  // en producción, donde el implement lo crea antes de la transición.
  fs.writeFileSync(path.join(wt, "a.txt"), "hola\n", "utf-8");
  try {
    workItemStore.create({ id, prompt: "prompt de prueba", worktree: wt });
    workItemStore.transition(id, "Foreman", "foreman", "a foreman");
    workItemStore.transition(id, "Building", "foreman", "a building");
    const nowIso = new Date().toISOString();
    const verif: VerificationReport = {
      steps: [
        {
          name: "test",
          command: "pnpm test",
          exitCode: 0,
          durationMs: 1,
          status: "pass",
          logPath: "logs/build.log",
        },
      ],
      overall: "pass",
      startedAt: nowIso,
      finishedAt: nowIso,
      durationMs: 1,
    };
    workItemStore.transitionWithVerification(id, "Review", verif, ["a.txt"], "pass a review");
    const item = workItemStore.get(id);
    assert.deepEqual(item?.createdFiles, ["a.txt"]);
    const raw = JSON.parse(
      fs.readFileSync(path.join(wt, ".agents", "factory", id, "job.json"), "utf-8"),
    ) as Record<string, unknown>;
    assert.deepEqual(raw.createdFiles, ["a.txt"], "job.json debe tener createdFiles top-level");
    const restored = readWorkItemFromDir(path.join(wt, ".agents", "factory", id));
    assert.deepEqual(restored?.createdFiles, ["a.txt"], "el restore no debe perder createdFiles");
  } finally {
    workItemStore.delete(id);
  }
});

test("H-001: verification ante createdFiles fantasma da fail (jamás pass)", async () => {
  const wt = makeTmp();
  const dir = makeTmp();
  const anomaly = detectCreatedFilesAnomaly(wt, PROMPT_DEMO, ["fantasma.txt"]);
  assert.ok(anomaly && anomaly.includes("fantasma"), "detecta el fantasma");
  const svc = new VerificationService();
  const report = await svc.run(wt, dir, PROMPT_DEMO, ["fantasma.txt"]);
  assert.equal(report.overall, "fail");
  assert.equal(report.steps[0].status, "fail");
  assert.match(report.steps[0].logSnippet ?? "", /fantasma/);
});

test("H-001: verification ante carpeta literal vacía da fail (no skipped ciego)", async () => {
  const wt = makeTmp();
  const dir = makeTmp();
  const literal = "demo-e2e2 con un archivo leemetxt";
  fs.mkdirSync(path.join(wt, literal), { recursive: true });
  assert.equal(isLiteralFolderName(PROMPT_DEMO, literal), true, "precondición: es literal");
  const anomaly = detectCreatedFilesAnomaly(wt, PROMPT_DEMO, [literal]);
  assert.ok(anomaly && anomaly.includes("literal"), "detecta la carpeta literal vacía");
  const svc = new VerificationService();
  const report = await svc.run(wt, dir, PROMPT_DEMO, [literal]);
  assert.equal(report.overall, "fail");
  assert.equal(report.steps[0].status, "fail");
  assert.match(report.steps[0].logSnippet ?? "", /literal/);
});
