// Cargador del catálogo de tácticas de arquitectura (Bass/Clements/Kazman,
// apunte de la materia) empaquetado como recurso estático de la app en
// resources/architecture-tactics/<categoria>.md — uno por categoría.
//
// analyzeTacticForAsr inyecta inline SOLO el archivo de la categoría del ASR
// con la orden de usar EXCLUSIVAMENTE esas tácticas; el guardrail del
// predicate rechaza cualquier nombre_tactica que no matchee un heading real
// (#### ) del archivo cargado — el reintento del motor hace el resto.
//
// La ruta base se configura desde electron main (prod: process.resourcesPath/
// architecture-tactics; dev: <repo>/resources/architecture-tactics) para no
// acoplar el motor a electron. Los tests fijan su propio fixture.

import fs from "node:fs";
import path from "node:path";
import type { CategoriaTactica } from "../../shared/tacticCategorias.ts";

let baseDirConfigurada: string | null = null;

export function setCatalogoTacticasBaseDir(dir: string): void {
  baseDirConfigurada = dir;
}

function baseDir(): string {
  if (baseDirConfigurada && fs.existsSync(baseDirConfigurada)) return baseDirConfigurada;
  // Fallback dev: cwd del proceso (electron main y tests corren desde la raíz).
  return path.resolve(process.cwd(), "resources", "architecture-tactics");
}

export function rutaCatalogoTacticas(categoria: CategoriaTactica): string {
  return path.join(baseDir(), `${categoria}.md`);
}

// ─── Normalización y matching de nombres ─────────────────────────────────
// Los headings traen énfasis markdown (*Ping/Echo*), alias ("-o latido-"),
// guiones especiales (‑) y acentos. El guardrail compara POR TOKENS: la
// candidata valida si TODOS sus tokens aparecen en UN heading del catálogo.
// Así "Gestionar pedidos de trabajo" matchea "Gestionar los pedidos de
// trabajo" sin aceptar nombres inventados ("Cache" no está en rendimiento).

const STOPWORDS = new Set(["de", "la", "el", "los", "las", "del", "al", "a", "o", "u", "y", "en", "para"]);

export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[*_`]/g, "")
    .replace(/[\u2011\u00ad]/g, "-")
    .toLowerCase();
}

export function tokensDe(texto: string): Set<string> {
  const limpio = normalizarTexto(texto);
  const out = new Set<string>();
  for (const token of limpio.split(/[^a-z0-9]+/)) {
    if (token.length >= 3 && !STOPWORDS.has(token)) out.add(token);
  }
  return out;
}

/** Headings `#### ` del catálogo = tácticas reales del archivo. */
export function extraerHeadingsTacticas(markdown: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(/^####\s+(.+)$/gm)) {
    out.push(m[1].trim());
  }
  return out;
}

/**
 * Guardrail: true si el nombre de la candidata matchea algún heading real.
 * Match = todos los tokens de la candidata (≥1) están presentes en los
 * tokens de un heading. Nombres inventados no tienen sus tokens en el
 * catálogo y fallan → el motor reintenta.
 */
export function matcheaCatalogo(nombreCandidata: string, headings: string[]): boolean {
  const tokensCandidata = tokensDe(nombreCandidata);
  if (tokensCandidata.size === 0) return false;
  for (const heading of headings) {
    const tokensHeading = tokensDe(heading);
    let todos = true;
    for (const t of tokensCandidata) {
      if (!tokensHeading.has(t)) {
        todos = false;
        break;
      }
    }
    if (todos) return true;
  }
  return false;
}

export interface CatalogoTacticas {
  categoria: CategoriaTactica;
  /** Contenido COMPLETO del archivo (va inline al prompt). */
  contenido: string;
  /** Tácticas reales según los headings `#### ` del archivo. */
  headings: string[];
}

export function cargarCatalogoTacticas(categoria: CategoriaTactica): CatalogoTacticas {
  const ruta = rutaCatalogoTacticas(categoria);
  if (!fs.existsSync(ruta)) {
    throw new Error(
      `El catálogo de tácticas no tiene el archivo de "${categoria}" (${ruta}). Verificá resources/architecture-tactics.`,
    );
  }
  const contenido = fs.readFileSync(ruta, "utf-8");
  const headings = extraerHeadingsTacticas(contenido);
  if (headings.length === 0) {
    throw new Error(`El catálogo de "${categoria}" no tiene headings de tácticas (#### ).`);
  }
  return { categoria, contenido, headings };
}
