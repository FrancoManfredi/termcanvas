/**
 * definitionValidate — Ola 20 E1 (Paridad Warp: validación de definition, lado backend).
 *
 * Una definition rota GRITA en vez de degradar en silencio: este validador puro
 * revisa toda `factory/` (agents, factory.yaml, scorers, skills, runners,
 * benchmarks tasks, proposals dir) y devuelve issues accionables
 * `{file, line?, rule, message, severity}`. Los loaders SIGUEN con fallback
 * (fail-safe, intactos); el fallback pasa a ser VISIBLE vía el badge (E2).
 *
 * Contratos inamovibles (E2 y QA programan contra estas firmas):
 * - `validateDefinition` NUNCA lanza: ante cualquier fallo catastrófico
 *   retorna 1 issue error `validate-crashed`. Cada archivo/sección tiene su
 *   propio try/catch: un archivo roto no aborta el resto.
 * - `valid` = cero issues con severity `error`. Los `warn` NO bloquean
 *   (badge ámbar, no rojo; exit 0 en el CLI).
 * - `line` = LÍNEA APROXIMADA honesta: se busca la key en el texto del archivo
 *   y se da su nº de línea (1-based); si no se halla, se omite `line`.
 * - `checkedAt` = ISO. `factoryDir` default = `factory/` del repo resuelto sin
 *   hardcodear rutas de máquina (desde import.meta con fallback a cwd; honra
 *   `TERMCANVAS_FACTORY_DIR` como el resto del backend), jamás literal `C:\...`.
 *
 * Espejos exactos (sin duplicar lógica: se IMPORTA, no se copia):
 * - agents: `FACTORY_AGENT_ROLES` de shared/roles (fuente única FASE 1;
 *   `AGENT_TYPES` de agentLoader la re-exporta) + `parseAgentFile` de
 *   agentLoader (E1-Ola7).
 * - runners: `parseRunnerDefinition` + `RunnerParseError` de agentLoader (E1-Ola15).
 * - skills: `parseSkillFile` + `SKILL_MAX_BYTES` (8KB, Ola 10) de agentLoader.
 * - scorers: `parseScorerFile` + `SCORER_MAX_FILE_BYTES` de scorerLoader (Ola 11)
 *   y el invariante real del loader `getScorerInvariantErrors` (≥1 label con
 *   score >= passingScore Y ≥1 con score < passingScore) de shared/types/scorer.
 * - benchmarks tasks: viven en `factory/benchmarks/reference-tasks.json`
 *   (formato `{tasks: [...]}` SIN loader dedicado en el repo: Ola 12 las valida
 *   per-task con `BenchmarkTaskSchema` en tests; el validador espeja eso).
 * - proposals dir: `factory/.proposals` (ver `PROPOSALS_DIR` en
 *   headless-runtime/measure/improvementEngine.ts; no se importa ese módulo
 *   porque arrastra scorerEngine/opencode/store — solo se espeja el nombre).
 *
 * Severidades (decisión documentada):
 * - error = impide operar como definido: sin EXACTAMENTE 1 FOREMAN, yaml que no
 *   parsea o con valores fuera de rango, scorer sin labels/invariante, runner
 *   sin isolation/schema inválido, skill/agent/scorer/benchmark ilegible,
 *   tools desconocidas, frontmatter roto.
 * - warn = degradable con fallback visible: model ausente o con forma rara
 *   (hay default en yaml), skill vacía o pasada del cap (el loader trunca con
 *   nota), proposals dir no escribible (solo afecta auto-propose; el engine la
 *   crea best-effort).
 * Solo `error` bloquea (`valid=false`).
 *
 * Reglas: cero hardcodeos (rutas relativas a factoryDir), mocks solo en tests,
 * definitions as code, humano decide intacto, evidencia (file+rule), contratos
 * vivos (solo aditivo), cotas (iteración acotada por readdir, sin reintentos).
 * ESM, cero `require()`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_STAGES,
  SKILL_MAX_BYTES,
  isAgentStage,
  parseAgentFile,
  parseFactoryYaml,
  parseModelRef,
  parseRunnerDefinition,
  parseSkillFile,
  RunnerParseError,
} from "./agentLoader";
// FASE 1 E2 (C6/C7): roles desde la fuente única `shared/roles` (valores
// idénticos a `AGENT_TYPES` de agentLoader, que a su vez re-exporta de acá).
import { FACTORY_AGENT_ROLES } from "../../shared/roles";
import {
  SCORER_MAX_FILE_BYTES,
  parseScorerFile,
} from "../measure/scorerLoader";
import {
  SCORER_AGENT_ROLES,
  getScorerInvariantErrors,
} from "../../shared/types/scorer";
import {
  BenchmarkTaskSchema,
  validateBenchmarkDefinition,
} from "../../shared/types/benchmark";
// Wave 14 (C6 single vocabulary): trigger + integration schemas live in
// their domains and are IMPORTED here, never copied.
import {
  AUTOMATIONS_MAX_TRIGGERS,
  AutomationsSectionSchema,
  TriggerSchema,
} from "./automations/automationTypes";
import { IntegrationsSectionSchema, LiveSectionSchema } from "./integrations/integrationTypes";
// F3 human-in-the-measure (C6 single vocabulary): decision schemas live in
// their domain module and are IMPORTED here, never copied.
import { parseBenchmarkDecision } from "./measure/decisionRecord";
// F4 money track (C6 single vocabulary): zod for the costRates shape below.
import { z } from "zod";

// ── Contrato inamovible ──

export type DefinitionSeverity = "error" | "warn";

export interface DefinitionIssue {
  file: string;
  line?: number;
  rule: string;
  message: string;
  severity: DefinitionSeverity;
}

export interface DefinitionStatus {
  valid: boolean;
  issues: DefinitionIssue[];
  checkedAt: string;
  buildId?: string;
}

/** Ids de regla estables (el `rule` de cada issue; el `message` es accionable). */
export const DEFINITION_RULES: readonly string[] = [
  "agents-frontmatter",
  "agents-tools",
  "agents-stage",
  "agents-blocking",
  "agents-exactly-one-foreman",
  "agents-model-shape",
  "yaml-parse",
  "yaml-ports",
  "yaml-timeouts",
  "yaml-models",
  "yaml-cost-rates",
  "yaml-sampling-rate",
  "yaml-cooldown",
  "yaml-flags",
  "yaml-triage-mode",
  "scorers-parse",
  "scorers-labels",
  "scorers-sampling-rate",
  "scorers-model",
  "scorers-agents",
  "scorers-passing-score",
  "skills-frontmatter",
  "skills-body",
  "skills-size",
  "runners-parse",
  "runners-isolation",
  "runners-setup-commands",
  "runners-shape",
  "runners-docker-image",
  "benchmarks-parse",
  "benchmarks-task-schema",
  "proposals-writable",
  "automations-schema",
  "automations-triggers-cap",
  "automations-schedule-xor",
  "automations-prompt-ref",
  "integrations-schema",
  "integrations-mode",
  "integrations-provider",
  "integrations-secret",
  "integrations-live-ref",
  "integrations-live-secret",
  "integrations-live-filter",
  "integrations-live-schema",
  "decisions-proposal-link",
  "decisions-benchmark-record",
  "validate-crashed",
];

// ── Vocabularios cerrados existentes (no inventados) ──

/**
 * Tools conocidas: las 7 que usan los agents reales (implement las 7 con
 * escritura, review/triage/spec las 4 de lectura+web, foreman `{}` = ninguna).
 * Fuente: factory/agents/<name>/agent.md + tests/agent-definitions.test.ts
 * ("tools espejan los contratos actuales por agente"). No hay export previo
 * que reutilizar: se declara acá con su fuente citada.
 */
import { AGENT_TOOL_KEYS } from "../runner/toolPolicy";

/** Vocabulario de tools (fuente única: runner/toolPolicy; re-export por compat). */
export const KNOWN_AGENT_TOOLS: readonly string[] = AGENT_TOOL_KEYS;

/** Valor especial de modelo solo válido para REVIEW (res lo resuelve reviewModelSelector). */
const AUTO_DISJOINT = "auto-disjoint";

/** Nombre del dir de proposals bajo factory/ (espejo de PROPOSALS_DIR en improvementEngine). */
const PROPOSALS_DIR_NAME = ".proposals";

/** Tope de archivos .json de benchmarks a validar (cota Regla 7; hoy hay 1). */
const BENCHMARKS_MAX_FILES = 50;

// ── Resolución de factoryDir (sin hardcodeos) ──

function getRepoRoot(): string {
  try {
    const current = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(current), "../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {
    // sigue a fallback por cwd
  }
  try {
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, "package.json")) &&
      fs.existsSync(path.join(cwd, "factory"))
    )
      return cwd;
    const parent = path.resolve(cwd, "..");
    if (
      fs.existsSync(path.join(parent, "package.json")) &&
      fs.existsSync(path.join(parent, "factory"))
    )
      return parent;
  } catch {
    // sigue a cwd directo
  }
  return process.cwd();
}

/** Resuelve el dir factory: opts > TERMCANVAS_FACTORY_DIR (tests) > repo/factory. Nunca lanza. */
function resolveFactoryDir(factoryDir?: unknown): string {
  try {
    if (typeof factoryDir === "string" && factoryDir.trim().length > 0) {
      return path.resolve(factoryDir.trim());
    }
  } catch {
    // sigue a env/repo
  }
  try {
    const env = process.env.TERMCANVAS_FACTORY_DIR;
    if (typeof env === "string" && env.trim().length > 0) {
      return path.resolve(env.trim());
    }
  } catch {
    // sigue a repo
  }
  try {
    return path.join(getRepoRoot(), "factory");
  } catch {
    return path.join(process.cwd(), "factory");
  }
}

/** Ruta estable `factory/...` con slashes (igual en repo real y en fixtures tmp). Nunca lanza. */
function relFile(factoryDir: string, absPath: string): string {
  try {
    const rel = path.relative(
      path.dirname(path.resolve(factoryDir)),
      path.resolve(absPath),
    );
    if (rel && !rel.startsWith("..")) return rel.split(path.sep).join("/");
  } catch {
    // sigue a basename
  }
  try {
    return path.basename(String(absPath));
  } catch {
    return "factory/";
  }
}

/**
 * Línea aproximada honesta (1-based) de la primera línea que menciona la key
 * (`key:`, `"key"` o la key a secas). undefined si no se halla. Nunca lanza.
 */
function findLine(text: unknown, key: unknown): number | undefined {
  try {
    if (typeof text !== "string" || typeof key !== "string" || key.length === 0) {
      return undefined;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (
        t.startsWith(`${key}:`) ||
        t.startsWith(`"${key}"`) ||
        t.startsWith(`'${key}'`)
      ) {
        return i + 1;
      }
    }
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(key)) return i + 1;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "");
}

/** Lee dir ordenado (determinismo para badge/tests). Null si ilegible. Nunca lanza. */
function readDirSorted(absDir: string): string[] | null {
  try {
    return fs.readdirSync(absDir).slice().sort();
  } catch {
    return null;
  }
}

// ── a) agents ──

/**
 * Normaliza listas nominales del frontmatter (`skills`, `mcps`): array,
 * record-keys o string plano `{a, b}`. Pura, nunca lanza.
 */
