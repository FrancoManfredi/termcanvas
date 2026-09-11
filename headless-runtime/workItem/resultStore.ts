/**
 * ResultStore — tienda única de `result.json` (refactor ①, E1).
 *
 * Un solo escritor con validación zod + escritura atómica tmp→rename:
 * - `writeResult` / `buildResultPayload` / `readResult`: camino rico
 *   (`ImplementResultJson`, con `verification` + `createdFiles`). Delegan en
 *   la implementación interna `ResultWriter` (ese módulo ya NO es público:
 *   nadie nuevo lo importa; solo este store lo usa como motor).
 * - `isRichResultJson` + `pruneIfPoor`: el predicado y la poda que antes
 *   vivían como guard local en `factoryServer.writeJobJson` (H-008). Casa
 *   única a partir de A4; el server delega acá.
 * - `ensureResultJsonCompat`: la escritura legacy enriquecida (forma pobre
 *   con `verification` espejada de la meta del timeline + `createdFiles`,
 *   H-001) mudada desde `workItemDisk.ensureResultJson`. `workItemDisk`
 *   conserva solo una delegación delgada con el mismo nombre (no se borra
 *   el export todavía para no romper imports). Jamás pisa un archivo
 *   existente (H-008 causa 1ª, estructural).
 * - `reconcileCreatedFiles`: punto de conciliación (H-012 implementado acá):
 *   filtra inexistentes contra disco con la MISMA semántica que hoy
 *   (`filterExistingCreatedFiles`, delegación, sin duplicar) + quita
 *   placeholders de carpeta vacía sin archivo pedido
 *   (`stripEmptyFolderPlaceholder`, mismo punto único). Cero kept con algo
 *   declarado → `kept: []` honesto + `dropped` con la evidencia; el caller
 *   anota en timeline y la verificación en fail lleva el job a Triage
 *   (humano decide; esta función pura jamás inventa transiciones).
 *
 * Todo best-effort donde toca disco fuera de `writeResult` (nunca lanza
 * salvo validación zod en `writeResult`/`buildResultPayload`, igual que el
 * motor interno). Sin loops nuevos, cotas heredadas (`IMPLEMENT_MAX_*`).
 */

import fs from "node:fs";
import path from "node:path";
import {
  IMPLEMENT_MAX_CREATED_FILES,
  ImplementResultJsonSchema,
  type ImplementResultJson,
} from "../../shared/types/implement";
import { mapStatusToLegacyState } from "../../shared/types/workItem";
import type { WorkItem } from "../../shared/types/workItem";
import { ResultWriter } from "../implement/resultWriter";
import { filterExistingCreatedFiles, parseRequestedFileName, parseRequestedFromPrompt, stripEmptyFolderPlaceholder } from "../implement/minimalChange";

/** Motor interno único (antes público; jubilado como módulo público en A2). */
const writer = new ResultWriter();

/**
 * H-008 (puro): un `result.json` RICO (con clave `verification`) es
 * evidencia y NO debe borrarse al persistir. Pobre/ausente/corrupto → no rico.
 * Nunca lanza.
 */
export function isRichResultJson(resultPath: string): boolean {
  try {
    if (!resultPath || !fs.existsSync(resultPath)) return false;
    const parsed = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as unknown;
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).verification !== undefined
    );
  } catch {
    return false;
  }
}

/**
 * Construye el payload rico (delega en el motor interno, implementación única).
 * Lanza si la forma no valida (igual que antes).
 */
export function buildResultPayload(params: {
  workItemId: string;
  modelRef?: ImplementResultJson["modelRef"];
  worktreePath: string;
  verification: ImplementResultJson["verification"];
  createdFiles: string[];
  runnerId?: "linux-build";
}): ImplementResultJson {
  return writer.buildPayload(params);
}

/**
 * Escribe `result.json` validando con schema + atómico tmp→rename.
 * Gestiona `.done` (pass→crea, fail→borra), igual que el motor interno.
 * Lanza si el payload no valida o el disco falla (el caller decide el
 * best-effort; `transitionWithVerification` lo envuelve en try/catch).
 */
export function writeResult(
  dir: string,
  payload: ImplementResultJson,
): ImplementResultJson {
  const validated = ImplementResultJsonSchema.parse(payload);
  return writer.write(dir, validated);
}

/**
 * Lee y valida `result.json`. `null` si ausente o inválido (pobre/corrupto).
 * Nunca lanza.
 */
export function readResult(dir: string): ImplementResultJson | null {
  try {
    if (typeof dir !== "string" || dir.length === 0) return null;
    return writer.read(dir);
  } catch {
    return null;
  }
}

export type PruneOutcome = "kept" | "pruned" | "absent";

/**
 * Poda de compat (ex-guard local de `writeJobJson`, H-008): conserva el
 * rico, borra el pobre/corrupto, no toca si ausente. Nunca lanza.
 */
