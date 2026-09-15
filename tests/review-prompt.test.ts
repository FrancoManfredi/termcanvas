import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReviewPrompt,
  extractReviewJSONObject,
  parseReviewLLMResponse,
  reviewJsonSchema,
} from "../headless-runtime/review/reviewPrompt.ts";

// Ola 4 T05 — prompt revisor + parse fences→zod.

test("reviewJsonSchema es strict con verdict/confidence/summary/findings", () => {
  const props = (reviewJsonSchema as unknown as { properties: Record<string, unknown> }).properties;
  assert.ok(props.verdict);
  assert.ok(props.confidence);
  assert.ok(props.summary);
  assert.ok(props.findings);
  assert.deepEqual(
    (reviewJsonSchema as unknown as { required: string[] }).required,
    ["verdict", "confidence", "summary", "findings"],
  );
});

test("buildReviewPrompt lleva solo datos: id, issue, worktree (turno flaco)", () => {
  const prompt = buildReviewPrompt(
    {
      id: "job-review-abc01",
      prompt: "agregar login con tests",
      worktree: "C:\\repo",
      modelRef: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
    },
    {
      createdFiles: ["src/auth.ts"],
      verification: {
        steps: [],
        overall: "pass",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 10,
      } as unknown as import("../shared/types/implement.ts").VerificationReport,
      reviewAttempt: 1,
      reviewerModel: { providerID: "opencode", modelID: "big-pickle" },
    },
  );
  assert.ok(prompt.includes("job-review-abc01"), "el id viaja");
  assert.ok(prompt.includes("agregar login con tests"), "el issue viaja");
  assert.ok(prompt.includes("C:\\repo"), "el worktree actual viaja");
  assert.ok(!prompt.includes("src/auth.ts"), "turno flaco: sin lista servida");
  assert.ok(!prompt.includes("overall=pass"), "turno flaco: sin verificación");
  assert.ok(!prompt.includes("Evidencia de verificación"), "turno flaco: sin evidencia");
  assert.ok(!prompt.includes("CreatedFiles"), "turno flaco: sin CreatedFiles");
  assert.ok(!prompt.includes("## Diff del cambio"), "turno flaco: sin diff");
  assert.ok(!prompt.includes("Revisá el diff y los archivos"), "sin cierre orientador (vive en el espejo)");
  assert.ok(!prompt.includes("factory/agents/review/agent.md"), "sin header");
  assert.ok(!prompt.includes("Sos el REVISOR"), "sin rol (vive en el espejo)");
  assert.ok(!prompt.includes("Ejes obligatorios"), "sin ejes (viven en el espejo)");
  assert.ok(!prompt.includes("Severidades:"), "sin severidades (viven en el espejo)");
  assert.ok(prompt.includes('"verdict"'), "el shape del cierre vive en el turno (una sola fuente)");
});

function slimReviewCtx() {
  return {
    createdFiles: ["src/auth.ts"],
    verification: {
      steps: [],
      overall: "pass",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 10,
    } as unknown as import("../shared/types/implement.ts").VerificationReport,
    reviewAttempt: 2,
    reviewerModel: { providerID: "opencode", modelID: "big-pickle" },
  };
}

test("turno único: datos flacos, sin ejes ni cuerpos", () => {
  const prompt = buildReviewPrompt(
    {
      id: "job-review-slim01",
      prompt: "agregar login con tests",
      worktree: "C:\\repo",
      modelRef: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
    },
    slimReviewCtx(),
  );
  assert.ok(prompt.includes("job-review-slim01"), "el id viaja");
  assert.ok(prompt.includes("agregar login con tests"), "el issue viaja");
  assert.ok(!prompt.includes("src/auth.ts"), "turno flaco: sin lista servida");
  assert.ok(!prompt.includes("overall=pass"), "turno flaco: sin verificación");
  assert.ok(!prompt.includes("Revisá el diff y los archivos"), "sin cierre (vive en el espejo)");
  assert.ok(prompt.includes("C:\\repo"), "el worktree actual viaja");
  assert.ok(!prompt.includes("factory/agents/review/agent.md"), "sin header");
  assert.ok(!prompt.includes("Sos el REVISOR"), "sin rol");
  assert.ok(!prompt.includes("Ejes obligatorios"), "sin ejes (viven en el espejo)");
  assert.ok(!prompt.includes("Veredictos:"), "sin veredictos (viven en el espejo)");
  assert.ok(!prompt.includes("Skills por tool"), "sin puntero skills");
});

