#!/usr/bin/env node
// CONFIGURACIÓN DE SEGURIDAD DEL REPOSITORIO (GitHub).
//
// Preconfigura capas de seguridad GRATIS de un repo GitHub a través de `gh
// api`, adaptándose al repo que sea: visibilidad (público/privado), permisos
// del usuario, y estado actual (nunca pisa lo ya configurado).
//
// Modos:
//   node configure-github-security.mjs --audit --repo <path>
//       → imprime JSON del estado actual (SecurityAudit) en stdout.
//   node configure-github-security.mjs --apply --repo <path>
//            --selections-json '<json>' [--out <dir>]
//       (o --selections <archivo.json>; el JSON inline evita depender de
//        directorios que puedan no existir en el repo)
//       → aplica las selecciones, streamea el progreso a stdout con
//         marcadores (> comando, ✓ ok, ⚠ skip, ✗ error) y escribe
//         <out>/security-result-<ts>.json. Exit 0 si la corrida terminó
//         (aunque haya features con error); exit 1 solo en fallo fatal.
//
// El shape del JSON de audit/result vive en src/types/repoSecurity.ts:
// mantener ambas definiciones sincronizadas.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

// ─── Argumentos ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const MODE = argValue("--mode", null) ?? (args.includes("--apply") ? "apply" : "audit");
const REPO = path.resolve(argValue("--repo", "."));
const SELECTIONS_PATH = argValue("--selections", null);
const SELECTIONS_JSON = argValue("--selections-json", null);
const OUT_DIR = path.resolve(argValue("--out", path.join(process.cwd(), "outputs")));

const GH_TIMEOUT_MS = 60000;

const RULESET_BRANCH_NAME = "termcanvas-seguridad";
const RULESET_TAGS_NAME = "termcanvas-seguridad-tags";

// ─── Helpers de proceso ───────────────────────────────────────────────────
async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// gh api sin lanzar excepciones: devuelve { code, stdout, stderr }.
async function gh(argsList) {
  try {
    const result = await execFileAsync("gh", argsList, {
      timeout: GH_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env },
      windowsHide: true,
    });
    return { code: result.code ?? 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error?.code === "number" ? error.code : 1,
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
    };
  }
}

