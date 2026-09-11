import type { PlannerMode } from "../types/issuePlanning.ts";
import type { DiagnosisCategoryId } from "../types/diagnosisCategories.ts";
import { getDiagnosisCategory, diagnosisFileName, legacyDiagnosisFileName } from "../types/diagnosisCategories.ts";
import { skillForCategory } from "../skills/registry";
import { buildRepoContextSection, buildRequirementsSection, buildArchitectureDecisionsSection } from "../utils/repoContext";
import { TAG_PLANNING, withPhaseTag } from "../../headless-runtime/llm/phaseTags";

export interface PlanningPromptInput {
  mode: PlannerMode;
  // Categoría del diagnóstico por categorías (solo mode audit): define el
  // foco del análisis y qué queda fuera de alcance. Con toolFindingsText el
  // LLM interpreta SOLO esos hallazgos bajo ese foco; sin herramientas, la
  // exploración dirigida de la categoría reemplaza a la auditoría clásica.
  category?: DiagnosisCategoryId;
  // Texto del contexto activo del repositorio (brief formateado por el motor
  // de entrevista). Se inyecta inline por buildRepoContextSection; el agente
  // no lee ningún archivo.
  repoContextText?: string;
  // Texto de la síntesis de requerimientos activa (RFs, ASRs, restricciones,
  // glosario) formateado por el motor. Se inyecta inline por
  // buildRequirementsSection; el agente no lee ningún archivo.
  requirementsText?: string;
  // Decisiones de arquitectura activas (ADRs del manifiesto). Inline por
  // buildArchitectureDecisionsSection, tras REQUERIMIENTOS RELEVADOS: el
  // planner no debe proponer issues que contradigan una decisión aceptada.
  decisionsText?: string;
  roadmapText?: string;
  attachmentNames?: string[];
  outputPath: string;
  // Hallazgos de las herramientas deterministas (tool-findings) formateados
  // como texto legible. Solo en mode audit: cuando está presente, el prompt
  // deja de pedir "leé todo el repo" y pasa a interpretar/deduplicar estos
  // hallazgos + exploración dirigida (pipeline herramientas + LLM).
  toolFindingsText?: string;
   // Issues abiertos del repo (número | título): el plan marca con
   // existingIssueNumber a los que repiten un problema ya pedido. Opcional:
   // si no se pudo leer, el plan simplemente no trae esa marca.
   openIssues?: Array<{ number: number; title: string }>;
   // Nombres de skills vendor descubiertas para la categoría
   // (vendorSkills.discoverVendorSkills sobre resources/diagnosis-skills).
   // Se ANUNCIAN por nombre con orden de carga explícita; sus cuerpos NO se
   // inyectan acá (pueden ser muchas: inflarían el prompt base). Vacío o
   // ausente = corrida sin vendor, igual que siempre.
   vendorSkillNames?: string[];
}

function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, " ");
}

// Saca la indentación común de un template literal multilínea: el schema del
// contrato se inyecta ALINEADO a la izquierda dentro del bloque ```json```,
// con su jerarquía visual completa (no aplanado como el resto del prompt).
function dedent(value: string): string {
  const lines = value.replace(/^\n/, "").split("\n");
  const indent = Math.min(
    ...lines.filter((l) => l.trim().length > 0).map((l) => /^\s*/.exec(l)![0].length),
  );
  return lines.map((l) => l.slice(indent)).join("\n");
}

/**
 * Construye el prompt que se le manda a la sesión de opencode para la
 * pantalla de Planificación.
 *
 * El agente NO crea issues directamente: su único entregable es el plan
 * JSON en <repo>/.agents/planning/<prefijo>-<timestamp>.json — prefijo
 * `diagnostico` para auditoría (mode audit) y `plan` para roadmap — que la
 * app consume después para renderizar la lista y crear los issues marcados.
 *
 * El prompt es markdown multilínea con jerarquía visual (headers, listas):
 * el modelo sigue cada regla con más fidelidad que con el separador " | "
 * de una sola línea que se usaba antes.
 */
