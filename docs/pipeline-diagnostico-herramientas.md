# Pipeline de Diagnostico: Herramientas Deterministicas + LLM

> **Estado (agosto 2026):** el pipeline vive DENTRO de la app (ya no es un
> experimento en worktree). El orquestador real es `scripts/run-diagnostico-tools.mjs`
> (modo app: solo escribe `tool-findings-<ts>.json` en `<repo>/.agents/planning/`).
> El flujo completo de la app — Fase A con gate manual, Fase B en TUI con
> prompt-file, cap de hallazgos, cobertura, veredicto de requerimientos,
> retención de artefactos — está en la **Parte 7**. Este doc es el diseño y el
> catálogo de herramientas; la Parte 7 es cómo corre hoy.

## Principio central

Ninguna herramienta de esta lista reemplaza al modelo, y el modelo no reemplaza a ninguna herramienta. Se dividen el trabajo segun lo que cada uno hace mejor:

- **Las herramientas corren PRIMERO**, en paralelo, contra el 100% del repositorio, en segundos. Su cobertura es garantizada por construccion (un linter no se salta un archivo que matchea su config; a diferencia de un LLM, no "pierde interes" a mitad de camino).
- **El modelo recibe SOLO la salida estructurada de las herramientas** (JSON con hallazgos), no codigo fuente crudo. Su trabajo es: interpretar, deduplicar entre herramientas que se superponen, priorizar, cruzar contra los requerimientos/ASR de la entrevista, y explorar puntualmente (dirigido por lo que las herramientas ya marcaron como sospechoso) las areas donde ninguna herramienta puede ayudar: fugas de memoria, condiciones de carrera, juicio de diseno (SOLID, cohesion, acoplamiento semantico), y consistencia de nombres del dominio contra el glosario.

Esto cambia el prompt de Diagnostico de raiz: deja de pedirle al modelo "lee todo el repo y encontra problemas" y pasa a pedirle "aca esta lo que encontraron las herramientas deterministicas sobre el 100% del codigo; interpreta esto con criterio, cruzalo contra los requerimientos, y explora especificamente lo que nadie mas puede ver".

> **Nota sobre el alcance (decision de diseno):** este pipeline se instala **por fases**, no todo junto. Las 20 areas adicionales de la Parte 2 NO se instalan todas de una. Se priorizan pocas herramientas bien calibradas sobre muchas mal afinadas (ver Parte 3 y Parte 4).

---

## Parte 1 — El combo base (Fase 1, siempre presente)

| Area | Herramienta | Instalacion |
|---|---|---|
| Bugs y calidad de codigo | ESLint + typescript-eslint | `npm i -D eslint typescript-eslint` |
| Errores de tipo | `tsc --noEmit` | ya deberia existir en el proyecto |
| Secretos/credenciales expuestas | Gitleaks | binario standalone, sin dependencia npm |
| Codigo muerto / exports sin usar | knip | `npm i -D knip` |
| Duplicacion de codigo | jscpd | `npm i -D jscpd` |
| Patrones de bugs y seguridad ampliados | Semgrep | `pip install semgrep==1.173.0` — **nativo en Windows (wheel win_amd64), verificado en Fase 0** |
| Vulnerabilidades de dependencias (CVEs conocidos) | `npm audit` | ya viene con npm, sin instalacion |
| Arquitectura y estructura de dependencias | dependency-cruiser | `npm i -D dependency-cruiser` — instalado en frontend+backend con config base (`.dependency-cruiser.cjs`: cyclic + no-orphans) |

---

## Parte 2 — Areas adicionales, clasificadas por fase

La columna **Fase** define CUANDO se instala cada herramienta (no todas en paralelo):

