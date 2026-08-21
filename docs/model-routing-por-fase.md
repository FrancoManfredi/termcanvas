# Routing de modelo por fase

> **Estado (agosto 2026):** implementado en la app (WU1-WU7). Cada fase de IA
> de TermCanvas puede tener su propio proveedor/modelo, con validacion de
> disponibilidad ANTES de gastar llamadas. Configuracion: **Settings → Agent →
> Models per phase**.

## Problema que resuelve

Tres caminos de IA conviven en la app y ninguno era cambiable sin editar codigo:

1. **Motor de entrevista** (brief, requerimientos, sintesis, gap-check, ASR):
   modelos hardcodeados como constantes (`opencode-go/hy3` para turnos,
   `deepseek-v4-flash` para llamadas grandes).
2. **Fases CLI** (Planificador roadmap/audit, Diagnostico LLM): sesiones de
   opencode SIN pin de modelo — usaban el default global del CLI del usuario.
3. **Agente embebido** (chat): config global ya existente, fuera del alcance
   de este routing.

Si el dia de mañana un modelo desaparece del registry de opencode (paso de
gracia incluido), las fases fallaban a mitad de corrida con errores crudos.

## Como funciona

```
Settings UI ──setPhaseModel──> preferencesStore (localStorage)
      |                                   |
      |                     models:set-phase-overrides (IPC)
      v                                   v
PhaseModelsSection              main process (engine gate)
      ^                                   |
      └── models:listAvailable ─── model-catalog.ts (server efimero + cache TTL 5min)
```

- **Contrato**: `shared/phaseModels.ts` define `PhaseId`, `ModelRef`, los
  defaults por fase y `resolveModelForPhase` (override del usuario > default).
  Es la unica fuente de verdad; los tests garantizan que las constantes del
  motor no se desalineen de este contrato.
- **Motor SDK** (`headless-runtime/interview/engine.ts`): `promptStructured`
  resuelve el modelo efectivo internamente (`model ?? phaseModelRef(phaseId)`)
  y corre un gate best-effort contra el catalogo real antes de abrir sesion:
  modelo inexistente, proveedor sin auth o variante no soportada fallan
  temprano con `ModelUnavailableError` (mensaje con alternativas conectadas).
  Si el catalogo mismo no responde, el gate NO bloquea: degrada a "omitido".
- **Fases CLI** (`src/planner/modelPin.ts` + `planningSession.ts` +
  `terminalRuntimeStore.spawnPty`): el ref resuelto viaja como flags
  verificados contra la CLI instalada — `--model provider/model` y
  `--variant <v>` para `opencode run`; la TUI solo acepta `--model`
  (el pin de variante se ignora ahi a proposito).
- **Catalogo** (`electron/model-catalog.ts`): server efimero propio (puerto
  alto aleatorio, misma leccion del engine), endpoint `provider.list()` del
  SDK normalizado defensivamente, cache TTL 5 min, cooldown de 60s tras fallo
  (sin eso, cada llamada gateada reintentaria levantar server).

## Fases y defaults

| PhaseId | Fase | Default |
|---|---|---|
| `brief` | Brief de negocio (sintesis) | `opencode-go/hy3` |
| `requirements` | Entrevista de requerimientos (turnos) | `opencode-go/hy3` |
| `synthesis` | Sintesis de requerimientos (+ migracion de historias) | `opencode-go/deepseek-v4-flash` + variant `max` |
| `gapCheck` | Gap-check final | `opencode-go/deepseek-v4-flash` |
| `asrReview` | Revision ASR | `opencode-go/hy3` |
| `plannerRoadmap` | Planificador roadmap | null = default global del CLI |
| `plannerAudit` | Planificador audit | null = default global del CLI |
| `diagnosisLlm` | Diagnostico Fase B (LLM, TUI) | null = default global del CLI |

Los defaults reproducen EXACTAMENTE la conducta previa al routing: sin
overrides configurados, nada cambia.

## Uso

1. Settings → Agent → Models per phase.
2. Elegir `provider/model` por fase (agrupado por proveedor; los proveedores
   sin auth aparecen deshabilitados con su estado).
3. Validacion inline: cada fase se chequea contra el server real (debounce
   corto); muestra "Available: ..." o el motivo exacto del rechazo.
4. El boton de refresh invalida cache + cooldown y reconsulta el server.

Para autenticar un proveedor faltante: `opencode auth login`.

## Limites conocidos

- La TUI de opencode no acepta `--variant`: si una fase con pin TUI tiene
  variante configurada, la variante no aplica en ese lanzamiento (documentado
  en codigo, no es error silencioso del sistema).
- Re-confirmar el MISMO par provider/model conserva su variante efectiva;
  elegir uno distinto la descarta (los overrides reemplazan el ref completo).
- El agente embebido (chat) mantiene su propia config global BYOK
  (provider presets + API key); no participa de este routing.

## Tests

- `tests/phase-models.test.ts` — contrato compartido y sanitizacion.
- `tests/preferences-store.test.ts` — persistencia de overrides.
- `tests/model-catalog.test.ts` — normalizacion, TTL, cooldown, validacion.
- `tests/interview-model-routing.test.ts` — threading en el engine + gate.
- `tests/planner-model-pin.test.ts` — flags CLI y resolucion por fase.
- `tests/phase-model-options.test.ts` — helpers puros del selector.
