import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fallbackMinimalChange,
  fallbackNeedsTriage,
  isLiteralFolderName,
  parseRequestedFileName,
  stripEmptyFolderPlaceholder,
} from "../headless-runtime/implement/minimalChange.ts";
import {
  VerificationService,
  detectCreatedFilesAnomaly,
} from "../headless-runtime/implement/verification.ts";
import { reconcileCreatedFiles } from "../headless-runtime/workItem/resultStore.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { implementService } from "../headless-runtime/implement/implementService.ts";
import { implementAgent } from "../headless-runtime/implement/implementAgent.ts";
import { runnerExecutor } from "../headless-runtime/runner/runnerExecutor.ts";

// H-012 — fallback con LLM caído crea la CARPETA exacta (no literal, no
// dispara H-001) pero NUNCA el archivo: debe ir a Triage/fail honesto, jamás
// `changed 1` + `pass` por carpeta vacía. Todo con worktree tmp, sin daemon,
// sin LLM real (mocks solo en este archivo).

const PROMPT_CARPETA_ARCHIVO =
  "Creá la carpeta revrod-demo con un archivo ficha.txt que contenga exactamente esta única línea: EL RESULTADO ES 42";
const PROMPT_CARPETA_SOLA = 'crear una carpeta llamada "Zeta" en la raiz';
const PROMPT_DEMO_H001 =
  "Creá la carpeta demo-e2e2 con un archivo leeme.txt que explique en 2 líneas para qué sirve la carpeta";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "h12-"));
}

test("H-012: parseRequestedFileName extrae el archivo pedido, null para carpeta sola", () => {
  assert.equal(parseRequestedFileName(PROMPT_CARPETA_ARCHIVO), "ficha.txt");
  assert.equal(parseRequestedFileName(PROMPT_DEMO_H001), "leeme.txt");
  assert.equal(parseRequestedFileName(PROMPT_CARPETA_SOLA), null);
  assert.equal(parseRequestedFileName("cual es el estado del repo"), null);
  assert.equal(parseRequestedFileName(""), null);
});

test("H-012: strip no cuenta carpeta vacía sin archivo (pero carpeta sola intacta)", () => {
  const wt = makeTmp();
  fs.mkdirSync(path.join(wt, "revrod-demo"), { recursive: true });
  assert.deepEqual(
    stripEmptyFolderPlaceholder(wt, ["revrod-demo"], PROMPT_CARPETA_ARCHIVO),
    [],
    "carpeta vacía sin archivo no cuenta",
  );
  const wtSolo = makeTmp();
  fs.mkdirSync(path.join(wtSolo, "Zeta"), { recursive: true });
  assert.deepEqual(
    stripEmptyFolderPlaceholder(wtSolo, ["Zeta"], PROMPT_CARPETA_SOLA),
    ["Zeta"],
    "carpeta sola vacía sigue contando (trivial intacto)",
  );
  const wtOk = makeTmp();
  fs.mkdirSync(path.join(wtOk, "revrod-demo"), { recursive: true });
  fs.writeFileSync(path.join(wtOk, "revrod-demo", "ficha.txt"), "EL RESULTADO ES 42\n", "utf-8");
  assert.deepEqual(
    stripEmptyFolderPlaceholder(wtOk, ["revrod-demo"], PROMPT_CARPETA_ARCHIVO),
    ["revrod-demo"],
    "con archivo presente no se quita nada",
  );
});

