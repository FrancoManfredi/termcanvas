import { buildRepoContextSection, buildRequirementsSection, buildArchitectureDecisionsSection } from "../utils/repoContext";

export interface IssueReviewPromptInput {
  issueNumber: number;
  title: string;
  prNumber: number;
  branch: string;
  commitSha?: string;
  // PR facts prefetched by the app (headRefOid, last review, latest inline
  // batch, diff file path) so the agent does not have to re-derive them with
  // gh. Supplied by the review runner when the IPC snapshot succeeds.
  reviewContext?: string;
  // Worktree-local path of the pre-generated review JSON skeleton
  // (review-template-{pr}.json). When the app wrote it, the agent fills it in
  // instead of reinventing the fixed schema (commit_id, event, line/side).
  reviewTemplateFilePath?: string | null;
  // Texto del contexto activo del repositorio (brief formateado por el motor
  // de entrevista). Se inyecta inline por buildRepoContextSection; el agente
  // no lee ningún archivo.
  repoContextText?: string;
  // Texto de la síntesis de requerimientos activa (RFs, ASRs, restricciones,
  // glosario) formateado por el motor. Se inyecta inline por
  // buildRequirementsSection; el agente no lee ningún archivo.
  requirementsText?: string;
  // Decisiones de arquitectura activas (ADRs del manifiesto). Inline por
  // buildArchitectureDecisionsSection, tras REQUERIMIENTOS RELEVADOS.
  decisionsText?: string;
}

// Strict body-rule: the issue body is NEVER inlined in the prompt (it can be
// huge and repeats once per open PR of the issue). Instead the agent MUST
// read the full original body with gh before evaluating the SPEC axis.
function issueBodyRule(issueNumber: number): string {
  return `ANTES de analizar nada, ejecutá SIEMPRE \`gh issue view ${issueNumber} --json title,body --jq -r '"# " + .title + "\\n\\n" + .body'\` y leé el body COMPLETO del issue — está PROHIBIDO armar la review sin haberlo leído de punta a punta. El título de arriba es solo una guía: el Spec se juzga contra el texto original, incluyendo pasos de reproducción, criterios de aceptación y cualquier sección intermedia. No resumas, no infieras, no saltees secciones.`;
}

/**
 * Build a multiline review prompt for the "REVISAR SOLUCIÓN" flow.
 *
 * La jerarquía markdown (headers, listas) mejora la adherencia del modelo a
 * cada regla: ya no se aplana a una sola línea con separador " | ".
 */
// --- MERGE DONE: the original full prompt below is a superset of the quick
//     test (same rules, same anchors, same JSON shape), so the quick branch
//     was removed and this is the single final version.
/**
 * Canonical closing rule for every review round:
 *
 * - The general review body (the POST to /pulls/{pr}/reviews) must ALWAYS
 *   start with one of the two exact lines below, so TermCanvas can parse the
 *   verdict and update the PR label. Everything after the first line is the
 *   usual summary.
 * - APROBADO: nothing that blocks merging. Optional suggestions are allowed
 *   as inline comments, but each must say "no bloqueante" in ITS OWN comment
 *   body — they never affect the general verdict.
 * - CAMBIOS_PEDIDOS: at least one observation that blocks merging.
 * - Ambiguous closings are forbidden ("listo si el equipo está de acuerdo").
 *   The reviewer decides, never passes the decision to the user.
 */
const VERDICT_RULE =
  'El "body" general del POST a /reviews empieza SIEMPRE con la línea exacta "VEREDICTO: APROBADO" o "VEREDICTO: CAMBIOS_PEDIDOS" (primera línea, sin texto antes), seguida del resumen como siempre. APROBADO = no hay ninguna observación necesaria antes de mergear; las sugerencias de estilo/mejora opcional pueden ir como comentarios de línea pero con "no bloqueante" en el body de ESE comentario puntual, y nunca cambian el veredicto. CAMBIOS_PEDIDOS = hay al menos una observación que considerás necesaria antes de mergear. PROHIBIDO cerrar con frases ambiguas ("listo para mergear si el equipo está de acuerdo") o dejar sugerencias sueltas sin resolver: si sugerís algo, decidís vos si es bloqueante o no. El cuerpo "VEREDICTO: ..." es lo que TermCanvas parsea para setear el label del PR.';

/**
 * The anti-duplicate rule, restated: "no duplicates" does NOT mean "switch to
 * a plain comment". Each review round is a brand-new, independent review with
 * its own POST to /pulls/{pr}/reviews — always. The only real rule: never
 * submit TWO of your reviews evaluating the SAME code state without a change
 * in between. Compare the current headRefOid against the one of your last
 * review: different → new anchored review via /reviews; same (no new commits
 * since your last review) → do nothing, there is nothing to re-review.
 */