function agentNameList(raw: unknown): string[] {
  try {
    if (Array.isArray(raw)) {
      return (raw as unknown[]).map((v) => String(v ?? "").trim()).filter(Boolean);
    }
    if (raw && typeof raw === "object") {
      return Object.keys(raw as Record<string, unknown>).map((k) => k.trim()).filter(Boolean);
    }
    if (typeof raw === "string") {
      return raw
        .trim()
        .replace(/^\{/, "")
        .replace(/\}$/, "")
        .split(",")
        .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
        .filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

const MCP_BUNDLE_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/i;

function checkAgents(factoryDir: string, push: (i: DefinitionIssue) => void): void {
  const agentsDir = path.join(factoryDir, "agents");
  let foremanNames: string[] = [];
  try {
    const entries = readDirSorted(agentsDir);
    if (!entries) {
      push({
        file: relFile(factoryDir, agentsDir) + "/",
        rule: "agents-frontmatter",
        message: `no se pudo leer factory/agents/ (falta o ilegible): ningún agente válido, el loader cae a fallbacks invisibles`,
        severity: "error",
      });
    } else {
      for (const name of entries) {
        try {
          let stat: fs.Stats | null = null;
          try {
            stat = fs.statSync(path.join(agentsDir, name));
          } catch {
            stat = null;
          }
          if (!stat || !stat.isDirectory()) continue;
          const file = path.join(agentsDir, name, "agent.md");
          const rel = relFile(factoryDir, file);
          let text: string;
          try {
            text = fs.readFileSync(file, "utf-8");
          } catch {
            push({
              file: rel,
              rule: "agents-frontmatter",
              message: `${rel}: falta o ilegible (el loader devuelve null y el rol "${name}" opera con fallback invisible): restaurá el archivo`,
              severity: "error",
            });
            continue;
          }
          let parsed: { frontmatter: Record<string, unknown>; body: string };
          try {
            const p = parseAgentFile(text);
            parsed = {
              frontmatter: p.frontmatter as unknown as Record<string, unknown>,
              body: p.body,
            };
          } catch (e) {
            const msg = errMsg(e);
            const key = msg.includes("description")
              ? "description"
              : msg.includes("agentType")
                ? "agentType"
                : msg.includes("tools")
                  ? "tools"
                  : undefined;
            const issue: DefinitionIssue = {
              file: rel,
              rule: "agents-frontmatter",
              message: `${rel}: frontmatter inválido (${msg.slice(0, 160)}): el loader devuelve null para este rol`,
              severity: "error",
            };
            const line = key ? findLine(text, key) : undefined;
            if (line !== undefined) issue.line = line;
            push(issue);
            continue;
          }
          const agentType = String(parsed.frontmatter.agentType ?? "").toUpperCase();
          if (!(FACTORY_AGENT_ROLES as readonly string[]).includes(agentType)) {
            const issue: DefinitionIssue = {
              file: rel,
              rule: "agents-frontmatter",
              message: `${rel}: agentType inválido "${String(parsed.frontmatter.agentType ?? "").slice(0, 40)}" (vocabulario cerrado: ${(FACTORY_AGENT_ROLES as readonly string[]).join("|")})`,
              severity: "error",
            };
            const line = findLine(text, "agentType");
            if (line !== undefined) issue.line = line;
            push(issue);
            continue;
          }
          if (agentType === "FOREMAN") foremanNames.push(name);
          // tools conocidas (array o record-keys; {} vacío = foreman sin tools: válido).
          try {
            const rawTools = parsed.frontmatter.tools as unknown;
            const list: string[] = Array.isArray(rawTools)
              ? (rawTools as unknown[]).map((t) => String(t ?? ""))
              : rawTools && typeof rawTools === "object"
                ? Object.keys(rawTools as Record<string, unknown>)
                : [];
            const unknown = list.filter(
              (t) => !(KNOWN_AGENT_TOOLS as readonly string[]).includes(t.trim()),
            );
            if (unknown.length > 0) {
              const issue: DefinitionIssue = {
                file: rel,
                rule: "agents-tools",
                message: `${rel}: tools desconocidas [${unknown.map((t) => `"${t.slice(0, 40)}"`).join(", ")}] (conocidas: ${KNOWN_AGENT_TOOLS.join("|")}): corregí el frontmatter, el agente no puede usar tools que no existen`,
                severity: "error",
              };
              const line = findLine(text, "tools");
              if (line !== undefined) issue.line = line;
              push(issue);
            }
          } catch (e) {
            push({
              file: rel,
              rule: "agents-tools",
              message: `${rel}: no se pudo verificar tools (${errMsg(e).slice(0, 120)})`,
              severity: "error",
            });
          }
          // stage: ausente = none (sin hook). Presente pero fuera del
          // vocabulario = error (el corredor de hooks lo ignoraría en
          // silencio y el agente nunca correría: fail-closed con file:line).
          try {
            const rawStage = parsed.frontmatter.stage as unknown;
            if (rawStage !== undefined && rawStage !== null && String(rawStage).trim() !== "") {
              if (!isAgentStage(rawStage)) {
                const issue: DefinitionIssue = {
                  file: rel,
                  rule: "agents-stage",
                  message: `${rel}: stage inválido "${String(rawStage).slice(0, 40)}" (vocabulario: ${AGENT_STAGES.join("|")}): el hook no correría nunca`,
                  severity: "error",
                };
                const line = findLine(text, "stage");
                if (line !== undefined) issue.line = line;
                push(issue);
              }
            }
          } catch (e) {
            push({
              file: rel,
              rule: "agents-stage",
              message: `${rel}: no se pudo verificar stage (${errMsg(e).slice(0, 120)})`,
              severity: "error",
            });
          }
          // blocking: ausente = advisory (false). Presente pero no
          // true/false = error (ambiguo = el agente no sabe si frena).
          try {
            const rawBlocking = parsed.frontmatter.blocking as unknown;
            if (rawBlocking !== undefined && rawBlocking !== null && String(rawBlocking).trim() !== "") {
              const t = String(rawBlocking).trim().toLowerCase();
              if (rawBlocking !== true && rawBlocking !== false && t !== "true" && t !== "false") {
                const issue: DefinitionIssue = {
                  file: rel,
                  rule: "agents-blocking",
                  message: `${rel}: blocking inválido "${String(rawBlocking).slice(0, 40)}" (true = frena el pipeline, false = advisory): usá true o false`,
                  severity: "error",
                };
                const line = findLine(text, "blocking");
                if (line !== undefined) issue.line = line;
                push(issue);
              }
            }
          } catch (e) {
            push({
              file: rel,
              rule: "agents-blocking",
              message: `${rel}: no se pudo verificar blocking (${errMsg(e).slice(0, 120)})`,
              severity: "error",
            });
          }
          // skills: cada nombre debe existir en factory/skills/<name>/SKILL.md.
          // Un nombre inexistente deja la allowlist del agente apuntando al
          // vacío (la skill no se puede cargar): error con file:line.
          try {
            const names = agentNameList(parsed.frontmatter.skills);
            const missing = names.filter(
              (skillName) =>
                !/^[a-z0-9-]+$/i.test(skillName) ||
                !fs.existsSync(path.join(factoryDir, "skills", skillName, "SKILL.md")),
            );
            if (missing.length > 0) {
              const issue: DefinitionIssue = {
                file: rel,
                rule: "agents-skills",
                message: `${rel}: skills inexistentes [${missing.map((s) => `"${s.slice(0, 40)}"`).join(", ")}] (el agente no las podrá cargar): creá factory/skills/<name>/SKILL.md o quitálas del frontmatter`,
                severity: "error",
              };
              const line = findLine(text, "skills");
              if (line !== undefined) issue.line = line;
              push(issue);
            }
          } catch (e) {
            push({
              file: rel,
              rule: "agents-skills",
              message: `${rel}: no se pudo verificar skills (${errMsg(e).slice(0, 120)})`,
              severity: "error",
            });
          }
          // mcps: cada nombre debe existir en factory/mcps/<name>.json (el
          // engine resuelve los bundles al correr el nodo; un nombre roto
          // falla el nodo en runtime): error con file:line.
          try {
            const names = agentNameList(parsed.frontmatter.mcps);
            const invalid = names.filter((n) => !MCP_BUNDLE_NAME_REGEX.test(n));
            const missing = names.filter(
              (n) => MCP_BUNDLE_NAME_REGEX.test(n) && !fs.existsSync(path.join(factoryDir, "mcps", `${n}.json`)),
            );
            if (invalid.length > 0 || missing.length > 0) {
              const detail = [
                ...invalid.map((s) => `"${s.slice(0, 40)}" (nombre inválido)`),
                ...missing.map((s) => `"${s.slice(0, 40)}" (falta factory/mcps/${s}.json)`),
              ].join(", ");
              const issue: DefinitionIssue = {
                file: rel,
                rule: "agents-mcps",
                message: `${rel}: mcps inválidos [${detail}]: un bundle faltante falla el nodo en runtime, corregí el frontmatter o creá el archivo`,
                severity: "error",
              };
              const line = findLine(text, "mcps");
              if (line !== undefined) issue.line = line;
              push(issue);
            }
          } catch (e) {
            push({
              file: rel,
              rule: "agents-mcps",
              message: `${rel}: no se pudo verificar mcps (${errMsg(e).slice(0, 120)})`,
              severity: "error",
            });
          }
          // model: ausente o con forma rara = warn (hay default en factory.yaml).
          try {
            const model = typeof parsed.frontmatter.model === "string"
              ? parsed.frontmatter.model.trim()
              : "";
            if (!model) {
              push({
                file: rel,
                rule: "agents-model-shape",
                message: `${rel}: sin model (usa el default de factory.yaml): agregá \`model: provider/model\` para hacerlo explícito`,
                severity: "warn",
              });
            } else if (model === AUTO_DISJOINT && agentType !== "REVIEW") {
              const issue: DefinitionIssue = {
                file: rel,
                rule: "agents-model-shape",
                message: `${rel}: model "${AUTO_DISJOINT}" solo vale para REVIEW (lo resuelve reviewModelSelector): usá \`provider/model\``,
                severity: "warn",
              };
              const line = findLine(text, "model");
              if (line !== undefined) issue.line = line;
              push(issue);
            } else if (model !== AUTO_DISJOINT && !parseModelRef(model)) {
              const issue: DefinitionIssue = {
                file: rel,
                rule: "agents-model-shape",
                message: `${rel}: model "${model.slice(0, 60)}" sin forma provider/model (el orquestador cae al default): corregilo a \`provider/model\``,
                severity: "warn",
              };
              const line = findLine(text, "model");
              if (line !== undefined) issue.line = line;
              push(issue);
            }
          } catch (e) {
            push({
              file: rel,
              rule: "agents-model-shape",
              message: `${rel}: no se pudo verificar model (${errMsg(e).slice(0, 120)})`,
              severity: "warn",
            });
          }
        } catch (e) {
          try {
            push({
              file: relFile(factoryDir, path.join(agentsDir, name, "agent.md")),
              rule: "agents-frontmatter",
              message: `fallo interno validando el agente "${name}": ${errMsg(e).slice(0, 120)}`,
              severity: "error",
            });
          } catch {
            // último recurso: ni el push con nombre funciona
          }
        }
      }
    }
  } catch (e) {
    push({
      file: "factory/agents/",
      rule: "agents-frontmatter",
      message: `fallo interno listando agents (${errMsg(e).slice(0, 120)})`,
      severity: "error",
    });
  }
  try {
    if (foremanNames.length !== 1) {
      const detail = foremanNames.length === 0
        ? "cero encontrados"
        : `${foremanNames.length} encontrados: ${foremanNames.join(", ")}`;
      push({
        file: "factory/agents/",
        rule: "agents-exactly-one-foreman",
        message: `se requiere EXACTAMENTE 1 agente FOREMAN (${detail}): el enrutador no puede operar sin foreman único`,
        severity: "error",
      });
    }
  } catch (e) {
    push({
      file: "factory/agents/",
      rule: "agents-exactly-one-foreman",
      message: `no se pudo contar FOREMAN (${errMsg(e).slice(0, 120)})`,
      severity: "error",
    });
  }
}

// ── b) yaml (parse autoritativo del loader + pinpointers de la causa) ──

/** Extrae el token crudo tras `key:` (primera ocurrencia, sin comentarios `#`). */
function rawScalarToken(text: string, key: string): string | undefined {
  try {
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.startsWith("#") || !t.startsWith(`${key}:`)) continue;
      let v = t.slice(key.length + 1).trim();
      const hash = v.search(/\s+#/);
      if (hash >= 0) v = v.slice(0, hash).trim();
      if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
        (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
        v = v.slice(1, -1);
      }
      return v;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isIntIn(v: string | undefined, min: number, max: number): boolean {
  if (v === undefined) return false;
  if (!/^-?\d+$/.test(v.trim())) return false;
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= min && n <= max;
}

// ── b2) costRates shape (F4 money track, PLAN-100 PARIDAD §3.3) ──
//
// Single vocabulary (C6): the rate shape lives HERE as `CostRateSchema`
// (zod 4 + superRefine, strict) and `costTracker` mirrors it structurally
// without importing zod (the tracker stays dependency-light). `costRates:
// {}` (no tariffs) is VALID: without a rate there is no USD, never `USD
// 0.00` as data. Every issue carries {file, line?, rule, message,
// severity error} and nothing here ever throws.

export const CostRateSchema = z
  .object({
    inputUSDper1M: z.number(),
    outputUSDper1M: z.number(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fields = ["inputUSDper1M", "outputUSDper1M"] as const;
    for (const field of fields) {
      try {
        const n: unknown = (v as Record<string, unknown>)[field];
        if (typeof n !== "number" || !Number.isFinite(n)) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} must be a finite number (USD per 1M tokens, no NaN/Infinity)`,
          });
        } else if (n < 0) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} must be >= 0 (absent rate = no tariff, never negative)`,
          });
        }
      } catch {
        // one unreadable field never aborts the rest
      }
    }
  });

/**
 * Validates ONE `costRates."name"` entry against `CostRateSchema`. Pure
 * (no disk): `text`/`file` only locate the issue (honest file:line via the
 * offending field, then the rate name, then `costRates`). Absent text
 * means honestly no line. Never throws.
 */
export function validateCostRateEntry(
  rateName: unknown,
  raw: unknown,
  text?: unknown,
  file?: unknown,
): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  try {
    const label =
      typeof file === "string" && file.length > 0 ? file : "factory/factory.yaml";
    const name = typeof rateName === "string" ? rateName : "";
    const parsed = CostRateSchema.safeParse(raw);
    if (parsed.success) return issues;
    const first = parsed.error.issues.at(0);
    const field =
      first && Array.isArray(first.path) && first.path.length > 0
        ? String(first.path[0])
        : undefined;
    const item: DefinitionIssue = {
      file: label,
      rule: "yaml-cost-rates",
      message: `${label}: costRates.${name ? `"${name.slice(0, 80)}"` : "<unnamed>"} invalid (${String(first?.message ?? "invalid rate").slice(0, 180)}): each rate needs {inputUSDper1M, outputUSDper1M} as numbers >= 0 (no tariff = absent key, never USD 0.00 as data)`,
      severity: "error",
    };
    if (typeof text === "string") {
      const line = issueLine(text, [field, name || undefined, "costRates"]);
      if (line !== undefined) item.line = line;
    }
    issues.push(item);
    return issues;
  } catch {
    return issues;
  }
}

function checkYaml(factoryDir: string, push: (i: DefinitionIssue) => void): void {
  const file = path.join(factoryDir, "factory.yaml");
  const rel = relFile(factoryDir, file);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    push({
      file: rel,
      rule: "yaml-parse",
      message: `${rel}: falta o ilegible (el loader usa defaults en código: la definition está incompleta y el fallback es invisible sin este validador)`,
      severity: "error",
    });
    return;
  }
  let parseErr: unknown = null;
  let cfg: ReturnType<typeof parseFactoryYaml> | null = null;
  try {
    cfg = parseFactoryYaml(text);
  } catch (e) {
    parseErr = e;
  }
  // Parse OK: asserts semánticos sobre el objeto (defensa anti-drift; normalmente pasan).
  if (!parseErr && cfg) {
    try {
      const p = cfg.ports;
      if (![p.factoryDefault, p.factoryMax].every((n) => Number.isInteger(n) && n >= 1 && n <= 65535) || p.factoryDefault > p.factoryMax) {
        const issue: DefinitionIssue = {
          file: rel, rule: "yaml-ports",
          message: `${rel}: ports fuera de rango 1-65535 o default > max (default=${p.factoryDefault}, max=${p.factoryMax})`,
          severity: "error",
        };
        const line = findLine(text, "ports");
        if (line !== undefined) issue.line = line;
        push(issue);
      }
      const t = cfg.timeouts;
      const badTimeout = (["verifyMs"] as const).find(
        (k) => !(Number.isInteger(t[k]) && t[k] > 0),
      );
      if (badTimeout) {
        const issue: DefinitionIssue = {
          file: rel, rule: "yaml-timeouts",
          message: `${rel}: timeouts.${badTimeout} debe ser entero > 0 (es ${String(t[badTimeout])})`,
          severity: "error",
        };
        const line = findLine(text, badTimeout);
        if (line !== undefined) issue.line = line;
        push(issue);
      }
      const m = cfg.defaultModels;
      const badModel = (["foreman", "implement"] as const).find((k) => !parseModelRef(m[k]));
      if (badModel) {
        const issue: DefinitionIssue = {
          file: rel, rule: "yaml-models",
          message: `${rel}: defaultModels.${badModel}="${String(m[badModel]).slice(0, 60)}" sin forma provider/model`,
          severity: "error",
        };
        const line = findLine(text, badModel);
        if (line !== undefined) issue.line = line;
        push(issue);
      }
      if (m.review !== AUTO_DISJOINT && !parseModelRef(m.review)) {
        const issue: DefinitionIssue = {
          file: rel, rule: "yaml-models",
          message: `${rel}: defaultModels.review="${String(m.review).slice(0, 60)}" sin forma provider/model (solo vale "${AUTO_DISJOINT}")`,
          severity: "error",
        };
        const line = findLine(text, "review");
        if (line !== undefined) issue.line = line;
        push(issue);
      }
      for (const [rateName, rawRate] of Object.entries(cfg.costRates)) {
        try {
          validateCostRateEntry(rateName, rawRate, text, rel).forEach((i) => push(i));
        } catch {
          // one bad entry never aborts the rest
        }
      }
      // FU-4 (aditivo, defensa anti-drift): el parser ya enforcea el formato
      // de ratesAsOf/ratesSource; si algo pasa igual, grita con file:line
      // bajo la regla existente `yaml-cost-rates` (sin rule id nuevo).
      // Ausentes (null = yaml viejo) = válido, sin issues.
      try {
        const asOf: unknown = (cfg as unknown as Record<string, unknown>).ratesAsOf ?? null;
        if (asOf !== null && asOf !== undefined) {
          const ok = typeof asOf === "string" &&
            /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(asOf);
          if (!ok) {
            const issue: DefinitionIssue = {
              file: rel, rule: "yaml-cost-rates",
              message: `${rel}: ratesAsOf="${String(asOf).slice(0, 30)}" debe ser fecha YYYY-MM-DD (sello de vigencia de las tarifas, visible en el badge)`,
              severity: "error",
            };
            const line = findLine(text, "ratesAsOf");
            if (line !== undefined) issue.line = line;
            push(issue);
          }
        }
        const src: unknown = (cfg as unknown as Record<string, unknown>).ratesSource ?? null;
        if (src !== null && src !== undefined) {
          const ok = typeof src === "string" &&
            (src.startsWith("https://") || src.startsWith("http://"));
          if (!ok) {
            const issue: DefinitionIssue = {
              file: rel, rule: "yaml-cost-rates",
              message: `${rel}: ratesSource="${String(src).slice(0, 60)}" debe ser URL http(s) (fuente documentada de las tarifas, nunca fetcheada)`,
              severity: "error",
            };
            const line = findLine(text, "ratesSource");
            if (line !== undefined) issue.line = line;
            push(issue);
          }
        }
      } catch {
        // un sello ilegible nunca aborta el resto del yaml
      }
      if (!(Number.isInteger(cfg.scorers.samplingRate) && cfg.scorers.samplingRate >= 0 && cfg.scorers.samplingRate <= 100)) {
        const issue: DefinitionIssue = {
          file: rel, rule: "yaml-sampling-rate",
          message: `${rel}: scorers.samplingRate debe estar en 0-100 (es ${String(cfg.scorers.samplingRate)}; 0 = apagado)`,
          severity: "error",
        };
        const line = findLine(text, "samplingRate");
        if (line !== undefined) issue.line = line;
        push(issue);
      }
      if (!(Number.isInteger(cfg.improveProposalCooldown) && cfg.improveProposalCooldown >= 0)) {
        const issue: DefinitionIssue = {
          file: rel, rule: "yaml-cooldown",
          message: `${rel}: improveProposalCooldown debe ser entero ≥ 0 (es ${String(cfg.improveProposalCooldown)}; 0 = auto-propose apagado)`,
          severity: "error",
        };
        const line = findLine(text, "improveProposalCooldown");
        if (line !== undefined) issue.line = line;
        push(issue);
      }
      const flags = [
        ["costTracking", cfg.costTracking],
        ["agentSessions", cfg.agentSessions],
        ["reviewerReverify", cfg.reviewerReverify],
        ["notificationsEnabled", cfg.notificationsEnabled],
        ["osNotifications", cfg.osNotifications],
      ] as const;
      const badFlag = flags.find(([, v]) => typeof v !== "boolean");
      if (badFlag) {
        const issue: DefinitionIssue = {
          file: rel, rule: "yaml-flags",
          message: `${rel}: ${badFlag[0]} debe ser booleano true|false (es ${String(badFlag[1]).slice(0, 20)})`,
          severity: "error",
        };
        const line = findLine(text, badFlag[0]);
        if (line !== undefined) issue.line = line;
        push(issue);
      }
      const triageMode = (cfg as unknown as { triageMode?: unknown }).triageMode;
      if (triageMode !== "auto" && triageMode !== "always" && triageMode !== "never") {
        const issue: DefinitionIssue = {
          file: rel, rule: "yaml-triage-mode",
          message: `${rel}: triageMode debe ser auto, always o never (es ${String(triageMode).slice(0, 20)})`,
          severity: "error",
        };
        const line = findLine(text, "triageMode");
        if (line !== undefined) issue.line = line;
        push(issue);
      }
    } catch (e) {
      push({ file: rel, rule: "yaml-parse", message: `${rel}: fallo interno verificando valores (${errMsg(e).slice(0, 120)})`, severity: "error" });
    }
    return;
  }
  // Parse FALLÓ: pinpointers sobre el texto crudo para decir QUÉ regla rompió.
  // Si ninguno pinpointea (estructura rota), cae al yaml-parse genérico con el
  // mensaje del loader. Así un puerto malo da yaml-ports (no ruido doble).
  let pinpointed = 0;
  const pin = (issue: DefinitionIssue): void => {
    pinpointed += 1;
    push(issue);
  };
  try {
    const dflt = rawScalarToken(text, "factoryDefault");
    const max = rawScalarToken(text, "factoryMax");
    if (dflt !== undefined || max !== undefined) {
      const ok = isIntIn(dflt, 1, 65535) && isIntIn(max, 1, 65535) && Number(dflt) <= Number(max);
      if (!ok) {
        const badKey = !isIntIn(dflt, 1, 65535) ? "factoryDefault" : !isIntIn(max, 1, 65535) ? "factoryMax" : "ports";
        const issue: DefinitionIssue = {
          file: rel, rule: "yaml-ports",
          message: `${rel}: ports inválidos (factoryDefault="${String(dflt ?? "?").slice(0, 20)}", factoryMax="${String(max ?? "?").slice(0, 20)}"): enteros 1-65535 con default ≤ max — el loader cae a 17680-17690 en código`,
          severity: "error",
        };
        const line = findLine(text, badKey);
        if (line !== undefined) issue.line = line;
        pin(issue);
      }
    }
  } catch { /* el yaml-parse genérico cubre */ }
  try {
    const keys = ["verifyMs"] as const;
    const bad = keys.find((k) => {
      const v = rawScalarToken(text, k);
      return v !== undefined && !(isIntIn(v, 1, Number.MAX_SAFE_INTEGER));
    });
    if (bad) {
      const issue: DefinitionIssue = {
        file: rel, rule: "yaml-timeouts",
        message: `${rel}: timeouts.${bad}="${String(rawScalarToken(text, bad) ?? "").slice(0, 20)}" debe ser entero > 0 (ms)`,
        severity: "error",
      };
      const line = findLine(text, bad);
      if (line !== undefined) issue.line = line;
      pin(issue);
    }
  } catch { /* genérico cubre */ }
  try {
    const keys = ["foreman", "implement", "review"] as const;
    const bad = keys.find((k) => {
      const v = rawScalarToken(text, k);
      if (v === undefined) return false;
      if (k === "review" && v === AUTO_DISJOINT) return false;
      return !parseModelRef(v);
    });
    if (bad) {
      const issue: DefinitionIssue = {
        file: rel, rule: "yaml-models",
        message: `${rel}: defaultModels.${bad}="${String(rawScalarToken(text, bad) ?? "").slice(0, 60)}" sin forma provider/model${bad === "review" ? ` (solo vale "${AUTO_DISJOINT}")` : ""}`,
        severity: "error",
      };
      const line = findLine(text, bad);
      if (line !== undefined) issue.line = line;
      pin(issue);
    }
  } catch { /* genérico cubre */ }
  try {
    let badRateKey: string | null = null;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.startsWith("#")) continue;
      const m = t.match(/^(inputUSDper1M|outputUSDper1M)\s*:\s*(\S+)/);
      if (m && !/^\d+(\.\d+)?$/.test(m[2])) {
        badRateKey = m[1];
        break;
      }
    }
    if (badRateKey) {
      const issue: DefinitionIssue = {
        file: rel, rule: "yaml-cost-rates",
        message: `${rel}: costRates.${badRateKey} debe ser número ≥ 0 (sin tarifa = ausente, nunca negativo)`,
        severity: "error",
      };
      const line = findLine(text, badRateKey);
      if (line !== undefined) issue.line = line;
      pin(issue);
    }
  } catch { /* genérico cubre */ }
  // FU-4 (aditivo): si el parse falló por el sello de vigencia/fuente,
  // pinpointea la regla en vez del yaml-parse genérico.
  try {
    const asOf = rawScalarToken(text, "ratesAsOf");
    if (asOf !== undefined && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(asOf)) {
      const issue: DefinitionIssue = {
        file: rel, rule: "yaml-cost-rates",
        message: `${rel}: ratesAsOf="${asOf.slice(0, 30)}" debe ser fecha YYYY-MM-DD (sello de vigencia de las tarifas)`,
        severity: "error",
      };
      const line = findLine(text, "ratesAsOf");
      if (line !== undefined) issue.line = line;
      pin(issue);
    }
    const src = rawScalarToken(text, "ratesSource");
    if (src !== undefined && !(src.startsWith("https://") || src.startsWith("http://"))) {
      const issue: DefinitionIssue = {
        file: rel, rule: "yaml-cost-rates",
        message: `${rel}: ratesSource="${src.slice(0, 60)}" debe ser URL http(s) (fuente documentada, nunca fetcheada)`,
        severity: "error",
      };
      const line = findLine(text, "ratesSource");
      if (line !== undefined) issue.line = line;
      pin(issue);
    }
  } catch { /* genérico cubre */ }
  try {
    const v = rawScalarToken(text, "samplingRate");
    if (v !== undefined && !isIntIn(v, 0, 100)) {
      const issue: DefinitionIssue = {
        file: rel, rule: "yaml-sampling-rate",
        message: `${rel}: scorers.samplingRate="${v.slice(0, 20)}" debe estar en 0-100 (0 = apagado)`,
        severity: "error",
      };
      const line = findLine(text, "samplingRate");
      if (line !== undefined) issue.line = line;
      pin(issue);
    }
  } catch { /* genérico cubre */ }
  try {
    const v = rawScalarToken(text, "improveProposalCooldown");
    if (v !== undefined && !isIntIn(v, 0, 100)) {
      const issue: DefinitionIssue = {
        file: rel, rule: "yaml-cooldown",
        message: `${rel}: improveProposalCooldown="${v.slice(0, 20)}" debe ser entero ≥ 0 (0 = auto-propose apagado)`,
        severity: "error",
      };
      const line = findLine(text, "improveProposalCooldown");
      if (line !== undefined) issue.line = line;
      pin(issue);
    }
  } catch { /* genérico cubre */ }
  try {
    const keys = ["costTracking", "agentSessions", "reviewerReverify", "notificationsEnabled", "osNotifications"] as const;
    const bad = keys.find((k) => {
      const v = rawScalarToken(text, k);
      return v !== undefined && v !== "true" && v !== "false";
    });
    if (bad) {
      const issue: DefinitionIssue = {
        file: rel, rule: "yaml-flags",
        message: `${rel}: ${bad}="${String(rawScalarToken(text, bad) ?? "").slice(0, 20)}" debe ser booleano true|false (son los interruptores de la Regla 8)`,
        severity: "error",
      };
      const line = findLine(text, bad);
      if (line !== undefined) issue.line = line;
      pin(issue);
    }
  } catch { /* genérico cubre */ }
  // T2 (aditivo): si el parse falló por triageMode, pinpointea la regla en
  // vez del yaml-parse genérico.
  try {
    const v = rawScalarToken(text, "triageMode");
    if (v !== undefined && v !== "auto" && v !== "always" && v !== "never") {
      const issue: DefinitionIssue = {
        file: rel, rule: "yaml-triage-mode",
        message: `${rel}: triageMode="${v.slice(0, 20)}" debe ser auto, always o never (auto = foreman primero, triage on-demand)`,
        severity: "error",
      };
      const line = findLine(text, "triageMode");
      if (line !== undefined) issue.line = line;
      pin(issue);
    }
  } catch { /* genérico cubre */ }
  if (pinpointed === 0) {
    push({
      file: rel,
      rule: "yaml-parse",
      message: `${rel}: no parsea (${errMsg(parseErr).slice(0, 200)}): el loader usa defaults en código y el fallback es invisible sin este validador`,
      severity: "error",
    });
  }
}

