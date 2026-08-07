# Checklist de testing: labels automáticas del ciclo de review

Objetivo: validar que las labels del ciclo de review (`review:pendiente`,
`review:comentado`, `review:fix-aplicado`, `review:aprobado`, `conflicto:main`)
se materializan solas desde el código de TermCanvas, sin que la IA tenga que
aplicarlas con `gh issue edit`.

## Requisitos

- App TermCanvas corriendo (modo dev o build local).
- `gh` autenticado en el repo de pruebas (`gh auth status`).
- Repo de pruebas: `C:\Users\Estudiante UCU\OneDrive\Escritorio\test-orquestador`
  (default del script; se puede pasar otro path como argumento opcional).
- El script de setup NO toca labels: crea issue + branch + PR + review y deja
  que TermCanvas materialice las labels al refrescar.
- Si el script falla a mitad de camino hace rollback solo: cierra el PR/issue
  ya creados y borra la branch remota (nunca deja huérfanos en
  "compare & pull request").

## Setup

```powershell
# Escenario pendiente: PR nuevo sin review
node scripts/setup-review-labels-test.mjs pending

# Escenario fix: review con observaciones + push de fix posterior
node scripts/setup-review-labels-test.mjs fix

# Escenario aprobado: review aprobada
node scripts/setup-review-labels-test.mjs approve
```

El script imprime al final los números de issue/PR y los comandos de
verificación. Anotalos; los vas a usar en cada escenario.

Ya quedaron creados en `test-orquestador` durante el desarrollo (pueden
usarse tal cual o regenerarse con el script):

| Escenario | Issue | PR |
| --- | --- | --- |
| pending | #44 | #45 |
| fix | #46 | #47 |
| approve | #48 | #49 |

> Validado (verificado end-to-end): el script NO crea labels; al cargar el
> issue en TermCanvas, la app materializa la label sola en el PR y la espeja
> al issue. Después hay que refrescar la tarjeta para ver el badge (la label
> ya está en GitHub; la card es el último eslabón en actualizarse).

## Verificación en cada escenario

| Escenario | Esperado en PR e issue |
| --- | --- |
| `pending` | `review:pendiente` |
| `fix` | `review:fix-aplicado` |
| `approve` | `review:aprobado` |

Pasos comunes:

1. En TermCanvas: botón "Traer issues" (o refrescar la tarjeta del issue).
   Los fixtures arrancan SIN labels; la app las materializa en GitHub al
   cargar (PR + espejo al issue). Refrescar de nuevo la tarjeta para ver el
   badge (la card se actualiza después de GitHub).
2. Verificar que la tarjeta muestra el badge/label correcto y que los botones
   quedan habilitados/deshabilitados según el estado (ej.: MERGEAR PR solo
   con `review:aprobado`).
3. Verificar en el repo (reemplazar `<PR>` e `<ISSUE>`; el script imprime el
   número del PR y del issue al final):

```powershell
gh pr view <PR> --repo FrancoManfredi/test-orquestador --json labels --jq '.labels[].name'
gh issue view <ISSUE> --repo FrancoManfredi/test-orquestador --json labels --jq '.labels[].name'
```

Ambos deben mostrar el label esperado, y NINGÚN otro label del ciclo.

4. Mirar el mensaje del agente (opencode/claude): no debe mencionar labels.
   Si los prompts están en modo quick test (QUICK_TEST_*), el texto sale
   corto — es esperado y no afecta esta validación.

## Casos borde (manuales)

### Precedencia: `review:aprobado` NO se pisa con push posterior

1. Escenario `approve` → esperar a que quede `review:aprobado`.
2. Push manual de un commit nuevo a la branch del PR (sin pasar por el fix
   flow de TermCanvas).
3. Refrescar la tarjeta. Esperado: el PR SIGUE en `review:aprobado` (una
   revisión aprobada manda sobre el push posterior; el estado no retrocede).

### Conflicto: `conflicto:main` NO se pisa con `review:fix-aplicado`

1. Crear un PR cuyo merge contra `main` falle (dos branches tocando el mismo
   archivo) y aprobarlo.
2. Correr MERGEAR PR (bulk merge): el mergeador deja el PR sin mergear y le
   pone `conflicto:main`.
3. Resolver el conflicto con RESOLVER CONFLICTO y pushear el fix.
4. Refrescar. Esperado: el PR queda en `review:fix-aplicado`, nunca vuelve a
   `review:aprobado` ni se queda en `conflicto:main` tras resolver.

### Idempotencia

Repetir "Traer issues" varias veces sobre el mismo escenario: las labels no
deben cambiar ni duplicarse (el apply es idempotente: add + remove del resto
del ciclo).

## Qué mirar si algo falla

- Consola del proceso principal (main process): logs `[review] ...` avisan
  fallos de sync de labels (best-effort).
- Consola del renderer: `[review] failed to apply ... label` indica el
  fallo del IPC.
- Si el label no aparece: verificar que el PR exista en el repo correcto
  (el path del worktree enfocado), que el body del PR contenga
  `Closes #<issue>` y que `gh` esté autenticado.

## Limpieza

El script borra el worktree temporal solo; el issue, la branch remota y el
PR quedan para poder inspeccionarlos. Para limpiar (el nombre del repo es el
que imprime el script, formato OWNER/REPO):

```powershell
gh issue close <ISSUE> --repo <OWNER/REPO>
gh pr close <PR> --repo <OWNER/REPO> --delete-branch
gh issue delete <ISSUE> --repo <OWNER/REPO> --yes
```
