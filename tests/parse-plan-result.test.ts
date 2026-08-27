import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePlanningPlan,
  describePlanError,
} from "../src/planner/parsePlanResult.ts";
import { isAuditPlan } from "../src/types/issuePlanning.ts";

const ROADMAP_JSON = JSON.stringify({
  mode: "roadmap",
  repo: "acme/termcanvas",
  proposals: [
    {
      title: "Vista calendario",
      body: "Listar issues por milestone",
      labels: ["feature", "ui"],
      status: "Todo",
      priority: "P1",
      size: "L",
      blockedBy: [],
      blocking: [],
      related: [1],
    },
    {
      title: "Sidebar colapsable",
      body: "Recordar estado",
      labels: ["improvement"],
      status: "Todo",
      priority: "P2",
      size: "S",
      related: [0],
    },
  ],
});

test("parsePlanningPlan parsea un roadmap completo", () => {
  const parsed = parsePlanningPlan(ROADMAP_JSON);
  assert.ok(parsed, "el roadmap válido debe parsear");
  assert.equal(parsed.result.mode, "roadmap");
  assert.equal(parsed.warnings.length, 0);
  const proposals = parsed.result.mode === "roadmap" ? parsed.result.proposals : [];
  assert.equal(proposals.length, 2);
  assert.deepEqual(proposals[0].related, [1]);
  assert.deepEqual(proposals[1].related, [0]);
});

test("parsePlanningPlan: audit válido", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "acme/app",
      findings: [
        { title: "Token expuesto", severity: "critical", file: "a.ts", line: 3, description: "..." },
      ],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.result.mode, "audit");
  assert.equal(parsed.warnings.length, 0);
});

test("parsePlanningPlan: severity desconocida se normaliza a medium", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "r",
      findings: [{ title: "x", severity: "megacritical", file: "a", line: 1, description: "d" }],
    }),
  );
  assert.ok(parsed);
  const finding = parsed.result.mode === "audit" ? parsed.result.findings[0] : null;
  assert.equal(finding?.severity, "medium");
});

test("parsePlanningPlan: el template del bug report se conserva en findings y proposals", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "acme/app",
      findings: [
        {
          title: "Token expuesto",
          severity: "critical",
          file: "a.ts",
          line: 3,
          description: "Se filtra en logs",
          template: {
            stepsToReproduce: ["Correr la app", "Buscar token en logs"],
            expectedBehavior: "El token no aparece",
            actualBehavior: "El token aparece",
            version: "main",
            os: "Windows",
            agent: "opencode",
            area: "auth",
            logs: "token=abc",
            additionalContext: "—",
          },
        },
      ],
    }),
  );
  assert.ok(parsed);
  const finding = parsed.result.mode === "audit" ? parsed.result.findings[0] : null;
  assert.deepEqual(finding?.template?.stepsToReproduce, ["Correr la app", "Buscar token en logs"]);
  assert.equal(finding?.template?.expectedBehavior, "El token no aparece");
  assert.equal(finding?.template?.additionalContext, "—");

  const roadmap = parsePlanningPlan(
    JSON.stringify({
      mode: "roadmap",
      repo: "r",
      proposals: [
        {
          title: "t",
          body: "b",
          priority: "P1",
          size: "M",
          status: "Todo",
          blockedBy: [],
          blocking: [],
          template: { stepsToReproduce: ["Abrir", "Clic"], expectedBehavior: "ok" },
        },
      ],
    }),
  );
  const proposal = roadmap?.result.mode === "roadmap" ? roadmap.result.proposals[0] : null;
  assert.deepEqual(proposal?.template?.stepsToReproduce, ["Abrir", "Clic"]);
  assert.equal(proposal?.template?.expectedBehavior, "ok");
});

test("parsePlanningPlan: template vacío o ausente deja el issue sin template (planes viejos)", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "r",
      findings: [
        { title: "x", severity: "low", file: "a", line: 1, description: "d" },
        {
          title: "y",
          severity: "low",
          file: "b",
          line: 2,
          description: "d2",
          template: { stepsToReproduce: [] },
        },
      ],
    }),
  );
  assert.ok(parsed);
  const findings = parsed.result.mode === "audit" ? parsed.result.findings : [];
  assert.equal(findings[0].template, undefined);
  assert.equal(findings[1].template, undefined);
});