// ── c) scorers (espejo exacto del loader: parseScorerFile como fuente de verdad) ──

function classifyScorerError(msg: string): { rule: string; severity: DefinitionSeverity; key?: string } {
  const m = msg.toLowerCase();
  // "invariante" PRIMERO: el mensaje del invariante nombra passingScore
  // ("...ningún label con score < passingScore (0.5)") y si passingScore se
  // chequea antes, el invariante se clasifica mal.
  if (m.includes("invariante")) return { rule: "scorers-labels", severity: "error", key: "labels" };
  if (m.includes("samplingrate")) return { rule: "scorers-sampling-rate", severity: "error", key: "samplingRate" };
  if (m.includes("passingscore")) return { rule: "scorers-passing-score", severity: "error", key: "passingScore" };
  if (m.includes("agents")) return { rule: "scorers-agents", severity: "error", key: "agents" };
  // "array"/"too small" cubren el zod de `labels` (min 2) cuyo mensaje no
  // nombra la key ("Too small: expected array to have >=2 items"). Van
  // DESPUÉS de agents porque `agents` también es array pero su mensaje sí
  // nombra la key y ya se capturó arriba.
  if (m.includes("labels") || m.includes("invariante") || m.includes("label") || m.includes("array") || m.includes("too small")) {
    return { rule: "scorers-labels", severity: "error", key: "labels" };
  }
  if (m.includes("model")) return { rule: "scorers-model", severity: "warn", key: "model" };
  return { rule: "scorers-parse", severity: "error" };
}

