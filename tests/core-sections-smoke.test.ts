// Smoke render de las 10 secciones del modal unificado bajo jsdom.
//
// Cada sección se monta DENTRO de un CoreModalContext.Provider con valores
// stub y una síntesis de ejemplo, y se verifica que el contenido esperado
// aparezca. No es un test de interacción: es la red de seguridad del refactor
// — si una sección deja de montar (import roto, contexto faltante, typo en el
// registro), este test falla antes que el usuario.

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { CoreModalContextValue } from "../src/components/core/context.ts";
import type { SynthesisResult } from "../headless-runtime/interview/index.ts";

// ── Instalación del DOM ANTES de importar React/react-dom ────────────────

const dom = new JSDOM(
  "<!doctype html><html><body></body></html>",
  { url: "http://localhost", pretendToBeVisual: true },
);
const { window } = dom;

globalThis.window = window as unknown as Window & typeof globalThis;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
Object.defineProperty(globalThis, "navigator", {
  value: window.navigator,
  configurable: true,
});
(globalThis as Record<string, unknown>).localStorage = window.localStorage;
(globalThis as Record<string, unknown>).MutationObserver = window.MutationObserver;
(globalThis as Record<string, unknown>).getComputedStyle =
  window.getComputedStyle.bind(window);
(globalThis as Record<string, unknown>).requestAnimationFrame =
  window.requestAnimationFrame?.bind(window) ??
  ((cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 16));
(globalThis as Record<string, unknown>).cancelAnimationFrame =
  window.cancelAnimationFrame?.bind(window) ?? window.clearTimeout;

window.matchMedia =
  window.matchMedia ??
  ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
