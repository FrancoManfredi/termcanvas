import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildResultPayload,
  discoverLateCreatedFiles,
  reconcileCreatedFiles,
  resolveVerifyRetryCreatedFiles,
  writeResult,
} from "../headless-runtime/workItem/resultStore.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { readWorkItemFromDir } from "../headless-runtime/workItem/workItemDisk.ts";
import { detectCreatedFilesAnomaly } from "../headless-runtime/implement/verification.ts";
import type { VerificationReport } from "../shared/types/implement.ts";

// H-013 — el pass del verify-retry reconcilia escrituras tardías contra
// disco ANTES de seguir a Review/accept (nadie dejaba `createdFiles: []`
// con el archivo existiendo, caso job-mtngz1t6-6vob). Todo con worktree
// tmp + mocks, sin daemon, sin LLM, sin docker.
//
// Cadena confirmada por lectura (difiere de la hipótesis del hallazgo):
// el reintento SÍ pasa por `transitionWithVerification`
// (factoryServer.ts `runVerifyRetryForJob` → Triage→Review), que SÍ filtra
// en el punto único — pero con la lista STALE `[]` del fail H-012 y un
// filtro que solo conserva (kept ⊆ declarado): el late-write en disco
// jamás entraba. El fix suma descubrimiento (solo existente, con los
// parsers ya usados) y lo alimenta al mismo punto único.

const PROMPT_CARPETA_ARCHIVO =
  "Creá la carpeta lab8c-notas con un archivo leeme.txt que explique en 2 líneas para qué sirve la carpeta";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "h013-"));
}

function makePassReport(): VerificationReport {
  const nowIso = new Date().toISOString();
  return {
    steps: [
      {
        name: "test",
        command: "pnpm test",
        exitCode: 0,
        durationMs: 1,
        status: "pass",
        logSnippet: "trivial folder creation verified",
        logPath: "logs/build.log",
      },
    ],
    overall: "pass",
    startedAt: nowIso,
    finishedAt: nowIso,
    durationMs: 1,
  };
}

/** Lee `createdFiles` de un result.json como el worker (tolerante, crudo). */
function readPrevCreatedFiles(dir: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(dir, "result.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed.createdFiles)) {
      return (parsed.createdFiles as unknown[])
        .filter((x): x is string => typeof x === "string")
        .slice(0, 50);
    }
  } catch {}
  return [];
}

test("H-013: late-write entre fail y reintento se descubre (archivo aparece 2s después)", () => {
  const wt = makeTmp();
  // Momento del fail H-012: carpeta vacía, archivo ausente → nada que trackear.
  fs.mkdirSync(path.join(wt, "lab8c-notas"), { recursive: true });
  assert.deepEqual(discoverLateCreatedFiles(wt, PROMPT_CARPETA_ARCHIVO, []), []);
  // La sesión async escribe 2s DESPUÉS (caso job-mtngz1t6-6vob).
  fs.writeFileSync(path.join(wt, "lab8c-notas", "leeme.txt"), "notas del lab\n", "utf-8");
  const found = discoverLateCreatedFiles(wt, PROMPT_CARPETA_ARCHIVO, []);
  assert.ok(
    found.includes("lab8c-notas/leeme.txt"),
    `debe incluir el archivo tardío, halló: ${JSON.stringify(found)}`,
  );
});

test("H-013: resolve compone prev + tardío y filtra en el punto único", () => {
  const wt = makeTmp();
  fs.mkdirSync(path.join(wt, "lab8c-notas"), { recursive: true });
  fs.writeFileSync(path.join(wt, "lab8c-notas", "leeme.txt"), "notas del lab\n", "utf-8");
  const resolved = resolveVerifyRetryCreatedFiles([], wt, PROMPT_CARPETA_ARCHIVO);
  assert.ok(
    resolved.kept.includes("lab8c-notas/leeme.txt"),
    `kept debe incluir el tardío: ${JSON.stringify(resolved)}`,
  );
  assert.ok(
    resolved.added.includes("lab8c-notas/leeme.txt"),
    `added debe citar el tardío: ${JSON.stringify(resolved)}`,
  );
  assert.deepEqual(resolved.dropped, []);
});

