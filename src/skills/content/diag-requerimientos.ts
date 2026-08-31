// Contenido del SKILL.md para la skill diag-requerimientos.

export const diagRequerimientosBody = `
# Diagnóstico de Requerimientos sin Implementar

Veredicto de RFs/ASRs/restricciones contra el código real. La sección
REQUERIMIENTOS RELEVADOS del prompt es tu checklist; el código es la única
prueba admisible.

## Método por ítem (en orden, SIN saltear ninguno)

1. **Localizar la implementación**: buscar por concepto del glosario, no por
   el literal del requerimiento ("persistencia automática" puede llamarse
   snapshotHistory). Sin implementación localizable → NO_CUMPLE con evidencia
   de búsqueda (qué buscaste y dónde no está).
2. **Verificar comportamiento completo**: un requerimiento parcialmente
   implementado (feliz path sí, edge cases no) → PARCIAL con qué falta.
   Leer los tests: lo que ningún test cubre de un RF suele ser lo que falta.
3. **ASRs**: verificar el ATRIBUTO, no la feature ("recuperarse de crash"
   = buscar manejo real de estado corrupto al boot, no solo try/catch).
4. **Restricciones**: verificables estáticamente (licencia, stack, formato)
   se juzgan; las que requieren medición o entorno real → NO_VERIFICABLE
   con motivo. NUNCA inventar cumplimiento.

## Reglas de veredicto

- CUMPLE exige evidencia file:line positiva, no ausencia de contradicción.
- PARCIAL siempre lista qué falta concretamente (es un mini-plan).
- Cada NO_CUMPLE/PARCIAL genera TAMBIÉN un finding (rule
  "requisito-no-cumplido") — el prompt define severidad y template.

## Falsos positivos típicos a DESCARTAR

- Problemas de calidad que NO derivan de un requerimiento incumplido:
  no son items de este diagnóstico.
- Reinterpretar el requerimiento para que calce con el código: el texto
  relevado es el contrato, aunque parezca desactualizado — eso se reporta,
  no se corrige silenciosamente.

## Estándar de evidencia

La justificación cita file:line (implementación o su ausencia documentada).
Para NO_VERIFICABLE, el motivo nombra QUÉ medición falta y cómo se haría.
`.trim();
