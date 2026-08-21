// Contexto del modal unificado de arquitectura.
//
// La capucha (CoreArchitectureModal) posee el estado CRUZADO entre secciones
// — navegación, búsqueda, portapapeles, la síntesis activa y el filtro de
// GitHub — y lo expone acá. Cada sección (src/components/core/sections/*)
// consume este contexto para lo cruzado y dueño de su estado exclusivo
// (formularios, overlays, vistas internas).
//
// Regla de oro del refactor: el ÁRBOL de componentes no cambia; solo se
// reparte el código que antes vivía en un solo archivo de 3.400 líneas.

import { createContext, useContext } from "react";
import type { SynthesisResult } from "../../../headless-runtime/interview/index.ts";
import type { DiagnosisRecord } from "../../stores/diagnosisStore.ts";
import type { CoreSubcategory } from "./shared";

export interface CoreModalContextValue {
  // Cierra el modal completo (lo usan las secciones embebidas, ej: InterviewModal).
  close: () => void;
  // Navegación entre secciones (resetea search/filtros transversales).
  navigate: (sub: CoreSubcategory) => void;
  // Búsqueda compartida por los headers de sección (se resetea al navegar).
  search: string;
  setSearch: (value: string) => void;
  // Portapapeles con feedback "copiado" por id de ítem.
  copiedId: string | null;
  copy: (text: string, id: string) => void;
  // Síntesis activa de la entrevista (ledger.synthesis) + su path en disco.
  synthesis: SynthesisResult | null;
  synthesisPath: string | null;
  synthLoading: boolean;
  // Aplica una síntesis nueva (resultado de una mutación del motor).
  applySynthesis: (next: SynthesisResult) => void;
  // Salto RF → historia con highlight temporal en user_stories.
  highlightStoryId: string | null;
  jumpToStory: (storyId: string) => void;
  // Cantidad de RFs que formalizan una historia (relación N:N).
  rfCountForStory: (storyId: string) => number;
  // Navega a github_issues pre-filtrando por un diagnóstico de origen.
  openGithubIssues: (diagId: string) => void;
  // Filtro FUENTE — DIAGNÓSTICO activo en github_issues ("all" = todo).
  githubDiagFilter: string;
  setGithubDiagFilter: (value: string) => void;
  // Colapso compartido del bloque "Eliminados" entre las 4 secciones de
  // curaduría (en el monolito era un único estado del componente).
  curDeletedOpen: boolean;
  setCurDeletedOpen: (value: boolean) => void;
  // Flujo de seguridad del repositorio: la tarjeta fija del diagnóstico
  // (chrome del shell) y la vista interna de la sección lo comparten.
  securityOpen: boolean;
  openSecurityFlow: () => void;
  closeSecurityFlow: () => void;
  // Historial de diagnósticos (del diagnosisStore, nivel módulo).
  diagHistory: DiagnosisRecord[];
}

export const CoreModalContext = createContext<CoreModalContextValue | null>(null);

export function useCoreModal(): CoreModalContextValue {
  const ctx = useContext(CoreModalContext);
  if (!ctx) {
    throw new Error("useCoreModal debe usarse dentro de CoreModalContext.Provider");
  }
  return ctx;
}
