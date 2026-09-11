// Registro ÚNICO de skills especializadas scopeadas (Capa 1).
//
// Cada entrada se materializa como un SKILL.md efímero por corrida
// (src/skills/scopedSession.ts) y se permite vía permission.skill en una
// config opencode scopeada: el agente de esa sesión ve EXACTAMENTE las
// skills allowlisteadas y NINGUNA otra (ni globales ni de otras categorías).
//
// Agregar una skill nueva = crear su contenido en src/skills/content/ y
// sumar UNA entrada acá. El test tests/specialized-skills.test.ts garantiza:
// - todo DiagnosisCategoryId tiene su skill (o está marcado sin skill),
// - nombres únicos y formato válido,
// - descripciones de una línea (viajan al <available_skills> de cada sesión).

import type { DiagnosisCategoryId } from "../types/diagnosisCategories.ts";
import {
  DIAGNOSIS_CATEGORIES,
  isDiagnosisCategoryId,
} from "../types/diagnosisCategories.ts";
import { diagDisenoPatronesBody } from "./content/diag-diseno-patrones.ts";
import { diagOrganizacionBody } from "./content/diag-organizacion.ts";
import { diagDocumentacionBody } from "./content/diag-documentacion.ts";
import { diagSeguridadBody } from "./content/diag-seguridad.ts";
import { diagProteccionBody } from "./content/diag-proteccion.ts";
import { diagRendimientoBody } from "./content/diag-rendimiento.ts";
import { diagBuenasPracticasBody } from "./content/diag-buenas-practicas.ts";
import { diagRequerimientosBody } from "./content/diag-requerimientos.ts";

export interface SpecializedSkill {
  // Nombre opencode de la skill: convención diag-<category-id>. Es el valor
  // que viaja al allowlist de permission.skill y al <name> del frontmatter.
  name: string;
  title: string;
  // Una línea: es lo único del skill que paga tokens en cada sesión
  // scopeada (el cuerpo completo carga on-demand vía herramienta skill).
  description: string;
  // Categoría de diagnóstico que la usa. null = skill transversal (no atada
  // a una categoría; ej: para fases futuras como roadmap o fix directo).
  categoryId: DiagnosisCategoryId | null;
  // Cuerpo markdown del SKILL.md (sin frontmatter: lo arma scopedSession).
  body: string;
}

export function specializedSkillName(categoryId: string): string {
  return `diag-${categoryId}`;
}

export const SPECIALIZED_SKILLS: readonly SpecializedSkill[] = [
  {
    name: specializedSkillName("diseno-patrones"),
    title: "Diagnóstico: Patrones de Diseño",
    description:
      "Metodología para diagnosticar SOLID, cohesión/acoplamiento y patrones bien o mal aplicados. Usar en la categoría Patrones de Diseño.",
    categoryId: "diseno-patrones",
    body: diagDisenoPatronesBody,
  },
  {
    name: specializedSkillName("organizacion"),
    title: "Diagnóstico: Organización",
    description:
      "Metodología para auditar estructura de carpetas, límites entre módulos y código muerto. Usar en la categoría Organización.",
    categoryId: "organizacion",
    body: diagOrganizacionBody,
  },
  {
    name: specializedSkillName("documentacion"),
    title: "Diagnóstico: Documentación",
    description:
      "Metodología para evaluar JSDoc/TSDoc, READMEs que mienten y comentarios útiles vs ruido. Usar en la categoría Documentación.",
    categoryId: "documentacion",
    body: diagDocumentacionBody,
  },
  {
    name: specializedSkillName("seguridad"),
    title: "Diagnóstico: Seguridad",
    description:
      "Metodología para auditar superficie de ataque más allá de los scanners: autorización, IPC, secretos no estándar, workflows CI. Usar en la categoría Seguridad.",
    categoryId: "seguridad",
    body: diagSeguridadBody,
  },
  {
    name: specializedSkillName("proteccion"),
    title: "Diagnóstico: Protección",
    description:
      "Metodología para detectar estados inseguros ante fallos: errores tragados, I/O sin timeout/retry, puntos únicos de fallo. Usar en la categoría Protección.",
    categoryId: "proteccion",
    body: diagProteccionBody,
  },
  {
    name: specializedSkillName("rendimiento"),
    title: "Diagnóstico: Escalabilidad y Rendimiento",
    description:
      "Metodología para encontrar trabajo desperdiciado medible: complejidad innecesaria, N+1, fugas de memoria, camino crítico. Usar en la categoría Rendimiento.",
    categoryId: "rendimiento",
    body: diagRendimientoBody,
  },
  {
    name: specializedSkillName("buenas-practicas"),
    title: "Diagnóstico: Buenas Prácticas",
    description:
      "Metodología para triagear higiene general: bugs latentes, errores de tipos, duplicación con riesgo de divergencia, deps. Usar en Buenas Prácticas.",
    categoryId: "buenas-practicas",
    body: diagBuenasPracticasBody,
  },
  {
    name: specializedSkillName("requerimientos"),
    title: "Diagnóstico: Requerimientos",
    description:
      "Método para veredictos CUMPLE/NO_CUMPLE/PARCIAL/NO_VERIFICABLE de requerimientos relevados contra el código real. Usar en la categoría Requerimientos.",
    categoryId: "requerimientos",
    body: diagRequerimientosBody,
  },
] as const;

