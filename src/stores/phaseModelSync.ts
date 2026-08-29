// Sincroniza los overrides de modelo y CLI por fase (preferencesStore, renderer)
// con el proceso principal: el gate del motor de entrevista lee lo que este
// módulo empuja vía models:set-phase-overrides y models:set-phase-clis.
//
// Se inicializa UNA vez al arrancar la app (App.tsx, junto a hydrateApiKey):
// empuja el estado actual y re-empuja cuando cambia la referencia de
// phaseModels/phaseClis. Sin window.termcanvas (tests/node) queda en no-op.

import { usePreferencesStore } from "./preferencesStore";

let subscribed = false;

export function initPhaseModelSync(): void {
  if (typeof window === "undefined") return;
  const api = window.termcanvas?.models as unknown as {
    setPhaseOverrides?: (v: unknown) => Promise<unknown>;
    setPhaseClis?: (v: unknown) => Promise<unknown>;
  };
  if (!api?.setPhaseOverrides && !api?.setPhaseClis) return;

  const pushModels = () => {
    if (!api.setPhaseOverrides) return;
    void api
      .setPhaseOverrides(usePreferencesStore.getState().phaseModels)
      .catch(() => {});
  };
  const pushClis = () => {
    if (!api.setPhaseClis) return;
    void api.setPhaseClis(usePreferencesStore.getState().phaseClis).catch(() => {});
  };

  pushModels();
  pushClis();
  if (!subscribed) {
    subscribed = true;
    usePreferencesStore.subscribe((state, prev) => {
      if (state.phaseModels !== prev.phaseModels) pushModels();
      if (state.phaseClis !== prev.phaseClis) pushClis();
    });
  }
}
