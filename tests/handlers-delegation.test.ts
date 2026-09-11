/**
 * TANDA A — delegación de handlers restantes a jobs/ (lista, detalle,
 * result/build-log Ola 3, cancel, snapshot de eventos SSE).
 *
 * Contrato de delegación (NO duplica asserts de negocio, solo delegación):
 * - Por cada handler mudado: el cascarón delega (parse → dominio → respuesta)
 *   en ≤15 líneas de código con formas/códigos/textos byte-idénticos.
 * - La decisión vive en jobs/jobService (ops nuevas TANDA A + `readJobBuildLog`
 *   y `getJobEventsSnapshot` ya existentes); el 404 del detalle vive en el
 *   cascarón (lectura directa, sin lógica) y se pinea por estática.
 * - 404/409 intactos por comportamiento en result/build-log/cancel/eventos.
 * - Carry-overs pineados por estática: foreman-logs (ya ≤15), cable SSE
 *   (timers + registro vivo), health (self-heal del manager).
 * Todo offline en tmp, sin daemon, sin docker, sin LLM.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import {
  applyDashboardUrls,
  getJobEventsSnapshot,
  readJobBuildLog,
  readJobResultRaw,
  requestJobCancel,
  resolveDashboardMigration,
} from "../headless-runtime/factory/jobs/jobService.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "factoryServer.ts"),
  "utf-8",
);
const DOMAIN_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "jobs", "jobService.ts"),
  "utf-8",
);

function blockBetween(startMarker: string, endMarker: string): string {
  const start = SERVER_SRC.indexOf(startMarker);
  assert.ok(start >= 0, `marcador inicio presente: ${startMarker}`);
  const end = SERVER_SRC.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marcador fin presente tras inicio: ${endMarker}`);
  return SERVER_SRC.slice(start, end);
}

/** Líneas de código (no vacías, no comentarios de línea completa). */
function codeLines(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"));
}

