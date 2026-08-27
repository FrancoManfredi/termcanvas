// Contenido del SKILL.md para la skill diag-proteccion.

export const diagProteccionBody = `
# Diagnóstico de Protección (Tolerancia a Fallos)

Categoría LLM-only: sin herramientas deterministas, tu exploración dirigida
es la única fuente de evidencia. Buscá estados inseguros ante fallos reales
de red, disco, procesos externos y datos corruptos.

## Qué investigar, módulo por módulo

1. **Errores que tragan excepciones**: catch vacíos o que solo loguean y
   dejan el estado corrupto seguir (un flag en true que nunca se revierte).
2. **I/O externo sin timeout/retry/backoff**: fetch, execFile, conexiones a
   sockets/DB sin timeout explícito — un servicio lento congela el flujo.
   Con retry: verificar backoff Y jitter, sino conviertes fallo en tormenta.
3. **Validación de estados inválidos**: datos parseados de JSON/disco/red
   usados sin validar shape (acceso directo a campos anidados); invariantes
   asumidas sin assert ("esto nunca viene null" sin verificación en el borde).
4. **Puntos únicos de fallo**: una llamada cuya caída tumba todo el flujo
   sin fallback ni degradación elegante; watchers/listeners que si fallan
   dejan la feature muerta en silencio.
5. **Cleanup en caminos de error**: recursos abiertos (streams, timers,
   child processes) que solo se liberan en el happy path.
6. **Idempotencia del retry**: reintentar una operación no idempotente
   (POST que crea, comando que muta) duplica el efecto por cada intento —
   verificar idempotency key o guard antes de reintentar.
7. **Circuit breaker ausente**: dependencia caída que se reintenta en loop
   sin abrir el circuito — cada llamada paga el timeout completo y arrastra
   al flujo entero mientras el servicio no vuelve.
8. **Fallo parcial en batches**: operaciones sobre muchos ítems tratadas
   todo-o-nada cuando un fallo de UNO descarta el trabajo exitoso de los
   demás, sin reporte de cuál falló ni posibilidad de reanudar.
9. **Cancelación no propagada**: timeout/cancelación upstream que no llega
   downstream (sin AbortController) — el usuario canceló pero el trabajo
   sigue consumiendo red/CPU hasta terminar.

## Calibración de severidad

- high: estado persistente puede quedar corrupto, o colgado permanente
  (sin timeout) en un flujo central del producto.
- medium: retry ausente en I/O transitorio esperable, fallback ausente con
  degradación posible obvia.
- low: logging insuficiente para diagnosticar el fallo post-mortem.

## Falsos positivos típicos a DESCARTAR

- Vulnerabilidades de seguridad clásicas: categoría Seguridad.
- Preferencias de estilo sobre cómo escribir el manejo de errores.
- Falta de try/catch donde NO hay I/O ni invariantes cruzando un borde.

## Estándar de evidencia

Cada finding nombra el ESCENARIO de falla concreto ("si Supabase responde
en 30s+, ¿qué le pasa al usuario?"), cita file:line del punto exacto sin
protección, y describe la consecuencia observable. Sin escenario, no hay
finding: especulación no reporta.
`.trim();
