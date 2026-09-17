/**
 * Bot review ingestion (pullfrog / CodeRabbit) — external reviewer first
 * pass, internal review is the verdict.
 *
 * Flow (publication side, `gitHubPr.ts`): after the PR opens, wait a
 * bounded window for the external reviewer's comments, parse each bot
 * finding, reconcile it mechanically (Taken / Overlap / Open) and publish
 * the review report with the bot-review section filled.
 *
 * Pure parsing + injectable I/O (`run`, `sleep`); every export never
 * throws. Bounded by design: a fixed poll interval and a hard poll cap
 * (`BOT_REVIEW_MAX_POLLS`); no re-armed timers, no unbounded loops.
 */

/** Poll interval between external-reviewer checks (one-shot timers). */
export const BOT_REVIEW_POLL_MS = 60_000;
/** Hard cap on polls (~20 min at the default interval). */
export const BOT_REVIEW_MAX_POLLS = 20;
/** Max bot findings carried into the report. */
export const BOT_REVIEW_MAX_FINDINGS = 50;
/** Command timeout for the read-only `gh` probes. */
export const BOT_REVIEW_GH_TIMEOUT_MS = 20_000;

export type BotGhRun = (
  cmd: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface BotFinding {
  id: string;
  /** Reviewer login (e.g. `pullfrog[bot]`). */
  source: string;
  /** `path:line` for inline findings; path or empty for summary ones. */
  file: string;
  message: string;
  url: string;
  createdAt: string;
  /**
   * taken = fix landed after the bot review; overlap = same surface as an
   * internal finding; dispositioned = la ronda lo dispuso con estado
   * terminal (FIXED/NOT_A_FINDING/TRACKED_FOLLOW_UP/DECLINED);
   * open = not reconciled.
   */
  status: "taken" | "overlap" | "dispositioned" | "open";
  statusReason: string;
}

export interface BotFindingCandidate {
  id: string;
  source: string;
  file: string;
  message: string;
  url: string;
  createdAt: string;
}

function clean(v: unknown, max: number): string {
  try {
    if (typeof v !== "string") return "";
    return v.replace(/\r/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  } catch {
    return "";
  }
}

/**
 * Recorte de MENSAJES en boundary (palabra u oración) con elipsis; nunca a
 * mitad de palabra (defecto visto en el reporte del PR #163:
 * "…surface it in the storage warnin"). Para identificadores/URLs seguir
 * usando `clean` (corte duro). Nunca lanza.
 */
function capWords(v: unknown, max: number): string {
  try {
    if (typeof v !== "string") return "";
    const cap = typeof max === "number" && Number.isInteger(max) && max > 0 ? max : 300;
    const flat = v.replace(/\r/g, "").replace(/\s+/g, " ").trim();
    if (flat.length <= cap) return flat;
    const cut = flat.slice(0, cap);
    const space = cut.lastIndexOf(" ");
    if (space > cap * 0.5) return `${cut.slice(0, space)}…`;
    const sentence = Math.max(
      cut.lastIndexOf(". "),
      cut.lastIndexOf("! "),
      cut.lastIndexOf("? "),
    );
    if (sentence > cap * 0.5) return cut.slice(0, sentence + 1);
    return `${cut.trim()}…`;
  } catch {
    return "";
  }
}

/** Severity signal: emoji or word that marks a heading as a real finding. */
const FINDING_WORD_RE =
  /(ℹ️|⚠️|🛑|🔴|🟠|🟡|nitpick|finding|issue|problem|critical|major|minor|warning|suggestion|bug)/i;
/** Markdown heading line (levels 2-4) with its text. */
const FINDING_HEADING_LINE_RE = /^#{2,4}\s+(.+)$/;
/** Checklist item (`- [ ]` / `- [x]`) at line start. */
const FINDING_CHECKLIST_RE = /^\s*[-*]\s+\[[ xX]\]/m;
/** Severity marker token (`**Major**`, `_Nitpick_`, table cells). */
const FINDING_MARKER_RE = /(\*\*|_)(Critical|Major|Minor|Suggestion|Nitpick)\b/i;
/** Pullfrog lifecycle chatter ("New pull request. Leaping into action..."). */
const LIFECYCLE_FIRST_LINE_RE = /^\s*>?\s*(new pull request|leaping into action)/i;
const LIFECYCLE_ANY_RE = /leaping into action/i;

/** Strips fenced code blocks so snippets inside them do not parse. */
function stripFences(body: string): string {
  return body.replace(/```[\s\S]*?```/g, " ");
}

/**
 * True for bot lifecycle chatter (greeting/status messages), not findings:
 * first non-empty line starts a "new pull request" / "leaping into action"
 * notice, or that phrase appears anywhere. Never throws.
 */
function isLifecycleChatter(body: unknown): boolean {
  try {
    if (typeof body !== "string" || body.trim() === "") return false;
    if (LIFECYCLE_ANY_RE.test(body)) return true;
    const firstLine = body.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
    return LIFECYCLE_FIRST_LINE_RE.test(firstLine);
  } catch {
    return false;
  }
}

/** Bot logins to watch (env `TERMCANVAS_REVIEW_BOTS`, comma-separated). */
export function defaultBotLogins(env: Record<string, string | undefined> = process.env): string[] {
  try {
    const raw = typeof env?.TERMCANVAS_REVIEW_BOTS === "string" ? env.TERMCANVAS_REVIEW_BOTS : "";
    const list = raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
      .slice(0, 10);
    return list.length > 0 ? list : ["pullfrog", "coderabbit"];
  } catch {
    return ["pullfrog", "coderabbit"];
  }
}

/** True when the login matches a configured bot (case-insensitive). */
export function isBotLogin(login: unknown, bots: readonly string[]): boolean {
  try {
    const l = typeof login === "string" ? login.trim().toLowerCase() : "";
    if (l === "") return false;
    return bots.some((b) => {
      const token = b.trim().toLowerCase();
      if (token === "") return false;
      return l === token || l.startsWith(`${token}[`) || l.includes(token);
    });
  } catch {
    return false;
  }
}

/**
 * Bullets of a bot comment body become individual findings; a body with
 * no bullets falls back to its first 240 chars. Pure, capped, never throws.
 */
export function extractFindingBullets(body: unknown, max = 20): string[] {
  try {
    if (typeof body !== "string" || body.trim() === "") return [];
    const withoutFences = stripBotHtml(body.replace(/```[\s\S]*?```/g, " "));
    const bullets = withoutFences
      .split("\n")
      .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1] ?? "")
      .map((line) => capWords(line.replace(/^\[[ xX]\]\s*/, ""), 240))
      .filter((line) => line.length >= 8);
    const out: string[] = [];
    const seen = new Set<string>();
    bullets.forEach((b) => {
      const key = b.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(b);
    });
    if (out.length > 0) return out.slice(0, max);
    const flat = capWords(withoutFences, 240);
    return flat.length >= 20 ? [flat] : [];
  } catch {
    return [];
  }
}

