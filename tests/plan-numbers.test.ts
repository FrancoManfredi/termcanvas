import test from "node:test";
import assert from "node:assert/strict";
import {
  projectIssueNumber,
  projectRefText,
  type PlanProjection,
} from "../src/utils/planNumbers.ts";

const titles = ["Vista calendario", "Sidebar colapsable", "Persistir estado"];

function projection(partial: Partial<PlanProjection>): PlanProjection {
  return {
    nextIssueNumber: null,
    createProgress: [],
    selected: [],
    ...partial,
  };
}

test("sin proyección (repo/gh) todo cae al índice local", () => {
  const p = projection({});
  assert.equal(projectIssueNumber(p, 0), 1);
  assert.equal(projectIssueNumber(p, 2), 3);
  assert.equal(projectRefText(p, 1, (i) => titles[i]), "#2");
});

test("proyecta por POSICIÓN en la cola de creación, no por índice del plan", () => {
  // El repo va por el 48: seleccionar índices 0 y 2 (saltando el 1) crea
  // #49 y #50 SECUENCIALES — GitHub no salta la secuencia por el hueco.
  const p = projection({
    nextIssueNumber: 48,
    selected: [0, 2],
  });
  assert.equal(projectIssueNumber(p, 0), 49);
  assert.equal(projectIssueNumber(p, 2), 50);
  assert.equal(projectIssueNumber(p, 1), 2, "el no seleccionado queda local");
});

test("una vez creado, muestra el número REAL asignado por GitHub", () => {
  const p = projection({
    nextIssueNumber: 48,
    // Cola real de un reintento: el índice 0 ya se creó (#49), el 2 sigue.
    createProgress: [{ index: 0, number: 49 }, { index: 2 }],
  });
  assert.equal(projectIssueNumber(p, 0), 49);
  assert.equal(projectIssueNumber(p, 2), 50);
});

test("la relación a un item no seleccionado no proyecta un número inexistente", () => {
  const p = projection({
    nextIssueNumber: 48,
    selected: [0, 2],
  });
  // El índice 1 no se creará: su hueco no puede ser #50 (que le toca al
  // índice 2) ni un número propio — se referencia por título.
  assert.equal(projectRefText(p, 1, (i) => titles[i]), "«Sidebar colapsable»");
  assert.equal(projectRefText(p, 0, (i) => titles[i]), "#49");
  assert.equal(projectRefText(p, 2, (i) => titles[i]), "#50");
});

test("post-creación las relaciones usan el número real", () => {
  const p = projection({
    nextIssueNumber: 48,
    createProgress: [{ index: 2, number: 51 }],
    selected: [0, 2],
  });
  assert.equal(projectRefText(p, 2, (i) => titles[i]), "#51");
});