const NO_DUP_BY_OID_RULE =
  'Cada ronda de revisión — incluyendo la primera — usa SIEMPRE el endpoint /pulls/{pr}/reviews con comentarios anclados a línea. "No duplicar" NO significa usar un comentario plano: significa no mandar dos reviews tuyas evaluando el MISMO código sin cambios entre medio. Antes de decidir el mecanismo: compará el headRefOid actual con el de tu última review — corré gh pr view {pr} --json headRefOid --jq .headRefOid para el actual y gh pr view {pr} --json reviews --jq ".[.reviews|length-1].commit_id" para el commit que revisaste la última vez. Si son DISTINTOS (hay un fix nuevo entre medio): hacé SIEMPRE una review nueva anclada vía POST /pulls/{pr}/reviews, nunca un gh pr comment. Si son IGUALES (no hay commits nuevos desde tu última review): NO hagas nada, no hay nada que re-revisar — no subas comentarios planos ni otra review.';

/**
 * gh must run DIRECT, never wrapped. A wrapper that hides stdout (e.g. one
 * that prefixes output with "[rtk]") makes you retry blind, which is exactly
 * how duplicate reviews happen. If you see your command output prefixed with
 * [rtk], or a command returns no output at all, stop after the SECOND failed
 * attempt and try a structurally different command (e.g. gh api instead of
 * gh pr diff) — repeating the identical command more than twice is not a
 * valid strategy.
 */
const NO_WRAPPER_RULE =
  "Corré gh DIRECTO, nunca envuelto (nada de rtk ni wrappers que oculten stdout/stderr, ni necesitás confirmarlo en tu razonamiento). Si un comando devuelve output con prefijo [rtk], o no devuelve output, DETENÉTE tras el segundo intento fallido y probá un comando estructuralmente distinto (ej: gh api en vez de gh pr diff). Nunca repitas el mismo comando más de 2 veces esperando un resultado distinto.";

