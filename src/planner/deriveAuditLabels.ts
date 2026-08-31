import type { AuditFinding } from "../types/issuePlanning.ts";

// Derivación determinista de labels para los findings de auditoría.
//
// El agente puede escribir `labels` en cada finding, pero NO se confía en
// él: si viene vacío, la app deriva una categoría con reglas. La precisión
// NO sale de una taxonomía gigante de keywords (500 patrones se rompen
// igual): sale de los datos ESTRUCTURADOS que la auditoría ya produce.
// En orden de señal:
//   1. severity — critical/high es un bug por definición.
//   2. template.area — campo controlado del bug report (auth, docs,
//      tests…): mapeo directo.
//   3. file — la ruta del archivo dice en qué dominio vive el problema
//      (docs/, *test*, .github/…): señal barata y confiable.
//   4. keywords en título/descripción — último recurso para los casos que
//      ninguna señal estructurada cubrió; un set chico de patrones alcanza
//      (token→security, slow→perf…), los casos raros caen al fallback.
//
// El fallback es `bug`: un finding de auditoría es un problema por
// definición, y ese label siempre existe en el repo porque ensureLabels
// lo crea al primer uso.

const UNIQUE = <T>(values: T[]): T[] => [...new Set(values)];

// Dominio al que pertenece el area del template (campo libre pero breve:
// "auth", "docs", "tests"…). Se matchea por substring en minúsculas.
const AREA_LABELS: Array<[pattern: string, label: string]> = [
  ["token", "security"],
  ["secret", "security"],
  ["auth", "security"],
  ["secur", "security"],
  ["docs", "docs"],
  ["documentation", "docs"],
  ["test", "tests"],
  ["ci", "ci"],
  ["perf", "perf"],
  ["performance", "perf"],
  ["sql", "data"],
  ["db", "data"],
  ["database", "data"],
  ["docker", "infra"],
  ["deploy", "infra"],
  ["infra", "infra"],
  ["refactor", "refactor"],
  ["ui", "ui"],
  ["cli", "ui"],
  ["tui", "ui"],
];

// Convenciones de rutas: leer el path del finding dice el dominio sin
// depender de que el área del template esté rellenada.
const FILE_PATTERNS: Array<[pattern: string, label: string]> = [
  ["docs/", "docs"],
  ["/doc", "docs"],
  [".md", "docs"],
  ["/test", "tests"],
  ["__tests__", "tests"],
  [".test.", "tests"],
  [".spec.", "tests"],
  [".github/", "ci"],
  ["workflows", "ci"],
  ["dockerfile", "infra"],
  ["docker-compose", "infra"],
  ["terraform", "infra"],
  ["package.json", "infra"],
];

// Solo los patrones que aportan señal real sobre texto libre; si nada calza,
// el fallback `bug` cubre el finding. Un pattern más amplio acá mete ruido
// (falsos "security"/"perf") y cuesta más que un finding sin label.
const TEXT_PATTERNS: Array<[pattern: RegExp, label: string]> = [
  [/(token|secret|api[- ]?key|credential|password|\.env)/i, "security"],
  [/(memory|leak|slow|latency|lazy|performance|profiling)/i, "perf"],
  [/(race|concurr|deadlock|thread-safety)/i, "concurrency"],
  [/(refactor|debt|duplicate|redundan)/i, "refactor"],
  [/(crash|corrupt|corromp|unicode|encoding|acento)/i, "bug"],
];

export function deriveAuditLabels(finding: AuditFinding): string[] {
  const labels: string[] = [];
  if (finding.severity === "critical" || finding.severity === "high") {
    labels.push("bug");
  }
  const area = (finding.template?.area ?? "").toLowerCase();
  if (area) {
    const match = AREA_LABELS.find(([pattern]) => area.includes(pattern));
    if (match) labels.push(match[1]);
  }
  const file = finding.file.toLowerCase();
  if (file) {
    const match = FILE_PATTERNS.find(([pattern]) => file.includes(pattern));
    if (match) labels.push(match[1]);
  }
  const text = `${finding.title} ${finding.description}`.toLowerCase();
  for (const [pattern, label] of TEXT_PATTERNS) {
    if (pattern.test(text)) labels.push(label);
  }
  if (labels.length === 0) labels.push("bug");
  return UNIQUE(labels);
}