async function git(argsList) {
  try {
    const result = await execFileAsync("git", argsList, {
      cwd: REPO,
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return { code: result.code ?? 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error?.code === "number" ? error.code : 1,
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
    };
  }
}

// Mensaje corto del error de gh (stderr): quita el prefijo "gh: " y
// acota a la primera línea útil.
function ghErrorText(stderr) {
  const line = (stderr ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? "";
  return line.replace(/^gh:\s*/i, "") || "error desconocido";
}

// ─── Catálogo de features ─────────────────────────────────────────────────
// free: visibilidades donde la feature es GRATIS. fileBased: requiere crear
// un archivo en el repo (workflow/dependabot.yml) → no se aplica, solo info.

export const SECURITY_FEATURE_CATALOG = [
  {
    id: "dependabot_alerts",
    category: "basic",
    label: "Dependabot alerts",
    description:
      "Alertas de dependencias con vulnerabilidades conocidas + grafo de dependencias.",
    free: ["public", "private"],
    fileBased: false,
    subOptions: [],
  },
  {
    id: "dependabot_security_updates",
    category: "basic",
    label: "Dependabot security updates",
    description: "PRs automáticos que actualizan dependencias vulnerables.",
    free: ["public", "private"],
    fileBased: false,
    subOptions: [],
  },
  {
    id: "secret_scanning",
    category: "basic",
    label: "Secret scanning (alertas)",
    description: "Detecta credenciales commiteadas y genera alertas.",
    free: ["public"],
    fileBased: false,
    subOptions: [],
  },
  {
    id: "push_protection",
    category: "basic",
    label: "Push protection",
    description: "Bloquea pushes con secretos antes de que lleguen al remoto.",
    free: ["public"],
    fileBased: false,
    subOptions: [],
  },
  {
    id: "private_vuln_reporting",
    category: "basic",
    label: "Private vulnerability reporting",
    description: "Permite reportar vulnerabilidades de forma privada (sin issue público).",
    free: ["public"],
    fileBased: false,
    subOptions: [],
  },
  {
    id: "code_scanning",
    category: "recommended",
    label: "Code scanning (CodeQL)",
    description: "Análisis estático en cada PR con CodeQL (default setup).",
    free: ["public"],
    fileBased: false,
    subOptions: [],
  },
  {
    id: "ruleset_branch",
    category: "recommended",
    label: "Reglas de protección en la rama principal",
    description: "Ruleset sobre la rama principal del repo.",
    free: ["public", "private"],
    fileBased: false,
    subOptions: [
      {
        id: "block_force_push",
        label: "Bloquear force-push",
        description: "Nadie puede reescribir el historial de la rama.",
        defaultOn: true,
        tier: "recommended",
      },
      {
        id: "block_deletion",
        label: "Bloquear borrado",
        description: "La rama no se puede eliminar.",
        defaultOn: true,
        tier: "recommended",
      },
      {
        id: "require_conversation_resolution",
        label: "Conversaciones resueltas",
        description: "Los hilos de comentarios del PR deben resolverse antes de mergear.",
        defaultOn: false,
        tier: "recommended",
      },
      {
        id: "require_pull_request",
        label: "PR obligatorio (1 approval)",
        description: "Todo cambio debe pasar por un PR aprobado antes de mergear.",
        defaultOn: false,
        tier: "advanced",
        warning:
          "Bloquea los pushes directos a la rama principal: a partir de ahora todo cambio va por PR.",
      },
      {
        id: "require_signed_commits",
        label: "Commits firmados",
        description: "Solo se aceptan commits con firma verificada.",
        defaultOn: false,
        tier: "advanced",
        warning:
          "Los commits automáticos de los agentes (worktrees) necesitarán firma configurada o serán rechazados.",
      },
    ],
  },
  {
    id: "ruleset_tags",
    category: "advanced",
    label: "Protección de tags",
    description: "Ruleset para tags: evita force-push y borrado de releases.",
    free: ["public", "private"],
    fileBased: false,
    subOptions: [
      {
        id: "block_force_push",
        label: "Bloquear force-push",
        description: "No se puede reescribir un tag.",
        defaultOn: true,
        tier: "recommended",
      },
      {
        id: "block_deletion",
        label: "Bloquear borrado",
        description: "Los tags no se pueden eliminar.",
        defaultOn: true,
        tier: "recommended",
      },
    ],
  },
  {
    id: "dependency_review",
    category: "recommended",
    label: "Dependency review",
    description:
      "Muestra el impacto de los cambios de dependencias en cada PR (requiere workflow).",
    free: ["public", "private"],
    fileBased: true,
    subOptions: [],
  },
  {
    id: "dependabot_version_updates",
    category: "recommended",
    label: "Dependabot version updates",
    description: "PRs para mantener dependencias al día (requiere dependabot.yml).",
    free: ["public", "private"],
    fileBased: true,
    subOptions: [],
  },
];

// ─── Funciones puras (exportadas para tests) ──────────────────────────────

export function classifyVisibility(raw) {
  const v = String(raw ?? "").toUpperCase();
  if (v === "PUBLIC") return "public";
  if (v === "INTERNAL") return "internal";
  return "private";
}

export function featureIsFree(feature, visibility) {
  // INTERNAL se trata como PRIVATE para la gratuidad (GHAS pago también en
  // repos internal); el label de la UI sí lo distingue.
  const effective = visibility === "internal" ? "private" : visibility;
  return feature.free.includes(effective);
}

const PAID_REASONS = {
  secret_scanning: "Requiere GitHub Secret Protection (pago)",
  push_protection: "Requiere GitHub Secret Protection (pago)",
  code_scanning: "Requiere GitHub Code Security (pago)",
};

// Construye el catálogo completo del audit: qué es seleccionable, qué ya
// está activo, y el motivo exacto de cada deshabilitación.
export function buildFeatureCatalog({
  visibility,
  isAdmin,
  defaultBranch,
  enabledById,
  fileBasedReason = "Requiere crear un archivo en el repo (workflow/PR) — fuera de alcance del botón",
}) {
  return SECURITY_FEATURE_CATALOG.map((feature) => {
    let available = isAdmin && !feature.fileBased && featureIsFree(feature, visibility);
    let reason = null;
    let stateLabel = null;

    if (enabledById[feature.id]) {
      available = false;
      stateLabel = "Ya activo";
    } else if (!isAdmin) {
      available = false;
      reason = "Sin permisos de admin en el repositorio";
    } else if (feature.fileBased) {
      available = false;
      reason = fileBasedReason;
    } else if (!featureIsFree(feature, visibility)) {
      available = false;
      reason =
        PAID_REASONS[feature.id] ??
        (visibility === "public" ? "No disponible en este repositorio" : "Solo repos públicos");
    }

    const subOptions = feature.subOptions.map((opt) => ({
      id: opt.id,
      label: opt.label,
      description: opt.description,
      defaultOn: opt.defaultOn,
      tier: opt.tier,
      warning: opt.warning,
    }));

    let description = feature.description;
    if (feature.id === "ruleset_branch" && defaultBranch) {
      description = `Ruleset sobre la rama ${defaultBranch}.`;
    }

    return {
      id: feature.id,
      category: feature.category,
      label: feature.label,
      description,
      available,
      selectable: available && !enabledById[feature.id],
      enabled: Boolean(enabledById[feature.id]),
      reason,
      stateLabel,
      subOptions,
    };
  });
}

// Body del ruleset de rama a partir de las sub-options activadas.
export function rulesetBranchBody(defaultBranch, subOptions) {
  const rules = [];
  if (subOptions.includes("block_force_push")) rules.push({ type: "non_fast_forward" });
  if (subOptions.includes("block_deletion")) rules.push({ type: "deletion" });
  if (subOptions.includes("require_conversation_resolution")) {
    rules.push({ type: "required_conversation_resolution" });
  }
  if (subOptions.includes("require_pull_request")) {
    rules.push({
      type: "pull_request",
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
        require_last_push_approval: true,
      },
    });
  }
  if (subOptions.includes("require_signed_commits")) {
    rules.push({ type: "required_commit_signature" });
  }
  return {
    name: RULESET_BRANCH_NAME,
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: { include: [`refs/heads/${defaultBranch}`], exclude: [] },
    },
    rules,
  };
}

export function rulesetTagsBody(subOptions) {
  const rules = [];
  if (subOptions.includes("block_force_push")) rules.push({ type: "non_fast_forward" });
  if (subOptions.includes("block_deletion")) rules.push({ type: "deletion" });
  return {
    name: RULESET_TAGS_NAME,
    target: "tag",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/tags/*"], exclude: [] } },
    rules,
  };
}

// Valida las selecciones del usuario contra el catálogo: devuelve
// { ok, errors, features: [ids], subOptions } (los ids desconocidos se
// descartan con error — no se aplica nada que no esté en el catálogo).
export function parseSelections(raw, { defaultBranch } = {}) {
  const errors = [];
  let input;
  try {
    input = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, errors: ["selecciones no son JSON válido"], features: [], subOptions: {} };
  }
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["selecciones vacías"], features: [], subOptions: {} };
  }
  const known = new Map(SECURITY_FEATURE_CATALOG.map((f) => [f.id, f]));
  const features = [];
  const subOptions = {};
  for (const id of Array.isArray(input.features) ? input.features : []) {
    const feature = known.get(id);
    if (!feature) {
      errors.push(`feature desconocida: ${id}`);
      continue;
    }
    features.push(id);
    const opts = Array.isArray(input.subOptions?.[id]) ? input.subOptions[id] : [];
    const validOpts = new Set(feature.subOptions.map((o) => o.id));
    const clean = opts.filter((o) => {
      if (!validOpts.has(o)) {
        errors.push(`sub-opción desconocida en ${id}: ${o}`);
        return false;
      }
      return true;
    });
    subOptions[id] = clean;
  }
  return { ok: errors.length === 0, errors, features, subOptions };
}

// ─── Audit: estado actual del repo ────────────────────────────────────────

async function resolveOwnerRepo() {
  const r = await git(["remote", "get-url", "origin"]);
  if (r.code !== 0) {
    return { ok: false, error: "No hay remote 'origin' en el repositorio." };
  }
  const match = r.stdout.trim().match(/github\.com[:/]([^/]+)\/([^/\s.]+?)(?:\.git)?$/i);
  if (!match) {
    return { ok: false, error: `El remote origin no es de GitHub: ${r.stdout.trim()}` };
  }
  return { ok: true, owner: match[1], repo: match[2] };
}

async function hasGh() {
  const r = await gh(["--version"]);
  return r.code === 0;
}

// Estado de features dependientes del repo (llamadas GET).
async function collectRepoState({ owner, repo, visibility, defaultBranch, hasGhCli }) {
  const enabledById = {};
  const existingRulesets = [];
  if (!hasGhCli) return { enabledById, existingRulesets };

  const repoSlug = `${owner}/${repo}`;

  // PUT endpoints: 204 = activo, 404/403 = inactivo.
  const checkPut = async (endpointPath) => {
    const r = await gh(["api", "--silent", endpointPath]);
    return r.code === 0;
  };
  enabledById.dependabot_alerts = await checkPut(`/repos/${repoSlug}/vulnerability-alerts`);
  enabledById.dependabot_security_updates = await checkPut(`/repos/${repoSlug}/automated-security-fixes`);
  enabledById.private_vuln_reporting = await checkPut(`/repos/${repoSlug}/private-vulnerability-reporting`);

  // security_and_analysis (solo presente cuando aplica; null en privados sin GHAS).
  const repoInfo = await gh([
    "api",
    `/repos/${repoSlug}`,
    "--jq",
    ".security_and_analysis.secret_scanning.status, .security_and_analysis.secret_scanning_push_protection.status",
  ]);
  if (repoInfo.code === 0) {
    const [ss, pp] = repoInfo.stdout.trim().split(/\r?\n/);
    enabledById.secret_scanning = ss === "enabled";
    enabledById.push_protection = pp === "enabled";
  } else {
    enabledById.secret_scanning = false;
    enabledById.push_protection = false;
  }

  // CodeQL default setup: state "configured" = activo.
  const ds = await gh(["api", `/repos/${repoSlug}/code-scanning/default-setup`, "--jq", ".state"]);
  enabledById.code_scanning = ds.code === 0 && ds.stdout.trim() === "configured";

  // Rulesets existentes (para upsert y para no pisar configs ajenas).
  const rs = await gh(["api", `/repos/${repoSlug}/rulesets`]);
  if (rs.code === 0) {
    try {
      const list = JSON.parse(rs.stdout);
      if (Array.isArray(list)) {
        for (const item of list) {
          existingRulesets.push({ id: item.id, name: item.name, target: item.target });
        }
      }
    } catch {
      /* rulesets no parseables: se ignoran */
    }
  }
  enabledById.ruleset_branch = existingRulesets.some((r) => r.name === RULESET_BRANCH_NAME);
  enabledById.ruleset_tags = existingRulesets.some((r) => r.name === RULESET_TAGS_NAME);

  return { enabledById, existingRulesets };
}

