// Sección ENTREVISTAS → Entrevista de Requerimientos (IA).
// Envuelve InterviewModal en modo inline; los callbacks de navegación
// (ver resultados / abrir contexto) pasan por el contexto del modal.

import { InterviewModal } from "../../InterviewModal";
import { useCoreModal } from "../context";

export function RequirementsInterviewSection() {
  const { navigate, close } = useCoreModal();
  return (
    <div className="w-full space-y-4">
      <InterviewModal
        isInline
        onClose={close}
        onViewResults={() => navigate("functional_requirements")}
        onOpenContextModal={() => navigate("repo_context")}
      />
    </div>
  );
}
