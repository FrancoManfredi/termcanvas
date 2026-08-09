import test from "node:test";
import assert from "node:assert/strict";
import { deriveAuditLabels } from "../src/planner/deriveAuditLabels.ts";
import { parsePlanningPlan } from "../src/planner/parsePlanResult.ts";

function finding(overrides: Partial<Parameters<typeof deriveAuditLabels>[0]> = {}) {
  return {
    title: "Algo no funciona",
    severity: "low" as const,
    file: "src/app.ts",
    line: 10,
    description: "…",
    ...overrides,
  };
}

test("deriveAuditLabels: severity critical/high marca bug siempre", () => {
  assert.deepEqual(deriveAuditLabels(finding({ severity: "critical" })), ["bug"]);
  assert.deepEqual(deriveAuditLabels(finding({ severity: "high" })), ["bug"]);
});

test("deriveAuditLabels: template.area mapea al dominio (auth → security)", () => {
  const labels = deriveAuditLabels(
    finding({
      severity: "medium",
      template: { area: "auth" },
    }),
  );
  assert.ok(labels.includes("security"), `labels = ${labels.join(", ")}`);
});

test("deriveAuditLabels: la ruta del archivo dice el dominio (tests y docs)", () => {
  assert.deepEqual(
    deriveAuditLabels(finding({ file: "src/__tests__/sum.test.ts" })),
    ["tests"],
  );
  assert.deepEqual(
    deriveAuditLabels(finding({ file: "docs/readme.md", severity: "medium" })),
    ["docs"],
  );
});

test("deriveAuditLabels: keywords de último recurso (token → security)", () => {
  const labels = deriveAuditLabels(
    finding({
      severity: "medium",
      title: "GitHub token expuesto en los logs de CI",
    }),
  );
  assert.ok(labels.includes("security"));
});

test("deriveAuditLabels: sin ninguna señal cae al fallback bug", () => {
  assert.deepEqual(deriveAuditLabels(finding()), ["bug"]);
});

test("deriveAuditLabels: no repite labels (bug + área de datos)", () => {
  const labels = deriveAuditLabels(
    finding({ severity: "high", template: { area: "database" } }),
  );
  assert.equal(labels.filter((label) => label === "bug").length, 1);
});

test("parsePlanningPlan: derivar labels en audit y respetar las del modelo", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "r",
      findings: [
        {
          title: "Token expuesto",
          severity: "critical",
          file: "src/auth.ts",
          line: 3,
          description: "…",
        },
        {
          title: "Sin labels propios",
          severity: "low",
          file: "docs/readme.md",
          line: 1,
          description: "…",
          labels: ["bug-report"],
        },
      ],
    }),
  );
  assert.ok(parsed);
  const findings = parsed.result.mode === "audit" ? parsed.result.findings : [];
  assert.ok(findings[0].labels?.includes("bug"));
  // Las labels que escribió el modelo no se tocan.
  assert.deepEqual(findings[1].labels, ["bug-report"]);
});