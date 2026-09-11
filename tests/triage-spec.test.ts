/**
 * Ola 8 — Triage-agent + Spec-agent reales.
 * node:test + tsx. Puro y fallo-sano: schemas, parse tolerante, fallbacks,
 * foremanPrompt con/sin contexto y guards del endpoint spec/approve.
 * No toca el daemon ni muta disco productivo (mocks de prompt inyectados).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TriageFindingsSchema,
  buildFallbackTriageFindings,
  isPactTriageJob,
  validateTriageFindings,
} from "../shared/types/triage.ts";
import {
  SpecBriefSchema,
  buildSpecApprovalMeta,
  getLatestSpecApprovalRequest,
  validateSpecBrief,
} from "../shared/types/spec.ts";
import {
  buildTriagePrompt,
  parseTriageLLMResponse,
  triageJsonSchema,
} from "../headless-runtime/triage/triagePrompt.ts";
import {
  TRIAGE_TOOLS,
  setTriagePromptMock,
  triageAgent,
} from "../headless-runtime/triage/triageAgent.ts";
import {
  getLatestTriage,
  persistTriageJson,
  TRIAGE_JSON_FILE,
} from "../headless-runtime/triage/triageFlow.ts";
import {
  buildSpecPrompt,
  parseSpecLLMResponse,
  specJsonSchema,
} from "../headless-runtime/spec/specPrompt.ts";
import {
  SPEC_TOOLS,
  setSpecPromptMock,
  specAgent,
} from "../headless-runtime/spec/specAgent.ts";
import {
  buildSpecMarkdown,
  checkSpecApproveGuards,
  getLatestSpec,
  hasPendingSpecApproval,
  parseSpecApprovePath,
  parseSpecRejectPath,
  persistSpecMarkdown,
  SPEC_MD_FILE,
} from "../headless-runtime/spec/specFlow.ts";
import {
  buildForemanPrompt,
  buildSpecContextBlock,
  buildTriageContextBlock,
} from "../headless-runtime/foreman/foremanPrompt.ts";

// ── Schemas: brief válido / inválido ──

test("SpecBrief válido pasa y expone defaults", () => {
  const brief = validateSpecBrief({
    summary: "agregar login con tests",
    acceptanceCriteria: ["login ok redirige", "login mal muestra error"],
    targetFiles: ["src/auth.ts"],
    trivial: false,
    openQuestions: ["¿oauth o password?"],
  });
  assert.equal(brief.summary, "agregar login con tests");
  assert.equal(brief.acceptanceCriteria.length, 2);
  assert.equal(brief.trivial, false);
});

test("SpecBrief inválido lanza: sin criterios, summary vacío (sin tope de criterios)", () => {
  assert.throws(() =>
    validateSpecBrief({ summary: "x", acceptanceCriteria: [], targetFiles: [], trivial: true, openQuestions: [] }),
  );
  assert.throws(() =>
    validateSpecBrief({ summary: "", acceptanceCriteria: ["c1"], targetFiles: [], trivial: true, openQuestions: [] }),
  );
  // Sin tope: 1 y 11 criterios ok
  assert.equal(
    validateSpecBrief({ summary: "x", acceptanceCriteria: ["solo"], targetFiles: [], trivial: true, openQuestions: [] }).acceptanceCriteria.length,
    1,
  );
  assert.equal(
    validateSpecBrief({
      summary: "x",
      acceptanceCriteria: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "c11"],
      targetFiles: [],
      trivial: true,
      openQuestions: [],
    }).acceptanceCriteria.length,
    11,
  );
});

test("SpecBriefSchema aplica defaults de arrays ausentes", () => {
  const parsed = SpecBriefSchema.parse({
    summary: "x",
    acceptanceCriteria: ["c1"],
    trivial: true,
  });
  assert.deepEqual(parsed.targetFiles, []);
  assert.deepEqual(parsed.openQuestions, []);
});

// ── Schemas: findings válido / inválido ──

test("TriageFindings válido pasa (las 3 decisiones)", () => {
  for (const decision of ["building", "spec", "triage"] as const) {
    const f = validateTriageFindings({
      decision,
      scope: "alcance",
      complexity: "simple",
      openQuestions: [],
      reason: "motivo",
      confidence: 0.8,
    });
    assert.equal(f.decision, decision);
  }
});

test("TriageFindings inválido lanza: decision y complexity fuera de enum", () => {
  assert.throws(() =>
    validateTriageFindings({ decision: "nonsense", scope: "", complexity: "simple", openQuestions: [], reason: "x", confidence: 0.5 }),
  );
  assert.throws(() =>
    validateTriageFindings({ decision: "building", scope: "", complexity: "enorme", openQuestions: [], reason: "x", confidence: 0.5 }),
  );
  assert.throws(() =>
    validateTriageFindings({ decision: "building", scope: "", complexity: "simple", openQuestions: [], reason: "", confidence: 0.5 }),
  );
});

test("fallback triage: building 0.5 con razón de deferencia y flag", () => {
  const fb = buildFallbackTriageFindings();
  assert.equal(fb.decision, "building");
  assert.equal(fb.confidence, 0.5);
  assert.match(fb.reason, /defiere al foreman/);
  assert.equal(fb.fallback, true);
  // El fallback valida contra el schema
  assert.equal(TriageFindingsSchema.parse(fb).decision, "building");
});

test("isPactTriageJob espeja el gate pact sin literales nuevos", () => {
  assert.equal(isPactTriageJob({ id: "job-abc123", prompt: "x", worktree: "w" }), true);
  assert.equal(isPactTriageJob({ id: "job-f10-xyz", prompt: "x", worktree: "w" }), true);
  assert.equal(isPactTriageJob({ id: "job-xyz-real", prompt: "playground-algo", worktree: "w" }), true);
  assert.equal(isPactTriageJob({ id: "job-mtkvx0rs-real", prompt: "fix auth bug", worktree: "/tmp/repo" }), false);
});

// ── Parse tolerante ──

test("parseTriage tolera fences y texto alrededor", () => {
  const body = JSON.stringify({ decision: "spec", scope: "multi-archivo", complexity: "complex", openQuestions: ["¿qué alcance?"], reason: "necesita plan", confidence: 0.8 });
  const fenced = parseTriageLLMResponse(`\`\`\`json\n${body}\n\`\`\``);
  assert.equal(fenced.decision, "spec");
  const surrounded = parseTriageLLMResponse(`claro que sí, acá va ${body} saludos`);
  assert.equal(surrounded.decision, "spec");
  assert.equal(surrounded.complexity, "complex");
});

test("parseTriage normaliza mayúsculas y lanza sin JSON", () => {
  const upper = parseTriageLLMResponse(
    JSON.stringify({ decision: "BUILDING", scope: "", complexity: "Trivial", openQuestions: [], reason: "claro", confidence: 0.9 }),
  );
  assert.equal(upper.decision, "building");
  assert.equal(upper.complexity, "trivial");
  assert.throws(() => parseTriageLLMResponse("sin json acá"), /no object|parse error/);
  assert.throws(() => parseTriageLLMResponse(""), /vacía/);
});

test("parseSpec tolera fences y trivial como string", () => {
  const body = JSON.stringify({ summary: "brief", acceptanceCriteria: ["c1"], targetFiles: ["a.ts"], trivial: "false", openQuestions: [] });
  const parsed = parseSpecLLMResponse(`texto previo ${body} texto posterior`);
  assert.equal(parsed.trivial, false);
  assert.deepEqual(parsed.targetFiles, ["a.ts"]);
  const fenced = parseSpecLLMResponse(`\`\`\`json\n${body}\n\`\`\``);
  assert.equal(fenced.summary, "brief");
  assert.throws(() => parseSpecLLMResponse(JSON.stringify({ summary: "s", acceptanceCriteria: [], targetFiles: [], trivial: true, openQuestions: [] })), /acceptanceCriteria|Too small/);
});

// ── Fallo-sano con mocks que lanzan ──

test("triage fallo-sano: mock que lanza → fallback building sin throw", async () => {
  setTriagePromptMock(async () => {
    throw new Error("timeout 20000ms triage session.prompt");
  });
  try {
    const out = await triageAgent.consume({
      workItemId: "job-ola8-t01",
      worktreePath: "/tmp/wt",
      model: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
      prompt: "fix auth bug",
    });
    assert.equal(out.findings.decision, "building");
    assert.equal(out.findings.confidence, 0.5);
    assert.equal(out.findings.fallback, true);
  } finally {
    setTriagePromptMock(null);
  }
});

test("triage mock válido → findings reales sin fallback", async () => {
  setTriagePromptMock(async () =>
    JSON.stringify({ decision: "triage", scope: "ambiguo", complexity: "complex", openQuestions: ["¿qué querés?"], reason: "falta contexto", confidence: 0.82 }),
  );
  try {
    const out = await triageAgent.consume({
      workItemId: "job-ola8-t02",
      worktreePath: "/tmp/wt",
      model: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
      prompt: "hace algo",
    });
    assert.equal(out.findings.decision, "triage");
    assert.equal(out.findings.fallback, undefined);
    assert.deepEqual(out.findings.openQuestions, ["¿qué querés?"]);
    assert.ok(out.raw && out.raw.includes("triage"));
  } finally {
    setTriagePromptMock(null);
  }
});

test("spec fallo-sano: mock que lanza → skip con evento trazable, sin throw", async () => {
  setSpecPromptMock(async () => {
    throw new Error("unexpected server error");
  });
  try {
    const out = await specAgent.consume({
      workItemId: "job-ola8-s01",
      worktreePath: "/tmp/wt",
      model: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
      prompt: "agregar login",
    });
    assert.equal(out.brief, null);
    assert.equal(out.skipped, true);
    assert.ok((out.skipReason ?? "").length > 0);
  } finally {
    setSpecPromptMock(null);
  }
});

test("spec mock válido → brief sin skip", async () => {
  setSpecPromptMock(async () =>
    JSON.stringify({ summary: "login mínimo", acceptanceCriteria: ["c1", "c2"], targetFiles: ["src/auth.ts"], trivial: true, openQuestions: [] }),
  );
  try {
    const out = await specAgent.consume({
      workItemId: "job-ola8-s02",
      worktreePath: "/tmp/wt",
      model: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
      prompt: "agregar login",
    });
    assert.equal(out.skipped, false);
    assert.equal(out.brief?.trivial, true);
    assert.equal(out.brief?.acceptanceCriteria.length, 2);
  } finally {
    setSpecPromptMock(null);
  }
});

// ── Tools solo lectura ──

test("triage/spec usan SOLO lectura (sin write/edit/bash)", () => {
  for (const tools of [TRIAGE_TOOLS, SPEC_TOOLS]) {
    const keys = Object.keys(tools).sort();
    assert.deepEqual(keys, ["glob", "grep", "read", "webfetch"]);
  }
  // json_schema exige las keys del contrato
  assert.deepEqual([...triageJsonSchema.required].sort(), ["complexity", "confidence", "decision", "openQuestions", "reason", "scope"]);
  assert.deepEqual([...specJsonSchema.required].sort(), ["acceptanceCriteria", "openQuestions", "summary", "targetFiles", "trivial"]);
});

// ── Prompts incluyen definición versionada y contenido ──

test("buildTriagePrompt/buildSpecPrompt llevan solo datos, sin rol ni reglas", () => {
  const tri = buildTriagePrompt({ id: "job-ola8-p01", prompt: "fix auth bug", worktree: "" });
  assert.ok(tri.includes("fix auth bug"));
  assert.ok(tri.includes("job-ola8-p01"));
  assert.ok(!tri.includes("factory/agents/triage/agent.md"), "sin header");
  assert.ok(!tri.includes("Sos el TRIAGE"), "sin rol (vive en el espejo)");
  assert.ok(!tri.includes('"decision"'), "sin schema en el turno (va por format)");
  const spec = buildSpecPrompt(
    { id: "job-ola8-p02", prompt: "agregar login", worktree: "" },
    { decision: "spec", scope: "auth", complexity: "simple", openQuestions: [], reason: "planeable", confidence: 0.8 },
  );
  assert.ok(spec.includes("agregar login"));
  assert.ok(!spec.includes("factory/agents/spec/agent.md"), "sin header");
  assert.ok(spec.includes("Triage previo"), "el contexto triage viaja");
  assert.ok(!spec.includes("Reglas del brief"), "sin reglas (viven en el espejo)");
});

// ── foremanPrompt con/sin contexto ──

test("buildForemanPrompt sin contexto = output idéntico al actual", () => {
  const input = { prompt: "fix auth bug", worktree: "" };
  const base = buildForemanPrompt(input);
  assert.equal(buildForemanPrompt(input, undefined), base);
  assert.equal(buildForemanPrompt(input, undefined, undefined), base);
  assert.equal(buildForemanPrompt(input, undefined, {}), base);
  const withRepo = buildForemanPrompt(input, "ctx repo");
  assert.equal(buildForemanPrompt(input, "ctx repo", {}), withRepo);
  assert.ok(!base.includes("Triage previo"));
  assert.ok(!base.includes("Spec aprobada"));
});

test("buildForemanPrompt con contexto agrega bloques Triage previo y Spec aprobada", () => {
  const input = { prompt: "agregar login", worktree: "" };
  const out = buildForemanPrompt(input, undefined, {
    triage: { decision: "spec", scope: "auth multi-archivo", complexity: "complex", openQuestions: ["¿oauth?"], reason: "necesita plan", confidence: 0.81 },
    spec: { summary: "login mínimo con password", acceptanceCriteria: ["c1", "c2"], targetFiles: ["src/auth.ts"], trivial: false, openQuestions: [] },
  });
  assert.ok(out.includes("Triage previo"));
  assert.ok(out.includes("decision: spec"));
  assert.ok(out.includes("Spec aprobada"));
  assert.ok(out.includes("login mínimo con password"));
  assert.ok(out.includes("src/auth.ts"));
  // Solo triage también funciona
  const onlyTriage = buildForemanPrompt(input, undefined, {
    triage: { decision: "building", scope: "1 archivo", complexity: "trivial", openQuestions: [], reason: "claro", confidence: 0.9 },
  });
  assert.ok(onlyTriage.includes("Triage previo"));
  assert.ok(!onlyTriage.includes("Spec aprobada"));
});

test("bloques de contexto puros devuelven vacío sin input", () => {
  assert.equal(buildTriageContextBlock(undefined), "");
  assert.equal(buildSpecContextBlock(undefined), "");
});

// ── Timeline: extracción triage/spec y approval ──

function timelineWith(...metas: Array<Record<string, unknown> | undefined>): Array<{ meta?: Record<string, unknown> }> {
  return metas.map((meta, i) => ({ ...(meta ? { meta } : {}) , id: `t${i}` }) as { meta?: Record<string, unknown> });
}

test("getLatestTriage/getLatestSpec devuelven el último válido e ignoran basura", () => {
  const goodTriage = { decision: "spec", scope: "s", complexity: "simple", openQuestions: [], reason: "r", confidence: 0.7 };
  const goodSpec = { summary: "b", acceptanceCriteria: ["c1"], targetFiles: [], trivial: true, openQuestions: [] };
  const wi = {
    timeline: timelineWith({ triage: { decision: "nope" } }, { triage: goodTriage }, { spec: goodSpec }),
  };
  assert.equal(getLatestTriage(wi)?.decision, "spec");
  assert.equal(getLatestSpec(wi)?.summary, "b");
  assert.equal(getLatestTriage({ timeline: [] }), null);
  assert.equal(getLatestSpec(null), null);
  assert.equal(getLatestTriage({ timeline: timelineWith({ otra: 1 }) }), null);
});

test("spec approval meta: build + latest + guards", () => {
  const meta = buildSpecApprovalMeta("resumen del brief");
  assert.equal(meta.needsSpecApproval, true);
  assert.equal(meta.specSummary, "resumen del brief");
  const tl = timelineWith({ foremanDecision: { decision: "building" } }, meta);
  assert.equal(getLatestSpecApprovalRequest(tl)?.specSummary, "resumen del brief");
  assert.equal(getLatestSpecApprovalRequest([]), null);
});

test("spec approval viejo muere ante specApproved/specRejected posterior (anti-loop approve)", () => {
  const req = buildSpecApprovalMeta("brief viejo");
  assert.equal(
    getLatestSpecApprovalRequest(timelineWith(req, { specApproved: true, specSummary: "brief viejo" })),
    null,
    "approve posterior invalida el pedido",
  );
  assert.equal(
    getLatestSpecApprovalRequest(timelineWith(req, { specRejected: true, specSummary: "brief viejo" })),
    null,
    "reject posterior invalida el pedido",
  );
  const req2 = buildSpecApprovalMeta("brief nuevo");
  assert.equal(
    getLatestSpecApprovalRequest(timelineWith(req, { specApproved: true }, req2))?.specSummary,
    "brief nuevo",
    "un pedido nuevo tras el approve vuelve a estar pendiente",
  );
});

// ── Guards del endpoint spec/approve como puras ──

test("parseSpecRejectPath espeja approve con sufijo /spec/reject", () => {
  assert.deepEqual(parseSpecRejectPath("/factory/jobs/job-abc123/spec/reject"), { id: "job-abc123", isWorkItemsAlias: false });
  assert.deepEqual(parseSpecRejectPath("/work-items/job-abc123/spec/reject"), { id: "job-abc123", isWorkItemsAlias: true });
  assert.ok("error" in parseSpecRejectPath("/factory/jobs/job-abc123/spec/reject/extra"));
  assert.ok("error" in parseSpecRejectPath("/factory/jobs/../x/spec/reject"));
  assert.ok("error" in parseSpecRejectPath("/factory/jobs/review/spec/reject"));
  assert.ok("error" in parseSpecRejectPath("/factory/jobs/job-abc123/spec/approve"));
  assert.ok("error" in parseSpecRejectPath(123));
});

test("parseSpecApprovePath espeja el estilo retry-review", () => {
  assert.deepEqual(parseSpecApprovePath("/factory/jobs/job-abc123/spec/approve"), { id: "job-abc123", isWorkItemsAlias: false });
  assert.deepEqual(parseSpecApprovePath("/work-items/job-abc123/spec/approve"), { id: "job-abc123", isWorkItemsAlias: true });
  assert.ok("error" in parseSpecApprovePath("/factory/jobs/job-abc123/spec/approve/extra"));
  assert.ok("error" in parseSpecApprovePath("/factory/jobs/../x/spec/approve"));
  assert.ok("error" in parseSpecApprovePath("/factory/jobs/review/spec/approve"));
  assert.ok("error" in parseSpecApprovePath(123));
});

test("checkSpecApproveGuards: 404 sin job, 409 sin Triage o sin pedido", () => {
  const notFound = checkSpecApproveGuards(null, "job-x");
  assert.equal(notFound.ok, false);
  if (!notFound.ok) assert.equal(notFound.code, 404);
  const wrongStatus = checkSpecApproveGuards({ status: "Building", timeline: [] }, "job-x");
  assert.equal(wrongStatus.ok, false);
  if (!wrongStatus.ok) assert.equal(wrongStatus.code, 409);
  const noApproval = checkSpecApproveGuards({ status: "Triage", timeline: timelineWith({ triage: {} }) }, "job-x");
  assert.equal(noApproval.ok, false);
  if (!noApproval.ok) assert.equal(noApproval.code, 409);
  const ok = checkSpecApproveGuards(
    { status: "Triage", timeline: timelineWith(buildSpecApprovalMeta("brief listo")) },
    "job-x",
  );
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.specSummary, "brief listo");
});

test("hasPendingSpecApproval exige Triage + pedido", () => {
  assert.equal(hasPendingSpecApproval({ status: "Triage", timeline: timelineWith(buildSpecApprovalMeta("s")) }), true);
  assert.equal(hasPendingSpecApproval({ status: "Foreman", timeline: timelineWith(buildSpecApprovalMeta("s")) }), false);
  assert.equal(hasPendingSpecApproval({ status: "Triage", timeline: [] }), false);
  assert.equal(hasPendingSpecApproval(null), false);
});

// ── spec.md y nombres de evidencia ──

test("buildSpecMarkdown incluye resumen, criterios, archivos y trivial", () => {
  const md = buildSpecMarkdown(
    { summary: "login mínimo", acceptanceCriteria: ["c1", "c2"], targetFiles: ["src/auth.ts"], trivial: false, openQuestions: ["¿oauth?"] },
    "job-ola8-m01",
  );
  assert.ok(md.includes("# Spec job-ola8-m01"));
  assert.ok(md.includes("login mínimo"));
  assert.ok(md.includes("- [ ] c1"));
  assert.ok(md.includes("src/auth.ts"));
  assert.ok(md.includes("¿oauth?"));
  assert.ok(md.includes("requiere aprobación humana"));
  const trivialMd = buildSpecMarkdown(
    { summary: "fix", acceptanceCriteria: ["c1"], targetFiles: [], trivial: true, openQuestions: [] },
    "job-ola8-m02",
  );
  assert.ok(trivialMd.includes("auto-skip trazado"));
});

test("nombres de evidencia para disco", () => {
  assert.equal(TRIAGE_JSON_FILE, "triage.json");
  assert.equal(SPEC_MD_FILE, "spec.md");
  assert.equal(typeof persistTriageJson, "function");
  assert.equal(typeof persistSpecMarkdown, "function");
});

test("composición foreman: timeline → getLatest* → prompt con bloques (espejo de decideWithLLM)", () => {
  const at = "2026-09-03T00:00:00.000Z";
  const wi = {
    prompt: "crear carpeta demo",
    worktree: "/tmp/demo",
    timeline: [
      { id: "t0", from: "Intake", to: "Intake", at, actor: "user", message: "created Intake" },
      {
        id: "t1", from: "Intake", to: "Foreman", at, actor: "foreman", message: "triage",
        meta: {
          triage: {
            decision: "spec", scope: "carpeta demo", complexity: "simple",
            openQuestions: [], reason: "requiere plan", confidence: 0.8,
          },
        },
      },
      {
        id: "t2", from: "Foreman", to: "Foreman", at, actor: "foreman", message: "spec",
        meta: {
          spec: {
            summary: "crear carpeta demo", acceptanceCriteria: ["existe demo/"],
            targetFiles: [], trivial: true, openQuestions: [],
          },
        },
      },
    ],
  } as unknown as Parameters<typeof getLatestTriage>[0];
  const triage = getLatestTriage(wi);
  const spec = getLatestSpec(wi);
  assert.ok(triage);
  assert.ok(spec);
  const out = buildForemanPrompt(
    { prompt: "crear carpeta demo", worktree: "/tmp/demo" },
    undefined,
    { triage, spec },
  );
  assert.ok(out.includes("Triage previo"));
  assert.ok(out.includes("Spec aprobada"));
  // Sin contexto el output no cambia (contrato Ola 8).
  const base = buildForemanPrompt({ prompt: "crear carpeta demo", worktree: "/tmp/demo" });
  assert.ok(!base.includes("Triage previo"));
});

// ── Turno único: datos sí, reglas no (el espejo las aporta) ──

test("triage: id + issue + worktree + cierre, sin rúbrica", () => {
  const out = buildTriagePrompt(
    { id: "job-slim-t1", prompt: "fix auth bug", worktree: "/tmp/wt", modelRef: { providerID: "x", modelID: "y" } },
    undefined,
  );
  assert.ok(out.includes("job-slim-t1"), "el id viaja");
  assert.ok(out.includes("fix auth bug"), "el issue viaja");
  assert.ok(out.includes("/tmp/wt"), "el worktree viaja (lo explora con lectura)");
  assert.ok(out.includes("x/y"), "modelRef solo cuando hay");
  assert.ok(out.includes("Clasificá ahora"), "el cierre orienta");
  assert.ok(!out.includes("factory/agents/triage/agent.md"), "sin header");
  assert.ok(!out.includes("Sos el TRIAGE"), "sin rol");
  assert.ok(!out.includes("openQuestions\":"), "sin rúbrica de decisiones");
  assert.ok(!out.includes("PROHIBIDO write"), "sin reglas (viven en el espejo)");
});

test("triage sin modelRef no emite línea de modelo", () => {
  const out = buildTriagePrompt(
    { id: "job-slim-t2", prompt: "x", worktree: "" },
    undefined,
  );
  assert.ok(!out.includes("Modelo del job"));
  assert.ok(out.includes("(no especificado"));
});

test("spec: datos + triage + feedback, sin reglas", () => {
  const out = buildSpecPrompt(
    { id: "job-slim-s1", prompt: "agregar login", worktree: "/tmp/wt" },
    { decision: "spec", scope: "auth", complexity: "simple", openQuestions: ["¿oauth?"], reason: "planeable", confidence: 0.8 },
    undefined,
  );
  assert.ok(out.includes("job-slim-s1"));
  assert.ok(out.includes("agregar login"));
  assert.ok(out.includes("/tmp/wt"), "el worktree viaja (propone targetFiles)");
  assert.ok(out.includes("Triage previo"), "el contexto triage viaja");
  assert.ok(out.includes("Escribí el brief ahora"), "el cierre orienta");
  assert.ok(!out.includes("factory/agents/spec/agent.md"), "sin header");
  assert.ok(!out.includes("Sos el SPEC"), "sin rol");
  assert.ok(!out.includes("Reglas del brief"), "sin reglas (viven en el espejo)");
});

test("spec con feedback humano lo preserva", () => {
  const out = buildSpecPrompt(
    { id: "job-slim-s2", prompt: "x", worktree: "" },
    undefined,
    "agregá criterios de logout",
  );
  assert.ok(out.includes("agregá criterios de logout"), "el rechazo humano viaja");
});