/**
 * Pre-chequeos crudos de samplingRate/passingScore ANTES del parse autoritativo.
 * Por qué: el zod del loader rechaza fuera-de-rango con mensajes que no nombran
 * la key ("Too big: expected number to be <=100"), inclasificables. El pre-check
 * pinpointea la regla; si dispara, se saltea el parse de ese archivo (fail-fast:
 * corregí y re-validá). Nunca lanza.
 */
function precheckScorerScalars(
  text: string,
  rel: string,
  push: (i: DefinitionIssue) => void,
): boolean {
  try {
    let fired = false;
    const sr = rawScalarToken(text, "samplingRate");
    if (sr !== undefined && !isIntIn(sr, 0, 100)) {
      const issue: DefinitionIssue = {
        file: rel, rule: "scorers-sampling-rate",
        message: `${rel}: samplingRate="${sr.slice(0, 20)}" debe ser entero 0-100 (0 = apagado)`,
        severity: "error",
      };
      const line = findLine(text, "samplingRate");
      if (line !== undefined) issue.line = line;
      push(issue);
      fired = true;
    }
    const ps = rawScalarToken(text, "passingScore");
    if (ps !== undefined && !/^-?\d+(\.\d+)?$/.test(ps.trim())) {
      const issue: DefinitionIssue = {
        file: rel, rule: "scorers-passing-score",
        message: `${rel}: passingScore="${ps.slice(0, 20)}" no numérico (debe ser número finito 0-1)`,
        severity: "error",
      };
      const line = findLine(text, "passingScore");
      if (line !== undefined) issue.line = line;
      push(issue);
      fired = true;
    } else if (ps !== undefined) {
      const n = Number(ps.trim());
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        const issue: DefinitionIssue = {
          file: rel, rule: "scorers-passing-score",
          message: `${rel}: passingScore=${ps.slice(0, 20)} debe estar en 0-1`,
          severity: "error",
        };
        const line = findLine(text, "passingScore");
        if (line !== undefined) issue.line = line;
        push(issue);
        fired = true;
      }
    }
    return fired;
  } catch {
    return false;
  }
}

