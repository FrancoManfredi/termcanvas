import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyVisibility,
  featureIsFree,
  buildFeatureCatalog,
  rulesetBranchBody,
  rulesetTagsBody,
  parseSelections,
  SECURITY_FEATURE_CATALOG,
} from "../scripts/configure-github-security.mjs";

// ─── classifyVisibility ──────────────────────────────────────────────────

test("classifyVisibility: normaliza PUBLIC/PRIVATE/INTERNAL", () => {
  assert.equal(classifyVisibility("PUBLIC"), "public");
  assert.equal(classifyVisibility("PRIVATE"), "private");
  assert.equal(classifyVisibility("INTERNAL"), "internal");
  assert.equal(classifyVisibility("public"), "public");
  assert.equal(classifyVisibility(undefined), "private");
  assert.equal(classifyVisibility(""), "private");
});

// ─── featureIsFree ────────────────────────────────────────────────────────

test("featureIsFree: secret scanning gratis solo en público", () => {
  const secretScanning = SECURITY_FEATURE_CATALOG.find((f) => f.id === "secret_scanning");
  assert.ok(secretScanning);
  assert.ok(featureIsFree(secretScanning, "public"));
  assert.ok(!featureIsFree(secretScanning, "private"));
  assert.ok(!featureIsFree(secretScanning, "internal"));
});

test("featureIsFree: dependabot alerts gratis en público y privado", () => {
  const dependabot = SECURITY_FEATURE_CATALOG.find((f) => f.id === "dependabot_alerts");
  assert.ok(dependabot);
  assert.ok(featureIsFree(dependabot, "public"));
  assert.ok(featureIsFree(dependabot, "private"));
});

// ─── buildFeatureCatalog ──────────────────────────────────────────────────

function catalogFor(partial: {
  visibility?: string;
  isAdmin?: boolean;
  enabledById?: Record<string, boolean>;
}) {
  return buildFeatureCatalog({
    visibility: classifyVisibility(partial.visibility ?? "PUBLIC"),
    isAdmin: partial.isAdmin ?? true,
    defaultBranch: "main",
    enabledById: partial.enabledById ?? {},
  });
}

function byId(features, id) {
  const f = features.find((x) => x.id === id);
  assert.ok(f, `feature ${id} presente`);
  return f;
}

test("buildFeatureCatalog: repo público admin → features pagas y públicas seleccionables", () => {
  const features = catalogFor({ visibility: "PUBLIC" });
  assert.ok(byId(features, "secret_scanning").selectable);
  assert.ok(byId(features, "push_protection").selectable);
  assert.ok(byId(features, "code_scanning").selectable);
  assert.ok(byId(features, "private_vuln_reporting").selectable);
  assert.ok(byId(features, "dependabot_alerts").selectable);
  assert.ok(byId(features, "ruleset_branch").selectable);
});

test("buildFeatureCatalog: repo privado → secret/code scanning deshabilitadas con motivo pago", () => {
  const features = catalogFor({ visibility: "PRIVATE" });
  const ss = byId(features, "secret_scanning");
  assert.equal(ss.selectable, false);
  assert.equal(ss.reason, "Requiere GitHub Secret Protection (pago)");
  assert.equal(byId(features, "push_protection").reason, "Requiere GitHub Secret Protection (pago)");
  assert.equal(byId(features, "code_scanning").reason, "Requiere GitHub Code Security (pago)");
  assert.equal(byId(features, "private_vuln_reporting").reason, "Solo repos públicos");
  // Gratis también en privado:
  assert.ok(byId(features, "dependabot_alerts").selectable);
  assert.ok(byId(features, "dependabot_security_updates").selectable);
  assert.ok(byId(features, "ruleset_branch").selectable);
});

test("buildFeatureCatalog: internal se trata como privado", () => {
  const features = catalogFor({ visibility: "INTERNAL" });
  assert.ok(!byId(features, "secret_scanning").selectable);
  assert.ok(byId(features, "dependabot_alerts").selectable);
});

test("buildFeatureCatalog: sin admin → nada seleccionable con motivo claro", () => {
  const features = catalogFor({ visibility: "PUBLIC", isAdmin: false });
  for (const f of features) {
    assert.equal(f.selectable, false);
    assert.equal(f.reason, "Sin permisos de admin en el repositorio");
  }
});

