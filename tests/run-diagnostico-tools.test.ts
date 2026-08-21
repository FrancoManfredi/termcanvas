import test from "node:test";
import assert from "node:assert/strict";
import {
  run,
  exitedNormally,
  safeJson,
  toolFailureReason,
  degradeTool,
  runTool,
} from "../scripts/run-diagnostico-tools.mjs";

// El pipeline de herramientas (scripts/run-diagnostico-tools.mjs) NUNCA debe
// reportar "error" por fallos de una herramienta: un timeout, un desborde de
// buffer o un spawn roto degradan a "no_evaluada" con motivo legible, y el
// output parcial queda disponible para debug. Estos tests fijan esa garantía
// (regresión del caso eslint "Command failed" en education-games).

function makeCtx() {
  const record = {
    status: "ok",
    error: null,
    findings_count: 0,
    files_scanned: null,
    lines_scanned: null,
    duration_ms: 0,
    note: null,
  };
  const raws: Array<[string, string]> = [];
  const ctx = {
    record,
    raw: async (name: string, content: string) => {
      raws.push([name, content]);
    },
  };
  return { ctx, raws };
}

// ─── run(): nunca tira por fallos de ejecución ────────────────────────────

test("run: exit 0 devuelve ok con stdout capturado", async () => {
  const res = await run(process.execPath, ["-e", "console.log('hola')"]);
  assert.equal(res.ok, true);
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), "hola");
  assert.equal(res.timedOut, false);
  assert.equal(res.errorMessage, null);
});

test("run: exit != 0 devuelve el output COMPLETO (las tools señalizan hallazgos así)", async () => {
  const res = await run(process.execPath, [
    "-e",
    "console.log('out'); console.error('err'); process.exit(3)",
  ]);
  assert.equal(res.ok, false);
  assert.equal(res.code, 3);
  assert.equal(res.stdout.trim(), "out");
  assert.equal(res.stderr.trim(), "err");
  assert.equal(res.timedOut, false);
  assert.match(String(res.errorMessage), /exit 3/);
});

test("run: timeout NO tira — devuelve timedOut con el output parcial", async () => {
  const res = await run(
    process.execPath,
    ["-e", "console.log('parcial'); setTimeout(() => {}, 60000)"],
    { timeoutMs: 800 },
  );
  assert.equal(res.ok, false);
  assert.equal(res.timedOut, true);
  assert.equal(res.code, null);
  assert.match(res.stdout, /parcial/);
  assert.match(String(res.errorMessage), /cortado/);
});

test("run: maxBuffer excedido NO tira — devuelve motivo sin perder el output", async () => {
  const res = await run(
    process.execPath,
    ["-e", "process.stdout.write('x'.repeat(1000000))"],
    { maxBuffer: 1024 },
  );
  assert.equal(res.ok, false);
  assert.equal(res.code, null);
  assert.equal(res.timedOut, false);
  assert.match(String(res.errorMessage), /maxBuffer/);
});

// ─── exitedNormally / safeJson ────────────────────────────────────────────

test("exitedNormally: solo exit numérico cuenta como corrida completa", () => {
  assert.equal(exitedNormally({ code: 0 }), true);
  assert.equal(exitedNormally({ code: 2 }), true);
  assert.equal(exitedNormally({ code: null }), false);
});

test("safeJson: parsea o devuelve null sin tirar", () => {
  assert.deepEqual(safeJson("[1,2]"), [1, 2]);
  assert.deepEqual(safeJson('{"a":1}'), { a: 1 });
  assert.equal(safeJson(""), null);
  assert.equal(safeJson("{no es json"), null);
  assert.equal(safeJson(undefined), null);
});

// ─── toolFailureReason: motivo legible, jamás "Command failed" ────────────

test("toolFailureReason: timeout / exit / genérico", () => {
  const timeout = toolFailureReason(
    { timedOut: true, errorMessage: "proceso cortado (SIGKILL) — output parcial", stdout: "", stderr: "" },
    "eslint",
  );
  assert.match(timeout, /eslint no terminó a tiempo/);
  assert.ok(!timeout.includes("Command failed"));

  const exitErr = toolFailureReason(
    { timedOut: false, errorMessage: "exit 2", stdout: "", stderr: "Oops! Something went wrong! :(" },
    "tsc",
  );
  assert.match(exitErr, /tsc falló con exit 2/);
  assert.match(exitErr, /Oops/);

  const generic = toolFailureReason(
    { timedOut: false, errorMessage: null, stdout: "", stderr: "" },
    "npm-audit",
  );
  assert.match(generic, /npm-audit no produjo salida válida/);
});

// ─── degradeTool: degrada a no_evaluada y guarda el output parcial ────────

test("degradeTool: marca no_evaluada con motivo y guarda output parcial", async () => {
  const { ctx, raws } = makeCtx();
  const res = {
    ok: false,
    stdout: "soy un json a medias",
    stderr: "",
    code: null,
    signal: "SIGKILL",
    timedOut: true,
    errorMessage: "proceso cortado (SIGKILL) — output parcial",
  };
  const out = await degradeTool(ctx, res as never, "eslint");
  assert.equal(ctx.record.status, "no_evaluada");
  assert.match(ctx.record.error, /eslint no terminó a tiempo/);
  assert.deepEqual(out, { findings: [] });
  assert.equal(raws.length, 1);
  assert.match(raws[0][1], /soy un json a medias/);
});

// ─── runTool: un tool degradado nunca produce "error" ni "Command failed" ─

test("runTool: tool que degrada → no_evaluada en el registro y en el log", async () => {
  const writes: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: string) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    const { record } = await runTool(
      { key: "eslint", pkg: "backend" },
      async (ctx) => {
        ctx.record.status = "no_evaluada";
        ctx.record.error = "eslint no terminó a tiempo (output parcial guardado en raw)";
        return { findings: [] };
      },
    );
    assert.equal(record.status, "no_evaluada");
    assert.ok(record.duration_ms >= 0);
    const log = writes.join("");
    assert.match(log, /eslint \(backend\) — no_evaluada/);
    assert.ok(!log.includes("Command failed"));
    assert.ok(!log.includes(" — error:"));
  } finally {
    process.stdout.write = origWrite;
  }
});

test("runTool: tool ok → estado ok, duración poblada y log ok", async () => {
  const writes: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: string) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    const { record } = await runTool(
      { key: "knip", pkg: "frontend" },
      async () => ({ findings: [{ a: 1 }], files: 3 }),
    );
    assert.equal(record.status, "ok");
    assert.equal(record.findings_count, 1);
    assert.equal(record.files_scanned, 3);
    assert.ok(record.duration_ms >= 0);
    assert.match(writes.join(""), /knip \(frontend\) — ok \(1 hallazgo\(s\), 3 archivos\)/);
  } finally {
    process.stdout.write = origWrite;
  }
});

test("runTool: throw interno (bug del orquestador) → error, pero NO un 'Command failed' de la tool", async () => {
  const writes: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: string) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    const { record } = await runTool(
      { key: "semgrep", pkg: null },
      async () => {
        throw new Error("bug interno del orquestador");
      },
    );
    assert.equal(record.status, "error");
    assert.equal(record.findings_count, 0);
  } finally {
    process.stdout.write = origWrite;
  }
});