function checkScorers(factoryDir: string, push: (i: DefinitionIssue) => void): void {
  const dir = path.join(factoryDir, "scorers");
  try {
    const entries = readDirSorted(dir);
    if (!entries) {
      push({
        file: relFile(factoryDir, dir) + "/",
        rule: "scorers-parse",
        message: `no se pudo leer factory/scorers/ (falta o ilegible): el engine no tiene jueces y la medida queda vacía en silencio`,
        severity: "error",
      });
      return;
    }
    for (const name of entries) {
      try {
        let stat: fs.Stats | null = null;
        try {
          stat = fs.statSync(path.join(dir, name));
        } catch {
          stat = null;
        }
        if (!stat || !stat.isDirectory()) continue;
        const file = path.join(dir, name, "scorer.md");
        const rel = relFile(factoryDir, file);
        let size = 0;
        try {
          size = fs.statSync(file).size;
        } catch {
          push({
            file: rel,
            rule: "scorers-parse",
            message: `${rel}: falta o ilegible (el loader lo omite y el scorer "${name}" desaparece en silencio): restaurá el archivo`,
            severity: "error",
          });
          continue;
        }
        if (size > SCORER_MAX_FILE_BYTES) {
          push({
            file: rel,
            rule: "scorers-parse",
            message: `${rel}: ${size} bytes supera el cap del loader (${SCORER_MAX_FILE_BYTES}): el loader lo ignora en silencio — achicá el archivo`,
            severity: "error",
          });
          continue;
        }
        let text: string;
        try {
          text = fs.readFileSync(file, "utf-8");
        } catch {
          push({ file: rel, rule: "scorers-parse", message: `${rel}: ilegible al leer`, severity: "error" });
          continue;
        }
        // Pre-chequeos crudos (ver comentario): si disparan, fail-fast.
        try {
          if (precheckScorerScalars(text, rel, push)) continue;
        } catch {
          // sigue al parse autoritativo
        }
        try {
          const parsed = parseScorerFile(text, name);
          // Defensa anti-drift (el loader ya enforcea; si algo pasa igual, grita):
          const inv = getScorerInvariantErrors(parsed.definition);
          if (inv.length > 0) {
            const issue: DefinitionIssue = {
              file: rel, rule: "scorers-labels",
              message: `${rel}: invariante de labels roto (${inv.join("; ").slice(0, 160)}): se necesita ≥1 label con score >= passingScore y ≥1 con score < passingScore, si no el scorer no discrimina`,
              severity: "error",
            };
            const line = findLine(text, "labels");
            if (line !== undefined) issue.line = line;
            push(issue);
          }
          const sr = parsed.definition.samplingRate;
          if (!(Number.isInteger(sr) && sr >= 0 && sr <= 100)) {
            const issue: DefinitionIssue = {
              file: rel, rule: "scorers-sampling-rate",
              message: `${rel}: samplingRate=${String(sr)} debe estar en 0-100 (0 = apagado)`,
              severity: "error",
            };
            const line = findLine(text, "samplingRate");
            if (line !== undefined) issue.line = line;
            push(issue);
          }
          if (!parseModelRef(parsed.definition.model)) {
            const issue: DefinitionIssue = {
              file: rel, rule: "scorers-model",
              message: `${rel}: model="${String(parsed.definition.model).slice(0, 60)}" sin forma provider/model`,
              severity: "warn",
            };
            const line = findLine(text, "model");
            if (line !== undefined) issue.line = line;
            push(issue);
          }
          const badAgent = parsed.definition.agents.find(
            (a) => !(SCORER_AGENT_ROLES as readonly string[]).includes(a),
          );
          if (badAgent !== undefined) {
            const issue: DefinitionIssue = {
              file: rel, rule: "scorers-agents",
              message: `${rel}: agents con rol desconocido "${String(badAgent).slice(0, 40)}" (vocabulario cerrado: ${SCORER_AGENT_ROLES.join("|")})`,
              severity: "error",
            };
            const line = findLine(text, "agents");
            if (line !== undefined) issue.line = line;
            push(issue);
          }
          if (typeof parsed.definition.passingScore !== "number" || !Number.isFinite(parsed.definition.passingScore)) {
            const issue: DefinitionIssue = {
              file: rel, rule: "scorers-passing-score",
              message: `${rel}: passingScore no finito (${String(parsed.definition.passingScore).slice(0, 20)}): debe ser número 0-1`,
              severity: "error",
            };
            const line = findLine(text, "passingScore");
            if (line !== undefined) issue.line = line;
            push(issue);
          }
        } catch (e) {
          const msg = errMsg(e);
          const c = classifyScorerError(msg);
          const issue: DefinitionIssue = {
            file: rel,
            rule: c.rule,
            message: `${rel}: ${oneLine(msg, 200)}`,
            severity: c.severity,
          };
          if (c.key) {
            const line = findLine(text, c.key);
            if (line !== undefined) issue.line = line;
          }
          push(issue);
        }
      } catch (e) {
        try {
          push({
            file: relFile(factoryDir, path.join(dir, name, "scorer.md")),
            rule: "scorers-parse",
            message: `fallo interno validando el scorer "${name}": ${errMsg(e).slice(0, 120)}`,
            severity: "error",
          });
        } catch { /* noop */ }
      }
    }
  } catch (e) {
    push({
      file: "factory/scorers/",
      rule: "scorers-parse",
      message: `fallo interno listando scorers (${errMsg(e).slice(0, 120)})`,
      severity: "error",
    });
  }
}

// ── d) skills (cap real del loader: SKILL_MAX_BYTES = 8KB) ──

function checkSkills(factoryDir: string, push: (i: DefinitionIssue) => void): void {
  const dir = path.join(factoryDir, "skills");
  try {
    const entries = readDirSorted(dir);
    if (!entries) {
      push({
        file: relFile(factoryDir, dir) + "/",
        rule: "skills-frontmatter",
        message: `no se pudo leer factory/skills/ (falta o ilegible): las skills versionadas no se inyectan y el reviewer opera sin rúbrica en silencio`,
        severity: "error",
      });
      return;
    }
    for (const name of entries) {
      try {
        let stat: fs.Stats | null = null;
        try {
          stat = fs.statSync(path.join(dir, name));
        } catch {
          stat = null;
        }
        if (!stat || !stat.isDirectory()) continue;
        const file = path.join(dir, name, "SKILL.md");
        const rel = relFile(factoryDir, file);
        let text: string;
        try {
          text = fs.readFileSync(file, "utf-8");
        } catch {
          push({
            file: rel,
            rule: "skills-frontmatter",
            message: `${rel}: falta o ilegible (el loader la omite con nota y el reviewer pierde esa rúbrica): restaurá el archivo`,
            severity: "error",
          });
          continue;
        }
        try {
          const parsed = parseSkillFile(text);
          if (parsed.body.length > SKILL_MAX_BYTES) {
            push({
              file: rel,
              rule: "skills-size",
              message: `${rel}: cuerpo de ${parsed.body.length} bytes supera el cap del loader (${SKILL_MAX_BYTES} = 8KB): se inyecta truncado con nota — achicá la skill`,
              severity: "warn",
            });
          }
        } catch (e) {
          const msg = errMsg(e);
          if (msg.toLowerCase().includes("cuerpo vacío")) {
            push({
              file: rel,
              rule: "skills-body",
              message: `${rel}: cuerpo vacío tras el frontmatter (skill sin contenido: el loader la omite): escribí la rúbrica o borrá el directorio`,
              severity: "warn",
            });
          } else {
            const key = msg.includes("`name`") ? "name" : msg.includes("description") ? "description" : undefined;
            const issue: DefinitionIssue = {
              file: rel,
              rule: "skills-frontmatter",
              message: `${rel}: frontmatter inválido (${msg.slice(0, 160)}): el loader la omite`,
              severity: "error",
            };
            if (key) {
              const line = findLine(text, key);
              if (line !== undefined) issue.line = line;
            }
            push(issue);
          }
        }
      } catch (e) {
        try {
          push({
            file: relFile(factoryDir, path.join(dir, name, "SKILL.md")),
            rule: "skills-frontmatter",
            message: `fallo interno validando la skill "${name}": ${errMsg(e).slice(0, 120)}`,
            severity: "error",
          });
        } catch { /* noop */ }
      }
    }
  } catch (e) {
    push({
      file: "factory/skills/",
      rule: "skills-frontmatter",
      message: `fallo interno listando skills (${errMsg(e).slice(0, 120)})`,
      severity: "error",
    });
  }
}

// ── e) runners (espejo exacto del schema E1-Ola15 vía import, con regla por chequeo) ──

function classifyRunnerError(msg: string): { rule: string; key?: string } {
  const m = msg.toLowerCase();
  // "dockerimage" ANTES que "isolation": el mensaje de imagen faltante nombra
  // isolation ("...requerido cuando isolation es docker") y se clasificaría
  // mal. El `platform.os|arch` genuino (sin dockerImage) cae a runners-parse.
  if (m.includes("dockerimage")) return { rule: "runners-docker-image", key: "platform" };
  if (m.includes("isolation")) return { rule: "runners-isolation", key: "isolation" };
  if (m.includes("setupcommands")) return { rule: "runners-setup-commands", key: "setupCommands" };
  if (m.includes("vcpus") || m.includes("memorygb") || m.includes("instanceshape")) {
    return { rule: "runners-shape", key: "instanceShape" };
  }
  return { rule: "runners-parse" };
}

/** Colapsa un mensaje a una línea (los errores zod traen saltos que romperían el formato `file:line rule message`). */
function oneLine(s: unknown, max: number): string {
  try {
    return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  } catch {
    return "";
  }
}

function checkRunners(factoryDir: string, push: (i: DefinitionIssue) => void): void {
  const dir = path.join(factoryDir, "runners");
  try {
    const entries = readDirSorted(dir);
    if (!entries) {
      push({
        file: relFile(factoryDir, dir) + "/",
        rule: "runners-parse",
        message: `no se pudo leer factory/runners/ (falta o ilegible): la verificación cae a fallbacks en código sin que se vea`,
        severity: "error",
      });
      return;
    }
    for (const file of entries.filter((f) => f.endsWith(".yaml"))) {
      try {
        const name = file.slice(0, -".yaml".length);
        const abs = path.join(dir, file);
        const rel = relFile(factoryDir, abs);
        let text: string;
        try {
          text = fs.readFileSync(abs, "utf-8");
        } catch {
          push({ file: rel, rule: "runners-parse", message: `${rel}: ilegible al leer`, severity: "error" });
          continue;
        }
        try {
          parseRunnerDefinition(text, name);
        } catch (e) {
          const raw = e instanceof RunnerParseError ? e.message : errMsg(e);
          const msg = raw.replace(/^runner parse error:\s*/i, "");
          const c = classifyRunnerError(msg);
          const issue: DefinitionIssue = {
            file: rel,
            rule: c.rule,
            message: `${rel}: ${oneLine(msg, 200)} (schema E1-Ola15: isolation none|docker, setupCommands no vacía, vcpus>0, memoryGb>0, dockerImage solo si isolation es docker)`,
            severity: "error",
          };
          if (c.key) {
            const line = findLine(text, c.key);
            if (line !== undefined) issue.line = line;
          }
          push(issue);
        }
      } catch (e) {
        try {
          push({
            file: relFile(factoryDir, path.join(dir, file)),
            rule: "runners-parse",
            message: `fallo interno validando el runner "${file}": ${errMsg(e).slice(0, 120)}`,
            severity: "error",
          });
        } catch { /* noop */ }
      }
    }
  } catch (e) {
    push({
      file: "factory/runners/",
      rule: "runners-parse",
      message: `fallo interno listando runners (${errMsg(e).slice(0, 120)})`,
      severity: "error",
    });
  }
}

// ── f) benchmarks tasks (viven en factory/benchmarks/reference-tasks.json) ──

function checkBenchmarks(factoryDir: string, push: (i: DefinitionIssue) => void): void {
  const dir = path.join(factoryDir, "benchmarks");
  try {
    const entries = readDirSorted(dir);
    if (!entries) {
      push({
        file: relFile(factoryDir, dir) + "/",
        rule: "benchmarks-parse",
        message: `no se pudo leer factory/benchmarks/ (falta o ilegible): no hay tasks de referencia versionadas`,
        severity: "error",
      });
      return;
    }
    const jsons = entries.filter((f) => f.endsWith(".json")).slice(0, BENCHMARKS_MAX_FILES);
    if (jsons.length === 0) {
      push({
        file: relFile(factoryDir, dir) + "/",
        rule: "benchmarks-parse",
        message: `sin archivos .json en factory/benchmarks/ (se esperaba reference-tasks.json con {tasks: [...]})`,
        severity: "error",
      });
      return;
    }
    for (const file of jsons) {
      try {
        const abs = path.join(dir, file);
        const rel = relFile(factoryDir, abs);
        let text: string;
        try {
          text = fs.readFileSync(abs, "utf-8");
        } catch {
          push({ file: rel, rule: "benchmarks-parse", message: `${rel}: ilegible al leer`, severity: "error" });
          continue;
        }
        let data: unknown;
        try {
          data = JSON.parse(text) as unknown;
        } catch (e) {
          push({
            file: rel,
            rule: "benchmarks-parse",
            message: `${rel}: JSON inválido (${errMsg(e).slice(0, 140)}): las reference-tasks no se pueden cargar en el POST humano a /factory/benchmarks`,
            severity: "error",
          });
          continue;
        }
        const rec = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
        if (Array.isArray(rec.tasks)) {
          if (rec.tasks.length === 0) {
            push({ file: rel, rule: "benchmarks-parse", message: `${rel}: tasks vacío (se necesita ≥1 task de referencia)`, severity: "error" });
            continue;
          }
          const seen = new Set<string>();
          rec.tasks.forEach((t, i) => {
            try {
              const r = BenchmarkTaskSchema.safeParse(t);
              const tid = (t && typeof t === "object" ? String((t as Record<string, unknown>).id ?? `#${i}`) : `#${i}`).slice(0, 64);
              if (!r.success) {
                const first = r.error.issues[0];
                const where = first && first.path.length > 0 ? ` en "${String(first.path.join("."))}"` : "";
                const issue: DefinitionIssue = {
                  file: rel,
                  rule: "benchmarks-task-schema",
                  message: `${rel}: task[${i}] (id="${tid}") inválida${where} (${String(first?.message ?? r.error.message).slice(0, 160)}): no corre en benchmarks hasta arreglarla`,
                  severity: "error",
                };
                const line = findLine(text, tid.startsWith("#") ? "expectedVerdict" : tid);
                if (line !== undefined) issue.line = line;
                push(issue);
                return;
              }
              if (seen.has(r.data.id)) {
                const issue: DefinitionIssue = {
                  file: rel,
                  rule: "benchmarks-task-schema",
                  message: `${rel}: task duplicada "${r.data.id}": los ids de task deben ser únicos`,
                  severity: "error",
                };
                const line = findLine(text, r.data.id);
                if (line !== undefined) issue.line = line;
                push(issue);
                return;
              }
              seen.add(r.data.id);
            } catch (e) {
              push({ file: rel, rule: "benchmarks-task-schema", message: `${rel}: task[${i}] no verificable (${errMsg(e).slice(0, 120)})`, severity: "error" });
            }
          });
        } else {
          try {
            validateBenchmarkDefinition(data);
          } catch (e) {
            push({
              file: rel,
              rule: "benchmarks-task-schema",
              message: `${rel}: definition de benchmark inválida (${errMsg(e).slice(0, 200)})`,
              severity: "error",
            });
          }
        }
      } catch (e) {
        try {
          push({
            file: relFile(factoryDir, path.join(dir, file)),
            rule: "benchmarks-parse",
            message: `fallo interno validando "${file}": ${errMsg(e).slice(0, 120)}`,
            severity: "error",
          });
        } catch { /* noop */ }
      }
    }
  } catch (e) {
    push({
      file: "factory/benchmarks/",
      rule: "benchmarks-parse",
      message: `fallo interno listando benchmarks (${errMsg(e).slice(0, 120)})`,
      severity: "error",
    });
  }
}