test("parsePlanningPlan: JSON de otro contrato o basura devuelve null con motivo claro", () => {
  assert.equal(parsePlanningPlan("not json"), null);
  assert.equal(parsePlanningPlan('{"mode":"unknown"}'), null);
  assert.equal(parsePlanningPlan('[1,2,3]'), null);
  assert.match(describePlanError("not json"), /JSON no parseable/);
  assert.match(describePlanError('{"mode":"unknown"}'), /"unknown"/);
  assert.equal(describePlanError(ROADMAP_JSON), "", "un plan válido no describe error");
});

test("parsePlanningPlan: propuesta sin título se descarta con warning", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "roadmap",
      repo: "r",
      proposals: [{ title: "", body: "x" }, { title: "ok", body: "y" }],
    }),
  );
  assert.ok(parsed);
  const proposals = parsed.result.mode === "roadmap" ? parsed.result.proposals : [];
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].title, "ok");
  assert.ok(parsed.warnings.some((w) => w.includes("no tiene título")));
});

test("parsePlanningPlan: prioridad y tamaño fuera de norma no tiran el plan, solo avisan", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "roadmap",
      repo: "r",
      proposals: [
        { title: "t", priority: "MEDIUM", size: "huge", blockedBy: [], blocking: [] },
      ],
    }),
  );
  assert.ok(parsed);
  const proposal = parsed.result.mode === "roadmap" ? parsed.result.proposals[0] : null;
  assert.equal(proposal?.priority, "MEDIUM");
  assert.equal(proposal?.size, "huge");
  assert.equal(parsed.warnings.length, 2);
});

test("parsePlanningPlan: modo roadmap sin propuestas avisa pero no explota", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({ mode: "roadmap", repo: "r", proposals: [] }),
  );
  assert.ok(parsed);
  const proposals = parsed.result.mode === "roadmap" ? parsed.result.proposals : [];
  assert.equal(proposals.length, 0);
  assert.ok(parsed.warnings.some((w) => w.includes("sin propuestas")));
});

test("parsePlanningPlan: duplicateOf y existingIssueNumber se conservan en proposals y findings", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "roadmap",
      repo: "r",
      proposals: [
        {
          title: "Canónico",
          body: "b1",
          priority: "P1",
          size: "M",
          status: "Todo",
          blockedBy: [],
          blocking: [],
        },
        {
          title: "Redacción distinta del mismo problema",
          body: "b2",
          priority: "P2",
          size: "S",
          status: "Todo",
          blockedBy: [],
          blocking: [],
          duplicateOf: 0,
        },
        {
          title: "Ya pedido",
          body: "b3",
          priority: "P2",
          size: "S",
          status: "Todo",
          blockedBy: [],
          blocking: [],
          existingIssueNumber: 41,
        },
      ],
    }),
  );
  assert.ok(parsed);
  const proposals = parsed.result.mode === "roadmap" ? parsed.result.proposals : [];
  assert.equal(proposals[0].duplicateOf, undefined);
  assert.equal(proposals[1].duplicateOf, 0);
  assert.equal(proposals[2].existingIssueNumber, 41);
  assert.equal(proposals[1].existingIssueNumber, undefined);
});

test("parsePlanningPlan: duplicateOf inválido (negativo, string) se descarta", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "r",
      findings: [
        { title: "a", severity: "low", file: "a", line: 1, description: "d" },
        {
          title: "b",
          severity: "low",
          file: "b",
          line: 2,
          description: "d",
          duplicateOf: -1,
          existingIssueNumber: "41",
        },
      ],
    }),
  );
  assert.ok(parsed);
  const finding = parsed.result.mode === "audit" ? parsed.result.findings[1] : null;
  assert.equal(finding?.duplicateOf, undefined);
  assert.equal(finding?.existingIssueNumber, undefined);
});

const SHARED_TEMPLATE = {
  stepsToReproduce: ["Abrir", "Reproducir", "Observar"],
  expectedBehavior: "Funciona",
  actualBehavior: "Falla",
  version: "1.0",
  os: "Windows",
  agent: "test",
  area: "core",
  logs: "—",
  additionalContext: "—",
};

test("parsePlanningPlan: un template a nivel de plan aplica a todos los items", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "r",
      findings: [
        { title: "a", severity: "low", file: "a", line: 1, description: "d" },
        { title: "b", severity: "high", file: "b", line: 2, description: "d" },
      ],
      template: SHARED_TEMPLATE,
    }),
  );
  assert.ok(parsed);
  const findings = parsed.result.mode === "audit" ? parsed.result.findings : [];
  assert.deepEqual(findings[0].template?.stepsToReproduce, SHARED_TEMPLATE.stepsToReproduce);
  assert.equal(findings[0].template?.expectedBehavior, "Funciona");
  assert.deepEqual(findings[1].template?.stepsToReproduce, SHARED_TEMPLATE.stepsToReproduce);
});