function mkTmp(prefix = "tanda-a-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

let seq = 0;
function nextId(tag: string): string {
  seq += 1;
  return `job-tanda-a-${tag}-${seq}-${Date.now().toString(36)}`;
}

const createdIds: string[] = [];
const createdDirs: string[] = [];

function makeJob(tag: string, extra?: { sessionId?: string; dashboardUrl?: string; directory?: string }): { id: string; dir: string } {
  const dir = mkTmp(`tanda-a-${tag}-`);
  const id = nextId(tag);
  workItemStore.create({ id, prompt: `tanda-a ${tag}`, worktree: dir, ...extra });
  createdIds.push(id);
  createdDirs.push(dir);
  return { id, dir };
}

test.after(() => {
  for (const id of createdIds.splice(0)) {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
  }
  for (const dir of createdDirs.splice(0)) rmTmp(dir);
});

function dashboardInfra() {
  return {
    resolveDirectory: (w: string) => w,
    buildDashboardUrl: (sid?: string, d?: string) =>
      sid ? `http://127.0.0.1:4096/${d}/session/${sid}` : "http://127.0.0.1:4096",
  };
}

// ── 0. El dominio expone las ops (hogar de la decisión) ──

test("TA-0 el dominio expone las ops TANDA A (el cascarón no decide)", () => {
  for (const name of [
    "export function applyDashboardUrls(",
    "export function resolveDashboardMigration(",
    "export function readJobResultRaw(",
    "export function requestJobCancel(",
  ]) {
    assert.ok(DOMAIN_SRC.includes(name), `jobs/jobService expone ${name}`);
  }
  for (const call of [
    "applyDashboardUrlsTA(",
    "resolveDashboardMigrationTA(",
    "readJobResultRawTA(",
    "requestJobCancelTA(",
    "getJobEventsSnapshot(",
    "readJobBuildLog(",
  ]) {
    assert.ok(SERVER_SRC.includes(call), `el cascarón llama al dominio: ${call}`);
  }
});

// ── A. LIST: merge dashboard delegado ──

test("TA-A1 lista delega el merge (cero cálculo inline)", () => {
  const block = blockBetween("// ── LIST JOBS ── (TANDA A", "// ── FOREMAN LOGS");
  assert.ok(block.includes("applyDashboardUrlsTA(getAllJobsForList()"), "merge por el dominio");
  assert.ok(!block.includes("dirField"), "sin cálculo dirField inline");
  assert.ok(!block.includes("effUrl"), "sin cálculo effUrl inline");
  assert.ok(!block.includes("resolveOpencodeDirectory(j"), "sin llamada inline (solo referencia inyectada)");
});

test("TA-A2 lista compacta: full + rama ?view=summary ≤24 líneas (parse→dominio→respuesta)", () => {
  const block = blockBetween("// ── LIST JOBS ── (TANDA A", "// ── FOREMAN LOGS");
  const lines = codeLines(block);
  // La rama summary (poll 2.5s del warp) sumó ~9 líneas al handler: el
  // presupuesto original de 15 ya no representaba el contrato real.
  assert.ok(lines.length <= 24, `lista compacta, son ${lines.length}`);
  assert.ok(block.includes("pathname === \"/work-items\""), "alias dual intacto");
});

test("TA-A3 lista: forma del merge (con sessionId reconstruye con el puerto actual; sin sessionId respeta presente)", () => {
  const infra = dashboardInfra();
  const out = applyDashboardUrls(
    [
      { id: "a", sessionId: "s1", directory: "/d1", worktree: "/wt" },
      { id: "b", sessionId: "s2", directory: "/d2", worktree: "/wt", dashboardUrl: "http://127.0.0.1:24511/viejo" },
      { id: "c", worktree: "/wt", dashboardUrl: "http://historico" },
    ],
    infra,
  );
  assert.equal(out[0].dashboardUrl, "http://127.0.0.1:4096//d1/session/s1");
  assert.equal(out[1].dashboardUrl, "http://127.0.0.1:4096//d2/session/s2", "URL vieja de otro puerto se refresca");
  assert.equal(out[2].dashboardUrl, "http://historico", "sin sessionId se respeta el histórico");
});

test("TA-A4 lista: directory vacío usa resolve (semántica || intacta)", () => {
  let resolved = 0;
  const out = applyDashboardUrls(
    [{ id: "a", sessionId: "s", directory: "", worktree: "/wt" }],
    { resolveDirectory: (w: string) => { resolved += 1; return `${w}-r`; }, buildDashboardUrl: (sid?: string, d?: string) => `u:${d}:${sid}` },
  );
  assert.equal(resolved, 1);
  assert.equal(out[0].dashboardUrl, "u:/wt-r:s");
});

// ── B. DETAIL: decisión de migración delegada ──

test("TA-B1 detalle delega la decisión (cero cómputo inline)", () => {
  const block = blockBetween("// ── SINGLE JOB:", "// ── FIN FASE 1 E1 — Bloque Rutas lista/detalle/salud");
  assert.ok(block.includes("resolveDashboardMigrationTA("), "decisión por el dominio");
  assert.ok(block.includes("getSingleJobResponse(id)"), "respuesta por el helper (vista única intacta)");
  assert.ok(block.includes("persistSingleStore(id)"), "persistencia por el punto único");
  assert.ok(!block.includes("effectiveDashboardUrl"), "sin cómputo inline");
  assert.ok(!block.includes("effectiveDirectoryForGet"), "sin cómputo inline");
  assert.ok(block.includes("job not found: ${id}"), "404 intacto en el cascarón");
});

test("TA-B2 detalle ≤15 líneas de código", () => {
  const block = blockBetween("// ── SINGLE JOB:", "// ── FIN FASE 1 E1 — Bloque Rutas lista/detalle/salud");
  const lines = codeLines(block);
  assert.ok(lines.length <= 15, `detalle compacto, son ${lines.length}`);
});

test("TA-B3 detalle: migra cuando falta (decisión pura del dominio)", () => {
  const mig = resolveDashboardMigration(
    { sessionId: "s9", worktree: "/wt", directory: "/wt" },
    dashboardInfra(),
  );
  assert.deepEqual(mig, {
    dashboardUrl: "http://127.0.0.1:4096//wt/session/s9",
    directory: "/wt",
  });
});

test("TA-B4 detalle: no migra si ya está migrada o sin sesión", () => {
  const infra = dashboardInfra();
  assert.equal(
    resolveDashboardMigration(
      { sessionId: "s9", worktree: "/wt", directory: "/wt", dashboardUrl: "http://127.0.0.1:4096//wt/session/s9" },
      infra,
    ),
    null,
  );
  assert.equal(
    resolveDashboardMigration({ worktree: "/wt", directory: "/wt", dashboardUrl: "http://x" }, infra),
    null,
  );
  assert.equal(resolveDashboardMigration(null as unknown as { worktree: string }, infra), null);
});

// ── C. RESULT / BUILD-LOG Ola 3 ──

test("TA-C1 resultado delega lectura cruda (cero fs inline)", () => {
  const block = blockBetween("// ── Ola 3: GET", "// ── Ola 4: GET /factory/jobs/:id/review");
  assert.ok(block.includes("readJobResultRawTA(id)"), "result por el dominio");
  assert.ok(block.includes("readJobBuildLog(id)"), "build-log por el dominio");
  assert.ok(block.includes("text/plain; charset=utf-8"), "content-type texto intacto");
  assert.ok(!block.includes("result.json"), "sin paths inline");
  assert.ok(!block.includes("readFileSync"), "sin fs inline");
  assert.ok(!block.includes("existsSync"), "sin fs inline");
});

test("TA-C2 resultado ≤15 líneas de código (ambas ramas)", () => {
  const block = blockBetween("// ── Ola 3: GET", "// ── Ola 4: GET /factory/jobs/:id/review");
  const lines = codeLines(block);
  assert.ok(lines.length <= 15, `ola3 compacto, son ${lines.length}`);
});

test("TA-C3 resultado: 400/404/404+hint intactos", () => {
  for (const bad of ["", "result", "build-log", "build.log"]) {
    const out = readJobResultRaw(bad);
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.equal(out.code, 400);
      assert.equal(out.error, "missing id for result/build-log");
    }
  }
  const { id } = makeJob("res404");
  const none = readJobResultRaw(id);
  assert.deepEqual(none, {
    ok: false,
    code: 404,
    error: "result not found",
    hint: "job not yet built or verification not finished",
  });
});

