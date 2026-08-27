// Skills "vendor" por categoría: carpetas con SKILL.md que el usuario baja
// del ecosistema (o escribe a mano) y suelta en
//
//   <app>/resources/diagnosis-skills/<category-id>/<nombre>/SKILL.md            (compartido, git-tracked)
//   <userData>/diagnosis-skills/<category-id>/<nombre>/SKILL.md                 (privado, por instalación)
//   <repo>/resources/diagnosis-skills/<category-id>/<nombre>/SKILL.md           (per-repo, legacy override)
//
// Cada corrida de esa categoría las materializa DENTRO del scope efímero
// (scopedSession) junto a la skill diag-<id>: visibles SOLO durante la
// sesión, borradas al terminar. Nunca se instalan globalmente.
//
// Convención de nombre: el nombre de la skill es el frontmatter `name` del
// SKILL.md; si no tiene, cae al nombre de la carpeta. El prefijo `diag-` está
// RESERVADO para las skills especializadas del registro (registry.ts): un
// vendor con ese prefijo se rechaza, no se renombra.
//
// v1: una sola pieza por skill (SKILL.md suelto). Skills con scripts o
// subcarpetas quedan fuera de este camino.

export interface VendorSkill {
  // Nombre final de la skill (frontmatter name > nombre de carpeta). Es el
  // valor que viaja al allowlist de permission.skill.
  name: string;
  // Una línea para el <available_skills> de la sesión scopeada y para el
  // anuncio del prompt.
  description: string;
  // Contenido crudo del SKILL.md tal cual (frontmatter incluido): se copia
  // idéntico al scope — el material del usuario no se re-renderiza.
  raw: string;
}

// Subconjunto estructural del bridge fs (window.termcanvas.fs) que usa el
// descubrimiento. Inyectable: los tests pasan un fake sin Electron.
export interface VendorFsLike {
  listDir(
    dirPath: string,
  ): Promise<{ name: string; isDirectory: boolean }[]>;
  readFile(
    filePath: string,
  ): Promise<
    { type: string; content: string } | { error: string; size?: string }
  >;
}

const VENDOR_SKILLS_ROOT = "resources/diagnosis-skills";
// Subcarpeta bajo userData para skills privadas (no compartidas con el equipo).
const VENDOR_SKILLS_PRIVATE_ROOT = "diagnosis-skills";

export function vendorCategoryDir(
  repoPath: string,
  categoryId: string,
): string {
  const root = repoPath.replace(/[\\/]+$/, "");
  return `${root}/${VENDOR_SKILLS_ROOT}/${categoryId}`;
}

export function vendorCategoryDirForRoot(
  rootDir: string,
  categoryId: string,
): string {
  const root = rootDir.replace(/[\\/]+$/, "");
  // rootDir ya es el root de vendor (ej. appResources/diagnosis-skills o userData/diagnosis-skills)
  // Si rootDir termina en diagnosis-skills, solo agregamos categoría; si no, agregamos el root.
  if (root.endsWith(VENDOR_SKILLS_ROOT) || root.endsWith(VENDOR_SKILLS_PRIVATE_ROOT)) {
    return `${root}/${categoryId}`;
  }
  return `${root}/${VENDOR_SKILLS_ROOT}/${categoryId}`;
}

// Slug válido para nombre de skill opencode (misma convención que diag-*).
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

// Extrae name/description del frontmatter YAML mínimo de un SKILL.md
// (`---` ... `---` con claves planas). Tolerante con valores multilínea
// plegados (continuación indentada, común en descriptions largas del
// ecosistema). Sin bloque de frontmatter completo (falta el cierre) → {}:
// la normalización resuelve defaults, nunca rompe.
export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  let current: "name" | "description" | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^(name|description):\s*(.*)$/.exec(line.trim());
    if (kv) {
      current = kv[1] as "name" | "description";
      result[current] = kv[2].trim();
      continue;
    }
    // Continuación plegada: línea indentada que extiende el valor previo.
    if (current && /^[ \t]+\S/.test(line) && result[current]) {
      result[current] = `${result[current]} ${line.trim()}`;
    }
  }
  return result;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export type NormalizeResult =
  | { ok: true; skill: VendorSkill }
  | { ok: false; reason: string };

