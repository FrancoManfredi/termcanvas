import test from "node:test";
import assert from "node:assert/strict";
import { useIssuePlannerStore } from "../src/stores/issuePlannerStore.ts";
import { useProjectStore } from "../src/stores/projectStore.ts";
import { parsePlanningPlan } from "../src/planner/parsePlanResult.ts";

const PROJECT_JSON = JSON.stringify({
  mode: "roadmap",
  repo: "acme/termcanvas",
  proposals: [
    {
      title: "Vista calendario",
      body: "Listar issues por milestone",
      labels: ["feature"],
      status: "Todo",
      priority: "P1",
      size: "L",
      blockedBy: [],
      blocking: [],
    },
    {
      title: "Sidebar colapsable",
      body: "Recordar estado",
      labels: ["improvement"],
      status: "Todo",
      priority: "P2",
      size: "S",
      blockedBy: [],
      blocking: [],
    },
  ],
});

function resetStore() {
  useIssuePlannerStore.setState({
    mode: "roadmap",
    roadmapText: "",
    phase: "idle",
    result: null,
    selected: [],
    confirmDiscard: false,
    createProgress: [],
    nextIssueNumber: null,
    startedAt: null,
    detailIndex: null,
  });
}

// Fake mínimo de window.termcanvas.fs en memoria: registra las llamadas y
// deja leer lo que se escribió. El entorno de tests no tiene window, así
// que la persistencia real queda fuera de servicio salvo en estos tests.
function installFakeFs() {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const fakeWindow = {
    termcanvas: {
      fs: {
        readFile: async (path: string) =>
          files.has(path)
            ? { type: "text", content: files.get(path)! }
            : { error: "not found" },
        writeFile: async (path: string, content: string) => {
          files.set(path, content);
          calls.push(`write:${path}`);
          return { changed: true };
        },
        mkdir: async () => {
          calls.push("mkdir");
        },
        delete: async (path: string) => {
          files.delete(path);
          calls.push(`delete:${path}`);
        },
      },
    },
  };
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = fakeWindow as unknown as Window;
  return {
    files,
    calls,
    restore: () => {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = previousWindow;
      }
    },
  };
}

function installFakeProject() {
  const previous = useProjectStore.getState();
  useProjectStore.setState({
    projects: [
      {
        id: "p1",
        name: "proyecto",
        path: "C:/repo",
        worktrees: [
          {
            id: "w1",
            name: "main",
            path: "C:/repo/worktrees/main",
            isPrimary: true,
            terminals: [],
          },
        ],
      },
    ],
    focusedProjectId: "p1",
    focusedWorktreeId: "w1",
  });
  return () => useProjectStore.setState(previous);
}

test("startSession ignora el roadmap vacío y corre con texto", () => {
  resetStore();
  useIssuePlannerStore.getState().startSession();
  assert.equal(useIssuePlannerStore.getState().phase, "idle");

  useIssuePlannerStore.getState().setRoadmapText("  Q4: arreglar perf  ");
  useIssuePlannerStore.getState().startSession();
  assert.equal(useIssuePlannerStore.getState().phase, "running");
});

test("finishSession entrega el plan del modo activo", () => {
  resetStore();
  useIssuePlannerStore.getState().setMode("audit");
  useIssuePlannerStore.getState().setMode("audit"); // sin resultados, no confirma
  useIssuePlannerStore.getState().startSession();
  useIssuePlannerStore.getState().finishSession();

  const state = useIssuePlannerStore.getState();
  assert.equal(state.phase, "results");
  assert.equal(state.result?.mode, "audit");
});

test("finishSession(result) usa el plan real parseado del JSON", () => {
  resetStore();
  useIssuePlannerStore.getState().setRoadmapText("roadmap");
  useIssuePlannerStore.getState().startSession();
  // Simula lo que hace el watcher de planningSession.ts cuando opencode
  // termina de escribir el archivo: parse + finishSession(parsed).
  const parsed = parsePlanningPlan(PROJECT_JSON);
  assert.ok(parsed, "el JSON de ejemplo debe parsear");
  useIssuePlannerStore.getState().finishSession(parsed.result);

  const state = useIssuePlannerStore.getState();
  assert.equal(state.phase, "results");
  assert.equal(state.result?.mode, "roadmap");
  assert.equal(state.startedAt, null, "la corrida termina y limpia el timestamp");
  const proposals = state.result?.mode === "roadmap" ? state.result.proposals : [];
  assert.equal(proposals.length, 2);
  assert.equal(proposals[0].title, "Vista calendario");
});

