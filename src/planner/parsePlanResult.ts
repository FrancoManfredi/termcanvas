import type {
  AuditPlan,
  IssueSeverity,
  IssueTemplateFields,
  PlanningResult,
  RequisitoVerdict,
  RoadmapPlan,
  RoadmapProposal,
} from "../types/issuePlanning.ts";
import { deriveAuditLabels } from "./deriveAuditLabels.ts";

// Parseo y validación del archivo que opencode escribe en
// <repo>/.agents/planning/plan-<timestamp>.json. El modelo puede
// desviarse del contrato por capricho: esta capa existe para convertir
// "algo que escribió el agente" en un PlanningResult que la UI puede
// renderizar, o fallar con un mensaje que el usuario sí entienda.

export interface ParsedPlan {
  result: PlanningResult;
  warnings: string[];
}

export interface OpenIssueRef {
  number: number;
  title: string;
}

// Anti-duplicado determinista contra los issues abiertos del repo. El
// prompt le pide al modelo marcar existingIssueNumber, pero no es
// confiable: en la práctica escribe "ya cubierto por la issue abierta"
// en el body y propone el mismo problema como tema nuevo igual. Esta
// capa NO confía en él: después del parse compara el título de cada item
// contra los issues abiertos y, cuando el solapamiento de tokens es
// fuerte, marca el item con existingIssueNumber en la app (con un
// warning para que el usuario sepa que la marca la puso la herramienta,
// no el modelo).
//
// Precisión antes que recall: un falso positivo marca con "ya existe" un
// problema que es nuevo, y eso molesta más que un duplicado que el
// usuario descarta marcando el checkbox. Por eso los umbrales exigen un
// parentesco léxico real (≥4 tokens compartidos y Jaccard ≥ 0.5), no
// solo compartir contexto genérico como "Windows PowerShell".
const MIN_OVERLAP = 4;
const MIN_JACCARD = 0.5;
// Raíz de token: "acentupe/acentuados/acentuado" → "acentu". Nivel que
// deja iguales las flexiones del español en los títulos.
const TOKEN_STEM = 8;
const MIN_WORD_LENGTH = 3;
// Palabras de 3 letras que no discriminan entre problemas: sacarlas del
// título "UTF-8 sin BOM..." no reduce la señal porque lo que importa es
// el conjunto de términos técnicos compartidos.
const STOPWORDS = new Set([
  "sin", "con", "los", "las", "una", "uno", "para", "por", "que",
  "del", "al", "como", "mas", "don", "etc", "eso", "esta", "este",
]);

// Normaliza un título a un conjunto de raíces estables: minúsculas sin
// acentos, sin puntuación, sin palabras vacías ni números sueltos
// ("5.1" no es señal de problema porque casi todos los issues del repo
// mencionan una versión).
function titleTokens(title: string): Set<string> {
  const folded = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const word of folded.split(/[^a-z0-9]+/)) {
    if (!word || word.length < MIN_WORD_LENGTH || STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    const stem = word.slice(0, TOKEN_STEM);
    if (!seen.has(stem)) {
      seen.add(stem);
      tokens.push(stem);
    }
  }
  return new Set(tokens);
}

// Devuelve el issue abierto que mejor cobre el título del item (por
// intersección ponderada), o undefined si ninguno es lo bastante igual.
function findMatchingIssue(
  title: string,
  openIssues: OpenIssueRef[],
): OpenIssueRef | undefined {
  const tokens = titleTokens(title);
  let best: OpenIssueRef | undefined;
  let bestScore = 0;
  for (const issue of openIssues) {
    const candidate = titleTokens(issue.title);
    if (candidate.size === 0) continue;
    let overlap = 0;
    for (const token of candidate) if (tokens.has(token)) overlap += 1;
    if (overlap < MIN_OVERLAP) continue;
    const jaccard = overlap / (tokens.size + candidate.size - overlap);
    if (jaccard >= MIN_JACCARD && jaccard > bestScore) {
      best = issue;
      bestScore = jaccard;
    }
  }
  return best;
}

