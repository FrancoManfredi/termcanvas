// Contenido del SKILL.md para la skill diag-documentacion.

export const diagDocumentacionBody = `
# Diagnóstico de Documentación

Cobertura y calidad de documentación: JSDoc/TSDoc en APIs públicas, READMEs
que dicen la verdad y comentarios que ayudan en vez de estorbar. eslint ya
contó qué falta; tu trabajo es el juicio de CALIDAD.

## Qué evaluar

1. **APIs públicas sin documentar**: exports de módulos entrypoint (index,
   bariles) sin JSDoc que explique QUÉ hace y CUÁNDO usarlo. Priorizar por
   consumo: lo que importan 5+ archivos primero.
2. **READMEs que mienten**: instrucciones de setup que fallan si las
   seguís al pie de la letra, comandos que no existen, arquitectura
   descrita que no coincide con la estructura real de carpetas.
3. **Comentarios ruido**: comentarios que repiten el código ("// setea x"),
   código comentado muerto, TODOs sin issue ni fecha.
4. **Comentarios faltantes donde IMPORTAN**: workarounds sin explicar POR
   QUÉ (el clásico "no tocar esto" sin motivo), constantes mágicas sin
   contexto, hacks de compatibilidad sin versión referenciada.

## Calibración de severidad

- high: README/setup que impide a un nuevo dev arrancar, o docs que
  documentan un comportamiento de seguridad incorrecto.
- medium: API pública central sin documentar; workaround crítico sin explicación.
- low: typos, desactualización cosmética, comentarios verbosos.

## Falsos positivos típicos a DESCARTAR

- Todo bug/seguridad/rendimiento detectado de paso: NO es esta categoría.
- Código interno privado con nombres autoexplicativos: no necesita JSDoc.
- Comentarios en español vs inglés: preferencia del repo, no finding.

## Estándar de evidencia

Para "falta": archivo:línea de la firma sin documentar + por qué es pública.
Para "miente": cita textual de la doc + evidencia file:line del comportamiento
real contradictorio. Para comentarios: el comentario problemático citado.
`.trim();
