// Curaduría de ítems de la síntesis (requerimientos funcionales, atributos de
// calidad/ASR, restricciones globales y glosario): añadir, editar, eliminar
// (soft delete) y recuperar. Reutiliza mutateSynthesis de stories.ts (persiste
// el JSON standalone Y el ledger; ordena las listas por id de menor a mayor).
// Sin llamadas al modelo — curaduría pura sobre el artefacto.

import { mutateSynthesis, type StoryMutationResult } from "./stories.ts";
import {
  RfInputSchema,
  AsrInputSchema,
  ConstraintInputSchema,
  TermInputSchema,
  type SynthesisResult,
  type RfInput,
  type AsrInput,
  type ConstraintInput,
  type TermInput,
  type RfItem,
  type AsrItem,
  type ConstraintItem,
  type DeletedRf,
  type DeletedAsr,
  type DeletedConstraint,
  type DeletedTerm,
} from "./schema.ts";

export type CurationKind = "rf" | "asr" | "constraint" | "term";
type ArrayKind = Exclude<CurationKind, "term">;

type IdItem = { id: string };
type ArrayItem = RfItem | AsrItem | ConstraintItem;

// ─── Helpers genéricos ─────────────────────────────────────────────────────

function numericId(id: string): number {
  const m = /-(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function sortById<T extends IdItem>(items: T[]): T[] {
  return [...items].sort((a, b) => numericId(a.id) - numericId(b.id));
}

function nextId(items: IdItem[], prefix: string): string {
  let max = 0;
  for (const it of items) {
    const m = /-(\d+)$/.exec(it.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

function activeList(kind: ArrayKind, syn: SynthesisResult): ArrayItem[] {
  switch (kind) {
    case "rf":
      return syn.requerimientos_funcionales ?? [];
    case "asr":
      return syn.atributos_de_calidad_y_asrs ?? [];
    case "constraint":
      return syn.restricciones_globales ?? [];
  }
}

function deletedList(kind: ArrayKind, syn: SynthesisResult): ArrayItem[] {
  switch (kind) {
    case "rf":
      return (syn.rfs_eliminados ?? []) as unknown as ArrayItem[];
    case "asr":
      return (syn.asrs_eliminados ?? []) as unknown as ArrayItem[];
    case "constraint":
      return (syn.restricciones_eliminadas ?? []) as unknown as ArrayItem[];
  }
}

function withActive(kind: ArrayKind, syn: SynthesisResult, list: ArrayItem[]): SynthesisResult {
  const sorted = sortById(list);
  switch (kind) {
    case "rf":
      return { ...syn, requerimientos_funcionales: sorted as RfItem[] };
    case "asr":
      return { ...syn, atributos_de_calidad_y_asrs: sorted as AsrItem[] };
    case "constraint":
      return { ...syn, restricciones_globales: sorted as ConstraintItem[] };
  }
}

function withDeleted(kind: ArrayKind, syn: SynthesisResult, list: ArrayItem[]): SynthesisResult {
  switch (kind) {
    case "rf":
      return { ...syn, rfs_eliminados: sortById(list) as DeletedRf[] };
    case "asr":
      return { ...syn, asrs_eliminados: sortById(list) as DeletedAsr[] };
    case "constraint":
      return { ...syn, restricciones_eliminadas: sortById(list) as DeletedConstraint[] };
  }
}

function prefixOf(kind: ArrayKind): string {
  return kind === "rf" ? "RF" : kind === "asr" ? "ASR" : "CON";
}

// ─── Validación + construcción de ítems ────────────────────────────────────

function validate(kind: ArrayKind, input: unknown): { ok: true; data: RfInput | AsrInput | ConstraintInput } | { ok: false; error: string } {
  const schema = kind === "rf" ? RfInputSchema : kind === "asr" ? AsrInputSchema : ConstraintInputSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first ? first.message : "Datos inválidos." };
  }
  const d = parsed.data as RfInput | AsrInput | ConstraintInput;
  const required = kind === "rf" ? (d as RfInput).descripcion : kind === "asr" ? (d as AsrInput).atributo : (d as ConstraintInput).descripcion;
  if (!required.trim()) {
    return { ok: false, error: "Completá los campos obligatorios." };
  }
  return { ok: true, data: d };
}

function buildNew(kind: ArrayKind, id: string, d: RfInput | AsrInput | ConstraintInput): ArrayItem {
  switch (kind) {
    case "rf": {
      const x = d as RfInput;
      return {
        id,
        descripcion: x.descripcion.trim(),
        justificacion: x.justificacion !== undefined ? x.justificacion.trim() || "(sin justificacion)" : "(sin justificacion)",
        prioridad: x.prioridad !== undefined ? x.prioridad.trim() || "(sin prioridad)" : "(sin prioridad)",
        criterio_de_ajuste: x.criterio_de_ajuste !== undefined ? x.criterio_de_ajuste.trim() || "(sin criterio)" : "(sin criterio)",
        origen: "manual",
        historia_origen: "(sin historia)",
        historias_origen: x.historias_origen ?? [],
      } as RfItem;
    }
    case "asr": {
      const x = d as AsrInput;
      const esc = x.escenario_tecnico_6_partes ?? {};
      return {
        id,
        atributo: x.atributo.trim(),
        es_asr_genuino: x.es_asr_genuino ?? false,
        justificacion_arquitectonica: x.justificacion_arquitectonica !== undefined ? x.justificacion_arquitectonica.trim() || "(sin justificacion)" : "(sin justificacion)",
        escenario_tecnico_6_partes: {
          fuente: esc.fuente?.trim() || "(sin especificar)",
          estimulo: esc.estimulo?.trim() || "(sin especificar)",
          artefacto: esc.artefacto?.trim() || "(sin especificar)",
          entorno: esc.entorno?.trim() || "(sin especificar)",
          respuesta: esc.respuesta?.trim() || "(sin especificar)",
          medida_de_respuesta: esc.medida_de_respuesta?.trim() || "(sin especificar)",
        },
        trade_offs_identificados: x.trade_offs_identificados !== undefined ? x.trade_offs_identificados.trim() || "(sin trade-offs)" : "(sin trade-offs)",
        origen: "manual",
      } as AsrItem;
    }
    case "constraint": {
      const x = d as ConstraintInput;
      return {
        id,
        tipo: x.tipo.trim(),
        descripcion: x.descripcion.trim(),
        impacto: x.impacto !== undefined ? x.impacto.trim() || "(sin especificar)" : "(sin especificar)",
      } as ConstraintItem;
    }
  }
}

function buildUpdated(kind: ArrayKind, prev: ArrayItem, d: RfInput | AsrInput | ConstraintInput): ArrayItem {
  switch (kind) {
    case "rf": {
      const x = d as RfInput;
      const p = prev as RfItem;
      return {
        ...p,
        descripcion: x.descripcion.trim(),
        justificacion: x.justificacion !== undefined ? x.justificacion.trim() || "(sin justificacion)" : p.justificacion,
        prioridad: x.prioridad !== undefined ? x.prioridad.trim() || "(sin prioridad)" : p.prioridad,
        criterio_de_ajuste: x.criterio_de_ajuste !== undefined ? x.criterio_de_ajuste.trim() || "(sin criterio)" : p.criterio_de_ajuste,
        historias_origen: x.historias_origen !== undefined ? x.historias_origen : p.historias_origen,
      };
    }
    case "asr": {
      const x = d as AsrInput;
      const p = prev as AsrItem;
      const esc = x.escenario_tecnico_6_partes;
      return {
        ...p,
        atributo: x.atributo.trim(),
        es_asr_genuino: x.es_asr_genuino ?? p.es_asr_genuino,
        justificacion_arquitectonica: x.justificacion_arquitectonica !== undefined ? x.justificacion_arquitectonica.trim() || "(sin justificacion)" : p.justificacion_arquitectonica,
        escenario_tecnico_6_partes: esc
          ? {
              fuente: esc.fuente !== undefined ? esc.fuente.trim() || "(sin especificar)" : p.escenario_tecnico_6_partes.fuente,
              estimulo: esc.estimulo !== undefined ? esc.estimulo.trim() || "(sin especificar)" : p.escenario_tecnico_6_partes.estimulo,
              artefacto: esc.artefacto !== undefined ? esc.artefacto.trim() || "(sin especificar)" : p.escenario_tecnico_6_partes.artefacto,
              entorno: esc.entorno !== undefined ? esc.entorno.trim() || "(sin especificar)" : p.escenario_tecnico_6_partes.entorno,
              respuesta: esc.respuesta !== undefined ? esc.respuesta.trim() || "(sin especificar)" : p.escenario_tecnico_6_partes.respuesta,
              medida_de_respuesta: esc.medida_de_respuesta !== undefined ? esc.medida_de_respuesta.trim() || "(sin especificar)" : p.escenario_tecnico_6_partes.medida_de_respuesta,
            }
          : p.escenario_tecnico_6_partes,
        trade_offs_identificados: x.trade_offs_identificados !== undefined ? x.trade_offs_identificados.trim() || "(sin trade-offs)" : p.trade_offs_identificados,
      };
    }
    case "constraint": {
      const x = d as ConstraintInput;
      const p = prev as ConstraintItem;
      return {
        ...p,
        tipo: x.tipo.trim(),
        descripcion: x.descripcion.trim(),
        impacto: x.impacto !== undefined ? x.impacto.trim() || "(sin especificar)" : p.impacto,
      };
    }
  }
}

// ─── CRUD para RF / ASR / restricciones (arrays con id) ────────────────────

export function addCurationItem(
  synthesisPath: string,
  kind: ArrayKind,
  input: unknown,
): StoryMutationResult {
  const v = validate(kind, input);
  if (!v.ok) return v;
  return mutateSynthesis(synthesisPath, (syn) => {
    const active = activeList(kind, syn);
    const id = nextId([...active, ...deletedList(kind, syn)], prefixOf(kind));
    const item = buildNew(kind, id, v.data);
    return withActive(kind, syn, [...active, item]);
  });
}

export function updateCurationItem(
  synthesisPath: string,
  kind: ArrayKind,
  id: string,
  input: unknown,
): StoryMutationResult {
  const v = validate(kind, input);
  if (!v.ok) return v;
  return mutateSynthesis(synthesisPath, (syn) => {
    const active = activeList(kind, syn);
    const idx = active.findIndex((x) => x.id === id);
    if (idx === -1) throw new Error(`Ítem ${id} no encontrado.`);
    const updated = buildUpdated(kind, active[idx], v.data);
    const next = [...active];
    next[idx] = updated;
    return withActive(kind, syn, next);
  });
}

export function deleteCurationItem(
  synthesisPath: string,
  kind: ArrayKind,
  id: string,
): StoryMutationResult {
  return mutateSynthesis(synthesisPath, (syn) => {
    const active = activeList(kind, syn);
    const item = active.find((x) => x.id === id);
    if (!item) throw new Error(`Ítem ${id} no encontrado.`);
    const tombstone = { ...item, eliminada_at: new Date().toISOString() };
    const withTomb = withDeleted(kind, syn, [...deletedList(kind, syn), tombstone]);
    return withActive(kind, withTomb, active.filter((x) => x.id !== id));
  });
}

export function recoverCurationItem(
  synthesisPath: string,
  kind: ArrayKind,
  id: string,
): StoryMutationResult {
  return mutateSynthesis(synthesisPath, (syn) => {
    const deleted = deletedList(kind, syn);
    const tomb = deleted.find((x) => x.id === id);
    if (!tomb) throw new Error(`Ítem eliminado ${id} no encontrado.`);
    const { eliminada_at, ...item } = tomb as ArrayItem & { eliminada_at: string };
    const withActiveNext = withActive(kind, syn, [...activeList(kind, syn), item]);
    return withDeleted(kind, withActiveNext, deleted.filter((x) => x.id !== id));
  });
}

// ─── CRUD para el glosario (Record término → definición) ───────────────────

function validateTerm(input: unknown): { ok: true; data: TermInput } | { ok: false; error: string } {
  const parsed = TermInputSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first ? first.message : "Datos inválidos." };
  }
  const d = parsed.data;
  if (!d.termino.trim() || !d.definicion.trim()) {
    return { ok: false, error: "Completá los campos obligatorios (término y definición)." };
  }
  return { ok: true, data: d };
}

export function addTerm(synthesisPath: string, input: unknown): StoryMutationResult {
  const v = validateTerm(input);
  if (!v.ok) return v;
  const { termino, definicion } = v.data;
  return mutateSynthesis(synthesisPath, (syn) => {
    const glosario = syn.glosario_de_terminos ?? {};
    if (Object.prototype.hasOwnProperty.call(glosario, termino.trim())) {
      throw new Error(`El término "${termino.trim()}" ya existe.`);
    }
    return { ...syn, glosario_de_terminos: { ...glosario, [termino.trim()]: definicion.trim() } };
  });
}

export function updateTerm(synthesisPath: string, terminoActual: string, input: unknown): StoryMutationResult {
  const v = validateTerm(input);
  if (!v.ok) return v;
  const { termino, definicion } = v.data;
  const nuevo = termino.trim();
  return mutateSynthesis(synthesisPath, (syn) => {
    const glosario = syn.glosario_de_terminos ?? {};
    if (!Object.prototype.hasOwnProperty.call(glosario, terminoActual)) {
      throw new Error(`Término "${terminoActual}" no encontrado.`);
    }
    if (nuevo !== terminoActual && Object.prototype.hasOwnProperty.call(glosario, nuevo)) {
      throw new Error(`El término "${nuevo}" ya existe.`);
    }
    const next = { ...glosario };
    delete next[terminoActual];
    next[nuevo] = definicion.trim();
    return { ...syn, glosario_de_terminos: next };
  });
}

export function deleteTerm(synthesisPath: string, termino: string): StoryMutationResult {
  return mutateSynthesis(synthesisPath, (syn) => {
    const glosario = syn.glosario_de_terminos ?? {};
    if (!Object.prototype.hasOwnProperty.call(glosario, termino)) {
      throw new Error(`Término "${termino}" no encontrado.`);
    }
    const tombstone: DeletedTerm = { termino, definicion: glosario[termino], eliminada_at: new Date().toISOString() };
    const next = { ...glosario };
    delete next[termino];
    return { ...syn, glosario_de_terminos: next, terminos_eliminados: [...(syn.terminos_eliminados ?? []), tombstone] };
  });
}

export function recoverTerm(synthesisPath: string, termino: string): StoryMutationResult {
  return mutateSynthesis(synthesisPath, (syn) => {
    const deleted = syn.terminos_eliminados ?? [];
    const tomb = deleted.find((t) => t.termino === termino);
    if (!tomb) throw new Error(`Término eliminado "${termino}" no encontrado.`);
    const glosario = syn.glosario_de_terminos ?? {};
    if (Object.prototype.hasOwnProperty.call(glosario, termino)) {
      throw new Error(`El término "${termino}" ya existe (activo).`);
    }
    return {
      ...syn,
      glosario_de_terminos: { ...glosario, [termino]: tomb.definicion },
      terminos_eliminados: deleted.filter((t) => t.termino !== termino),
    };
  });
}

// ─── Purga (eliminación DEFINITIVA de un tombstone, sin recuperación) ─────

export function purgeCurationItem(
  synthesisPath: string,
  kind: ArrayKind,
  id: string,
): StoryMutationResult {
  return mutateSynthesis(synthesisPath, (syn) => {
    const deleted = deletedList(kind, syn);
    if (!deleted.some((x) => x.id === id)) throw new Error(`Ítem eliminado ${id} no encontrado.`);
    return withDeleted(kind, syn, deleted.filter((x) => x.id !== id));
  });
}

export function purgeTerm(synthesisPath: string, termino: string): StoryMutationResult {
  return mutateSynthesis(synthesisPath, (syn) => {
    const deleted = syn.terminos_eliminados ?? [];
    if (!deleted.some((t) => t.termino === termino)) throw new Error(`Término eliminado "${termino}" no encontrado.`);
    return { ...syn, terminos_eliminados: deleted.filter((t) => t.termino !== termino) };
  });
}

export function purgeCuration(synthesisPath: string, kind: CurationKind, id: string): StoryMutationResult {
  return kind === "term" ? purgeTerm(synthesisPath, id) : purgeCurationItem(synthesisPath, kind, id);
}

// ─── Dispatcher genérico ───────────────────────────────────────────────────

export function addCuration(synthesisPath: string, kind: CurationKind, input: unknown): StoryMutationResult {
  return kind === "term" ? addTerm(synthesisPath, input) : addCurationItem(synthesisPath, kind, input);
}

export function updateCuration(synthesisPath: string, kind: CurationKind, id: string, input: unknown): StoryMutationResult {
  return kind === "term" ? updateTerm(synthesisPath, id, input) : updateCurationItem(synthesisPath, kind, id, input);
}

export function deleteCuration(synthesisPath: string, kind: CurationKind, id: string): StoryMutationResult {
  return kind === "term" ? deleteTerm(synthesisPath, id) : deleteCurationItem(synthesisPath, kind, id);
}

export function recoverCuration(synthesisPath: string, kind: CurationKind, id: string): StoryMutationResult {
  return kind === "term" ? recoverTerm(synthesisPath, id) : recoverCurationItem(synthesisPath, kind, id);
}