test("retira SCOPE canónico y conserva override del proyecto", () => {
  const prompt = buildReviewPrompt(
    {
      id: "job-review-slim02",
      prompt: "hacer X\n\nImplement only what this issue asks for. Do not add features outside its scope and do not skip its no-goals.",
      worktree: "C:\\repo",
    },
    { ...slimReviewCtx(), repoOverride: "Regla del repo: correr pnpm lint." },
  );
  assert.ok(!prompt.includes("Implement only what this issue asks for"), "sin boilerplate scope");
  assert.ok(prompt.includes("Regla del repo: correr pnpm lint."), "el override viaja");
  assert.ok(prompt.includes("## Override del proyecto"), "override con header");
});

test("diffBlock deprecated: se ignora aunque se pase (turno flaco)", () => {
  const withDiff = buildReviewPrompt(
    { id: "job-review-diff01", prompt: "x", worktree: "C:\\repo" },
    { ...slimReviewCtx(), diffBlock: "diff --git a/f.ts b/f.ts\n+f()" },
  );
  assert.ok(!withDiff.includes("## Diff del cambio"), "turno flaco: sin sección diff");
  assert.ok(!withDiff.includes("+f()"), "turno flaco: el diff no viaja en el turno");
  const withoutDiff = buildReviewPrompt(
    { id: "job-review-diff02", prompt: "x", worktree: "C:\\repo" },
    slimReviewCtx(),
  );
  assert.ok(!withoutDiff.includes("## Diff del cambio"), "sin sección cuando no hay diff");
});

test("sin override no emite la sección", () => {
  const prompt = buildReviewPrompt(
    { id: "job-review-slim03", prompt: "x", worktree: "C:\\repo" },
    slimReviewCtx(),
  );
  assert.ok(!prompt.includes("## Override del proyecto"));
});

test("parse fences→zod: acepta ```json fences y texto extra", () => {
  const raw = [
    "Claro, revisé el cambio.",
    "```json",
    JSON.stringify({
      verdict: "revise",
      confidence: 0.82,
      summary: "Falta test para login",
      findings: [
        { id: "f1", axis: "tests", severity: "major", message: "sin test", file: "src/auth.ts" },
      ],
    }),
    "```",
  ].join("\n");
  const parsed = parseReviewLLMResponse(raw);
  assert.equal(parsed.verdict, "revise");
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].axis, "tests");
});

test("parse falla con JSON inválido (caller convierte a ask_human)", () => {
  assert.throws(() => parseReviewLLMResponse("no es json"), /review JSON parse error/);
  assert.throws(
    () =>
      parseReviewLLMResponse(
        JSON.stringify({ verdict: "maybe", confidence: 2, summary: "", findings: [] }),
      ),
    /./,
  );
});

test("parse tolera finding con id numérico (lo coerciona a string)", () => {
  const raw = JSON.stringify({
    verdict: "revise",
    confidence: 0.75,
    summary: "Hay un major",
    findings: [{ id: 1, axis: "tests", severity: "major", message: "falta test" }],
  });
  const parsed = parseReviewLLMResponse(raw);
  assert.equal(parsed.verdict, "revise");
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].id, "1");
});