// ── g) proposals dir escribible (best-effort, SIN escribir archivos reales) ──

function checkProposals(factoryDir: string, push: (i: DefinitionIssue) => void): void {
  const dir = path.join(factoryDir, PROPOSALS_DIR_NAME);
  const rel = relFile(factoryDir, dir) + "/";
  try {
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(dir);
    } catch {
      stat = null;
    }
    if (stat && stat.isDirectory()) {
      try {
        fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
      } catch {
        push({
          file: rel,
          rule: "proposals-writable",
          message: `${rel}: existe pero sin permiso de escritura (el auto-propose no puede persistir propuestas): revisá permisos`,
          severity: "warn",
        });
      }
      return;
    }
    if (stat && !stat.isDirectory()) {
      push({
        file: rel,
        rule: "proposals-writable",
        message: `${rel}: existe pero NO es un directorio (bloquea factory/.proposals/ del engine): mové ese archivo`,
        severity: "warn",
      });
      return;
    }
    // No existe: basta con que el padre sea escribible (el engine lo crea best-effort).
    try {
      fs.accessSync(factoryDir, fs.constants.W_OK | fs.constants.X_OK);
    } catch {
      push({
        file: rel,
        rule: "proposals-writable",
        message: `${rel}: no existe y factory/ no es escribible (el engine no podrá crearlo): revisá permisos`,
        severity: "warn",
      });
    }
  } catch (e) {
    push({
      file: rel,
      rule: "proposals-writable",
      message: `${rel}: no verificable (${errMsg(e).slice(0, 120)})`,
      severity: "warn",
    });
  }
}

// ── h) Wave 14 automations + integrations (shout with file:line) ──
//
// The new sections are validated against the T01 domain schemas (C6); the
// loaders keep serving fallbacks, so a broken section only reddens the
// badge (visible degradation, the daemon never dies for a bad definition).
// An ABSENT section is valid (old yaml files keep working on defaults).
// Shapes are intact: only new rules were added, every issue carries
// {file, line?, rule, message, severity} and nothing here ever throws.

/** Raw lines under a top-level `name:` block (header excluded). Never throws. */
function sliceYamlSection(text: string, name: string): string[] {
  try {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    let inside = false;
    const out: string[] = [];
    lines.forEach((line) => {
      try {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) {
          if (inside) out.push(line);
          return;
        }
        const indent = line.length - line.trimStart().length;
        if (indent === 0) {
          inside = trimmed === `${name}:`;
          return;
        }
        if (inside) out.push(line);
      } catch {
        // a weird line never aborts the slice
      }
    });
    return out;
  } catch {
    return [];
  }
}

/** Cuts an inline ` # comment` unless it sits inside quotes. Never throws. */
function stripSectionComment(s: string): string {
  try {
    let inSingle = false;
    let inDouble = false;
    let cut = -1;
    s.split("").forEach((ch, i) => {
      if (cut >= 0) return;
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "#" && !inSingle && !inDouble && i > 0 && /\s/.test(s[i - 1] ?? "")) cut = i;
    });
    const out = (cut >= 0 ? s.slice(0, cut) : s).trim();
    if (out.length >= 2) {
      const first = out[0];
      const last = out[out.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return out.slice(1, -1);
      }
    }
    return out;
  } catch {
    return "";
  }
}

/** Coerces a scalar token (`true|false|int|string`). Never throws. */
function coerceSectionScalar(raw: string): unknown {
  try {
    const v = stripSectionComment(raw);
    if (v === "true") return true;
    if (v === "false") return false;
    if (/^-?\d+$/.test(v)) return Number(v);
    return v;
  } catch {
    return raw;
  }
}

/**
 * Parses flat `key: value` scalars at indent 2. Lists or malformed lines
 * yield null (the caller reports `integrations-schema`). Never throws.
 */
function parseIntegrationsBlockObject(lines: string[]): Record<string, unknown> | null {
  try {
    const obj: Record<string, unknown> = {};
    let bad = false;
    lines.forEach((line) => {
      try {
        if (bad) return;
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) return;
        if (trimmed.startsWith("- ") || trimmed === "-") {
          bad = true;
          return;
        }
        if (line.length - line.trimStart().length !== 2) return;
        const idx = trimmed.indexOf(":");
        if (idx <= 0) {
          bad = true;
          return;
        }
        const key = trimmed.slice(0, idx).trim();
        if (!key) {
          bad = true;
          return;
        }
        obj[key] = coerceSectionScalar(trimmed.slice(idx + 1));
      } catch {
        bad = true;
      }
    });
    return bad ? null : obj;
  } catch {
    return null;
  }
}

interface AutomationsBlockParsed {
  top: Record<string, unknown>;
  triggers: Array<Record<string, unknown>>;
  malformed: boolean;
}

/**
 * Parses the `automations:` subset (flat top scalars plus one `triggers:`
 * list of flat maps). Tolerant on purpose: whatever does not fit the
 * subset fails the schema checks below with an actionable rule instead of
 * throwing. Never throws.
 */
function parseAutomationsBlockObject(lines: string[]): AutomationsBlockParsed {
  const out: AutomationsBlockParsed = { top: {}, triggers: [], malformed: false };
  try {
    let inTriggers = false;
    let current: Record<string, unknown> | null = null;
    let currentIndent = 0;
    const flush = (): void => {
      try {
        if (current !== null) out.triggers.push(current);
      } catch {
        // noop
      }
      current = null;
    };
    const putPair = (target: Record<string, unknown>, text: string): boolean => {
      try {
        const idx = text.indexOf(":");
        if (idx <= 0) return false;
        const key = text.slice(0, idx).trim();
        if (!key) return false;
        target[key] = coerceSectionScalar(text.slice(idx + 1));
        return true;
      } catch {
        return false;
      }
    };
    lines.forEach((line) => {
      try {
        if (out.malformed) return;
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) return;
        const indent = line.length - line.trimStart().length;
        if (indent === 2) {
          flush();
          if (trimmed === "triggers:") {
            inTriggers = true;
            return;
          }
          inTriggers = false;
          if (!putPair(out.top, trimmed)) out.malformed = true;
          return;
        }
        if (!inTriggers) return;
        if (trimmed.startsWith("- ") || trimmed === "-") {
          flush();
          current = {};
          currentIndent = indent;
          const rest = trimmed === "-" ? "" : trimmed.slice(2).trim();
          if (rest.length > 0 && !putPair(current, rest)) out.malformed = true;
          return;
        }
        if (current === null || indent <= currentIndent) {
          out.malformed = true;
          return;
        }
        if (!putPair(current, trimmed)) out.malformed = true;
      } catch {
        out.malformed = true;
      }
    });
    try {
      if (current !== null) out.triggers.push(current);
    } catch {
      // noop
    }
  } catch {
    out.malformed = true;
  }
  return out;
}

