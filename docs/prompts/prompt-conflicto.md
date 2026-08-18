# Prompt: Resolver conflicto de merge

> **Generado desde el código** (render del builder real) — si cambiás el builder, regenerá este doc.
>
> - **Fuente**: `src/canvas/resolveConflictPrompt.ts` — `buildResolveConflictPrompt(input)`
> - **Lanzamiento**: `opencode --prompt <prompt> --auto` — TUI interactiva
> - **Formato**: markdown multilínea con jerarquía visual (headers `#`/`##`, listas, code blocks). El contexto del repositorio (brief activo) y la síntesis de requerimientos activa se inyectan inline, sin que el agente lea archivos.
> - La lista de archivos en conflicto se precarga desde el test-merge de la app; sin ella, el agente la deriva del comentario [mergeador] con gh.
> - El merge DEBE completarse en un commit de merge (nunca `git merge --abort`).

## Prompt



```markdown
# Resolver conflicto de merge — issue #<N> — <título del issue>

El PR #<PR_N> (rama <rama>) no se pudo mergear contra main automáticamente: el mergeador detectó conflictos.

## CONTEXTO DEL REPOSITORIO

Texto relevado con la entrevista de contexto (lo escribió el dueño del proyecto; es la intención, no el código):

<texto del contexto activo del repositorio — resumen del proyecto, misión, problema, usuarios, flujo ideal, visión, valores, stakeholders, alcance, fuera de alcance, restricciones, propuesta de valor, incertidumbres (lo formatea el motor con formatBriefForPrompt)>
## REQUERIMIENTOS RELEVADOS (OBLIGATORIOS: tus decisiones técnicas deben respetarlos)

<síntesis de requerimientos activa — RFs con prioridad, ASRs (obligan decisiones estructurales), restricciones globales y glosario, con la línea de procedencia "Síntesis de requerimientos usada: entrevista-<ts>-sintesis.json (fecha) — selección activa | FALLBACK: más reciente" (lo formatea el motor con formatRequirementsForPrompt)>

Mencioná en tu resumen final la línea exacta "Síntesis de requerimientos usada: <archivo>" que figura arriba (con su fecha).

## ARCHIVOS EN CONFLICTO
La app ya corrió el test-merge contra origin/main y precargó la lista de archivos en conflicto (NO hace falta correr gh pr view ni leer el comentario del Mergeador): <archivo-en-conflicto-1>, <archivo-en-conflicto-2>.

## TRAER MAIN Y MERGEAR
Trabajás en el worktree que ya tiene la rama <rama> (la del PR). Traé main y mergealo:
```bash
git fetch origin main
git merge origin/main
```
El merge va a quedar con conflictos; es esperado.

## RESOLVER CADA ARCHIVO MANUALMENTE
Aplicá la disciplina de la skill resolving-merge-conflicts: avanzá hunk por hunk, guiándote por la intención original de cada lado (qué buscaba el cambio de la rama y qué buscaba main en ese punto) — no descartes un lado completo sin justificación técnica real, y explicá en el comentario final qué quedó de cada lado y por qué.

## COMPLETAR SIEMPRE EL MERGE
nunca uses git merge --abort ni dejes el worktree en estado de conflicto — la resolución DEBE terminar en un commit de merge, aunque un archivo quede íntegro de un lado.

## CHECKS Y COMMIT
1. Corré los checks del repo (tests, typecheck/lint/build según el stack) antes de commitear.
2. Commiteá con el mensaje exacto: `merge: resolve conflicts with main for #<PR_N>`
3. Pusheá a la rama actual: `git push origin <rama>` — el PR #<PR_N> queda actualizado con la resolución.

## COMENTARIO EN EL PR
Dejá un comentario en el PR con `gh pr comment <PR_N>`, prefijo [fix-conflicto-<N>], explicando archivo por archivo qué se conservó de cada lado.

## ESTADO DE LABELS
Los labels del ciclo de review (conflicto:main, review:fix-aplicado) los gestiona la app automáticamente al detectar tu push: no corras gh para etiquetar.

## REGLAS DE ORO
- NUNCA crees una rama o PR nuevo: la resolución va al PR #<PR_N> existente.
- Prefijá tus pasos con [fix-conflicto-<N>].
```
