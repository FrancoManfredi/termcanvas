// Registro ÚNICO de categorías del Diagnóstico por categorías (Opción B).
//
// La categoría decide qué herramientas deterministas corren (Fase A) y en qué
// se concentra el LLM (Fase B): cada corrida produce su propio
// diagnostico-<categoria>-<timestamp>.json. El mapeo categoría → tool keys
// tiene su contraparte EJECUTABLE en scripts/run-diagnostico-tools.mjs
// (CATEGORY_TOOLS): este archivo es la fuente para UI/prompt/store y un test
// de sincronización (tests/diagnosis-categories.test.ts) garantiza que ambos
// lados nunca diverjan.

export type DiagnosisCategoryId =
  | "diseno-patrones"
  | "organizacion"
  | "documentacion"
  | "seguridad"
  | "proteccion"
  | "rendimiento"
  | "buenas-practicas"
  | "requerimientos";

// Bucket de visualización para diagnósticos previos al feature (archivos
// diagnostico-<ts>.json y plan-<ts>.json legacy con mode audit): no es una
// categoría lanzable, solo etiqueta de historial.
export const LEGACY_CATEGORY_ID = "general";

export interface DiagnosisCategory {
  id: DiagnosisCategoryId;
  label: string;
  // Descripción corta para el selector de la UI.
  description: string;
  // Tool keys del orquestador que corren para esta categoría. Vacía =
  // categoría LLM-only: la corrida salta la Fase A y va directo al modelo.
  tools: string[];
  // Qué entra en alcance (viaja al prompt como instrucción de foco).
  scopeIn: string;
  // Qué queda FUERA de alcance: el prompt prohíbe reportarlos como items
  // (otro diagnóstico por categoría los cubre).
  scopeOut: string;
}

