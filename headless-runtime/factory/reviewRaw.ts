/**
 * reviewRaw — Ola 5 helpers puros (sin side-effects de red/disco).
 *
 * Centraliza el parseo y guards de los endpoints de review blindado para que
 * sean testeables sin server vivo:
 * - GET /factory/jobs/:id/review/raw (+ alias /work-items/:id/review/raw)
 * - POST /factory/jobs/:id/review/retry-review
 * - buildId del daemon para /factory/health
 *
 * Nunca lanza: todas las funciones devuelven valores o { error }.
 */

/** Ids reservados que nunca son un job válido en rutas de review. */
const RESERVED_IDS = new Set([
  "review",
  "raw",
  "result",
  "build-log",
  "build.log",
  "cancel",
  "accept",
  "retry",
  "retry-review",
]);

/**
 * Verifica que un id de job sea seguro para usar en rutas y en path.join.
 * Rechaza vacío, `.`, `..`, cualquier `..`, `/`, `\`, NUL y reservados.
 */
export function isSafeJobId(id: unknown): boolean {
  if (typeof id !== "string") return false;
  if (id.length === 0 || id.length > 128) return false;
  if (id.trim().length === 0) return false;
  if (id === "." || id === "..") return false;
  if (id.includes("..")) return false;
  if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
  if (RESERVED_IDS.has(id)) return false;
  // Rechaza traversal codificado (%2e, %2f, %5c en cualquier case).
  try {
    const decoded = decodeURIComponent(id);
    if (decoded !== id) {
      if (decoded.includes("..")) return false;
      if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return false;
      if (decoded === "." || decoded === "..") return false;
      if (RESERVED_IDS.has(decoded)) return false;
    }
  } catch {
    // Si no decodifica, es sospechoso (% suelto) → rechazar.
    if (id.includes("%")) return false;
  }
  return true;
}

export type ReviewRawPathOk = { id: string; isWorkItemsAlias: boolean };
export type ReviewRawPathErr = { error: string };

/**
 * Parsea el pathname de GET .../review/raw.
 * Espejo del estilo de GET /:id/review: split("/").filter(Boolean),
 * alias work-items (len 4) vs factory (len 5), 400 si falta id.
 * Rechaza traversal `..` como id inválido.
 */
export function parseReviewRawPath(pathname: unknown): ReviewRawPathOk | ReviewRawPathErr {
  if (typeof pathname !== "string") return { error: "invalid pathname" };
  const isFactory = pathname.startsWith("/factory/jobs/");
  const isAlias = pathname.startsWith("/work-items/");
  if (!isFactory && !isAlias) return { error: "not review-raw route" };
  if (!pathname.endsWith("/review/raw")) return { error: "not review-raw route" };
  const parts = pathname.split("/").filter(Boolean);
  const expectedLen = isAlias ? 4 : 5;
  if (parts.length !== expectedLen) return { error: "unexpected path length for review raw" };
  // Defensa estructural: últimos dos segmentos deben ser review/raw.
  if (parts[expectedLen - 2] !== "review" || parts[expectedLen - 1] !== "raw") {
    return { error: "not review-raw route" };
  }
  const id = isAlias ? parts[1] : parts[2];
  if (!id || id === "review" || id === "raw") {
    return { error: "missing id for review raw" };
  }
  if (!isSafeJobId(id)) {
    return { error: `invalid id: ${String(id).slice(0, 60)}` };
  }
  return { id, isWorkItemsAlias: isAlias };
}

/**
 * Resuelve el nombre del archivo raw desde reviewCount (igual que GET /review).
 * reviewCount >= 1 → review-raw-{reviewCount}.txt, si no → review-raw-1.txt.
 */
export function resolveReviewRawFileName(reviewCount: unknown): string {
  if (typeof reviewCount === "number" && Number.isInteger(reviewCount) && reviewCount >= 1) {
    return `review-raw-${reviewCount}.txt`;
  }
  return "review-raw-1.txt";
}

export type RetryReviewGuardOk = { ok: true };
export type RetryReviewGuardErr = { ok: false; code: 404 | 409; error: string };
export type RetryReviewGuard = RetryReviewGuardOk | RetryReviewGuardErr;

/**
 * Guards puros de POST .../review/retry-review (solo reintenta review).
 * - 404 si no existe el job
 * - 409 si status !== "Review"
 * Sin budget máximo (doctrina sin-límites): el humano reintenta siempre.
 */
export function checkRetryReviewGuards(
  job: { status?: unknown; reviewCount?: unknown } | null | undefined,
  idForMsg = "",
): RetryReviewGuard {
  const suffix = idForMsg ? `: ${idForMsg}` : "";
  if (!job) {
    return { ok: false, code: 404, error: `job not found${suffix}` };
  }
  const status = typeof job.status === "string" ? job.status : "";
  if (status !== "Review") {
    return { ok: false, code: 409, error: `job not in Review (status=${status || "?"})` };
  }
  return { ok: true };
}

/**
 * Fallback best-effort para buildId cuando git no está disponible.
 */
export function buildFallbackBuildId(nowMs: number): string {
  const n = typeof nowMs === "number" && Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  return `dev-${n.toString(36)}`;
}

export interface ResolveBuildIdOpts {
  /** Permite inyectar exec en tests. Debe devolver stdout del git. */
  exec?: (cmd: string, opts?: { cwd?: string; timeout?: number }) => string;
  nowMs?: number;
  cwd?: string;
}

/**
 * Resuelve el buildId best-effort: `git rev-parse --short HEAD`, si falla
 * devuelve `dev-<base36>`. Nunca lanza.
 */
export function resolveFactoryBuildId(opts: ResolveBuildIdOpts = {}): string {
  const nowMs = typeof opts.nowMs === "number" ? opts.nowMs : Date.now();
  const fallback = buildFallbackBuildId(nowMs);
  try {
    if (typeof opts.exec === "function") {
      const out = opts.exec("git rev-parse --short HEAD", { cwd: opts.cwd, timeout: 3000 });
      const trimmed = String(out ?? "").trim();
      if (trimmed.length >= 4 && trimmed.length <= 40 && !/\s/.test(trimmed)) return trimmed;
      return fallback;
    }
    // Lazy import kinds not allowed here (pure ESM); caller in factoryServer
    // pasa exec con execSync. Sin exec inyectado, devolvemos fallback.
    return fallback;
  } catch {
    return fallback;
  }
}