test("H-013: sin late-write el resolve es idéntico a hoy (veredicto intacto)", () => {
  const wt = makeTmp();
  fs.mkdirSync(path.join(wt, "lab8c-notas"), { recursive: true });
  for (const prev of [[], ["lab8c-notas"]] as string[][]) {
    const resolved = resolveVerifyRetryCreatedFiles(prev, wt, PROMPT_CARPETA_ARCHIVO);
    const legacy = reconcileCreatedFiles(prev, wt, PROMPT_CARPETA_ARCHIVO);
    assert.deepEqual(resolved.kept, legacy.kept, `kept idéntico para prev=${JSON.stringify(prev)}`);
    assert.deepEqual(resolved.dropped, legacy.dropped, `dropped idéntico para prev=${JSON.stringify(prev)}`);
    assert.deepEqual(resolved.added, [], "sin tardío no hay nada nuevo");
  }
});

test("H-013: reintento que sigue vacío no reconcilia nada (fail honesto aguas arriba)", () => {
  const wt = makeTmp();
  fs.mkdirSync(path.join(wt, "lab8c-notas"), { recursive: true });
  // Disco sigue sin el archivo: descubrir no inventa.
  assert.deepEqual(discoverLateCreatedFiles(wt, PROMPT_CARPETA_ARCHIVO, []), []);
  const resolved = resolveVerifyRetryCreatedFiles([], wt, PROMPT_CARPETA_ARCHIVO);
  assert.deepEqual(resolved.kept, []);
  assert.deepEqual(resolved.added, []);
  // Y la verificación con [] ante carpeta sin archivo sigue en fail H-012
  // (el reintento NO da pass: queda en Triage, humano decide).
  const anomaly = detectCreatedFilesAnomaly(wt, PROMPT_CARPETA_ARCHIVO, []);
  assert.ok(
    anomaly !== null && anomaly.includes("H-012"),
    `vacío debe seguir en fail H-012, halló: ${String(anomaly)}`,
  );
});

test("H-013: no inventa rutas (sin parse claro o sin existencia → [])", () => {
  const wt = makeTmp();
  fs.writeFileSync(path.join(wt, "suelto.txt"), "x\n", "utf-8");
  // Prompt sin pedido de ruta: nada que descubrir aunque haya archivos.
  assert.deepEqual(
    discoverLateCreatedFiles(wt, "Mejorá algo del proyecto donde veas oportunidad", []),
    [],
  );
  // Prompt válido pero ruta inexistente: nada (cero hardcodeo de éxito).
  assert.deepEqual(discoverLateCreatedFiles(wt, PROMPT_CARPETA_ARCHIVO, []), []);
  // Entradas defensivas: nunca lanzan.
  assert.deepEqual(discoverLateCreatedFiles(wt, null, []), []);
  assert.deepEqual(discoverLateCreatedFiles(wt, "", []), []);
  assert.deepEqual(resolveVerifyRetryCreatedFiles(null, wt, PROMPT_CARPETA_ARCHIVO).kept, []);
});

test("H-013: lo ya declarado no se duplica (prev con el archivo → added vacío)", () => {
  const wt = makeTmp();
  fs.mkdirSync(path.join(wt, "lab8c-notas"), { recursive: true });
  fs.writeFileSync(path.join(wt, "lab8c-notas", "leeme.txt"), "notas del lab\n", "utf-8");
  const resolved = resolveVerifyRetryCreatedFiles(["lab8c-notas/leeme.txt"], wt, PROMPT_CARPETA_ARCHIVO);
  assert.deepEqual(resolved.kept.filter((f) => f === "lab8c-notas/leeme.txt").length, 1);
  assert.deepEqual(resolved.added, [], "ya declarado no cuenta como tardío");
});