test("TA-C4 resultado: 404 job ausente con texto exacto", () => {
  const out = readJobResultRaw("job-tanda-a-falta-1");
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.code, 404);
    assert.equal(out.error, "job not found: job-tanda-a-falta-1");
  }
});

test("TA-C5 resultado: 200 sirve el archivo tal cual (crudo byte-idéntico)", () => {
  const { id } = makeJob("res200");
  const wi = workItemStore.get(id);
  assert.ok(wi?.dir);
  const payload = { jobId: id, status: "pass", summary: "ok", tandaA_extra: [1, 2, 3] };
  fs.writeFileSync(path.join(wi.dir as string, "result.json"), JSON.stringify(payload), "utf-8");
  const out = readJobResultRaw(id);
  assert.equal(out.ok, true);
  if (out.ok) assert.deepEqual(out.payload, payload);
});

test("TA-C6 resultado: 500 ante json corrupto con texto exacto", () => {
  const { id } = makeJob("res500");
  const wi = workItemStore.get(id);
  assert.ok(wi?.dir);
  fs.writeFileSync(path.join(wi.dir as string, "result.json"), "no-json{{{", "utf-8");
  const out = readJobResultRaw(id);
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.code, 500);
    assert.ok(out.error.startsWith("failed to read result.json: "));
  }
});

test("TA-C7 resultado: 404 sin dir con texto exacto", () => {
  const { id } = makeJob("resnodir");
  const wi = workItemStore.get(id);
  assert.ok(wi);
  (wi as { dir: string | null }).dir = null;
  const out = readJobResultRaw(id);
  assert.deepEqual(out, { ok: false, code: 404, error: "no dir for job" });
});

test("TA-C8 build-log: 400/404/ausente intactos", () => {
  const bad = readJobBuildLog("result");
  assert.deepEqual(bad, { ok: false, code: 400, error: "missing id for result/build-log" });
  const miss = readJobBuildLog("job-tanda-a-falta-2");
  assert.deepEqual(miss, { ok: false, code: 404, error: "job not found: job-tanda-a-falta-2" });
  const { id } = makeJob("log404");
  const wi404 = workItemStore.get(id);
  assert.ok(wi404?.dir);
  // El store asegura logs/build.log vacío al crear (igual para el bloque
  // anterior): se quitan ambos candidatos para el caso ausente.
  fs.rmSync(path.join(wi404.dir as string, "logs", "build.log"), { force: true });
  fs.rmSync(path.join(wi404.dir as string, "build.log"), { force: true });
  assert.deepEqual(readJobBuildLog(id), { ok: false, code: 404, error: "build.log not found" });
});

test("TA-C9 build-log: prefiere logs/build.log y cae a build.log", () => {
  const { id } = makeJob("logpref");
  const wi = workItemStore.get(id);
  assert.ok(wi?.dir);
  const dir = wi.dir as string;
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "logs", "build.log"), "PRIMARY", "utf-8");
  fs.writeFileSync(path.join(dir, "build.log"), "ALT", "utf-8");
  assert.deepEqual(readJobBuildLog(id), { ok: true, text: "PRIMARY" });
  fs.rmSync(path.join(dir, "logs", "build.log"));
  assert.deepEqual(readJobBuildLog(id), { ok: true, text: "ALT" });
});

// ── D. CANCEL ──

