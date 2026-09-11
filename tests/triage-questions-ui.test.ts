/**
 * Suite E2 (H-002 UI + H-003 campana, lab E2E).
 *
 * Todo offline, sin daemon: helpers puros + store real en worktree temporal
 * + guards estáticos sobre los .tsx (patrón E2 Ola 17/19: sin montar React
 * pesado). El re-disparo del foreman vive SOLO en el handler HTTP vía
 * setImmediate (no se testea acá: requeriría LLM); `applyTriageRespondTransition`
 * es la transición síncrona testeable sin daemon ni red.
 *
 * ESM puro, cero `require()`. Fetch inyectado solo en tests (stub).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildTriageDeriveUrl,
  buildTriageRespondUrl,
  extractTriageInfo,
  normalizeTriageAnswers,
  postTriageRespond,
} from "../src/features/factoryLab/components/triageUi.ts";
import { readCreatedFiles } from "../src/features/factoryLab/components/workItemSummary.ts";
import {
  applyTriageRespondTransition,
  checkTriageRespondGuards,
  parseTriageRespondBody,
  parseTriageRespondPath,
} from "../headless-runtime/factory/factoryServer.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

// ── Lectura estática de fuentes (patrón Ola 17/19: los .tsx no se montan) ──

const REPO = new URL("..", import.meta.url);
function readSrc(rel: string): string {
  return fs.readFileSync(new URL(rel, REPO), "utf-8");
}

const TRIAGE_NO_QUESTIONS_SRC = readSrc("src/features/factoryLab/components/TriageQuestions.tsx");

// ── H-002: parse/render de openQuestions ────────────────────────────────

const TRIAGE_META = {
  decision: "triage",
  scope: "mejora abierta del proyecto",
  complexity: "simple",
  openQuestions: [
    "¿En qué área del proyecto ves la oportunidad (código, docs, tests)?",
    "¿Con qué criterio medimos que la mejora valió la pena?",
    "¿Qué restricciones hay (archivos intocables, costo, riesgo)?",
  ],
  reason: "Pedido vago: sin área, objetivo ni criterio no se puede construir.",
  confidence: 0.86,
};

function triageTimeline() {
  return [
    { id: "job-t1-t0", from: "Intake", to: "Intake", at: new Date().toISOString(), actor: "user", message: "created" },
    {
      id: "job-t1-t1",
      from: "Foreman",
      to: "Triage",
      at: new Date().toISOString(),
      actor: "foreman",
      message: "triaged: pedido vago",
      meta: {
        foremanDecision: { decision: "needs_triage", reason: TRIAGE_META.reason, confidence: 0.86 },
        triage: TRIAGE_META,
      },
    },
  ];
}

test("H-002: con LLM sano extrae las 3 openQuestions + reason/confidence", () => {
  const info = extractTriageInfo(triageTimeline());
  assert.equal(info.hasQuestions, true);
  assert.deepEqual(info.openQuestions, TRIAGE_META.openQuestions);
  assert.equal(info.reason, TRIAGE_META.reason);
  assert.equal(info.confidence, 0.86);
  assert.equal(info.decision, "needs_triage");
});

test("H-002: sin preguntas muestra reason + hasQuestions=false (mensaje honesto, sin romper)", () => {
  const timeline = [
    {
      id: "t0",
      from: "Foreman",
      to: "Triage",
      at: new Date().toISOString(),
      actor: "foreman",
      message: "triaged",
      meta: { foremanDecision: { decision: "needs_triage", reason: "Ambiguo", confidence: 0.8 } },
    },
  ];
  const info = extractTriageInfo(timeline);
  assert.equal(info.hasQuestions, false);
  assert.deepEqual(info.openQuestions, []);
  assert.equal(info.reason, "Ambiguo");
  // El .tsx muestra este texto honesto en ese caso (guard estático abajo).
  assert.match(TRIAGE_NO_QUESTIONS_SRC, /sin preguntas concretas/);
});

test("H-002: timeline vacío/basura nunca rompe", () => {
  for (const bad of [null, undefined, [], "x", 42, [{ no: "meta" }]]) {
    const info = extractTriageInfo(bad);
    assert.equal(info.hasQuestions, false);
    assert.deepEqual(info.openQuestions, []);
  }
});

test("H-002: ignora preguntas vacías/no-string y topa en 10", () => {
  const big = Array.from({ length: 15 }, (_, i) => `  pregunta ${i}  `);
  const info = extractTriageInfo([
    { id: "t", from: "A", to: "B", at: "x", actor: "system", message: "m", meta: { triage: { openQuestions: [null, "", "  ", ...big, 42] } } },
  ]);
  assert.equal(info.openQuestions.length, 10);
  assert.equal(info.openQuestions[0], "pregunta 0");
});

// ── H-002: endpoint respond (puros + transición real sin daemon) ────────

test("triage-respond path: factory y alias parsean id", () => {
  assert.deepEqual(parseTriageRespondPath("/factory/jobs/job-abc/triage/respond"), {
    id: "job-abc",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseTriageRespondPath("/work-items/job-abc/triage/respond"), {
    id: "job-abc",
    isWorkItemsAlias: true,
  });
});

test("triage-respond path: rechaza ruta ajena, sin id y traversal", () => {
  assert.ok("error" in parseTriageRespondPath("/factory/jobs/job-abc/review/accept"));
  assert.ok("error" in parseTriageRespondPath("/factory/jobs/triage/respond"));
  assert.ok("error" in parseTriageRespondPath("/factory/jobs/../triage/respond"));
  assert.ok("error" in parseTriageRespondPath("/factory/jobs/a/extra/triage/respond"));
  assert.ok("error" in parseTriageRespondPath("/factory/jobs/triage/triage/respond"));
});

test("triage-respond guards: 404 sin job / ok solo en Triage / 409 resto", () => {
  const g404 = checkTriageRespondGuards(null, "job-x");
  assert.equal(g404.ok, false);
  if (!g404.ok) assert.equal(g404.code, 404);
  assert.deepEqual(checkTriageRespondGuards({ status: "Triage" }, "job-x"), { ok: true });
  for (const status of ["Intake", "Foreman", "Building", "Review", "Complete", "Cancelled", undefined, 42]) {
    const g = checkTriageRespondGuards({ status }, "job-x");
    assert.equal(g.ok, false, `status=${String(status)} debería ser 409`);
    if (!g.ok) assert.equal(g.code, 409);
  }
});

test("triage-respond body: acepta answers útiles, 400 resto", () => {
  assert.deepEqual(parseTriageRespondBody({ answers: [" área X ", "", "criterio Y"] }), {
    ok: true,
    answers: ["área X", "criterio Y"],
  });
  for (const bad of [{}, { answers: [] }, { answers: ["   "] }, { answers: "x" }, { answers: [42] }, null, "s"]) {
    const r = parseTriageRespondBody(bad);
    assert.equal(r.ok, false, `body=${JSON.stringify(bad)} debería ser 400`);
    if (!r.ok) assert.match(r.error, /answers must be/);
  }
});

test("triage-respond: 200 lógico — Triage→Foreman con respuestas trazadas (sin daemon)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-e2-"));
  const id = `job-triage-e2-${Date.now().toString(36)}`;
  try {
    workItemStore.create({ id, prompt: "Mejorá algo", worktree: dir });
    workItemStore.transition(id, "Foreman", "system", "test → Foreman");
    workItemStore.transition(id, "Triage", "foreman", "triaged: test", {
      foremanDecision: { decision: "needs_triage", reason: "test", confidence: 0.8 },
      triage: { ...TRIAGE_META, reason: "test" },
    } as unknown as Record<string, unknown>);
    const moved = applyTriageRespondTransition(id, ["área: docs", "criterio: claro"]);
    assert.equal(moved.status, "Foreman");
    const last = moved.timeline[moved.timeline.length - 1];
    assert.equal(last.from, "Triage");
    assert.equal(last.to, "Foreman");
    const prev = moved.timeline[moved.timeline.length - 2];
    assert.match(prev.message, /triage respond \(2 respuestas\)/);
    assert.match(prev.message, /área: docs/);
  } finally {
    workItemStore.clear();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("triage-respond: 404 job inexistente (sin daemon)", () => {
  assert.throws(
    () => applyTriageRespondTransition("job-no-existe-e2", ["algo"]),
    (e: unknown) => (e as { status?: number }).status === 404,
  );
  workItemStore.clear();
});

test("triageUi: URLs por parámetro (cero puertos literales en src) + POST con fetch stub", async () => {
  // Valor arbitrario solo para el stub: nunca se bindea ni se asume (Regla 1).
  const arbitraryPort = 19999;
  assert.equal(
    buildTriageRespondUrl(arbitraryPort, "job-x"),
    "http://127.0.0.1:19999/factory/jobs/job-x/triage/respond",
  );
  assert.equal(
    buildTriageDeriveUrl(arbitraryPort, "job-x"),
    "http://127.0.0.1:19999/factory/jobs/job-x/cancel",
  );
  let seenUrl = "";
  let seenMethod = "";
  let seenBody = "";
  const stubFetch = (async (url: unknown, init?: RequestInit) => {
    seenUrl = String(url);
    seenMethod = String((init as Record<string, unknown>)?.method ?? "");
    seenBody = String((init as Record<string, unknown>)?.body ?? "");
    return new Response(JSON.stringify({ ok: true, status: "Foreman", answers: 2 }), { status: 200 });
  }) as unknown as typeof fetch;
  const res = await postTriageRespond(stubFetch, arbitraryPort, "job-x", ["a", "b"]);
  assert.equal(seenMethod, "POST");
  assert.ok(seenUrl.endsWith("/factory/jobs/job-x/triage/respond"));
  assert.deepEqual(JSON.parse(seenBody), { answers: ["a", "b"] });
  assert.deepEqual(res, { ok: true, status: "Foreman", answers: 2 });
  const failFetch = (async () => new Response(JSON.stringify({ error: "job not in Triage" }), { status: 409 })) as unknown as typeof fetch;
  const fail = await postTriageRespond(failFetch, arbitraryPort, "job-x", ["a"]);
  assert.deepEqual(fail, { ok: false, error: "job not in Triage" });
});

test("normalizeTriageAnswers: null si no hay nada útil", () => {
  assert.equal(normalizeTriageAnswers(["  ", ""]), null);
  assert.equal(normalizeTriageAnswers([]), null);
  assert.equal(normalizeTriageAnswers("x"), null);
  assert.deepEqual(normalizeTriageAnswers([" ok "]), ["ok"]);
});

// ── createdFiles top-level con fallback (migración E1/H-001) ────────────

test("readCreatedFiles: top-level primero, fallback a meta, [] no borra", () => {
  const meta = [{ id: "t", from: "A", to: "B", at: "x", actor: "system", message: "m", meta: { createdFiles: ["demo/meta.txt"] } }];
  assert.deepEqual(
    readCreatedFiles({ timeline: meta, createdFiles: ["demo/top.txt"] } as unknown as Parameters<typeof readCreatedFiles>[0]),
    ["demo/top.txt"],
  );
  assert.deepEqual(
    readCreatedFiles({ timeline: meta } as unknown as Parameters<typeof readCreatedFiles>[0]),
    ["demo/meta.txt"],
  );
  assert.deepEqual(
    readCreatedFiles({ timeline: meta, createdFiles: [] } as unknown as Parameters<typeof readCreatedFiles>[0]),
    ["demo/meta.txt"],
  );
  assert.equal(readCreatedFiles({ timeline: [] } as unknown as Parameters<typeof readCreatedFiles>[0]), null);
});

// ── Guards estáticos (patrón Ola 17/19: el .tsx no se monta) ────────────

test("H-002 estático: WorkItemList cablea TriageQuestions + extractTriageInfo + readCreatedFiles", () => {
  const src = readSrc("src/features/factoryLab/components/WorkItemList.tsx");
  assert.ok(src.includes("TriageQuestions"), "falta render TriageQuestions en la celda Triage");
  assert.ok(src.includes("extractTriageInfo"), "falta lectura de openQuestions");
  assert.ok(src.includes("readCreatedFiles(wi)"), "falta migración createdFiles top-level-first");
});

test("H-002 estático: TriageQuestions ofrece responder/derivar + mensaje honesto", () => {
  assert.ok(TRIAGE_NO_QUESTIONS_SRC.includes("Responder y reanudar"), "falta botón responder");
  assert.ok(TRIAGE_NO_QUESTIONS_SRC.includes("Derivar a humano"), "falta botón derivar");
  assert.ok(TRIAGE_NO_QUESTIONS_SRC.includes("postTriageRespond"), "falta cableado al endpoint");
  assert.ok(!TRIAGE_NO_QUESTIONS_SRC.includes("setInterval"), "prohibido polling nuevo: usa el tick global 2.5s");
});

test("H-002 estático: endpoint vivo en factoryServer sin romper pacts", () => {
  const src = readSrc("headless-runtime/factory/factoryServer.ts");
  assert.ok(src.includes("/triage/respond"), "falta ruta triage/respond");
  assert.ok(src.includes("applyTriageRespondTransition"), "falta transición aplicada");
  assert.ok(src.includes("skipTriageSpec"), "el re-disparo debe reusar el camino spec/approve");
  assert.ok(src.includes("Triage→Foreman"), "documenta la transición existente reusada");
});

test("H-003 estático: panel fixed + clamp de viewport (reapertura corrida 2) + max-height + scroll + z alto", () => {
  const src = readSrc("src/features/factoryLab/components/NotificationsBell.tsx");
  assert.ok(src.includes("fixed"), "el panel debe ser fixed (independiente del overflow paterno)");
  assert.ok(src.includes("max-h-[min(70vh,400px)]"), "falta max-height exacto del diálogo");
  assert.ok(src.includes("overflow-auto"), "falta scroll interno");
  assert.ok(src.includes("z-[100]"), "falta z-index alto exacto");
  // Reapertura corrida 2: anclaje por left clampeado, jamás right sin clamp
  // (el right alineaba el panel de 320px a una campana en x≈167 → clip x<0).
  assert.ok(src.includes("rect.right -"), "falta cálculo left = rect.right - width");
  assert.ok(src.includes("Math.max("), "falta clamp con margen de 8px");
  assert.ok(src.includes("max-w-[min(320px,calc(100vw-16px))]"), "falta max-width que nunca exceda el viewport");
  assert.ok(src.includes("left: anchor.left"), "el diálogo debe anclarse por left clampeado");
  assert.ok(!src.includes("right: anchor.right"), "prohibido el anclaje right sin clamp (causa del clip izquierdo)");
  assert.ok(src.includes("getBoundingClientRect"), "falta anclaje por rect del botón");
  assert.ok(src.includes("max-h-[320px]"), "la lista interna conserva su cap con scroll");
  // Clamp superior análogo + flip hacia arriba si se pasa por abajo.
  assert.ok(src.includes("rect.bottom +"), "falta anclaje vertical bajo la campana");
  assert.ok(src.includes("rect.top -"), "falta apertura hacia arriba si se pasa por abajo");
  const intervals = src.match(/window\.setInterval/g) ?? [];
  assert.equal(intervals.length, 1, "solo el tick existente de 5s; prohibido polling nuevo");
});

test("H-007 estático: botón de modelo con separador textual modelo (provider)", () => {
  const src = readSrc("src/components/settings/ModelCombobox.tsx");
  // El nombre accesible concatenaba label+provider sin separador
  // ("muse-spark-1.2-contributoropencode-go"); el provider va entre paréntesis.
  assert.ok(src.includes("({sel.provider})"), "el provider debe renderizarse entre paréntesis como separador textual");
});