- **F1** = Fase 1: se instala junto al combo base. No es condicional, aplica siempre, alto valor / bajo mantenimiento.
- **F2** = Fase 2 (segunda tanda): despues de confirmar que el pipeline base corre estable y sin friccion de Windows.
- **Cond** = Condicional: solo si el repositorio concreto lo requiere (Docker, UI web, CI, ORM, schema formal).
- **Sin instalar** = Ya viene con el stack, es un flag de config, o es complemento opcional.
- **LLM** = No existe herramienta estatica confiable para el caso; es trabajo del modelo.

| # | Area | Herramienta gratuita | Fase | Instalacion / notas |
|---|---|---|---|---|
| 1 | Cobertura de tests unitarios (que % del codigo esta cubierto por tests reales) | c8 o istanbul (via `vitest --coverage` / `jest --coverage`) | Sin instalar | Si el proyecto ya usa vitest/jest, es un flag, no una instalacion nueva |
| 2 | Complejidad ciclomatica y cognitiva (funciones dificiles de entender/testear) | eslint-plugin-sonarjs | **F1** | `npm i -D eslint-plugin-sonarjs` |
| 3 | Tamano de archivo/funcion como proxy de responsabilidad unica | Reglas nativas de ESLint (`max-lines`, `max-lines-per-function`) | **F1** | Solo config, sin paquete nuevo |
| 4 | Dependencias desactualizadas (no vulnerables, solo viejas) | `npm outdated` o npm-check-updates | F2 | `npm outdated` ya viene con npm; npm-check-updates es el paquete de la segunda tanda |
| 5 | Compliance de licencias de dependencias | license-checker | F2 | `npm i -D license-checker` — util si en algun momento se piensa en abrir el codigo o vender el producto |
| 6 | Peso del bundle / performance de carga (relevante para PWAs en dispositivos viejos — como el caso de Education Games) | vite-bundle-visualizer (si usan Vite) o webpack-bundle-analyzer | Cond | Solo si el proyecto es web/PWA |
| 7 | Seguridad de contenedores Docker | Trivy | Cond | Solo si existe un `Dockerfile` en el repo |
| 8 | Seguridad de workflows de CI/CD (GitHub Actions) | zizmor | Cond | Solo si existe `.github/workflows/`. Detecta inyeccion de template, permisos excesivos, triggers peligrosos (`pull_request_target` mal usado) — categoria de ataque real y documentada en 2026 |
| 9 | Riesgo de cadena de suministro (paquetes con comportamiento sospechoso, no solo CVEs conocidos) | Socket.dev (tiene tier gratuito) | Sin instalar | Complementa a `npm audit`: audit busca vulnerabilidades YA reportadas, Socket busca comportamiento anomalo en paquetes nuevos o poco auditados |
| 10 | Cobertura de documentacion (JSDoc/TSDoc en funciones y modulos publicos) | eslint-plugin-jsdoc | F2 | `npm i -D eslint-plugin-jsdoc` |
| 11 | Promesas sin manejar / floating promises | typescript-eslint (`no-floating-promises`) | **F1** | Ya deberia estar disponible si typescript-eslint esta instalado, solo activar la regla |
| 12 | Manejo de errores silencioso (catch vacios, excepciones tragadas) | ESLint (`no-empty`) + revision del LLM | Sin instalar | Hibrido: la regla de ESLint atrapa el caso obvio (catch vacio), pero un catch que solo loguea y sigue sin manejar el error real necesita juicio del modelo |
| 13 | Fugas de memoria | **Esto es trabajo del LLM.** | LLM | Existen herramientas dinamicas (ej. clinic.js) pero requieren CORRER la aplicacion con carga real, no analisis estatico — no encajan en un diagnostico de repositorio que no ejecuta nada. El modelo puede señalar patrones sospechosos (listeners no removidos, closures que retienen referencias grandes) explorando puntualmente, no garantizar deteccion |
| 14 | Condiciones de carrera / concurrencia | **Esto es trabajo del LLM.** | LLM | No existe una herramienta estatica confiable para JS/TS que detecte esto de forma general — requiere entender el flujo async real del codigo |
| 15 | Consistencia de nombres del dominio contra el glosario de la entrevista | **Esto es trabajo del LLM** | LLM | Oportunidad directa: ninguna herramienta sabe que "Lote" y "unidad de producto" deberian ser el mismo concepto — pero el modelo, con el glosario de la sintesis inyectado, si puede detectarlo |
| 16 | Consultas a base de datos ineficientes (N+1, falta de indices) | Depende del ORM | Cond | Algunos ORMs tienen linters propios (ej. eslint-plugin-prisma); sin un ORM especifico, **es trabajo del LLM** |
| 17 | Bloat del repositorio (archivos grandes o binarios commiteados por error) | git-sizer | **F1** | Binario standalone de GitHub, sin instalacion npm |
| 18 | Calidad de los tests existentes (test smells: exceso de mocks, asserts debiles) | eslint-plugin-jest o eslint-plugin-vitest (segun el runner que usen) | F2 | `npm i -D eslint-plugin-vitest` (o el equivalente de jest) |
| 19 | Drift entre el contrato/schema declarado y la implementacion real | Depende del stack | Cond | Si no hay generacion de tipos desde un schema formal (OpenAPI, GraphQL), **es trabajo del LLM** |
| 20 | Accesibilidad (si el proyecto tiene UI web) | axe-core o eslint-plugin-jsx-a11y | Cond | Solo si el proyecto tiene una interfaz web real, no aplica a un backend puro |

