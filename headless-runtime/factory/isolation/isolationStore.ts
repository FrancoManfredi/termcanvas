/**
 * Factory jobs isolation — pure helpers (branch parity mirror, jail
 * resolver, PR text, create gate, PR-once guard, cleanup guards).
 *
 * Zero `child_process` here: every function is pure and offline-testable.
 * The side-effectful twins live in `gitWorktree.ts` / `gitHubPr.ts`.
 * Renderer boundary: this module never imports `src/canvas/*`. Branch
 * parity with `src/canvas/issueWorktreeNaming.ts` (`buildIssueBranchName`)
 * is enforced by `tests/factory-isolation.test.ts`, not by import.
 * Single-writer rule: this module never writes `job.json`; callers persist
 * via `workItemStore.appendEvent` / transitions.
 * Every function never throws (honest unions, errors sliced).
 */

import path from "node:path";
// Route-id safety mirrors `headless-runtime/factory/routing/routeParsers.ts`
// (`isSafeRouteId`: traversal / reserved / length rules); imported, never
// copied, so the DELETE parse honors the same vocabulary (C6/C7).
import { isSafeRouteId } from "../routing/routeParsers";

/** Timeline meta key carrying the isolation record (durable path). */
export const JOB_ISOLATION_META_KEY = "isolation";

/** Timeline meta key carrying the PR outcome (durable path). */
export const JOB_PR_META_KEY = "pr";

/** Terminal statuses that may own a cleanup (DELETE guard). */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["Complete", "Cancelled"]);

/** Pact-shaped id prefixes excluded from isolation (mirror family). */
const PACT_ID_PREFIXES: readonly string[] = ["job-abc123", "job-f", "playground-"];

/**
 * Lower/kebab slug mirror of the canvas convention
 * (`src/canvas/issueWorktreeNaming.ts`): lowercase, non-alphanumeric to
 * hyphen, collapse, trim, 40 chars max, trailing hyphen trimmed.
 * Never throws.
 */
export function slugifyIssueTitle(title: unknown): string {
  try {
    const raw = typeof title === "string" ? title : "";
    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      .replace(/-$/, "");
    return slug;
  } catch {
    return "";
  }
}

/**
 * Branch mirror: MUST equal the canvas `buildIssueBranchName` output
 * given equal inputs (enforced by parity tests). Never throws.
 */
export function buildIsolationBranchName(input: {
  issueNumber: number;
  title?: unknown;
}): string {
  try {
    const raw = input?.issueNumber;
    const n =
      typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 0;
    const slug = slugifyIssueTitle(input?.title);
    return slug.length > 0 ? `issue-${n}-${slug}` : `issue-${n}`;
  } catch {
    return "issue-0";
  }
}

/**
 * Title for the slug, parsed from the daemon prompt first line
 * (`# Resolve issue #N — <title>`). Null when absent (caller falls back
 * to `issue-N`). Never throws.
 */
