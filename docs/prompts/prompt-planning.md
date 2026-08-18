# Prompt: Planificación (roadmap y auditoría)

> **Generado desde el código** (render del builder real) — si cambiás el builder, regenerá este doc.
>
> - **Fuente**: `src/planner/planningPrompt.ts` — `buildPlanningPrompt(input)`
> - **Lanzamiento**: TUI interactiva con `--prompt` (el prompt completo supera el límite de argv de Windows, se escribe a `.agents/planning/prompt-<ts>.md` y la TUI recibe una instrucción corta que le ordena al agente LEER ese archivo y ejecutar TODO su contenido — la expansión `@archivo` pertenece al sistema de COMMANDS de opencode, el texto que llega por `--prompt` es literal). El usuario ve la sesión y puede intervenir; el poller la cierra cuando el plan aparece.
> - **Formato**: markdown multilínea con jerarquía visual (headers `#`/`##`, listas, code blocks). El contexto del repositorio (brief activo) y la síntesis de requerimientos activa se inyectan inline, sin que el agente lea archivos.
> - El agente NO crea issues: su único entregable es el plan JSON en `<repo>/.agents/planning/<prefijo>-<timestamp>.json` que la app consume (`diagnostico` para auditoría, `plan` para roadmap).
> - El schema del contrato va en un code block con su jerarquía completa (dedent, nunca aplanado).
> - La sección ISSUES YA ABIERTOS es opcional: se emite solo si la app pudo leer los issues con gh.

## Prompt



## Modo: roadmap

```markdown
## CONTEXTO DEL REPOSITORIO

Texto relevado con la entrevista de contexto (lo escribió el dueño del proyecto; es la intención, no el código):

<texto del contexto activo del repositorio — resumen del proyecto, misión, problema, usuarios, flujo ideal, visión, valores, stakeholders, alcance, fuera de alcance, restricciones, propuesta de valor, incertidumbres (lo formatea el motor con formatBriefForPrompt)>
## REQUERIMIENTOS RELEVADOS (OBLIGATORIOS: tus decisiones técnicas deben respetarlos)

<síntesis de requerimientos activa — RFs con prioridad, ASRs (obligan decisiones estructurales), restricciones globales y glosario, con la línea de procedencia "Síntesis de requerimientos usada: entrevista-<ts>-sintesis.json (fecha) — selección activa | FALLBACK: más reciente" (lo formatea el motor con formatRequirementsForPrompt)>

Mencioná en tu resumen final la línea exacta "Síntesis de requerimientos usada: <archivo>" que figura arriba (con su fecha).

## TAREA: PLANIFICACIÓN DESDE ROADMAP
Leé el roadmap provisto abajo y convertilo en un plan de issues listo para crear.

### ROADMAP PEGado
<roadmap pegado por el usuario>

### DISCIPLINA DE TICKETS (skill to-tickets)
Convertí el roadmap en tickets tipo tracer-bullet — slices verticales que atraviesan TODAS las capas (frontend, backend, datos, tests), no slices horizontales por capa — cada uno con un entregable verificable propio.

### RELACIONES DE BLOQUEO EXPLÍCITAS
Declará SIEMPRE blockedBy/blocking entre issues que dependen entre sí. Estos issues se resuelven DESPUÉS EN PARALELO en worktrees distintos: las relaciones de bloqueo son lo único que evita que dos agentes trabajen el mismo archivo a la vez — no las omitas ni las dejes implícitas.


## ISSUES YA ABIERTOS EN EL REPO (últimos 1)
- #<M> <issue abierto existente>

Regla OBLIGATORIA: ANTES de proponer cada item, revisá esta lista y compará con los issues del plan. Si el MISMO problema ya está abierto, NO lo propongas como tema nuevo: marcá existingIssueNumber con su número real. La app lo detecta el 100% de las veces; esta regla solo evita que llegue a mostrar un tema repetido en la lista.

## TU TAREA
Analizá el material y producí el plan de issues en un único archivo JSON.

## NORMAS DE NEGOCIO
- Numeración 0-based en TODO el schema (parent/blockedBy/blocking/related son índices del array, NO números absolutos).
- Los issues numerados en el array con índice 0 son #1 en la UI.
- priority: P0 = bloqueante/urgente, P1 = alta, P2 = media, P3 = baja. size: S/M/L/XL según esfuerzo relativo.
- labels = etiquetas temáticas (feature, ui, refactor, infra, perf, bug, improvement…), NO pongas status/prioridad/size como labels.
- status: valor libre con sentido de Project v2 ("Todo", "In Progress", "Done", "Blocked"...).
- Relaciones de bloqueo: UNICAMENTE cuando existan dependencias reales (uno no se puede crear sin el otro).
- Para sub-issues usá parent. Para dependencia paralela no bloqueante usá related. No inventes relaciones.

## DEDUPLICACIÓN ENTRE ITEMS DEL PLAN
Si dos items plantean el MISMO problema con distinta redacción (mismo bug, misma causa raíz, mismo archivo y flujo), dejá UN SOLO item canónico — el más completo y claro — y en los otros poné duplicateOf con el índice 0-based del canónico. Un item con duplicateOf se muestra en la UI como "posible duplicado" y el usuario decide si lo crea igual.
Un item NUNCA puede tener duplicateOf apuntando a sí mismo; el canónico no lleva duplicateOf.

## DEDUPLICACIÓN CONTRA EL REPO
Si un item del plan ya está cubierto por un issue abierto (sección ISSUES YA ABIERTOS), marcá existingIssueNumber con el número real y NO propongas un tema nuevo: el trabajo ya está pedido. Referenciar el issue en el body ("ya cubierto por...") NO alcanza ni reemplaza la marca: sin existingIssueNumber el item aparece como nuevo. Si el issue abierto es similar pero NO idéntico, proponé el item como nuevo y no uses existingIssueNumber.

## NUMERACIÓN EN TEXTOS
Dentro de los bodies y campos del template referenciá otros issues por su TÍTULO (ej: "depende de «Persistir el estado colapsado»"), NUNCA por número (#3) — GitHub reasigna los números al crear y un #N escrito hoy apuntaría al issue equivocado.

## TEMPLATE DE BUG REPORT (OBLIGATORIO POR ITEM)
CADA item (proposal o finding) DEBE incluir su propio objeto "template" DENTRO del item (finding.template / proposal.template), con los campos del formulario de bug report: stepsToReproduce (3 pasos mínimos concretos), expectedBehavior, actualBehavior, version, os, agent, area, logs y additionalContext.
PROHIBIDO: NO escribas un template único a nivel de plan ("template" raíz). El template va SIEMPRE dentro de cada item, personalizado para ese hallazgo específico: sus pasos de reproducción, su comportamiento esperado/actual, su contexto.
Rellená cada campo con datos reales del repositorio; si un dato no aplica, poné "—" en vez de omitir el campo.
CONCISIÓN: cada campo del template va en UNA línea corta (máx. ~120 caracteres) y cada body en ~800-1500 caracteres; el archivo completo no debe pasar de ~50KB.

## ESCRITURA DEL PLAN
El write de un archivo muy grande puede truncarse. Si el JSON no entra en una sola escritura, escribilo por partes (PowerShell: [System.IO.File]::WriteAllText para la parte 1 y [System.IO.File]::AppendAllText para el resto, UTF-8 sin BOM; o heredocs en bash). Al terminar, verificá SIEMPRE que el archivo parsea con Get-Content -Raw $path | ConvertFrom-Json (o jq). Nunca dejes el archivo a medias: si no podés completarlo, borralo y avisá.

## SALIDA
Tu único entregable es el archivo <repo>/.agents/planning/<prefijo>-<timestamp>.json (ruta EXACTA, no la modifiques).
Creá los directorios con mkdir -p si hacen falta, y escribí el plan TIENE que validar contra el schema exacto del contrato:

```json
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

