/**
 * Heurística free para modelos opencode — Ola 2 P0-1.
 * Lista opencode free es implícita (sin campo price explícito en /provider).
 * Heurística: isFree = provider==="opencode" || modelID.includes("free") || KNOWN_FREE_SET
 * No rompe si /provider añade modelos nuevos — fallback a paid.
 */

export const KNOWN_FREE_SET = new Set<string>([
  "muse-spark-1.2",
  "muse-spark-1.2-contributor-free",
  "glm-5",
  "glm-5.2",
  "gemini-3-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-flash",
]);

export type FreeCheckInput = {
  providerID: string;
  modelID: string;
};

/**
 * Returns true if model is considered FREE tier.
 * - todo provider "opencode" es free-tier por definición PRD
 * - modelID contiene "free"
 * - modelID está en KNOWN_FREE_SET (muse-spark, glm-5, gemini flash)
 */
export function isModelFree(input: FreeCheckInput): boolean {
  if (!input || typeof input.providerID !== "string" || typeof input.modelID !== "string") return false;
  if (input.providerID === "opencode") return true;
  if (input.modelID.includes("free")) return true;
  if (KNOWN_FREE_SET.has(input.modelID)) return true;
  // also handle full id like "opencode/muse-spark-1.2" passed as modelID erroneously
  const short = input.modelID.split("/").pop() ?? input.modelID;
  if (KNOWN_FREE_SET.has(short)) return true;
  if (short.includes("free")) return true;
  return false;
}

/**
 * Alias para compatibilidad: isFreeModel(providerID, modelID)
 */
export function isFreeModel(providerID: string, modelID: string): boolean {
  return isModelFree({ providerID, modelID });
}

export type PriceTier = "free" | "paid";

export type FreeEnriched<T extends FreeCheckInput> = T & {
  isFree: boolean;
  priceTier: PriceTier;
};

/**
 * Enriquece un array de modelos con isFree + priceTier.
 * No muta entrada original — devuelve copias shallow.
 */
export function enrichWithFreeFlag<T extends FreeCheckInput>(models: T[]): FreeEnriched<T>[] {
  return models.map((m) => {
    const free = isModelFree(m);
    return {
      ...m,
      isFree: free,
      priceTier: free ? "free" : "paid",
    } as FreeEnriched<T>;
  });
}

/**
 * Enriquece ModelsByProvider map con isFree flag.
 * Input: Record<providerID, LoadedModel[]>  => Output mismo shape con isFree añadido.
 */
export function enrichModelsMapWithFree<T extends FreeCheckInput>(
  map: Record<string, T[]>,
): Record<string, FreeEnriched<T>[]> {
  const out: Record<string, FreeEnriched<T>[]> = {};
  for (const [provider, list] of Object.entries(map)) {
    out[provider] = enrichWithFreeFlag(list.map((m) => ({ ...m, providerID: m.providerID || provider } as T)));
  }
  return out;
}
