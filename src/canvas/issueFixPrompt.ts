import { buildRepoContextSection, buildRequirementsSection } from "../utils/repoContext";

export interface IssueFixPromptInput {
  issueNumber: number;
  title: string;
  body?: string;
  prNumber: number;
  branch: string;
  // PR facts prefetched by the app (headRefOid, last review, latest inline
  // batch, diff file path) so the agent does not have to re-derive them with
  // gh. Supplied by the fix runner when the IPC snapshot succeeds.
  reviewContext?: string;
  // Texto del contexto activo del repositorio (brief formateado por el motor
  // de entrevista). Se inyecta inline por buildRepoContextSection; el agente
  // no lee ningún archivo.
  repoContextText?: string;
  // Texto de la síntesis de requerimientos activa (RFs, ASRs, restricciones,
  // glosario) formateado por el motor. Se inyecta inline por
  // buildRequirementsSection; el agente no lee ningún archivo.
  requirementsText?: string;
}

function issueBody(body: string | undefined): string {
  return (body ?? "").replace(/\n/g, " ");
}

/**
 * Build a multiline fix prompt for the "IMPLEMENTAR FIX" flow.
 *
 * The implementer works in the SAME worktree that owns the PR branch, so the
 * fix is pushed to the existing PR - never to a new branch. The review
 * comments are the contract: they were already posted to the PR by the
 * reviewer, so the agent reads them with gh instead of re-deriving them.
 *
 * La jerarquía markdown (headers, listas) reemplaza al separador " | " de
 * una sola línea: el modelo sigue cada regla con más fidelidad.
 */
export function buildIssueFixPrompt(input: IssueFixPromptInput): string {
  // PR facts prefetched by the app (headRefOid, last review, latest batch).
  // The reviewer's contract comments are still read via gh below - context
  // replaces the state queries, not the feedback the agent must answer.
  const injected = input.reviewContext
    ? [
        `## CONTEXTO INYECTADO POR LA APP`,
        `no corras gh para obtener estos datos, ya te los doy: ${input.reviewContext}`,
      ]
    : [];
  return [
    `# Implementar fix — issue #${input.issueNumber} — ${input.title}`,
    "",
    `El reviewer pidió cambios en tu solución. Tu trabajo: aplicar los fixes pedidos y actualizar ESE MISMO PR.`,
    "",
    ...buildRepoContextSection(input.repoContextText),
    ...buildRequirementsSection(input.requirementsText),
    ...injected,
    "",
    `## CONTEXTO DEL PR`,
    `El PR #${input.prNumber} (rama ${input.branch}) ya tiene una review pendiente. Body del issue: ${issueBody(input.body)}.`,
    "",
    `## ALCANCE`,
    `Implementá EXACTAMENTE el fix pedido por la review y nada más - sin refactors ajenos, sin features nuevas, sin tocar código fuera de lo solicitado. Respaldá cada cambio en una observación concreta del reviewer.`,
    "",
    `## PRIMERO LEÉ LA REVIEW`,
    `Confirmá el head commit actual con \`gh pr view ${input.prNumber} --json headRefOid\`, el veredicto con \`gh pr view ${input.prNumber} --json reviews --jq '.reviews[]'{state,body}''\` y los comentarios inline anclados con \`gh api repos/{owner}/{repo}/pulls/${input.prNumber}/comments\` y \`gh api repos/{owner}/{repo}/pulls/${input.prNumber}/reviews\` (con sus archivos y líneas).`,
    `Traé SOLO los comentarios de la review MÁS RECIENTE (no comentarios de rondas anteriores ya resueltas) - ordená por fecha y quedate con la última tanda. TODOS los comentarios vigentes de la review son el contrato del fix: respondelos uno por uno, sea implementándolos o dejando una réplica clara con gh pr comment si un comentario no aplica.`,
    "",
    `## CLASIFICACIÓN DE OBSERVACIONES`,
    `- BLOQUEANTES (parte del veredicto CAMBIOS_PEDIDOS o comentarios de línea sin aclaración de "no bloqueante"): aplicalas EXACTAMENTE como se pide, sin ampliar el alcance del paso anterior.`,
    `- "No bloqueante" u opcionales: NO las apliques automáticamente; decidí si tiene sentido aplicarla igual (si es una mejora barata y de bajo riesgo) o dejarla - en cualquier caso, mencioná tu decisión y el porqué en el resumen final, no las ignores en silencio.`,
    "",
    `## PRUEBAS Y CALIDAD`,
    `Corré los checks del repo sobre la rama (tests, typecheck/lint según el stack, shellcheck en scripts tocados). No marques el fix como hecho si algo falla: o lo corregís o dejás explícito el fallo en el comentario final. Commits de tipo conventional (type(scope): desc), sin Co-Authored-By ni atribuciones AI.`,
    "",
    `## DISCIPLINA TDD (skill tdd)`,
    `El defecto que señaló el reviewer se ataca con un ciclo red-green-refactor NUEVO, no con un parche directo: escribí primero el test que reproduce el bug (en rojo), implementá el fix, y recién cuando esté en verde cerrá el ciclo. Todos los tests del repo deben pasar antes de commitear.`,
    "",
    `## RESPUESTA AL REVIEW (skill receiving-code-review)`,
    `Ante cada observación del reviewer aplicá rigor técnico y verificación real — corré el caso, mirá el código, probá la alternativa — antes de aceptarla o descartarla. NUNCA respondas con acuerdo performativo ("tenés razón, lo corrijo") sin haber chequeado; si una observación no aplica o es incorrecta, fundamentalo técnicamente en tu réplica.`,
    "",
    `## PUSH AL PR EXISTENTE`,
    `Commitá en la rama actual y pusheá con \`git push origin ${input.branch}\`. Verificá que el PR se haya actualizado con \`gh pr view ${input.prNumber}\` (nuevo encabezado visible).`,
    `- NUNCA crees una rama o PR nuevo, NUNCA abras un PR nuevo y NO mergees el PR.`,
    `- NO cierres el issue manualmente (se cierra solo al mergear via "Closes #${input.issueNumber}").`,
    "",
    `## CIERRE DE TRAZABILIDAD`,
    `Al terminar, dejá un resumen en el PR con \`gh pr comment ${input.prNumber}\` que responda PUNTO POR PUNTO a cada observación del review (bloqueante y no bloqueante): qué cambio va asociado a qué comentario, o por qué no si no aplicaste algo. No alcanza con un resumen genérico de "apliqué los fixes": es la lista corta para que el reviewer re-revise sin leer todo el diff.`,
    "",
    `## REGLAS DE ORO`,
    `- Corré los comandos gh y git DIRECTO (no los envuelvas en wrappers que ocultan stdout).`,
    `- Prefijá cada paso relevante con [fix-${input.issueNumber}] para poder filtrar tu trazabilidad.`,
    `- Si no hay nada que corregir porque la reseña quedó desactualizada, avisá con gh pr comment en vez de inventar cambios.`,
  ].join("\n");
}