test("cambiar de modo con resultados pide confirmación y no muta", () => {
  resetStore();
  useIssuePlannerStore.getState().setRoadmapText("roadmap");
  useIssuePlannerStore.getState().startSession();
  useIssuePlannerStore.getState().finishSession();

  useIssuePlannerStore.getState().setMode("audit");
  const state = useIssuePlannerStore.getState();
  assert.equal(state.confirmDiscard, true, "debe guardar los resultados");
  assert.equal(state.mode, "roadmap", "el modo no cambia hasta confirmar");

  useIssuePlannerStore.getState().confirmDiscardChoice(true);
  useIssuePlannerStore.getState().setMode("audit");
  assert.equal(useIssuePlannerStore.getState().mode, "audit");
  assert.equal(useIssuePlannerStore.getState().phase, "idle");
});

test("toggle/hits: la selección configura la creación", () => {
  resetStore();
  useIssuePlannerStore.getState().setRoadmapText("x");
  useIssuePlannerStore.getState().startSession();
  useIssuePlannerStore.getState().finishSession();

  useIssuePlannerStore.getState().toggleSelect(0);
  useIssuePlannerStore.getState().toggleSelect(2);
  assert.deepEqual(useIssuePlannerStore.getState().selected, [0, 2]);

  useIssuePlannerStore.getState().toggleSelect(0);
  assert.deepEqual(useIssuePlannerStore.getState().selected, [2]);

  useIssuePlannerStore.getState().startCreate();
  const state = useIssuePlannerStore.getState();
  assert.equal(state.phase, "creating");
  assert.equal(state.createProgress.length, 1);
  assert.equal(state.createProgress[0].index, 2);
});

test("startCreate sin selección no arranca", () => {
  resetStore();
  useIssuePlannerStore.getState().setRoadmapText("x");
  useIssuePlannerStore.getState().startSession();
  useIssuePlannerStore.getState().finishSession();

  useIssuePlannerStore.getState().startCreate();
  assert.equal(useIssuePlannerStore.getState().phase, "results");
});

test("markCreate/markCreated/finishCreateAll cierran el ciclo", () => {
  resetStore();
  useIssuePlannerStore.getState().setRoadmapText("x");
  useIssuePlannerStore.getState().startSession();
  useIssuePlannerStore.getState().finishSession();
  useIssuePlannerStore.getState().toggleSelect(1);
  useIssuePlannerStore.getState().startCreate();

  useIssuePlannerStore.getState().markCreating(0);
  assert.equal(useIssuePlannerStore.getState().createProgress[0].state, "creating");

  useIssuePlannerStore.getState().markCreated(0, "https://github.com/a/b/issues/9");
  assert.equal(useIssuePlannerStore.getState().createProgress[0].state, "done");
  assert.equal(
    useIssuePlannerStore.getState().createProgress[0].url,
    "https://github.com/a/b/issues/9",
  );

  useIssuePlannerStore.getState().finishCreateAll();
  assert.equal(useIssuePlannerStore.getState().phase, "summary");
});

test("confirmDiscardChoice(false) conserva los resultados mostrados", () => {
  resetStore();
  useIssuePlannerStore.getState().askDiscard();
  useIssuePlannerStore.getState().confirmDiscardChoice(false);
  const state = useIssuePlannerStore.getState();
  assert.equal(state.confirmDiscard, false);
  assert.equal(state.phase, "idle");
});

test("roadmapFiles: se agregan, se eliminan y habilitan la sesión", () => {
  resetStore();
  const store = useIssuePlannerStore;

  const fileA = { name: "roadmap-q4.md", content: "# Roadmap Q4" };
  const fileB = { name: "context.md", content: "contexto adicional" };

  store.getState().addRoadmapFile(fileA);
  store.getState().addRoadmapFile(fileB);
  assert.equal(store.getState().roadmapFiles.length, 2);
  assert.deepEqual(store.getState().roadmapFiles[0], fileA);

  store.getState().removeRoadmapFile(0);
  assert.equal(store.getState().roadmapFiles.length, 1);
  assert.deepEqual(store.getState().roadmapFiles[0], fileB);

  // Sin texto pero con archivos, la sesión debe arrancar.
  store.getState().startSession();
  assert.equal(store.getState().phase, "running");
});