test("TA-D1 cancel delega transición (cero guards inline)", () => {
  const block = blockBetween("// ── CANCEL: POST", "// ── FASE 3 E1 — Bloque Rutas measure");
  assert.ok(block.includes("requestJobCancelTA("), "transición por el dominio");
  assert.ok(block.includes("appendSingleStoreLog(outC.id"), "log por el punto único");
  assert.ok(block.includes("foremanLogStore.info("), "aviso foreman intacto");
  assert.ok(!block.includes("transition("), "sin transición inline");
  assert.ok(!block.includes("already"), "sin regla terminal inline");
});

test("TA-D2 cancel ≤15 líneas de código", () => {
  const block = blockBetween("// ── CANCEL: POST", "// ── FASE 3 E1 — Bloque Rutas measure");
  const lines = codeLines(block);
  assert.ok(lines.length <= 15, `cancel compacto, son ${lines.length}`);
});

test("TA-D3 cancel: 404 intacto + 200 con forma exacta", () => {
  const miss = requestJobCancel("job-tanda-a-falta-3");
  assert.deepEqual(miss, { ok: false, code: 404, error: "job not found: job-tanda-a-falta-3" });
  const { id } = makeJob("cancel200");
  const out = requestJobCancel(id);
  assert.deepEqual(out, { ok: true, id, state: "error", status: "Cancelled" });
  assert.equal(workItemStore.get(id)?.status, "Cancelled");
});

test("TA-D4 cancel: 409 intacto (doble cancel + job Complete)", () => {
  const { id } = makeJob("cancel409");
  assert.ok(requestJobCancel(id).ok);
  assert.deepEqual(requestJobCancel(id), { ok: false, code: 409, error: "job already error" });
  const done = makeJob("canceldone");
  workItemStore.transition(done.id, "Foreman", "user", "t1");
  workItemStore.transition(done.id, "Building", "user", "t2");
  workItemStore.transition(done.id, "Complete", "user", "t3");
  assert.deepEqual(requestJobCancel(done.id), { ok: false, code: 409, error: "job already done" });
});

// ── E. SSE: snapshot delegado, cable intacto (carry-over parcial) ──

test("TA-E1 eventos delega el snapshot (cero resolución inline)", () => {
  const block = blockBetween("// ── SSE: /factory/jobs/:id/events", "// ── Ola 3: GET");
  assert.ok(block.includes("getJobEventsSnapshot(id)"), "snapshot por el dominio");
  assert.ok(block.includes("snapTA.logs") || block.includes("snapTA.state"), "usa el snapshot");
  assert.ok(!block.includes("const target = wi;"), "sin resolución inline");
  assert.ok(!block.includes("?? mapStatusToLegacyState(wi.status)"), "sin regla inline");
});

test("TA-E2 eventos: cable vivo intacto en el cascarón (carry-over)", () => {
  const block = blockBetween("// ── SSE: /factory/jobs/:id/events", "// ── Ola 3: GET");
  assert.ok(block.includes("sseClients"), "registro vivo intacto");
  assert.ok(block.includes(": heartbeat"), "latido intacto");
});

test("TA-E3 eventos: 404 + terminal intactos", () => {
  const miss = getJobEventsSnapshot("job-tanda-a-falta-4");
  assert.deepEqual(miss, { ok: false, code: 404, error: "job not found: job-tanda-a-falta-4" });
  const { id } = makeJob("evt");
  const live = getJobEventsSnapshot(id);
  assert.equal(live.ok, true);
  if (live.ok) {
    assert.equal(live.terminal, false);
    assert.equal(live.state, "queued");
    assert.equal(live.status, "Intake");
  }
  assert.ok(requestJobCancel(id).ok);
  const term = getJobEventsSnapshot(id);
  assert.equal(term.ok, true);
  if (term.ok) {
    assert.equal(term.terminal, true);
    assert.equal(term.state, "error");
    assert.equal(term.status, "Cancelled");
  }
});

// ── F. Carry-overs pineados (no migrables sin daemon vivo) ──

test("TA-F1 foreman-logs ya delega en ≤15 líneas (sin mudanza)", () => {
  const block = blockBetween("// ── FOREMAN LOGS", "// ── CREATE JOB (TANDA 2");
  assert.ok(block.includes("foremanLogStore.list("), "lectura por el store dueño");
  const lines = codeLines(block);
  assert.ok(lines.length <= 15, `foreman-logs compacto, son ${lines.length}`);
});

test("TA-F2 health carry-over: self-heal del manager queda en el cascarón", () => {
  assert.ok(SERVER_SRC.includes("lastManagerKickMs"), "debounce del self-heal en el cascarón");
  assert.ok(SERVER_SRC.includes("opencodeServerManager.ensureClient()"), "efecto vivo en el cascarón");
  assert.ok(SERVER_SRC.includes("buildHealthPayloadE2("), "payload ya delega en health/");
});
