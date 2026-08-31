import test from "node:test";
import assert from "node:assert/strict";
import {
  DIAGNOSIS_CATEGORIES,
} from "../src/types/diagnosisCategories.ts";
import {
  DELIVERY_SKILLS,
  SPECIALIZED_SKILLS,
  categoryIdFromLabels,
  diagnosisAllowedSkills,
  getSpecializedSkill,
  issueResolveAllowedSkills,
  skillForCategory,
  specializedSkillName,
  validateSpecializedSkills,
} from "../src/skills/registry.ts";
import {
  buildSkillScopeConfig,
  renderSkillMd,
} from "../src/skills/scopedSession.ts";

// Las skills especializadas son la contraparte de DIAGNOSIS_CATEGORIES en el
// pipeline de scoping (scopedSession): cada categoría debe tener EXACTAMENTE
// una skill con nombre diag-<id>, y la config scopeada debe permitir solo la
// allowlist pedida. Este test fija esa integridad.

test("validación estructural del registro sin errores", () => {
  assert.deepEqual(validateSpecializedSkills(), []);
});

test("sincronización: cada categoría registrada tiene su skill diag-<id>", () => {
  for (const cat of DIAGNOSIS_CATEGORIES) {
    const skill = skillForCategory(cat.id);
    assert.ok(skill, `la categoría ${cat.id} no tiene skill`);
    assert.equal(skill.name, specializedSkillName(cat.id));
    assert.equal(skill.categoryId, cat.id);
    // La descripción viaja al <available_skills> de cada sesión scopeada:
    // una línea y sustanciosa.
    assert.ok(!skill.description.includes("\n"));
    assert.ok(skill.description.trim().length >= 40);
  }
});

test("nombres únicos y lookup por name", () => {
  const names = SPECIALIZED_SKILLS.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.equal(getSpecializedSkill(name)?.name, name);
  }
  assert.equal(getSpecializedSkill("no-existe"), undefined);
});

test("allowlist de diagnóstico: SOLO la skill de la categoría", () => {
  for (const cat of DIAGNOSIS_CATEGORIES) {
    assert.deepEqual(diagnosisAllowedSkills(cat.id), [
      specializedSkillName(cat.id),
    ]);
  }
  assert.deepEqual(diagnosisAllowedSkills("categoria-inexistente"), []);
});

test("allowlist de resolución: skill de categoría + delivery skills", () => {
  const allow = issueResolveAllowedSkills("seguridad");
  assert.equal(allow[0], "diag-seguridad");
  for (const delivery of DELIVERY_SKILLS) {
    assert.ok(allow.includes(delivery), `falta ${delivery}`);
  }
});

test("categoryIdFromLabels: lee cat:<id>, ignora inválidas y ausentes", () => {
  assert.equal(
    categoryIdFromLabels([{ name: "bug" }, { name: "cat:seguridad" }]),
    "seguridad",
  );
  assert.equal(categoryIdFromLabels(["cat:no-existe"]), null);
  assert.equal(categoryIdFromLabels([{ name: "bug" }]), null);
  assert.equal(categoryIdFromLabels(undefined), null);
});

test("renderSkillMd: frontmatter válido con name + description", () => {
  const skill = skillForCategory("seguridad")!;
  const md = renderSkillMd(skill);
  assert.match(md, /^---\nname: diag-seguridad\ndescription: .+\n---\n/);
  assert.ok(md.includes(skill.body));
});

test("buildSkillScopeConfig: deny-all + allows exactos, '*' ignorado como allow", () => {
  const config = buildSkillScopeConfig("/tmp/scope-x", [
    "diag-seguridad",
    "tdd",
    "*",
    "",
  ]);
  assert.deepEqual(config.skills.paths, ["/tmp/scope-x"]);
  assert.equal(config.permission.skill["*"], "deny");
  assert.equal(config.permission.skill["diag-seguridad"], "allow");
  assert.equal(config.permission.skill["tdd"], "allow");
  // Ni "*" ni "" pisan el deny-all ni generan entradas basura.
  assert.equal(Object.keys(config.permission.skill).length, 3);
});