test("openDetail/closeDetail navega al detalle y resetAll la cierra", () => {
  resetStore();
  useIssuePlannerStore.getState().setRoadmapText("x");
  useIssuePlannerStore.getState().startSession();
  useIssuePlannerStore.getState().finishSession();

  useIssuePlannerStore.getState().openDetail(2);
  assert.equal(useIssuePlannerStore.getState().detailIndex, 2);

  useIssuePlannerStore.getState().closeDetail();
  assert.equal(useIssuePlannerStore.getState().detailIndex, null);

  useIssuePlannerStore.getState().openDetail(1);
  useIssuePlannerStore.getState().resetAll();
  assert.equal(useIssuePlannerStore.getState().detailIndex, null);
  assert.equal(useIssuePlannerStore.getState().phase, "idle");
});

test("startSession registra startedAt y finishSession lo limpia", () => {
  resetStore();
  useIssuePlannerStore.getState().setRoadmapText("x");
  useIssuePlannerStore.getState().startSession();
  assert.equal(typeof useIssuePlannerStore.getState().startedAt, "number");

  useIssuePlannerStore.getState().finishSession();
  assert.equal(useIssuePlannerStore.getState().startedAt, null);
});

test("confirmDiscardChoice(true) limpia el detalle abierto", () => {
  resetStore();
  useIssuePlannerStore.getState().askDiscard();
  useIssuePlannerStore.getState().openDetail(0);
  useIssuePlannerStore.getState().confirmDiscardChoice(true);
  const state = useIssuePlannerStore.getState();
  assert.equal(state.confirmDiscard, false);
  assert.equal(state.detailIndex, null);
  assert.equal(state.phase, "idle");
});

test("resetAll también limpia los archivos subidos", () => {
  resetStore();
  const store = useIssuePlannerStore;
  store.getState().addRoadmapFile({ name: "a.md", content: "x" });
  store.getState().setRoadmapText("texto");
  store.getState().startSession();
  store.getState().finishSession();
  store.getState().toggleSelect(0);
  store.getState().startCreate();
  store.getState().resetAll();

  const state = store.getState();
  assert.equal(state.phase, "idle");
  assert.equal(state.roadmapText, "");
  assert.equal(state.roadmapFiles.length, 0);
  assert.equal(state.result, null);
  assert.equal(state.selected.length, 0);
  assert.equal(state.createProgress.length, 0);
});

test("finishSession persiste el resultado real en el repo activo", async () => {
  resetStore();
  const fake = installFakeFs();
  const restoreProject = installFakeProject();
  try {
    const parsed = parsePlanningPlan(PROJECT_JSON);
    assert.ok(parsed);
    useIssuePlannerStore.getState().finishSession(parsed.result);
    // La persistencia es fire-and-forget: esperar un tick del event loop.
    await new Promise((resolve) => setImmediate(resolve));
    const write = fake.calls.find((call) => call.startsWith("write:"));
    assert.ok(write, "debe escribir el archivo de resultados");
    assert.ok(write!.includes("planner-results.json"));
    const saved = JSON.parse(fake.files.get(write!.slice("write:".length))!);
    assert.equal(saved.version, 1);
    assert.equal(saved.result.mode, "roadmap");
    assert.equal(saved.result.proposals.length, 2);
  } finally {
    fake.restore();
    restoreProject();
  }
});

test("finishSession sin resultado (mock de tests) no persiste nada", async () => {
  resetStore();
  const fake = installFakeFs();
  const restoreProject = installFakeProject();
  try {
    useIssuePlannerStore.getState().finishSession();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      fake.calls.some((call) => call.startsWith("write:")),
      false,
      "el mock no debe tocar el disco",
    );
  } finally {
    fake.restore();
    restoreProject();
  }
});

test("restoreSavedResults recupera el último resultado guardado del repo", async () => {
  resetStore();
  const fake = installFakeFs();
  const restoreProject = installFakeProject();
  try {
    const parsed = parsePlanningPlan(PROJECT_JSON);
    assert.ok(parsed);
    useIssuePlannerStore.getState().finishSession(parsed.result);
    await new Promise((resolve) => setImmediate(resolve));
    // Simula el cierre de la app: el store se resetea, el archivo queda.
    resetStore();
    assert.equal(useIssuePlannerStore.getState().phase, "idle");

    await useIssuePlannerStore.getState().restoreSavedResults();
    const state = useIssuePlannerStore.getState();
    assert.equal(state.phase, "results");
    assert.equal(state.result?.mode, "roadmap");
    assert.equal(state.result?.mode === "roadmap" ? state.result.proposals.length : 0, 2);
  } finally {
    fake.restore();
    restoreProject();
  }
});