function hasLocalCi() {
  return exists(path.join(REPO, ".github", "workflows")).catch(() => false);
}

async function fetchRepoInfo(repoSlug) {
  // gh repo view no expone "permissions": visibilidad/branch vienen de ahí,
  // los permisos reales (admin) de la API REST.
  const view = await gh([
    "repo",
    "view",
    repoSlug,
    "--json",
    "visibility,defaultBranchRef",
    "--jq",
    "{ visibility: .visibility, defaultBranch: .defaultBranchRef.name }",
  ]);
  if (view.code !== 0) return { ok: false, error: ghErrorText(view.stderr) };
  const parsed = JSON.parse(view.stdout);
  const perm = await gh(["api", `/repos/${repoSlug}`, "--jq", ".permissions.admin"]);
  const isAdmin = perm.code === 0 && perm.stdout.trim() === "true";
  return {
    ok: true,
    visibility: classifyVisibility(parsed.visibility),
    defaultBranch: parsed.defaultBranch ?? "main",
    isAdmin,
  };
}

async function runAudit() {
  const repoResolved = await resolveOwnerRepo();
  if (!repoResolved.ok) return { ok: false, error: repoResolved.error };
  const { owner, repo } = repoResolved;

  const ghCli = await hasGh();
  if (!ghCli) {
    return {
      ok: false,
      error:
        "GitHub CLI (gh) no está instalado. Instalalo desde https://cli.github.com y autenticá con `gh auth login`.",
    };
  }

  const info = await fetchRepoInfo(`${owner}/${repo}`);
  if (!info.ok) {
    return {
      ok: false,
      error: `No se pudo obtener info del repo ${owner}/${repo}: ${info.error}`,
    };
  }
  const { visibility, isAdmin, defaultBranch } = info;

  const { enabledById, existingRulesets } = await collectRepoState({
    owner,
    repo,
    visibility,
    defaultBranch,
    hasGhCli: ghCli,
  });

  const features = buildFeatureCatalog({ visibility, isAdmin, defaultBranch, enabledById });

  return {
    ok: true,
    owner,
    repo,
    visibility,
    defaultBranch,
    isAdmin,
    hasGh: true,
    hasCi: await hasLocalCi(),
    auditedAt: Date.now(),
    existingRulesets,
    features,
  };
}