test("buildFeatureCatalog: feature ya activa → no seleccionable, etiqueta 'Ya activo'", () => {
  const features = catalogFor({
    visibility: "PUBLIC",
    enabledById: { dependabot_alerts: true, secret_scanning: true },
  });
  const dep = byId(features, "dependabot_alerts");
  assert.equal(dep.enabled, true);
  assert.equal(dep.selectable, false);
  assert.equal(dep.stateLabel, "Ya activo");
  assert.equal(dep.reason, null);
  assert.ok(byId(features, "push_protection").selectable);
});

test("buildFeatureCatalog: features fileBased → info no seleccionable", () => {
  const features = catalogFor({ visibility: "PUBLIC" });
  const depReview = byId(features, "dependency_review");
  assert.equal(depReview.selectable, false);
  assert.match(depReview.reason ?? "", /workflow\/PR/);
  assert.equal(byId(features, "dependabot_version_updates").selectable, false);
});

test("buildFeatureCatalog: sub-opciones con defaultOn y warning de las avanzadas", () => {
  const features = catalogFor({ visibility: "PUBLIC" });
  const ruleset = byId(features, "ruleset_branch");
  const sub = new Map(ruleset.subOptions.map((o) => [o.id, o]));
  assert.equal(sub.get("block_force_push").defaultOn, true);
  assert.equal(sub.get("require_pull_request").tier, "advanced");
  assert.match(sub.get("require_pull_request").warning ?? "", /PR/);
  assert.equal(sub.get("require_signed_commits").tier, "advanced");
});

// ─── rulesetBranchBody / rulesetTagsBody ──────────────────────────────────

test("rulesetBranchBody: reglas según sub-opciones activadas", () => {
  const body = rulesetBranchBody("main", [
    "block_force_push",
    "block_deletion",
    "require_conversation_resolution",
    "require_pull_request",
    "require_signed_commits",
  ]);
  assert.equal(body.name, "termcanvas-seguridad");
  assert.equal(body.target, "branch");
  assert.equal(body.enforcement, "active");
  assert.deepEqual(body.conditions.ref_name.include, ["refs/heads/main"]);
  const types = body.rules.map((r) => r.type);
  assert.deepEqual(types, [
    "non_fast_forward",
    "deletion",
    "required_conversation_resolution",
    "pull_request",
    "required_commit_signature",
  ]);
  const pr = body.rules.find((r) => r.type === "pull_request");
  assert.equal(pr.parameters.required_approving_review_count, 1);
  assert.equal(pr.parameters.require_last_push_approval, true);
});

test("rulesetBranchBody: sin sub-opciones → rules vacío", () => {
  const body = rulesetBranchBody("main", []);
  assert.deepEqual(body.rules, []);
});

test("rulesetTagsBody: non_fast_forward + deletion sobre refs/tags/*", () => {
  const body = rulesetTagsBody(["block_force_push", "block_deletion"]);
  assert.equal(body.target, "tag");
  assert.deepEqual(body.conditions.ref_name.include, ["refs/tags/*"]);
  assert.deepEqual(body.rules.map((r) => r.type), ["non_fast_forward", "deletion"]);
});

// ─── parseSelections ──────────────────────────────────────────────────────

test("parseSelections: valida features y descarta sub-opciones desconocidas", () => {
  const parsed = parseSelections({
    features: ["dependabot_alerts", "no-existe"],
    subOptions: { dependabot_alerts: ["raro"] },
  });
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.features, ["dependabot_alerts"]);
  assert.deepEqual(parsed.subOptions.dependabot_alerts, []);
  assert.ok(parsed.errors.some((e) => e.includes("no-existe")));
  assert.ok(parsed.errors.some((e) => e.includes("raro")));
});

test("parseSelections: JSON inválido → error", () => {
  const parsed = parseSelections("{no-json");
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.features, []);
});

test("parseSelections: selecciones válidas pasan intactas", () => {
  const parsed = parseSelections({
    features: ["ruleset_branch", "dependabot_alerts"],
    subOptions: {
      ruleset_branch: ["block_force_push", "block_deletion", "require_pull_request"],
    },
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.features, ["ruleset_branch", "dependabot_alerts"]);
  assert.deepEqual(parsed.subOptions.ruleset_branch, [
    "block_force_push",
    "block_deletion",
    "require_pull_request",
  ]);
});