// Skills por nombre (lookup O(1)).
const BY_NAME = new Map(SPECIALIZED_SKILLS.map((s) => [s.name, s]));

export function getSpecializedSkill(name: string): SpecializedSkill | undefined {
  return BY_NAME.get(name);
}

// Skill asociada a una categoría de diagnóstico (o null si no tiene).
export function skillForCategory(
  categoryId: string,
): SpecializedSkill | null {
  return (
    SPECIALIZED_SKILLS.find((s) => s.categoryId === categoryId) ?? null
  );
}

// Allowlist para la Fase B del diagnóstico por categorías: SOLO la skill de
// esa categoría. Ninguna otra skill (ni global ni de otra categoría) queda
// visible en esa sesión.
export function diagnosisAllowedSkills(categoryId: string): string[] {
  return skillForCategory(categoryId)
    ? [specializedSkillName(categoryId)]
    : [];
}

// Skills de ENTREGA referenciadas por nombre desde issueResolvePrompt: viven
// instaladas globalmente (~/.agents/skills), no las empaqueta esta app. Se
// listan acá para que el scoping de sesiones de resolución las permita junto
// a la skill de la categoría del issue. Un nombre inexistente es tolerado
// por opencode (simplemente no se anuncia).
export const DELIVERY_SKILLS: readonly string[] = [
  "tdd",
  "branch-pr",
  "chained-pr",
];

// Extrae la categoría de diagnóstico del issue desde sus labels de GitHub
// (convención cat:<category-id>, escrita al crear issues desde un
// diagnóstico). Acepta labels de IssueNodeData ({name}) o strings crudos.
// Devuelve null si no hay label válida: el issue se resuelve sin scoping.
//
// Defensive normalization (same pattern as liveIssues normalizeLabels):
// non-array `labels` (legacy persisted string, null/undefined, GraphQL
// `{ nodes }` connection object, any other junk) → null instead of
// throwing `(labels ?? []) is not iterable`. Junk array entries (null,
// numbers, objects without a string `name`) are skipped, never dereferenced.
export function categoryIdFromLabels(
  labels: unknown,
): DiagnosisCategoryId | null {
  if (!Array.isArray(labels)) return null;
  for (const label of labels) {
    const name =
      typeof label === "string"
        ? label
        : typeof label === "object" && label !== null
          ? (label as { name?: unknown }).name
          : undefined;
    if (typeof name !== "string" || !name.startsWith("cat:")) continue;
    const id = name.slice(4);
    if (isDiagnosisCategoryId(id)) return id;
  }
  return null;
}

// Allowlist para una sesión de RESOLUCIÓN de issue: la skill especializada
// de la categoría del issue + las delivery skills que el prompt referencia
// por nombre. Nada más queda visible en esa sesión.
export function issueResolveAllowedSkills(categoryId: string): string[] {
  return [specializedSkillName(categoryId), ...DELIVERY_SKILLS];
}

// Verificación estructural interna: cada categoría registrada debe tener
// exactamente una skill con categoryId apuntándole. La versión completa
// (descripciones, formato, unicidad) vive en tests/specialized-skills.test.ts;
// esto existe para fallar temprano ante ediciones descuidadas del array.
export function validateSpecializedSkills(): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const skill of SPECIALIZED_SKILLS) {
    if (!/^diag-[a-z][a-z-]*$/.test(skill.name)) {
      errors.push(`nombre inválido: "${skill.name}" (esperado diag-<slug>)`);
    }
    if (names.has(skill.name)) errors.push(`nombre duplicado: ${skill.name}`);
    names.add(skill.name);
    if (skill.description.includes("\n")) {
      errors.push(`descripción multilínea en ${skill.name}`);
    }
    if (skill.body.trim().length < 200) {
      errors.push(`cuerpo demasiado corto en ${skill.name}`);
    }
  }
  for (const category of DIAGNOSIS_CATEGORIES) {
    const matches = SPECIALIZED_SKILLS.filter(
      (s) => s.categoryId === category.id,
    );
    if (matches.length !== 1) {
      errors.push(
        `categoría "${category.id}" tiene ${matches.length} skills (esperado 1)`,
      );
    }
  }
  return errors;
}