// ─── Apply: aplicación de selecciones ─────────────────────────────────────

function log(line) {
  process.stdout.write(`${line}\n`);
}

async function writeTempJson(name, data) {
  const file = path.join(os.tmpdir(), name);
  await writeFile(file, JSON.stringify(data), "utf8");
  return file;
}

async function putEndpoint(ctx, endpointPath) {
  const r = await gh(["api", "--method", "PUT", "--silent", endpointPath]);
  return r.code === 0 ? { ok: true } : { ok: false, reason: ghErrorText(r.stderr) };
}

async function patchSecurityAndAnalysis(ctx, payload) {
  const bodyFile = await writeTempJson(`termcanvas-patch-${Date.now()}.json`, {
    security_and_analysis: payload,
  });
  try {
    const r = await gh(["api", "--method", "PATCH", `/repos/${ctx.repoSlug}`, "--input", bodyFile]);
    return r.code === 0 ? { ok: true } : { ok: false, reason: ghErrorText(r.stderr) };
  } finally {
    await rm(bodyFile, { force: true }).catch(() => {});
  }
}

async function upsertRuleset(ctx, name, body) {
  const bodyFile = await writeTempJson(`termcanvas-ruleset-${Date.now()}.json`, body);
  try {
    const existing = ctx.existingRulesets.find((r) => r.name === name);
    const args = existing
      ? ["api", "--method", "PUT", `/repos/${ctx.repoSlug}/rulesets/${existing.id}`, "--input", bodyFile]
      : ["api", "--method", "POST", `/repos/${ctx.repoSlug}/rulesets`, "--input", bodyFile];
    const r = await gh(args);
    if (r.code !== 0) return { ok: false, reason: ghErrorText(r.stderr) };
    try {
      const created = JSON.parse(r.stdout);
      return {
        ok: true,
        note: existing ? `actualizado (ruleset #${existing.id})` : `creado (ruleset #${created.id})`,
      };
    } catch {
      return { ok: true, note: existing ? "actualizado" : "creado" };
    }
  } finally {
    await rm(bodyFile, { force: true }).catch(() => {});
  }
}

