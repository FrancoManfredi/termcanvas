export type IssueResolvePromptMode = "new" | "resume";

interface IssueResolvePromptInput {
  issueNumber: number;
  title: string;
  body?: string;
}

function issueBody(body: string | undefined): string {
  return (body ?? "").replace(/\n/g, " ");
}

function buildNewIssueHeader(input: IssueResolvePromptInput): string {
  return `Resolvé el issue #${input.issueNumber} — ${input.title} — usando SDD con el pipeline completo y estricto. `;
}

function buildResumeHeader(input: IssueResolvePromptInput): string {
  return (
    `Retomá el trabajo en curso sobre el issue #${input.issueNumber} — ${input.title}.\n` +
    `Ya existe una rama y worktree para esta issue (podés ver el historial de commits con git log para entender qué se hizo hasta ahora). Continuá desde donde quedó, siguiendo el mismo pipeline SDD (sdd-new -> spec -> design -> tasks -> apply -> verify -> archive) — primero identificá en qué fase se quedó (revisando openspec/changes/ y los artifacts de engram si existen) antes de asumir que hay que empezar de cero. `
  );
}

function buildSharedSuffix(input: IssueResolvePromptInput): string {
  return `| PRECONDICIONES (ya definidas, no preguntes): Ejecución auto, gatekeeper entre fases, no pausar salvo problema real. Artefactos: openspec y engram, ambos. PRs: auto-chain. Presupuesto de review: 800 líneas. PRs encadenados: stacked-to-main. | ALCANCE: el issue aprobado es el contrato, no agregues requisitos fuera de su scope, no inventes features, no te saltes no-goals. | BODY ORIGINAL DEL ISSUE: ${issueBody(input.body)} | PIPELINE (todas las fases en orden, sin omitir ninguna, sin pausar entre fases): sdd-new (explore + propose) -> spec -> design -> tasks -> apply -> verify -> archive. | RESTRICCIONES: work-unit commits con conventional commits (type(scope): desc), shellcheck en todo script modificado, sin Co-Authored-By ni atribuciones AI, actualizar docs si cambia el comportamiento. | LOGGING PARA DEBUG MANUAL: Como el usuario va a probar manualmente el resultado antes de que se archive el cambio, agregá logging generoso y descriptivo en el código que toques — no solo para vos, para que un humano pueda ver en la consola exactamente qué está pasando paso a paso al usar la feature/fix en vivo: logueá con un prefijo identificable, ej: [fix-<nombre-del-change>] o [feature-<nombre>], para poder filtrarlos fácil en devtools. Logueá en los puntos de decisión clave (ej: "¿se detectó el target correcto?", "¿el evento se está bloqueando o dejando pasar?"), no solo al principio/final de una función. Si el fix depende de una condición (ej: un selector de DOM, un estado de store), logueá el valor real evaluado en cada intento, no solo "true/false" — mostrá el dato concreto que se comparó. Estos logs pueden quedar en el código final (no los borres antes de archivar) — el usuario los va a usar para reportar bugs con evidencia concreta en vez de descripciones vagas. Si en el futuro se decide sacarlos, será un cambio aparte. | GESTIÓN DEL ISSUE: NO cierres el issue manualmente, el cierre ocurre automático al mergear el PR vía "Closes #${input.issueNumber}". Podés comentar avances con gh issue comment, no es obligatorio. No modifiques relaciones blocked-by/blocking/parent sin comentarlo primero. | ENTREGA FINAL: después de verify creá el PR con la skill branch-pr, branch type/descripcion, body con "Closes #${input.issueNumber}", un solo label type:*, esperar checks automatizados. | AL TERMINAR RESUMÍ: 1) qué se implementó por fase, 2) evidencia de verify, 3) URL del PR.`;
}

export function buildIssueResolvePrompt(
  input: IssueResolvePromptInput,
  mode: IssueResolvePromptMode,
): string {
  const header =
    mode === "resume"
      ? buildResumeHeader(input)
      : buildNewIssueHeader(input);
  return `${header}${buildSharedSuffix(input)}`;
}
