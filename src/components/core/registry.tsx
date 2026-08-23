// Registro de secciones del modal unificado de arquitectura.
//
// AGREGAR UNA FASE NUEVA = crear una carpeta en sections/ + una entrada acá.
// El shell (CoreArchitectureModal) renderiza sidebar y contenido desde este
// registro: nada del resto del archivo necesita tocar el nuevo componente.

import type { ComponentType } from "react";
import type { SynthesisResult } from "../../../headless-runtime/interview/index.ts";
import type { CoreModalContextValue } from "./context";
import {
  ChatBubbleIcon,
  ConstraintsIcon,
  DiagnosisIcon,
  DocumentTextIcon,
  GitHubIcon,
  GlossaryIcon,
  PlannerIcon,
  QualityIcon,
  RequirementsIcon,
  TacticsIcon,
  UserStoryIcon,
  type CoreSubcategory,
  type SectionGroup,
} from "./shared";
import { RepoContextSection } from "./sections/RepoContextSection";
import { RequirementsInterviewSection } from "./sections/RequirementsInterviewSection";
import { UserStoriesSection } from "./sections/UserStoriesSection";
import { FunctionalRequirementsSection } from "./sections/FunctionalRequirementsSection";
import { QualityAttributesSection } from "./sections/QualityAttributesSection";
import { ArchitectureTacticsSection } from "./sections/ArchitectureTacticsSection";
import { ConstraintsSection } from "./sections/ConstraintsSection";
import { GlossarySection } from "./sections/GlossarySection";
import { PlanningDiagnosisSection } from "./sections/PlanningDiagnosisSection";
import { PlanningRoadmapSection } from "./sections/PlanningRoadmapSection";
import { GithubIssuesSection } from "./sections/GithubIssuesSection";

export interface SectionDef {
  id: CoreSubcategory;
  group: SectionGroup;
  icon: ComponentType;
  label: string;
  // Badge estático ("Fase 0", "Repo") o derivado de la síntesis activa
  // (contadores de historias/RFs/ASRs/restricciones/términos).
  badge: string | ((synthesis: SynthesisResult | null) => string);
  Component: ComponentType;
}

// Contadores de las secciones post-entrevista (mismos orígenes que el
// monolito usaba para los badges del sidebar).
const countOf =
  (pick: (s: SynthesisResult) => number) =>
  (synthesis: SynthesisResult | null): string =>
    synthesis ? String(pick(synthesis)) : "0";

export const SECTION_GROUPS: Array<{ id: SectionGroup; heading: string; ariaLabel: string }> = [
  { id: "entrevistas", heading: "ENTREVISTAS", ariaLabel: "Navegación de Entrevistas" },
  { id: "post", heading: "POST ENTREVISTAS", ariaLabel: "Navegación Post Entrevistas" },
  { id: "planning", heading: "PLANNING", ariaLabel: "Navegación de Planning" },
  { id: "integraciones", heading: "INTEGRACIONES", ariaLabel: "Navegación de Integraciones" },
];

export const SECTION_REGISTRY: SectionDef[] = [
  {
    id: "repo_context",
    group: "entrevistas",
    icon: ChatBubbleIcon,
    label: "Contexto del Repositorio",
    badge: "Fase 0",
    Component: RepoContextSection,
  },
  {
    id: "requirements_interview",
    group: "entrevistas",
    icon: DocumentTextIcon,
    label: "Entrevista de Requerimientos",
    badge: "IA",
    Component: RequirementsInterviewSection,
  },
  {
    id: "user_stories",
    group: "post",
    icon: UserStoryIcon,
    label: "Historias de Usuario",
    badge: countOf((s) => s.historias_de_usuario?.length ?? 0),
    Component: UserStoriesSection,
  },
  {
    id: "functional_requirements",
    group: "post",
    icon: RequirementsIcon,
    label: "Requerimientos Funcionales",
    badge: countOf((s) => s.requerimientos_funcionales?.length ?? 0),
    Component: FunctionalRequirementsSection,
  },
  {
    id: "quality_attributes",
    group: "post",
    icon: QualityIcon,
    label: "Atributos de Calidad (ASR)",
    badge: countOf((s) => s.atributos_de_calidad_y_asrs?.length ?? 0),
    Component: QualityAttributesSection,
  },
  {
    // El badge cuenta los ASR GENUINOS: son los únicos que disparan el
    // análisis de tácticas (las preferencias UX no requieren la disciplina).
    id: "architecture_tactics",
    group: "post",
    icon: TacticsIcon,
    label: "Tácticas de Arquitectura",
    badge: countOf(
      (s) => (s.atributos_de_calidad_y_asrs ?? []).filter((q) => q.es_asr_genuino).length,
    ),
    Component: ArchitectureTacticsSection,
  },
  {
    id: "constraints",
    group: "post",
    icon: ConstraintsIcon,
    label: "Restricciones Globales",
    badge: countOf((s) => s.restricciones_globales?.length ?? 0),
    Component: ConstraintsSection,
  },
  {
    id: "glossary",
    group: "post",
    icon: GlossaryIcon,
    label: "Glosario del Proyecto",
    badge: countOf((s) => Object.keys(s.glosario_de_terminos ?? {}).length),
    Component: GlossarySection,
  },
  {
    id: "planning_diagnosis",
    group: "planning",
    icon: DiagnosisIcon,
    label: "Diagnóstico",
    badge: "Repo",
    Component: PlanningDiagnosisSection,
  },
  {
    id: "planning_roadmap",
    group: "planning",
    icon: PlannerIcon,
    label: "Planificador",
    badge: "Roadmap",
    Component: PlanningRoadmapSection,
  },
  {
    id: "github_issues",
    group: "integraciones",
    icon: GitHubIcon,
    label: "GitHub Issues",
    badge: "IA",
    Component: GithubIssuesSection,
  },
];

export function sectionById(id: CoreSubcategory): SectionDef {
  return SECTION_REGISTRY.find((s) => s.id === id) ?? SECTION_REGISTRY[3];
}

export function sectionBadge(def: SectionDef, ctx: Pick<CoreModalContextValue, "synthesis">): string {
  return typeof def.badge === "function" ? def.badge(ctx.synthesis) : def.badge;
}