// Segunda pasada sobre el plan ya parseado: los items sin marca propia
// que repiten título de un issue abierto se marcan con existingIssueNumber
// aquí, en la app, sin esperar nada al modelo.
function applyExistingIssueDedup(
  result: PlanningResult,
  openIssues: OpenIssueRef[],
  warnings: string[],
): void {
  if (openIssues.length === 0) return;
  const items = result.mode === "roadmap" ? result.proposals : result.findings;
  for (const item of items) {
    if (item.existingIssueNumber !== undefined) continue;
    const match = findMatchingIssue(item.title, openIssues);
    if (!match) continue;
    item.existingIssueNumber = match.number;
    warnings.push(
      `El item «${item.title}» repite el issue abierto #${match.number} («${match.title}»); se marcó automáticamente como ya cubierto.`,
    );
  }
}

const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const SIZES = new Set(["XS", "S", "M", "L", "XL"]);
const VERDICT_STATES = new Set(["CUMPLE", "NO_CUMPLE", "PARCIAL", "NO_VERIFICABLE"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function readNumberList(record: Record<string, unknown>, key: string): number[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function readStringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

// Índice 0-based o número de issue: solo enteros no negativos. Cualquier
// otra cosa (string, negativo, decimal) se descarta sin warning: el campo
// es opcional y el modelo puede confundir formato.
function readOptionalIndex(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function normalizePriority(value: string, warnings: string[]): string {
  if (PRIORITIES.has(value)) return value;
  warnings.push(`prioridad "${value}" fuera de norma P0-P3`);
  return value.toUpperCase() === "CRITICAL" ? "P0" : value;
}

function normalizeSize(value: string, warnings: string[]): string {
  if (SIZES.has(value)) return value;
  warnings.push(`tamaño "${value}" fuera de escala S-XL`);
  return value;
}

// Campos del template de bug report que el agente completa por issue. El
// template es opcional (los planes viejos no lo traen): si falta o viene
// mal formado, el issue sigue sirviendo con su description/body solamente.
function parseTemplate(raw: unknown): IssueTemplateFields | undefined {
  if (!isRecord(raw)) return undefined;
  const stepsToReproduce = Array.isArray(raw.stepsToReproduce)
    ? raw.stepsToReproduce.filter(
        (step): step is string => typeof step === "string" && step.trim().length > 0,
      )
    : [];
  const fields: IssueTemplateFields = {};
  if (stepsToReproduce.length > 0) fields.stepsToReproduce = stepsToReproduce;
  for (const key of [
    "expectedBehavior",
    "actualBehavior",
    "version",
    "os",
    "agent",
    "area",
    "logs",
    "additionalContext",
  ] as const) {
    const value = readString(raw, key);
    if (value.trim().length > 0) fields[key] = value;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function parseProposal(
  raw: unknown,
  index: number,
  warnings: string[],
): RoadmapProposal | null {
  if (!isRecord(raw)) {
    warnings.push(`propuesta ${index + 1} no es un objeto`);
    return null;
  }
  const title = readString(raw, "title");
  if (!title.trim()) {
    warnings.push(`propuesta ${index + 1} no tiene título`);
    return null;
  }
  return {
    title,
    body: readString(raw, "body"),
    labels: Array.isArray(raw.labels)
      ? raw.labels.filter((label): label is string => typeof label === "string")
      : [],
    status: readString(raw, "status", "Todo"),
    priority: normalizePriority(readString(raw, "priority", "P3"), warnings),
    size: normalizeSize(readString(raw, "size", "M"), warnings),
    parent: typeof raw.parent === "number" ? raw.parent : undefined,
    blockedBy: readNumberList(raw, "blockedBy"),
    blocking: readNumberList(raw, "blocking"),
    related: readNumberList(raw, "related"),
    duplicateOf: readOptionalIndex(raw, "duplicateOf"),
    existingIssueNumber: readOptionalIndex(raw, "existingIssueNumber"),
    template: parseTemplate(raw.template),
  };
}

function parseRoadmap(raw: Record<string, unknown>, warnings: string[]): RoadmapPlan {
  const rawProposals = Array.isArray(raw.proposals) ? raw.proposals : [];
  const proposals: RoadmapProposal[] = [];
  rawProposals.forEach((proposal, index) => {
    const parsed = parseProposal(proposal, index, warnings);
    if (parsed) proposals.push(parsed);
  });
  if (rawProposals.length === 0) {
    warnings.push("modo roadmap sin propuestas");
  }
  return { mode: "roadmap", repo: readString(raw, "repo"), proposals };
}

function parseFinding(raw: unknown): AuditPlan["findings"][number] | null {
  if (!isRecord(raw)) return null;
  const title = readString(raw, "title");
  if (!title.trim()) return null;
  const severity = readString(raw, "severity", "medium");
  return {
    title,
    severity: SEVERITIES.has(severity)
      ? (severity as AuditPlan["findings"][number]["severity"])
      : "medium",
    file: readString(raw, "file"),
    line: typeof raw.line === "number" ? raw.line : 0,
    description: readString(raw, "description"),
    labels: readStringList(raw, "labels"),
    rule: readString(raw, "rule") || undefined,
    duplicateOf: readOptionalIndex(raw, "duplicateOf"),
    existingIssueNumber: readOptionalIndex(raw, "existingIssueNumber"),
    template: parseTemplate(raw.template),
  };
}

function parseAudit(raw: Record<string, unknown>, warnings: string[]): AuditPlan {
  const rawFindings = Array.isArray(raw.findings) ? raw.findings : [];
  const findings = rawFindings
    .map(parseFinding)
    .filter((finding): finding is AuditPlan["findings"][number] => finding !== null);
  if (rawFindings.length === 0) {
    warnings.push("modo audit sin hallazgos");
  }
  if (findings.length < rawFindings.length) {
    warnings.push(`se descartaron ${rawFindings.length - findings.length} hallazgos inválidos`);
  }
  return { mode: "audit", repo: readString(raw, "repo"), findings };
}

// Veredictos de cumplimiento de requerimientos: tolerante a items inválidos
// (id vacío, estado fuera de norma) — un item mal formado se descarta sin
// romper el plan. Ausente → undefined (planes viejos sin la sección).
function parseRequisitos(raw: unknown): RequisitoVerdict[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const verdicts: RequisitoVerdict[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = readString(item, "id");
    if (!id.trim()) continue;
    const estado = readString(item, "estado");
    if (!VERDICT_STATES.has(estado)) continue;
    verdicts.push({
      id,
      estado: estado as RequisitoVerdict["estado"],
      justificacion: readString(item, "justificacion"),
    });
  }
  return verdicts.length > 0 ? verdicts : undefined;
}

export function parsePlanningPlan(
  content: string,
  openIssues?: OpenIssueRef[],
): ParsedPlan | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (raw.mode !== "roadmap" && raw.mode !== "audit") return null;
  const warnings: string[] = [];
  const result =
    raw.mode === "roadmap" ? parseRoadmap(raw, warnings) : parseAudit(raw, warnings);
  // Veredicto de cumplimiento de requerimientos (ambos modos).
  result.requisitos = parseRequisitos(raw.requisitos);
  // template a nivel de plan ("aplica a CADA item"): se propaga a los items
  // que no traen el suyo. Un item con template propio siempre gana.
  applySharedTemplate(result, raw.template);
  // Anti-duplicado determinista: incluso si el modelo ignoró la sección
  // ISSUES YA ABIERTOS, los items que repiten un issue abierto se marcan
  // acá (see applyExistingIssueDedup).
  applyExistingIssueDedup(result, openIssues ?? [], warnings);
  // Labels de auditoría: si el finding no vino con labels, se derivan por
  // severidad/area/archivo (see deriveAuditLabels). Idempotente: solo
  // toca los findings sin labels, así que re-parsear un resultado
  // persistido no cambia nada.
  if (result.mode === "audit") {
    for (const finding of result.findings) {
      if (!finding.labels || finding.labels.length === 0) {
        finding.labels = deriveAuditLabels(finding);
      }
    }
  }
  return { result, warnings };
}

// El contrato permite un template único a nivel de plan que aplica a todos
// los items; el UI lo consume por item, así que se materializa aquí la
// propagación para que el body de cada issue se arme con el formulario.
function applySharedTemplate(
  result: PlanningResult,
  rawTemplate: unknown,
): void {
  const shared = parseTemplate(rawTemplate);
  if (!shared) return;
  if (result.mode === "roadmap") {
    result.proposals = result.proposals.map((proposal) =>
      proposal.template ? proposal : { ...proposal, template: shared },
    );
  } else {
    result.findings = result.findings.map((finding) =>
      finding.template ? finding : { ...finding, template: shared },
    );
  }
}

export function describePlanError(content: string): string {
  const parsed = parsePlanningPlan(content);
  if (parsed) return "";
  let reason = "JSON no parseable o fuera de contrato";
  try {
    const raw = JSON.parse(content) as unknown;
    if (isRecord(raw)) {
      reason = `mode "${String(raw.mode ?? "(sin mode)")}" no es "roadmap" ni "audit"`;
    }
  } catch {
    // el parse ya falló; reason genérico alcanza
  }
  return reason;
}