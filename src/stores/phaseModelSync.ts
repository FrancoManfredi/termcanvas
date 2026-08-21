// Sincroniza los overrides de modelo por fase (preferencesStore, renderer)
// con el proceso principal: el gate del motor de entrevista lee lo que este
// módulo empuja vía models:set-phase-overrides.
//
// Se inicializa UNA vez al arrancar la app (App.tsx, junto a hydrateApiKey):
// empuja el estado actual y re-empuja cuando cambia la referencia de
// phaseModels. Sin window.termcanvas (tests/node) queda en no-op.

import { usePreferencesStore } from "./preferencesStore";

let subscribed = false;

export function initPhaseModelSync(): void {
  if (typeof window === "undefined") return;
  const api = window.termcanvas?.models;
  if (!api?.setPhaseOverrides) return;

  const push = () => {
    void api
      .setPhaseOverrides(usePreferencesStore.getState().phaseModels)
      .catch(() => {});
  };

  push();
  if (!subscribed) {
    subscribed = true;
    usePreferencesStore.subscribe((state, prev) => {
      if (state.phaseModels !== prev.phaseModels) push();
    });
  }
}
