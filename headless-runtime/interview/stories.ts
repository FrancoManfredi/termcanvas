// Curaduría de historias de usuario sobre una síntesis existente: añadir,
// editar, eliminar y recuperar. Son operaciones SIN llamadas al modelo (el
// dueño ajusta el artefacto). La relación RF ↔ historia es N:N (un RF puede
// formalizar varias historias vía historias_origen; una historia puede ser
// formalizada por varios RFs), así que eliminar/recuperar una historia
// quita/restaura su id de TODOS los RFs que la referenciaban.
//
// Toda mutación escribe el JSON standalone (entrevista-<ts>-sintesis.json) Y
// el ledger (entrevista-<ts>.json → ledger.synthesis.data): la UI lee del
// ledger y los prompts de orquestador leen del standalone — ambos deben
// quedar iguales o se desincronizan. El archivo solo se escribe tras validar
// el documento completo en memoria; ante fallo, queda intacto.

import fs from "node:fs";
import { loadLedger, saveLedger } from "./engine.ts";
import { loadSynthesis } from "./requirements.ts";
import {
  SynthesisSchema,
  UserStoryInputSchema,
  type SynthesisResult,
  type UserStoryInput,
  type UserStory,
  type DeletedUserStory,
} from "./schema.ts";

export type StoryMutationResult =
  | { ok: true; synthesis: SynthesisResult }
  | { ok: false; error: string };

// De la ruta del JSON standalone se deriva la del ledger (misma base, sin el
// sufijo -sintesis).
function ledgerPathOf(synthesisPath: string): string {
  return synthesisPath.replace(/-sintesis\.json$/, ".json");
}

// Valida el documento y lo persiste en AMBOS archivos. Carga el ledger ANTES
// de escribir el standalone: si el ledger falta, falla sin tocar nada.
export function persistSynthesis(synthesisPath: string, synthesis: SynthesisResult): SynthesisResult {
  const parsed = SynthesisSchema.safeParse(synthesis);
  if (!parsed.success) {
    throw new Error("La síntesis modificada no validó el contrato.");
  }
  const data = parsed.data;
  const ledgerPath = ledgerPathOf(synthesisPath);
  const ledger = loadLedger(ledgerPath);
  ledger.synthesis = { at: new Date().toISOString(), data };
  fs.writeFileSync(synthesisPath, JSON.stringify(data, null, 2));
  saveLedger(ledgerPath, ledger);
  return data;
}

