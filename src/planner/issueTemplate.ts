import type { IssueTemplateFields } from "../types/issuePlanning.ts";

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
    "### 📋 How this works",
    "",
    "1. **Submit** this issue → it gets the `status:needs-review` label automatically",
    "2. A **maintainer reviews** it and adds `status:approved` (or closes it as invalid/duplicate)",
    "3. **Only then** should you (or anyone) open a PR to fix it",
    "",
    "PRs that fix issues without `status:approved` will be automatically rejected.",
    "",
    "### Pre-flight Checklist",
    "",
    `- [x] I have searched [existing issues](${repoUrl}/issues) and this is not a duplicate`,
    "- [x] I understand that PRs will be rejected if the linked issue does not have `status:approved`",
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