export function pruneIfPoor(dir: string): PruneOutcome {
  try {
    if (typeof dir !== "string" || dir.length === 0) return "absent";
    const resultPath = path.join(dir, "result.json");
    if (!fs.existsSync(resultPath)) return "absent";
    if (isRichResultJson(resultPath)) return "kept";
    try {
      fs.unlinkSync(resultPath);
    } catch {
      // borrado best-effort: el archivo pobre ya se marcó para podar
    }
    return "pruned";
  } catch {
    return "absent";
  }
}

export interface ReconciledCreatedFiles {
  kept: string[];
  dropped: string[];
}

/**
 * Punto de conciliación (H-001 + H-012 en el mismo lugar): conserva solo las
 * rutas que existen en disco, con la MISMA semántica que hoy (delega en
 * `filterExistingCreatedFiles`, sin duplicar) + quita placeholders de carpeta
 * vacía sin archivo pedido (`stripEmptyFolderPlaceholder`, prompt opcional y
 * aditivo: sin prompt el comportamiento es idéntico al de hoy). Cero kept con
 * algo declarado → `kept: []` honesto (no éxito) + `dropped` con la
 * evidencia; el caller anota en timeline y la verificación en fail lleva a
 * Triage (humano decide). Nunca lanza.
 */
export function reconcileCreatedFiles(
  declarados: unknown,
  worktree: unknown,
  prompt?: unknown,
): ReconciledCreatedFiles {
  try {
    if (!Array.isArray(declarados)) return { kept: [], dropped: [] };
    const base =
      typeof worktree === "string" && worktree.length > 0
        ? worktree
        : process.cwd();
    const capped = (declarados as unknown[]).slice(
      0,
      IMPLEMENT_MAX_CREATED_FILES,
    );
    const baseFiltered = filterExistingCreatedFiles(base, capped as string[]);
    try {
      if (typeof prompt === "string" && prompt.length > 0 && baseFiltered.kept.length > 0) {
        const stripped = stripEmptyFolderPlaceholder(base, baseFiltered.kept, prompt);
        if (stripped.length !== baseFiltered.kept.length) {
          const extra = baseFiltered.kept.filter((x) => !stripped.includes(x));
          return {
            kept: stripped,
            dropped: [...baseFiltered.dropped, ...extra].slice(0, IMPLEMENT_MAX_CREATED_FILES),
          };
        }
      }
    } catch {}
    return baseFiltered;
  } catch {
    return { kept: [], dropped: [] };
  }
}

/**
 * H-013 (aditivo, puro salvo existsSync): descubre escrituras tardías en
 * disco que el job pidió pero nunca declaró. Parsea lo pedido del prompt
 * con los parsers existentes (`parseRequestedFromPrompt` para la ruta,
 * `parseRequestedFileName` para el archivo) y devuelve las rutas pedidas
 * que EXISTEN en disco y faltan en `declared`. Jamás inventa rutas: sin
 * parse claro o sin existencia en disco devuelve `[]` (idéntico a hoy).
 * Acotado a `IMPLEMENT_MAX_CREATED_FILES`, sin loops nuevos (un for..of
 * sobre ≤2 candidatas). Nunca lanza.
 */
export function discoverLateCreatedFiles(
  worktree: unknown,
  prompt: unknown,
  declared: unknown,
): string[] {
  try {
    if (typeof prompt !== "string" || prompt.length === 0) return [];
    const base =
      typeof worktree === "string" && worktree.length > 0
        ? path.resolve(worktree)
        : process.cwd();
    const known = new Set<string>();
    try {
      if (Array.isArray(declared)) {
        for (const d of declared as unknown[]) {
          if (typeof d === "string" && d.length > 0) {
            known.add(d.replace(/\\/g, "/"));
          }
        }
      }
    } catch {
      // declarado ilegible: se sigue igual (todo lo existente es novedad)
    }
    let rel = "";
    let isFolder = false;
    try {
      const parsed = parseRequestedFromPrompt(prompt);
      if (!parsed || typeof parsed.relPath !== "string" || parsed.relPath.length === 0) {
        return [];
      }
      rel = parsed.relPath.replace(/\\/g, "/").replace(/\/+$/, "");
      isFolder = parsed.isFolder;
    } catch {
      return [];
    }
    if (!rel || rel === "." || rel === "/" || rel.includes("..")) return [];
    const candidates: string[] = [];
    try {
      if (isFolder) {
        const fileName = parseRequestedFileName(prompt);
        if (
          typeof fileName === "string" &&
          fileName.length > 0 &&
          !fileName.includes("/") &&
          !fileName.includes("\\") &&
          !fileName.includes("..")
        ) {
          // Con archivo pedido: solo hay novedad si el ARCHIVO existe en
          // disco (la carpeta vacía sin archivo es el placeholder H-012 y
          // jamás se propone por esta vía; el punto único la seguiría
          // descartando). Archivo ya declarado → entrega trackeada, nada.
          const fileRel = `${rel}/${fileName}`;
          if (known.has(fileRel)) return [];
          let fileExists = false;
          try {
            fileExists = fs.existsSync(path.join(base, fileRel));
          } catch {
            fileExists = false;
          }
          if (!fileExists) return [];
          candidates.push(fileRel);
        }
        candidates.push(rel);
      } else {
        candidates.push(rel);
      }
    } catch {
      return [];
    }
    const found: string[] = [];
    for (const c of candidates) {
      if (known.has(c)) continue;
      let exists = false;
      try {
        exists = fs.existsSync(path.join(base, c));
      } catch {
        exists = false;
      }
      if (exists) found.push(c);
      if (found.length + known.size >= IMPLEMENT_MAX_CREATED_FILES) break;
    }
    return found;
  } catch {
    return [];
  }
}

