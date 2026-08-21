// Formularios de curaduría del modal unificado (add/edit).
//
// Estado y lógica de los dos formularios extraídos VERBATIM del cuerpo de
// CoreArchitectureModal. Cada sección instancia su propio hook (solo hay una
// sección montada a la vez, así que el comportamiento es idéntico al del
// monolito, donde el estado era único).

import { useCallback, useState } from "react";
import type { SynthesisResult } from "../../../headless-runtime/interview/index.ts";
import {
  CURATION_FIELDS,
  buildCurationInput,
  itemToValues,
  type CurationKind,
} from "./shared";

// ── Formulario de historia de usuario (añadir / editar) ────────────────────

export interface StoryFormState {
  open: boolean;
  mode: "add" | "edit";
  storyId: string | null;
  origen: string;
  titulo: string;
  rol: string;
  quiero: string;
  para: string;
  prioridad: string;
  criterios: string[];
  error?: string;
  busy: boolean;
}

const EMPTY_STORY_FORM: StoryFormState = {
  open: false,
  mode: "add",
  storyId: null,
  origen: "manual",
  titulo: "",
  rol: "",
  quiero: "",
  para: "",
  prioridad: "Must have",
  criterios: [],
  busy: false,
};

export function useStoryForm(
  synthesisPath: string | null,
  applySynthesis: (next: SynthesisResult) => void,
) {
  const [storyForm, setStoryForm] = useState<StoryFormState>(EMPTY_STORY_FORM);

  const openAddStory = useCallback(() => {
    setStoryForm({
      open: true,
      mode: "add",
      storyId: null,
      origen: "manual",
      titulo: "",
      rol: "",
      quiero: "",
      para: "",
      prioridad: "Must have",
      criterios: [],
      busy: false,
    });
  }, []);

  const openEditStory = useCallback((h: {
    id: string;
    titulo: string;
    rol: string;
    quiero: string;
    para: string;
    prioridad: string;
    criterios_de_aceptacion: string[];
    origen: string;
  }) => {
    setStoryForm({
      open: true,
      mode: "edit",
      storyId: h.id,
      origen: h.origen,
      titulo: h.titulo === "(sin titulo)" ? "" : h.titulo,
      rol: h.rol === "(sin rol)" ? "" : h.rol,
      quiero: h.quiero === "(sin accion)" ? "" : h.quiero,
      para: h.para === "(sin motivo)" ? "" : h.para,
      prioridad: h.prioridad === "(sin prioridad)" ? "Must have" : h.prioridad,
      criterios: [...h.criterios_de_aceptacion],
      busy: false,
    });
  }, []);

  const closeStoryForm = useCallback(() => {
    setStoryForm((f) => ({ ...f, open: false }));
  }, []);

  const submitStoryForm = useCallback(async () => {
    if (!synthesisPath) return;
    const { mode, storyId, titulo, rol, quiero, para, prioridad, criterios } = storyForm;
    if (!rol.trim() || !quiero.trim() || !para.trim()) {
      setStoryForm((f) => ({ ...f, error: "Completá los campos obligatorios (rol, quiero, para)." }));
      return;
    }
    setStoryForm((f) => ({ ...f, busy: true, error: undefined }));
    const input = {
      titulo: titulo.trim() || undefined,
      rol: rol.trim(),
      quiero: quiero.trim(),
      para: para.trim(),
      prioridad: prioridad.trim() || undefined,
      criterios_de_aceptacion: criterios.map((c) => c.trim()).filter(Boolean),
    };
    try {
      const res =
        mode === "add"
          ? await window.termcanvas.interview.addStory(synthesisPath, input)
          : await window.termcanvas.interview.updateStory(synthesisPath, storyId!, input);
      if (res.ok) {
        applySynthesis(res.synthesis);
        setStoryForm((f) => ({ ...f, open: false, busy: false }));
      } else {
        setStoryForm((f) => ({ ...f, busy: false, error: res.error }));
      }
    } catch (err) {
      setStoryForm((f) => ({ ...f, busy: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }, [synthesisPath, storyForm, applySynthesis]);

  return { storyForm, setStoryForm, openAddStory, openEditStory, closeStoryForm, submitStoryForm };
}

// ── Formulario genérico de curaduría (RF / ASR / restricción / término) ────

export interface CurFormState {
  open: boolean;
  kind: CurationKind;
  mode: "add" | "edit";
  id: string | null;
  values: Record<string, unknown>;
  error?: string;
  busy: boolean;
}

const EMPTY_CUR_FORM: CurFormState = { open: false, kind: "rf", mode: "add", id: null, values: {}, busy: false };

export function useCurationForm(
  synthesisPath: string | null,
  applySynthesis: (next: SynthesisResult) => void,
) {
  const [curForm, setCurForm] = useState<CurFormState>(EMPTY_CUR_FORM);

  const openCurationAdd = useCallback((kind: CurationKind) => {
    setCurForm({ open: true, kind, mode: "add", id: null, values: {}, busy: false });
  }, []);

  const openCurationEdit = useCallback((kind: CurationKind, id: string, item: unknown) => {
    setCurForm({ open: true, kind, mode: "edit", id, values: itemToValues(kind, item), busy: false });
  }, []);

  const closeCurationForm = useCallback(() => {
    setCurForm((f) => ({ ...f, open: false }));
  }, []);

  const setCurValue = useCallback((key: string, value: unknown) => {
    setCurForm((f) => ({ ...f, values: { ...f.values, [key]: value } }));
  }, []);

  const submitCurationForm = useCallback(async () => {
    if (!synthesisPath) return;
    const { kind, mode, id, values } = curForm;
    // Validación cliente de campos obligatorios.
    const missing = CURATION_FIELDS[kind]
      .filter((f) => f.required)
      .find((f) => !String(values[f.key] ?? "").trim());
    if (missing) {
      setCurForm((f) => ({ ...f, error: `Completá el campo obligatorio: ${missing.label}.` }));
      return;
    }
    setCurForm((f) => ({ ...f, busy: true, error: undefined }));
    const input = buildCurationInput(kind, values);
    try {
      const res =
        mode === "add"
          ? await window.termcanvas.interview.addCuration(synthesisPath, kind, input)
          : await window.termcanvas.interview.updateCuration(synthesisPath, kind, id!, input);
      if (res.ok) {
        applySynthesis(res.synthesis);
        setCurForm((f) => ({ ...f, open: false, busy: false }));
      } else {
        setCurForm((f) => ({ ...f, busy: false, error: res.error }));
      }
    } catch (err) {
      setCurForm((f) => ({ ...f, busy: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }, [synthesisPath, curForm, applySynthesis]);

  return { curForm, setCurForm, openCurationAdd, openCurationEdit, closeCurationForm, setCurValue, submitCurationForm };
}