test("parse genera id cuando el finding lo omite", () => {
  const raw = JSON.stringify({
    verdict: "revise",
    confidence: 0.75,
    summary: "Hay dos majors",
    findings: [
      { axis: "tests", severity: "major", message: "uno" },
      { axis: "security", severity: "minor", message: "dos" },
    ],
  });
  const parsed = parseReviewLLMResponse(raw);
  assert.equal(parsed.findings.length, 2);
  assert.equal(parsed.findings[0].id, "f1");
  assert.equal(parsed.findings[1].id, "f2");
});

test("parse sigue fallando si el finding no tiene message (no se inventa contenido)", () => {
  const raw = JSON.stringify({
    verdict: "revise",
    confidence: 0.75,
    summary: "x",
    findings: [{ id: "f1", axis: "tests", severity: "major" }],
  });
  assert.throws(() => parseReviewLLMResponse(raw), /./);
});

test("parse tolera null explícito en opcionales (file/line/suggestion) — issue 2026-09-07", () => {
  const raw = JSON.stringify({
    verdict: "revise",
    confidence: 0.82,
    summary: "Falta test para login",
    findings: [
      {
        id: "f1",
        axis: "tests",
        severity: "major",
        message: "sin test",
        file: null,
        line: null,
        suggestion: null,
      },
    ],
  });
  const parsed = parseReviewLLMResponse(raw);
  assert.equal(parsed.verdict, "revise");
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].id, "f1");
  assert.equal(parsed.findings[0].file, undefined);
  assert.equal(parsed.findings[0].line, undefined);
  assert.equal(parsed.findings[0].suggestion, undefined);
});

test("parse acepta opcionales presentes y reverify null", () => {
  const raw = JSON.stringify({
    verdict: "accept",
    confidence: 0.9,
    summary: "Limpio",
    findings: [
      {
        id: "f1",
        axis: "tests",
        severity: "info",
        message: "nit",
        file: "src/a.ts",
        line: 12,
        suggestion: "renombrar",
        reverify: null,
      },
    ],
  });
  const parsed = parseReviewLLMResponse(raw);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].file, "src/a.ts");
  assert.equal(parsed.findings[0].line, 12);
  assert.equal(parsed.findings[0].suggestion, "renombrar");
});

test("extract: prosa + eco de tool-call + JSON + prosa final devuelve el objeto con verdict", () => {
  const lines = [
    "During attempt 1, I requested reverify with commands `pnpm test` and `pnpm build`. Both passed.",
    "",
    "Tool call result: {\"id\":\"toolu_01\",\"type\":\"read\"} - JSON below:",
    "",
    "{\"verdict\":\"revise\",\"confidence\":0.8,\"summary\":\"falta cubrir el reload\",\"findings\":[{\"message\":\"agregar test de reload\",\"axis\":\"tests\",\"severity\":\"major\"}]}",
    "",
    "That concludes my review.",
  ];
  const mixed = lines.join("\n");
  const found = extractReviewJSONObject(mixed);
  assert.ok(found !== null);
  const obj = JSON.parse(found as string) as Record<string, unknown>;
  assert.equal(obj.verdict, "revise");
  const parsed = parseReviewLLMResponse(mixed);
  assert.equal(parsed.verdict, "revise");
  assert.equal(parsed.findings.length, 1);
});

test("extract: llaves dentro de strings no rompen el balanceo", () => {
  const mixed =
    "nota con { llaves } sueltas y luego " +
    "{\"verdict\":\"accept\",\"confidence\":0.9,\"summary\":\"ok {todo bien}\",\"findings\":[]}";
  const parsed = parseReviewLLMResponse(mixed);
  assert.equal(parsed.verdict, "accept");
  assert.equal(parsed.summary, "ok {todo bien}");
});

test("extract: sin ningun objeto parseable devuelve null y el parse lanza con raw amplio", () => {
  assert.equal(extractReviewJSONObject("pura prosa sin nada"), null);
  assert.throws(() => parseReviewLLMResponse("pura prosa sin nada"), /no object/);
});
