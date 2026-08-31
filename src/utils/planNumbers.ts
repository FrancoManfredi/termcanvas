// Planificación: números de GitHub visibles para los items del plan.
//
// Un plan usa índices locales (0-based); GitHub asigna números secuenciales
// al crear. Estos helpers convierten un índice del plan en el número que
// el usuario verá:
//   - Si el item ya se creó: su número REAL (createProgress[].number).
//   - Si está en la cola de creación: el número proyectado según su
//     POSICIÓN en la cola (no el índice del plan): seleccionar los índices
//     0 y 2 de un plan de 3 crea los números consecutivos siguientes — el
//     hueco del índice 1 no salta la secuencia de GitHub.
//   - Si no se creará (fuera de la cola): sin número posible; la proyección
//     cae al índice local y las relaciones lo referencian por título.
// Sin proyección disponible (sin repo/gh), todo cae al índice local para
// preservar el comportamiento histórico.

export interface PlanProjection {
  // Último número de issue/PR que GitHub asignó en el repo (null = sin
  // repo/gh: no hay proyección).
  nextIssueNumber: number | null;
  // Cola de creación en orden: los índices del plan que se van a crear o
  // ya se intentaron (createProgress) o, antes de arrancar, la selección.
  createProgress: Array<{ index: number; number?: number }>;
  // Selección actual del plan (orden en que el usuario marcó).
  selected: number[];
}

function creationOrder(projection: PlanProjection): number[] {
  return projection.createProgress.length > 0
    ? projection.createProgress.map((p) => p.index)
    : projection.selected;
}

// Número visible para un item del plan (real, proyectado o índice local).
export function projectIssueNumber(
  projection: PlanProjection,
  planIndex: number,
): number {
  const created = projection.createProgress.find(
    (p) => p.index === planIndex && p.number !== undefined,
  );
  if (created?.number !== undefined) return created.number;
  if (projection.nextIssueNumber === null) return planIndex + 1;
  const queuePos = creationOrder(projection).indexOf(planIndex);
  if (queuePos === -1) return planIndex + 1;
  return projection.nextIssueNumber + 1 + queuePos;
}

// Referencia a otro item para chips/relaciones: número real si fue creado,
// número proyectado si está en la cola de creación, o el título entre
// comillas cuando no se creará (un número ahí no existiría en el repo).
export function projectRefText(
  projection: PlanProjection,
  planIndex: number,
  titleOf: (planIndex: number) => string | undefined,
): string {
  if (projection.nextIssueNumber === null) return `#${planIndex + 1}`;
  const created = projection.createProgress.find(
    (p) => p.index === planIndex && p.number !== undefined,
  );
  if (created?.number !== undefined) return `#${created.number}`;
  const queuePos = creationOrder(projection).indexOf(planIndex);
  if (queuePos === -1) {
    const title = titleOf(planIndex);
    return title ? `«${title}»` : `#${planIndex + 1}`;
  }
  return `#${projection.nextIssueNumber + 1 + queuePos}`;
}