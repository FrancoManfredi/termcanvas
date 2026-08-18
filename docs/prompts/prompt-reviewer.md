# Prompt: Revisar solución (review del PR)

> **Generado desde el código** (render del builder real) — si cambiás el builder, regenerá este doc.
>
> - **Fuente**: `src/canvas/issueReviewPrompt.ts` — `buildIssueReviewPrompt(input)`
> - **Lanzamiento**: `opencode --prompt <prompt> --auto` — TUI interactiva
> - **Formato**: markdown multilínea con jerarquía visual (headers `#`/`##`, listas, code blocks). El contexto del repositorio (brief activo) y la síntesis de requerimientos activa se inyectan inline, sin que el agente lea archivos.
> - El body del issue NO se inyecta: el agente lo lee con `gh issue view <N> --json title,body` (regla estricta).
> - El veredicto va en la PRIMERA línea del body del POST: `VEREDICTO: APROBADO` o `VEREDICTO: CAMBIOS_PEDIDOS` — es lo que TermCanvas parsea para setear el label.
> - El `reviewContext` y el skeleton JSON son opcionales: se inyectan cuando el snapshot IPC de la app tiene éxito.

## Prompt



```markdown
# Review de la solución — issue #<N> — <título del issue>

## CONTEXTO DEL REPOSITORIO

Texto relevado con la entrevista de contexto (lo escribió el dueño del proyecto; es la intención, no el código):

<texto del contexto activo del repositorio — resumen del proyecto, misión, problema, usuarios, flujo ideal, visión, valores, stakeholders, alcance, fuera de alcance, restricciones, propuesta de valor, incertidumbres (lo formatea el motor con formatBriefForPrompt)>
## REQUERIMIENTOS RELEVADOS (OBLIGATORIOS: tus decisiones técnicas deben respetarlos)

<síntesis de requerimientos activa — RFs con prioridad, ASRs (obligan decisiones estructurales), restricciones globales y glosario, con la línea de procedencia "Síntesis de requerimientos usada: entrevista-<ts>-sintesis.json (fecha) — selección activa | FALLBACK: más reciente" (lo formatea el motor con formatRequirementsForPrompt)>

Mencioná en tu resumen final la línea exacta "Síntesis de requerimientos usada: <archivo>" que figura arriba (con su fecha).

## CONTEXTO
Estás en un worktree aislado con el código de la solución ya commiteado en la rama (podés verlo con git log). Ejecutá `gh pr view <PR_N>` y `gh pr diff <PR_N>` para ver la solución completa en contexto (cambios, archivos, tests). Si falta algo del diff local (ej: la rama no está actualizada con el PR), avisá en tu reporte final en vez de inventar contenido.

## LECTURA OBLIGATORIA DEL ISSUE
ANTES de analizar nada, ejecutá SIEMPRE `gh issue view <N> --json title,body --jq -r '"# " + .title + "\n\n" + .body'` y leé el body COMPLETO del issue — está PROHIBIDO armar la review sin haberlo leído de punta a punta. El título de arriba es solo una guía: el Spec se juzga contra el texto original, incluyendo pasos de reproducción, criterios de aceptación y cualquier sección intermedia. No resumas, no infieras, no saltees secciones.

## QUÉ REVISAR (disciplina de la skill code-review, en dos ejes SEPARADOS)
- EJE STANDARDS — la solución sigue las convenciones del repo y la calidad de código básica (code smells estilo Fowler: sin dead code, sin TODOs sin ticket, sin duplicación evitable); hay tests para la solución, corren y pasan, y cubren el caso principal del issue (no solo el camino feliz); commits conventional, sin Co-Authored-By ni atribuciones AI.
- EJE SPEC — fidelidad EXACTA al issue original: resuelve exactamente lo que pide y nada más, sin features inventadas ni scope creep.
Evaluá ambos ejes por separado en tu análisis; el veredicto y el formato de salida no cambian.

## ACCIÓN — COMPORTAMIENTO COMO COPILOT
Comentá SOLO sobre los archivos que el PR modifica (`gh pr diff <PR_N> --name-only`) y anclá cada hallazgo a la línea exacta del código con start_line/end_line y, si proponés un cambio concreto, un suggested_fix dentro de un bloque de sugerencia de GitHub. El texto del review NO enumera líneas: lo que se ve sobre el código son los comentarios.

## FORMATO DE OUTPUT
Para cada observación identificá el archivo y el número de línea EXACTO en el diff nuevo. Corré gh pr diff <PR_N> JUSTO ANTES de armar el JSON para leer los números de línea reales del lado derecho/nuevo — no reuses un diff leído al principio de la sesión si pasó tiempo o hubo cambios, y no inventes ni aproximes números.
Armá un JSON y subilo con `gh api repos/{owner}/{repo}/pulls/<PR_N>/reviews --method POST --input <archivo>.json` en UNA sola llamada:
```json
{ "commit_id": "<sha>", "event": "COMMENT", "body": "primera línea: VEREDICTO: APROBADO o VEREDICTO: CAMBIOS_PEDIDOS; después el resumen general", "comments": [ { "path": "ruta/relativa/al/archivo.ext", "line": 42, "side": "RIGHT", "body": "observación específica de esa línea (si es opcional, empezá con 'no bloqueante: ')" } ] }
```
Si una observación es sobre una convención general o algo que no corresponde a una línea puntual (ej: falta de tests en general), dejala en el "body" general, no fuerces un anclaje que no corresponde. Si no hay NINGUNA observación de línea, el POST igual se hace con "comments": [] y el body con el veredicto.

## EVENT
Usá SIEMPRE "COMMENT" (no APPROVE ni REQUEST_CHANGES por este endpoint: GitHub bloquea auto-aprobar el PR propio con el token actual; el veredicto se comunica con la línea VEREDICTO: del body, no con el evento del review). Los comentarios inline quedan anclados igual.

## SUGERENCIAS APLICABLES (opcional pero valioso)
Si tu observación incluye una corrección chica y concreta (un rename, un typo, una línea mal escrita), incluí el fix en un bloque de sugerencia de GitHub dentro del "body" de ese comentario puntual para que el autor lo aplique con un clic.

## VALIDACIÓN
Antes de subir el JSON, correlacioná que cada line exista en el diff ACTUAL (no en una versión vieja cacheada): corré `gh pr diff <PR_N>` justo antes de generar los comentarios. Guardá el JSON en un archivo temporal DENTRO del worktree (ej. .review.json) antes de mandarlo — no lo pases inline en el comando de shell — para poder debuggear si `gh api` falla por JSON mal formado.

## VEREDICTO BINARIO OBLIGATORIO
El "body" general del POST a /reviews empieza SIEMPRE con la línea exacta "VEREDICTO: APROBADO" o "VEREDICTO: CAMBIOS_PEDIDOS" (primera línea, sin texto antes), seguida del resumen como siempre. APROBADO = no hay ninguna observación necesaria antes de mergear; las sugerencias de estilo/mejora opcional pueden ir como comentarios de línea pero con "no bloqueante" en el body de ESE comentario puntual, y nunca cambian el veredicto. CAMBIOS_PEDIDOS = hay al menos una observación que considerás necesaria antes de mergear. PROHIBIDO cerrar con frases ambiguas ("listo para mergear si el equipo está de acuerdo") o dejar sugerencias sueltas sin resolver: si sugerís algo, decidís vos si es bloqueante o no. El cuerpo "VEREDICTO: ..." es lo que TermCanvas parsea para setear el label del PR.

## ANTI-DUPLICADO (por commit, no por estado)
Cada ronda de revisión — incluyendo la primera — usa SIEMPRE el endpoint /pulls/<PR_N>/reviews con comentarios anclados a línea. "No duplicar" NO significa usar un comentario plano: significa no mandar dos reviews tuyas evaluando el MISMO código sin cambios entre medio. Antes de decidir el mecanismo: compará el headRefOid actual con el de tu última review — corré gh pr view <PR_N> --json headRefOid --jq .headRefOid para el actual y gh pr view <PR_N> --json reviews --jq ".[.reviews|length-1].commit_id" para el commit que revisaste la última vez. Si son DISTINTOS (hay un fix nuevo entre medio): hacé SIEMPRE una review nueva anclada vía POST /pulls/<PR_N>/reviews, nunca un gh pr comment. Si son IGUALES (no hay commits nuevos desde tu última review): NO hagas nada, no hay nada que re-revisar — no subas comentarios planos ni otra review.

## REGLAS DE EJECUCIÓN
Corré gh DIRECTO, nunca envuelto (nada de rtk ni wrappers que oculten stdout/stderr, ni necesitás confirmarlo en tu razonamiento). Si un comando devuelve output con prefijo [rtk], o no devuelve output, DETENÉTE tras el segundo intento fallido y probá un comando estructuralmente distinto (ej: gh api en vez de gh pr diff). Nunca repitas el mismo comando más de 2 veces esperando un resultado distinto.

## REGLAS DE ORO
- Corré los comandos gh DIRECTO — nunca los envuelvas con rtk ni con wrappers (ocultan stdout y te hacen reintentar a ciegas, duplicando reviews en el PR). Si ves output con prefijo [rtk] o sin output, detenete tras 2 intentos y probá un comando estructuralmente distinto.
- NUNCA crees una rama nueva, NO hagas commits locales, NO pushees, NO crees un PR nuevo y NO mergees el PR existente. Tu único output es la review en el PR ya existente vía POST /pulls/{pr}/reviews.
- Analizás en un worktree aislado y descartable: cualquier cambio local que hagas para probar se pierde al cerrar la sesión.
- Prefijá cada paso relevante que ejecutes con [review-<N>] para poder filtrar tu trazabilidad en la terminal.
## CONTEXTO INYECTADO POR LA APP
no corras gh para obtener estos datos, ya te los doy: <contexto del PR precargado por la app: headRefOid, última review, último batch de comentarios, diff file path>
## USÁ EL ESQUELETO PRE-GENERADO
La app ya dejó <review-template-<PR_N>.json> en el worktree con la estructura correcta (commit_id ya cargado, event: COMMENT, comments con line/side). Completá body y comments del JSON y subilo con gh api repos/{owner}/{repo}/pulls/<PR_N>/reviews --method POST --input <review-template-<PR_N>.json>. NO changes el event ni la estructura.
```