test("H-012: reconcile con prompt voltea carpeta vacía a cero kept (sin prompt, como hoy)", () => {
  const wt = makeTmp();
  fs.mkdirSync(path.join(wt, "revrod-demo"), { recursive: true });
  const withPrompt = reconcileCreatedFiles(["revrod-demo"], wt, PROMPT_CARPETA_ARCHIVO);
  assert.deepEqual(withPrompt.kept, [], "cero kept: no se reporta éxito");
  assert.ok(withPrompt.dropped.includes("revrod-demo"), "la carpeta vacía va a dropped con evidencia");
  const legacy = reconcileCreatedFiles(["revrod-demo"], wt);
  assert.deepEqual(legacy.kept, ["revrod-demo"], "sin prompt el comportamiento es el de hoy");
  const wtOk = makeTmp();
  fs.mkdirSync(path.join(wtOk, "revrod-demo"), { recursive: true });
  fs.writeFileSync(path.join(wtOk, "revrod-demo", "ficha.txt"), "x\n", "utf-8");
  const keptOk = reconcileCreatedFiles(["revrod-demo"], wtOk, PROMPT_CARPETA_ARCHIVO);
  assert.deepEqual(keptOk.kept, ["revrod-demo"], "con archivo no se descarta");
});

test("H-012: anomaly exige el ARCHIVO (carpeta existe + archivo ausente → fail H-012)", () => {
  const wt = makeTmp();
  fs.mkdirSync(path.join(wt, "revrod-demo"), { recursive: true });
  const reason = detectCreatedFilesAnomaly(wt, PROMPT_CARPETA_ARCHIVO, ["revrod-demo"]);
  assert.ok(reason && reason.includes("H-012"), "razón exacta con tag H-012");
  assert.match(reason ?? "", /ficha\.txt/);
  assert.match(reason ?? "", /ausente/);
  const wtOk = makeTmp();
  fs.mkdirSync(path.join(wtOk, "revrod-demo"), { recursive: true });
  fs.writeFileSync(path.join(wtOk, "revrod-demo", "ficha.txt"), "x\n", "utf-8");
  assert.equal(
    detectCreatedFilesAnomaly(wtOk, PROMPT_CARPETA_ARCHIVO, ["revrod-demo"]),
    null,
    "con archivo presente no hay anomalía",
  );
  const wtSolo = makeTmp();
  fs.mkdirSync(path.join(wtSolo, "Zeta"), { recursive: true });
  assert.equal(
    detectCreatedFilesAnomaly(wtSolo, PROMPT_CARPETA_SOLA, ["Zeta"]),
    null,
    "carpeta sola vacía no es H-012 (trivial intacto)",
  );
});

test("H-012: anomaly con entrega vacía ([]) también falla si falta el archivo", () => {
  const wt = makeTmp();
  fs.mkdirSync(path.join(wt, "revrod-demo"), { recursive: true });
  const reason = detectCreatedFilesAnomaly(wt, PROMPT_CARPETA_ARCHIVO, []);
  assert.ok(reason && reason.includes("H-012"), "el [] no es pass ciego cuando falta el archivo");
  const wtBare = makeTmp();
  assert.equal(
    detectCreatedFilesAnomaly(wtBare, "otro prompt neutro", []),
    null,
    "sin carpeta en disco el [] sigue sin anomalía (nonode intacto)",
  );
});

test("H-012: verification con carpeta vacía da fail (jamás pass)", async () => {
  const wt = makeTmp();
  const dir = makeTmp();
  fs.mkdirSync(path.join(wt, "revrod-demo"), { recursive: true });
  const svc = new VerificationService();
  const report = await svc.run(wt, dir, PROMPT_CARPETA_ARCHIVO, ["revrod-demo"]);
  assert.equal(report.overall, "fail");
  assert.equal(report.steps[0].status, "fail");
  assert.match(report.steps[0].logSnippet ?? "", /H-012/);
  assert.match(report.steps[0].logSnippet ?? "", /ausente/);
});

