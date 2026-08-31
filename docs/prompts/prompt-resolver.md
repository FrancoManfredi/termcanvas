# Prompt: Resolver issue (nuevo y retomar)

> **Generado desde el código** (render del builder real) — si cambiás el builder, regenerá este doc.
>
> - **Fuente**: `src/canvas/issueResolvePrompt.ts` — `buildIssueResolvePrompt(input, mode)`
> - **Lanzamiento**: `opencode --prompt <prompt> --auto` — TUI interactiva
> - **Formato**: markdown multilínea con jerarquía visual (headers `#`/`##`, listas, code blocks). El contexto del repositorio (brief activo) y la síntesis de requerimientos activa se inyectan inline, sin que el agente lea archivos.
> - Dos modos: `new` (arranca el trabajo) y `resume` (retoma una rama/worktree existente con su historial).

## Prompt



## Modo: nuevo

```markdown
# Resolver issue #<N> — <título del issue>

## CONTEXTO DEL REPOSITORIO

Texto relevado con la entrevista de contexto (lo escribió el dueño del proyecto; es la intención, no el código):

<texto del contexto activo del repositorio — resumen del proyecto, misión, problema, usuarios, flujo ideal, visión, valores, stakeholders, alcance, fuera de alcance, restricciones, propuesta de valor, incertidumbres (lo formatea el motor con formatBriefForPrompt)>
## REQUERIMIENTOS RELEVADOS (OBLIGATORIOS: tus decisiones técnicas deben respetarlos)

<síntesis de requerimientos activa — RFs con prioridad, ASRs (obligan decisiones estructurales), restricciones globales y glosario, con la línea de procedencia "Síntesis de requerimientos usada: entrevista-<ts>-sintesis.json (fecha) — selección activa | FALLBACK: más reciente" (lo formatea el motor con formatRequirementsForPrompt)>

Mencioná en tu resumen final la línea exacta "Síntesis de requerimientos usada: <archivo>" que figura arriba (con su fecha).
## ALCANCE
El issue aprobado es el contrato: no agregues requisitos fuera de su scope, no inventes features, no te saltes no-goals.

## BODY ORIGINAL DEL ISSUE
<body original del issue (aplanado a una línea)>

## RESTRICCIONES
- work-unit commits con conventional commits (type(scope): desc).
- shellcheck en todo script modificado.
- sin Co-Authored-By ni atribuciones AI.
- actualizar docs si cambia el comportamiento.

## DISCIPLINA TDD (skill tdd)
Confirmá qué comportamientos hay que testear, diseñá la interfaz pensando en que sea testeable, escribí UN test a la vez (test primero, red-green-refactor), implementá recién cuando tengas el test en rojo, y buscá oportunidades de refactor al final de cada slice. No commitees nada sin que TODOS los tests pasen.

## LOGGING PARA DEBUG MANUAL
Como el usuario va a probar manualmente el resultado antes de que se archive el cambio, agregá logging generoso y descriptivo en el código que toques — no solo para vos, para que un humano pueda ver en la consola exactamente qué está pasando paso a paso al usar la feature/fix en vivo.
- Logueá con un prefijo identificable, ej: [fix-<nombre-del-change>] o [feature-<nombre>], para poder filtrarlos fácil en devtools.
- Logueá en los puntos de decisión clave (ej: "¿se detectó el target correcto?", "¿el evento se está bloqueando o dejando pasar?"), no solo al principio/final de una función.
- Si el fix depende de una condición (ej: un selector de DOM, un estado de store), logueá el valor real evaluado en cada intento, no solo "true/false" — mostrá el dato concreto que se comparó.
- Estos logs pueden quedar en el código final (no los borres antes de archivar) — el usuario los va a usar para reportar bugs con evidencia concreta en vez de descripciones vagas. Si en el futuro se decide sacarlos, será un cambio aparte.

## GESTIÓN DEL ISSUE
- NO cierres el issue manualmente: el cierre ocurre automático al mergear el PR vía "Closes #<N>".
- Podés comentar avances con gh issue comment.
- Podés modificar las relaciones blocked-by/blocking/parent del issue (agregar, quitar o reordenar) cuando reflejen la realidad del trabajo; comentá el cambio con gh issue comment.

## VERIFICACIÓN ANTES DE COMPLETAR (skill verification-before-completion)
No afirmes "está listo" sin haber corrido antes la verificación real — tests, typecheck y lint según el stack — y mostrá el resultado concreto de cada check en el resumen final (qué corriste y qué devolvió, no solo "pasó").

## ENTREGA FINAL
Cuando termines de implementar y los checks pasen, creá el PR con la skill branch-pr: branch type/descripcion, body con "Closes #<N>", un solo label type:*, esperar checks automatizados.
PRs: auto-chain. Presupuesto de review: 800 líneas. PRs encadenados: stacked-to-main — la evaluación de corte con la skill chained-pr es SIEMPRE obligatoria al terminar: medí el PR resultante (no el tamaño que parecía tener el issue al arrancar) y si supera el presupuesto de review de 800 líneas, cortalo en PRs encadenados hacia main. Que la evaluación sea siempre no implica cortar siempre: el corte ocurre solo cuando el PR real lo amerita.
Los labels del ciclo de review (review:pendiente, review:aprobado, review:comentado, review:fix-aplicado, conflicto:main) los aplica la app automáticamente al detectar el PR o los pushes; NO los toques con gh issue edit.

## AL TERMINAR, RESUMÍ
1. Qué se implementó.
2. Qué checks corriste (tests/typecheck/lint) y su resultado.
3. URL del PR.
```

