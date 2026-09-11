# Contrato mínimo del prompt por agente

> Si querés agregar un agente (o editar el prompt de uno existente), esto es
> lo único que NO puede faltar. Todo lo demás —rol, reglas, ejemplos,
> tono— es libre.

## La regla en una frase

La rúbrica es libre, **el cierre es contrato**: cada agente debe responder
en prosa para humanos y cerrar con UN bloque ` ```json ` con las keys
exactas de su schema. El orquestador extrae el bloque (`extractBalancedJSONObject`
+ `preferKeys`), lo valida con zod y lo guarda en el sidecar. La prosa es lo
que se ve en la sesión; el bloque es lo que lee la máquina.

## Tabla por agente

| Agente | Keys exactas del bloque | Enums / tipos que valida zod | Sidecar | Si falla |
|---|---|---|---|---|
| foreman | `decision`, `reason`, `confidence` | `decision`: `building`\|`needs_triage`\|`needs_input`; `confidence` 0..1 | meta del timeline | 1 repair → fallback `needs_triage` |
| triage | `decision`, `scope`, `complexity`, `openQuestions`, `reason`, `confidence` | `decision`: `building`\|`spec`\|`triage`; `complexity`: `trivial`\|`simple`\|`complex` | `triage.json` | 1 repair → fallback `building` |
| spec | `summary`, `acceptanceCriteria`, `targetFiles`, `trivial`, `openQuestions` | `acceptanceCriteria`: array ≥ 1; `trivial`: boolean | `spec.md` | skip con evento (sigue a Foreman) |
| review | `verdict`, `confidence`, `summary`, `findings` | `verdict`: `accept`\|`revise`\|`ask_human`; cada finding: `id`, `axis` (`requirements`\|`tests`\|`security`), `severity` (`info`\|`minor`\|`major`\|`blocker`), `message` | `review.json` | 1 repair → `ask_human` |
| implement | `{"files": [...]}` (cierre) | paths relativos (convención, no zod) | detección en disco (el orquestador difea el worktree; tu lista es confirmación) | fallback acotado |

## Reglas que rompen el contrato (no hacer)

1. **Contradecir el formato**: "respondé solo texto libre" o "sin JSON" hace
   fallar el parse → repair → fallback. El modelo te obedece a vos antes que
   al builder.
2. **Cambiar nombres de keys** en tus ejemplos: si tu ejemplo muestra
   `"veredicto"` en vez de `"verdict"`, el modelo lo copia y el zod lo
   rechaza. Los ejemplos del prompt deben usar las keys exactas de la tabla.
3. **Pedir `null` explícito en opcionales**: las keys opcionales se OMITEN
   sin valor, nunca `null` (el schema es `.optional()`, y `null` no valida).
4. **Quitar el bloque de cierre** ("ahorrar tokens"): sin bloque no hay
   objeto para la máquina; el repair gasta más que el bloque.

## Frontmatter (`agent.md`): qué es load-bearing

- `description`: requerido por opencode; se muestra en el `@` autocomplete.
- `agentType`: vocabulario cerrado (`FOREMAN|TRIAGE|SPEC|IMPLEMENT|REVIEW|VERIFY`).
- `mode`: `subagent` o `all` (`all` = también en el picker, para uso interactivo directo; el headless no lo lee).
- `model`: default cuando el job no trae uno (`auto-disjoint` solo vale en REVIEW;
  sin forma `provider/model` el espejo opencode lo omite).
- `tools`: `{read,glob,grep}` para solo-lectura; solo `implement` lleva escritura.
  El espejo opencode lo traduce a `permission` con `"*": deny` primero.
- Sin `maxRetries` (doctrina sin-límites: los reintentos los decide el transporte).

## Espejo opencode (source: `factory/agents/<name>/agent.md`)

El `agent.md` es la única fuente de verdad. `pnpm sync:agents` lo traduce a
`.opencode/agents/<name>.md` (dir local gitignored, se regenera siempre) y desde
entonces es un agente opencode real: `@<nombre>`, Task tool e identidad de
sesión en el headless (con fallback a sesión plana). Receta completa para un
agente nuevo: `factory/agents/README.md`.

## A futuro: `outputSchema` en el frontmatter

Hoy el contrato vive en TypeScript (builders + schemas zod + parsers +
writers). Para que un agente nuevo sea 100% enchufable sin tocar código,
falta declarar `outputSchema` en el frontmatter y un orquestador genérico
que valide y escriba el sidecar (track aparte, no implementado).