test("H-012: punta a punta con LLM caído (mock) → parado en Building, changed 0, nota en timeline", async () => {
  const wt = makeTmp();
  workItemStore.clear();
  const holderExec = runnerExecutor as unknown as Record<string, unknown>;
  const prevSetup = holderExec["executeSetup"];
  holderExec["executeSetup"] = async () => ({
    name: "setup",
    command: "corepack enable",
    exitCode: 0,
    durationMs: 5,
    status: "pass",
    logSnippet: "mock setup pass (H-012)",
    logPath: "logs/build.log",
    isolation: "none",
  });
  const holderAgent = implementAgent as unknown as Record<string, unknown>;
  const prevConsume = holderAgent["consume"];
  const jobId = "job-h12empty01";
  holderAgent["consume"] = async () => {
    const files = fallbackMinimalChange({ id: jobId, prompt: PROMPT_CARPETA_ARCHIVO, worktree: wt });
    return { createdFiles: files, modifiedFiles: files, durationMs: 2, strategy: "fallback" };
  };
  try {
    const created = workItemStore.create({ id: jobId, prompt: PROMPT_CARPETA_ARCHIVO, worktree: wt });
    workItemStore.transition(created.id, "Foreman", "foreman", "test → Foreman");
    const building = workItemStore.transition(jobId, "Building", "foreman", "test → Building");
    const out = await implementService.handleBuilding(building);
    assert.ok(out, "handleBuilding debe devolver el item");
    assert.equal(workItemStore.get(jobId)?.status, "Building", "cero kept + archivo ausente → parado en Building (flujo simple)");
    assert.deepEqual(workItemStore.get(jobId)?.createdFiles ?? [], [], "createdFiles [] honesto (no carpeta vacía)");
    const timeline = workItemStore.get(jobId)?.timeline ?? [];
    const changed = timeline.find((e) => e.message.startsWith("implement:changed"));
    assert.ok(changed, "debe existir el evento de conteo");
    assert.match(changed?.message ?? "", /changed 0 files/, "el conteo no incluye la carpeta vacía");
    assert.match(changed?.message ?? "", /strategy=fallback/);
    const dropped = timeline.find((e) => e.message.includes("descartadas"));
    assert.ok(dropped, "conciliación con nota en timeline");
    assert.match(dropped?.message ?? "", /H-012/);
    assert.ok(!timeline.some((e) => e.to === "Triage"), "sin transición a Triage (queda parado)");
    const resultPath = path.join(wt, ".agents", "factory", jobId, "result.json");
    assert.ok(fs.existsSync(resultPath), "evidencia en disco: result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as Record<string, unknown>;
    assert.deepEqual(result.createdFiles, [], "result.json honesto");
    assert.equal((result.verification as { overall?: string })?.overall, "fail");
    assert.equal(fs.existsSync(path.join(wt, "revrod-demo")), true, "la carpeta existe en disco");
    assert.equal(fs.existsSync(path.join(wt, "revrod-demo", "ficha.txt")), false, "el archivo pedido sigue ausente");
  } finally {
    if (prevSetup === undefined) delete holderExec["executeSetup"];
    else holderExec["executeSetup"] = prevSetup;
    if (prevConsume === undefined) delete holderAgent["consume"];
    else holderAgent["consume"] = prevConsume;
    workItemStore.clear();
    try {
      fs.rmSync(wt, { recursive: true, force: true });
    } catch {}
  }
});

test("H-001 intacta: literal sigue yendo a su camino (no lo muerde H-012)", () => {
  const literal = "demo-e2e2 con un archivo leemetxt";
  assert.equal(isLiteralFolderName(PROMPT_DEMO_H001, literal), true, "precondición: es literal");
  assert.equal(isLiteralFolderName(PROMPT_DEMO_H001, "demo-e2e2"), false, "la exacta no es literal");
  assert.ok(
    typeof fallbackNeedsTriage("Creá una carpeta") === "string",
    "sin parse confiable sigue a triage (H-001)",
  );
  assert.equal(fallbackNeedsTriage(PROMPT_DEMO_H001), null, "parse confiable sigue camino normal");
  const wt = makeTmp();
  fs.mkdirSync(path.join(wt, literal), { recursive: true });
  const reason = detectCreatedFilesAnomaly(wt, PROMPT_DEMO_H001, [literal]);
  assert.ok(reason && reason.includes("H-001"), "la literal vacía sigue dando H-001 (no H-012)");
  assert.doesNotMatch(reason ?? "", /H-012/);
});
