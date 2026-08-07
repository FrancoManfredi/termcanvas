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
}

function issueBody(body: string | undefined): string {
  return (body ?? "").replace(/\n/g, " ");
}

/**
 * Build a single-line fix prompt for the "IMPLEMENTAR FIX" flow.
 *
 * The implementer works in the SAME worktree that owns the PR branch, so the
 * fix is pushed to the existing PR — never to a new branch. The review
 * comments are the contract: they were already posted to the PR by the
 * reviewer, so the agent reads them with gh instead of re-deriving them.
 *
 * opencode's --prompt breaks on real newlines on Windows, so every section
 * is joined with the same ` | ` separator used by the resolve/review prompts.
 */
// TEMP for manual UI testing: short fix prompt. Set back to false to restore
// the full original list below.
const QUICK_TEST_FIX_PROMPT_ENABLED: boolean = true;

export function buildIssueFixPrompt(input: IssueFixPromptInput): string {
  // PR facts prefetched by the app (headRefOid, last review, latest batch).
  // The reviewer's contract comments are still read via gh below — context
  // replaces the state queries, not the feedback the agent must answer.
  const injected = input.reviewContext
    ? [
        `CONTEXTO INYECTADO POR LA APP (no corras gh para obtener estos datos, ya te los doy): ${input.reviewContext}. `,
      ]
    : [];
if (QUICK_TEST_FIX_PROMPT_ENABLED) {
    return [
      ...injected,
      `FIX RÁPIDO (test manual) — issue #${input.issueNumber} — ${input.title} (${issueBody(input.body)}). `,
      `El reviewer pidió cambios en el PR #${input.prNumber} (rama ${input.branch}). `,
      `Primero confirmá el head commit actual con gh pr view ${input.prNumber} --json headRefOid, y traé SOLO los comentarios de la review MÁS RECIENTE (no comentarios de rondas anteriores ya resueltas) con gh api repos/{owner}/{repo}/pulls/${input.prNumber}/comments y gh api repos/{owner}/{repo}/pulls/${input.prNumber}/reviews — ordená por fecha y quedate con la última tanda. `,
      `Para cada observación marcada como BLOQUEANTE (parte del veredicto CAMBIOS_PEDIDOS o comentarios de línea sin aclaración de "no bloqueante"), aplicá EXACTAMENTE el fix pedido, sin features extra ni refactors ajenos. `,
      `Para observaciones marcadas explícitamente como "no bloqueante" u opcionales: NO las apliques automáticamente. Decidí si tiene sentido aplicarla igual (mejora barata y de bajo riesgo) o dejarla — en cualquier caso, mencioná tu decisión y el motivo en el resumen final, no las ignores en silencio. `,
      `Corré los checks del repo (tests, build, lo que aplique) antes de commitear. `,
      `Commiteá con mensaje conventional commit (ej: "fix: address review comments on PR #${input.prNumber}") y pushealos a la rama actual (git push origin ${input.branch}). `,
      `Al terminar, dejá un resumen con gh pr comment ${input.prNumber} que responda PUNTO POR PUNTO a cada observación del review (bloqueante y no bloqueante): qué cambiaste, o por qué no si no aplicaste algo. No alcanza con un resumen genérico de "apliqué los fixes". `,
      `Actualizá el label del PR a "esperando re-review": gh issue edit ${input.prNumber} --remove-label "review:comentado" --add-label "review:fix-aplicado" (si el label no existe, créalo con gh label create "review:fix-aplicado" --color d4c5f9 --force; si el remove-label falla porque el label no está puesto, seguí igual) — para que la card sepa que hay que volver a pasar por "REVISAR SOLUCIÓN". Aplicá el MISMO cambio al issue asociado #${input.issueNumber}: gh issue edit ${input.issueNumber} --remove-label "review:comentado" --add-label "review:fix-aplicado" (mismas tolerancias) — el issue refleja el estado del PR. `,
      `NUNCA crees una rama o PR nuevo: el fix actualiza el PR #${input.prNumber} existente. Prefijá tus pasos con [fix-${input.issueNumber}].`,
    ].join(" | ");
  }
  return [
    ...injected,
    `El reviewer pidió cambios en tu solución del issue #${input.issueNumber} — ${input.title}. `,
    `CONTEXTO: el PR #${input.prNumber} (rama ${input.branch}) ya tiene una review pendiente. Tu trabajo: aplicar los fixes pedidos y actualizar ESE MISMO PR. Body del issue: ${issueBody(input.body)}. `,
    `PRIMERO LEÉ LA REVIEW: ejecutá \`gh pr view ${input.prNumber} --json reviews --jq '.reviews[]'{state,body}'\` para el veredicto y los comentarios, y \`gh api repos/{owner}/{repo}/pulls/${input.prNumber}/comments\` para los comentarios inline anclados (con sus archivos y líneas). TODOS los comentarios de la review son el contrato del fix: respondélas uno por uno, sea implementándolos o dejando una réplica clara con gh pr comment si un comentario no aplica. `,
    "ALCANCE: implementá EXACTAMENTE lo que pidió la review y nada más — sin refactors ajenos, sin features nuevas, sin tocar código fuera de lo solicitado. Respaldá cada cambio en una observación concreta del reviewer.",
    `PRUEBAS Y CALIDAD: corré los checks del repo sobre esta rama (tests, typecheck/lint según el stack, shellcheck en scripts tocados). No marques el fix como hecho si algo falla: o lo corregís o dejás explícito el fallo en el comentario final. Commits de tipo conventional (type(scope): desc), sin Co-Authored-By ni atribuciones AI. `,
    `PUSH AL PR EXISTENTE: commité en la rama actual y pusheá con \`git push origin ${input.branch}\`. Verificá que el PR se haya actualizado con \`gh pr view ${input.prNumber}\` (nuevo commit visible). NUNCA crees una rama nueva, NUNCA abras un PR nuevo y NO mergees el PR. NO cierres el issue manualmente (se cierra solo al mergear vía "Closes #${input.issueNumber}"). `,
    `CIERRE DE TRAZABILIDAD: al terminar, dejá un resumen de lo corregido en el PR con \`gh pr comment ${input.prNumber}\` (una lista corta de qué cambio va asociado a qué comentario del review), para que el reviewer pueda re-revisar sin re-leer todo el diff. `,
    `REGLAS DE ORO: corré los comandos gh y git DIRECTO (no los envuelvas con wrappers que ocultan stdout). Prefijá cada paso relevante con [fix-${input.issueNumber}] para poder filtrar tu trazabilidad en la terminal. Si no hay nada que corregir porque la review quedó desactualizada, avisá con gh pr comment en vez de inventar cambios.`,
  ].join(" | ");
}