test("restoreSavedResults no pisa una corrida en curso ni resultados en memoria", async () => {
  resetStore();
  const fake = installFakeFs();
  const restoreProject = installFakeProject();
  try {
    const parsed = parsePlanningPlan(PROJECT_JSON);
    assert.ok(parsed);
    useIssuePlannerStore.getState().finishSession(parsed.result);
    await new Promise((resolve) => setImmediate(resolve));

    // Resultado en memoria: no debe restaurar por encima.
    await useIssuePlannerStore.getState().restoreSavedResults();
    assert.equal(useIssuePlannerStore.getState().phase, "results");
    assert.equal(useIssuePlannerStore.getState().startedAt, null);

    // Corrida en curso: tampoco. (Estado seteado a mano: startSession
    // lanzaría la sesión real de opencode contra el fake de window.)
    resetStore();
    useIssuePlannerStore.setState({ phase: "running", startedAt: Date.now() });
    await useIssuePlannerStore.getState().restoreSavedResults();
    assert.equal(useIssuePlannerStore.getState().phase, "running");
    assert.equal(useIssuePlannerStore.getState().result, null);
  } finally {
    fake.restore();
    restoreProject();
  }
});

test("resetAll y confirmDiscardChoice(true) borran el resultado persistido", async () => {
  resetStore();
  const fake = installFakeFs();
  const restoreProject = installFakeProject();
  try {
    const parsed = parsePlanningPlan(PROJECT_JSON);
    assert.ok(parsed);
    useIssuePlannerStore.getState().finishSession(parsed.result);
    await new Promise((resolve) => setImmediate(resolve));

    useIssuePlannerStore.getState().resetAll();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      fake.calls.some((call) => call.startsWith("delete:") && call.includes("planner-results.json")),
      "resetAll debe borrar el archivo persistido",
    );

    // Nueva sesión + descarte explícito: también borra.
    fake.calls.length = 0;
    useIssuePlannerStore.getState().finishSession(parsed.result);
    await new Promise((resolve) => setImmediate(resolve));
    useIssuePlannerStore.getState().askDiscard();
    useIssuePlannerStore.getState().confirmDiscardChoice(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      fake.calls.some((call) => call.startsWith("delete:") && call.includes("planner-results.json")),
      "confirmDiscardChoice(true) debe borrar el archivo persistido",
    );
  } finally {
    fake.restore();
    restoreProject();
  }
});

test("restoreSavedResults ignora un archivo corrupto o de otro contrato", async () => {
  resetStore();
  const fake = installFakeFs();
  const restoreProject = installFakeProject();
  try {
    fake.files.set(
      "C:/repo/worktrees/main/.agents/planner-results.json",
      "{ esto no es json",
    );
    await useIssuePlannerStore.getState().restoreSavedResults();
    assert.equal(useIssuePlannerStore.getState().phase, "idle");
  } finally {
    fake.restore();
    restoreProject();
  }
});

const RELATIONS_JSON = JSON.stringify({
  mode: "roadmap",
  repo: "acme/termcanvas",
  proposals: [
    {
      title: "A",
      body: "cuerpo A",
      status: "Todo",
      priority: "P1",
      size: "S",
      blockedBy: [],
      blocking: [1],
    },
    {
      title: "B",
      body: "cuerpo B",
      status: "Todo",
      priority: "P1",
      size: "S",
      blockedBy: [0],
      blocking: [],
    },
  ],
});

// Fake de window.termcanvas.github en memoria: asigna números REALES
// arbitrarios (23, 24) para probar que el mapeo índice del plan → número
// de GitHub no usa los índices locales (0, 1).
function installFakeGithub() {
  let next = 23;
  const calls: { type: "create" | "comment"; title?: string; number?: number; body?: string }[] = [];
  const fakeWindow = {
    termcanvas: {
      github: {
        createIssue: async (_cwd: string, title: string, _body: string) => {
          const number = next;
          next += 1;
          calls.push({ type: "create", title, number });
          return { ok: true as const, number, url: `https://github.com/acme/termcanvas/issues/${number}` };
        },
        addComment: async (_cwd: string, number: number, body: string) => {
          calls.push({ type: "comment", number, body });
          return { ok: true as const };
        },
        addToProject: async () => ({ ok: true as const, applied: false as const }),
      },
    },
  };
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = fakeWindow as unknown as Window;
  return {
    calls,
    restore: () => {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = previousWindow;
      }
    },
  };
}