test("parsePlanningPlan: el template propio de un item gana sobre el de plan", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "roadmap",
      repo: "r",
      proposals: [
        {
          title: "con template propio",
          body: "b",
          priority: "P1",
          size: "S",
          status: "Todo",
          blockedBy: [],
          blocking: [],
          template: {
            stepsToReproduce: ["Solo para este item"],
            expectedBehavior: "Propio",
          },
        },
        { title: "sin template", body: "b", priority: "P1", size: "S", status: "Todo", blockedBy: [], blocking: [] },
      ],
      template: SHARED_TEMPLATE,
    }),
  );
  assert.ok(parsed);
  const proposals = parsed.result.mode === "roadmap" ? parsed.result.proposals : [];
  assert.equal(proposals[0].template?.expectedBehavior, "Propio");
  assert.equal(proposals[0].template?.stepsToReproduce?.length, 1);
  assert.equal(proposals[1].template?.expectedBehavior, "Funciona");
});

const OPEN_ENCODING_ISSUES: Array<{ number: number; title: string }> = [
  {
    number: 52,
    title: "answer.ps1 UTF-8 sin BOM corrompe la salida acentuada con Windows PowerShell 5.1",
  },
  { number: 32, title: "No existe ningún .gitignore en la raíz del repositorio" },
];

test("parsePlanningPlan: item que repite un issue abierto se marca solo con existingIssueNumber", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "r",
      findings: [
        {
          title: "answer.ps1 UTF-8 sin BOM corrompe los literales acentuados en Windows PowerShell 5.1",
          severity: "high",
          file: "answer.ps1",
          line: 0,
          description: "…",
        },
      ],
    }),
    OPEN_ENCODING_ISSUES,
  );
  assert.ok(parsed);
  const finding = parsed.result.mode === "audit" ? parsed.result.findings[0] : null;
  assert.equal(finding?.existingIssueNumber, 52);
  assert.ok(
    parsed.warnings.some((w) => w.includes("marcó automáticamente") && w.includes("#52")),
    "el warning explica que la marca la puso la app",
  );
});

test("parsePlanningPlan: problema nuevo pero del mismo archivo NO se marca (precisión)", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "r",
      findings: [
        {
          title: "answer.ps1 se cuelga cuando la redirección de salida apunta a un archivo",
          severity: "medium",
          file: "answer.ps1",
          line: 0,
          description: "…",
        },
      ],
    }),
    OPEN_ENCODING_ISSUES,
  );
  assert.ok(parsed);
  const finding = parsed.result.mode === "audit" ? parsed.result.findings[0] : null;
  assert.equal(finding?.existingIssueNumber, undefined);
});

test("parsePlanningPlan: la marca que ya puso el modelo no se pisa ni se duplica", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "roadmap",
      repo: "r",
      proposals: [
        {
          title: "answer.ps1 UTF-8 sin BOM corrompe los literales acentuados en Windows PowerShell 5.1",
          body: "b",
          priority: "P1",
          size: "S",
          status: "Todo",
          blockedBy: [],
          blocking: [],
          existingIssueNumber: 41,
        },
      ],
    }),
    OPEN_ENCODING_ISSUES,
  );
  assert.ok(parsed);
  const proposal = parsed.result.mode === "roadmap" ? parsed.result.proposals[0] : null;
  assert.equal(proposal?.existingIssueNumber, 41);
  assert.ok(
    !parsed.warnings.some((w) => w.includes("marcó automáticamente")),
    "un item ya marcado no genera warning de auto-marca",
  );
});
// ─── Diagnóstico por categorías: campo categoria del plan ─────────────────

test("parsePlanningPlan: categoria válida se conserva en el AuditPlan", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "owner/repo",
      findings: [],
      categoria: "seguridad",
    }),
  );
  assert.ok(parsed && isAuditPlan(parsed.result));
  assert.equal(parsed.result.categoria, "seguridad");
});

test("parsePlanningPlan: categoria inválida o ausente → undefined (la UI la trata como General)", () => {
  const invalid = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "owner/repo",
      findings: [],
      categoria: "categoria-inventada",
    }),
  );
  assert.ok(invalid && isAuditPlan(invalid.result));
  assert.equal(invalid.result.categoria, undefined);

  const absent = parsePlanningPlan(
    JSON.stringify({ mode: "audit", repo: "owner/repo", findings: [] }),
  );
  assert.ok(absent && isAuditPlan(absent.result));
  assert.equal(absent.result.categoria, undefined);
});