export function parseIssueTitleFromPrompt(
  prompt: unknown,
  issueNumber: number,
): string | null {
  try {
    if (typeof prompt !== "string" || prompt.length === 0) return null;
    if (typeof issueNumber !== "number" || !Number.isInteger(issueNumber)) {
      return null;
    }
    const first = prompt
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .at(0);
    if (!first) return null;
    const m = first.match(/^#\s*resolve\s+issue\s+#?(\d+)\s*[—–-]\s*(.+?)\s*$/i);
    if (!m) return null;
    if (Number.parseInt(m[1] as string, 10) !== issueNumber) return null;
    const title = (m[2] as string).trim().slice(0, 200);
    return title.length > 0 ? title : null;
  } catch {
    return null;
  }
}

/**
 * Heurística conservadora: true cuando `text` parece un finding de review
 * (hallazgo con severidad/ubicación/estado), no un outcome en lenguaje de
 * comportamiento. Un outcome limpio es una oración ("El conteo del kanban
 * ya suma bien"); un finding arranca con tag de severidad (`[info] ...`),
 * bullet markdown, id de finding/discovery (`f2 — ...`, `d3: ...`), o
 * combina id `fN` con un ancla `archivo:línea` (en cualquier orden) dentro
 * de los primeros 160 chars. También marca los `Status: OPEN|FIXED`.
 * Nunca lanza: cualquier valor no-string devuelve false.
 */
export function looksLikeFindingText(text: unknown): boolean {
  try {
    if (typeof text !== "string") return false;
    const raw = text.trim();
    if (raw.length === 0) return false;
    // Tag de severidad inicial: "[info] ...", "(critical) ...".
    if (
      /^\s*[\[(]?\s*(info|minor|major|blocker|critical|suggestion)\s*[\])]/i.test(
        raw,
      )
    ) {
      return true;
    }
    // Bullet markdown inicial: un outcome limpio es una oración, no una lista.
    if (/^\s*[-*]\s/.test(raw)) return true;
    // Id de finding/discovery inicial: "f2 — ...", "D3: ...".
    if (/^\s*[fdFD]\d+\s*[—:-]/.test(raw)) return true;
    // Marcador de disposición/estado escrito por el review.
    if (/\bstatus:\s*(open|fixed|open at)\b/i.test(raw)) return true;
    // Id de finding + ancla archivo:línea en la cabecera (cualquier orden).
    const head = raw.slice(0, 160);
    if (/\bf\d+\b/i.test(head) && /[\w./\\-]+:\d+\b/.test(head)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * True cuando `text` es prosa de compliance/veredicto (auto-certificación)
 * en vez de un outcome de comportamiento: "el fix cumple el issue", "the fix
 * satisfies the contract", "READY TO MERGE", "veredicto: ...". Caso PR #162:
 * el summary del review llegó al título del PR. Nunca lanza.
 */
export function looksLikeComplianceText(text: unknown): boolean {
  try {
    if (typeof text !== "string") return false;
    const raw = text.trim();
    if (raw.length === 0) return false;
    const head = raw.slice(0, 200).toLowerCase();
    if (
      /\b(cumple|satisface|satisfies|meets|fulfills)\b/.test(head) &&
      /\b(issue|contrato|contract|requisito|requirement)\b/.test(head)
    ) {
      return true;
    }
    if (/\bready to merge\b|\bneeds fixes\b|\breview incomplete\b/.test(head)) return true;
    if (/^(el|the)\s+(fix|change|cambio|patch)\b/.test(head) && /\b(cumple|satisfies|meets)\b/.test(head)) {
      return true;
    }
    if (/^\s*(veredicto|verdict)\b/.test(head)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * PR title for an isolated job. Issue-first (skill prp-pr): el título del PR
 * espeja el título del issue — texto humano, estable y comportamental. La
 * prosa del review/implement (outcome) solo entra como fallback sin título,
 * y nunca si parece finding (caso PR #160) ni frase de compliance ("el fix
 * cumple el issue" — caso PR #162). Never throws.
 */
export function buildPrTitle(
  issueNumber: number,
  title?: unknown,
  outcome?: unknown,
): string {
  try {
    const clean =
      typeof title === "string" && title.trim().length > 0
        ? title.trim().replace(/\s+/g, " ").slice(0, 200)
        : "";
    if (clean.length > 0) {
      return `Resolve issue #${issueNumber} — ${clean}`;
    }
    const rawOutcome =
      typeof outcome === "string" && outcome.trim().length > 0
        ? (outcome.split("\n")[0] ?? "").trim()
        : "";
    const outcomeLine =
      rawOutcome.length > 0 &&
      !looksLikeFindingText(rawOutcome) &&
      !looksLikeComplianceText(rawOutcome)
        ? rawOutcome.slice(0, 120)
        : "";
    if (outcomeLine.length > 0) {
      return `Resolve issue #${issueNumber} — ${outcomeLine}`;
    }
    return `Resolve issue #${issueNumber}`;
  } catch {
    return `Resolve issue #${issueNumber}`;
  }
}

/** Sinónimos de prefijo de issue → tipo conventional-commit. */
const COMMIT_TYPE_SYNONYMS: Readonly<Record<string, string>> = {
  bug: "fix",
  bugfix: "fix",
  hotfix: "fix",
  feature: "feat",
  enhancement: "feat",
};

/**
 * Subject conventional para el commit del orquestador. El prefijo del
 * título del issue manda el tipo (`bug:` → `fix:`, `feature:` → `feat:`;
 * cualquier otro prefijo válido pasa tal cual: `test:`, `refactor:`,
 * `a11y:`); sin prefijo → `chore:`. El subject termina en ` (#N)` para el
 * autolink. Sin título utilizable cae al headline legacy
 * `factory: implement issue #N (handoff)`. Una línea, cap 120. Nunca lanza.
 */
export function buildCommitSubject(issueNumber: number, title?: unknown): string {
  const n =
    typeof issueNumber === "number" && Number.isInteger(issueNumber) && issueNumber > 0
      ? issueNumber
      : 0;
  try {
    const clean =
      typeof title === "string"
        ? title.replace(/\s+/g, " ").trim().slice(0, 120)
        : "";
    const m = clean.match(/^([A-Za-z][A-Za-z0-9_-]{1,19}):\s*(.+)$/);
    const rawType = m ? (m[1] as string).toLowerCase() : "";
    const type = rawType === "" ? "chore" : (COMMIT_TYPE_SYNONYMS[rawType] ?? rawType);
    const rest = m ? (m[2] as string).trim() : clean;
    if (rest.length === 0) return `factory: implement issue #${n} (handoff)`;
    const suffix = n > 0 ? ` (#${n})` : "";
    const subject = `${type}: ${rest}`;
    if (subject.length + suffix.length <= 120) return `${subject}${suffix}`;
    // Cap por palabra: nunca a mitad de palabra (defecto visto en el commit
    // del PR #162: "…fall…a (#151)").
    const room = Math.max(1, 120 - suffix.length - 3);
    const cut = subject.slice(0, room);
    const lastSpace = cut.lastIndexOf(" ");
    const head = (lastSpace > room * 0.4 ? cut.slice(0, lastSpace) : cut).trim();
    return `${head}...${suffix}`;
  } catch {
    return `factory: implement issue #${n} (handoff)`;
  }
}

/**
 * PR body for an isolated job. Always carries `Closes #N` so the human
 * merge closes the issue on the GitHub side. Optional `details` enriches
 * the body with the accepted review summary, changed files and the
 * verification report (all sanitized, capped, never throwing — a junk
 * detail just renders an empty section). Neutral English.
 * Never throws.
 */
export interface PrBodyDetails {
  /** Accepted review summary (human-readable, what the change does). */
  summary?: unknown;
  /** Reviewer model ref, rendered as provenance at the end. */
  reviewer?: unknown;
  /** Files created/modified by implement (timeline `createdFiles`). */
  files?: unknown;
  /** Verification report (timeline `meta.verification` shape). */
  verification?: unknown;
  /**
   * Implement report text (timeline `meta.implementReport`): "qué cambió"
   * más `## Review guidance`. Feeds Solution / Review guidance / Not verified.
   */
  implementReport?: unknown;
  /** Isolation branch (Delivery considerations: revert source). */
  branch?: unknown;
  /** Isolation base branch (Delivery considerations: revert target). */
  baseBranch?: unknown;
  /**
   * Verified published-plan URL (rendered under ## Links). Local plan
   * paths are never rendered: only http(s) URLs reach the body.
   */
  planUrl?: unknown;
}

/**
 * Extrae el bloque markdown tras el primer encabezado `## <nombre>`
 * (case-insensitive, con alias). Devuelve el cuerpo hasta el próximo
 * encabezado o fin, recortado. Lee secciones del reporte del implement
 * (`## Review guidance`). Puro, nunca lanza.
 */
export function extractReportSection(text: unknown, names: readonly string[]): string {
  try {
    if (typeof text !== "string" || text.trim() === "") return "";
    const wanted = names
      .map((n) => (typeof n === "string" ? n.trim().toLowerCase() : ""))
      .filter((n) => n !== "");
    if (wanted.length === 0) return "";
    const lines = text.replace(/\r/g, "").split("\n");
    const start = lines.findIndex((line) => {
      try {
        const m = line.match(/^#{1,3}\s*(.+?)\s*$/);
        if (!m) return false;
        const title = (m[1] ?? "").trim().toLowerCase();
        return wanted.some(
          (w) =>
            title === w ||
            title.startsWith(`${w} `) ||
            title.startsWith(`${w}:`) ||
            title.startsWith(`${w} —`) ||
            title.startsWith(`${w} -`),
        );
      } catch {
        return false;
      }
    });
    if (start < 0) return "";
    const end = lines.findIndex(
      (line, idx) => idx > start && /^#{1,3}\s+/.test(line),
    );
    return capTextAtBoundary(
      lines
        .slice(start + 1, end < 0 ? undefined : end)
        .join("\n")
        .trim(),
      1500,
    );
  } catch {
    return "";
  }
}

/**
 * Intro del reporte (texto antes del primer encabezado), recortada.
 * Es el "qué cambió" del implement. Puro, nunca lanza.
 */
export function reportIntro(text: unknown, max = 1200): string {
  try {
    if (typeof text !== "string") return "";
    const flat = text.replace(/\r/g, "");
    const cut = flat.search(/\n#{1,3}\s+/);
    return capTextAtBoundary((cut < 0 ? flat : flat.slice(0, cut)).trim(), max);
  } catch {
    return "";
  }
}

/** Una unidad de commit declarada por el implement (`## Commit units`). */
export interface CommitUnit {
  subject: string;
  paths: string[];
}

/**
 * Parsea la sección `## Commit units` del reporte del implement:
 * líneas `- <type>: <subject> — <path1>, <path2>` (paths backtickeados o
 * planos, separados por coma). Sección ausente o sin líneas válidas → `[]`
 * (el caller mantiene el commit único legacy). Hasta 8 unidades y 50 paths
 * por unidad; el committer valida cada path contra los candidatos reales.
 * Nunca lanza.
 */
export function extractCommitUnits(text: unknown): CommitUnit[] {
  try {
    if (typeof text !== "string" || text.trim() === "") return [];
    const section = extractReportSection(text, ["commit units", "unidades de commit"]);
    if (section === "") return [];
    const out: CommitUnit[] = [];
    for (const raw of section.split("\n")) {
      const line = raw.replace(/^\s*[-*]\s+/, "").trim();
      if (line === "") continue;
      const m = line.match(/^(.+?)\s+[—–]\s+(.+)$/);
      if (!m) continue;
      const subject = (m[1] ?? "").replace(/`/g, "").trim().slice(0, 120);
      if (subject === "") continue;
      const seen = new Set<string>();
      const paths: string[] = [];
      for (const piece of (m[2] ?? "").split(",")) {
        const p = piece
          .replace(/`/g, "")
          .trim()
          .replace(/\\/g, "/")
          .replace(/^\.\//, "");
        if (p === "" || /\s/.test(p) || p.startsWith("/") || p.includes("..")) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        paths.push(p);
        if (paths.length >= 50) break;
      }
      if (paths.length === 0) continue;
      out.push({ subject, paths });
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Línea "No verificado" dentro de una guidance ("- No verificado: ..." o
 * "nada pendiente" que mapea a "Nothing material."). Puro, nunca lanza.
 */
export function extractNotVerified(guidance: string): string {
  try {
    if (typeof guidance !== "string" || guidance.trim() === "") return "";
    const hit = guidance
      .split("\n")
      .map((raw) => raw.replace(/^[-*]\s+/, "").trim())
      .find((line) => /^(no verificado|not verified)\b/i.test(line));
    if (!hit) return "";
    const rest = hit.replace(/^(no verificado|not verified)\s*:?\s*/i, "").trim();
    if (/^(nada pendiente|nothing|none)\b/i.test(rest)) return "Nothing material.";
    return rest.slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * Primera línea `- <etiqueta>: <valor>` del reporte (case-insensitive,
 * aliases EN/ES). Para Invariant / Scope boundary / Root cause del bloque
 * `## Contract` del implement. Puro, nunca lanza.
 */
export function extractLabeledLine(text: unknown, labels: readonly string[]): string {
  try {
    if (typeof text !== "string" || text.trim() === "") return "";
    const wanted = labels
      .map((n) => (typeof n === "string" ? n.trim().toLowerCase() : ""))
      .filter((n) => n !== "");
    if (wanted.length === 0) return "";
    for (const raw of text.replace(/\r/g, "").split("\n")) {
      const line = raw.replace(/^[-*]\s+/, "").trim();
      const hit = wanted.find((w) => line.toLowerCase().startsWith(`${w}:`));
      if (hit !== undefined) {
        return line.slice(hit.length + 1).trim().slice(0, 300);
      }
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Líneas red/green de la sección `## Validation` del reporte
 * (`- Red/green: <fallo sin fix> / <pase con fix>`). Puro, nunca lanza.
 */
export function extractRedGreenLines(text: unknown): string[] {
  try {
    if (typeof text !== "string" || text.trim() === "") return [];
    const section = extractReportSection(text, ["validation", "validación"]);
    if (section === "") return [];
    return section
      .split("\n")
      .map((l) => l.replace(/^[-*]\s+/, "").trim())
      .filter((l) => /red[\s/-]*green/i.test(l))
      .map((l) => l.slice(0, 300))
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Resumen para el cuerpo del commit del orquestador (headline intacto en
 * el llamador): summary + archivos + validación, acotado. Puro, nunca
 * lanza. Vacío cuando no hay nada que decir.
 */
export function summarizeDetailsForCommit(details: unknown): string {
  try {
    if (!details || typeof details !== "object" || Array.isArray(details)) return "";
    const d = details as {
      summary?: unknown;
      files?: unknown;
      verification?: unknown;
    };
    const parts: string[] = [];
    if (typeof d.summary === "string" && d.summary.trim() !== "") {
      const first = (d.summary.split("\n")[0] ?? "").trim().slice(0, 200);
      if (first !== "") parts.push(first);
    }
    if (Array.isArray(d.files)) {
      const files = d.files
        .map((x) => (typeof x === "string" ? x.trim().slice(0, 120) : ""))
        .filter((s) => s.length > 0)
        .slice(0, 10);
      if (files.length > 0) parts.push(`Files: ${files.join(", ")}`);
    }
    const v = d.verification;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const rec = v as { steps?: unknown; overall?: unknown };
      if (Array.isArray(rec.steps)) {
        const rows = (rec.steps as Array<Record<string, unknown>>)
          .map((s) => {
            if (!s || typeof s !== "object") return "";
            const cmd =
              typeof s.command === "string" && s.command.trim() !== ""
                ? s.command.trim()
                : typeof s.name === "string"
                  ? s.name.trim()
                  : "step";
            const status =
              typeof s.status === "string" ? s.status.trim().toUpperCase() : "?";
            return `${cmd} ${status}`;
          })
          .filter((s) => s.length > 0)
          .slice(0, 8);
        if (rows.length > 0) parts.push(`Validation: ${rows.join("; ")}`);
      } else if (typeof rec.overall === "string" && rec.overall.trim() !== "") {
        parts.push(`Validation: ${rec.overall.trim().slice(0, 120)}`);
      }
    }
    return capTextAtBoundary(parts.join("\n"), 1000);
  } catch {
    return "";
  }
}

/** Trimmed single-line-safe text detail; empty when junk. Never throws. */
function cleanDetailText(v: unknown, max: number): string {
  try {
    if (typeof v !== "string") return "";
    const s = v.trim().replace(/\r/g, "").slice(0, max);
    return s.length > 0 ? s : "";
  } catch {
    return "";
  }
}

/** Trimmed string list detail; empty entries dropped, per-item capped. */
function cleanDetailList(v: unknown, cap: number): string[] {
  try {
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => (typeof x === "string" ? x.trim().slice(0, 200) : ""))
      .filter((s) => s.length > 0)
      .slice(0, cap);
  } catch {
    return [];
  }
}

/**
 * Recorta `text` a `max` chars cortando SIEMPRE en boundary (oración, línea
 * o palabra) y marcando el corte con `…`; nunca a mitad de palabra (defecto
 * visto en la evidencia del PR #162: "Sin esta cita no hay ve"). Nunca
 * lanza.
 */
export function capTextAtBoundary(text: unknown, max: number): string {
  try {
    if (typeof text !== "string") return "";
    const s = text.replace(/\r/g, "").trim();
    const cap = typeof max === "number" && Number.isFinite(max) && max > 0 ? Math.trunc(max) : 0;
    if (cap === 0) return "";
    if (s.length <= cap) return s;
    const cut = s.slice(0, cap);
    const marks = [
      cut.lastIndexOf(". "),
      cut.lastIndexOf("! "),
      cut.lastIndexOf("? "),
      cut.lastIndexOf("\n"),
    ];
    const boundary = marks.reduce((a, b) => (a > b ? a : b), -1);
    if (boundary > cap * 0.4) return cut.slice(0, boundary + 1).trim();
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > cap * 0.4) return `${cut.slice(0, lastSpace).trim()}…`;
    return `${cut.trim()}…`;
  } catch {
    return "";
  }
}

/** Trimmed http(s) URL detail; local paths and junk never qualify. Never throws. */
export function cleanDetailUrl(v: unknown, max = 500): string {
  try {
    if (typeof v !== "string") return "";
    const s = v.trim().slice(0, max);
    return /^https?:\/\/\S+$/.test(s) ? s : "";
  } catch {
    return "";
  }
}

/** Terminal finding states written by implement (prp-issue rule). */
export const DISPOSITION_VALUES: readonly string[] = [
  "FIXED",
  "NOT_A_FINDING",
  "TRACKED_FOLLOW_UP",
  "DECLINED",
];

/** One parsed disposition line from the implement report. */
export interface FindingDisposition {
  id: string;
  disposition: string;
  reason: string;
}

/**
 * Parsea la sección `## Dispositions` del reporte del implement
 * (líneas `- <id>: <ESTADO> — <razón>`). Sin sección o sin líneas
 * válidas devuelve []. Puro, nunca lanza.
 */
export function extractDispositions(text: unknown): FindingDisposition[] {
  try {
    if (typeof text !== "string" || text.trim() === "") return [];
    const section = extractReportSection(text, ["dispositions", "disposiciones"]);
    if (section === "") return [];
    const seen = new Set<string>();
    return section
      .split("\n")
      .map((raw) => {
        try {
          const m = raw.match(
            /^\s*[-*]\s*(f\d+)\s*:\s*(FIXED|NOT_A_FINDING|TRACKED_FOLLOW_UP|DECLINED)\s*[—–\-:.]?\s*(.*)$/i,
          );
          if (!m) return null;
          const id = (m[1] ?? "").toLowerCase();
          if (seen.has(id)) return null;
          seen.add(id);
          return {
            id,
            disposition: (m[2] ?? "").toUpperCase(),
            reason: (m[3] ?? "").trim().replace(/\s+/g, " ").slice(0, 300),
          };
        } catch {
          return null;
        }
      })
      .filter((d): d is FindingDisposition => d !== null)
      .slice(0, 50);
  } catch {
    return [];
  }
}

/** Markdown lines for the verification report section. Never throws. */
function verificationLines(v: unknown): string[] {
  try {
    if (!v || typeof v !== "object" || Array.isArray(v)) return [];
    const rec = v as { overall?: unknown; steps?: unknown };
    const lines = (Array.isArray(rec.steps) ? rec.steps : [])
      .map((s) => {
        if (!s || typeof s !== "object") return "";
        const st = s as { name?: unknown; command?: unknown; status?: unknown };
        const name = typeof st.name === "string" ? st.name : "step";
        const command =
          typeof st.command === "string" && st.command.trim().length > 0
            ? ` — \`${st.command.trim()}\``
            : "";
        const status = typeof st.status === "string" ? st.status : "unknown";
        return `- ${name}${command} — ${status}`;
      })
      .filter((l) => l.length > 0)
      .slice(0, 10);
    if (lines.length === 0) return [];
    const overall = typeof rec.overall === "string" ? rec.overall : "unknown";
    return [`Overall: ${overall}`, ...lines];
  } catch {
    return [];
  }
}

/**
 * Descarta narrativa de ronda/proceso (worktree, stash, "no toqué código",
 * "Ronda revise N") del intro del implement: describe el proceso interno,
 * no el cambio final, y no debe viajar al body del PR (caso PR #162).
 * Conservador, por párrafo; si todo se descarta devuelve "". Nunca lanza.
 */
export function stripRoundNarrative(text: unknown): string {
  try {
    if (typeof text !== "string") return "";
    const flat = text.replace(/\r/g, "").trim();
    if (flat === "") return "";
    const kept = flat.split(/\n\s*\n/).filter((p) => {
      const head = p.trim().slice(0, 200);
      // "Ronda revise N" / "Round 2", nunca "Round-trip".
      if (/^\s*[-*]?\s*(ronda|round)\b(?!\s*-?\s*trip)/i.test(head)) return false;
      if (/\bno toqué código\b|\bsin cambios de código\b|\bworktree ya contiene\b/i.test(head)) {
        return false;
      }
      // Solo menciones de proceso (git stash), no el concepto técnico.
      if (/\b(git\s+stash|stash\s*\/\s*unstash|hice stash|hizo stash|stash y)\b/i.test(head)) {
        return false;
      }
      return true;
    });
    return kept.join("\n\n").trim();
  } catch {
    return "";
  }
}

/** Primera oración del texto (cap 240 en boundary), o "". Nunca lanza. */
function firstBehaviorSentence(text: string): string {
  try {
    const line = text.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
    if (line === "") return "";
    const cut = line.slice(0, 300);
    const ends = [cut.indexOf(". "), cut.indexOf("! "), cut.indexOf("? ")].filter((i) => i > 0);
    const min = ends.length > 0 ? Math.min(...ends) : -1;
    const sentence = min > 0 ? cut.slice(0, min + 1) : cut;
    return capTextAtBoundary(sentence.trim(), 240);
  } catch {
    return "";
  }
}

/**
 * PR body de un job aislado, estilo guía de review (problema + outcome,
 * solución, review guidance, archivos, validación, entrega). Siempre lleva
 * `Closes #N`; cada sección aparece solo cuando aporta información (nunca
 * relleno). Neutral English. Puro, nunca lanza.
 */
export function buildPrBody(
  issueNumber: number,
  title?: unknown,
  details?: PrBodyDetails,
): string {
  try {
    const heading = buildPrTitle(issueNumber, title);
    const lines: string[] = [
      `# ${heading}`,
      "",
      "Automated change set, opened by the factory daemon for human review.",
      "Merging stays a human decision (panel Merge action or GitHub UI).",
    ];
    // Problem and outcome: el issue es el problema; el outcome describe el
    // COMPORTAMIENTO resultante desde la intro del implement (nunca el
    // summary del review, que es veredicto, ni narrativa de ronda).
    const reportText =
      typeof details?.implementReport === "string" ? details.implementReport : "";
    const solution =
      reportText.trim() !== "" ? stripRoundNarrative(reportIntro(reportText, 1200)) : "";
    const outcomeLine = solution.length > 0 ? firstBehaviorSentence(solution) : "";
    const po: string[] = [`- **Issue:** #${issueNumber}`];
    if (outcomeLine.trim().length > 0) {
      po.push(`- **Outcome:** ${outcomeLine.trim().slice(0, 400)}`);
    }
    // Contrato del implement (bloque ## Contract): invariante, límite de
    // scope y causa raíz van bajo Problem and outcome, como el template.
    const invariant = extractLabeledLine(reportText, ["invariant", "invariante"]);
    if (invariant !== "") po.push(`- **Invariant:** ${invariant}`);
    const boundary = extractLabeledLine(reportText, [
      "scope boundary",
      "scope-boundary",
      "alcance",
    ]);
    if (boundary !== "") po.push(`- **Scope boundary:** ${boundary}`);
    const cause = extractLabeledLine(reportText, ["root cause", "root-cause", "causa"]);
    if (cause !== "") po.push(`- **Root cause:** ${cause}`);
    lines.push("", "## Problem and outcome", ...po);
    if (solution.length > 0 && solution !== outcomeLine) {
      lines.push("", "## Solution", solution);
    }
    // Review guidance del implement (Start here incluido).
    const guidance =
      reportText.trim() !== ""
        ? extractReportSection(reportText, ["review guidance", "guía de revisión"])
        : "";
    if (guidance.length > 0) lines.push("", "## Review guidance", guidance);
    // Dispositions del implement (una línea por finding, estados
    // terminales). Sin sección en el reporte no hay tabla (nunca relleno).
    const dispositions =
      reportText.trim() !== "" ? extractDispositions(reportText) : [];
    if (dispositions.length > 0) {
      lines.push(
        "",
        "## Review dispositions",
        "",
        "| Finding | Disposition | Reason |",
        "|---|---|---|",
        ...dispositions.map(
          (d) =>
            `| \`${d.id}\` | ${d.disposition} | ${(d.reason.length > 0 ? d.reason : "—").replace(/\|/g, "/").slice(0, 200)} |`,
        ),
      );
    }
    const files = cleanDetailList(details?.files, 50);
    if (files.length > 0) {
      lines.push("", "## Changed files", ...files.map((f) => `- \`${f}\``));
    }
    // Seams tocados (tabla del implement): se renderiza tal cual viene.
    const seams =
      reportText.trim() !== ""
        ? extractReportSection(reportText, ["changed seams", "seams", "tabla de seams"])
        : "";
    if (seams !== "") {
      lines.push("", "### Changed seams", "", ...seams.split("\n").slice(0, 30));
    }
    const ver = verificationLines(details?.verification);
    const notVerified = extractNotVerified(guidance);
    // Red/green citado por el implement: la prueba de que el test
    // discrimina (falla sin fix, pasa con fix).
    const redgreen =
      reportText.trim() !== "" ? extractRedGreenLines(reportText) : [];
    // Honest validation (prp-pr rule): only verification that actually ran
    // counts. "Nothing material" is claimed only when real steps ran; a
    // pending claim without steps stays visible as unrunned coverage.
    if (ver.length > 0 || notVerified.length > 0 || redgreen.length > 0) {
      lines.push("", "## Validation", ...ver);
      for (const rg of redgreen) lines.push(`- Red/green: ${rg}`);
      if (notVerified.length > 0 && notVerified !== "Nothing material.") {
        lines.push(`- **Not verified:** ${notVerified}`);
      } else if (ver.length > 0 || redgreen.length > 0) {
        lines.push("- **Not verified:** Nothing material.");
      } else {
        lines.push(
          "- **Not verified:** Claimed nothing pending — no verification steps ran.",
        );
      }
    }
    // Follow-ups aceptados por el implement (con número de issue cuando lo creó).
    const followups =
      reportText.trim() !== ""
        ? extractReportSection(reportText, [
            "discoveries",
            "follow-ups",
            "follow-up",
            "descubrimientos",
          ])
        : "";
    if (followups !== "") {
      lines.push("", "### Follow-ups", "", ...followups.split("\n").slice(0, 20));
    }
    const branch = cleanDetailText(details?.branch, 120);
    const base = cleanDetailText(details?.baseBranch, 120);
    if (branch.length > 0) {
      lines.push(
        "",
        "## Delivery considerations",
        "| Concern | Detail |",
        "|---|---|",
        `| Rollout / rollback | Revert de la rama \`${branch}\`${base.length > 0 ? ` contra \`${base}\`` : ""}; el merge lo decide un humano |`,
      );
    }
    const reviewer = cleanDetailText(details?.reviewer, 120);
    if (reviewer.length > 0) lines.push("", `Reviewed by \`${reviewer}\`.`);
    // Links: verified published-plan URL only (never a local path).
    const planUrl = cleanDetailUrl(details?.planUrl);
    if (planUrl.length > 0) {
      lines.push("", "## Links", "", `- Plan: ${planUrl}`);
    }
    lines.push("", `Closes #${issueNumber}`, "");
    return lines.join("\n");
  } catch {
    return `Closes #${issueNumber}\n`;
  }
}

/**
 * Local shape check for a create-body `issueRef` (mirror of the
 * `sanitizeIssueRef` rules in `headless-runtime/factory/jobs/jobCreate.ts`:
 * provider github + integer issueNumber > 0; repo/url trimmed strings).
 * Null when junk. Never throws.
 */
export function sanitizeIsolationIssueRef(ref: unknown): {
  provider: "github";
  issueNumber: number;
  repo: string | null;
  url: string | null;
} | null {
  try {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
    const r = ref as Record<string, unknown>;
    if (r.provider !== "github") return null;
    if (
      typeof r.issueNumber !== "number" ||
      !Number.isInteger(r.issueNumber) ||
      (r.issueNumber as number) <= 0
    ) {
      return null;
    }
    const repo =
      typeof r.repo === "string" && r.repo.trim().length > 0
        ? r.repo.trim().slice(0, 256)
        : null;
    const url =
      typeof r.url === "string" && r.url.trim().length > 0
        ? r.url.trim().slice(0, 500)
        : null;
    return {
      provider: "github",
      issueNumber: r.issueNumber as number,
      repo,
      url,
    };
  } catch {
    return null;
  }
}

/**
 * Pact-shaped jobs stay on the byte-identical legacy in-place path
 * (same predicate family as the implement/review pact guards).
 * Never throws.
 */
export function isPactIsolationJob(input: {
  id?: unknown;
  prompt?: unknown;
  worktree?: unknown;
}): boolean {
  try {
    const idLC = String(input?.id ?? "").toLowerCase();
    if (PACT_ID_PREFIXES.some((p) => idLC.startsWith(p))) return true;
    const prompt = String(input?.prompt ?? "");
    if (prompt.startsWith("playground-")) return true;
    const wLC = String(input?.worktree ?? "").toLowerCase();
    if (wLC.includes("playground-")) return true;
    if (
      wLC.includes("playground") &&
      (idLC.startsWith("playground-") || idLC.includes("playground"))
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Create gate: isolate only when the body carries a valid `issueRef`
 * AND the job is not pact-shaped. Everything else keeps the legacy
 * in-place path (pacts F01–F14 never touch git/gh). Never throws.
 */
export function shouldIsolate(body: unknown): boolean {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const b = body as Record<string, unknown>;
    if (sanitizeIsolationIssueRef(b.issueRef) === null) return false;
    if (
      isPactIsolationJob({ id: b.id, prompt: b.prompt, worktree: b.worktree })
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Isolation record shape carried in memory + timeline meta. */
export interface IsolationRecordLike {
  readonly branch: string;
  readonly baseBranch: string;
  readonly worktreePath: string;
  readonly repoRoot: string;
}

function isFullIsolationRecord(value: unknown): value is IsolationRecordLike {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const r = value as Record<string, unknown>;
    return (
      typeof r.branch === "string" &&
      (r.branch as string).length > 0 &&
      typeof r.baseBranch === "string" &&
      (r.baseBranch as string).length > 0 &&
      typeof r.worktreePath === "string" &&
      (r.worktreePath as string).length > 0 &&
      typeof r.repoRoot === "string" &&
      (r.repoRoot as string).length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Durable-path read: latest timeline `isolation` meta with a full record
 * (reverse scan; a broken entry never aborts the scan). Null when absent.
 * Never throws.
 */
export function readIsolationFromTimeline(
  timeline: unknown,
): IsolationRecordLike | null {
  try {
    if (!Array.isArray(timeline)) return null;
    const entries = [...timeline].reverse();
    const found = entries
      .map((e) => {
        try {
          const meta = (e as Record<string, unknown> | null)?.meta as unknown;
          if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
            return null;
          }
          const holder = (meta as Record<string, unknown>)[
            JOB_ISOLATION_META_KEY
          ];
          return isFullIsolationRecord(holder) ? holder : null;
        } catch {
          return null;
        }
      })
      .filter((x): x is IsolationRecordLike => x !== null)
      .at(0);
    return found ?? null;
  } catch {
    return null;
  }
}

/**
 * Durable-path PR read: latest timeline `pr` meta carrying a prNumber
 * (reverse scan). Null when absent. Never throws.
 */
export function readPrFromTimeline(
  timeline: unknown,
): { prNumber?: number; prUrl?: string } | null {
  try {
    if (!Array.isArray(timeline)) return null;
    const entries = [...timeline].reverse();
    const numbered = entries
      .map((e) => {
        try {
          const meta = (e as Record<string, unknown> | null)?.meta as unknown;
          if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
            return null;
          }
          return (meta as Record<string, unknown>)[JOB_PR_META_KEY] as unknown;
        } catch {
          return null;
        }
      })
      .filter(
        (m): m is Record<string, unknown> =>
          !!m &&
          typeof m === "object" &&
          !Array.isArray(m) &&
          typeof (m as Record<string, unknown>).prNumber === "number" &&
          Number.isInteger((m as Record<string, unknown>).prNumber) &&
          ((m as Record<string, unknown>).prNumber as number) > 0,
      )
      .at(0);
    if (!numbered) return null;
    const out: { prNumber?: number; prUrl?: string } = {
      prNumber: numbered.prNumber as number,
    };
    if (typeof numbered.prUrl === "string" && numbered.prUrl.length > 0) {
      out.prUrl = numbered.prUrl as string;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Single pure resolver: the jail when recorded (memory fast path, then
 * timeline durable path across restarts), else the requested anchor
 * resolved (legacy in-place behavior). Never throws.
 */
export function effectiveWorktreeFor(job: {
  worktree: unknown;
  isolation?: { worktreePath?: unknown } | null;
  timeline?: unknown;
}): string {
  try {
    const anchor = typeof job?.worktree === "string" ? job.worktree : "";
    const mem = job?.isolation?.worktreePath;
    if (typeof mem === "string" && mem.length > 0) return mem;
    const durable = readIsolationFromTimeline(job?.timeline);
    if (durable !== null) return durable.worktreePath;
    return path.resolve(anchor);
  } catch {
    try {
      return path.resolve(String(job?.worktree ?? "."));
    } catch {
      return String(job?.worktree ?? ".");
    }
  }
}

/** Once-per-job PR guard outcome. */
export type PrGuardOutcome =
  | { opened: true; prNumber?: number; prUrl?: string }
  | { opened: false };

/**
 * PR-once guard: memory `isolation.state` is the fast path, the persisted
 * timeline `pr` meta (with prNumber) is the durable path across restarts.
 * Never throws.
 */
export function prGuard(jobLike: {
  isolation?: {
    state?: unknown;
    prNumber?: unknown;
    prUrl?: unknown;
  } | null;
  timeline?: unknown;
}): PrGuardOutcome {
  try {
    const iso = jobLike?.isolation;
    const state = typeof iso?.state === "string" ? iso.state : "";
    if (state === "pr-open" || state === "pr-merged") {
      const out: { opened: true; prNumber?: number; prUrl?: string } = {
        opened: true,
      };
      if (
        typeof iso?.prNumber === "number" &&
        Number.isInteger(iso.prNumber) &&
        (iso.prNumber as number) > 0
      ) {
        out.prNumber = iso.prNumber as number;
      }
      if (typeof iso?.prUrl === "string" && (iso.prUrl as string).length > 0) {
        out.prUrl = iso.prUrl as string;
      }
      return out;
    }
    const durable = readPrFromTimeline(jobLike?.timeline);
    if (durable !== null && typeof durable.prNumber === "number") {
      return { opened: true, ...durable };
    }
    return { opened: false };
  } catch {
    return { opened: false };
  }
}

/** PR visibility for the DELETE guard. */
export type PrVisibility = "open" | "merged" | "closed" | "none" | "unknown";

/** DELETE guard verdict (honest shapes for the route). */
export type WorktreeDeleteVerdict =
  | { ok: true }
  | { ok: false; code: 409; reason: string };

/**
 * Explicit-cleanup guard matrix (pure): non-terminal always refuses
 * (`force` never overrides non-terminality); open/unknown/absent PR
 * refuses without `force`; dirtiness refuses without `force`.
 * Never throws.
 */
export function decideWorktreeDelete(input: {
  status: unknown;
  hasIsolation: boolean;
  prState: PrVisibility;
  dirty: boolean;
  force?: boolean;
}): WorktreeDeleteVerdict {
  try {
    const force = input?.force === true;
    if (input?.hasIsolation !== true) {
      return {
        ok: false,
        code: 409,
        reason: "no isolated worktree recorded given this job",
      };
    }
    const status = typeof input?.status === "string" ? input.status : "";
    if (!TERMINAL_STATUSES.has(status)) {
      return {
        ok: false,
        code: 409,
        reason: `job is not terminal (status=${status || "unknown"})`,
      };
    }
    const pr = input?.prState ?? "unknown";
    if (pr === "open") {
      if (!force) {
        return {
          ok: false,
          code: 409,
          reason: "PR is still open (pass force to remove anyway)",
        };
      }
    } else if (pr === "merged" || pr === "closed") {
      // Human already closed the loop: fall through to the dirt check.
    } else if (!force) {
      return {
        ok: false,
        code: 409,
        reason:
          pr === "none"
            ? "no PR on record (pass force to remove anyway)"
            : "PR state unknown (pass force to remove anyway)",
      };
    }
    if (input?.dirty === true && !force) {
      return {
        ok: false,
        code: 409,
        reason: "worktree has uncommitted changes (pass force to discard)",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 409, reason: "cleanup guard failed" };
  }
}

/**
 * Pure parse of `DELETE /factory/jobs/:id/worktree` (factory canonical
 * only, no alias). Rejects traversal + reserved segments. Never throws.
 */
export function parseWorktreeDeletePath(
  pathname: unknown,
): { id: string } | { error: string } {
  try {
    if (typeof pathname !== "string" || pathname.length === 0) {
      return { error: "invalid pathname" };
    }
    const parts = pathname.split("/").filter(Boolean);
    if (
      parts.length !== 4 ||
      parts[0] !== "factory" ||
      parts[1] !== "jobs" ||
      parts[3] !== "worktree"
    ) {
      return { error: "not a worktree delete path" };
    }
    const id = parts[2] as string;
    if (!isSafeRouteId(id)) return { error: "invalid id" };
    return { id };
  } catch {
    return { error: "invalid pathname" };
  }
}