function issueLine(text: string, keys: Array<string | undefined>): number | undefined {
  try {
    for (const key of keys) {
      if (typeof key !== "string" || key.length === 0) continue;
      const line = findLine(text, key);
      if (line !== undefined) return line;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validates the `automations:` block of a full `factory.yaml` text. Pure
 * (no disk): `file` only labels the issues. Absent block means valid.
 * Never throws.
 */
export function validateAutomationsBlock(text: unknown, file?: unknown): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  try {
    const label =
      typeof file === "string" && file.length > 0 ? file : "factory/factory.yaml";
    if (typeof text !== "string" || text.length === 0) return issues;
    const full = text;
    const lines = sliceYamlSection(full, "automations");
    if (lines.length === 0) return issues;
    const push = (i: DefinitionIssue): void => {
      try {
        issues.push(i);
      } catch {
        // a push never fails
      }
    };
    const parsed = parseAutomationsBlockObject(lines);
    if (parsed.malformed) {
      const issue: DefinitionIssue = {
        file: label,
        rule: "automations-schema",
        message: `${label}: automations block is malformed (expected flat scalars plus a triggers list): fix the indentation`,
        severity: "error",
      };
      const line = issueLine(full, ["automations"]);
      if (line !== undefined) issue.line = line;
      push(issue);
      return issues;
    }
    if (parsed.triggers.length > AUTOMATIONS_MAX_TRIGGERS) {
      const issue: DefinitionIssue = {
        file: label,
        rule: "automations-triggers-cap",
        message: `${label}: automations.triggers has ${parsed.triggers.length} entries (cap ${AUTOMATIONS_MAX_TRIGGERS}): remove triggers until it fits`,
        severity: "error",
      };
      const line = issueLine(full, ["triggers", "automations"]);
      if (line !== undefined) issue.line = line;
      push(issue);
    }
    parsed.triggers.forEach((t) => {
      try {
        const r = TriggerSchema.safeParse(t);
        if (r.success) return;
        const tname = typeof t.name === "string" ? t.name : "";
        const line = issueLine(full, [tname, "triggers", "automations"]);
        r.error.issues.forEach((iss) => {
          try {
            const msg = String(iss.message ?? "invalid trigger");
            const ipath = Array.isArray(iss.path) ? iss.path.map((p) => String(p)) : [];
            let rule = "automations-schema";
            if (msg.includes("exactly one") || msg.includes("cron")) rule = "automations-schedule-xor";
            else if (ipath.includes("promptRef")) rule = "automations-prompt-ref";
            const item: DefinitionIssue = {
              file: label,
              rule,
              message: `${label}: trigger${tname ? ` "${tname.slice(0, 48)}"` : ""} invalid (${msg.slice(0, 160)})`,
              severity: "error",
            };
            if (line !== undefined) item.line = line;
            push(item);
          } catch {
            // one bad issue never aborts the rest
          }
        });
      } catch {
        // one bad trigger never aborts the rest
      }
    });
    try {
      const top = AutomationsSectionSchema.safeParse({ ...parsed.top, triggers: [] });
      if (!top.success) {
        top.error.issues.forEach((iss) => {
          try {
            const msg = String(iss.message ?? "invalid automations section");
            const ipath = Array.isArray(iss.path) ? iss.path.map((p) => String(p)) : [];
            const key = ipath.length > 0 ? ipath[0] : "automations";
            const line = issueLine(full, [key, "automations"]);
            const item: DefinitionIssue = {
              file: label,
              rule: "automations-schema",
              message: `${label}: automations.${key} invalid (${msg.slice(0, 160)})`,
              severity: "error",
            };
            if (line !== undefined) item.line = line;
            push(item);
          } catch {
            // noop
          }
        });
      }
    } catch {
      // top-level check is best-effort on top of per-trigger checks
    }
    return issues;
  } catch {
    return issues;
  }
}

/**
 * Validates the `integrations:` block of a full `factory.yaml` text. Pure
 * (no disk): `file` only labels the issues. Absent block means valid.
 * Never throws.
 */
export function validateIntegrationsBlock(text: unknown, file?: unknown): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  try {
    const label =
      typeof file === "string" && file.length > 0 ? file : "factory/factory.yaml";
    if (typeof text !== "string" || text.length === 0) return issues;
    const full = text;
    const lines = sliceYamlSection(full, "integrations");
    if (lines.length === 0) return issues;
    const push = (i: DefinitionIssue): void => {
      try {
        issues.push(i);
      } catch {
        // a push never fails
      }
    };
    const obj = parseIntegrationsBlockObject(lines);
    if (obj === null) {
      const issue: DefinitionIssue = {
        file: label,
        rule: "integrations-schema",
        message: `${label}: integrations block must be flat scalars (enabled/mode/provider): nested lists are not supported in P0`,
        severity: "error",
      };
      const line = issueLine(full, ["integrations"]);
      if (line !== undefined) issue.line = line;
      push(issue);
      return issues;
    }
    const r = IntegrationsSectionSchema.safeParse(obj);
    if (r.success) return issues;
    // Secret scan FIRST and explicitly: zod runs `strict()` before the
    // schema's own secret `superRefine`, so an unknown secret key alone
    // would only surface as a generic unrecognized key. The dedicated
    // `integrations-secret` rule must fire either way (fail-closed P0).
    const secretKeys = new Set<string>();
    try {
      Object.keys(obj).forEach((key) => {
        try {
          if (/token|secret|apikey|api_key|webhook|bearer|password/i.test(key)) {
            secretKeys.add(key);
            const line = issueLine(full, [key, "integrations"]);
            const item: DefinitionIssue = {
              file: label,
              rule: "integrations-secret",
              message: `${label}: integrations.${key} invalid (secret field "${key}" forbidden in P0 mock-local (no credentials exist))`,
              severity: "error",
            };
            if (line !== undefined) item.line = line;
            push(item);
          }
        } catch {
          // one bad key never aborts the scan
        }
      });
    } catch {
      // the schema parse below still reports
    }
    r.error.issues.forEach((iss) => {
      try {
        const msg = String(iss.message ?? "invalid integrations section");
        const ipath = Array.isArray(iss.path) ? iss.path.map((p) => String(p)) : [];
        let rule = "integrations-schema";
        if (ipath.includes("mode")) rule = "integrations-mode";
        else if (ipath.includes("provider")) rule = "integrations-provider";
        else if (msg.includes("forbidden")) rule = "integrations-secret";
        const key = ipath.length > 0 ? ipath[0] : "integrations";
        if (rule === "integrations-secret" && secretKeys.has(key)) return; // already reported above
        const line = issueLine(full, [key, "integrations"]);
        const item: DefinitionIssue = {
          file: label,
          rule,
          message: `${label}: integrations.${key} invalid (${msg.slice(0, 180)})`,
          severity: "error",
        };
        if (line !== undefined) item.line = line;
        push(item);
      } catch {
        // one bad issue never aborts the rest
      }
    });
    return issues;
  } catch {
    return issues;
  }
}

/**
 * Secret-looking yaml keys (mirror of the P0 scan in `validateIntegrationsBlock`
 * and of `LiveSectionSchema`: only `*Ref` env NAME fields may carry them).
 * Never matches `vaultRef` itself; `webhookSecretRef` is exempt below.
 */
const LIVE_SECRET_RE = /token|secret|apikey|api_key|webhook|bearer|password/i;

/**
 * Env NAME shape (mirror of `VAULT_REF_NAME_RE` in `integrations/vault.ts`;
 * the validator stays pure and never reads `process.env`, so the shape is
 * mirrored, not imported).
 */
const VAULT_ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validates the `live:` block of a full `factory.yaml` text (F1-T3 live rules,
 * PLAN-100 PARIDAD section 3.1). Pure (no disk, no env reads): `file` only
 * labels the issues. Absent block means valid (mock-local defaults, P0
 * behavior exactly as today). Never throws.
 *
 * Rules:
 * - `integrations-live-secret`: secret-looking value fields are forbidden in
 *   every mode (mock included) — only `vaultRef` / `webhookSecretRef` env
 *   NAME fields may exist; values never live in yaml.
 * - `integrations-live-ref`: `liveMode:true` requires a `vaultRef` env NAME
 *   (non-empty and shaped like an env identifier, never the secret value).
 * - `integrations-live-filter`: the yaml block is flat scalars only — a
 *   nested `filter:` belongs on the webhook-in trigger, not here (the
 *   service reader `getLiveConfig` is flat-only too, so this mirrors it).
 * - `integrations-live-schema`: any other malformed scalar (bad provider,
 *   non-boolean flags, malformed lines).
 * Every issue carries `{file, line?, rule, message, severity: error}`.
 */
export function validateLiveBlock(text: unknown, file?: unknown): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  try {
    const label =
      typeof file === "string" && file.length > 0 ? file : "factory/factory.yaml";
    if (typeof text !== "string" || text.length === 0) return issues;
    const full = text;
    const lines = sliceYamlSection(full, "live");
    if (lines.length === 0) return issues;
    const push = (i: DefinitionIssue): void => {
      try {
        issues.push(i);
      } catch {
        // a push never fails
      }
    };
    const scalars: Record<string, unknown> = {};
    let malformedScalar = false;
    let hasNested = false;
    lines.forEach((line) => {
      try {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) return;
        const indent = line.length - line.trimStart().length;
        if (indent === 2) {
          const idx = trimmed.indexOf(":");
          if (idx <= 0) {
            malformedScalar = true;
            return;
          }
          const key = trimmed.slice(0, idx).trim();
          if (!key) {
            malformedScalar = true;
            return;
          }
          if (!(key in scalars)) scalars[key] = coerceSectionScalar(trimmed.slice(idx + 1));
          return;
        }
        if (indent > 2) hasNested = true;
        else malformedScalar = true;
      } catch {
        // a weird line never aborts the scan
      }
    });
    // Secret scan FIRST and explicitly (fail-closed in every mode, mock too).
    const secretReported = new Set<string>();
    try {
      Object.keys(scalars).forEach((key) => {
        try {
          if (key !== "webhookSecretRef" && LIVE_SECRET_RE.test(key)) {
            secretReported.add(key);
            const line = issueLine(full, [key, "live"]);
            const item: DefinitionIssue = {
              file: label,
              rule: "integrations-live-secret",
              message: `${label}: live.${key} invalid (secret value forbidden in yaml: only vaultRef/webhookSecretRef env NAMEs may exist, never values)`,
              severity: "error",
            };
            if (line !== undefined) item.line = line;
            push(item);
          }
        } catch {
          // one bad key never aborts the scan
        }
      });
    } catch {
      // the schema parse below still reports
    }
    if (hasNested) {
      const line = issueLine(full, ["filter", "live"]);
      const item: DefinitionIssue = {
        file: label,
        rule: "integrations-live-filter",
        message: `${label}: live block is flat scalars only (liveMode/provider/vaultRef/webhookSecretRef/allowPostBack): intake filters ride the webhook-in trigger, not this block`,
        severity: "error",
      };
      if (line !== undefined) item.line = line;
      push(item);
      try {
        delete scalars.filter;
      } catch {
        // best-effort: the schema check below tolerates the leftover
      }
    }
    if (malformedScalar) {
      const line = issueLine(full, ["live"]);
      const item: DefinitionIssue = {
        file: label,
        rule: "integrations-live-schema",
        message: `${label}: live block has malformed lines (expected flat "key: value" scalars)`,
        severity: "error",
      };
      if (line !== undefined) item.line = line;
      push(item);
    }
    const parsed = LiveSectionSchema.safeParse(scalars);
    if (parsed.success) {
      try {
        if (parsed.data.liveMode === true && !VAULT_ENV_NAME_RE.test(parsed.data.vaultRef)) {
          const line = issueLine(full, ["vaultRef", "live"]);
          const item: DefinitionIssue = {
            file: label,
            rule: "integrations-live-ref",
            message: `${label}: live.vaultRef must be an env NAME ([A-Za-z_][A-Za-z0-9_]*), never the secret value (liveMode:true needs resolvable credentials)`,
            severity: "error",
          };
          if (line !== undefined) item.line = line;
          push(item);
        }
      } catch {
        // the ref check is best-effort on top of the schema verdict
      }
      return issues;
    }
    parsed.error.issues.forEach((iss) => {
      try {
        const msg = String(iss.message ?? "invalid live section");
        const ipath = Array.isArray(iss.path) ? iss.path.map((p) => String(p)) : [];
        // strict() catch-all (empty path, e.g. Unrecognized keys "a", "b"):
        // silent when every key it names already shouted live-secret above.
        if (ipath.length === 0 && secretReported.size > 0) {
          try {
            const named = msg.match(/"([^"]+)"/g) ?? [];
            if (
              named.length > 0 &&
              named.every((q) => secretReported.has(q.slice(1, -1)))
            ) {
              return;
            }
          } catch {
            // fall through to the regular report
          }
        }
        const key = ipath.length > 0 ? ipath[0] : "live";
        let rule = "integrations-live-schema";
        if (key === "vaultRef") rule = "integrations-live-ref";
        else if (key === "filter") rule = "integrations-live-filter";
        else if (LIVE_SECRET_RE.test(key) || msg.includes("forbidden")) rule = "integrations-live-secret";
        if (rule === "integrations-live-secret" && secretReported.has(key)) return; // already reported above
        const line = issueLine(full, [key, "live"]);
        const item: DefinitionIssue = {
          file: label,
          rule,
          message: `${label}: live.${key} invalid (${msg.slice(0, 180)})`,
          severity: "error",
        };
        if (line !== undefined) item.line = line;
        push(item);
      } catch {
        // one bad issue never aborts the rest
      }
    });
    return issues;
  } catch {
    return issues;
  }
}

function checkAutomationsIntegrations(factoryDir: string, push: (i: DefinitionIssue) => void): void {
  try {
    const file = path.join(factoryDir, "factory.yaml");
    const rel = relFile(factoryDir, file);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf-8");
    } catch {
      return; // checkYaml already reported the missing/unreadable file
    }
    try {
      validateAutomationsBlock(text, rel).forEach((i) => push(i));
    } catch {
      // per-block isolation: integrations still get checked
    }
    try {
      validateIntegrationsBlock(text, rel).forEach((i) => push(i));
    } catch {
      // per-block isolation: live still gets checked
    }
    try {
      validateLiveBlock(text, rel).forEach((i) => push(i));
    } catch {
      // noop
    }
  } catch {
    // this section never breaks the whole validation
  }
}

// ── i) F3 decision records (human-in-the-measure: benchmark decisions + proposal decide-link) ──
//
// Qué cubre (PLAN-100 PARIDAD §4.3; los engines se LEEN, nunca se tocan):
// - `decisions-benchmark-record`: cada sidecar
//   `factory/.benchmark-results/<run>.decision.json` debe satisfacer el schema
//   compartido (`parseBenchmarkDecision` de `./measure/decisionRecord`,
//   IMPORTADO: decidedBy exactamente "human", sin claves winner/auto), con
//   `benchmarkId` igual al run del nombre y `trialsRef` apuntando a ese run
//   (espejo del enlace que exige el engine `recordBenchmarkDecision`: sin ese
//   enlace la decisión no pondera trials reales).
// - `decisions-proposal-link`: cada `factory/.proposals/<id>.json` con status
//   adopted|discarded debe traer `decidedAt` no vacío (espejo del invariante de
//   `validateImprovementProposal` en shared/types/improvement.ts: toda decisión
//   humana queda fechada) y ninguna clave auto* en ningún estado (nunca auto).
// Ausencia (sin dir .proposals / sin sidecars) = válido: decidir es humano y
// opcional; el validador grita ante evidencia rota, nunca ante ausencia.
// Nunca lanza; toda issue lleva {file, line?, rule, message, severity error}.
// Iteración estructural acotada (for sobre listados finitos con tope).