const APPLY_ACTIONS = {
  dependabot_alerts: async (ctx) => putEndpoint(ctx, `/repos/${ctx.repoSlug}/vulnerability-alerts`),
  dependabot_security_updates: async (ctx) =>
    putEndpoint(ctx, `/repos/${ctx.repoSlug}/automated-security-fixes`),
  secret_scanning: async (ctx) =>
    patchSecurityAndAnalysis(ctx, { secret_scanning: { status: "enabled" } }),
  push_protection: async (ctx) =>
    patchSecurityAndAnalysis(ctx, { secret_scanning_push_protection: { status: "enabled" } }),
  private_vuln_reporting: async (ctx) =>
    putEndpoint(ctx, `/repos/${ctx.repoSlug}/private-vulnerability-reporting`),
  code_scanning: async (ctx) => {
    const bodyFile = await writeTempJson(`termcanvas-codeql-${Date.now()}.json`, {
      state: "configured",
      query_suite: "default",
    });
    try {
      const r = await gh([
        "api",
        "--method",
        "POST",
        `/repos/${ctx.repoSlug}/code-scanning/default-setup`,
        "--input",
        bodyFile,
      ]);
      return r.code === 0 ? { ok: true } : { ok: false, reason: ghErrorText(r.stderr) };
    } finally {
      await rm(bodyFile, { force: true }).catch(() => {});
    }
  },
  ruleset_branch: async (ctx) => {
    const sub = ctx.subOptions.ruleset_branch ?? [];
    const body = rulesetBranchBody(ctx.defaultBranch, sub);
    if (body.rules.length === 0) {
      return { ok: false, reason: "sin reglas seleccionadas en el ruleset de rama" };
    }
    return upsertRuleset(ctx, RULESET_BRANCH_NAME, body);
  },
  ruleset_tags: async (ctx) => {
    const sub = ctx.subOptions.ruleset_tags ?? [];
    const body = rulesetTagsBody(sub);
    if (body.rules.length === 0) {
      return { ok: false, reason: "sin reglas seleccionadas en el ruleset de tags" };
    }
    return upsertRuleset(ctx, RULESET_TAGS_NAME, body);
  },
};

