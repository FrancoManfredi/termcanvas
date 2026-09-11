import { buildRepoContextSection, buildRequirementsSection, buildArchitectureDecisionsSection } from "../utils/repoContext";
import { specializedSkillName } from "../skills/registry";
import { TAG_CANVAS_RESOLVE, withPhaseTag } from "../../headless-runtime/llm/phaseTags";

export type IssueResolvePromptMode = "new" | "resume";

interface IssueResolvePromptInput {
  issueNumber: number;
  title: string;
  body?: string;
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
  // Categoría de diagnóstico del issue (label cat:<id> en GitHub). Cuando
  // está presente, la sesión se lanza con la skill especializada diag-<cat>
  // como ÚNICA skill de diagnóstico visible y el prompt lo anuncia.
  category?: string;
}

// Sección que anuncia la skill especializada scopeada. Sin categoría no se
// emite: la sesión corre sin scoping, igual que antes del feature.
function buildCategorySkillSection(category: string | undefined): string[] {
  if (!category) return [];
  const name = specializedSkillName(category);
  return [
    `## SKILL ESPECIALIZADA DISPONIBLE`,
    `Este issue proviene de un diagnóstico por categorías. Tu sesión tiene cargada la skill ${name} con la metodología completa de esa categoría: criterios de severidad, falsos positivos a descartar y estándar de evidencia.`,
    `Cargala con tu herramienta skill ANTES de diseñar la solución y usala como guía de criterio durante todo el trabajo: qué cuenta como bug real, qué es ruido y cuánta evidencia exige cada decisión.`,
    ``,
  ];
}

function issueBody(body: string | undefined): string {
  return (body ?? "").replace(/\n/g, " ");
}

function buildNewIssueHeader(input: IssueResolvePromptInput): string {
  return `# Resolver issue #${input.issueNumber} — ${input.title}`;
}

function buildResumeHeader(input: IssueResolvePromptInput): string {
  return (
    `# Retomar issue #${input.issueNumber} — ${input.title}\n` +
    `Ya existe una rama y worktree para esta issue (podés ver el historial de commits con git log para entender qué se hizo hasta ahora). Continuá desde donde quedó: revisá los artifacts de engram si existen (mem_search/mem_context sobre el topic del issue) para entender qué se avanzó; no revises openspec/changes/.`
  );
}

function buildSharedSuffix(input: IssueResolvePromptInput): string[] {
  return [
    `## ALCANCE`,
    `El issue aprobado es el contrato: no agregues requisitos fuera de su scope, no inventes features, no te saltes no-goals.`,
    ``,
    `## BODY ORIGINAL DEL ISSUE`,
    issueBody(input.body),
    ``,
    `## RESTRICCIONES`,
    `- work-unit commits con conventional commits (type(scope): desc).`,
    `- shellcheck en todo script modificado.`,
    `- sin Co-Authored-By ni atribuciones AI.`,
    `- actualizar docs si cambia el comportamiento.`,
    ``,
    `## DISCIPLINA TDD (skill tdd)`,
    `Confirmá qué comportamientos hay que testear, diseñá la interfaz pensando en que sea testeable, escribí UN test a la vez (test primero, red-green-refactor), implementá recién cuando tengas el test en rojo, y buscá oportunidades de refactor al final de cada slice. No commitees nada sin que TODOS los tests pasen.`,
    ``,
    `## LOGGING PARA DEBUG MANUAL`,
    `Como el usuario va a probar manualmente el resultado antes de que se archive el cambio, agregá logging generoso y descriptivo en el código que toques — no solo para vos, para que un humano pueda ver en la consola exactamente qué está pasando paso a paso al usar la feature/fix en vivo.`,
    `- Logueá con un prefijo identificable, ej: [fix-<nombre-del-change>] o [feature-<nombre>], para poder filtrarlos fácil en devtools.`,
    `- Logueá en los puntos de decisión clave (ej: "¿se detectó el target correcto?", "¿el evento se está bloqueando o dejando pasar?"), no solo al principio/final de una función.`,
    `- Si el fix depende de una condición (ej: un selector de DOM, un estado de store), logueá el valor real evaluado en cada intento, no solo "true/false" — mostrá el dato concreto que se comparó.`,
    `- Estos logs pueden quedar en el código final (no los borres antes de archivar) — el usuario los va a usar para reportar bugs con evidencia concreta en vez de descripciones vagas. Si en el futuro se decide sacarlos, será un cambio aparte.`,
    ``,
    `## GESTIÓN DEL ISSUE`,
    `- NO cierres el issue manualmente: el cierre ocurre automático al mergear el PR vía "Closes #${input.issueNumber}".`,
    `- Podés comentar avances con gh issue comment.`,
    `- Podés modificar las relaciones blocked-by/blocking/parent del issue (agregar, quitar o reordenar) cuando reflejen la realidad del trabajo; comentá el cambio con gh issue comment.`,
    ``,
    `## VERIFICACIÓN ANTES DE COMPLETAR (skill verification-before-completion)`,
    `No afirmes "está listo" sin haber corrido antes la verificación real — tests, typecheck y lint según el stack — y mostrá el resultado concreto de cada check en el resumen final (qué corriste y qué devolvió, no solo "pasó").`,
    ``,
    `## ENTREGA FINAL`,
    `Cuando termines de implementar y los checks pasen, creá el PR con la skill branch-pr: branch type/descripcion, body con "Closes #${input.issueNumber}", un solo label type:*, esperar checks automatizados.`,
    `PRs: auto-chain. Presupuesto de review: 800 líneas. PRs encadenados: stacked-to-main — la evaluación de corte con la skill chained-pr es SIEMPRE obligatoria al terminar: medí el PR resultante (no el tamaño que parecía tener el issue al arrancar) y si supera el presupuesto de review de 800 líneas, cortalo en PRs encadenados hacia main. Que la evaluación sea siempre no implica cortar siempre: el corte ocurre solo cuando el PR real lo amerita.`,
    `Los labels del ciclo de review (review:pendiente, review:aprobado, review:comentado, review:fix-aplicado, conflicto:main) los aplica la app automáticamente al detectar el PR o los pushes; NO los toques con gh issue edit.`,
    ``,
    `## AL TERMINAR, RESUMÍ`,
    `1. Qué se implementó.`,
    `2. Qué checks corriste (tests/typecheck/lint) y su resultado.`,
    `3. URL del PR.`,
  ];
}

export function buildIssueResolvePrompt(
  input: IssueResolvePromptInput,
  mode: IssueResolvePromptMode,
): string {
  const header =
    mode === "resume"
      ? buildResumeHeader(input)
      : buildNewIssueHeader(input);
  const sections = [
    header,
    "",
    ...buildRepoContextSection(input.repoContextText),
    ...buildRequirementsSection(input.requirementsText),
    ...buildArchitectureDecisionsSection(input.decisionsText),
    ...buildCategorySkillSection(input.category),
    ...buildSharedSuffix(input),
  ];
  // Etiqueta humana de fase (primera línea): new vs resume visibles en la sesión.
  const tag =
    mode === "resume"
      ? "[FASE: CANVAS resolver (retomar) — Continuación del trabajo sobre el issue]"
      : TAG_CANVAS_RESOLVE;
  return withPhaseTag(sections.join("\n"), tag);
}
