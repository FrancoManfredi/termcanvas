import path from "node:path";

/**
 * Pact configuration for playground v2 — file local broker (no PactFlow).
 * Consumer-driven contracts: one consumer per F, single provider FactoryProvider.
 */

export const PACT_DIR = path.resolve("software-testing-playground-v2/pacts");

export const PACT_LOG_LEVEL = "warn" as const;

export const FACTORY_PROVIDER = "FactoryProvider" as const;

export const PACT_SPEC_VERSION = "3" as const;

/**
 * Returns consumer name for a given feature id.
 * Isolation per F: one pact file per F (playground-F01 → playground-F01-FactoryProvider.json).
 */
export function consumerNameFor(featureId: string): string {
  return `playground-${featureId}`;
}
