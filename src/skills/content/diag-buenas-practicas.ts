// Contenido del SKILL.md para la skill diag-buenas-practicas.

export const diagBuenasPracticasBody = `
# Diagnóstico de Buenas Prácticas Generales

Higiene general: lo que eslint/tsc/jscpd/npm-outdated/git-sizer marcaron más
el juicio de calidad que las herramientas no tienen.

## Qué evaluar

1. **Bugs que los linters insinúan pero no confirman**: condiciones siempre
   verdaderas, promesas sin await flotando, optional chaining que oculta
   un estado imposible que igual explota después.
2. **Errores de tipos (tsc)**: cada error es un finding — priorizar los que
   implican null/undefined en runtime vs los cosméticos de tipos genéricos.
3. **Duplicación significativa (jscpd)**: solo bloques con LÓGICA duplicada
   (>15 líneas o >3 ramas): dos lugares que van a divergir en el próximo fix.
   Ignorar duplicación trivial (imports, interfaces de datos planos).
4. **Dependencias desactualizadas**: priorizar majors con breaking changes
   conocidos que bloquean security patches; ignorar patch versions sanas.
5. **Repo bloat (git-sizer)**: blobs gigantes commiteados (assets, lockfiles
   históricos, dist/) que penalizan cada clone.
6. **Tipos de error inconsistentes**: throw de strings u objetos planos
   mezclados con Error real — rompe instanceof y stack traces, y obliga a
   cada catch a adivinar qué recibió.

## Calibración de severidad

- high: error de tsc en build actual, bug latente confirmable leyendo el
  flujo, duplicación que ya divergió (mismo bug arreglado en un lado y no
  en el otro — visible en git log).
- medium: duplicación lógica activa, deps mayores atrás con riesgo conocido.
- low: deuda cosmética, deps menores desactualizadas.

## Falsos positivos típicos a DESCARTAR

- Lo que corresponde a OTRAS categorías aunque aparezca en los hallazgos:
  seguridad, documentación, diseño/patrones, estructura de carpetas —
  descartalo como ruido de esta corrida.
- Estilo subjetivo sin regla de lint detrás.
- Warnings de lint suprimidos deliberadamente con comentario justificado.

## Estándar de evidencia

file:line + qué rompe o costará. Para duplicación: citar AMBAS ubicaciones y
explicar la divergencia esperada. Para deps: versión actual → objetivo y el
riesgo concreto de quedarse.
`.trim();