// Orden canónico de las historias: por id numérico ascendente (HS-001, HS-002…).
// Se aplica en cada mutación para que el artefacto persista ordenado y la UI
// lo muestre siempre de menor a mayor (incluso tras añadir/eliminar/recuperar).
export function sortStoriesById<T extends { id: string }>(items: T[]): T[] {
  const num = (id: string) => {
    const m = /^HS-(\d+)$/.exec(id);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  return [...items].sort((a, b) => num(a.id) - num(b.id));
}

// Aplica una mutación pura a la síntesis cargada (normalizada al contrato N:N)
// y persiste. El `fn` puede tirar para señalar errores de negocio (p.ej.
// "historia no encontrada") — se devuelven como { ok: false }.
export function mutateSynthesis(
  synthesisPath: string,
  fn: (syn: SynthesisResult) => SynthesisResult,
): StoryMutationResult {
  const synthesis = loadSynthesis(synthesisPath);
  if (!synthesis) {
    return { ok: false, error: "La síntesis no existe o no es válida." };
  }
  try {
    const next = fn(synthesis);
    next.historias_de_usuario = sortStoriesById(next.historias_de_usuario ?? []);
    next.historias_eliminadas = sortStoriesById(next.historias_eliminadas ?? []);
    const persisted = persistSynthesis(synthesisPath, next);
    return { ok: true, synthesis: persisted };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function nextStoryId(synthesis: SynthesisResult): string {
  let max = 0;
  for (const h of [...(synthesis.historias_de_usuario ?? []), ...(synthesis.historias_eliminadas ?? [])]) {
    const m = /^HS-(\d+)$/.exec(h.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `HS-${String(max + 1).padStart(3, "0")}`;
}

function validateUserStoryInput(input: UserStoryInput): { ok: true; data: UserStoryInput } | { ok: false; error: string } {
  const parsed = UserStoryInputSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first ? first.message : "Datos inválidos." };
  }
  const d = parsed.data;
  if (!d.rol.trim() || !d.quiero.trim() || !d.para.trim()) {
    return { ok: false, error: "Completá los campos obligatorios (rol, quiero, para)." };
  }
  return { ok: true, data: d };
}

// ─── Añadir ────────────────────────────────────────────────────────────────
// Valida el input (rol/quiero/para obligatorios), genera el id siguiente sin
// colisión con las eliminadas y marca origen: "manual" (trazabilidad).
export function addUserStory(synthesisPath: string, input: UserStoryInput): StoryMutationResult {
  const v = validateUserStoryInput(input);
  if (!v.ok) return v;
  const d = v.data;
  return mutateSynthesis(synthesisPath, (syn) => {
    const historia: UserStory = {
      id: nextStoryId(syn),
      titulo: d.titulo !== undefined ? d.titulo.trim() || "(sin titulo)" : "(sin titulo)",
      rol: d.rol.trim(),
      quiero: d.quiero.trim(),
      para: d.para.trim(),
      prioridad: d.prioridad !== undefined ? d.prioridad.trim() || "(sin prioridad)" : "(sin prioridad)",
      criterios_de_aceptacion: (d.criterios_de_aceptacion ?? []).map((c) => c.trim()).filter(Boolean),
      origen: "manual",
    };
    return { ...syn, historias_de_usuario: [...(syn.historias_de_usuario ?? []), historia] };
  });
}

// ─── Editar ────────────────────────────────────────────────────────────────
// Reemplaza los campos editables PRESERVANDO id y origen (identidad y
// trazabilidad a la evidencia o a "manual" no se tocan).
export function updateUserStory(synthesisPath: string, storyId: string, input: UserStoryInput): StoryMutationResult {
  const v = validateUserStoryInput(input);
  if (!v.ok) return v;
  const d = v.data;
  return mutateSynthesis(synthesisPath, (syn) => {
    const stories = syn.historias_de_usuario ?? [];
    const idx = stories.findIndex((h) => h.id === storyId);
    if (idx === -1) throw new Error(`Historia ${storyId} no encontrada.`);
    const prev = stories[idx];
    const updated: UserStory = {
      ...prev,
      titulo: d.titulo !== undefined ? d.titulo.trim() || "(sin titulo)" : prev.titulo,
      rol: d.rol.trim(),
      quiero: d.quiero.trim(),
      para: d.para.trim(),
      prioridad: d.prioridad !== undefined ? d.prioridad.trim() || "(sin prioridad)" : prev.prioridad,
      criterios_de_aceptacion:
        d.criterios_de_aceptacion !== undefined
          ? d.criterios_de_aceptacion.map((c) => c.trim()).filter(Boolean)
          : prev.criterios_de_aceptacion,
    };
    const next = [...stories];
    next[idx] = updated;
    return { ...syn, historias_de_usuario: next };
  });
}

// ─── Eliminar (soft delete) ────────────────────────────────────────────────
// Mueve la historia a historias_eliminadas como tombstone (conservando los
// RFs que la referenciaban para poder restaurarlos) y QUITA su id de
// historias_origen de TODOS los RFs.
export function deleteUserStory(synthesisPath: string, storyId: string): StoryMutationResult {
  return mutateSynthesis(synthesisPath, (syn) => {
    const stories = syn.historias_de_usuario ?? [];
    const story = stories.find((h) => h.id === storyId);
    if (!story) throw new Error(`Historia ${storyId} no encontrada.`);
    const rfIds = (syn.requerimientos_funcionales ?? [])
      .filter((r) => (r.historias_origen ?? []).includes(storyId))
      .map((r) => r.id);
    const tombstone: DeletedUserStory = {
      ...story,
      eliminada_at: new Date().toISOString(),
      rf_ids_origen: rfIds,
    };
    return {
      ...syn,
      historias_de_usuario: stories.filter((h) => h.id !== storyId),
      historias_eliminadas: [...(syn.historias_eliminadas ?? []), tombstone],
      requerimientos_funcionales: (syn.requerimientos_funcionales ?? []).map((r) => ({
        ...r,
        // Limpia también el campo LEGADO (1:N) para que normalizeSynthesis no
        // re-derive el vínculo recién eliminado.
        historia_origen: r.historia_origen === storyId ? "(sin historia)" : r.historia_origen,
        historias_origen: (r.historias_origen ?? []).filter((id) => id !== storyId),
      })),
    };
  });
}

// ─── Recuperar ─────────────────────────────────────────────────────────────
// Restaura la historia a historias_de_usuario y re-agrega su id a
// historias_origen de los RFs que la referenciaban al eliminarla (solo si
// todavía existen y no volvieron a incorporarla).
export function recoverUserStory(synthesisPath: string, storyId: string): StoryMutationResult {
  return mutateSynthesis(synthesisPath, (syn) => {
    const deleted = syn.historias_eliminadas ?? [];
    const tomb = deleted.find((d) => d.id === storyId);
    if (!tomb) throw new Error(`Historia eliminada ${storyId} no encontrada.`);
    const { eliminada_at, rf_ids_origen, ...story } = tomb;
    return {
      ...syn,
      historias_de_usuario: [...(syn.historias_de_usuario ?? []), story],
      historias_eliminadas: deleted.filter((d) => d.id !== storyId),
      requerimientos_funcionales: (syn.requerimientos_funcionales ?? []).map((r) => {
        if ((r.historias_origen ?? []).includes(storyId) || !rf_ids_origen.includes(r.id)) return r;
        return { ...r, historias_origen: [...(r.historias_origen ?? []), storyId] };
      }),
    };
  });
}

// Eliminación DEFINITIVA de un tombstone de historia (sin recuperación).
export function purgeUserStory(synthesisPath: string, storyId: string): StoryMutationResult {
  return mutateSynthesis(synthesisPath, (syn) => {
    const deleted = syn.historias_eliminadas ?? [];
    if (!deleted.some((d) => d.id === storyId)) throw new Error(`Historia eliminada ${storyId} no encontrada.`);
    return { ...syn, historias_eliminadas: deleted.filter((d) => d.id !== storyId) };
  });
}