/** Tope de archivos de decisión a escanear por dir (cota estructural; hoy hay 0-1). */
const DECISION_SCAN_MAX = 50;

/** Sufijo del sidecar de decisión humana junto a su run (espejo del engine). */
const BENCHMARK_DECISION_SUFFIX = ".decision.json";

/** Nombre del dir de resultados de benchmark bajo factory/ (espejo del engine). */
const BENCHMARK_RESULTS_DIR_NAME = ".benchmark-results";

/** Claves que delatan adopción automática (espejo de PROPOSAL_FORBIDDEN_KEYS del assert F3). */
const PROPOSAL_AUTO_KEYS: readonly string[] = ["autoAdopt", "autoApprove", "auto"];

/**
 * Valida el TEXTO de un sidecar de decisión de benchmark. Puro (sin disco):
 * `file` solo etiqueta las issues; `runId` es el id esperado (stem del nombre
 * del archivo). Nunca lanza.
 */
export function validateBenchmarkDecisionFile(
  text: unknown,
  file?: unknown,
  runId?: unknown,
): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  try {
    const label =
      typeof file === "string" && file.length > 0
        ? file
        : "factory/.benchmark-results/<run>.decision.json";
    const expected = typeof runId === "string" ? runId : "";
    if (typeof text !== "string" || text.length === 0) {
      issues.push({
        file: label,
        rule: "decisions-benchmark-record",
        message: `${label}: sidecar vacío o ilegible (se esperaba una BenchmarkDecision humana)`,
        severity: "error",
      });
      return issues;
    }
    let data: unknown = null;
    try {
      data = JSON.parse(text) as unknown;
    } catch (e) {
      issues.push({
        file: label,
        rule: "decisions-benchmark-record",
        message: `${label}: JSON inválido (${errMsg(e).slice(0, 140)}): la decisión humana no se puede leer`,
        severity: "error",
      });
      return issues;
    }
    const checked = parseBenchmarkDecision(data);
    if (!checked.ok) {
      const issue: DefinitionIssue = {
        file: label,
        rule: "decisions-benchmark-record",
        message: `${label}: decisión inválida (${checked.error.slice(0, 220)})`,
        severity: "error",
      };
      const line = issueLine(text, ["decidedBy", "benchmarkId", "trialsRef", "decidedAt", "change"]);
      if (line !== undefined) issue.line = line;
      issues.push(issue);
      return issues;
    }
    const decision = checked.data;
    if (expected.length > 0 && decision.benchmarkId !== expected) {
      const issue: DefinitionIssue = {
        file: label,
        rule: "decisions-benchmark-record",
        message: `${label}: benchmarkId "${decision.benchmarkId.slice(0, 60)}" no coincide con el run "${expected.slice(0, 60)}" (sidecar archivado en el run equivocado)`,
        severity: "error",
      };
      const line = issueLine(text, ["benchmarkId"]);
      if (line !== undefined) issue.line = line;
      issues.push(issue);
    }
    if (expected.length > 0 && !decision.trialsRef.includes(expected)) {
      const issue: DefinitionIssue = {
        file: label,
        rule: "decisions-benchmark-record",
        message: `${label}: trialsRef no referencia al run "${expected.slice(0, 60)}" (la decisión debe ponderar los trials de su run)`,
        severity: "error",
      };
      const line = issueLine(text, ["trialsRef"]);
      if (line !== undefined) issue.line = line;
      issues.push(issue);
    }
    return issues;
  } catch {
    return issues;
  }
}

/**
 * Valida el TEXTO de una propuesta persistida (enlace de decisión). Puro (sin
 * disco): `file` solo etiqueta las issues. Solo le conciernen TRES cosas: que
 * el JSON parsee, que adopted|discarded traiga decidedAt fechado, y que ningún
 * estado contrabandee claves auto*. El resto del shape es del engine, no de
 * esta regla. Nunca lanza.
 */
export function validateProposalDecisionFile(
  text: unknown,
  file?: unknown,
): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  try {
    const label =
      typeof file === "string" && file.length > 0 ? file : "factory/.proposals/<id>.json";
    if (typeof text !== "string" || text.length === 0) {
      issues.push({
        file: label,
        rule: "decisions-proposal-link",
        message: `${label}: propuesta vacía o ilegible (la decisión humana no se puede auditar)`,
        severity: "error",
      });
      return issues;
    }
    let data: unknown = null;
    try {
      data = JSON.parse(text) as unknown;
    } catch (e) {
      issues.push({
        file: label,
        rule: "decisions-proposal-link",
        message: `${label}: JSON inválido (${errMsg(e).slice(0, 140)}): la propuesta no se puede leer`,
        severity: "error",
      });
      return issues;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      issues.push({
        file: label,
        rule: "decisions-proposal-link",
        message: `${label}: la propuesta debe ser un objeto JSON (llegó ${Array.isArray(data) ? "array" : typeof data})`,
        severity: "error",
      });
      return issues;
    }
    const record = data as Record<string, unknown>;
    const smuggled: string[] = [];
    for (const key of PROPOSAL_AUTO_KEYS) {
      try {
        if (Object.prototype.hasOwnProperty.call(record, key)) smuggled.push(key);
      } catch {
        // una clave rara nunca aborta el resto
      }
    }
    if (smuggled.length > 0) {
      const issue: DefinitionIssue = {
        file: label,
        rule: "decisions-proposal-link",
        message: `${label}: claves prohibidas [${smuggled.map((k) => `"${k}"`).join(", ")}] (las propuestas solo se deciden por humano: adopt/discard explícitos, nunca auto)`,
        severity: "error",
      };
      const line = issueLine(text, smuggled);
      if (line !== undefined) issue.line = line;
      issues.push(issue);
    }
    const status = typeof record.status === "string" ? record.status : "";
    if (status === "adopted" || status === "discarded") {
      const decidedAt = typeof record.decidedAt === "string" ? record.decidedAt : "";
      if (decidedAt.trim().length === 0) {
        const issue: DefinitionIssue = {
          file: label,
          rule: "decisions-proposal-link",
          message: `${label}: status "${status}" sin decidedAt (toda decisión humana queda fechada: el adopt/discard debe estamparla)`,
          severity: "error",
        };
        const line = issueLine(text, ["decidedAt", "status"]);
        if (line !== undefined) issue.line = line;
        issues.push(issue);
      }
    }
    return issues;
  } catch {
    return issues;
  }
}

function checkDecisionRecords(factoryDir: string, push: (i: DefinitionIssue) => void): void {
  try {
    // Propuestas decididas: adopted|discarded ⇒ decidedAt; sin claves auto*.
    // Sin dir (o ilegible): checkProposals ya grita lo suyo; acá silencio.
    try {
      const dir = path.join(factoryDir, PROPOSALS_DIR_NAME);
      const entries = readDirSorted(dir);
      if (entries) {
        const files = entries.filter((f) => f.endsWith(".json")).slice(0, DECISION_SCAN_MAX);
        for (const name of files) {
          try {
            const abs = path.join(dir, name);
            const label = relFile(factoryDir, abs);
            let text: string;
            try {
              text = fs.readFileSync(abs, "utf-8");
            } catch {
              push({
                file: label,
                rule: "decisions-proposal-link",
                message: `${label}: ilegible al leer (la decisión humana no se puede auditar)`,
                severity: "error",
              });
              continue;
            }
            validateProposalDecisionFile(text, label).forEach((i) => push(i));
          } catch {
            // un archivo nunca aborta el resto
          }
        }
      }
    } catch {
      // aislamiento por bloque: los sidecars igual se revisan
    }
    // Sidecars de decisión de benchmark (<run>.decision.json; los runs
    // <run>.json se ignoran: decidir es opcional, solo lo roto grita).
    try {
      const dir = path.join(factoryDir, BENCHMARK_RESULTS_DIR_NAME);
      const entries = readDirSorted(dir);
      if (entries) {
        const files = entries
          .filter((f) => f.endsWith(BENCHMARK_DECISION_SUFFIX))
          .slice(0, DECISION_SCAN_MAX);
        for (const name of files) {
          try {
            const abs = path.join(dir, name);
            const label = relFile(factoryDir, abs);
            const runId = name.slice(0, -BENCHMARK_DECISION_SUFFIX.length);
            let text: string;
            try {
              text = fs.readFileSync(abs, "utf-8");
            } catch {
              push({
                file: label,
                rule: "decisions-benchmark-record",
                message: `${label}: ilegible al leer (la decisión humana no se puede auditar)`,
                severity: "error",
              });
              continue;
            }
            validateBenchmarkDecisionFile(text, label, runId).forEach((i) => push(i));
          } catch {
            // un archivo nunca aborta el resto
          }
        }
      }
    } catch {
      // noop: esta sección nunca rompe la validación completa
    }
  } catch {
    // esta sección nunca rompe la validación completa
  }
}

// ── Entradas (contrato inamovible) ──

/**
 * Valida toda la definition bajo `factoryDir`. NUNCA lanza: ante un fallo
 * catastrófico retorna 1 issue error `validate-crashed`.
 */
export function validateDefinition(opts?: { factoryDir?: string }): DefinitionIssue[] {
  try {
    const factoryDir = resolveFactoryDir(opts?.factoryDir);
    const issues: DefinitionIssue[] = [];
    const push = (i: DefinitionIssue): void => {
      try {
        if (i && typeof i === "object" && typeof i.rule === "string") issues.push(i);
      } catch {
        // ni el push falla
      }
    };
    const sections: Array<(d: string, p: (i: DefinitionIssue) => void) => void> = [
      checkAgents,
      checkYaml,
      checkScorers,
      checkSkills,
      checkRunners,
      checkBenchmarks,
      checkProposals,
      checkAutomationsIntegrations,
      checkDecisionRecords,
    ];
    for (const section of sections) {
      try {
        section(factoryDir, push);
      } catch (e) {
        try {
          push({
            file: "factory/",
            rule: "validate-crashed",
            message: `fallo interno en la sección ${section.name} (${errMsg(e).slice(0, 140)}): el resto se validó igual`,
            severity: "error",
          });
        } catch {
          // noop
        }
      }
    }
    return issues;
  } catch (e) {
    try {
      return [
        {
          file: "factory/",
          rule: "validate-crashed",
          message: `el validador no pudo correr (${errMsg(e).slice(0, 160)}): revisá que factory/ exista y sea legible`,
          severity: "error",
        },
      ];
    } catch {
      return [];
    }
  }
}

/** Estado de la definition: `valid` = cero issues error (los warn no bloquean). Nunca lanza. */
export function getDefinitionStatus(buildId?: string): DefinitionStatus {
  try {
    const issues = validateDefinition();
    const valid = !issues.some((i) => i?.severity === "error");
    const status: DefinitionStatus = {
      valid,
      issues,
      checkedAt: new Date().toISOString(),
    };
    if (typeof buildId === "string" && buildId.length > 0) status.buildId = buildId;
    return status;
  } catch {
    const status: DefinitionStatus = {
      valid: false,
      issues: [
        {
          file: "factory/",
          rule: "validate-crashed",
          message: "el validador no pudo correr: revisá que factory/ exista y sea legible",
          severity: "error",
        },
      ],
      checkedAt: new Date().toISOString(),
    };
    if (typeof buildId === "string" && buildId.length > 0) status.buildId = buildId;
    return status;
  }
}