export function buildIssueReviewPrompt(
  input: IssueReviewPromptInput,
): string {
  // PR facts prefetched by the app. Read-only orientation: the snapshot is a
  // starting point, and the rules below still demand a fresh `gh pr diff`
  // right before posting so the line numbers match the current head.
  const injected = input.reviewContext
    ? [
        `## CONTEXTO INYECTADO POR LA APP`,
        `no corras gh para obtener estos datos, ya te los doy: ${input.reviewContext}`,
      ]
    : [];
  // The app pre-generated the fixed JSON skeleton when the snapshot exists.
  // Tell the agent to fill it in ONLY when the file actually landed in the
  // worktree; without one, the inline schema below is the fallback.
  const templateRule = input.reviewTemplateFilePath
    ? [
        `## USÁ EL ESQUELETO PRE-GENERADO`,
        `La app ya dejó ${input.reviewTemplateFilePath} en el worktree con la estructura correcta (commit_id ya cargado, event: COMMENT, comments con line/side). Completá body y comments del JSON y subilo con gh api repos/{owner}/{repo}/pulls/${input.prNumber}/reviews --method POST --input ${input.reviewTemplateFilePath}. NO changes el event ni la estructura.`,
      ]
    : [];
  return [
    `# Review de la solución — issue #${input.issueNumber} — ${input.title}`,
    "",
    ...buildRepoContextSection(input.repoContextText),
    ...buildRequirementsSection(input.requirementsText),
    ...buildArchitectureDecisionsSection(input.decisionsText),
    "",
    `## CONTEXTO`,
    `Estás en un worktree aislado con el código de la solución ya commiteado en la rama (podés verlo con git log). Ejecutá \`gh pr view ${input.prNumber}\` y \`gh pr diff ${input.prNumber}\` para ver la solución completa en contexto (cambios, archivos, tests). Si falta algo del diff local (ej: la rama no está actualizada con el PR), avisá en tu reporte final en vez de inventar contenido.`,
    "",
    `## LECTURA OBLIGATORIA DEL ISSUE`,
    issueBodyRule(input.issueNumber),
    "",
    `## QUÉ REVISAR (disciplina de la skill code-review, en dos ejes SEPARADOS)`,
    `- EJE STANDARDS — la solución sigue las convenciones del repo y la calidad de código básica (code smells estilo Fowler: sin dead code, sin TODOs sin ticket, sin duplicación evitable); hay tests para la solución, corren y pasan, y cubren el caso principal del issue (no solo el camino feliz); commits conventional, sin Co-Authored-By ni atribuciones AI.`,
    `- EJE SPEC — fidelidad EXACTA al issue original: resuelve exactamente lo que pide y nada más, sin features inventadas ni scope creep.`,
    `Evaluá ambos ejes por separado en tu análisis; el veredicto y el formato de salida no cambian.`,
    "",
    `## ACCIÓN — COMPORTAMIENTO COMO COPILOT`,
    `Comentá SOLO sobre los archivos que el PR modifica (\`gh pr diff ${input.prNumber} --name-only\`) y anclá cada hallazgo a la línea exacta del código con start_line/end_line y, si proponés un cambio concreto, un suggested_fix dentro de un bloque de sugerencia de GitHub. El texto del review NO enumera líneas: lo que se ve sobre el código son los comentarios.`,
    "",
    `## FORMATO DE OUTPUT`,
    `Para cada observación identificá el archivo y el número de línea EXACTO en el diff nuevo. Corré gh pr diff ${input.prNumber} JUSTO ANTES de armar el JSON para leer los números de línea reales del lado derecho/nuevo — no reuses un diff leído al principio de la sesión si pasó tiempo o hubo cambios, y no inventes ni aproximes números.`,
    `Armá un JSON y subilo con \`gh api repos/{owner}/{repo}/pulls/${input.prNumber}/reviews --method POST --input <archivo>.json\` en UNA sola llamada:`,
    "```json",
    `{ "commit_id": "${input.commitSha ?? "el hash actual (git rev-parse HEAD)"}", "event": "COMMENT", "body": "primera línea: VEREDICTO: APROBADO o VEREDICTO: CAMBIOS_PEDIDOS; después el resumen general", "comments": [ { "path": "ruta/relativa/al/archivo.ext", "line": 42, "side": "RIGHT", "body": "observación específica de esa línea (si es opcional, empezá con 'no bloqueante: ')" } ] }`,
    "```",
    `Si una observación es sobre una convención general o algo que no corresponde a una línea puntual (ej: falta de tests en general), dejala en el "body" general, no fuerces un anclaje que no corresponde. Si no hay NINGUNA observación de línea, el POST igual se hace con "comments": [] y el body con el veredicto.`,
    "",
    `## EVENT`,
    `Usá SIEMPRE "COMMENT" (no APPROVE ni REQUEST_CHANGES por este endpoint: GitHub bloquea auto-aprobar el PR propio con el token actual; el veredicto se comunica con la línea VEREDICTO: del body, no con el evento del review). Los comentarios inline quedan anclados igual.`,
    "",
    `## SUGERENCIAS APLICABLES (opcional pero valioso)`,
    `Si tu observación incluye una corrección chica y concreta (un rename, un typo, una línea mal escrita), incluí el fix en un bloque de sugerencia de GitHub dentro del "body" de ese comentario puntual para que el autor lo aplique con un clic.`,
    "",
    `## VALIDACIÓN`,
    `Antes de subir el JSON, correlacioná que cada line exista en el diff ACTUAL (no en una versión vieja cacheada): corré \`gh pr diff ${input.prNumber}\` justo antes de generar los comentarios. Guardá el JSON en un archivo temporal DENTRO del worktree (ej. .review.json) antes de mandarlo — no lo pases inline en el comando de shell — para poder debuggear si \`gh api\` falla por JSON mal formado.`,
    "",
    `## VEREDICTO BINARIO OBLIGATORIO`,
    VERDICT_RULE,
    "",
    `## ANTI-DUPLICADO (por commit, no por estado)`,
    NO_DUP_BY_OID_RULE.replaceAll("{pr}", String(input.prNumber)),
    "",
    `## REGLAS DE EJECUCIÓN`,
    NO_WRAPPER_RULE,
    "",
    `## REGLAS DE ORO`,
    `- Corré los comandos gh DIRECTO — nunca los envuelvas con rtk ni con wrappers (ocultan stdout y te hacen reintentar a ciegas, duplicando reviews en el PR). Si ves output con prefijo [rtk] o sin output, detenete tras 2 intentos y probá un comando estructuralmente distinto.`,
    `- NUNCA crees una rama nueva, NO hagas commits locales, NO pushees, NO crees un PR nuevo y NO mergees el PR existente. Tu único output es la review en el PR ya existente vía POST /pulls/{pr}/reviews.`,
    `- Analizás en un worktree aislado y descartable: cualquier cambio local que hagas para probar se pierde al cerrar la sesión.`,
    `- Prefijá cada paso relevante que ejecutes con [review-${input.issueNumber}] para poder filtrar tu trazabilidad en la terminal.`,
    ...injected,
    ...templateRule,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");
}
