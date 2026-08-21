import type { AuditFinding, IssueTemplateFields } from "../types/issuePlanning.ts";

// Compone el body de un issue con la estructura del formulario de bug
// report de gentle-ai (bug_report.yml). La sesión de opencode rellena
// los campos (template.*) y acá se ensambla el Markdown final que la UI
// muestra y que se pegaría al crear el issue. Las secciones sin datos
// se emiten igual con un placeholder, para que el formato sea estable.
export function buildIssueTemplateBody(
  description: string,
  fields: IssueTemplateFields | undefined,
  repoUrl: string,
): string {
  const f = fields ?? {};
  const steps =
    f.stepsToReproduce && f.stepsToReproduce.length > 0
      ? f.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "1. (sin pasos provistos)";

  return [
    "### Pre-flight Checklist",
    "",
    `- [x] I have searched [existing issues](${repoUrl}/issues) and this is not a duplicate`,
    "",
    "### 📝 Bug Description",
    "",
    description.trim() || "—",
    "",
    "### 🔄 Steps to Reproduce",
    "",
    steps,
    "",
    "### ✅ Expected Behavior",
    "",
    f.expectedBehavior?.trim() || "—",
    "",
    "### ❌ Actual Behavior",
    "",
    f.actualBehavior?.trim() || "—",
    "",
    "---",
    "## 🖥️ Environment",
    "",
    `**Version**: ${f.version?.trim() || "—"}`,
    `**Operating System**: ${f.os?.trim() || "—"}`,
    `**AI Agent / Client**: ${f.agent?.trim() || "—"}`,
    `**📋 Affected Area**: ${f.area?.trim() || "—"}`,
    "",
    "**💡 Logs / Error Output**:",
    "```shell",
    f.logs?.trim() || "—",
    "```",
    "",
    "**Additional Context**:",
    "",
    f.additionalContext?.trim() || "—",
  ].join("\n");
}

// Compone el body de un issue a partir de un finding de auditoría. ÚNICA
// fuente de verdad para el paso finding → body, compartida por el planner
// y la pantalla de diagnóstico: si el finding trae template (los planes
// nuevos lo traen por contrato), el issue se crea con el formulario de bug
// report completo; si no (planes viejos), cae a la description sola.
export function buildFindingIssueBody(
  finding: Pick<AuditFinding, "description" | "template">,
  repoUrl: string,
): string {
  return finding.template
    ? buildIssueTemplateBody(finding.description, finding.template, repoUrl)
    : finding.description;
}
