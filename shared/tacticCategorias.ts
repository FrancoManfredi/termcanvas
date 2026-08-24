// Categorías del catálogo de tácticas de arquitectura (Bass/Clements/Kazman,
// apunte de la materia) + mapeo del texto libre "atributo" de la síntesis a
// una categoría. Módulo PURO (sin node:fs): lo consume el motor (headless)
// y la UI (renderer) para el fallback manual cuando el mapeo no es confiado.
//
// "protección" (safety: evitar/detectar/remediar estados inseguros) y
// "seguridad" (security: resistir ataques no autorizados) son categorías
// DISTINTAS en el catálogo — el orden de evaluación del mapeo privilegia
// keywords específicas de protección antes que las genéricas de seguridad.

export const CATEGORIAS_TACTICAS = [
  "disponibilidad",
  "rendimiento",
  "proteccion",
  "seguridad",
  "eficiencia_energetica",
  "modificabilidad",
  "despliegue",
] as const;

export type CategoriaTactica = (typeof CATEGORIAS_TACTICAS)[number];

export function isCategoriaTactica(value: unknown): value is CategoriaTactica {
  return typeof value === "string" && (CATEGORIAS_TACTICAS as readonly string[]).includes(value);
}

/** Label legible por categoría (UI: select de fallback manual, tarjetas). */
export const CATEGORIA_LABELS: Record<CategoriaTactica, string> = {
  disponibilidad: "Disponibilidad",
  rendimiento: "Rendimiento",
  proteccion: "Protección",
  seguridad: "Seguridad",
  eficiencia_energetica: "Eficiencia energética",
  modificabilidad: "Modificabilidad",
  despliegue: "Despliegue",
};

function quitarAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizar(texto: string): string {
  return quitarAcentos(texto).toLowerCase().replace(/\s+/g, " ").trim();
}

// Keywords por categoría: primarias = match confiado; secundarias = match
// dudoso que la UI ofrece reemplazar manualmente. Evaluación en el orden del
// array (proteccion antes que seguridad) y primarias antes que secundarias.
const KEYWORDS: Record<
  CategoriaTactica,
  { primarias: string[]; secundarias: string[] }
> = {
  proteccion: {
    primarias: ["proteccion", "safety"],
    secundarias: ["estado inseguro", "peligro", "catastrof", "interlock"],
  },
  seguridad: {
    primarias: ["seguridad", "security"],
    secundarias: ["intrusion", "ataque", "cifrad", "encript", "confidencialidad", "autenticacion", "autorizacion", "credenciales"],
  },
  disponibilidad: {
    primarias: ["disponibilidad"],
    secundarias: ["falla", "caida", "uptime", "indisponib", "tolerancia a fallos"],
  },
  rendimiento: {
    primarias: ["rendimiento", "performance"],
    secundarias: ["latencia", "throughput", "velocidad", "tiempo de respuesta"],
  },
  eficiencia_energetica: {
    primarias: ["eficiencia energetica", "energetica", "energy"],
    secundarias: ["consumo", "bateria", "energia"],
  },
  modificabilidad: {
    primarias: ["modificabilidad", "mantenibilidad"],
    secundarias: ["facilidad de modificacion", "modificacion", "evolutiv", "extensib", "flexibil"],
  },
  despliegue: {
    primarias: ["despliegue", "deployment"],
    secundarias: ["instalac", "release", "entrega continua", "actualizacion de versiones"],
  },
};

export interface MapeoCategoria {
  categoria: CategoriaTactica | null;
  /** false = match débil o inexistente: la UI ofrece selección manual. */
  confiado: boolean;
}

/**
 * Mapea el texto libre `atributo` de un ASR a una categoría del catálogo.
 * Nunca lanza: sin match devuelve { categoria: null, confiado: false }.
 */
export function mapearAtributoACategoria(atributo: string): MapeoCategoria {
  const texto = normalizar(atributo ?? "");
  if (!texto) return { categoria: null, confiado: false };

  // El valor ya es una categoría del catálogo (con o sin acentos).
  for (const categoria of CATEGORIAS_TACTICAS) {
    if (texto === normalizar(categoria)) return { categoria, confiado: true };
  }

  let mejor: { categoria: CategoriaTactica; confiado: boolean } | null = null;
  for (const categoria of CATEGORIAS_TACTICAS) {
    const kw = KEYWORDS[categoria];
    if (kw.primarias.some((p) => texto.includes(p))) {
      // Primaria gana a cualquier secundaria previa.
      return { categoria, confiado: true };
    }
    if (mejor === null && kw.secundarias.some((s) => texto.includes(s))) {
      mejor = { categoria, confiado: false };
    }
  }
  return mejor ?? { categoria: null, confiado: false };
}