(window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
  () => {};

// Stub permisivo de la API IPC: toda llamada resuelve con una forma segura
// (ok:true + arrays vacíos) para que los efectos on-mount nunca exploten.
const safeResult = () => ({
  ok: true,
  labels: [],
  issues: [],
  summaries: [],
  projects: [],
  worktrees: [],
});
(window as Record<string, unknown>).termcanvas = new Proxy(
  {},
  {
    get: (_ns, fn) => {
      if (typeof fn !== "string") return undefined;
      return (..._args: unknown[]) => {
        if (fn === "state") return Promise.resolve({ ledger: null });
        if (fn === "readFile") return Promise.resolve({ ok: false });
        if (fn === "listOpenIssues") return Promise.resolve(safeResult());
        return Promise.resolve(safeResult());
      };
    },
  },
);

// ── Dependencias React cargadas lazy (después del DOM) ───────────────────

interface Deps {
  React: typeof import("react");
  createRoot: typeof import("react-dom/client")["createRoot"];
  CoreModalContext: typeof import("../src/components/core/context.ts")["CoreModalContext"];
  SECTION_REGISTRY: import("../src/components/core/registry.tsx").SectionDef[];
}

let depsPromise: Promise<Deps> | null = null;

function init(): Promise<Deps> {
  if (!depsPromise) {
    depsPromise = (async () => {
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
      const [ReactMod, ReactDOMClient, ctxMod, regMod] = await Promise.all([
        import("react"),
        import("react-dom/client"),
        import("../src/components/core/context.ts"),
        import("../src/components/core/registry.tsx"),
      ]);
      return {
        React: ReactMod.default ?? (ReactMod as unknown as Deps["React"]),
        createRoot: ReactDOMClient.createRoot,
        CoreModalContext: ctxMod.CoreModalContext,
        SECTION_REGISTRY: regMod.SECTION_REGISTRY,
      };
    })();
  }
  return depsPromise;
}

// ── Síntesis de ejemplo y contexto stub ──────────────────────────────────

function sampleSynthesis(): SynthesisResult {
  return {
    historias_de_usuario: [
      {
        id: "HS-001",
        titulo: "(sin titulo)",
        rol: "operador",
        quiero: "cargar viajes",
        para: "no perder registros",
        prioridad: "Must have",
        criterios_de_aceptacion: ["se guarda el viaje"],
        origen: "manual",
      },
    ],
    historias_eliminadas: [],
    historias_backfilled: false,
    requerimientos_funcionales: [
      {
        id: "RF-001",
        descripcion: "Alta de viajes",
        justificacion: "sin alta no hay datos",
        criterio_de_ajuste: "form valida campos",
        prioridad: "Must have",
        origen: "manual",
        historia_origen: "HS-001",
        historias_origen: ["HS-001"],
      },
    ],
    rfs_eliminados: [],
    atributos_de_calidad_y_asrs: [
      {
        id: "ASR-001",
        atributo: "Rendimiento",
        es_asr_genuino: true,
        justificacion_arquitectonica: "ventana de carga acotada",
        escenario_tecnico_6_partes: {
          fuente: "operador",
          estimulo: "alta masiva",
          artefacto: "formulario",
          entorno: "campo con 3G",
          respuesta: "guardado local",
          medida_de_respuesta: "< 2s",
        },
        trade_offs_identificados: "consistencia vs latencia",
        origen: "manual",
      },
    ],
    asrs_eliminados: [],
    restricciones_globales: [
      { id: "CON-001", tipo: "Legal", descripcion: "datos locales", impacto: "sin nube" },
    ],
    restricciones_eliminadas: [],
    glosario_de_terminos: { Facturación: "emisión de comprobantes" },
    terminos_eliminados: [],
  } as unknown as SynthesisResult;
}

function makeCtx(): CoreModalContextValue {
  return {
    close: () => {},
    navigate: () => {},
    search: "",
    setSearch: () => {},
    copiedId: null,
    copy: () => {},
    synthesis: sampleSynthesis(),
    synthesisPath: "/tmp/sintesis.json",
    synthLoading: false,
    applySynthesis: () => {},
    highlightStoryId: null,
    jumpToStory: () => {},
    rfCountForStory: () => 0,
    openGithubIssues: () => {},
    githubDiagFilter: "all",
    setGithubDiagFilter: () => {},
    curDeletedOpen: false,
    setCurDeletedOpen: () => {},
    securityOpen: false,
    openSecurityFlow: () => {},
    closeSecurityFlow: () => {},
    diagHistory: [],
  };
}

// ── Helper de render/cleanup ─────────────────────────────────────────────

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

async function renderSection(id: string): Promise<Mounted> {
  const { React, createRoot, CoreModalContext, SECTION_REGISTRY } = await init();
  const def = SECTION_REGISTRY.find((s) => s.id === id);
  assert.ok(def, `la sección "${id}" no está en el registro`);

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const element = React.createElement(
    CoreModalContext.Provider,
    { value: makeCtx() },
    React.createElement(def.Component),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const act = (React as unknown as { act: (cb: () => Promise<void>) => Promise<void> }).act;
  assert.equal(typeof act, "function", "React.act no está disponible");

  await act(async () => {
    root.render(element);
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

// ── Smoke por sección ────────────────────────────────────────────────────

type Case = { id: string; expect?: string };

const CASES: Case[] = [
  { id: "user_stories", expect: "CRITERIOS DE ACEPTACIÓN" },
  { id: "functional_requirements", expect: "JUSTIFICACIÓN" },
  { id: "quality_attributes", expect: "ESCENARIO TÉCNICO (6 PARTES)" },
  { id: "constraints", expect: "IMPACTO EN DISEÑO" },
  { id: "glossary", expect: "Facturación" },
  { id: "planning_diagnosis", expect: "Diagnóstico del Repositorio" },
  { id: "planning_roadmap", expect: "Planificador desde Roadmap" },
  { id: "github_issues", expect: "Sin diagnósticos completados" },
  // Las dos secciones que embeben modales completos: solo verificamos que
  // monten sin explotar (su contenido interno pertenece a sus propios tests).
  { id: "repo_context" },
  { id: "requirements_interview" },
];

for (const testCase of CASES) {
  test(`smoke: la sección "${testCase.id}" monta y renderiza`, async () => {
    const mounted = await renderSection(testCase.id);
    try {
      const text = mounted.container.textContent ?? "";
      assert.ok(text.length > 0, `"${testCase.id}" renderizó vacío`);
      if (testCase.expect) {
        assert.ok(
          text.includes(testCase.expect),
          `"${testCase.id}" no muestra "${testCase.expect}". Recibido: ${text.slice(0, 200)}`,
        );
      }
    } finally {
      await mounted.unmount();
    }
  });
}
