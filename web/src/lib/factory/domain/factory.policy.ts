// FactoryPolicy — SRP: solo la regla "una policy por factory" y el glosario de la triada (US-006).
// DIP: recibe el record por parámetro; no lee stores ni React.
// Source: WarpFactories.md §2 "Cada factory aplica una sola policy", §14 Sizing · US-005, US-006

import { ParseResult } from "./result";
import type { FactoryRecord } from "./factory.record";

export interface FactoryPolicy {
  readonly id: string;
  readonly label: string; // ES
  readonly specApproval: boolean; // §3 spec approval gate
  readonly requireReview: boolean;
  readonly mergePolicy: "never" | "human"; // §3: la factory nunca mergea
}

/**
 * Policy aplicada al crear una factory. §3: la factory nunca mergea por sí sola,
 * exige aprobación del spec y revisión humana antes del handoff.
 */
export const DEFAULT_POLICY: FactoryPolicy = {
  id: "default",
  label: "Policy por defecto",
  specApproval: true,
  requireReview: true,
  mergePolicy: "never",
};

/**
 * Policies alternativas ofrecidas por el diálogo de alta. Son datos puros: el dominio
 * no decide cuál aplica, solo que **no se pueden aplicar dos a la misma factory**.
 */
export const ALTERNATE_POLICIES: readonly FactoryPolicy[] = [
  {
    id: "expedite",
    label: "Expedite (sin aprobación de spec)",
    specApproval: false,
    requireReview: true,
    mergePolicy: "never",
  },
  {
    id: "human-merge",
    label: "Merge humano permitido",
    specApproval: true,
    requireReview: true,
    mergePolicy: "human",
  },
];

export const TWO_POLICIES_MESSAGE =
  "Una factory aplica una sola policy. Para otra policy, creá una factory separada (§2, §14).";

/**
 * §2: "Cada factory aplica una sola policy a todas sus work sources. Para grupos de
 * repos que necesitan policies distintas, se despliegan factories separadas."
 *
 * Una factory aplica exactamente una policy. El `DEFAULT_POLICY` es la policy que ya
 * tiene una factory recién creada; sustituirla por otra sería introducir una segunda
 * policy, por lo que se rechaza con `two_policies`. Reaplicar la misma policy es idempotente.
 */
export function enforceSinglePolicy(
  record: FactoryRecord,
  candidate: FactoryPolicy
): ParseResult<FactoryRecord> {
  if (record.policyId !== candidate.id) {
    return ParseResult.singleFail("policyId", TWO_POLICIES_MESSAGE, "two_policies");
  }
  return ParseResult.ok({ ...record, policyId: candidate.id });
}

/** La policy efectiva de una factory: la explícita si la tiene, si no la por defecto. */
export function resolvePolicy(record: FactoryRecord): FactoryPolicy {
  const all: readonly FactoryPolicy[] = [DEFAULT_POLICY, ...ALTERNATE_POLICIES];
  return all.find((p) => p.id === record.policyId) ?? DEFAULT_POLICY;
}

// ——— US-006 — triada, datos puros para el glosario ———

export interface GlossaryEntry {
  readonly term: string;
  readonly definition: string;
  readonly trace: string;
}

/** Warp Factories (producto) / factory (instancia) / foreman (agente) — §1 Visión General, §15 Glosario. */
export const FACTORY_GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: "Warp Factories",
    definition:
      "El producto de Warp que corre software factories en la nube: fleets coordinadas de agentes especializados que convierten requests (bug reports, feature specs, escalaciones) en un stream de pull requests mergeables.",
    trace: "WarpFactories.md §1 · US-006",
  },
  {
    term: "factory",
    definition:
      "Una instancia desplegada del patrón: conecta repositorios y herramientas a un equipo de agentes, infra de ejecución y un workflow medible. Se sizea por product surface, no por workflow. Aplica una sola policy.",
    trace: "WarpFactories.md §1, §14 · US-006",
  },
  {
    term: "foreman",
    definition:
      "El agente coordinador dentro de una factory y el único con el que habla el humano (Slack, Linear, etc.). Despacha a los demás agentes, reporta de vuelta y cada factory tiene exactamente uno. Su handle es el Foreman name (alias).",
    trace: "WarpFactories.md §1, §15 · US-006",
  },
];