async function runApply() {
  // Las selecciones llegan inline (--selections-json, tamaño chico, evita
  // problemas de directorios que no existen) o por archivo (--selections).
  let rawSelections;
  if (SELECTIONS_JSON !== null) {
    try {
      rawSelections = JSON.parse(SELECTIONS_JSON);
    } catch {
      process.stderr.write("[security] --selections-json no es JSON válido\n");
      process.exitCode = 1;
      return;
    }
  } else {
    if (!SELECTIONS_PATH) {
      process.stderr.write("[security] falta --selections-json o --selections <archivo.json>\n");
      process.exitCode = 1;
      return;
    }
    if (!(await exists(SELECTIONS_PATH))) {
      process.stderr.write(`[security] no existe el archivo de selecciones: ${SELECTIONS_PATH}\n`);
      process.exitCode = 1;
      return;
    }
    try {
      rawSelections = JSON.parse(await readFile(SELECTIONS_PATH, "utf8"));
    } catch {
      process.stderr.write("[security] el archivo de selecciones no es JSON válido\n");
      process.exitCode = 1;
      return;
    }
  }

  const parsed = parseSelections(rawSelections);
  const { features: selectedFeatures, subOptions } = parsed;

  const repoResolved = await resolveOwnerRepo();
  if (!repoResolved.ok) {
    process.stderr.write(`[security] ${repoResolved.error}\n`);
    process.exitCode = 1;
    return;
  }
  const { owner, repo } = repoResolved;
  const repoSlug = `${owner}/${repo}`;

  const ghCli = await hasGh();
  if (!ghCli) {
    process.stderr.write("[security] gh CLI no está instalado — no se puede aplicar.\n");
    process.exitCode = 1;
    return;
  }

  log(`> git remote get-url origin`);
  log(`✓ Repositorio: ${repoSlug}`);

  const info = await fetchRepoInfo(repoSlug);
  if (!info.ok) {
    process.stderr.write(`[security] no se pudo verificar el repo: ${info.error}\n`);
    process.exitCode = 1;
    return;
  }
  const { visibility, isAdmin, defaultBranch } = info;
  log(`✓ Visibilidad: ${visibility} · admin: ${isAdmin ? "sí" : "no"}`);

  // Estado fresco de rulesets al momento de aplicar (para el upsert).
  const { existingRulesets } = await collectRepoState({
    owner,
    repo,
    visibility,
    defaultBranch,
    hasGhCli: true,
  });

  const ctx = { repoSlug, owner, repo, visibility, isAdmin, defaultBranch, existingRulesets, subOptions };
  const results = [];
  const catalogById = new Map(SECURITY_FEATURE_CATALOG.map((f) => [f.id, f]));

  for (const featureId of selectedFeatures) {
    const feature = catalogById.get(featureId);
    const action = APPLY_ACTIONS[featureId];
    const label = feature?.label ?? featureId;

    if (!action) {
      log(`⚠ ${featureId}: acción no implementada — omitido`);
      results.push({ id: featureId, status: "skip", reason: "acción no implementada" });
      continue;
    }
    if (!isAdmin) {
      log(`⚠ ${label}: omitido — sin permisos de admin en el repositorio`);
      results.push({ id: featureId, status: "skip", reason: "sin permisos de admin" });
      continue;
    }
    if (feature && !featureIsFree(feature, visibility)) {
      const reason =
        feature.id === "secret_scanning" || feature.id === "push_protection"
          ? "requiere GitHub Secret Protection (pago)"
          : feature.id === "code_scanning"
            ? "requiere GitHub Code Security (pago)"
            : "solo repos públicos";
      log(`⚠ ${label}: omitido — ${reason}`);
      results.push({ id: featureId, status: "skip", reason });
      continue;
    }

    log(`> gh api --method ${featureId.startsWith("ruleset") ? "POST/PUT" : "PATCH/PUT"} /repos/${repoSlug} (${featureId})`);
    const res = await action(ctx);
    if (res.ok) {
      log(`✓ ${label}: activado${res.note ? ` (${res.note})` : ""}`);
      results.push({ id: featureId, status: "ok", reason: null });
    } else {
      log(`✗ ${label}: error — ${res.reason ?? "desconocido"}`);
      results.push({ id: featureId, status: "error", reason: res.reason ?? "error desconocido" });
    }
  }

  if (selectedFeatures.length === 0) {
    log("⚠ No hay features seleccionadas para aplicar.");
  }

  const summary = {
    ok: results.filter((r) => r.status === "ok").length,
    skip: results.filter((r) => r.status === "skip").length,
    error: results.filter((r) => r.status === "error").length,
  };
  log(`Resumen: ${summary.ok} ok · ${summary.skip} skip · ${summary.error} error`);

  await mkdir(OUT_DIR, { recursive: true });
  const ts = Date.now();
  const output = {
    timestamp: ts,
    owner,
    repo,
    visibility,
    features: results,
    summary,
  };
  const resultPath = path.join(OUT_DIR, `security-result-${ts}.json`);
  await writeFile(resultPath, JSON.stringify(output, null, 2), "utf8");
  log(`Resultado JSON: ${resultPath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  if (MODE === "audit") {
    const result = await runAudit();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  await runApply();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`\n[security] error fatal: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
