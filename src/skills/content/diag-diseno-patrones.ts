// Contenido del SKILL.md para la skill diag-diseno-patrones.

export const diagDisenoPatronesBody = `
# Diagnóstico de Patrones de Diseño y Principios

Juicio de diseño que ninguna herramienta puede hacer sola: los ciclos de
dependencia y módulos huérfanos que marca dependency-cruiser son SEÑALES
para investigar, no findings automáticos.

## Método

1. Para cada señal de depcruise (ciclo, orfan, dependencia prohibida),
   abrir el módulo y preguntar QUÉ decisión de diseño la causó.
2. Evaluar los ejes con evidencia concreta:
   - **SOLID violado**: interfaces gordas que fuerzan implementaciones
     vacías (LSP), módulos que cambian por DOS razones distintas (SRP),
     switch/type-switches que crecen con cada feature (OCP).
   - **Cohesión baja**: archivos "utils/helpers/misc" como cajón de sastre;
     un mismo concepto disperso en 3+ archivos sin dueño claro.
   - **Acoplamiento semántico**: módulo A que depende de detalles internos
     de B (campos privados accedidos, orden de llamadas implícito).
   - **Ley de Demeter rota**: cadenas a.b().c().d que acoplan al llamador
     a la estructura interna de abstracciones ajenas.
   - **Modelo anémico**: tipos que son bolsas de datos sin comportamiento
     mientras la lógica vive en procedimientos externos que los manipulan.
   - **Dios objeto / herencia profunda**: clase con nombre genérico
     (Manager/Handler/Helper) que acumula responsabilidades, o jerarquías
     de 3+ niveles donde composición con interfaces resolvería mejor.
3. Proponer el patrón ausente SOLO cuando el dominio lo pide: un Strategy
   donde hay N>2 ramas paralelas, un Repository donde el acceso a datos
   está regado por la UI.

## Calibración de severidad

- high: ciclo de dependencias entre capas arquitectónicas (UI → domain ← UI)
  o acoplamiento que ya provocó bugs en cadena visibles en git log.
- medium: SRP/DIP violado con costo de mantenimiento real medible.
- low: patrón aplicado de forma subóptima pero localizado.

## Falsos positivos típicos a DESCARTAR

- Estilo de código, naming y preferencias personales.
- Abstracción "faltante" en código de una sola llamada (YAGNI).
- Problemas de rendimiento o seguridad: otras categorías los cubren —
  si los notás, NO los reportes como items de este diagnóstico.

## Estándar de evidencia

El finding describe el PRINCIPIO violado, cita archivo:línea del síntoma Y
del causante, y explica el costo futuro concreto ("agregar un proveedor
nuevo requiere tocar 4 archivos en 3 capas"). Un hallazgo sin costo
explicado es opinión, no finding.
`.trim();
