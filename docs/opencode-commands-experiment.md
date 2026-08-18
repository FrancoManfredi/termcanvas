# Comandos personalizados de opencode: experimento y hallazgos

> Estado: experimento validado (agosto 2026). Base para migrar los prompts
> de orquestador de TermCanvas de una sola línea a templates multilínea.

## Problema original

TermCanvas inyecta los prompts de orquestador (planning, resolve, review,
fix, conflict) en **una sola línea** (separador ` | `) porque se asumía que
`opencode --prompt` rompe con saltos de línea reales en Windows. El costo:
el modelo pierde la jerarquía visual y la adherencia a cada regla individual
baja.

**Hipótesis a validar**: los comandos personalizados de opencode
(`.opencode/commands/*.md`) permiten templates multilínea con jerarquía,
inyección de contexto (`!shell`, `@archivo`) y argumentos (`$ARGUMENTS`).

## Cómo se probó

Comandos de test en `education-games/.opencode/commands/` (`tc-args`,
`tc-file`, `tc-shell`, `tc-agent`, `tc-subtask`, `tc-model`, `tc-json`),
lanzados con `termcanvas/scripts/test-tc-command.ps1` (full-auto: lee el
template, lo expande y abre opencode con `--prompt` + `--auto`).

## Hallazgos verificados con corridas reales

### 1. `--prompt "/comando"` NO expande el comando

La TUI solo expande comandos **tipeados en vivo** (picker `/`). Si el comando
llega por `--prompt`, se envía **literal** al modelo como texto de usuario —
el modelo recibe `/tc-audit` y se pone a adivinar qué es (busca archivos,
lee configs). Verificado: el modelo buscó `**/command/*.md` y `~/.config/opencode`
por su cuenta.

### 2. `opencode run --command <nombre> "args" --auto` SÍ expande, pero es headless

La vía documentada para invocar comandos sin TUI. Expande el template, aplica
el frontmatter (`agent`, `model`, `subtask`) y recibe los args como message.
**No abre la TUI**: corre en la terminal actual y termina solo. Confirmado por
engram: la sesión quedó registrada como `/tc-audit backend/` expandido.

### 3. El mito del multilínea cae: `--prompt` con saltos de línea SÍ funciona

El problema real no era el multilínea: era que el template `.md` conservaba
el **frontmatter** (`--- ... ---`) porque el regex de PowerShell no lo
removía (con el modo por defecto, `$` no matchea después del segundo `---`
cuando sigue más texto). Con el frontmatter adentro, opencode recibía un
`--prompt` arrancando en `---description:...` y explotaba mostrando el help.
Fix: `'(?m)^\s*---\s*$.*?^\s*---\s*$'` con `RegexOptions.Singleline`.

### 4. PowerShell 5.1 rompe el quoting de argumentos nativos

Cuando el template tiene **comillas dobles internas** (ej. el schema JSON
`"mode": "audit"`), PS 5.1 parte el argumento en la línea de comandos y
opencode muestra el help. Fix: escapar `"` → `\"` antes de pasar el prompt.

### 5. El shell output (`!comando`) capturado por `cmd /c` rompe UTF-8

`cmd /c` captura stdout con la codepage OEM (CP850): los acentos de node
salían como `matem├ítica`. Fix: capturar con `System.Diagnostics.Process` +
`StandardOutputEncoding = UTF8` en lugar de `cmd /c ... | Out-String`.

### 6. `ProcessStartInfo` no hereda el cwd del `Push-Location`

El proceso hijo corría en el home del usuario y `node scripts/...` fallaba
con `MODULE_NOT_FOUND`. Fix: setear `WorkingDirectory` explícito al repo.

### 7. El frontmatter solo se respeta en la vía NATIVA (`run --command`)

| Frontmatter | Vía `--prompt` (expandido por script) | Vía `run --command` (nativo) |
|---|---|---|
| `agent: plan` | Descartado (corre con build) | ✅ Aplicado (corrió con `plan`) |
| `subtask: true` | Descartado | ✅ Subagente invocado |
| `model: ...` | Descartado | ✅ Override respetado |

## Resultados por herramienta probada

| Herramienta | Vía de prueba | Resultado |
|---|---|---|
| `$ARGUMENTS` (todos los args) | `--prompt` expandido | ✅ Se reemplaza con los args |
| `$1..$9` (posicionales) | `--prompt` expandido | ✅ Se reemplazan por palabra |
| `@archivo` (file reference) | `--prompt` expandido | ✅ Contenido inyectado en el prompt |
| `!comando` (shell output) | `--prompt` expandido | ✅ Output inyectado (con fix UTF-8) |
| `agent:` en frontmatter | `run --command` nativo | ✅ Aplicado |
| `subtask: true` | `run --command` nativo | ✅ Aplicado |
| `model:` en frontmatter | `run --command` nativo | ✅ Aplicado |
| Comando vía `opencode.jsonc` | `--prompt` expandido | ✅ Template leído de la config JSON |
| Comando vía archivo `.md` | ambas | ✅ |

