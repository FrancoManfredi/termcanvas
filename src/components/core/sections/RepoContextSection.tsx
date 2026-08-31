// Sección ENTREVISTAS → Contexto del Repositorio (Fase 0).
// Envuelve el modal de contexto en modo inline; la lógica vive en
// useRepoContextStore, acá solo hay presentación.
//
// La sincronización entre máquinas que vivía acá se movió a su propia
// sección "Sincronización" (grupo anclado al fondo del sidebar).

import { RepoContextModal } from "../../RepoContextModal";

export function RepoContextSection() {
  return (
    <div className="w-full space-y-4">
      <RepoContextModal isInline />
    </div>
  );
}