**Resumen de lo que se instala en cada fase:**
- **Fase 1 (F1):** sonarjs (#2), reglas nativas de tamano (#3), no-floating-promises (#11), git-sizer (#17) — 4 herramientas, todas no-condicionales, alto valor, bajo mantenimiento.
- **Fase 2 (F2):** npm-check-updates (#4), license-checker (#5), eslint-plugin-jsdoc (#10), plugin de calidad de tests (#18) — 4 herramientas, segunda tanda.
- **Condicionales / Sin instalar / LLM:** no se instalan ahora; quedan documentadas para cuando apliquen.

---

## Parte 3 — Dificultades y riesgos de escalar a 15-20 herramientas

Decidimos NO instalar las 20 de una. Estas son las razones (analisis critico, valido tanto para la instalacion inicial como para el mantenimiento a futuro):

1. **Soporte nativo de Windows (la mas importante para este entorno).** Varias herramientas tienen soporte debil o nulo en Windows nativo. Semgrep en particular tipicamente requiere WSL. No es un detalle menor: en la conversacion ya se vieron fricciones reales de Windows (comandos `yes`/`head` que no existen, diferencias cmd.exe vs PowerShell, problemas de saltos de linea en `--prompt`). Antes de comprometer cualquier herramienta hay que confirmar explicitamente cuales corren nativas y cuales obligan a meter WSL en el medio (una capa entera de complejidad nueva, no un detalle de instalacion).
2. **Almacenamiento y tiempo de instalacion.** Cada paquete npm nuevo (knip, jscpd, dependency-cruiser, sonarjs, license-checker, etc.) infla `node_modules` y el tiempo de `npm install`. No es dramatico con 5-6 paquetes, pero con 15+ empieza a notarse, sobre todo si en algun momento esto corre en CI (minutos de instalacion repetidos en cada corrida).
3. **Sprawl de configuracion.** Cada herramienta trae su propio archivo de config (`.eslintrc`, `.dependency-cruiser.js`, config de jscpd, reglas de semgrep, config de knip...). Con 15+ herramientas son 15+ archivos de config a mantener — y algunos pueden contradecirse entre si sin que te des cuenta (ej. la regla `max-lines` de ESLint y la complejidad cognitiva de sonarjs podrian discrepar sobre que archivo es "demasiado grande").
4. **Deriva de versiones (problema continuo, no de una sola vez).** 15-20 proyectos open source independientes, cada uno con su propio ritmo de releases. Mantenerlos todos actualizados y compatibles entre si (y con la version de Node/TS del proyecto) es mantenimiento recurrente. Cuando una herramienta sube de version, a veces trae reglas nuevas activadas por default que generan una ola repentina de hallazgos nuevos sin tocar una linea de codigo — ruido que no es real, solo la herramienta poniendose mas estricta.
5. **Fatiga de falsos positivos, multiplicada.** Mas herramientas significa mas hallazgos superpuestos y en tension entre si. Aunque el LLM deduplica en la sintesis, cada herramienta individual necesita su propia calibracion (ignorar ciertos patrones especificos del stack) — trabajo de afinado que crece con cada herramienta nueva.
6. **Superficie de cadena de suministro propia.** Instalar mas herramientas de terceros (sobre todo binarios standalone como Gitleaks, Semgrep, Trivy) aumenta la confianza en mas mantenedores externos. Si alguna se instala con un patron tipo `curl | sh` sin verificacion de checksum, se esta introduciendo el mismo tipo de riesgo que estas herramientas estan pensadas para detectar en otros lados. **Regla: fijar versiones exactas, verificar checksums, no auto-actualizar a ciegas.**
7. **Falsa sensacion de cobertura total.** Tener 20 herramientas corriendo no significa estar cubierto al 100% en profundidad — cada una tiene un alcance de deteccion angosto (ESLint solo atrapa lo que su ruleset conoce, Semgrep solo lo que alguien escribio como regla). La cobertura real depende de que tan bien calibrada esta cada herramienta para el stack real, no de la cantidad.
8. **Escala a futuro.** El pipeline que hoy corre rapido sobre 60K lineas puede volverse un cuello de botella en un repo mas grande (algunos escaneos de Semgrep o grafos de dependency-cruiser se vuelven lentos y dificiles de interpretar cuando el proyecto crece) — lo que hoy es "segundos" puede no seguir siendolo siempre.

**Decision de diseno:** empezar por las 8 base + solo 4-5 de las 20 no-condicionales con mayor valor / menor mantenimiento, y dejar el resto como segunda tanda despues de confirmar que el pipeline base anda estable y sin friccion de Windows. Menos herramientas bien calibradas valen mas que muchas mal afinadas.

---

## Parte 4 — Fases de implementacion (avance seguro, en orden)

### Fase 0: Chequeo de compatibilidad con el entorno (Windows) — PRIMER PASO, antes de instalar nada

- **Que:** verificar explicitamente, herramienta por herramienta, cuales corren nativas en Windows y cuales requieren WSL u otra capa.
- **Por que:** es el mayor riesgo de este pipeline en este entorno (ver Parte 3, punto 1). Semgrep era el caso tipico, pero **se resolvio: semgrep >= 1.173.0 publica wheel `win_amd64` en PyPI y corre nativo en Windows** (verificado: `pip install semgrep==1.173.0` + `semgrep --version` + scan real con `p/security-audit`).
- **Como:** probar cada binario standalone con un comando minimo (`--version` / `--help`) en la consola real antes de integrarlo al pipeline. Documentar el resultado en una matriz de compatibilidad (por ejemplo, una tabla en este mismo doc o en el script de setup).
- **Regla:** si una herramienta no corre nativa, se marca como "pendiente de WSL" y NO se instala en la fase actual — no se mete WSL en el medio de forma silenciosa a mitad de camino.
- **Otro chequeo de entorno:** confirmar las herramientas que el repo ya trae (ej. si ya existe ESLint + typescript-eslint en devDependencies, se activa su config en vez de reinstalarla).

### Fase 1: Combo base + 4 herramientas seleccionadas

- Las 8 base de la Parte 1 (Gitleaks, knip, jscpd, Semgrep si paso Fase 0, dependency-cruiser, ESLint + typescript-eslint, `tsc --noEmit`, `npm audit`).
- Mas 4 de la Parte 2 marcadas **F1**: eslint-plugin-sonarjs (#2), reglas nativas de tamano (#3), no-floating-promises (#11), git-sizer (#17).
- Instalar, calibrar cada herramienta contra el stack real, y verificar que el pipeline corre de punta a punta sin intervencion manual y sin friccion de Windows.
- **Estado real (agosto 2026):** Fase 1 COMPLETA. Semgrep instalado nativo vía pip (1.173.0, `p/security-audit`). dependency-cruiser instalado en frontend+backend con config base (`.dependency-cruiser.cjs`: cyclic + no-orphans). knip calibrado (knip.json por paquete con `ignoreExportsUsedInFile`). jscpd calibrado (`--min-tokens 120`, sin lockfiles). ESLint con las 4 reglas F1 activas (sonarjs, max-lines, max-lines-per-function, no-floating-promises).
- Criterio de salida de esta fase: el orquestador produce el JSON agregado correctamente y el prompt de Diagnostico consume ese JSON sin errores.

### Fase 2: Segunda tanda

- Las 4 de la Parte 2 marcadas **F2**: npm-check-updates (#4), license-checker (#5), eslint-plugin-jsdoc (#10), plugin de calidad de tests (#18).
- Solo se inicia DESPUES de que la Fase 1 este estable (el pipeline base corre sin falsos positivos ruidosos ni friccion de entorno).
- Cada herramienta de esta tanda se agrega de a una, con su calibracion, no en bloque.
- **Estado real (agosto 2026): Fase 2 COMPLETA.** #4 se resolvio con el built-in `npm outdated --json` (sin instalar npm-check-updates — solo reporta, no actualiza): 27 dep frontend / 18 backend. #5 license-checker instalado en ambos: copyleft (LGPL sonarjs, MPL axe-core) = warning, UNKNOWN = info. #10 eslint-plugin-jsdoc (flat/recommended-typescript + `require-jsdoc` publicOnly, agregado POR ARCHIVO en el orquestador para no explotar): 69 archivos con funciones publicas sin JSDoc. #18 eslint-plugin-vitest (frontend) + eslint-plugin-jest (backend, flat/recommended).
- **Extras de esta tanda (decisiones del dueño):** ESLint instalado en backend (config espejo sin react/vite: js + typescript-eslint + sonarjs + size + no-floating-promises + jest; pin eslint@^9 para consistencia; bloques src type-aware + genérico con globals node/commonjs/jest) → 260 mensajes en código nunca linteado. zizmor (v1.29.0, binario Windows; sintaxis `zizmor --format json <input>`) → 4 hallazgos reales de CI. eslint-plugin-jsx-a11y (v6.10.2 no tiene flat config: se registran solo sus RULES).
- **Portabilidad del orquestador:** el pipeline DETECTA la estructura del repo (package.json en raíz "root" + subdirectorios directos, dot-dirs excluidos) en vez de asumir frontend/backend; cada tool degrada a "no_evaluada" con motivo si falta su config (eslint/tsconfig/depcruise).
- Cobertura de la corrida completa (education-games): 705 hallazgos estructurados, 0 areas no evaluadas, ~143s. El prompt del LLM capa a 160 + referencia al tool-findings completo.

### Fase 3: Condicionales (solo cuando apliquen)

- Trivy (#7), zizmor (#8), bundle analyzer (#6), axe-core (#20), linters de ORM/schema (#16, #19) — se instalan SOLO cuando el repositorio concreto lo requiere (existe Dockerfile, existe `.github/workflows/`, es web/PWA, etc.), y se documentan como disponibles para cuando apliquen, no se instalan de mas.
- **Estado real (agosto 2026):** en education-games ya se instalaron los que APLICAN: zizmor (#8 — hay `.github/workflows/`, binario Windows v1.29.0, 4 hallazgos reales) y axe-core via eslint-plugin-jsx-a11y (#20 — UI web para chicos). Trivy NO aplica (sin Dockerfile). vite-bundle-visualizer (#6) NO se instalo: requiere `vite build` (genera dist, lento) — queda documentado como disponible, no se mete un build en el diagnostico.

---

## Parte 5 — Como se instala y corre esto (para el agente)

### Paso 1: Chequeo de entorno y deteccion condicional

1. Correr la Fase 0 (matriz de compatibilidad Windows, ver Parte 4) antes de instalar nada.
2. Verificar que herramientas aplican a ESTE repositorio especifico — no instalar Trivy si no hay Dockerfile, no instalar axe-core si no hay UI web, no instalar plugins de un ORM que el proyecto no usa. Chequeo simple: existencia de archivos relevantes (`Dockerfile`, `.github/workflows/`, `package.json` con dependencias de UI web, config de un ORM conocido).

### Paso 2: Instalacion

Las herramientas npm van como devDependencies del proyecto (no globales) para que la version quede fijada y reproducible entre corridas. Las herramientas standalone (Gitleaks, Semgrep, zizmor, git-sizer) NO necesitan instalacion manual: el orquestador las auto-descarga a `scripts/.tools/` con **version exacta pindada y checksum SHA-256 verificado** (`PINNED_BINARIES` en `run-diagnostico-tools.mjs`) antes de extraer — nunca "latest" a ciegas (regla de cadena de suministro de la Parte 3, punto 6). Semgrep va por `pip install semgrep==<version fijada>` (ver Fase 0). Si el checksum no coincide o la descarga falla, esa area queda "no evaluada" sin bloquear el pipeline.

### Paso 3: Ejecucion y agregacion

Un unico script orquestador (`scripts/run-diagnostico-tools.mjs`):
1. Corre cada herramienta aplicable, capturando su salida en el formato mas estructurado que ofrezca cada una (JSON cuando este disponible; la mayoria de estas herramientas lo soportan con un flag).
2. Normaliza todas las salidas a un unico esquema comun, por ejemplo:
   ```json
   {
     "tool": "eslint",
     "file": "ruta/relativa.ts",
     "line": 42,
     "severity": "error" | "warning" | "info",
     "rule": "no-unused-vars",
     "message": "texto del hallazgo"
   }
   ```
3. Escribe un unico archivo de resultados agregados (`<repo>/.agents/planning/tool-findings-<timestamp>.json`) que es lo que despues se le inyecta al modelo — nunca el output crudo de cada herramienta por separado (los crudos van a `<out>/raw/`, solo para debug).
4. El resumen legible se imprime por stdout (es el log que muestra la app en vivo); no escribe archivos extra (resumen/prompt en `salidas/` se eliminaron al migrar a la app).

### Paso 4: Manejo de errores por herramienta

Si una herramienta falla o no esta disponible (ej. Semgrep no se pudo instalar en el entorno), el pipeline debe continuar con las demas y marcar esa area como "no evaluada" en el resultado agregado — no abortar el diagnostico completo por el fallo de una sola herramienta.

---

## Parte 6 — Como cambia el prompt de Diagnostico con esto

El prompt deja de pedir "analiza el codigo del repositorio actual" en el sentido de lectura libre. Pasa a:

```markdown
## HALLAZGOS DE HERRAMIENTAS DETERMINISTICAS

Las siguientes herramientas ya escanearon el 100% del repositorio (cobertura garantizada, no estimada). NO releas los archivos que estas herramientas ya cubrieron salvo que necesites mas contexto para interpretar un hallazgo puntual.

<contenido de tool-findings-<timestamp>.json, formateado legible, no JSON crudo>

## TU TRABAJO

1. Interpretar y priorizar los hallazgos de arriba: cuales son ruido (falsos positivos, o triviales) y cuales son reales.
2. Deduplicar: si ESLint y Semgrep marcan el mismo problema en el mismo archivo, es UN issue, no dos.
3. Cruzar contra los REQUERIMIENTOS Y ASR (seccion de arriba): si un hallazgo esta en un dominio gobernado por un ASR, elevalo en prioridad.
4. EXPLORACION DIRIGIDA (aca si leete el codigo real, pero con foco): los archivos que las herramientas marcaron con mayor duplicacion, ciclos de dependencia, o complejidad son candidatos prioritarios para juicio de diseno (SOLID, cohesion) que ninguna herramienta puede evaluar.
5. Buscá especificamente lo que NINGUNA herramienta cubre: fugas de memoria, condiciones de carrera, consistencia de nombres contra el glosario de la sintesis, calidad semantica del manejo de errores (no solo catch vacios, sino catches que ocultan el problema real).
```

---

## Parte 7 — Como corre el Diagnostico en la app (agosto 2026)

El flujo real (codigo en `src/planner/toolsSession.ts`, `src/planner/planningSession.ts`, `src/stores/diagnosisStore.ts`, UI en `src/components/CoreArchitectureModal.tsx`):

### Fase A — Herramientas deterministas (headless)

- `diagnosisStore.start()` lanza el orquestador (`node scripts/run-diagnostico-tools.mjs --repo <path> --out <repo>/.agents/planning`) como proceso headless con el mismo runtime de terminal de la app (log visible en vivo: `[herramientas] <tool> — corriendo… / ok (N hallazgo(s))`).
- Señales de la sesion: `onReady` (aparecio el `tool-findings-<ts>.json` — la app lee el JSON, formatea los hallazgos para el prompt y calcula la cobertura) y `onExited` (exit 0 + archivo = **gate manual**: el boton "Continuar al diagnostico LLM →" se habilita).
- La cobertura se calcula en la app (`computeToolCoverage`): % de archivos fuente escaneados por paquete, herramientas ok/total, areas "no evaluadas".
- **Retencion N=5**: al iniciar cada corrida, `prunePlanningArtifacts` borra los `tool-findings-*.json` y `prompt-*.md` que exceden los 5 mas recientes por tipo (la carpeta no acumula). Los `diagnostico-*.json` no se tocan (son el historial, borrables con la basurita del modal).
- **"LLM directo"**: el boton "→ LLM directo" de la tarjeta saltea la Fase A y lanza la Fase B con el tool-findings mas reciente (para iterar sin re-correr las herramientas).

### Fase B — LLM (TUI interactiva)

- `continueToLlm()` / `startLlmDirect()` lanzan `launchPlanningSession({ headless: false })`: opencode TUI con `--prompt`, el usuario ve la sesion y puede intervenir (errores de cuota, corridas que se cortan).
- **Prompt grande (>12K chars)**: se escribe a `<repo>/.agents/planning/prompt-<ts>.md` y la TUI recibe una INSTRUCCION CORTA que le ordena al agente leer ese archivo con su herramienta de lectura y ejecutar TODO su contenido. **NO se usa `@ruta`**: la expansion de `@archivo` pertenece al sistema de COMMANDS de opencode (typing `/nombre` en vivo o `run --command` headless); el texto que llega por `--prompt` es literal (bug real verificado: el modelo recibio `@C:/...` sin expandir). El prompt completo supera el limite de argv de Windows (~32K; el real pesa ~38K).
- El prompt incluye: contexto del repo, sintesis de requerimientos, seccion HALLAZGOS DE HERRAMIENTAS (cap 25 por herramienta / 160 total + referencia al tool-findings completo), reglas, contrato JSON y la seccion VEREDICTO DE REQUERIMIENTOS (CUMPLE/NO_CUMPLE/PARCIAL/NO_VERIFICABLE con justificacion; NO_CUMPLE/PARCIAL emiten findings rule `requisito-no-cumplido`).
- El poller resuelve cuando aparece `diagnostico-<ts>.json` parseable (30 min de timeout); si la TUI se cierra sin escribir (exit 0 sin archivo), reintenta UNA vez con `-s <sessionId>` resumida.
- El resultado entra al historial con su `toolCoverage`; el detalle muestra los badges de cumplimiento de requerimientos y el prompt exacto enviado ("Ver prompt enviado").

### Fases del orquestador en este repo

| Fase | Estado |
|---|---|
| Fase 0 (compatibilidad Windows) | ✅ completa — semgrep nativo via pip (1.173.0, wheel win_amd64) |
| Fase 1 (8 base + 4 F1) | ✅ completa — eslint+sonarjs+size+no-floating-promises, tsc, gitleaks, knip, jscpd, semgrep, npm-audit, depcruise, git-sizer |
| Fase 2 (segunda tanda) | ✅ completa — npm-outdated (built-in), license-checker, eslint-plugin-jsdoc (agregado por archivo), eslint-plugin-vitest/jest; extras: ESLint en backend, zizmor, eslint-plugin-jsx-a11y |
| Fase 3 (condicionales) | zizmor ✅ (hay `.github/workflows/`), jsx-a11y ✅ (UI web). Trivy y bundle-visualizer no aplican (sin Dockerfile / requiere build) |
| Binarios standalone | pindados con version exacta + SHA-256 verificado (gitleaks v8.30.1, git-sizer v1.5.0, zizmor v1.29.0) |
| Corrida de referencia (education-games) | 20/20 herramientas ok, 491 hallazgos, 0 areas no evaluadas, ~2-3 min |

---

## Criterios de aceptacion

1. **Fase 0 completada:** hay una matriz de compatibilidad Windows documentada (que herramienta corre nativa y cual requiere WSL) ANTES de instalar cualquier herramienta.
2. La Fase 1 corre las 8 herramientas base + las 4 seleccionadas (sonarjs, tamano nativo, no-floating-promises, git-sizer), sin intervencion manual.
3. Las herramientas de Fase 2 (license-checker, jsdoc, npm-check-updates, plugin de calidad de tests) NO estan instaladas hasta que la Fase 1 este estable.
4. El resultado agregado es un unico JSON estructurado, no la concatenacion de outputs crudos de cada herramienta.
5. El prompt de Diagnostico ya no le pide al modelo "leer todo el codigo" — le pasa los hallazgos ya estructurados y limita la exploracion libre a lo que las herramientas no pueden cubrir.
6. Si una herramienta no aplica al repositorio (ej. no hay Dockerfile) o no corre nativa en Windows, el pipeline la omite sin error y sin bloquear el resto, marcando esa area como "no evaluada".
7. El costo en tokens de una corrida de Diagnostico baja de forma medible respecto al enfoque de "leer todo el repo" (comparar tokens de entrada de una corrida antes/despues). **Estado: pendiente de medicion** — es la unica validacion del pipeline que no se hizo formalmente (los 491 hallazgos estructurados + prompt de 38K reemplazan la lectura libre del repo).

## Fuera de alcance de esta tarea

- No instalar TODAS las 20 areas de la Parte 2 de una sola vez — la Parte 2 queda como catalogo con su fase asignada (F1/F2/Cond/Sin instalar/LLM), y solo se instala lo que su fase indica.
- No implementar todavia el rediseño por lotes (scheduler determinista) que se discutio como alternativa mas robusta al manifiesto de cobertura — esta tarea reemplaza esa necesidad para casi todas las areas, dado que las herramientas ya garantizan cobertura real; si despues de esto todavia sienten falta de cobertura en las areas que quedan como "trabajo del LLM" (fugas de memoria, concurrencia, diseño), ahi si vale la pena retomar esa idea.
- No instalar herramientas condicionales que no apliquen al repositorio actual (Trivy sin Docker, axe-core sin UI web, etc.) — documentarlas como disponibles para cuando aplique, no instalarlas de mas.
- No introducir WSL en el pipeline hasta que Fase 0 confirme que una herramienta especifica lo requiere; en ese caso se decide explicitamente y se documenta, no se asume.
