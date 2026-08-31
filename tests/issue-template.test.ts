import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIssueTemplateBody,
  buildFindingIssueBody,
} from "../src/planner/issueTemplate.ts";

const REPO_URL = "https://github.com/acme/termcanvas";

test("el body replica la estructura exacta del template de bug report", () => {
  const body = buildIssueTemplateBody(
    "El token se filtra en el bundle",
    {
      stepsToReproduce: ["Abrir la app", "Abrir devtools"],
      expectedBehavior: "El token no debería existir en el bundle",
      actualBehavior: "El token aparece en main.js",
      version: "v0.39.10",
      os: "Windows",
      agent: "OpenCode",
      area: "CLI (commands, flags)",
      logs: "main.js:27 -> ghp_xxx",
      additionalContext: "Aparece solo en builds de producción",
    },
    REPO_URL,
  );

  for (const header of [
    "### Pre-flight Checklist",
    "### 📝 Bug Description",
    "### 🔄 Steps to Reproduce",
    "### ✅ Expected Behavior",
    "### ❌ Actual Behavior",
    "## 🖥️ Environment",
    "**Version**",
    "**Operating System**",
    "**AI Agent / Client**",
    "**📋 Affected Area**",
    "**💡 Logs / Error Output**",
    "**Additional Context**",
  ]) {
    assert.ok(body.includes(header), `falta el encabezado: ${header}`);
  }

  assert.ok(body.includes("1. Abrir la app\n2. Abrir devtools"));
  assert.ok(body.includes("El token se filtra en el bundle"));
  assert.ok(body.includes("v0.39.10"));
  assert.ok(body.includes("main.js:27 -> ghp_xxx"));
  assert.ok(body.includes(`${REPO_URL}/issues`));
});

test("sin campos el template emite todas las secciones con placeholder", () => {
  const body = buildIssueTemplateBody("desc", undefined, REPO_URL);
  for (const header of [
    "### 📝 Bug Description",
    "### 🔄 Steps to Reproduce",
    "### ✅ Expected Behavior",
    "### ❌ Actual Behavior",
    "## 🖥️ Environment",
  ]) {
    assert.ok(body.includes(header));
  }
  assert.ok(body.includes("(sin pasos provistos)"));
  assert.ok(body.includes("—"));
});

// Regresión del flujo diagnóstico → issue: el body del issue se compone con
// el template del finding (la pantalla de diagnóstico lo ignoraba y creaba
// el issue con la description sola — el bug que el usuario reportó en el
// E2E del 20/8, issue #38 de education-games).
test("buildFindingIssueBody: finding con template → body con el formulario completo", () => {
  const body = buildFindingIssueBody(
    {
      description: "El archivo .vscode/mcp.json contiene tokens committeados",
      template: {
        stepsToReproduce: ["Clonar el repo", "Abrir .vscode/mcp.json"],
        expectedBehavior: "Ningún secreto versionado",
        actualBehavior: "Tokens legibles en el archivo",
        version: "actual (working tree)",
        os: "Windows",
        agent: "Auditoría (gitleaks)",
        area: "repositorio / secrets management",
        logs: "gitleaks: generic-api-key (critical)",
        additionalContext: "Datos de menores comprometidos",
      },
    },
    REPO_URL,
  );
  assert.ok(body.includes("### Pre-flight Checklist"), "falta el Pre-flight Checklist");
  assert.ok(body.includes("### 🔄 Steps to Reproduce"));
  assert.ok(body.includes("1. Clonar el repo\n2. Abrir .vscode/mcp.json"));
  assert.ok(body.includes("Ningún secreto versionado"));
  assert.ok(body.includes("gitleaks: generic-api-key (critical)"));
  assert.ok(body.includes("repositorio / secrets management"));
});

test("buildFindingIssueBody: finding sin template → cae a la description sola", () => {
  const body = buildFindingIssueBody(
    { description: "Hallazgo de un plan viejo sin template", template: undefined },
    REPO_URL,
  );
  assert.equal(body, "Hallazgo de un plan viejo sin template");
});
