// Sección SINCRONIZACIÓN → sync del contexto .agents entre máquinas.
//
// Envuelve la misma ContextSyncCard que antes vivía embebida en la entrevista
// de contexto (misma lógica, cero cambios funcionales) pero como sección
// propia: tarjeta centrada con aire, y el botón Activar/Sincronizar
// verticalmente centrado contra el bloque de título/estado.
//
// El shell renderiza esta entrada en un FOOTER FIJO al fondo del sidebar
// (fuera del scroll): la sincronización es transversal a todas las fases.

import { ContextSyncCard } from "./ContextSyncCard";

export function SyncSection() {
  return (
    <div className="w-full flex justify-center pt-4">
      <div className="w-full max-w-md self-start">
        <ContextSyncCard />
      </div>
    </div>
  );
}