/**
 * Finding headings (markdown levels 2-4) of a bot summary/review body:
 * cleaned text (markdown `#` and trailing `(N)` stripped, emoji kept),
 * deduped and capped at `max`. Only headings carrying a severity signal
 * (emoji or severity word) count. Pure, never throws.
 */
export function extractFindingHeadings(body: unknown, max = 20): string[] {
  try {
    if (typeof body !== "string" || body.trim() === "") return [];
    const cap = typeof max === "number" && Number.isInteger(max) && max > 0 ? max : 20;
    const out: string[] = [];
    const seen = new Set<string>();
    stripBotHtml(stripFences(body))
      .split("\n")
      .forEach((line) => {
        const match = line.match(FINDING_HEADING_LINE_RE);
        if (!match) return;
        const raw = (match[1] ?? "").replace(/#+\s*$/, "").replace(/\s*\(\d+\)\s*$/, "");
        const heading = capWords(raw, 240);
        if (heading.length === 0 || !FINDING_WORD_RE.test(heading)) return;
        const key = heading.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(heading);
      });
    return out.slice(0, cap);
  } catch {
    return [];
  }
}

/**
 * True only when the body carries finding structure: a level 2-4 heading
 * with a severity signal, a checklist item (`- [ ]` / `- [x]`), or a
 * severity marker token (`**Major**`, `_Nitpick_`). Pure, never throws.
 */
export function hasFindingStructure(body: unknown): boolean {
  try {
    if (typeof body !== "string" || body.trim() === "") return false;
    if (extractFindingHeadings(body, 1).length > 0) return true;
    return FINDING_CHECKLIST_RE.test(body) || FINDING_MARKER_RE.test(body);
  } catch {
    return false;
  }
}

interface RawComment {
  login: string;
  body: string;
  url: string;
  createdAt: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  try {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loginOf(rec: Record<string, unknown>): string {
  const author = asRecord(rec.author) ?? asRecord(rec.user);
  return clean(author?.login, 80);
}

/** Pulls issue-comment and review-body entries from `gh pr view --json comments,reviews`. */
function readPrJsonComments(prJson: unknown): RawComment[] {
  try {
    const root = asRecord(prJson);
    if (!root) return [];
    const out: RawComment[] = [];
    const push = (raw: unknown): void => {
      const rec = asRecord(raw);
      if (!rec) return;
      const body = typeof rec.body === "string" ? rec.body : "";
      if (body.trim() === "") return;
      out.push({
        login: loginOf(rec),
        body,
        url: clean(rec.url, 300),
        createdAt: clean(rec.createdAt, 40),
      });
    };
    if (Array.isArray(root.comments)) root.comments.forEach(push);
    if (Array.isArray(root.reviews)) root.reviews.forEach(push);
    return out.slice(0, 100);
  } catch {
    return [];
  }
}

/**
 * Actividad real del bot SIN estructura de findings sin parsear (ver
 * `hasBotActivity`): devuelve si revisó "limpio" y el login del primer cuerpo
 * de bot (para atribuir el reviewer correcto, no siempre `bots[0]`). Si hay
 * estructura de findings pero el parser no extrajo ninguno (p. ej. contenido
 * dentro de `<details>`), `reviewed=false`: el waiter sigue polleando hasta
 * el deadline en vez de publicar un "limpio" falso. Nunca lanza.
 */
function botActivityReviewer(
  prJson: unknown,
  bots: readonly string[],
): { reviewed: boolean; reviewer: string } {
  try {
    const bodies = readPrJsonComments(prJson).filter(
      (c) => isBotLogin(c.login, bots) && !isLifecycleChatter(c.body),
    );
    if (bodies.length === 0) return { reviewed: false, reviewer: "" };
    return {
      reviewed: !bodies.some((c) => hasFindingStructure(c.body)),
      reviewer: bodies[0]?.login ?? "",
    };
  } catch {
    return { reviewed: false, reviewer: "" };
  }
}

/**
 * Quita bloques `<details>…</details>` y etiquetas `<summary>` del cuerpo del
 * bot antes de extraer mensajes: son anexos técnicos verbosos que ensucian la
 * tabla §6 (caso PR #165). No toca otros tags (p. ej. `<input>` citado).
 * Nunca lanza.
 */
function stripBotHtml(s: string): string {
  try {
    const pass = (t: string): string =>
      t
        // Bloques internos primero (sin `<details>` adentro): resuelve el
        // nesting real de CodeRabbit antes del match general.
        .replace(/<details\b[^>]*>((?:(?!<details\b)[\s\S])*?)<\/details>/gi, " ")
        .replace(/<details[\s\S]*?<\/details>/gi, " ");
    return pass(pass(s))
      .replace(/<\/?details[^>]*>/gi, " ")
      .replace(/<\/?summary[^>]*>/gi, " ");
  } catch {
    return s;
  }
}

/** Pulls inline review comments from the `gh api .../pulls/N/comments` shape. */
function readInlineComments(inlineJson: unknown): RawComment[] {
  try {
    if (!Array.isArray(inlineJson)) return [];
    return inlineJson
      .map((raw) => {
        const rec = asRecord(raw);
        if (!rec) return null;
        const body = typeof rec.body === "string" ? rec.body : "";
        if (body.trim() === "") return null;
        const path = clean(rec.path, 200);
        const line =
          typeof rec.line === "number" && Number.isInteger(rec.line) && rec.line > 0
            ? `:${rec.line}`
            : "";
        return {
          login: loginOf(rec),
          body,
          url: clean(rec.html_url ?? rec.url, 300),
          createdAt: clean(rec.created_at ?? rec.createdAt, 40),
          file: `${path}${line}`,
        };
      })
      .filter((c): c is RawComment & { file: string } => c !== null)
      .slice(0, 100);
  } catch {
    return [];
  }
}

/**
 * Pure parse of external-reviewer comments into findings.
 * - Inline comments (`gh api .../comments`) are real findings: bullet-or-flat.
 * - Summary comments and review bodies (`gh pr view --json comments,reviews`)
 *   only yield candidates from finding headings (levels 2-4 with a severity
 *   signal); prose bullets and flat text are never findings there.
 * - Lifecycle chatter ("Leaping into action...") is always ignored.
 * Deduped by (file, message prefix), capped. Never throws.
 */
export function parseBotComments(
  input: { prJson?: unknown; inlineJson?: unknown },
  opts?: { bots?: readonly string[]; max?: number },
): BotFindingCandidate[] {
  try {
    const bots = Array.isArray(opts?.bots) && opts.bots.length > 0 ? opts.bots : defaultBotLogins();
    const max =
      typeof opts?.max === "number" && Number.isInteger(opts.max) && opts.max > 0
        ? Math.min(opts.max, BOT_REVIEW_MAX_FINDINGS)
        : BOT_REVIEW_MAX_FINDINGS;
    const out: BotFindingCandidate[] = [];
    const seen = new Set<string>();
    const push = (candidate: BotFindingCandidate): void => {
      if (out.length >= max) return;
      const key = `${candidate.file}|${candidate.message.toLowerCase().slice(0, 120)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(candidate);
    };
    const inline = readInlineComments(input?.inlineJson).filter(
      (c) => isBotLogin(c.login, bots) && !isLifecycleChatter(c.body),
    );
    inline.forEach((c, idx) => {
      const file = "file" in c && typeof c.file === "string" ? c.file : "";
      const message = extractFindingBullets(c.body, 1)[0] ?? capWords(stripBotHtml(c.body), 240);
      if (message === "") return;
      push({
        id: `bot-${idx + 1}`,
        source: c.login || "bot",
        file,
        message,
        url: c.url,
        createdAt: c.createdAt,
      });
    });
    const summary = readPrJsonComments(input?.prJson).filter(
      (c) => isBotLogin(c.login, bots) && !isLifecycleChatter(c.body),
    );
    let n = inline.length;
    summary.forEach((c) => {
      if (!hasFindingStructure(c.body)) return;
      extractFindingHeadings(c.body).forEach((message) => {
        n += 1;
        push({
          id: `bot-${n}`,
          source: c.login || "bot",
          file: "",
          message,
          url: c.url,
          createdAt: c.createdAt,
        });
      });
    });
    return out;
  } catch {
    return [];
  }
}

/** Best-effort owner/repo from a PR URL (`https://github.com/o/r/pull/N`). */
export function repoFromPrUrl(url: unknown): string | null {
  try {
    const m = typeof url === "string" ? url.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/\d+/) : null;
    return m ? `${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

/**
 * Reads external-reviewer findings for a PR. `gh pr view` carries the
 * summary comments/reviews; `gh api .../pulls/N/comments` carries the
 * inline findings (best-effort: its failure leaves summary findings
 * intact). Never throws.
 */
export async function fetchBotFindings(input: {
  repoPath: string;
  prNumber: number;
  run: BotGhRun;
  bots?: readonly string[];
}): Promise<
  | { ok: true; findings: BotFindingCandidate[]; reviewer: string; reviewed: boolean }
  | { ok: false; error: string }
> {
  try {
    const bots = Array.isArray(input.bots) && input.bots.length > 0 ? input.bots : defaultBotLogins();
    const view = await input.run(
      "gh",
      ["pr", "view", String(input.prNumber), "--json", "url,comments,reviews"],
      { cwd: input.repoPath, timeoutMs: BOT_REVIEW_GH_TIMEOUT_MS },
    );
    let prJson: unknown;
    try {
      prJson = JSON.parse(String(view?.stdout ?? "").trim());
    } catch {
      return { ok: false, error: "bot review read: unreadable gh output" };
    }
    let inlineJson: unknown = [];
    const repo = repoFromPrUrl(asRecord(prJson)?.url);
    if (repo) {
      try {
        const inline = await input.run(
          "gh",
          ["api", `repos/${repo}/pulls/${input.prNumber}/comments?per_page=100`],
          { cwd: input.repoPath, timeoutMs: BOT_REVIEW_GH_TIMEOUT_MS },
        );
        inlineJson = JSON.parse(String(inline?.stdout ?? "").trim());
      } catch {
        inlineJson = [];
      }
    }
    const findings = parseBotComments({ prJson, inlineJson }, { bots });
    const activity = botActivityReviewer(prJson, bots);
    const firstSource =
      findings[0] && typeof findings[0].source === "string" && findings[0].source.trim() !== ""
        ? findings[0].source.trim()
        : "";
    return {
      ok: true,
      findings,
      reviewer: firstSource || activity.reviewer || bots[0] || "bot",
      reviewed: activity.reviewed,
    };
  } catch (e) {
    return { ok: false, error: clean(e instanceof Error ? e.message : String(e), 200) || "bot review read failed" };
  }
}

/**
 * Bounded wait for the external reviewer: polls `fetchBotFindings` up to
 * `BOT_REVIEW_MAX_POLLS` times with a one-shot sleep between attempts.
 * Returns found con el primer batch no vacío; un review LIMPIO (0 findings)
 * se confirma con un poll extra antes de publicar (si el bot estaba posteando
 * findings justo después, el segundo read los captura). Sin actividad hasta
 * el deadline → timeout. Nunca lanza.
 */
export async function waitForBotReview(input: {
  repoPath: string;
  prNumber: number;
  run: BotGhRun;
  bots?: readonly string[];
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ status: "found" | "timeout"; findings: BotFindingCandidate[]; reviewer: string }> {
  try {
    const pollMs =
      typeof input.pollMs === "number" && Number.isInteger(input.pollMs) && input.pollMs > 0
        ? Math.max(input.pollMs, 1_000)
        : BOT_REVIEW_POLL_MS;
    const timeoutMs =
      typeof input.timeoutMs === "number" && Number.isInteger(input.timeoutMs) && input.timeoutMs >= 0
        ? input.timeoutMs
        : pollMs * BOT_REVIEW_MAX_POLLS;
    const maxPolls = Math.min(
      Math.max(Math.ceil(timeoutMs / pollMs), 1),
      BOT_REVIEW_MAX_POLLS,
    );
    const sleep =
      typeof input.sleep === "function"
        ? input.sleep
        : (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    let reviewer = Array.isArray(input.bots) && input.bots.length > 0 ? input.bots[0] : "bot";
    // Un review limpio (0 findings) se confirma con un poll extra antes de
    // publicar: evita el deadline de 20 min y la carrera con findings en camino.
    let stableCleanReview = false;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      const read = await fetchBotFindings({
        repoPath: input.repoPath,
        prNumber: input.prNumber,
        run: input.run,
        ...(input.bots ? { bots: input.bots } : {}),
      });
      if (read.ok) {
        reviewer = read.reviewer;
        if (read.findings.length > 0) {
          return { status: "found", findings: read.findings, reviewer };
        }
        if (read.reviewed === true) {
          if (stableCleanReview) {
            return { status: "found", findings: read.findings, reviewer };
          }
          stableCleanReview = true;
        } else {
          stableCleanReview = false;
        }
      } else {
        // Un read roto (gh caído) no cuenta como confirmación: los dos polls
        // de confirmación deben ser consecutivos y válidos.
        stableCleanReview = false;
      }
      if (attempt < maxPolls - 1) await sleep(pollMs);
    }
    return { status: "timeout", findings: [], reviewer };
  } catch {
    return { status: "timeout", findings: [], reviewer: "bot" };
  }
}

/** Path part of a `path:line` anchor. */
function pathOf(anchor: unknown): string {
  try {
    const s = typeof anchor === "string" ? anchor.replace(/`/g, "").trim() : "";
    if (s === "") return "";
    const m = s.match(/^([^:\s]+):\d+/);
    return (m ? m[1] : s).slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * Mechanical reconciliation. Pure:
 * - `taken` when a commit after the bot review touched the finding's file,
 * - `overlap` when an internal finding sits on the same file,
 * - `open` otherwise (must be reconciled before merge).
 * Never throws.
 */
export function reconcileBotFindings(
  findings: readonly BotFindingCandidate[],
  context: {
    internalFindings?: ReadonlyArray<{ id?: unknown; file?: unknown; state?: unknown }>;
    changedFiles?: readonly string[];
    /**
     * Disposiciones de la ronda de reconciliación para los findings `fN`:
     * matchea por mensaje (si viene) o por índice 1-based del feedback.
     * Un estado terminal marca `dispositioned` (no bloquea readiness).
     */
    dispositions?: ReadonlyArray<{
      index?: unknown;
      message?: unknown;
      disposition?: unknown;
      reason?: unknown;
    }>;
  },
): BotFinding[] {
  try {
    const changed = new Set(
      (Array.isArray(context?.changedFiles) ? context.changedFiles : [])
        .map((f) => pathOf(f))
        .filter((f) => f.length > 0),
    );
    const internal = (Array.isArray(context?.internalFindings) ? context.internalFindings : [])
      .map((f) => ({
        id: typeof f?.id === "string" && f.id.trim() !== "" ? f.id.trim() : "",
        file: pathOf(f?.file),
        state: typeof f?.state === "string" && f.state.trim() !== "" ? f.state.trim() : "OPEN",
      }))
      .filter((f) => f.id !== "" || f.file !== "");
    const dispositions = (Array.isArray(context?.dispositions) ? context.dispositions : [])
      .map((d) => ({
        index:
          typeof d?.index === "number" && Number.isInteger(d.index) && d.index > 0 ? d.index : 0,
        message:
          typeof d?.message === "string"
            ? d.message.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80)
            : "",
        disposition:
          typeof d?.disposition === "string" ? d.disposition.trim().toUpperCase() : "",
        reason: typeof d?.reason === "string" ? d.reason.replace(/\s+/g, " ").trim().slice(0, 200) : "",
      }))
      .filter((d) => d.disposition !== "" && (d.index > 0 || d.message !== ""));
    return findings.slice(0, BOT_REVIEW_MAX_FINDINGS).map((f, idx) => {
      const file = pathOf(f.file);
      if (file.length > 0 && changed.has(file)) {
        return {
          ...f,
          status: "taken" as const,
          statusReason: `fix commit after the bot review touches \`${file}\``,
        };
      }
      const hit = file.length > 0 ? internal.find((i) => i.file === file) : undefined;
      if (hit) {
        return {
          ...f,
          status: "overlap" as const,
          statusReason: `same surface as \`${hit.id}\` (${hit.state})`,
        };
      }
      const msgKey = f.message.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
      const disp = dispositions.find((d) =>
        d.message !== "" ? d.message === msgKey : d.index === idx + 1,
      );
      if (disp) {
        return {
          ...f,
          status: "dispositioned" as const,
          statusReason: `${disp.disposition}${
            disp.reason !== "" ? ` — ${disp.reason}` : ""
          } (round disposition)`.slice(0, 240),
        };
      }
      return {
        ...f,
        status: "open" as const,
        statusReason: "not addressed at this head",
      };
    });
  } catch {
    return [];
  }
}

/**
 * Files changed by commits after `sinceIso` (`git log --name-only`),
 * capped at 200. Empty list on any failure. Never throws.
 */
export async function changedFilesSince(input: {
  repoPath: string;
  sinceIso: string;
  run: BotGhRun;
}): Promise<string[]> {
  try {
    const since = clean(input.sinceIso, 40);
    if (since === "") return [];
    const out = await input.run(
      "git",
      ["log", `--since=${since}`, "--name-only", "--pretty=format:"],
      { cwd: input.repoPath, timeoutMs: BOT_REVIEW_GH_TIMEOUT_MS },
    );
    const seen = new Set<string>();
    String(out?.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line) => {
        if (seen.size < 200) seen.add(line.slice(0, 200));
      });
    return [...seen];
  } catch {
    return [];
  }
}
