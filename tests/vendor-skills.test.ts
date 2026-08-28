import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverVendorSkills,
  normalizeVendorSkill,
  parseSkillFrontmatter,
  vendorCategoryDir,
  type VendorFsLike,
} from "../src/skills/vendorSkills.ts";

// Las skills vendor son material del USUARIO: carpetas con SKILL.md bajo
// resources/diagnosis-skills/<categoria>/. Este test fija las reglas de
// admisión (slug válido, prefijo diag- reservado, frontmatter tolerante) y
// el descubrimiento best-effort (nada de lo que pase en esa carpeta puede
// romper el lanzamiento de un diagnóstico).

// Fake mínimo del bridge fs: keys = rutas de ARCHIVOS; los directorios se
// infieren por anidación (igual que haría listDir sobre disco real).
function makeFs(files: Record<string, string>): VendorFsLike {
  const allPaths = Object.keys(files);
  return {
    async listDir(dirPath) {
      const norm = dirPath.replace(/\/+$/, "");
      const names = new Map<string, boolean>();
      for (const p of allPaths) {
        if (!p.startsWith(`${norm}/`)) continue;
        const [head, ...tail] = p.slice(norm.length + 1).split("/");
        if (!head) continue;
        names.set(head, names.get(head) || tail.length > 0);
      }
      return [...names].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
    async readFile(filePath) {
      const hit = files[filePath];
      return hit === undefined
        ? { error: "ENOENT" }
        : { type: "text", content: hit };
    },
  };
}

const REPO = "C:/repo";

test("vendorCategoryDir: arma la ruta y tolera slashes finales", () => {
  assert.equal(
    vendorCategoryDir("C:/repo/", "seguridad"),
    "C:/repo/.agents/diagnosis-skills/seguridad",
  );
  assert.equal(
    vendorCategoryDir("C:\\repo\\", "seguridad"),
    "C:\\repo/.agents/diagnosis-skills/seguridad",
  );
});

test("parseSkillFrontmatter: extrae name/description; sin frontmatter devuelve vacío", () => {
  const full = parseSkillFrontmatter(
    "---\nname: mi-skill\ndescription: Revisa X\n---\n\n# Cuerpo\n",
  );
  assert.deepEqual(full, { name: "mi-skill", description: "Revisa X" });

  // CRLF + espacios alrededor del valor.
  const crlf = parseSkillFrontmatter("---\r\nname: otra\r\ndescription:  Y \r\n---\r\nbody");
  assert.deepEqual(crlf, { name: "otra", description: "Y" });

  assert.deepEqual(parseSkillFrontmatter("# Sin frontmatter\n"), {});
  // Frontmatter sin cierre (archivo truncado) → {}: defaults, nunca crash.
  assert.deepEqual(parseSkillFrontmatter("---\nname: truncado\n"), {});
});

test("normalizeVendorSkill: frontmatter name gana sobre carpeta; defaults sanos", () => {
  const result = normalizeVendorSkill(
    "carpeta-distinta",
    "---\nname: mi-skill\ndescription: Una línea\n---\ncuerpo",
  );
  assert.ok(result.ok);
  assert.equal(result.skill.name, "mi-skill");
  assert.equal(result.skill.description, "Una línea");
  // El raw viaja TAL CUAL (frontmatter incluido): material del usuario.
  assert.match(result.skill.raw, /^---\nname: mi-skill/);

  const fallback = normalizeVendorSkill("solo-carpeta", "# Sin frontmatter");
  assert.ok(fallback.ok);
  assert.equal(fallback.skill.name, "solo-carpeta");
  assert.ok(fallback.skill.description.length > 0);
  assert.ok(!fallback.skill.description.includes("\n"));
});

test("normalizeVendorSkill: descripción multilínea se colapsa a una línea", () => {
  const result = normalizeVendorSkill(
    "skill-x",
    "---\ndescription: línea uno\n  continuación indentada\n---\nx",
  );
  assert.ok(result.ok);
  assert.equal(result.skill.description, "línea uno continuación indentada");
});

test("normalizeVendorSkill: rechaza prefijo reservado diag-, slugs inválidos y contenido vacío", () => {
  const reservedFolder = normalizeVendorSkill("diag-seguridad", "# x");
  assert.ok(!reservedFolder.ok);
  assert.match(reservedFolder.reason, /diag-/);

  const reservedFm = normalizeVendorSkill("ok-name", "---\nname: diag-otro\n---\nx");
  assert.ok(!reservedFm.ok);

  const badSlug = normalizeVendorSkill("Mala Carpeta", "# x");
  assert.ok(!badSlug.ok);

  const badName = normalizeVendorSkill("ok-name", "---\nname: Con Mayúsculas\n---\nx");
  assert.ok(!badName.ok);

  const empty = normalizeVendorSkill("ok-name", "   \n");
  assert.ok(!empty.ok);
});

test("discoverVendorSkills: descubre, ordena alfabético y usa el nombre resuelto", () => {
  const io = makeFs({
    // Dos carpetas con SKILL.md válido; zeta debe salir DESPUÉS de alpha.
    [`${REPO}/resources/diagnosis-skills/seguridad/zeta/SKILL.md`]:
      "---\nname: zeta-skill\ndescription: Z\n---\nz",
    [`${REPO}/resources/diagnosis-skills/seguridad/alpha/SKILL.md`]:
      "---\nname: alpha-skill\ndescription: A\n---\na",
  });
  return discoverVendorSkills(io, REPO, "seguridad").then((skills) => {
    assert.deepEqual(
      skills.map((s) => s.name),
      ["alpha-skill", "zeta-skill"],
    );
  });
});

test("discoverVendorSkills: omite basura sin romperse (sin SKILL.md, archivos sueltos, carpeta rota)", () => {
  const io = makeFs({
    // Válida.
    [`${REPO}/resources/diagnosis-skills/proteccion/buena/SKILL.md`]: "# ok",
    // Carpeta SIN SKILL.md (readFile falla → se omite).
    [`${REPO}/resources/diagnosis-skills/proteccion/vacia/otro.txt`]: "x",
    // Archivo suelto en la raíz de la categoría (no es directorio).
    [`${REPO}/resources/diagnosis-skills/proteccion/README.md`]: "nota",
  });
  return discoverVendorSkills(io, REPO, "proteccion").then((skills) => {
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.name, "buena");
  });
});