// Normaliza una carpeta candidata (nombre + contenido crudo) a VendorSkill,
// aplicando las reglas de admisión. Puro: testeable sin fs.
export function normalizeVendorSkill(
  folderName: string,
  raw: string,
): NormalizeResult {
  if (!NAME_PATTERN.test(folderName)) {
    return {
      ok: false,
      reason: `"${folderName}": el nombre de carpeta debe ser slug [a-z0-9-] empezando con letra`,
    };
  }
  if (!raw.trim()) {
    return { ok: false, reason: `"${folderName}": SKILL.md vacío` };
  }
  const fm = parseSkillFrontmatter(raw);
  const name = oneLine(fm.name ?? "") || folderName;
  if (!NAME_PATTERN.test(name)) {
    return {
      ok: false,
      reason: `"${folderName}": frontmatter name "${name}" no es slug [a-z0-9-] empezando con letra`,
    };
  }
  // Prefijo reservado: las skills diag-* son SOLO del registro interno.
  if (name.startsWith("diag-")) {
    return {
      ok: false,
      reason: `"${folderName}": el prefijo diag- está reservado para las skills internas del registro`,
    };
  }
  const description =
    oneLine(fm.description ?? "") ||
    "Material de referencia provisto por el usuario para esta categoría.";
  return {
    ok: true,
    skill: {
      name,
      description: description.slice(0, 300),
      raw: raw,
    },
  };
}

/**
 * Descubre las skills vendor de una categoría. Best-effort total: carpeta
 * inexistente, bridge ausente (tests/no-Electron), permisos o un SKILL.md
 * roto → se omite y la categoría corre sin él. NUNCA lanza ni bloquea el
 * lanzamiento del diagnóstico. Determinista: orden alfabético por carpeta,
 * primer nombre gana ante duplicados.
 */
export async function discoverVendorSkills(
  io: VendorFsLike | null | undefined,
  repoPath: string,
  categoryId: string,
): Promise<VendorSkill[]> {
  if (!io) return [];
  const baseDir = vendorCategoryDir(repoPath, categoryId);
  let entries: { name: string; isDirectory: boolean }[];
  try {
    entries = await io.listDir(baseDir);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const skills: VendorSkill[] = [];
  for (const entry of [...entries].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory) continue;
    let read: Awaited<ReturnType<VendorFsLike["readFile"]>>;
    try {
      read = await io.readFile(`${baseDir}/${entry.name}/SKILL.md`);
    } catch {
      continue;
    }
    if ("error" in read || typeof read.content !== "string") continue;
    const normalized = normalizeVendorSkill(entry.name, read.content);
    if (!normalized.ok || seen.has(normalized.skill.name)) continue;
    seen.add(normalized.skill.name);
    skills.push(normalized.skill);
  }
  return skills;
}

export interface VendorSkillWithSource extends VendorSkill {
  source: "shared" | "private" | "repo";
  dirPath: string;
}

/**
 * Descubre skills vendor desde múltiples roots (global compartido, privado,
 * per-repo). Merge determinista: shared → private → repo, primer nombre gana.
 * Cada root puede ser null/undefined (no existe). Nunca lanza.
 */
export async function discoverVendorSkillsMulti(
  io: VendorFsLike | null | undefined,
  roots: Array<{ dir: string | null | undefined; source: VendorSkillWithSource["source"] }>,
  categoryId: string,
): Promise<VendorSkillWithSource[]> {
  if (!io) return [];
  const seen = new Set<string>();
  const out: VendorSkillWithSource[] = [];
  for (const { dir, source } of roots) {
    if (!dir) continue;
    const baseDir = `${dir.replace(/[\\/]+$/, "")}/${categoryId}`;
    let entries: { name: string; isDirectory: boolean }[];
    try {
      entries = await io.listDir(baseDir);
    } catch {
      continue;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory) continue;
      if (seen.has(entry.name)) continue;
      let read: Awaited<ReturnType<VendorFsLike["readFile"]>>;
      try {
        read = await io.readFile(`${baseDir}/${entry.name}/SKILL.md`);
      } catch {
        continue;
      }
      if ("error" in read || typeof read.content !== "string") continue;
      const normalized = normalizeVendorSkill(entry.name, read.content);
      if (!normalized.ok || seen.has(normalized.skill.name)) continue;
      // también dedupe por nombre final resuelto (frontmatter name)
      seen.add(entry.name);
      seen.add(normalized.skill.name);
      out.push({ ...normalized.skill, source, dirPath: `${baseDir}/${entry.name}` });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