## Archivos del experimento

- `education-games/.opencode/commands/tc-*.md` — los comandos de prueba
- `education-games/.opencode/opencode.jsonc` — comando `tc-json` vía config
- `education-games/scripts/tc-contexto-activo.js` — resuelve
  `contexto-activo.json` → documento y lo imprime formateado (el contexto
  del repo para inyectar con `!comando`)
- `termcanvas/scripts/test-tc-command.ps1` — lanzador full-auto con dos vías
  automáticas (elige según el frontmatter: opciones especiales → nativa;
  si no → `--prompt` con TUI)

## Implicaciones para la migración de TermCanvas

1. **Los prompts de orquestador pueden ser multilínea**: el mito del
   `--prompt` one-line cae; con los fixes de PS (frontmatter, quoting,
   UTF-8, working dir) un template multilínea llega entero y legible.
2. **Dos arquitecturas posibles**:
   - **A) Comandos nativos** (`.opencode/commands/*.md` en el repo destino):
     jerarquía + `!shell`/`@archivo` resueltos por opencode, pero **sin TUI**
     (vía `run --command`) y los comandos deben existir en el repo del
     proyecto. El frontmatter (agent/subtask/model) funciona acá.
   - **B) Templates expandidos por la app + `--prompt`** (TUI visible, el
     mecanismo que TermCanvas ya usa): la app expande `$ARGUMENTS`,
     `!comando` y `@archivo` antes de enviar; el frontmatter se ignora.
3. **Regla de decisión**: comandos con `agent`/`subtask`/`model` → nativo
   (headless); el resto → `--prompt` con TUI. El script de test ya la
   implementa automáticamente.
4. **El contexto activo del repo se inyecta con `!node scripts/...`**: el
   helper `tc-contexto-activo.js` es el patrón para resolver
   `contexto-activo.json` → documento formateado en el momento de la
   expansión, sin depender de IPC ni del estado de TermCanvas.

## Decisión de implementación (agosto 2026)

### Alcance actual: prompts multilínea con TUI interactiva

Se implementa la migración de los 5 builders de orquestador (planning
roadmap, planning auditoría, resolve, review, fix, conflict) a **templates
markdown multilínea** con jerarquía visual (`#`, `##`, listas numeradas),
manteniendo intacto el contenido de cada regla. El lanzamiento sigue siendo
la vía `--prompt` + `--auto` con **TUI interactiva** (el mecanismo actual de
TermCanvas), expandiendo la app los placeholders (`$ARGUMENTS`, `!shell`,
`@archivo`) y el contexto activo del repo (IPC `interview:activeBriefText`)
antes de enviar.

Los comandos de TermCanvas se instalan en la carpeta **global** de opencode
(`~/.config/opencode/commands/`), versionados por la app y sincronizados en
cada arranque: así funcionan igual en cualquier proyecto y en cualquiera de
las máquinas donde corra TermCanvas. No se referencian archivos del repo
(`@scripts/...` ni `!node scripts/...`) para que un repo vacío o distinto
nunca rompa el comando: el contexto se resuelve desde el estado de la app,
no desde el disco del proyecto.

### Propuesta diferida: flows unattended vía `run --command` (headless)

Los flujos **review, fix y conflict** ya corren hoy con `autoApprove: true`
(unattended): el usuario no interactúa con la terminal mientras el agente
trabaja. Para esos flows se propone, en una fase posterior, lanzar con
`opencode run --command <comando> --auto` (headless, sin TUI) en lugar de
`--prompt` con TUI.

**Por qué** (verificado en el experimento):

- El frontmatter del comando (`agent`, `subtask`, `model`) **solo se respeta
  cuando opencode expande el comando nativamente** (`run --command`); la vía
  `--prompt` lo descarta. Con comandos nativos, cada flow unattended puede
  declarar su propio agente/modelo (ej. reviewer más barato para review,
  modelo rápido para fix) sin tocar la lógica de la app.
- `subtask: true` permite correr el agente como **subagente**: no contamina
  el contexto principal y el resultado vuelve como una sola respuesta — ideal
  para review/fix/conflict donde solo interesa el veredicto final.
- Los flows unattended no necesitan la TUI: el usuario solo ve el resultado
  (verdict del review, PR actualizado). Headless = menos recursos, cero
  interacción accidental, y el runtime puede esperar el exit del proceso sin
  vigilar la terminal.

**Por qué NO ahora**: la vía nativa es headless y aún falta validar en la app
que el cierre de sesión y la trazabilidad (labels, arrows, worktree cleanup)
funcionen igual sin TUI. La migración por fases separa el cambio de FORMATO
del prompt (valor inmediato, bajo riesgo) del cambio de MECANISMO de launch
(riesgo operativo). Los flows interactivos (resolve, planning) quedan en TUI
por diseño: el usuario observa y puede intervenir mientras el agente trabaja.

