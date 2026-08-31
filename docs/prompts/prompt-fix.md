# Prompt: Implementar fix (tras CAMBIOS_PEDIDOS)

> **Generado desde el código** (render del builder real) — si cambiás el builder, regenerá este doc.
>
> - **Fuente**: `src/canvas/issueFixPrompt.ts` — `buildIssueFixPrompt(input)`
> - **Lanzamiento**: `opencode --prompt <prompt> --auto` — TUI interactiva
> - **Formato**: markdown multilínea con jerarquía visual (headers `#`/`##`, listas, code blocks). El contexto del repositorio (brief activo) y la síntesis de requerimientos activa se inyectan inline, sin que el agente lea archivos.
> - Trabaja en el MISMO worktree/rama del PR existente: el fix se pushea al PR original, nunca a una rama nueva.
> - Los comentarios de la review vigente son el contrato: el agente los lee con gh y responde punto por punto.

## Prompt



```markdown
# Implementar fix — issue #<N> — <título del issue>

El reviewer pidió cambios en tu solución. Tu trabajo: aplicar los fixes pedidos y actualizar ESE MISMO PR.

## CONTEXTO DEL REPOSITORIO

Texto relevado con la entrevista de contexto (lo escribió el dueño del proyecto; es la intención, no el código):

<texto del contexto activo del repositorio — resumen del proyecto, misión, problema, usuarios, flujo ideal, visión, valores, stakeholders, alcance, fuera de alcance, restricciones, propuesta de valor, incertidumbres (lo formatea el motor con formatBriefForPrompt)>
## REQUERIMIENTOS RELEVADOS (OBLIGATORIOS: tus decisiones técnicas deben respetarlos)

<síntesis de requerimientos activa — RFs con prioridad, ASRs (obligan decisiones estructurales), restricciones globales y glosario, con la línea de procedencia "Síntesis de requerimientos usada: entrevista-<ts>-sintesis.json (fecha) — selección activa | FALLBACK: más reciente" (lo formatea el motor con formatRequirementsForPrompt)>

Mencioná en tu resumen final la línea exacta "Síntesis de requerimientos usada: <archivo>" que figura arriba (con su fecha).
## CONTEXTO INYECTADO POR LA APP
no corras gh para obtener estos datos, ya te los doy: <contexto del PR precargado por la app: headRefOid, última review, último batch de comentarios, diff file path>

## CONTEXTO DEL PR
El PR #<PR_N> (rama <rama>) ya tiene una review pendiente. Body del issue: <body original del issue (aplanado a una línea)>.

## ALCANCE
Implementá EXACTAMENTE el fix pedido por la review y nada más - sin refactors ajenos, sin features nuevas, sin tocar código fuera de lo solicitado. Respaldá cada cambio en una observación concreta del reviewer.

## PRIMERO LEÉ LA REVIEW
Confirmá el head commit actual con `gh pr view <PR_N> --json headRefOid`, el veredicto con `gh pr view <PR_N> --json reviews --jq '.reviews[]'{state,body}''` y los comentarios inline anclados con `gh api repos/{owner}/{repo}/pulls/<PR_N>/comments` y `gh api repos/{owner}/{repo}/pulls/<PR_N>/reviews` (con sus archivos y líneas).
Traé SOLO los comentarios de la review MÁS RECIENTE (no comentarios de rondas anteriores ya resueltas) - ordená por fecha y quedate con la última tanda. TODOS los comentarios vigentes de la review son el contrato del fix: respondelos uno por uno, sea implementándolos o dejando una réplica clara con gh pr comment si un comentario no aplica.

## CLASIFICACIÓN DE OBSERVACIONES
- BLOQUEANTES (parte del veredicto CAMBIOS_PEDIDOS o comentarios de línea sin aclaración de "no bloqueante"): aplicalas EXACTAMENTE como se pide, sin ampliar el alcance del paso anterior.
- "No bloqueante" u opcionales: NO las apliques automáticamente; decidí si tiene sentido aplicarla igual (si es una mejora barata y de bajo riesgo) o dejarla - en cualquier caso, mencioná tu decisión y el porqué en el resumen final, no las ignores en silencio.

## PRUEBAS Y CALIDAD
Corré los checks del repo sobre la rama (tests, typecheck/lint según el stack, shellcheck en scripts tocados). No marques el fix como hecho si algo falla: o lo corregís o dejás explícito el fallo en el comentario final. Commits de tipo conventional (type(scope): desc), sin Co-Authored-By ni atribuciones AI.

## DISCIPLINA TDD (skill tdd)
El defecto que señaló el reviewer se ataca con un ciclo red-green-refactor NUEVO, no con un parche directo: escribí primero el test que reproduce el bug (en rojo), implementá el fix, y recién cuando esté en verde cerrá el ciclo. Todos los tests del repo deben pasar antes de commitear.

## RESPUESTA AL REVIEW (skill receiving-code-review)
Ante cada observación del reviewer aplicá rigor técnico y verificación real — corré el caso, mirá el código, probá la alternativa — antes de aceptarla o descartarla. NUNCA respondas con acuerdo performativo ("tenés razón, lo corrijo") sin haber chequeado; si una observación no aplica o es incorrecta, fundamentalo técnicamente en tu réplica.

## PUSH AL PR EXISTENTE
Commitá en la rama actual y pusheá con `git push origin <rama>`. Verificá que el PR se haya actualizado con `gh pr view <PR_N>` (nuevo encabezado visible).
- NUNCA crees una rama o PR nuevo, NUNCA abras un PR nuevo y NO mergees el PR.
- NO cierres el issue manualmente (se cierra solo al mergear via "Closes #<N>").

## CIERRE DE TRAZABILIDAD
Al terminar, dejá un resumen en el PR con `gh pr comment <PR_N>` que responda PUNTO POR PUNTO a cada observación del review (bloqueante y no bloqueante): qué cambio va asociado a qué comentario, o por qué no si no aplicaste algo. No alcanza con un resumen genérico de "apliqué los fixes": es la lista corta para que el reviewer re-revise sin leer todo el diff.

## REGLAS DE ORO
- Corré los comandos gh y git DIRECTO (no los envuelvas en wrappers que ocultan stdout).
- Prefijá cada paso relevante con [fix-<N>] para poder filtrar tu trazabilidad.
- Si no hay nada que corregir porque la reseña quedó desactualizada, avisá con gh pr comment en vez de inventar cambios.
```