## Modo: retomar

```markdown
# Retomar issue #<N> — <título del issue>
Ya existe una rama y worktree para esta issue (podés ver el historial de commits con git log para entender qué se hizo hasta ahora). Continuá desde donde quedó: revisá los artifacts de engram si existen (mem_search/mem_context sobre el topic del issue) para entender qué se avanzó; no revises openspec/changes/.

## CONTEXTO DEL REPOSITORIO

Texto relevado con la entrevista de contexto (lo escribió el dueño del proyecto; es la intención, no el código):

<texto del contexto activo del repositorio — resumen del proyecto, misión, problema, usuarios, flujo ideal, visión, valores, stakeholders, alcance, fuera de alcance, restricciones, propuesta de valor, incertidumbres (lo formatea el motor con formatBriefForPrompt)>
## REQUERIMIENTOS RELEVADOS (OBLIGATORIOS: tus decisiones técnicas deben respetarlos)

<síntesis de requerimientos activa — RFs con prioridad, ASRs (obligan decisiones estructurales), restricciones globales y glosario, con la línea de procedencia "Síntesis de requerimientos usada: entrevista-<ts>-sintesis.json (fecha) — selección activa | FALLBACK: más reciente" (lo formatea el motor con formatRequirementsForPrompt)>

Mencioná en tu resumen final la línea exacta "Síntesis de requerimientos usada: <archivo>" que figura arriba (con su fecha).
## ALCANCE
El issue aprobado es el contrato: no agregues requisitos fuera de su scope, no inventes features, no te saltes no-goals.

## BODY ORIGINAL DEL ISSUE
<body original del issue (aplanado a una línea)>

## RESTRICCIONES
- work-unit commits con conventional commits (type(scope): desc).
- shellcheck en todo script modificado.
- sin Co-Authored-By ni atribuciones AI.
- actualizar docs si cambia el comportamiento.

## DISCIPLINA TDD (skill tdd)
Confirmá qué comportamientos hay que testear, diseñá la interfaz pensando en que sea testeable, escribí UN test a la vez (test primero, red-green-refactor), implementá recién cuando tengas el test en rojo, y buscá oportunidades de refactor al final de cada slice. No commitees nada sin que TODOS los tests pasen.

## LOGGING PARA DEBUG MANUAL
Como el usuario va a probar manualmente el resultado antes de que se archive el cambio, agregá logging generoso y descriptivo en el código que toques — no solo para vos, para que un humano pueda ver en la consola exactamente qué está pasando paso a paso al usar la feature/fix en vivo.
- Logueá con un prefijo identificable, ej: [fix-<nombre-del-change>] o [feature-<nombre>], para poder filtrarlos fácil en devtools.
- Logueá en los puntos de decisión clave (ej: "¿se detectó el target correcto?", "¿el evento se está bloqueando o dejando pasar?"), no solo al principio/final de una función.
- Si el fix depende de una condición (ej: un selector de DOM, un estado de store), logueá el valor real evaluado en cada intento, no solo "true/false" — mostrá el dato concreto que se comparó.
- Estos logs pueden quedar en el código final (no los borres antes de archivar) — el usuario los va a usar para reportar bugs con evidencia concreta en vez de descripciones vagas. Si en el futuro se decide sacarlos, será un cambio aparte.

## GESTIÓN DEL ISSUE
- NO cierres el issue manualmente: el cierre ocurre automático al mergear el PR vía "Closes #<N>".
- Podés comentar avances con gh issue comment.
- Podés modificar las relaciones blocked-by/blocking/parent del issue (agregar, quitar o reordenar) cuando reflejen la realidad del trabajo; comentá el cambio con gh issue comment.

## VERIFICACIÓN ANTES DE COMPLETAR (skill verification-before-completion)
No afirmes "está listo" sin haber corrido antes la verificación real — tests, typecheck y lint según el stack — y mostrá el resultado concreto de cada check en el resumen final (qué corriste y qué devolvió, no solo "pasó").

## ENTREGA FINAL
Cuando termines de implementar y los checks pasen, creá el PR con la skill branch-pr: branch type/descripcion, body con "Closes #<N>", un solo label type:*, esperar checks automatizados.
PRs: auto-chain. Presupuesto de review: 800 líneas. PRs encadenados: stacked-to-main — la evaluación de corte con la skill chained-pr es SIEMPRE obligatoria al terminar: medí el PR resultante (no el tamaño que parecía tener el issue al arrancar) y si supera el presupuesto de review de 800 líneas, cortalo en PRs encadenados hacia main. Que la evaluación sea siempre no implica cortar siempre: el corte ocurre solo cuando el PR real lo amerita.
Los labels del ciclo de review (review:pendiente, review:aprobado, review:comentado, review:fix-aplicado, conflicto:main) los aplica la app automáticamente al detectar el PR o los pushes; NO los toques con gh issue edit.

## AL TERMINAR, RESUMÍ
1. Qué se implementó.
2. Qué checks corriste (tests/typecheck/lint) y su resultado.
3. URL del PR.
```