export const DIAGNOSIS_CATEGORIES: readonly DiagnosisCategory[] = [
  {
    id: "diseno-patrones",
    label: "Patrones de diseño y principios",
    description: "SOLID, cohesión y acoplamiento, patrones bien o mal aplicados.",
    tools: ["depcruise"],
    scopeIn:
      "juicio de diseño que ninguna herramienta puede hacer sola: principios SOLID violados, baja cohesión, alto acoplamiento semántico, patrones aplicados incorrectamente o ausentes donde el dominio los pide. Los ciclos de dependencia y módulos huérfanos que marca dependency-cruiser son SEÑALES para investigar diseño, no findings automáticos.",
    scopeOut:
      "estilo de código, documentación, seguridad, rendimiento y deuda de mantenimiento genérica",
  },
  {
    id: "organizacion",
    label: "Organización de archivos y estructura",
    description: "Estructura de carpetas/módulos, código muerto, límites difusos.",
    tools: ["knip", "depcruise"],
    scopeIn:
      "la estructura física del repositorio: archivos y carpetas mal ubicados, módulos con responsabilidades mezcladas, límites difusos entre capas o features, y código muerto (exports, tipos, archivos sin usar; módulos huérfanos desde el entrypoint).",
    scopeOut:
      "cómo está escrito el código por dentro (patrones y principios, eso es diseño), documentación y seguridad",
  },
  {
    id: "documentacion",
    label: "Documentación",
    description: "JSDoc/TSDoc, READMEs, comentarios útiles vs ruido.",
    tools: ["eslint"],
    scopeIn:
      "cobertura y calidad de documentación: funciones y módulos públicos sin JSDoc/TSDoc (las herramientas agregan el conteo por archivo), READMEs ausentes, desactualizados o que mienten sobre el comportamiento real, y comentarios que confunden más de lo que aclaran.",
    scopeOut:
      "todo problema de código que no sea documentación (bugs, seguridad, rendimiento)",
  },
  {
    id: "seguridad",
    label: "Seguridad",
    description: "Secretos, CVEs, superficie de ataque, workflows CI, licencias.",
    tools: ["npm-audit", "license-checker", "semgrep", "gitleaks", "zizmor"],
    scopeIn:
      "superficie de ataque: secretos y credenciales expuestas (gitleaks), vulnerabilidades conocidas de dependencias (npm audit), patrones de código explotables como inyección o validación de input faltante y autorización débil (semgrep + exploración dirigida del modelo: la lógica de negocio no la cubre ninguna herramienta), seguridad de workflows de CI (zizmor) y compliance de licencias copyleft.",
    scopeOut:
      "calidad de código general, estilo, arquitectura y tolerancia a fallos",
  },
  {
    id: "proteccion",
    label: "Protección",
    description: "Tolerancia a fallos, errores, retries/timeouts, degradación.",
    tools: [],
    scopeIn:
      "tolerancia a fallos y protección contra estados inseguros: manejo de errores (catch que tragan excepciones o propagan el estado corrupto), ausencia de timeouts/retries/backoff en I/O externo, validación de estados inválidos antes de usarlos, y puntos únicos de fallo sin fallback ni degradación elegante.",
    scopeOut:
      "vulnerabilidades de seguridad clásicas (categoría Seguridad) y preferencias de estilo",
  },
  {
    id: "rendimiento",
    label: "Escalabilidad y rendimiento",
    description: "Complejidad, N+1, memoria, trabajo en el camino crítico.",
    tools: [],
    scopeIn:
      "rendimiento y escalabilidad: complejidad algorítmica innecesaria, consultas repetidas o N+1 dentro de loops, fugas de memoria potenciales (listeners no removidos, closures que retienen referencias grandes), trabajo pesado en caminos críticos de render/request, y artefactos o assets inflados.",
    scopeOut:
      "micro-optimizaciones sin evidencia medible y todo lo ajeno a performance",
  },
  {
    id: "buenas-practicas",
    label: "Buenas prácticas generales",
    description: "Bugs de calidad, tipos, duplicación, deps desactualizadas.",
    tools: ["eslint", "tsc", "jscpd", "npm-outdated", "git-sizer"],
    scopeIn:
      "higiene general del código: bugs y code smells que marcan los linters, errores de tipos (tsc), duplicación significativa de código (jscpd), dependencias desactualizadas (npm outdated) y bloat del repositorio como blobs gigantes commiteados (git-sizer).",
    scopeOut:
      "lo que corresponde a las otras categorías (seguridad, documentación, diseño) aunque aparezca en los hallazgos",
  },
  {
    id: "requerimientos",
    label: "Requerimientos sin implementar",
    description: "Veredicto de RFs/ASRs/restricciones contra el código real.",
    tools: [],
    scopeIn:
      "el cumplimiento de lo relevado en la entrevista: evaluar CADA requerimiento funcional, ASR y restricción de la sección REQUERIMIENTOS RELEVADOS contra el código real, con veredicto CUMPLE/NO_CUMPLE/PARCIAL/NO_VERIFICABLE y un finding con evidencia file:line por cada NO_CUMPLE/PARCIAL.",
    scopeOut:
      "problemas de calidad que NO se deriven de un requerimiento o restricción incumplida",
  },
] as const;

export function isDiagnosisCategoryId(value: string): value is DiagnosisCategoryId {
  return DIAGNOSIS_CATEGORIES.some((cat) => cat.id === value);
}

export function getDiagnosisCategory(
  id: string,
): DiagnosisCategory | undefined {
  return DIAGNOSIS_CATEGORIES.find((cat) => cat.id === id);
}

// Label para mostrar en UI: categoría válida → su label; legacy/desconocida →
// "General" (los diagnósticos previos al feature no tenían categoría).
export function categoryLabel(id: string | null | undefined): string {
  return getDiagnosisCategory(id ?? "")?.label ?? "General";
}

// ─── Convención de archivos del plan ──────────────────────────────────────
// diagnostico-<categoria>-<timestamp>.json (corridas nuevas);
// diagnostico-<timestamp>.json (legacy sin categoría). El slug es siempre
// [a-z][a-z-]* (sin dígitos), así que no hay ambigüedad con el timestamp.

export function diagnosisFileName(categoryId: string, ts: number): string {
  return `diagnostico-${categoryId}-${ts}.json`;
}

export function legacyDiagnosisFileName(ts: number): string {
  return `diagnostico-${ts}.json`;
}

// Acepta ambas formas y devuelve el slug crudo (sin validar contra el
// registro: un archivo de una versión futura con categoría desconocida se
// muestra como General, no desaparece del historial).
export function parseDiagnosisFileName(
  name: string,
): { category: string | null; ts: number } | null {
  const match = /^diagnostico-(?:([a-z][a-z-]*)-)?(\d+)\.json$/.exec(name);
  if (!match) return null;
  const ts = Number(match[2]);
  if (!Number.isFinite(ts)) return null;
  return { category: match[1] ?? null, ts };
}
