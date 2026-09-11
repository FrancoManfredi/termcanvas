/**
 * worker-activity — señal de ocupación real para reciclar el server opencode
 * cuando se edita un agent prompt (Agents tiempo-real).
 *
 * Contrato: solo cuenta como "corriendo" un job con worker en vuelo marcado
 * o con lock tomado (implement/review). Un Triage colgado (que por diseño
 * nunca se parkea), un job parqueado sin lock o un terminal NO bloquean el
 * reciclado — bloquear por ellos dejaba el prompt viejo cacheado para
 * siempre. Offline, puro, nunca lanza.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  clearWorkerActive,
  hasActiveWorkers,
  isWorkerActive,
  markWorkerActive,
  resetWorkersForTests,
} from "../headless-runtime/workItem/workerActivity.ts";

test("mark/clear/isWorkerActive: evidencia positiva; junk nunca marca", () => {
  resetWorkersForTests();
  assert.equal(isWorkerActive("job-1"), false);
  markWorkerActive("job-1");
  assert.equal(isWorkerActive("job-1"), true);
  markWorkerActive("job-1");
  assert.equal(isWorkerActive("job-1"), true, "idempotente");
  clearWorkerActive("job-1");
  assert.equal(isWorkerActive("job-1"), false);
  clearWorkerActive("job-1");
  assert.equal(isWorkerActive("job-1"), false, "clear idempotente");
  markWorkerActive("");
  markWorkerActive(null);
  markWorkerActive(42);
  assert.equal(isWorkerActive(""), false);
  assert.equal(isWorkerActive(null), false);
  resetWorkersForTests();
});

test("hasActiveWorkers: worker en vuelo o lock bloquean; colgado/parked/terminal no", () => {
  resetWorkersForTests();
  const jobs = [
    { id: "stuck-triage", status: "Triage" },
    { id: "active-foreman", status: "Foreman" },
    { id: "locked-build", status: "Building" },
    { id: "parked-review", status: "Review" },
    { id: "done", status: "Complete" },
  ];
  const liveNoMarks = {
    isWorker: (id: string) => isWorkerActive(id),
    isLocked: () => false,
  };
  assert.equal(
    hasActiveWorkers(jobs, "self", liveNoMarks),
    false,
    "Triage colgado + Review sin lock + terminal no bloquean",
  );
  markWorkerActive("active-foreman");
  assert.equal(
    hasActiveWorkers(jobs, "self", liveNoMarks),
    true,
    "worker en vuelo bloquea",
  );
  clearWorkerActive("active-foreman");
  assert.equal(
    hasActiveWorkers(jobs, "self", {
      isWorker: () => false,
      isLocked: (id: string) => id === "locked-build",
    }),
    true,
    "lock de Building bloquea",
  );
  resetWorkersForTests();
});

test("hasActiveWorkers: el job actual se excluye y el junk no lanza", () => {
  resetWorkersForTests();
  markWorkerActive("self");
  const live = {
    isWorker: (id: string) => isWorkerActive(id),
    isLocked: () => false,
  };
  assert.equal(
    hasActiveWorkers([{ id: "self", status: "Foreman" }], "self", live),
    false,
    "el worker del job que dispara el chequeo no se cuenta a sí mismo",
  );
  assert.equal(
    hasActiveWorkers([{ id: "otro", status: "Triage" }], "self", live),
    false,
  );
  assert.equal(hasActiveWorkers(null, "self", live), false);
  assert.equal(hasActiveWorkers("junk", "self", live), false);
  assert.equal(hasActiveWorkers([null, 42, "x"], "self", live), false);
  resetWorkersForTests();
});