test("discoverVendorSkills: deduplica por nombre resuelto y descarta inválidas", () => {
  const io = makeFs({
    [`${REPO}/resources/diagnosis-skills/diseno-patrones/a-dup/SKILL.md`]:
      "---\nname: mismo-nombre\ndescription: primera\n---\n1",
    [`${REPO}/resources/diagnosis-skills/diseno-patrones/b-dup/SKILL.md`]:
      "---\nname: mismo-nombre\ndescription: segunda\n---\n2",
    [`${REPO}/resources/diagnosis-skills/diseno-patrones/reservada/SKILL.md`]:
      "---\nname: diag-fake\n---\n3",
  });
  return discoverVendorSkills(io, REPO, "diseno-patrones").then((skills) => {
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.description, "primera");
  });
});

test("discoverVendorSkills: sin bridge, sin carpeta o categoría vacía → [] y nunca lanza", async () => {
  assert.deepEqual(await discoverVendorSkills(null, REPO, "seguridad"), []);
  assert.deepEqual(await discoverVendorSkills(undefined, REPO, "seguridad"), []);

  // listDir falla (carpeta inexistente) → [].
  const brokenIo: VendorFsLike = {
    listDir: async () => {
      throw new Error("ENOENT");
    },
    readFile: async () => ({ error: "ENOENT" }),
  };
  assert.deepEqual(await discoverVendorSkills(brokenIo, REPO, "seguridad"), []);

  // Carpeta existente pero vacía.
  assert.deepEqual(
    await discoverVendorSkills(makeFs({}), REPO, "organizacion"),
    [],
  );
});
