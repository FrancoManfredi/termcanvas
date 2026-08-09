import type { PlannerMode } from "../types/issuePlanning.ts";
import { buildRepoContextSection } from "../utils/repoContext";

export interface PlanningPromptInput {
  mode: PlannerMode;
  repoPath: string;
  roadmapText?: string;
  attachmentNames?: string[];
  outputPath: string;
  repoContext?: string;
  // Issues abiertos del repo (número | título): el plan marca con
  // existingIssueNumber a los que repiten un problema ya pedido. Opcional:
  // si no se pudo leer, el plan simplemente no trae esa marca.
  openIssues?: Array<{ number: number; title: string }>;
}

function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, " ");
}

/**
 * Construye el prompt que se le manda a la sesión de opencode para la
 * pantalla de Planificación.
 *
 * El agente NO crea issues directamente: su único entregable es el plan
 * JSON en <repo>/.agents/planning/plan-<timestamp>.json, que la app
 * consume después para renderizar la lista y crear los issues marcados.
 *
 * opencode rompe --prompt con saltos de línea reales en Windows, así
 * que el prompt completo va en una sola línea (misma convención que los
 * flujos fix/review/resolve).
 */
export function buildPlanningPrompt(input: PlanningPromptInput): string {
  const { mode, repoPath, outputPath } = input;
  const attachments = input.attachmentNames ?? [];

  // Contexto del repositorio: contenido libre del usuario (propósito,
  // visión de empresa, decisiones, intenciones) que pesa sobre TODOS los
  // hallazgos y propuestas. No es obligatorio: sin contexto la sección
  // no se emite y el prompt queda igual que antes. Va por oneLine() como
  // todo el prompt: un contexto multilínea rompería --prompt en Windows.
  const contextSection = buildRepoContextSection(input.repoContext);

  const schema = oneLine(`
    {
      "mode": "roadmap" | "audit",
      "repo": "<owner/repo>",
      "proposals"?: [
        {
          "title": string,
          "body": string,
          "labels": string[],
          "status": "Todo" | "In Progress" | "Done" | ...,
          "priority": "P0" | "P1" | "P2" | "P3",
          "size": "XS" | "S" | "M" | "L" | "XL",
          "parent"?: number (índice 0-based del padre),
          "blockedBy": number[],   // índices 0-based de issues que lo bloquean
          "blocking": number[],    // índices 0-based de issues que bloquea
          "related"?: number[],    // índices 0-based, relación paralela no bloqueante
          "duplicateOf"?: number,  // índice 0-based de OTRO item que YA cubre el mismo problema (ver DEDUPLICACIÓN)
          "existingIssueNumber"?: number  // número real de un issue ABIERTO que YA cubre este problema (ver DEDUPLICACIÓN)
        }
      ],
      "findings"?: [
        {
          "title": string,
          "severity": "critical" | "high" | "medium" | "low",
          "file": "ruta/relativa.ts",
          "line": number,
          "description": string,
          "labels": string[]  // etiquetas temáticas (bug, security, docs, tests, perf…)
        }
      ],
      "template"?: {  // aplica a CADA item de proposals y findings:
        "stepsToReproduce": string[],   // pasos concretos, en orden
        "expectedBehavior": string,     // qué debería pasar
        "actualBehavior": string,       // qué pasa hoy
        "version": string,              // versión del producto
        "os": string,                   // sistema operativo
        "agent": string,                // agente/cliente usado
        "area": string,                 // área afectada (CLI, TUI, docs…)
        "logs": string,                 // salida relevante si hay
        "additionalContext": string     // contexto extra
      }
    }
  `);

  const roadmapSection =
    mode === "roadmap"
      ? [
          "PLANIFICACIÓN DESDE ROADMAP:",
          `Leé el roadmap provisto abajo y convertilo en un plan de issues listo para crear.`,
          `ROADMAP PEGo: ${input.roadmapText || "(vacío)"}`,
        ]
      : [
          "AUDITORÍA DE REPOSITORIO:",
          "Analizá el código del repositorio actual y encontrá problemas concretos y reproducibles (bugs, deuda técnica crítica, fugas de memoria, tokens expuestos, errores de concurrencia).",
          "FUSIÓN: si varios hallazgos comparten archivo o causa raíz, fusionalos en un único issue; no dupliques issues por archivo.",
          "UMBRAL: un issue debe describir un defecto verificable con impacto real (bug, riesgo, deuda técnica). Los problemas de estilo, preferencias de formato o ejemplos desactualizados de docs NO se reportan como issues propios: si aportan, se mencionan dentro del issue del archivo que tocan, y si no, se omiten.",
        ];

  const attachmentsSection =
    attachments.length > 0
      ? [`ARCHIVOS ADJUNTOS (el usuario los subió): ${attachments.join(", ")}`]
      : [];

  // Issues ya abiertos en el repo: la regla anti-duplicación más fuerte.
  // El modelo puede leer el repo pero no los issues; esta lista le da el
  // estado real para marcar existingIssueNumber (no inventar trabajo que
  // ya está pedido). Aun si el modelo la ignora, la app hace una segunda
  // pasada determinista post-parse que marca igual los items repetidos.
  // Vacía/ausente → no se emite la sección.
  const openIssues = input.openIssues ?? [];
  const openIssuesSection =
    openIssues.length > 0
      ? [
          `ISSUES YA ABIERTOS EN EL REPO (últimos ${openIssues.length}):`,
          openIssues
            .map((issue) => `#${issue.number} ${oneLine(issue.title)}`)
            .join(" | "),
          "Regla OBLIGATORIA: ANTES de proponer cada item, revisá esta lista y compará con los issues del plan. Si el MISMO problema ya está abierto, NO lo propongas como tema nuevo: marcá existingIssueNumber con su número real. La app lo detecta el 100% de las veces; esta regla solo evita que llegue a mostrar un tema repetido en la lista.",
        ]
      : [];

  return [
    ...contextSection,
    ...roadmapSection,
    ...attachmentsSection,
    ...openIssuesSection,
    `TU TAREA: analizá el material y producí el plan de issues en un único archivo JSON.`,
    `NORMAS DE NEGOCIO: numeración 0-based en TODO el schema (parent/blockedBy/blocking/related son índices del array, NO números absolutos). `,
    `Los issues numerados en el array con índice 0 son #1 en la UI. `,
    `priority: P0 = bloqueante/urgente, P1 = alta, P2 = media, P3 = baja. size: S/M/L/XL según esfuerzo relativo. `,
    `labels = etiquetas temáticas (feature, ui, refactor, infra, perf, bug, improvement…), NO pongas status/prioridad/size como labels. `,
    `status: valor libre con sentido de Project v2 ("Todo", "In Progress", "Done", "Blocked"...). `,
`Relaciones de bloqueo: UNICAMENTE cuando existan dependencias reales (uno no se puede crear sin el otro). `,
    `Para sub-issues usá parent. Para dependencia paralela no bloqueante usá related. No inventes relaciones.`,
    `DEDUPLICACIÓN ENTRE ITEMS DEL PLAN: si dos items plantean el MISMO problema con distinta redacción (mismo bug, misma causa raíz, mismo archivo y flujo), dejá UN SOLO item canónico — el más completo y claro — y en los otros poné duplicateOf con el índice 0-based del canónico. Un item con duplicateOf se muestra en la UI como "posible duplicado" y el usuario decide si lo crea igual. `,
    `Un item NUNCA puede tener duplicateOf apuntando a sí mismo; el canónico no lleva duplicateOf. `,
    `DEDUPLICACIÓN CONTRA EL REPO: si un item del plan ya está cubierto por un issue abierto (sección ISSUES YA ABIERTOS), marcá existingIssueNumber con el número real y NO propongas un tema nuevo: el trabajo ya está pedido. Referenciar el issue en el body ("ya cubierto por...") NO alcanza ni reemplaza la marca: sin existingIssueNumber el item aparece como nuevo. Si el issue abierto es similar pero NO idéntico, proponé el item como nuevo y no uses existingIssueNumber.`,
    `NUMERACIÓN EN TEXTOS: dentro de los bodies y campos del template referenciá otros issues por su TÍTULO (ej: "depende de «Persistir el estado colapsado»"), NUNCA por número (#3) — GitHub reasigna los números al crear y un #N escrito hoy apuntaría al issue equivocado. `,
    `CADA issue (proposal o finding) debe incluir el objeto "template" completo con los campos del formulario de bug report: stepsToReproduce (3 pasos mínimos concretos), expectedBehavior, actualBehavior, version, os, agent, area, logs y additionalContext. `,
    `El template va DENTRO de cada item (proposal.template / finding.template); si es idéntico para todos, podés escribir UN SOLO template a nivel de plan ("template" raíz) y aplica a los items que no traen el suyo. `,
    `Rellená cada campo con datos reales del repositorio; si un dato no aplica, poné "—" en vez de omitir el campo. `,
    `CONCISIÓN: cada campo del template va en UNA línea corta (máx. ~120 caracteres) y cada body en ~800-1500 caracteres; el archivo completo no debe pasar de ~50KB.`,
`ESCRITURA DEL PLAN: el write de un archivo muy grande puede truncarse. Si el JSON no entra en una sola escritura, escribilo por partes (PowerShell: [System.IO.File]::WriteAllText para la parte 1 y [System.IO.File]::AppendAllText para el resto, UTF-8 sin BOM; o heredocs en bash). Al terminar, verificá SIEMPRE que el archivo parsea con Get-Content -Raw $path | ConvertFrom-Json (o jq). Nunca dejes el archivo a medias: si no podés completarlo, borralo y avisá.`,
`SALIDA: tu único entregable es el archivo ${outputPath} (ruta EXACTA, no la modifiques). `,
    `Creá los directorios con mkdir -p si hacen falta, y escribí el plan TIENE que validar contra el schema exacto del contrato: ${schema} `,
    `No crees issues ni PRs: SOLO escribís el plan JSON. Dejá un resumen final de lo que encontraste.`,
    `Formato de trabajo: sección por sección, y MIRÁ el repo real antes de proponer (no inventes código que no existe). `,
    `Prefijá cada paso relevante con [planning-${mode}].`,
  ].join(" | ");
}

export function planningOutputPath(repoPath: string, mode: PlannerMode): string {
  return `${repoPath}/.agents/planning/plan-${Date.now()}.json`;
}