```

- No crees issues ni PRs: SOLO escribís el plan JSON. Dejá un resumen final de lo que encontraste.
- Formato de trabajo: sección por sección, y MIRÁ el repo real antes de proponer (no inventes código que no existe).
- Prefijá cada paso relevante con [planning-roadmap].
```

## Modo: auditoría

```markdown
## CONTEXTO DEL REPOSITORIO

Texto relevado con la entrevista de contexto (lo escribió el dueño del proyecto; es la intención, no el código):

<texto del contexto activo del repositorio — resumen del proyecto, misión, problema, usuarios, flujo ideal, visión, valores, stakeholders, alcance, fuera de alcance, restricciones, propuesta de valor, incertidumbres (lo formatea el motor con formatBriefForPrompt)>
## REQUERIMIENTOS RELEVADOS (OBLIGATORIOS: tus decisiones técnicas deben respetarlos)

<síntesis de requerimientos activa — RFs con prioridad, ASRs (obligan decisiones estructurales), restricciones globales y glosario, con la línea de procedencia "Síntesis de requerimientos usada: entrevista-<ts>-sintesis.json (fecha) — selección activa | FALLBACK: más reciente" (lo formatea el motor con formatRequirementsForPrompt)>

Mencioná en tu resumen final la línea exacta "Síntesis de requerimientos usada: <archivo>" que figura arriba (con su fecha).

## TAREA: AUDITORÍA DE REPOSITORIO
Analizá el código del repositorio actual y encontrá problemas concretos y reproducibles (bugs, deuda técnica crítica, fugas de memoria, tokens expuestos, errores de concurrencia).

### FUSIÓN
Si varios hallazgos comparten archivo o causa raíz, fusionalos en un único issue; no dupliques issues por archivo.

### UMBRAL
Un issue debe describir un defecto verificable con impacto real (bug, riesgo, deuda técnica). Los problemas de estilo, preferencias de formato o ejemplos desactualizados de docs NO se reportan como issues propios: si aportan, se mencionan dentro del issue del archivo que tocan, y si no, se omiten.


## ISSUES YA ABIERTOS EN EL REPO (últimos 1)
- #<M> <issue abierto existente>

Regla OBLIGATORIA: ANTES de proponer cada item, revisá esta lista y compará con los issues del plan. Si el MISMO problema ya está abierto, NO lo propongas como tema nuevo: marcá existingIssueNumber con su número real. La app lo detecta el 100% de las veces; esta regla solo evita que llegue a mostrar un tema repetido en la lista.

## TU TAREA
Analizá el material y producí el plan de issues en un único archivo JSON.

## NORMAS DE NEGOCIO
- Numeración 0-based en TODO el schema (parent/blockedBy/blocking/related son índices del array, NO números absolutos).
- Los issues numerados en el array con índice 0 son #1 en la UI.
- priority: P0 = bloqueante/urgente, P1 = alta, P2 = media, P3 = baja. size: S/M/L/XL según esfuerzo relativo.
- labels = etiquetas temáticas (feature, ui, refactor, infra, perf, bug, improvement…), NO pongas status/prioridad/size como labels.
- status: valor libre con sentido de Project v2 ("Todo", "In Progress", "Done", "Blocked"...).
- Relaciones de bloqueo: UNICAMENTE cuando existan dependencias reales (uno no se puede crear sin el otro).
- Para sub-issues usá parent. Para dependencia paralela no bloqueante usá related. No inventes relaciones.

## DEDUPLICACIÓN ENTRE ITEMS DEL PLAN
Si dos items plantean el MISMO problema con distinta redacción (mismo bug, misma causa raíz, mismo archivo y flujo), dejá UN SOLO item canónico — el más completo y claro — y en los otros poné duplicateOf con el índice 0-based del canónico. Un item con duplicateOf se muestra en la UI como "posible duplicado" y el usuario decide si lo crea igual.
Un item NUNCA puede tener duplicateOf apuntando a sí mismo; el canónico no lleva duplicateOf.

## DEDUPLICACIÓN CONTRA EL REPO
Si un item del plan ya está cubierto por un issue abierto (sección ISSUES YA ABIERTOS), marcá existingIssueNumber con el número real y NO propongas un tema nuevo: el trabajo ya está pedido. Referenciar el issue en el body ("ya cubierto por...") NO alcanza ni reemplaza la marca: sin existingIssueNumber el item aparece como nuevo. Si el issue abierto es similar pero NO idéntico, proponé el item como nuevo y no uses existingIssueNumber.

## NUMERACIÓN EN TEXTOS
Dentro de los bodies y campos del template referenciá otros issues por su TÍTULO (ej: "depende de «Persistir el estado colapsado»"), NUNCA por número (#3) — GitHub reasigna los números al crear y un #N escrito hoy apuntaría al issue equivocado.

## TEMPLATE DE BUG REPORT (OBLIGATORIO POR ITEM)
CADA item (proposal o finding) DEBE incluir su propio objeto "template" DENTRO del item (finding.template / proposal.template), con los campos del formulario de bug report: stepsToReproduce (3 pasos mínimos concretos), expectedBehavior, actualBehavior, version, os, agent, area, logs y additionalContext.
PROHIBIDO: NO escribas un template único a nivel de plan ("template" raíz). El template va SIEMPRE dentro de cada item, personalizado para ese hallazgo específico: sus pasos de reproducción, su comportamiento esperado/actual, su contexto.
Rellená cada campo con datos reales del repositorio; si un dato no aplica, poné "—" en vez de omitir el campo.
CONCISIÓN: cada campo del template va en UNA línea corta (máx. ~120 caracteres) y cada body en ~800-1500 caracteres; el archivo completo no debe pasar de ~50KB.

## ESCRITURA DEL PLAN
El write de un archivo muy grande puede truncarse. Si el JSON no entra en una sola escritura, escribilo por partes (PowerShell: [System.IO.File]::WriteAllText para la parte 1 y [System.IO.File]::AppendAllText para el resto, UTF-8 sin BOM; o heredocs en bash). Al terminar, verificá SIEMPRE que el archivo parsea con Get-Content -Raw $path | ConvertFrom-Json (o jq). Nunca dejes el archivo a medias: si no podés completarlo, borralo y avisá.

## SALIDA
Tu único entregable es el archivo <repo>/.agents/planning/<prefijo>-<timestamp>.json (ruta EXACTA, no la modifiques).
Creá los directorios con mkdir -p si hacen falta, y escribí el plan TIENE que validar contra el schema exacto del contrato:

```json
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

```

- No crees issues ni PRs: SOLO escribís el plan JSON. Dejá un resumen final de lo que encontraste.
- Formato de trabajo: sección por sección, y MIRÁ el repo real antes de proponer (no inventes código que no existe).
- Prefijá cada paso relevante con [planning-audit].
```