export function buildPlanningPrompt(input: PlanningPromptInput): string {
  const { mode, outputPath } = input;
  const attachments = input.attachmentNames ?? [];
  const category = input.category ? getDiagnosisCategory(input.category) : undefined;

  // Metodología de la categoría inyectada INLINE (opción B): el cuerpo de la
  // skill diag-<id> viaja DENTRO del prompt — garantizado en contexto, sin
  // depender de que el agente decida cargar la herramienta skill. Fuente
  // única: registry.ts (el MISMO body que scopedSession materializa como
  // SKILL.md efímero; acá se reusa, no se duplica).
  const categorySkill = category ? skillForCategory(category.id) : null;
  const methodologySection = categorySkill
    ? [
        ``,
        `## METODOLOGÍA DE LA CATEGORÍA (incluida acá — no cargues ninguna skill para esto)`,
        `El cuerpo completo de la skill ${categorySkill.name} está incluido abajo: es tu criterio OBLIGATORIO para este diagnóstico — qué investigar, cómo calibrar severidad, qué falsos positivos descartar y qué evidencia exige cada finding.`,
        ``,
        categorySkill.body,
      ]
    : [];

  // Skills vendor del usuario (resources/diagnosis-skills): permitidas en la
  // sesión scopeada pero NO inyectadas al prompt (pueden ser muchas). Se
  // anuncian por nombre con orden explícita de cargarlas todas.
  const vendorNames = (input.vendorSkillNames ?? []).filter(Boolean);
  const vendorSkillsSection =
    category && vendorNames.length > 0
      ? [
          ``,
          `## SKILLS ADICIONALES DE LA CATEGORÍA (permitidas en esta sesión)`,
          `Además de la metodología incluida arriba, tu sesión tiene permitidas estas skills provistas para la categoría «${category.label}»: ${vendorNames.join(", ")}.`,
          `Cargá TODAS con tu herramienta skill ANTES de comenzar el análisis y usalas como criterio complementario. Si alguna falla al cargar, continuá sin ella y seguí la metodología incluida.`,
        ]
      : [];

  // Contexto del repositorio: el texto del brief ACTIVO del proyecto, que
  // pesa sobre TODOS los hallazgos y propuestas. Se inyecta inline (el agente
  // no lee ningún archivo). No es obligatorio: sin texto la sección no se
  // emite y el prompt queda igual que antes.
  const contextSection = buildRepoContextSection(input.repoContextText);

  // El schema es el CONTRATO que el modelo debe reproducir: se inyecta con
  // su jerarquía JSON completa (dedent), nunca aplanado — un schema aplanado
  // pierde la estructura que el modelo debe seguir.
  const schema = dedent(`
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
          "existingIssueNumber"?: number,  // número real de un issue ABIERTO que YA cubre este problema (ver DEDUPLICACIÓN)
          "template": {  // OBLIGATORIO por item, personalizado para ESTE item (ver TEMPLATE DE BUG REPORT):
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
      ],
      "findings"?: [
        {
          "title": string,
          "severity": "critical" | "high" | "medium" | "low",
          "file": "ruta/relativa.ts",
          "line": number,
          "description": string,
          "labels": string[],  // etiquetas temáticas (bug, security, docs, tests, perf…)
          "template": {  // OBLIGATORIO por item, personalizado para ESTE finding (ver TEMPLATE DE BUG REPORT):
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
      ],
      "requisitos"?: [  // OBLIGATORIO por ítem de REQUERIMIENTOS RELEVADOS (ver VEREDICTO DE REQUERIMIENTOS):
        {
          "id": string,  // RF-001, ASR-001, CON-001…
          "estado": "CUMPLE" | "NO_CUMPLE" | "PARCIAL" | "NO_VERIFICABLE",
          "justificacion": string  // evidencia file:line cuando aplica
        }
      ]
    }
  `);

  const roadmapSection =
    mode === "roadmap"
      ? [
          `## TAREA: PLANIFICACIÓN DESDE ROADMAP`,
          `Leé el roadmap provisto abajo y convertilo en un plan de issues listo para crear.`,
          ``,
          `### ROADMAP PEGado`,
          input.roadmapText || "(vacío)",
          ``,
          `### DISCIPLINA DE TICKETS (skill to-tickets)`,
          `Convertí el roadmap en tickets tipo tracer-bullet — slices verticales que atraviesan TODAS las capas (frontend, backend, datos, tests), no slices horizontales por capa — cada uno con un entregable verificable propio.`,
          ``,
          `### RELACIONES DE BLOQUEO EXPLÍCITAS`,
          `Declará SIEMPRE blockedBy/blocking entre issues que dependen entre sí. Estos issues se resuelven DESPUÉS EN PARALELO en worktrees distintos: las relaciones de bloqueo son lo único que evita que dos agentes trabajen el mismo archivo a la vez — no las omitas ni las dejes implícitas.`,
        ]
      : input.toolFindingsText
        ? [
            // Pipeline herramientas + LLM: el LLM NO relee el repo entero,
            // interpreta la salida de las herramientas deterministas.
            `## HALLAZGOS DE HERRAMIENTAS DETERMINISTICAS`,
            `Las siguientes herramientas escanearon el 100% del repositorio (cobertura garantizada por construcción, no estimada). NO releas los archivos que estas herramientas ya cubrieron salvo que necesites más contexto para interpretar un hallazgo puntual.`,
            ``,
            input.toolFindingsText,
            ``,
            `## TU TRABAJO (pipeline herramientas + LLM)`,
            ...(category
              ? [
                  `REGLA DE FOCO (categoría «${category.label}»): este plan pertenece ÚNICAMENTE a esta categoría. Entra: ${category.scopeIn}. Queda FUERA DE ALCANCE (${category.scopeOut}): descartalo como ruido aunque lo notes — otro diagnóstico por categoría los cubre.`,
                  ...methodologySection,
                  ...vendorSkillsSection,
                  ``,
                ]
              : []),
            `1. Interpretar y priorizar los hallazgos de arriba: cuáles son ruido (falsos positivos, triviales) y cuáles son reales.`,
            `2. Deduplicar: si dos herramientas marcan el mismo problema en el mismo archivo, es UN issue, no dos.`,
            `3. Cruzar contra los REQUERIMIENTOS Y ASR de la sección de arriba: un hallazgo en un dominio gobernado por un ASR sube de prioridad.`,
            `4. Exploración dirigida (acá sí leés código, pero con foco): los archivos marcados con alta duplicación, complejidad o dependencias son candidatos para juicio de diseño (SOLID, cohesión) que ninguna herramienta puede evaluar.`,
            `5. Buscá lo que NINGUNA herramienta cubre: fugas de memoria, condiciones de carrera, consistencia de nombres contra el glosario, calidad semántica del manejo de errores.`,
          ]
        : category
          ? [
              // Categoría sin herramientas deterministas (LLM-only): la
              // exploración dirigida de la categoría reemplaza a la
              // auditoría clásica de "leé todo el repo".
              `## DIAGNÓSTICO SIN HERRAMIENTAS DETERMINISTICAS`,
              `La categoría «${category.label}» NO tiene herramientas estáticas asignadas: tu juicio explorando el código es la única fuente de evidencia.`,
              ``,
              `### ENTRA EN ALCANCE`,
              category.scopeIn,
              ``,
              `### QUEDA FUERA DE ALCANCE`,
              `${category.scopeOut}. Si notás problemas fuera de alcance, NO los reportes como items del plan: otro diagnóstico por categoría los cubre.`,
              ...methodologySection,
              ...vendorSkillsSection,
              ``,
              `### MÉTODO`,
              `1. Explorá el repo con foco EXCLUSIVO en el alcance de arriba, módulo por módulo.`,
              `2. Cada finding necesita evidencia concreta file:line: sin evidencia citable, no es finding.`,
              `3. Priorizá por impacto real, no por cantidad: pocos findings sólidos valen más que muchos especulativos.`,
            ]
          : [
            // Sin herramientas ni categoría: auditoría clásica de "leé el
            // repo" (camino defensivo; la app siempre lanza con categoría).
            `## TAREA: AUDITORÍA DE REPOSITORIO`,
            `Analizá el código del repositorio actual y encontrá problemas concretos y reproducibles (bugs, deuda técnica crítica, fugas de memoria, tokens expuestos, errores de concurrencia).`,
            ``,
            `### FUSIÓN`,
            `Si varios hallazgos comparten archivo o causa raíz, fusionalos en un único issue; no dupliques issues por archivo.`,
            ``,
            `### UMBRAL`,
            `Un issue debe describir un defecto verificable con impacto real (bug, riesgo, deuda técnica). Los problemas de estilo, preferencias de formato o ejemplos desactualizados de docs NO se reportan como issues propios: si aportan, se mencionan dentro del issue del archivo que tocan, y si no, se omiten.`,
          ];

  // FUSIÓN/UMBRAL aplican también al pipeline de herramientas (el LLM sigue
  // fusionando hallazgos que comparten causa raíz y filtrando ruido).
  const auditFusionSection =
    mode === "audit" && input.toolFindingsText
      ? [
          ``,
          `### FUSIÓN`,
          `Si varios hallazgos comparten archivo o causa raíz, fusionalos en un único issue; no dupliques issues por archivo.`,
          ``,
          `### UMBRAL`,
          `Un issue debe describir un defecto verificable con impacto real (bug, riesgo, deuda técnica). Los problemas de estilo, preferencias de formato o ejemplos desactualizados de docs NO se reportan como issues propios: si aportan, se mencionan dentro del issue del archivo que tocan, y si no, se omiten.`,
        ]
      : [];

  // Veredicto de cumplimiento de requerimientos: se emite solo cuando la
  // síntesis (RFs/ASRs/restricciones) está inyectada — sin ella no hay nada
  // que evaluar. En el diagnóstico por categorías, SOLO la categoría
  // «requerimientos» lo emite (responsabilidad única por llamada: las otras
  // categorías no cargan con el veredicto); el modo roadmap lo mantiene
  // igual que siempre.
  const verdictSection =
    input.requirementsText &&
    (mode === "roadmap" || input.category === "requerimientos")
      ? [
        `## VEREDICTO DE REQUERIMIENTOS (OBLIGATORIO)`,
        `Evaluá CADA requerimiento funcional, ASR y restricción de la sección REQUERIMIENTOS RELEVADOS contra el código real del repositorio.`,
        ...(input.requirementsText.includes("HISTORIAS DE USUARIO")
          ? [
              `Las historias de usuario de la sección son CONTEXTO DE PRODUCTO (el por qué detrás de los requerimientos): se usan para priorizar y redactar issues con narrativa, pero NO se evalúan como ítems de veredicto. El veredicto aplica solo a RFs, ASRs y restricciones.`,
            ]
          : []),
        `Escribí en "requisitos" un objeto por ítem: { "id": "<id>", "estado": "...", "justificacion": "..." } con estado en CUMPLE | NO_CUMPLE | PARCIAL | NO_VERIFICABLE.`,
        `- CUMPLE: el código implementa el requerimiento.`,
        `- NO_CUMPLE: el requerimiento no está implementado (citá evidencia file:line).`,
        `- PARCIAL: existe implementado a medias (decí qué falta).`,
        `- NO_VERIFICABLE: requiere medición o ejecución (performance, runtime, comportamiento en dispositivo real) — indicá el motivo. NO inventes cumplimiento: sin evidencia estática, es NO_VERIFICABLE.`,
        `CADA ítem con estado NO_CUMPLE o PARCIAL DEBE reportarse ADEMÁS como un finding: rule "requisito-no-cumplido", severity según el tipo (ASR genuino → high; RF o restricción → medium), title basado en el requerimiento, file/line de la evidencia y description = justificación del veredicto.`,
      ]
    : [];

  const attachmentsSection =
    attachments.length > 0
      ? [
          `## ARCHIVOS ADJUNTOS`,
          `El usuario los subió: ${attachments.join(", ")}`,
        ]
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
          `## ISSUES YA ABIERTOS EN EL REPO (últimos ${openIssues.length})`,
          openIssues
            .map((issue) => `- #${issue.number} ${oneLine(issue.title)}`)
            .join("\n"),
          ``,
          `Regla OBLIGATORIA: ANTES de proponer cada item, revisá esta lista y compará con los issues del plan. Si el MISMO problema ya está abierto, NO lo propongas como tema nuevo: marcá existingIssueNumber con su número real. La app lo detecta el 100% de las veces; esta regla solo evita que llegue a mostrar un tema repetido en la lista.`,
        ]
      : [];

  const body = [
    ...contextSection,
    ...buildRequirementsSection(input.requirementsText),
    ...buildArchitectureDecisionsSection(input.decisionsText),
    "",
    ...roadmapSection,
    ...auditFusionSection,
    ...verdictSection,
    "",
    ...attachmentsSection,
    "",
    ...openIssuesSection,
    "",
    `## TU TAREA`,
    `Analizá el material y producí el plan de issues en un único archivo JSON.`,
    "",
    `## NORMAS DE NEGOCIO`,
    `- Numeración 0-based en TODO el schema (parent/blockedBy/blocking/related son índices del array, NO números absolutos).`,
    `- Los issues numerados en el array con índice 0 son #1 en la UI.`,
    `- priority: P0 = bloqueante/urgente, P1 = alta, P2 = media, P3 = baja. size: S/M/L/XL según esfuerzo relativo.`,
    `- labels = etiquetas temáticas (feature, ui, refactor, infra, perf, bug, improvement…), NO pongas status/prioridad/size como labels.`,
    `- status: valor libre con sentido de Project v2 ("Todo", "In Progress", "Done", "Blocked"...).`,
    `- Relaciones de bloqueo: UNICAMENTE cuando existan dependencias reales (uno no se puede crear sin el otro).`,
    `- Para sub-issues usá parent. Para dependencia paralela no bloqueante usá related. No inventes relaciones.`,
    "",
    `## DEDUPLICACIÓN ENTRE ITEMS DEL PLAN`,
    `Si dos items plantean el MISMO problema con distinta redacción (mismo bug, misma causa raíz, mismo archivo y flujo), dejá UN SOLO item canónico — el más completo y claro — y en los otros poné duplicateOf con el índice 0-based del canónico. Un item con duplicateOf se muestra en la UI como "posible duplicado" y el usuario decide si lo crea igual.`,
    `Un item NUNCA puede tener duplicateOf apuntando a sí mismo; el canónico no lleva duplicateOf.`,
    "",
    `## DEDUPLICACIÓN CONTRA EL REPO`,
    `Si un item del plan ya está cubierto por un issue abierto (sección ISSUES YA ABIERTOS), marcá existingIssueNumber con el número real y NO propongas un tema nuevo: el trabajo ya está pedido. Referenciar el issue en el body ("ya cubierto por...") NO alcanza ni reemplaza la marca: sin existingIssueNumber el item aparece como nuevo. Si el issue abierto es similar pero NO idéntico, proponé el item como nuevo y no uses existingIssueNumber.`,
    "",
    `## NUMERACIÓN EN TEXTOS`,
    `Dentro de los bodies y campos del template referenciá otros issues por su TÍTULO (ej: "depende de «Persistir el estado colapsado»"), NUNCA por número (#3) — GitHub reasigna los números al crear y un #N escrito hoy apuntaría al issue equivocado.`,
    "",
    "## TEMPLATE DE BUG REPORT (OBLIGATORIO POR ITEM)",
    `CADA item (proposal o finding) DEBE incluir su propio objeto "template" DENTRO del item (finding.template / proposal.template), con los campos del formulario de bug report: stepsToReproduce (3 pasos mínimos concretos), expectedBehavior, actualBehavior, version, os, agent, area, logs y additionalContext.`,
    `PROHIBIDO: NO escribas un template único a nivel de plan ("template" raíz). El template va SIEMPRE dentro de cada item, personalizado para ese hallazgo específico: sus pasos de reproducción, su comportamiento esperado/actual, su contexto.`,
    `Rellená cada campo con datos reales del repositorio; si un dato no aplica, poné "—" en vez de omitir el campo.`,
    `CONCISIÓN: cada campo del template va en UNA línea corta (máx. ~120 caracteres) y cada body en ~800-1500 caracteres; el archivo completo no debe pasar de ~50KB.`,
    "",
    `## ESCRITURA DEL PLAN`,
    `El write de un archivo muy grande puede truncarse. Si el JSON no entra en una sola escritura, escribilo por partes (PowerShell: [System.IO.File]::WriteAllText para la parte 1 y [System.IO.File]::AppendAllText para el resto, UTF-8 sin BOM; o heredocs en bash). Al terminar, verificá SIEMPRE que el archivo parsea con Get-Content -Raw $path | ConvertFrom-Json (o jq). Nunca dejes el archivo a medias: si no podés completarlo, borralo y avisá.`,
    "",
    `## SALIDA`,
    `Tu único entregable es el archivo ${outputPath} (ruta EXACTA, no la modifiques).`,
    `Creá los directorios con mkdir -p si hacen falta, y escribí el plan TIENE que validar contra el schema exacto del contrato:`,
    "",
    "```json",
    schema,
    "```",
    "",
    `- No crees issues ni PRs: SOLO escribís el plan JSON. Dejá un resumen final de lo que encontraste.`,
    `- Formato de trabajo: sección por sección, y MIRÁ el repo real antes de proponer (no inventes código que no existe).`,
    `- Prefijá cada paso relevante con [planning-${mode}].`,
  ].join("\n");
  // Etiqueta humana de fase (primera línea).
  return withPhaseTag(body, TAG_PLANNING);
}

export function planningOutputPath(
  repoPath: string,
  mode: PlannerMode,
  category?: DiagnosisCategoryId,
): string {
  const dir = `${repoPath}/.agents/planning/diagnostics`;
  if (mode !== "audit") {
    return `${dir}/plan-${Date.now()}.json`;
  }
  const ts = Date.now();
  return category
    ? `${dir}/${diagnosisFileName(category, ts)}`
    : `${dir}/${legacyDiagnosisFileName(ts)}`;
}
