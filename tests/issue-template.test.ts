import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIssueTemplateBody } from "../src/planner/issueTemplate.ts";

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
    "### 📋 How this works",
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
