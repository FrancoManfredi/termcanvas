import { buildRepoContextSection, buildRequirementsSection } from "../utils/repoContext";

export interface ResolveConflictPromptInput {
  issueNumber: number;
  title: string;
  prNumber: number;
  branch: string;
  // When present (length > 0) the app already resolved the file list with a
  // test-merge against origin/main and the agent must NOT re-derive it with
  // gh pr view --comments: it is injected verbatim to keep the prompt short
  // and the facts deterministic (same contract as the review context
  // injection). Absent/empty keeps the gh fallback instruction.
  conflictFiles?: string[];
  // Texto del contexto activo del repositorio (brief formateado por el motor
  // de entrevista). Se inyecta inline por buildRepoContextSection; el agente
  // no lee ningún archivo.
  repoContextText?: string;
  // Texto de la síntesis de requerimientos activa (RFs, ASRs, restricciones,
  // glosario) formateado por el motor. Se inyecta inline por
  // buildRequirementsSection; el agente no lee ningún archivo.
  requirementsText?: string;
}

/**
 * Build a multiline conflict-resolution prompt for the "RESOLVER
 * CONFLICTO" flow.
 *
 * The mergeador's check flagged the PR as conflicting with main, so the agent
 * merges main into the SAME worktree that owns the PR branch, resolves every
 * file by hand, and pushes back to the existing PR — never a new branch.
 *
 * La jerarquía markdown (headers, listas) reemplaza al separador " | " de
 * una sola línea: el modelo sigue cada regla con más fidelidad.
 */
export function buildResolveConflictPrompt(
  input: ResolveConflictPromptInput,
): string {
  const injectedFiles =
    input.conflictFiles && input.conflictFiles.length > 0
      ? `La app ya corrió el test-merge contra origin/main y precargó la lista de archivos en conflicto (NO hace falta correr gh pr view ni leer el comentario del Mergeador): ${input.conflictFiles.join(", ")}.`
      : `Leé la lista exacta de archivos en conflicto del comentario del Mergeador en el PR: gh pr view ${input.prNumber} --comments (y gh pr view ${input.prNumber} --json body si hace falta) — buscá el comentario con prefijo [mergeador].`;
  return [
    `# Resolver conflicto de merge — issue #${input.issueNumber} — ${input.title}`,
    "",
    `El PR #${input.prNumber} (rama ${input.branch}) no se pudo mergear contra main automáticamente: el mergeador detectó conflictos.`,
    "",
    ...buildRepoContextSection(input.repoContextText),
    ...buildRequirementsSection(input.requirementsText),
    "",
    `## ARCHIVOS EN CONFLICTO`,
    injectedFiles,
    "",
    `## TRAER MAIN Y MERGEAR`,
    `Trabajás en el worktree que ya tiene la rama ${input.branch} (la del PR). Traé main y mergealo:`,
    `\`\`\`bash`,
    `git fetch origin main`,
    `git merge origin/main`,
    `\`\`\``,
    `El merge va a quedar con conflictos; es esperado.`,
    "",
    `## RESOLVER CADA ARCHIVO MANUALMENTE`,
    `Aplicá la disciplina de la skill resolving-merge-conflicts: avanzá hunk por hunk, guiándote por la intención original de cada lado (qué buscaba el cambio de la rama y qué buscaba main en ese punto) — no descartes un lado completo sin justificación técnica real, y explicá en el comentario final qué quedó de cada lado y por qué.`,
    "",
    `## COMPLETAR SIEMPRE EL MERGE`,
    `nunca uses git merge --abort ni dejes el worktree en estado de conflicto — la resolución DEBE terminar en un commit de merge, aunque un archivo quede íntegro de un lado.`,
    "",
    `## CHECKS Y COMMIT`,
    `1. Corré los checks del repo (tests, typecheck/lint/build según el stack) antes de commitear.`,
    `2. Commiteá con el mensaje exacto: \`merge: resolve conflicts with main for #${input.prNumber}\``,
    `3. Pusheá a la rama actual: \`git push origin ${input.branch}\` — el PR #${input.prNumber} queda actualizado con la resolución.`,
    "",
    `## COMENTARIO EN EL PR`,
    `Dejá un comentario en el PR con \`gh pr comment ${input.prNumber}\`, prefijo [fix-conflicto-${input.issueNumber}], explicando archivo por archivo qué se conservó de cada lado.`,
    "",
    `## ESTADO DE LABELS`,
    `Los labels del ciclo de review (conflicto:main, review:fix-aplicado) los gestiona la app automáticamente al detectar tu push: no corras gh para etiquetar.`,
    "",
    `## REGLAS DE ORO`,
    `- NUNCA crees una rama o PR nuevo: la resolución va al PR #${input.prNumber} existente.`,
    `- Prefijá tus pasos con [fix-conflicto-${input.issueNumber}].`,
  ].join("\n");
}
