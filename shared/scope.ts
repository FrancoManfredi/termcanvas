/**
 * Frases canónicas del bloque SCOPE de jobs factory (ÚNICA fuente).
 *
 * Las emite `buildFactoryResolvePrompt` (renderer) y las retiran los
 * builders que no las necesitan (foreman slim). ESM puro, cero imports,
 * nunca lanza. English strings (repo convention for shared prompts).
 */

/** Disciplina de scope: lo pedido, nada fuera, nada menos. */
export const SCOPE_DISCIPLINE_LINE =
  "Implement only what this issue asks for. Do not add features outside its scope and do not skip its no-goals.";

/**
 * Propiedad del PR: el builder trabaja en el worktree, el orquestador
 * (daemon, código — ningún LLM) publica push + `gh pr create`.
 */
export function scopeWorktreeLine(issueNumber: number): string {
  try {
    const n =
      typeof issueNumber === "number" && Number.isInteger(issueNumber) && issueNumber > 0
        ? issueNumber
        : 0;
    return `Work in the issue worktree. NEVER open a pull request, push, or commit: the orchestrator creates the PR automatically (body "Closes #${n}"). Leave all changes uncommitted in the worktree.`;
  } catch {
    return "Work in the issue worktree. Leave all changes uncommitted in the worktree.";
  }
}

/**
 * Retira el boilerplate SCOPE canónico donde aparezca (template + copias
 * idénticas del body del issue), más headers `## SCOPE` que queden vacíos.
 * Conserva scope CUSTOM (otras palabras) y texto normal byte-idéntico.
 * Puro, nunca lanza.
 */
export function stripScopeBoilerplate(text: unknown): string {
  try {
    let out = String(text ?? "");
    if (out.length === 0) return "";
    out = out.split(SCOPE_DISCIPLINE_LINE).join("");
    out = out.replace(
      /Work in the issue worktree\. NEVER open a pull request, push, or commit:.*?Leave all changes uncommitted in the worktree\./g,
      "",
    );
    // Headers `## SCOPE` cuya sección quedó vacía tras el strip (la que aún
    // tiene contenido propio se conserva con su header).
    const lines = out.split("\n");
    const keep: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/^## SCOPE\s*$/.test(line)) {
        let j = i + 1;
        while (j < lines.length && (lines[j] ?? "").trim().length === 0) j++;
        if (j >= lines.length || /^##\s/.test((lines[j] ?? "").trim())) continue;
      }
      keep.push(line);
    }
    return keep.join("\n").replace(/\n{3,}/g, "\n\n");
  } catch {
    try {
      return String(text ?? "");
    } catch {
      return "";
    }
  }
}
