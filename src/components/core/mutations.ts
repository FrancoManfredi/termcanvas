// Hooks de mutación de la síntesis (curaduría SIN llamadas al modelo).
//
// Extraídos VERBATIM del cuerpo de CoreArchitectureModal: cada hook dueño de
// su estado de confirmación/busy y de las llamadas IPC al motor. Las secciones
// los instancian; el resultado de cada mutación se aplica con applySynthesis
// (la síntesis vive en la capucha y se comparte por contexto).

import { useCallback, useState } from "react";
import { useNotificationStore } from "../../stores/notificationStore";
import type { SynthesisResult } from "../../../headless-runtime/interview/index.ts";
import type { CurationKind } from "./shared";

interface MutationDeps {
  synthesisPath: string | null;
  applySynthesis: (next: SynthesisResult) => void;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Curaduría de historias de usuario (delete / restore) ───────────────────

export function useStoryMutations({ synthesisPath, applySynthesis }: MutationDeps) {
  const [deletingStory, setDeletingStory] = useState<{
    id: string;
    label: string;
    rfCount: number;
  } | null>(null);
  const [storyActionBusy, setStoryActionBusy] = useState(false);

  const confirmDeleteStory = useCallback(async () => {
    if (!synthesisPath || !deletingStory) return;
    setStoryActionBusy(true);
    try {
      const res = await window.termcanvas.interview.deleteStory(synthesisPath, deletingStory.id);
      if (res.ok) {
        applySynthesis(res.synthesis);
        setDeletingStory(null);
      } else {
        useNotificationStore.getState().notify("error", res.error);
        setDeletingStory(null);
      }
    } catch (err) {
      useNotificationStore.getState().notify("error", errText(err));
      setDeletingStory(null);
    } finally {
      setStoryActionBusy(false);
    }
  }, [synthesisPath, deletingStory, applySynthesis]);

  const restoreStory = useCallback(
    async (storyId: string) => {
      if (!synthesisPath) return;
      setStoryActionBusy(true);
      try {
        const res = await window.termcanvas.interview.recoverStory(synthesisPath, storyId);
        if (res.ok) {
          applySynthesis(res.synthesis);
        } else {
          useNotificationStore.getState().notify("error", res.error);
        }
      } catch (err) {
        useNotificationStore.getState().notify("error", errText(err));
      } finally {
        setStoryActionBusy(false);
      }
    },
    [synthesisPath, applySynthesis],
  );

  return {
    deletingStory,
    setDeletingStory,
    storyActionBusy,
    confirmDeleteStory,
    restoreStory,
  };
}

// ── Curaduría de RF / ASR / restricciones / glosario (delete / restore) ────

export function useCurationMutations({ synthesisPath, applySynthesis }: MutationDeps) {
  const [deletingCuration, setDeletingCuration] = useState<{
    kind: CurationKind;
    id: string;
    label: string;
  } | null>(null);
  const [curActionBusy, setCurActionBusy] = useState(false);

  const confirmDeleteCuration = useCallback(async () => {
    if (!synthesisPath || !deletingCuration) return;
    setCurActionBusy(true);
    try {
      const res = await window.termcanvas.interview.deleteCuration(
        synthesisPath,
        deletingCuration.kind,
        deletingCuration.id,
      );
      if (res.ok) {
        applySynthesis(res.synthesis);
        setDeletingCuration(null);
      } else {
        useNotificationStore.getState().notify("error", res.error);
        setDeletingCuration(null);
      }
    } catch (err) {
      useNotificationStore.getState().notify("error", errText(err));
      setDeletingCuration(null);
    } finally {
      setCurActionBusy(false);
    }
  }, [synthesisPath, deletingCuration, applySynthesis]);

  const restoreCuration = useCallback(
    async (kind: CurationKind, id: string) => {
      if (!synthesisPath) return;
      setCurActionBusy(true);
      try {
        const res = await window.termcanvas.interview.recoverCuration(synthesisPath, kind, id);
        if (res.ok) {
          applySynthesis(res.synthesis);
        } else {
          useNotificationStore.getState().notify("error", res.error);
        }
      } catch (err) {
        useNotificationStore.getState().notify("error", errText(err));
      } finally {
        setCurActionBusy(false);
      }
    },
    [synthesisPath, applySynthesis],
  );

  return {
    deletingCuration,
    setDeletingCuration,
    curActionBusy,
    confirmDeleteCuration,
    restoreCuration,
  };
}

// ── Purga (eliminación DEFINITIVA de un elemento en recuperables) ─────────
// Compartida por historias ("story") y curaduría genérica (rf/asr/constraint/term).

export function usePurge({ synthesisPath, applySynthesis }: MutationDeps) {
  const [purgeTarget, setPurgeTarget] = useState<{
    kind: CurationKind | "story";
    id: string;
    label: string;
  } | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);

  const confirmPurge = useCallback(async () => {
    if (!synthesisPath || !purgeTarget) return;
    setPurgeBusy(true);
    try {
      const res =
        purgeTarget.kind === "story"
          ? await window.termcanvas.interview.purgeStory(synthesisPath, purgeTarget.id)
          : await window.termcanvas.interview.purgeCuration(synthesisPath, purgeTarget.kind, purgeTarget.id);
      if (res.ok) {
        applySynthesis(res.synthesis);
        setPurgeTarget(null);
      } else {
        useNotificationStore.getState().notify("error", res.error);
        setPurgeTarget(null);
      }
    } catch (err) {
      useNotificationStore.getState().notify("error", errText(err));
      setPurgeTarget(null);
    } finally {
      setPurgeBusy(false);
    }
  }, [synthesisPath, purgeTarget, applySynthesis]);

  return { purgeTarget, setPurgeTarget, purgeBusy, confirmPurge };
}