async function waitForPhase(phase: string, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (useIssuePlannerStore.getState().phase === phase) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

test("startCreate real: crea contra GitHub, mapea números y postea relaciones", async () => {
  resetStore();
  const fakeGithub = installFakeGithub();
  const restoreProject = installFakeProject();
  try {
    const parsed = parsePlanningPlan(RELATIONS_JSON);
    assert.ok(parsed);
    useIssuePlannerStore.getState().finishSession(parsed.result);
    useIssuePlannerStore.getState().toggleSelect(0);
    useIssuePlannerStore.getState().toggleSelect(1);
    useIssuePlannerStore.getState().startCreate();

    assert.ok(
      await waitForPhase("summary"),
      "la corrida real debe terminar en summary",
    );
    const progress = useIssuePlannerStore.getState().createProgress;
    assert.equal(progress[0].number, 23, "usa el número real de GitHub, no el índice");
    assert.equal(progress[1].number, 24);
    assert.equal(progress[0].url, "https://github.com/acme/termcanvas/issues/23");

    const creates = fakeGithub.calls.filter((call) => call.type === "create");
    assert.deepEqual(
      creates.map((call) => call.title),
      ["A", "B"],
      "crea en orden de selección",
    );

    const comments = fakeGithub.calls.filter((call) => call.type === "comment");
    const commentOn23 = comments.find((call) => call.number === 23);
    const commentOn24 = comments.find((call) => call.number === 24);
    assert.ok(commentOn23, "el issue que bloquea recibe su comentario");
    assert.match(commentOn23!.body ?? "", /🔒 Bloquea a #24 \(B\)/);
    assert.ok(commentOn24, "el issue bloqueado recibe su comentario");
    assert.match(commentOn24!.body ?? "", /⛔ Bloqueado por #23 \(A\)/);
  } finally {
    fakeGithub.restore();
    restoreProject();
  }
});

test("refreshNextIssueNumber proyecta el último número asignado por GitHub", async () => {
  resetStore();
  const fakeWindow = {
    termcanvas: {
      github: {
        lastIssueNumber: async () => 41,
      },
    },
  };
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = fakeWindow as unknown as Window;
  const restoreProject = installFakeProject();
  try {
    await useIssuePlannerStore.getState().refreshNextIssueNumber();
    assert.equal(useIssuePlannerStore.getState().nextIssueNumber, 41);

    // Sin bridge ni repo: queda null y la UI cae al índice local.
    restoreProject();
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
    resetStore();
    await useIssuePlannerStore.getState().refreshNextIssueNumber();
    assert.equal(useIssuePlannerStore.getState().nextIssueNumber, null);
  } finally {
    restoreProject();
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
});

test("startCreate real: falla informando el error y permite reintentar sin duplicar", async () => {
  resetStore();
  const fakeWindow = {
    termcanvas: {
      github: {
        createIssue: async () => {
          return { ok: false as const, error: "invalid label" };
        },
        addComment: async () => ({ ok: true as const }),
        addToProject: async () => ({ ok: true as const, applied: false as const }),
      },
    },
  };
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = fakeWindow as unknown as Window;
  const restoreProject = installFakeProject();
  try {
    const parsed = parsePlanningPlan(PROJECT_JSON);
    assert.ok(parsed);
    useIssuePlannerStore.getState().finishSession(parsed.result);
    useIssuePlannerStore.getState().toggleSelect(0);
    useIssuePlannerStore.getState().toggleSelect(1);
    useIssuePlannerStore.getState().startCreate();

    // Espera un par de ticks: el fallo corta la corrida y vuelve a results.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const state = useIssuePlannerStore.getState();
    assert.equal(state.phase, "results", "falla → vuelve a resultados");
    assert.equal(state.createProgress[0].state, "error", "el item fallido queda marcado");
    assert.equal(state.createProgress[1].state, "pending", "el resto queda pendiente");

    // Reintento tras fallo: el item que ya quedó done no se vuelve a crear.
    useIssuePlannerStore.getState().startCreate();
    assert.equal(useIssuePlannerStore.getState().phase, "creating");
    assert.equal(useIssuePlannerStore.getState().createProgress.length, 2);
  } finally {
    restoreProject();
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
});