test("H-013: cadena completa fail→tarde→reintento→Review deja createdFiles en job.json y result.json", () => {
  const wt = makeTmp();
  const id = "job-h013ok1";
  try {
    workItemStore.create({ id, prompt: PROMPT_CARPETA_ARCHIVO, worktree: wt });
    workItemStore.transition(id, "Foreman", "foreman", "a foreman");
    // Fail H-012: carpeta vacía, createdFiles [] honesto (vía el punto único).
    fs.mkdirSync(path.join(wt, "lab8c-notas"), { recursive: true });
    const dir = path.join(wt, ".agents", "factory", id);
    const failReport: VerificationReport = {
      ...makePassReport(),
      overall: "fail",
      steps: [
        {
          name: "test",
          command: "pnpm test",
          exitCode: null,
          durationMs: 0,
          status: "fail",
          logSnippet: 'carpeta "lab8c-notas" existe pero el archivo pedido "leeme.txt" ausente en disco — verification fail (H-012)',
          logPath: "logs/build.log",
        },
      ],
    };
    writeResult(dir, buildResultPayload({ workItemId: id, worktreePath: wt, verification: failReport, createdFiles: [] }));
    workItemStore.transitionWithVerification(id, "Triage", failReport, [], "verification failed (H-012)");
    // El worker lee el prev stale del fail, como en producción.
    assert.deepEqual(readPrevCreatedFiles(dir), []);
    // Late-write posterior al verify (sesión async tardía).
    fs.writeFileSync(path.join(wt, "lab8c-notas", "leeme.txt"), "notas del lab\n", "utf-8");
    // El reintento reconcilia ANTES de la transición a Review.
    const prev = readPrevCreatedFiles(dir);
    const resolved = resolveVerifyRetryCreatedFiles(prev, wt, PROMPT_CARPETA_ARCHIVO);
    assert.ok(resolved.kept.includes("lab8c-notas/leeme.txt"), "el tardío entra al kept");
    const moved = workItemStore.transitionWithVerification(
      id,
      "Review",
      makePassReport(),
      resolved.kept,
      "verify-retry pass → Review (re-verificación desde Triage)",
    );
    assert.equal(moved.status, "Review");
    assert.ok(
      (moved.createdFiles ?? []).includes("lab8c-notas/leeme.txt"),
      `job en memoria trackea el tardío: ${JSON.stringify(moved.createdFiles)}`,
    );
    const rawJob = JSON.parse(
      fs.readFileSync(path.join(dir, "job.json"), "utf-8"),
    ) as Record<string, unknown>;
    assert.ok(
      Array.isArray(rawJob.createdFiles) &&
        (rawJob.createdFiles as unknown[]).includes("lab8c-notas/leeme.txt"),
      "job.json top-level trackea el tardío (adiós Complete fantasma)",
    );
    const rawResult = JSON.parse(
      fs.readFileSync(path.join(dir, "result.json"), "utf-8"),
    ) as Record<string, unknown>;
    assert.ok(
      Array.isArray(rawResult.createdFiles) &&
        (rawResult.createdFiles as unknown[]).includes("lab8c-notas/leeme.txt"),
      "result.json trackea el tardío",
    );
    const restored = readWorkItemFromDir(dir);
    assert.ok(
      (restored?.createdFiles ?? []).includes("lab8c-notas/leeme.txt"),
      "el restore no pierde el tardío",
    );
    // Nota de reconciliación en timeline (el worker la agrega; acá se
    // verifica el contrato de evidencia que el worker escribe).
    const timeline = (workItemStore.get(id)?.timeline ?? []).map((e) => e.message);
    assert.ok(
      timeline.some((m) => m.includes("verify-retry pass → Review")),
      "la transición del reintento queda en timeline",
    );
  } finally {
    workItemStore.delete(id);
  }
});
