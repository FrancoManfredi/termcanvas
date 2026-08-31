// Contenido del SKILL.md para la skill diag-organizacion.

export const diagOrganizacionBody = `
# Diagnóstico de Organización de Archivos y Estructura

Estructura física del repositorio: dónde vive cada cosa, límites entre
módulos y código muerto. knip y depcruise ya marcaron candidatos; tu trabajo
es convertir señales en veredictos sobre LA ESTRUCTURA.

## Qué evaluar

1. **Ubicación**: archivos que viven en la capa equivocada (lógica de
   negocio en componentes de UI, tipos de dominio en electron/, constantes
   duplicadas en dos lados porque "no había lugar obvio").
2. **Límites difusos**: carpetas feature/ que importan internos de otra
   feature (imports que cruzan el borde por archivos no-entrypoint);
   shared/ creciendo con cosas específicas de UNA feature.
3. **Responsabilidades mezcladas**: módulos cuyo nombre promete una cosa
   ("store", "service") pero contienen otra (fetch + estado + render helpers).
4. **Código muerto** (confirmar lo que knip marca): export sin uso real,
   archivos huérfanos desde el entrypoint, tipos que nadie referencia.
   Verificar ANTES de reportar: exports usados solo por tests siguen siendo
   sospechosos; APIs públicas de librería interna no.
5. **Bariles que acoplan**: index.ts que re-exporta TODO el feature —
   permite que externos importen cualquier interno sin notarlo y difumina
   el entrypoint que la regla de dependencias cree que protege.

## Calibración de severidad

- high: código muerto masivo (>5% del repo) o límite roto que permite
  dependencias circulares reales entre features.
- medium: módulo mal ubicado que confunde onboarding verificable
  (imports con ../../../../ escapando su capa).
- low: inconsistencias de convención (mix de singular/plural, baril vs
  imports directos).

## Falsos positivos típicos a DESCARTAR

- Cómo está escrito el código POR DENTRO: patrones y principios son la
  categoría diseño-patrones. Documentación es otra categoría.
- Archivos generados (dist/, build/, codegen) marcados como muertos.
- Scripts operacionales de scripts/ que se invocan desde CI o docs.

## Estándar de evidencia

Evidencia file:line del problema estructural + la propuesta de destino
concreta ("mové X a Y porque Z"). El movimiento propuesto nunca puede romper
un límite existente: si lo rompe, proponé primero el límite.
`.trim();
