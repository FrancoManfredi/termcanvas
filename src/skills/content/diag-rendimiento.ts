// Contenido del SKILL.md para la skill diag-rendimiento.

export const diagRendimientoBody = `
# Diagnóstico de Escalabilidad y Rendimiento

Categoría LLM-only: tu juicio es la única fuente. Buscá trabajo desperdiciado
medible, no micro-optimizaciones sin evidencia.

## Qué investigar

1. **Complejidad algorítmica innecesaria**: búsqueda lineal (find/includes/
   filter en loop) donde un Map/Set resolvería O(1); sort dentro de loop;
   re-cálculo de valores invariantes por iteración.
2. **N+1 y consultas repetidas**: awaits de fetch/queries dentro de for
   que podrían batchearse o paralelizarse; mismo dato pedido 2+ veces en
   un flujo sin cache local.
3. **Fugas de memoria potenciales**: addEventListener/setInterval sin remove
   en cleanup, closures que retienen objetos grandes (arrays completos,
   snapshots) en handlers de larga vida, caches sin límite de tamaño.
4. **Trabajo pesado en camino crítico**: parseo/serialización grande en el
   render path o en cada keystroke; JSON.stringify de objetos enormes en
   logs calientes; trabajo síncrono bloqueante que podría diferirse.
5. **Artefactos inflados**: imports que arrastran librerías enteras por una
   función (moment completo, lodash completo), assets sin compress.
6. **Re-render storms (React)**: componentes suscriptos a contextos cuyo
   value cambia de identidad en cada render (objetos/arrows literales en
   JSX), listas grandes sin memo ni keys estables — el árbol entero
   re-renderiza ante cambios que no le incumben.
7. **Virtualización ausente**: listas/tablas/historiales que montan las N
   filas completas creciendo con datos cuando solo hay N visibles.
8. **Eventos de alta frecuencia sin throttle**: wheel, resize, mousemove y
   chunks de output de terminal procesados crudos — cientos de renders o
   parses por segundo donde hace falta uno por frame.
9. **Bloqueo del main process**: trabajo pesado síncrono en electron main
   (fs masivo, crypto) que congela TODAS las IPC del app, no solo su flujo.

## Calibración de severidad

- high: crecimiento cuadrático/exponencial sobre datos que escalan con uso
  real, o fuga que crece por sesión/hora de uptime.
- medium: N+1 medible (N conocido: issues, archivos, terminales), trabajo
  redundante en flujo frecuente.
- low: ineficiencia en cold-path (setup, migración one-shot).

## Falsos positivos típicos a DESCARTAR

- Micro-optimizaciones sin evidencia medible (cambiar == por Object.is).
- Bugs funcionales, seguridad, estilo: otras categorías los cubren.
- Optimizar código que corre UNA vez aunque sea lento.

## Estándar de evidencia

Cada finding cita file:line y dimensiona la escala ("con 500 issues esto son
500 queries secuenciales × ~80ms"). Si el volumen real del repo hace
irrelevante el costo, no es finding: decilo explícitamente en el análisis.
`.trim();
