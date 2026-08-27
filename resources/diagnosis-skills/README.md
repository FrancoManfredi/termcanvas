# Skills por categoría del Diagnóstico

Carpeta de skills "vendor": material que VOS aportás para enriquecer el
Diagnóstico por categorías. Cada subcarpeta corresponde a un `category-id`
válido (`src/types/diagnosisCategories.ts`).

## Cómo agrego una skill

1. Descargá una skill del ecosistema (skills.sh) o escribí la tuya: es una
   carpeta con un `SKILL.md` adentro (frontmatter con `name` y
   `description` + cuerpo markdown).
2. Creá la carpeta de la categoría si no existe (ej. `seguridad/`).
3. Meté tu skill adentro: `resources/diagnosis-skills/seguridad/mi-skill/SKILL.md`.

Eso es todo — cero código, cero instalación global.

## Qué pasa al correr un diagnóstico de esa categoría

- La app descubre tus skills (best-effort: una carpeta rota se omite, nunca
  bloquea la corrida).
- Se copian TAL CUAL dentro del directorio efímero
  `.agents/planning/.scope-<runId>/` junto a la skill interna `diag-<id>`.
- La sesión de opencode ve EXACTAMENTE esas skills (deny-all + allowlist) —
  ni skills globales ni de otras categorías.
- El prompt anuncia tus skills POR NOMBRE con orden explícita de cargarlas
  todas antes de analizar.
- Al terminar la sesión, el scope efímero SE BORRA. Nada queda instalado.

## Reglas

| Regla | Detalle |
|---|---|
| Nombre final | El frontmatter `name` del SKILL.md; si falta, el nombre de la carpeta |
| Formato | Slug `[a-z][a-z0-9-]*` (minúsculas, números, guiones) |
| Prefijo `diag-` | RESERVADO para las skills internas — se rechaza, no se renombra |
| Duplicados | Si dos carpetas resuelven al mismo nombre, gana la primera alfabéticamente |
| Alcance v1 | Un archivo por skill (SKILL.md suelto); skills con scripts/subcarpetas no |
| Descripción faltante | Se usa una genérica automática |

## Ejemplo

```
resources/diagnosis-skills/
  seguridad/
    owasp-checklist/
      SKILL.md          ← descargada de skills.sh, tal cual
  rendimiento/
    accelint-ts-performance/
      SKILL.md
```

Con esto, un diagnóstico de Seguridad permite `diag-seguridad` +
`owasp-checklist`; uno de Rendimiento, `diag-rendimiento` +
`accelint-ts-performance`.
