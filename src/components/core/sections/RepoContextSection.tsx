// Sección ENTREVISTAS → Contexto del Repositorio (Fase 0).
// Envuelve el modal de contexto en modo inline; la lógica vive en
// useRepoContextStore, acá solo hay presentación.

import { RepoContextModal } from "../../RepoContextModal";
import { ContextSyncCard } from "./ContextSyncCard";

export function RepoContextSection() {
  return (
    <div className="w-full space-y-4">
      <ContextSyncCard />
      <RepoContextModal isInline />
    </div>
  );
}