export interface ResolvedRetryCreatedFiles extends ReconciledCreatedFiles {
  /** Rutas tardías descubiertas en disco que quedaron trackeadas (⊆ kept). */
  added: string[];
}

/**
 * H-013 (aditivo): compone la lista del verify-retry antes de su transición
 * a Review. Suma a lo previo (`prev`, lo que el fail dejó en `result.json`)
 * lo descubierto en disco (`discoverLateCreatedFiles`, solo existente) y
 * filtra el merged en el punto único (`reconcileCreatedFiles`, misma
 * semántica que hoy, sin duplicar H-001/H-012). Sin late-write el resultado
 * es idéntico a `reconcileCreatedFiles(prev)` (veredicto y transición del
 * reintento intactos: el pass sigue siendo pass). Nunca lanza.
 */
export function resolveVerifyRetryCreatedFiles(
  prev: unknown,
  worktree: unknown,
  prompt: unknown,
): ResolvedRetryCreatedFiles {
  try {
    const prevList = Array.isArray(prev)
      ? (prev as unknown[]).filter(
          (x): x is string => typeof x === "string" && x.length > 0,
        )
      : [];
    let added: string[] = [];
    try {
      added = discoverLateCreatedFiles(worktree, prompt, prevList);
    } catch {
      added = [];
    }
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const c of [...prevList.map((s) => s.replace(/\\/g, "/")), ...added]) {
      if (seen.has(c)) continue;
      seen.add(c);
      if (merged.length >= IMPLEMENT_MAX_CREATED_FILES) break;
      merged.push(c);
    }
    const reconciled = reconcileCreatedFiles(merged, worktree, prompt);
    const keptSet = new Set(reconciled.kept);
    return {
      kept: reconciled.kept,
      dropped: reconciled.dropped,
      added: added.filter((a) => keptSet.has(a)),
    };
  } catch {
    return { kept: [], dropped: [], added: [] };
  }
}

/**
 * Escritura legacy enriquecida (H-001) mudada desde `workItemDisk`:
 * espeja la ÚLTIMA `verification` de la meta del timeline + `createdFiles`
 * top-level (`[]` honesto cuando aún no hay). Solo crea si el archivo NO
 * existe: jamás pisa un rico (H-008 causa 1ª, estructural, no un guard
 * externo). Atómico tmp→rename vía el motor interno. Nunca lanza.
 */
export function ensureResultJsonCompat(item: WorkItem): void {
  try {
    const dir =
      (item as unknown as { dir?: unknown }).dir ?? null;
    if (typeof dir !== "string" || dir.length === 0) return;
    const resultPath = path.join(dir, "result.json");
    if (fs.existsSync(resultPath)) return;
    // H-001 (aditivo): la última verification vive solo en meta del timeline;
    // se espeja acá para que `/:id/result` (VerificationPanel) no lea stale.
    let latestVerification: unknown;
    try {
      const tl = (
        item as unknown as {
          timeline?: Array<{ meta?: Record<string, unknown> }>;
        }
      ).timeline;
      if (Array.isArray(tl)) {
        for (let i = tl.length - 1; i >= 0; i--) {
          const v = tl[i]?.meta?.verification;
          if (v !== undefined) {
            latestVerification = v;
            break;
          }
        }
      }
    } catch {
      // sin meta legible: se escribe sin verification (forma pobre honesta)
    }
    const prompt =
      typeof item.prompt === "string" ? item.prompt : "";
    const result = {
      jobId: item.id,
      phase: item.phase,
      worktree: item.worktree,
      status: item.status,
      state: item.state ?? mapStatusToLegacyState(item.status),
      promptPreview: prompt.slice(0, 120),
      artifacts: [
        path.join(item.worktree, "result.json"),
        path.join(item.worktree, ".done"),
      ],
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      timeline: item.timeline,
      cost: item.cost,
      runnerId: item.runnerId,
      // H-001 (aditivo): createdFiles + verification para igualdad exacta y
      // panel no-stale. createdFiles [] honesto cuando aún no hay (no fantasma).
      createdFiles:
        (item as unknown as { createdFiles?: unknown }).createdFiles ?? [],
      ...(latestVerification !== undefined
        ? { verification: latestVerification }
        : {}),
      summary:
        item.status === "Complete"
          ? "Job completado correctamente (local)."
          : "Job aun no finalizado.",
      ...(item.sessionId ? { sessionId: item.sessionId } : {}),
      ...(item.dashboardUrl ? { dashboardUrl: item.dashboardUrl } : {}),
    };
    writer.writeAtomic(resultPath, JSON.stringify(result, null, 2));
  } catch {
    // best-effort: disco nunca rompe el flujo
  }
}
