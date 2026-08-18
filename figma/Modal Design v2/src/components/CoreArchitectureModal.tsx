import React, { useState, useEffect, useRef } from "react";
import diagResultRaw from "../imports/plan-1786867200000.json";
import diagResultRaw2 from "../imports/plan-1786867200000-1.json";
import RepoContextModal, { type BriefItem, type InProgressItem, type InterviewPosition, type ModalPhase, type ModalView } from "./RepoContextModal";
import InterviewModal, { type InterviewQuestion, type SummariesData, type SynthesisResult, type BriefInfo, type InterviewPhase } from "./InterviewModal";
import { safeCopyToClipboard } from "../utils/clipboard";

export type CoreSubcategory =
  | "repo_context"
  | "requirements_interview"
  | "functional_requirements"
  | "quality_attributes"
  | "constraints"
  | "glossary"
  | "planning_diagnosis"
  | "planning_roadmap"
  | "github_issues";

export interface RequerimientoFuncionalCard {
  id: string;
  descripcion: string;
  justificacion: string;
  prioridad: string;
  criterio_de_ajuste: string;
  origen: string;
}

export interface EscenarioTecnico6Partes {
  fuente: string;
  estimulo: string;
  artefacto: string;
  entorno: string;
  respuesta: string;
  medida_de_respuesta: string;
}

export interface AtributoCalidadCard {
  id: string;
  atributo: string;
  es_asr_genuino: boolean;
  justificacion_arquitectonica: string;
  escenario_tecnico_6_partes: EscenarioTecnico6Partes;
  trade_offs_identificados: string;
  origen: string;
}

export interface RestriccionGlobalCard {
  id: string;
  tipo: string;
  descripcion: string;
  impacto: string;
}

export interface CoreArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName?: string;
  // State for Embedded Repo Context
  repoState: {
    phase: ModalPhase;
    view: ModalView;
    briefs: BriefItem[];
    activePath: string;
    selectedPath: string;
    inProgress: InProgressItem[];
    position: InterviewPosition | null;
    briefAnswer: string;
    canGoBack: boolean;
    busy: boolean;
    briefDone: BriefItem | null;
    briefError: string | null;
    onSelectPath: (path: string) => void;
    onActivateSelected: (path?: string) => void;
    onDeleteBrief: (path: string) => void;
    onStartInterview: (resumeAt?: number) => void;
    onSubmitAnswer: () => void;
    onAnswerChange: (value: string) => void;
    onGoBack: () => void;
    onExitInterview: () => void;
    onUseDoneAsContext: () => void;
    onDeleteLedger: (path: string) => void;
    onResumeLedger: (path: string) => void;
    onSwitchView: (view: ModalView) => void;
    onRetrySynthesis?: () => void;
  };
  // State for Embedded Interview Modal
  interviewState: {
    phase: InterviewPhase;
    busy: boolean;
    summaries: SummariesData;
    showBrief: boolean;
    briefInfo: BriefInfo | null;
    qIndex: number;
    questions: InterviewQuestion[];
    selectedOptionId: string | null;
    freeText: string;
    canGoBack: boolean;
    answered: number;
    doneReason: string | null;
    ledgerPath: string | null;
    errorMessage: string | null;
    synthesis: SynthesisResult;
    activeInterviewPath: string;
    onActivateInterview: (path: string) => void;
    onStartNew: () => void;
    onResume: (path: string, completed: boolean) => void;
    onDeleteSummary: (path: string) => void;
    onSelectOption: (id: string) => void;
    onTextChange: (text: string) => void;
    onSubmitAnswer: () => void;
    onGoBack: () => void;
    onGoToPick: () => void;
  };
}

// Data loaded directly matching interview-1786765532008-synthesis.json
export const SYNTHESIS_REQUIREMENTS: RequerimientoFuncionalCard[] = [
  {
    id: "RF-001",
    descripcion: "El sistema debe permitir a la cooperativa dar de alta un lote nuevo asociando un QR, con los campos producto, fecha de cosecha y productor responsable, desde la PWA en el celular.",
    justificacion: "Es el flujo principal ideal y el alcance mínimo de lanzamiento declarado por el creador (una cooperativa real de punta a punta).",
    prioridad: "Must have",
    criterio_de_ajuste: "Una cooperativa completa el alta de un lote con datos completos desde el celular, sin ayuda externa ni planilla de papel.",
    origen: "brief:alcance_minimo"
  },
  {
    id: "RF-002",
    descripcion: "El sistema debe generar e imprimir una etiqueta o marcado QR asociado al lote para pegar en la caja.",
    justificacion: "El QR impreso es el alcance mínimo; sin etiqueta física el mayorista no puede escanear en la playa de descarga.",
    prioridad: "Must have",
    criterio_de_ajuste: "La cooperativa obtiene una etiqueta QR impresa válida y escaneable para el lote dado de alta.",
    origen: "brief:alcance_minimo"
  },
  {
    id: "RF-003",
    descripcion: "El sistema debe permitir a un mayorista o controlador consultar el historial completo del lote (chacra de origen, fecha de cosecha, controles pasados, estado) escaneando el QR de una caja.",
    justificacion: "La consulta abierta por QR es el núcleo del valor: verificar el origen en segundos sin llamadas telefónicas.",
    prioridad: "Must have",
    criterio_de_ajuste: "Al escanear un QR válido se muestra el historial completo del lote sin necesidad de contacto telefónico ni planilla.",
    origen: "brief:alcance_minimo, a5, a11"
  },
  {
    id: "RF-004",
    descripcion: "El sistema debe emitir una alerta a la cooperativa cuando un lote registrado esté por vencer, antes de que el mayorista deba rechazarlo.",
    justificacion: "Parte explícita del alcance mínimo de lanzamiento; previene descartes por falta de aviso anticipado.",
    prioridad: "Must have",
    criterio_de_ajuste: "Ante un lote próximo a vencer, la cooperativa recibe una alerta automática antes del posible rechazo en el mercado.",
    origen: "brief:alcance_minimo"
  },
  {
    id: "RF-005",
    descripcion: "La PWA debe permitir registrar lotes sin conectividad estable por períodos de hasta 2 horas, sincronizando los datos con el servidor al recuperar la conexión.",
    justificacion: "La chacra tiene internet inestable; el margen de horas resuelto en la entrevista fue 'hasta 2 horas' (a3).",
    prioridad: "Must have",
    criterio_de_ajuste: "Se registran lotes offline y, al recuperar conexión dentro de las 2h, se sincronizan sin pérdida ni duplicados.",
    origen: "a3"
  },
  {
    id: "RF-006",
    descripcion: "El sistema debe habilitar trazabilidad completa y verificable de modo que, en el piloto de 6 meses con una cooperativa real, se registren 0 rechazos de camión por falta de trazabilidad.",
    justificacion: "Criterio de éxito de negocio elegido en la resolución de contradicciones (a15, versión 'nueva' en c2); reemplaza a a10 y a14 descartadas.",
    prioridad: "Must have",
    criterio_de_ajuste: "Durante 6 meses de piloto no ocurre ningún rechazo de lote atribuible a falta de trazabilidad o verificación de origen.",
    origen: "a15"
  }
];

export const SYNTHESIS_QUALITY_ATTRIBUTES: AtributoCalidadCard[] = [
  {
    id: "QA-001",
    atributo: "Rendimiento",
    es_asr_genuino: false,
    justificacion_arquitectonica: "La latencia de lectura <2s para una cooperativa piloto es alcanzable con una instancia única Node+PostgreSQL y no obliga a caché distribuida, microservicios ni arquitectura dirigida por eventos; es preferencia de UX, no un ASR genuino (doble validación ASR: is_genuine_asr=false).",
    escenario_tecnico_6_partes: {
      fuente: "Mayorista o controlador en el Mercado Central",
      estimulo: "Escanea el QR de una caja de un lote",
      artefacto: "PWA de consulta y servidor de resolución de lote",
      entorno: "Operación normal en la playa de descarga del Mercado Central",
      respuesta: "El historial completo del lote se muestra en pantalla",
      medida_de_respuesta: "Tiempo desde el escaneo hasta datos completos < 2 segundos"
    },
    trade_offs_identificados: "Simplicidad de implementación vs. caché de lectura en frío; sin carga masiva de consultas no se justifica optimización alguna.",
    origen: "a11"
  },
  {
    id: "QA-002",
    atributo: "Disponibilidad",
    es_asr_genuino: true,
    justificacion_arquitectonica: "El registro offline de hasta 2h con sincronización posterior obliga a una decisión estructural profunda: almacenamiento local en la PWA, cola de escritura, generación de IDs de lote offline e un motor de sincronización idempotente con resolución de conflictos. No es preferencia de UX, es arquitectura offline-first.",
    escenario_tecnico_6_partes: {
      fuente: "Productor/encargada en la chacra",
      estimulo: "Pérdida de conectividad estable por hasta 2 horas",
      artefacto: "PWA de registro de lotes en el celular",
      entorno: "Chacra con internet inestable o nulo",
      respuesta: "El registro de lotes continúa offline y se sincroniza sin pérdida ni duplicados al recuperar conexión",
      medida_de_respuesta: "Hasta 2 horas sin conectividad sin pérdida de datos ni lotes duplicados"
    },
    trade_offs_identificados: "Complejidad de sync/conflictos vs. disponibilidad en campo; posible inconsistencia temporal de lectura hasta la sincronización. SLO de caída de servidor NO definido ([a9] descartada en c1) → gap de disponibilidad del lado servidor.",
    origen: "a3"
  },
  {
    id: "QA-003",
    atributo: "Seguridad",
    es_asr_genuino: true,
    justificacion_arquitectonica: "La veracidad no negociable de los datos y la protección de datos personales del productor (Ley 18.331) obligan a decisiones estructurales: firma/integridad de lotes para evitar falsificación con lectura abierta por QR, consentimiento y derechos del titular, y cifrado de datos personales. Sin firma, un QR abierto es falsificable.",
    escenario_tecnico_6_partes: {
      fuente: "Actor que intenta falsificar un lote o acceder a datos personales del productor",
      estimulo: "Presenta un QR no emitido por el sistema o consulta datos de un productor sin derecho",
      artefacto: "Sistema de lotes y repositorio de datos personales",
      entorno: "Producción con lectura abierta vía QR y PIN corto de cooperativa",
      respuesta: "El sistema detecta la falta de firma/integridad o bloquea el acceso indebido y preserva la veracidad",
      medida_de_respuesta: "0 lotes falsificados aceptados; 100% de datos personales bajo medidas de la Ley 18.331"
    },
    trade_offs_identificados: "Lectura abierta [a5] y PIN de 4 dígitos [a6] sin firma/integridad debilitan el anti-falsificación; confidencialidad de datos personales del productor sin definir (GAP: no hay integridad, firma ni plan de cumplimiento 18.331).",
    origen: "brief:valores_no_negociables, Ley 18.331"
  },
  {
    id: "QA-004",
    atributo: "Usabilidad",
    es_asr_genuino: false,
    justificacion_arquitectonica: "El registro en <90s desde celular básico es un target de UX, no una decisión estructural; se resuelve con formularios simples y escaneo de QR, sin arquitectura especial.",
    escenario_tecnico_6_partes: {
      fuente: "Encargada de la cooperativa",
      estimulo: "Debe dar de alta un lote nuevo desde su celular",
      artefacto: "PWA de registro",
      entorno: "Cooperativa, celular básico, sin escritorio",
      respuesta: "Completa el alta de lote con datos completos sin llamadas ni planillas",
      medida_de_respuesta: "Tiempo de registro de lote nuevo < 90 segundos"
    },
    trade_offs_identificados: "Velocidad vs. completitud de campos; el campo mínimo obligatorio del lote aún no está decidido (GAP).",
    origen: "brief:metrica_sesion_exitosa"
  }
];

export const SYNTHESIS_CONSTRAINTS: RestriccionGlobalCard[] = [
  {
    id: "CON-001",
    tipo: "Stack Tecnológico",
    descripcion: "Stack atado al que maneja el creador: Node.js, TypeScript, PostgreSQL y una PWA liviana (sin app nativa).",
    impacto: "El diseño e implementación se limitan a este stack; sin frameworks pesados ni apps nativas para iOS/Android."
  },
  {
    id: "CON-002",
    tipo: "Presupuesto",
    descripcion: "Bootstrapped, plata propia, casi nula (dominio y servidor chico pagados con changas).",
    impacto: "Sin servidores grandes ni herramientas de pago; se prioriza lo esencial del MVP y nada de infraestructura costosa."
  },
  {
    id: "CON-003",
    tipo: "Tiempo",
    descripcion: "Poco tiempo porque el creador sigue estudiando ingeniería; ~6 meses para el piloto.",
    impacto: "Alcance congelado al MVP; sin margen para features fuera de alcance ni iteraciones largas."
  },
  {
    id: "CON-004",
    tipo: "Legal",
    descripcion: "Los datos deben vivir en Uruguay por la Ley de protección de datos personales (Ley 18.331).",
    impacto: "Hosting/servidor en Uruguay obligatorio; aplica consentimiento, derechos del titular y medidas de seguridad sobre datos personales de productores."
  },
  {
    id: "CON-005",
    tipo: "Alcance",
    descripcion: "Fuera de la primera versión: marketplace/venta directa al consumidor, pagos, lectura RFID, integración con ERPs de cadenas, multi-mercado y app de consumidor final.",
    impacto: "No se diseña ni implementa ninguna de estas funciones en el piloto; el QR impreso y la app de productores son el alcance."
  },
  {
    id: "CON-006",
    tipo: "Ético/Legal",
    descripcion: "No vender jamás los datos de los productores ni usar la información para perjudicar una cooperativa frente a otra; veracidad de los datos no negociable.",
    impacto: "El modelo de negocio no puede monetizar datos ni emitir certificados sin datos reales ('certificadora de humo' explícitamente rechazada); la verdad del dato prevalece aunque incomode."
  },
  {
    id: "CON-007",
    tipo: "Organizacional",
    descripcion: "Adopción decide la asamblea de cada cooperativa (organizaciones horizontales); en el Mercado Central decide el director de operaciones. Productores, choferes y controladores son consultados.",
    impacto: "El éxito depende de simplificar la vida a productores/choferes/controladores; hay que convencer a la asamblea, no a un jefe, y validar con el director de operaciones."
  }
];

export const SYNTHESIS_GLOSSARY: Record<string, string> = {
  "Lote": "Unidad de fruta/verdura registrada con un QR al momento de la cosecha, con origen, fecha y estado consultables.",
  "QR de lote": "Código impreso que apunta únicamente al identificador del lote; el servidor resuelve los IDs escaneados [a7].",
  "Trazabilidad": "Capacidad de demostrar origen, fecha de cosecha y estado de un lote en segundos, sin llamadas ni papel.",
  "PWA": "App web progresiva, liviana, pensada para celulares básicos sin app nativa.",
  "Chacra": "Explotación agrícola familiar que produce los lotes.",
  "Mercado Central": "Mercado mayorista donde se valida el sistema y se decide la instalación del lector (autoridad: director de operaciones).",
  "ASR": "Atributo de Calidad Significativo como Requerimiento (escenario de atributo de calidad que fuerza una decisión estructural profunda).",
  "Ley 18.331": "Ley uruguaya de protección de datos personales; exige residencia local de datos, consentimiento y derechos del titular.",
  "Certificadora de humo": "Modelo de negocio rechazado: vender sellos de trazabilidad sin datos reales detrás."
};

// Icons
const CloseXIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ChatBubbleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  </svg>
);

const DocumentTextIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 1-2 2v16a2 2 0 0 1 2 2h12a2 2 0 0 1 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </svg>
);

const RequirementsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6"></line>
    <line x1="8" y1="12" x2="21" y2="12"></line>
    <line x1="8" y1="18" x2="21" y2="18"></line>
    <line x1="3" y1="6" x2="3.01" y2="6"></line>
    <line x1="3" y1="12" x2="3.01" y2="12"></line>
    <line x1="3" y1="18" x2="3.01" y2="18"></line>
  </svg>
);

const QualityIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
  </svg>
);

const ConstraintsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
  </svg>
);

const GlossaryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
  </svg>
);

const DiagnosisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
  </svg>
);

const PlannerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="16" y1="2" x2="16" y2="6"></line>
    <line x1="8" y1="2" x2="8" y2="6"></line>
    <line x1="3" y1="10" x2="21" y2="10"></line>
  </svg>
);

const GitHubIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path>
    <path d="M9 18c-4.51 2-5-2-7-2"></path>
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

// ──────────────────────────────────────────────────
//  Diagnosis data model
// ──────────────────────────────────────────────────
export type Finding = {
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  file: string;
  line: number;
  description: string;
  labels: string[];
  duplicateOf?: number;
  template: {
    stepsToReproduce: string[];
    expectedBehavior: string;
    actualBehavior: string;
    area: string;
    logs: string;
  };
};

export type DiagnosisRecord = {
  id: string;
  timestamp: string;
  filename: string;
  repo: string;
  data: { mode: string; repo: string; findings: Finding[]; template: { additionalContext: string } };
};

function makeDiagStats(findings: Finding[]) {
  return {
    uniqueFiles: new Set(findings.map((f) => f.file)).size,
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    total: findings.length,
  };
}

// Demo history — pre-seeded with two completed diagnoses
const DEMO_DIAG_HISTORY: DiagnosisRecord[] = [
  {
    id: "diag-1786867200000",
    timestamp: "16/8/2026 · 14:23",
    filename: "plan-1786867200000.json",
    repo: diagResultRaw.repo,
    data: diagResultRaw as DiagnosisRecord["data"],
  },
  {
    id: "diag-1786867200000-1",
    timestamp: "16/8/2026 · 18:45",
    filename: "plan-1786867200000-1.json",
    repo: diagResultRaw2.repo,
    data: diagResultRaw2 as DiagnosisRecord["data"],
  },
];

const PLAN_RESULT = {
  session_id: "plan-1786765532009",
  timestamp: "2026-08-16T14:45:33Z",
  proyecto: "trazabilidad-horticola",
  fases: [
    {
      fase: 1,
      nombre: "MVP Core",
      duracion_semanas: 6,
      items: ["Alta de lotes por QR desde PWA", "Generación e impresión de etiqueta QR", "Consulta pública por QR (historial completo)"],
    },
    {
      fase: 2,
      nombre: "Offline & Sync",
      duracion_semanas: 4,
      items: ["Service Worker y caché local", "Cola de escritura offline con IDs cliente", "Motor de sincronización idempotente"],
    },
    {
      fase: 3,
      nombre: "Alertas & Legal",
      duracion_semanas: 3,
      items: ["Sistema de alertas de vencimiento", "Módulo de cumplimiento Ley 18.331", "Panel de consentimiento y derechos del titular"],
    },
    {
      fase: 4,
      nombre: "Piloto Cooperativa",
      duracion_semanas: 11,
      items: ["Deploy en servidor ubicado en Uruguay", "Onboarding de cooperativa real", "Validación en Mercado Central con director de operaciones"],
    },
  ],
  metricas_exito: {
    plazo_total_semanas: 24,
    objetivo_rechazos_por_trazabilidad: 0,
    cooperativas_piloto: 1,
  },
};

// ──────────────────────────────────────────────────
//  Opencode terminal log lines (used in both planning sections)
// ──────────────────────────────────────────────────
const DIAG_LOG_LINES = [
  `> opencode run --mode audit --repo ${DEMO_DIAG_HISTORY[0].repo}`,
  "  ✓ Cargando contexto del repositorio…",
  `  ✓ ${makeDiagStats(DEMO_DIAG_HISTORY[0].data.findings as Finding[]).uniqueFiles} archivos referenciados en hallazgos`,
  "  ⚡ Analizando cobertura de tests…",
  "  ⚡ Verificando integridad de sincronización offline…",
  ...(DEMO_DIAG_HISTORY[0].data.findings as Finding[]).map((f) =>
    f.severity === "critical" || f.severity === "high"
      ? `  ⚠ [${f.severity.toUpperCase()}] ${f.file}:${f.line} — ${f.title.slice(0, 60)}…`
      : `  · [${f.severity}] ${f.file}:${f.line} — ${f.title.slice(0, 55)}…`
  ),
  "  ✓ Diagnóstico completado → .agents/planning/plan-nuevo.json",
];

const PLAN_LOG_LINES = [
  "> opencode run --task plan --roadmap rfas",
  "  ✓ Leyendo RFs y ASRs del proyecto…",
  "  ✓ Restricciones de tiempo y presupuesto incorporadas",
  "  ⚡ Estructurando fases del roadmap…",
  "  ⚡ Estimando duraciones por fase…",
  "  ✓ Fase 1 – MVP Core (6 sem)",
  "  ✓ Fase 2 – Offline & Sync (4 sem)",
  "  ✓ Fase 3 – Alertas & Legal (3 sem)",
  "  ✓ Fase 4 – Piloto Cooperativa (11 sem)",
  "  ✓ Planificación completada → .agents/planning/plan-1786765532009.json",
];

// Simulated streaming terminal
function OpencodeterminalSession({
  logLines,
  active,
}: {
  logLines: string[];
  active: boolean;
}) {
  const [visibleCount, setVisibleCount] = React.useState(0);

  React.useEffect(() => {
    if (!active) { setVisibleCount(0); return; }
    setVisibleCount(1);
    let i = 1;
    const interval = setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= logLines.length) clearInterval(interval);
    }, 260);
    return () => clearInterval(interval);
  }, [active, logLines.length]);

  return (
    <div className="font-mono text-[11px] bg-[var(--bg)] border border-[var(--border)] rounded-md p-3.5 space-y-1 overflow-hidden">
      {logLines.slice(0, visibleCount).map((line, i) => {
        const isCmd = line.startsWith(">");
        const isWarn = line.includes("⚠");
        const isOk = line.includes("✓");
        const isRunning = line.includes("⚡");
        const cls = isCmd
          ? "text-[var(--accent)] font-semibold"
          : isWarn
          ? "text-amber-400"
          : isOk
          ? "text-emerald-400"
          : isRunning
          ? "text-[var(--text-secondary)] animate-pulse"
          : "text-[var(--text-muted)]";
        return (
          <div key={i} className={`leading-snug ${cls}`}>
            {line}
          </div>
        );
      })}
      {active && visibleCount < logLines.length && (
        <span className="inline-block w-2 h-3.5 bg-[var(--accent)] opacity-80 animate-pulse rounded-sm align-middle" />
      )}
    </div>
  );
}

// Collapsible JSON block
function CollapsibleJson({
  label,
  data,
  open,
  onToggle,
}: {
  label: string;
  data: object;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-[var(--border)] rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3.5 py-2.5 bg-[var(--bg)] hover:bg-[var(--surface-hover)] transition-colors text-xs font-mono text-[var(--text-muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      >
        <span className="font-semibold text-[var(--text-secondary)]">{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-[var(--border)]">
          <JsonCodeBlockInline data={data} />
        </div>
      )}
    </div>
  );
}

// Inline syntax-highlighted JSON (replicates JsonCodeBlock without an import cycle)
function JsonCodeBlockInline({ data }: { data: object }) {
  const json = JSON.stringify(data, null, 2);
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const highlighted = escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "text-amber-500";
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? "text-cyan-400 font-semibold" : "text-emerald-400";
      } else if (/true|false/.test(match)) {
        cls = "text-purple-400 font-semibold";
      } else if (/null/.test(match)) {
        cls = "text-rose-400 font-semibold";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
  return (
    <pre
      style={{ maxHeight: "340px" }}
      className="p-3.5 text-[11px] font-mono text-[var(--text-primary)] bg-[var(--bg)] overflow-auto whitespace-pre leading-relaxed"
    >
      <code dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  );
}

export default function CoreArchitectureModal({
  isOpen,
  onClose,
  projectName = "Plataforma de Trazabilidad Hortícola por QR",
  repoState,
  interviewState,
}: CoreArchitectureModalProps) {
  const [activeSubcategory, setActiveSubcategory] = useState<CoreSubcategory>("functional_requirements");
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // GitHub Issues state
  const [issueState, setIssueState] = useState<Record<string, { status: "pending" | "converting" | "converted"; issueNumber?: number; url?: string }>>({});
  const [selectedForIssue, setSelectedForIssue] = useState<string[]>([]);
  const [githubFilterType, setGithubFilterType] = useState<"all" | "rf" | "asr">("all");

  // Planning state — idle | running | done
  const [diagPhase, setDiagPhase] = useState<"idle" | "running" | "done">("idle");
  const [planPhase, setPlanPhase] = useState<"idle" | "running" | "done">("idle");
  const [diagJsonOpen, setDiagJsonOpen] = useState(false);
  const [planJsonOpen, setPlanJsonOpen] = useState(false);

  // Diagnosis history + GitHub Issues filter
  const [diagHistory, setDiagHistory] = useState<DiagnosisRecord[]>(DEMO_DIAG_HISTORY);
  const [activeDiagId, setActiveDiagId] = useState<string | null>(null);
  const [viewingDiagId, setViewingDiagId] = useState<string | null>(null); // null = list, set = detail view
  const [githubDiagFilter, setGithubDiagFilter] = useState<string>("all");

  // Backward-compat shims referenced by existing JSX (kept for safety)
  const analyzingRepo = diagPhase === "running";
  const planningRoadmap = planPhase === "running";

  const modalRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  // Handle focus trap & body scroll lock
  useEffect(() => {
    if (isOpen) {
      lastActiveElementRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";

      const focusableElements = modalRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements && focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    } else {
      document.body.style.overflow = "";
      if (lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === "function") {
        lastActiveElementRef.current.focus();
      }
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Handle keyboard events (ESC to close, Tab trapping)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubcategoryChange = (sub: CoreSubcategory) => {
    setActiveSubcategory(sub);
    setSearch("");
  };

  const handleConvertToIssue = (id: string) => {
    setIssueState((prev) => ({
      ...prev,
      [id]: { status: "converting" },
    }));

    setTimeout(() => {
      const issueNum = Math.floor(Math.random() * 80) + 101;
      setIssueState((prev) => ({
        ...prev,
        [id]: {
          status: "converted",
          issueNumber: issueNum,
          url: `https://github.com/org/repo/issues/${issueNum}`,
        },
      }));
    }, 1200);
  };

  const handleToggleSelectForIssue = (id: string) => {
    setSelectedForIssue((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAllForIssue = (allIds: string[]) => {
    if (selectedForIssue.length === allIds.length) {
      setSelectedForIssue([]);
    } else {
      setSelectedForIssue(allIds);
    }
  };

  const handleConvertBatch = () => {
    if (selectedForIssue.length === 0) return;
    selectedForIssue.forEach((id) => {
      if (issueState[id]?.status !== "converted") {
        handleConvertToIssue(id);
      }
    });
  };

  const handleCopy = async (text: string, id: string) => {
    const success = await safeCopyToClipboard(text);
    if (success) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const glossaryEntries = Object.entries(SYNTHESIS_GLOSSARY);

  // FIX: Runtime crash fix by using `r.justificacion` instead of `r.justification`
  const filteredRequirements = SYNTHESIS_REQUIREMENTS.filter((r) =>
    r.descripcion.toLowerCase().includes(search.toLowerCase()) ||
    (r.justificacion && r.justificacion.toLowerCase().includes(search.toLowerCase())) ||
    r.id.toLowerCase().includes(search.toLowerCase()) ||
    r.origen.toLowerCase().includes(search.toLowerCase())
  );

  const filteredQuality = SYNTHESIS_QUALITY_ATTRIBUTES.filter((q) =>
    q.atributo.toLowerCase().includes(search.toLowerCase()) ||
    q.justificacion_arquitectonica.toLowerCase().includes(search.toLowerCase()) ||
    q.id.toLowerCase().includes(search.toLowerCase())
  );

  const filteredConstraints = SYNTHESIS_CONSTRAINTS.filter((c) =>
    c.tipo.toLowerCase().includes(search.toLowerCase()) ||
    c.descripcion.toLowerCase().includes(search.toLowerCase()) ||
    c.impacto.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase())
  );

  const filteredGlossary = glossaryEntries.filter(([term, def]) =>
    term.toLowerCase().includes(search.toLowerCase()) ||
    def.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="modal-scrim p-4 flex items-center justify-center z-[250] overscroll-contain"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="core-modal-title"
    >
      {/* Live region for screen reader notifications */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {copiedId ? `Elemento ${copiedId} copiado al portapapeles` : ""}
      </div>

      {/* SINGLE UNIFIED MODAL CONTAINER - 92vw x 90vh FIXED - ZERO NESTED SCRIMS */}
      <div
        ref={modalRef}
        className="w-[92vw] max-w-[1400px] h-[90vh] max-h-[900px] bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl flex overflow-hidden tc-enter relative"
      >
        {/* Left Sidebar Navigation */}
        <aside className="w-64 bg-[var(--bg)] border-r border-[var(--border)] flex flex-col justify-between p-4 shrink-0 overflow-y-auto">
          <div className="space-y-5">
            {/* Category Group 1: ENTREVISTAS */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase block px-1 font-semibold">
                ENTREVISTAS
              </span>

              <nav className="space-y-1" aria-label="Navegación de Entrevistas">
                <button
                  type="button"
                  aria-current={activeSubcategory === "repo_context" ? "page" : undefined}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                    activeSubcategory === "repo_context"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  onClick={() => handleSubcategoryChange("repo_context")}
                >
                  <div className="flex items-center gap-2 truncate">
                    <ChatBubbleIcon />
                    <span className="truncate">Contexto del Repositorio</span>
                  </div>
                  <span className="text-[9.5px] font-mono opacity-80 shrink-0">
                    Fase 0
                  </span>
                </button>

                <button
                  type="button"
                  aria-current={activeSubcategory === "requirements_interview" ? "page" : undefined}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                    activeSubcategory === "requirements_interview"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  onClick={() => handleSubcategoryChange("requirements_interview")}
                >
                  <div className="flex items-center gap-2 truncate">
                    <DocumentTextIcon />
                    <span className="truncate">Entrevista de Requerimientos</span>
                  </div>
                  <span className="text-[9.5px] font-mono opacity-80 shrink-0">
                    IA
                  </span>
                </button>
              </nav>
            </div>

            {/* Category Group 2: POST ENTREVISTAS */}
            <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
              <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase block px-1 font-semibold">
                POST ENTREVISTAS
              </span>

              <nav className="space-y-1" aria-label="Navegación Post Entrevistas">
                <button
                  type="button"
                  aria-current={activeSubcategory === "functional_requirements" ? "page" : undefined}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                    activeSubcategory === "functional_requirements"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  onClick={() => handleSubcategoryChange("functional_requirements")}
                >
                  <div className="flex items-center gap-2 truncate">
                    <RequirementsIcon />
                    <span className="truncate">Requerimientos Funcionales</span>
                  </div>
                  <span className="text-[9.5px] font-mono shrink-0 tabular-nums">
                    {SYNTHESIS_REQUIREMENTS.length}
                  </span>
                </button>

                <button
                  type="button"
                  aria-current={activeSubcategory === "quality_attributes" ? "page" : undefined}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                    activeSubcategory === "quality_attributes"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  onClick={() => handleSubcategoryChange("quality_attributes")}
                >
                  <div className="flex items-center gap-2 truncate">
                    <QualityIcon />
                    <span className="truncate">Atributos de Calidad (ASR)</span>
                  </div>
                  <span className="text-[9.5px] font-mono shrink-0 tabular-nums">
                    {SYNTHESIS_QUALITY_ATTRIBUTES.length}
                  </span>
                </button>

                <button
                  type="button"
                  aria-current={activeSubcategory === "constraints" ? "page" : undefined}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                    activeSubcategory === "constraints"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  onClick={() => handleSubcategoryChange("constraints")}
                >
                  <div className="flex items-center gap-2 truncate">
                    <ConstraintsIcon />
                    <span className="truncate">Restricciones Globales</span>
                  </div>
                  <span className="text-[9.5px] font-mono shrink-0 tabular-nums">
                    {SYNTHESIS_CONSTRAINTS.length}
                  </span>
                </button>

                <button
                  type="button"
                  aria-current={activeSubcategory === "glossary" ? "page" : undefined}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                    activeSubcategory === "glossary"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  onClick={() => handleSubcategoryChange("glossary")}
                >
                  <div className="flex items-center gap-2 truncate">
                    <GlossaryIcon />
                    <span className="truncate">Glosario del Proyecto</span>
                  </div>
                  <span className="text-[9.5px] font-mono shrink-0 tabular-nums">
                    {glossaryEntries.length}
                  </span>
                </button>
              </nav>
            </div>

            {/* Category Group 3: PLANNING */}
            <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
              <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase block px-1 font-semibold">
                PLANNING
              </span>

              <nav className="space-y-1" aria-label="Navegación de Planning">
                <button
                  type="button"
                  aria-current={activeSubcategory === "planning_diagnosis" ? "page" : undefined}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                    activeSubcategory === "planning_diagnosis"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  onClick={() => handleSubcategoryChange("planning_diagnosis")}
                >
                  <div className="flex items-center gap-2 truncate">
                    <DiagnosisIcon />
                    <span className="truncate">Diagnóstico</span>
                  </div>
                  <span className="text-[9.5px] font-mono opacity-80 shrink-0">
                    Repo
                  </span>
                </button>

                <button
                  type="button"
                  aria-current={activeSubcategory === "planning_roadmap" ? "page" : undefined}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                    activeSubcategory === "planning_roadmap"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  onClick={() => handleSubcategoryChange("planning_roadmap")}
                >
                  <div className="flex items-center gap-2 truncate">
                    <PlannerIcon />
                    <span className="truncate">Planificador</span>
                  </div>
                  <span className="text-[9.5px] font-mono opacity-80 shrink-0">
                    Roadmap
                  </span>
                </button>
              </nav>
            </div>

            {/* Category Group 4: INTEGRACIONES */}
            <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
              <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase block px-1 font-semibold">
                INTEGRACIONES
              </span>

              <nav className="space-y-1" aria-label="Navegación de Integraciones">
                <button
                  type="button"
                  aria-current={activeSubcategory === "github_issues" ? "page" : undefined}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                    activeSubcategory === "github_issues"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  onClick={() => handleSubcategoryChange("github_issues")}
                >
                  <div className="flex items-center gap-2 truncate">
                    <GitHubIcon />
                    <span className="truncate">GitHub Issues</span>
                  </div>
                  <span className="text-[9.5px] font-mono shrink-0 font-semibold opacity-80">
                    IA
                  </span>
                </button>
              </nav>
            </div>
          </div>
        </aside>

        {/* Main Viewport Panel */}
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--surface)]">
          {/* Top Header Bar */}
          <header className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg)]/50 shrink-0">
            <h2 id="core-modal-title" className="text-xs font-semibold text-[var(--text-primary)] truncate">
              {projectName}
            </h2>

            <button
              type="button"
              className="icon-btn text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
              onClick={onClose}
              aria-label="Cerrar modal"
            >
              <CloseXIcon />
            </button>
          </header>

          {/* Subcategory Viewport Router */}
          <div className="flex-1 overflow-y-auto p-5">
            {/* 1. Subcategory: Contexto del Repositorio INLINE */}
            {activeSubcategory === "repo_context" && (
              <div className="w-full space-y-4">
                <RepoContextModal
                  isOpen={true}
                  isInline={true}
                  onClose={onClose}
                  phase={repoState.phase}
                  view={repoState.view}
                  briefs={repoState.briefs}
                  activePath={repoState.activePath}
                  selectedPath={repoState.selectedPath}
                  inProgress={repoState.inProgress}
                  position={repoState.position}
                  briefAnswer={repoState.briefAnswer}
                  canGoBack={repoState.canGoBack}
                  busy={repoState.busy}
                  briefDone={repoState.briefDone}
                  briefError={repoState.briefError}
                  onSelectPath={repoState.onSelectPath}
                  onActivateSelected={repoState.onActivateSelected}
                  onDeleteBrief={repoState.onDeleteBrief}
                  onStartInterview={repoState.onStartInterview}
                  onSubmitAnswer={repoState.onSubmitAnswer}
                  onAnswerChange={repoState.onAnswerChange}
                  onGoBack={repoState.onGoBack}
                  onExitInterview={repoState.onExitInterview}
                  onUseDoneAsContext={repoState.onUseDoneAsContext}
                  onDeleteLedger={repoState.onDeleteLedger}
                  onResumeLedger={repoState.onResumeLedger}
                  onRetrySynthesis={repoState.onRetrySynthesis}
                  onSwitchView={repoState.onSwitchView}
                />
              </div>
            )}

            {/* 2. Subcategory: Entrevista de Requerimientos INLINE */}
            {activeSubcategory === "requirements_interview" && (
              <div className="w-full space-y-4">
                <InterviewModal
                  isOpen={true}
                  isInline={true}
                  onClose={onClose}
                  onViewResults={() => setActiveSubcategory("functional_requirements")}
                  phase={interviewState.phase}
                  busy={interviewState.busy}
                  summaries={interviewState.summaries}
                  showBrief={interviewState.showBrief}
                  briefInfo={interviewState.briefInfo}
                  qIndex={interviewState.qIndex}
                  questions={interviewState.questions}
                  selectedOptionId={interviewState.selectedOptionId}
                  freeText={interviewState.freeText}
                  canGoBack={interviewState.canGoBack}
                  answered={interviewState.answered}
                  doneReason={interviewState.doneReason}
                  ledgerPath={interviewState.ledgerPath}
                  errorMessage={interviewState.errorMessage}
                  synthesis={interviewState.synthesis}
                  activeInterviewPath={interviewState.activeInterviewPath}
                  onActivateInterview={interviewState.onActivateInterview}
                  onStartNew={interviewState.onStartNew}
                  onResume={interviewState.onResume}
                  onDeleteSummary={interviewState.onDeleteSummary}
                  onSelectOption={interviewState.onSelectOption}
                  onTextChange={interviewState.onTextChange}
                  onSubmitAnswer={interviewState.onSubmitAnswer}
                  onGoBack={interviewState.onGoBack}
                  onGoToPick={interviewState.onGoToPick}
                  onOpenContextModal={() => setActiveSubcategory("repo_context")}
                />
              </div>
            )}

            {/* 3. Subcategory: Requerimientos Funcionales */}
            {activeSubcategory === "functional_requirements" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
                  <input
                    type="text"
                    aria-label="Buscar requerimientos funcionales"
                    placeholder="Buscar requerimiento…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="textarea-minimal text-xs py-1.5 max-w-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                  />
                  <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
                    {filteredRequirements.length} requerimientos funcionales
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                  {filteredRequirements.map((req) => (
                    <div
                      key={req.id}
                      className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2.5 flex flex-col justify-between text-xs"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10.5px] font-semibold text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                            {req.id}
                          </span>
                          <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border bg-[var(--red-soft)] text-[var(--red)] border-red-500/20">
                            {req.prioridad}
                          </span>
                        </div>

                        <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug">
                          {req.descripcion}
                        </p>

                        <div className="space-y-0.5 pt-1 border-t border-[var(--border)]">
                          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                            JUSTIFICACIÓN
                          </span>
                          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                            {req.justificacion}
                          </p>
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                            CRITERIO DE AJUSTE
                          </span>
                          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                            {req.criterio_de_ajuste}
                          </p>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                        <span className="truncate max-w-[200px]" title={`Origen: ${req.origen}`}>Origen: {req.origen}</span>
                        <button
                          type="button"
                          className="hover:text-[var(--text-primary)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                          onClick={() => handleCopy(`${req.id}: ${req.descripcion}\nJustificación: ${req.justificacion}`, req.id)}
                          aria-label={`Copiar requerimiento ${req.id}`}
                          title={`Copiar requerimiento ${req.id}`}
                        >
                          {copiedId === req.id ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 4. Subcategory: Atributos de Calidad (ASR) */}
            {activeSubcategory === "quality_attributes" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
                  <input
                    type="text"
                    aria-label="Buscar atributos de calidad"
                    placeholder="Buscar atributo de calidad…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="textarea-minimal text-xs py-1.5 max-w-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                  />
                  <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
                    {filteredQuality.length} atributos ASR
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredQuality.map((q) => (
                    <div
                      key={q.id}
                      className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10.5px] font-semibold text-[var(--text-primary)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                            {q.id}
                          </span>
                          <span className={`text-[9.5px] font-semibold px-2 py-0.5 rounded ${
                            q.es_asr_genuino
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                              : "bg-[var(--accent-soft)] text-[var(--accent)]"
                          }`}>
                            {q.es_asr_genuino ? "ASR Genuino" : "Preferencia UX / Calidad"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="hover:text-[var(--text-primary)] text-[var(--text-muted)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                          onClick={() => handleCopy(`${q.id}: ${q.atributo}\n${q.justificacion_arquitectonica}`, q.id)}
                          aria-label={`Copiar atributo de calidad ${q.id}`}
                          title={`Copiar ASR ${q.id}`}
                        >
                          {copiedId === q.id ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      </div>

                      <h3 className="text-xs font-bold text-[var(--text-primary)]">
                        {q.atributo}
                      </h3>

                      <div className="space-y-0.5">
                        <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                          JUSTIFICACIÓN ARQUITECTÓNICA
                        </span>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                          {q.justificacion_arquitectonica}
                        </p>
                      </div>

                      {/* Scenario 6 Parts */}
                      <div className="p-2.5 rounded bg-[var(--surface)] border border-[var(--border)] space-y-1.5 text-[10.5px]">
                        <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                          ESCENARIO TÉCNICO (6 PARTES)
                        </span>
                        <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                          <div>
                            <span className="text-[var(--text-muted)] block">Fuente:</span>
                            <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.fuente}</span>
                          </div>
                          <div>
                            <span className="text-[var(--text-muted)] block">Estímulo:</span>
                            <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.estimulo}</span>
                          </div>
                          <div>
                            <span className="text-[var(--text-muted)] block">Artefacto:</span>
                            <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.artefacto}</span>
                          </div>
                          <div>
                            <span className="text-[var(--text-muted)] block">Entorno:</span>
                            <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.entorno}</span>
                          </div>
                          <div>
                            <span className="text-[var(--text-muted)] block">Respuesta:</span>
                            <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.respuesta}</span>
                          </div>
                          <div>
                            <span className="text-[var(--text-muted)] block">Medida de respuesta:</span>
                            <span className="text-[var(--accent)] font-mono font-semibold">{q.escenario_tecnico_6_partes.medida_de_respuesta}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-0.5 pt-1 border-t border-[var(--border)]">
                        <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                          TRADE-OFFS IDENTIFICADOS
                        </span>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                          {q.trade_offs_identificados}
                        </p>
                        <span className="text-[10px] font-mono text-[var(--text-muted)] block pt-0.5">
                          Origen: {q.origen}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. Subcategory: Restricciones Globales */}
            {activeSubcategory === "constraints" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
                  <input
                    type="text"
                    aria-label="Buscar restricciones globales"
                    placeholder="Buscar restricción…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="textarea-minimal text-xs py-1.5 max-w-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                  />
                  <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
                    {filteredConstraints.length} restricciones globales
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                  {filteredConstraints.map((c) => (
                    <div
                      key={c.id}
                      className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2.5 flex flex-col justify-between text-xs"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] font-semibold text-[var(--amber)] bg-[var(--amber-soft)] px-2 py-0.5 rounded border border-amber-500/20 uppercase tracking-wider">
                            {c.tipo}
                          </span>
                          <span className="font-mono text-[10.5px] font-semibold text-[var(--text-primary)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                            {c.id}
                          </span>
                        </div>

                        <p className="text-xs font-semibold text-[var(--text-primary)] leading-relaxed">
                          {c.descripcion}
                        </p>

                        <div className="p-2.5 rounded bg-[var(--red-soft)] border border-red-500/20 text-[11px] text-[var(--text-primary)] space-y-0.5">
                          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--red)] font-semibold block">
                            ⚠ IMPACTO EN DISEÑO
                          </span>
                          <p className="leading-snug">{c.impacto}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Subcategory: Glosario del Proyecto */}
            {activeSubcategory === "glossary" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
                  <input
                    type="text"
                    aria-label="Buscar términos en el glosario"
                    placeholder="Buscar término en el glosario…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="textarea-minimal text-xs py-1.5 max-w-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                  />
                  <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
                    {filteredGlossary.length} términos registrados
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filteredGlossary.map(([term, definition], idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-1 text-xs"
                    >
                      <h3 className="text-xs font-bold text-[var(--text-primary)] font-mono">
                        {term}
                      </h3>
                      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                        {definition}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 7. Subcategory: Diagnóstico (PLANNING) */}
            {activeSubcategory === "planning_diagnosis" && (() => {
              // ── DETAIL VIEW ─────────────────────────────────────────────
              if (viewingDiagId !== null) {
                const rec = diagHistory.find((d) => d.id === viewingDiagId);
                if (!rec) { setViewingDiagId(null); return null; }
                const findings = rec.data.findings as Finding[];
                const stats = makeDiagStats(findings);
                return (
                  <div className="space-y-5">
                    {/* Back nav */}
                    <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        onClick={() => { setViewingDiagId(null); setDiagJsonOpen(false); }}
                      >
                        <span>←</span>
                        <span>Volver al diagnóstico</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] flex items-center gap-1.5"
                        onClick={() => { handleSubcategoryChange("github_issues"); setGithubDiagFilter(rec.id); }}
                      >
                        <GitHubIcon />
                        <span>Ver en GitHub Issues →</span>
                      </button>
                    </div>

                    {/* Header */}
                    <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-500/8 border border-emerald-500/25">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-sm shrink-0 mt-0.5">✓</div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-emerald-400">Diagnóstico completado</p>
                        <p className="text-[10.5px] font-mono text-[var(--text-muted)]">{rec.repo}</p>
                        <p className="text-[10px] font-mono text-[var(--text-muted)]">{rec.filename} · {rec.timestamp}</p>
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: "Archivos analizados", value: stats.uniqueFiles },
                        { label: "Dependencias", value: findings.filter((f) => f.labels.includes("refactor") || f.labels.includes("bug")).length },
                        { label: "Issues críticos", value: stats.critical, highlight: true },
                        { label: "Cobertura estimada", value: `${Math.round(((stats.total - findings.filter((f) => f.labels.includes("tests")).length) / Math.max(stats.total, 1)) * 100 * 0.6)}%` },
                      ].map(({ label, value, highlight }) => (
                        <div key={label} className={`p-3 rounded-md border text-center space-y-0.5 ${highlight ? "bg-red-500/8 border-red-500/25" : "bg-[var(--bg)] border-[var(--border)]"}`}>
                          <p className={`text-base font-bold font-mono tabular-nums ${highlight ? "text-red-400" : "text-[var(--text-primary)]"}`}>{value}</p>
                          <p className="text-[10px] text-[var(--text-muted)] leading-tight">{label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Findings */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">ISSUES DETECTADOS</span>
                        <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums">
                          {stats.total} hallazgos · {stats.critical} críticos · {stats.high} altos
                        </span>
                      </div>
                      {findings.map((finding, i) => {
                        const sStyle = finding.severity === "critical" ? "border-red-500/25 bg-red-500/5" : finding.severity === "high" ? "border-amber-500/20 bg-amber-500/5" : "border-[var(--border)] bg-[var(--bg)]";
                        const sBadge = finding.severity === "critical" ? "text-red-400 bg-red-500/15 border-red-500/25" : finding.severity === "high" ? "text-amber-400 bg-amber-500/15 border-amber-500/20" : "text-[var(--text-muted)] bg-[var(--surface)] border-[var(--border)]";
                        return (
                          <div key={i} className={`p-3 rounded-md border text-xs space-y-1.5 ${sStyle}`}>
                            <div className="flex items-start gap-2 flex-wrap">
                              <span className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${sBadge}`}>{finding.severity.toUpperCase()}</span>
                              <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug flex-1">{finding.title}</p>
                            </div>
                            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{finding.description}</p>
                            <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                              <span className="font-mono text-[9.5px] text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">{finding.file}:{finding.line}</span>
                              {finding.labels.map((lbl) => (
                                <span key={lbl} className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]">{lbl}</span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <CollapsibleJson label={`Ver JSON resultante (${rec.filename})`} data={rec.data} open={diagJsonOpen} onToggle={() => setDiagJsonOpen((v) => !v)} />
                  </div>
                );
              }

              // ── LIST VIEW ────────────────────────────────────────────────
              return (
                <div className="space-y-5">

                  {/* RUNNING: only terminal */}
                  {diagPhase === "running" && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-[var(--border)]">
                        <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
                        <span className="text-[11px] font-mono font-semibold text-[var(--text-secondary)]">
                          Sesión opencode activa — diagnóstico en curso
                        </span>
                      </div>
                      <OpencodeterminalSession logLines={DIAG_LOG_LINES} active={true} />
                    </div>
                  )}

                  {/* IDLE: action card + history */}
                  {diagPhase !== "running" && (
                    <>
                      {/* Action card */}
                      <div className="flex items-start gap-4 p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                        <div className="w-9 h-9 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0 mt-0.5">
                          <DiagnosisIcon />
                        </div>
                        <div className="space-y-1 flex-1">
                          <h3 className="text-xs font-bold text-[var(--text-primary)]">Diagnóstico del Repositorio</h3>
                          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                            Ejecuta una sesión de opencode que examina la estructura de archivos, dependencias y cobertura para detectar issues reproducibles y brechas de arquitectura.
                          </p>
                          <p className="text-[10.5px] font-mono text-[var(--text-muted)] pt-0.5">
                            Resultado guardado en{" "}
                            <code className="text-[var(--text-secondary)] bg-[var(--surface)] px-1 rounded border border-[var(--border)]">
                              .agents/planning/diag-*.json
                            </code>
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0"
                          onClick={() => {
                            const newId = `diag-${Date.now()}`;
                            setDiagPhase("running");
                            setTimeout(() => {
                              const newRecord: DiagnosisRecord = {
                                id: newId,
                                timestamp: new Date().toLocaleString("es-AR", { day: "2-digit", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " ·"),
                                filename: `plan-${newId}.json`,
                                repo: DEMO_DIAG_HISTORY[0].repo,
                                data: DEMO_DIAG_HISTORY[0].data,
                              };
                              setDiagHistory((prev) => [newRecord, ...prev]);
                              setActiveDiagId(newId);
                              setDiagPhase("idle");
                              setDiagJsonOpen(false);
                              setViewingDiagId(newId);
                            }, DIAG_LOG_LINES.length * 260 + 600);
                          }}
                        >
                          + Nuevo diagnóstico
                        </button>
                      </div>

                      {/* History */}
                      <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                            HISTORIAL DE DIAGNÓSTICOS
                          </span>
                          <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums">
                            {diagHistory.length} diagnóstico(s)
                          </span>
                        </div>

                        {diagHistory.length === 0 ? (
                          <p className="text-[11px] text-[var(--text-muted)] py-4 text-center">
                            Todavía no hay diagnósticos completados.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {diagHistory.map((rec) => {
                              const stats = makeDiagStats(rec.data.findings as Finding[]);
                              return (
                                <div
                                  key={rec.id}
                                  className="p-3 rounded-md border text-xs flex items-center justify-between gap-3 cursor-pointer transition-all border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)]/50 hover:bg-[var(--surface)]"
                                  onClick={() => { setViewingDiagId(rec.id); setDiagJsonOpen(false); }}
                                >
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <span className="font-mono text-[10.5px] text-[var(--text-muted)] shrink-0">{rec.timestamp}</span>
                                    <span className="font-mono text-[10px] text-[var(--text-muted)] truncate">{rec.repo}</span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {stats.critical > 0 && (
                                      <span className="text-[9.5px] font-semibold text-red-400 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded font-mono">
                                        {stats.critical} crítico{stats.critical > 1 ? "s" : ""}
                                      </span>
                                    )}
                                    <span className="text-[9.5px] font-mono text-[var(--text-muted)]">{stats.total} hallazgos</span>
                                    <button
                                      type="button"
                                      className="btn btn-ghost text-[11px] py-0.5 px-2 border border-[var(--border)]"
                                      onClick={(e) => { e.stopPropagation(); handleSubcategoryChange("github_issues"); setGithubDiagFilter(rec.id); }}
                                    >
                                      GitHub Issues →
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* 8. Subcategory: Planificador (PLANNING) */}
            {activeSubcategory === "planning_roadmap" && (
              <div className="space-y-5">

                {/* ── IDLE: action button + description ── */}
                {planPhase === "idle" && (
                  <div className="flex flex-col gap-5">
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                      <div className="w-9 h-9 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0 mt-0.5">
                        <PlannerIcon />
                      </div>
                      <div className="space-y-1 flex-1">
                        <h3 className="text-xs font-bold text-[var(--text-primary)]">Planificador desde Roadmap</h3>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                          Ejecuta una sesión de opencode que sintetiza los RFs, ASRs y restricciones del proyecto para estructurar las etapas del roadmap con duraciones estimadas.
                        </p>
                        <p className="text-[10.5px] font-mono text-[var(--text-muted)] pt-0.5">
                          Resultado guardado en{" "}
                          <code className="text-[var(--text-secondary)] bg-[var(--surface)] px-1 rounded border border-[var(--border)]">
                            .agents/planning/plan-*.json
                          </code>
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0"
                        onClick={() => {
                          setPlanPhase("running");
                          setTimeout(() => setPlanPhase("done"), PLAN_LOG_LINES.length * 260 + 600);
                        }}
                      >
                        Planificar desde roadmap
                      </button>
                    </div>
                    <div className="flex-1 flex items-center justify-center py-16 text-center">
                      <p className="text-xs text-[var(--text-muted)] max-w-sm leading-relaxed">
                        Generá la planificación de tareas y etapas del roadmap a partir del contexto completo del proyecto.
                      </p>
                    </div>
                  </div>
                )}

                {/* ── RUNNING: opencode terminal session only ── */}
                {planPhase === "running" && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-[var(--border)]">
                      <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
                      <span className="text-[11px] font-mono font-semibold text-[var(--text-secondary)]">
                        Sesión opencode activa — generando roadmap en curso
                      </span>
                    </div>
                    <OpencodeterminalSession logLines={PLAN_LOG_LINES} active={planPhase === "running"} />
                  </div>
                )}

                {/* ── DONE: completion state ── */}
                {planPhase === "done" && (
                  <div className="space-y-4">
                    {/* Success banner */}
                    <div className="flex items-center justify-between p-3.5 rounded-lg bg-emerald-500/8 border border-emerald-500/25">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-sm shrink-0">
                          ✓
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-emerald-400">Planificación completada</p>
                          <p className="text-[10.5px] font-mono text-[var(--text-muted)]">
                            {PLAN_RESULT.timestamp} · {PLAN_RESULT.session_id}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)]"
                        onClick={() => { setPlanPhase("idle"); setPlanJsonOpen(false); }}
                      >
                        Volver a ejecutar
                      </button>
                    </div>

                    {/* Phase timeline */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold block">
                        FASES DEL ROADMAP
                      </span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {PLAN_RESULT.fases.map((fase) => (
                          <div
                            key={fase.fase}
                            className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[10px] font-bold flex items-center justify-center font-mono shrink-0">
                                  {fase.fase}
                                </span>
                                <span className="text-xs font-bold text-[var(--text-primary)]">{fase.nombre}</span>
                              </div>
                              <span className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                                {fase.duracion_semanas} sem
                              </span>
                            </div>
                            <ul className="space-y-1">
                              {fase.items.map((item, i) => (
                                <li key={i} className="flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)] leading-snug">
                                  <span className="text-emerald-400 shrink-0 mt-px">·</span>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Summary metrics */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Plazo total", value: `${PLAN_RESULT.metricas_exito.plazo_total_semanas} sem` },
                        { label: "Objetivo rechazos", value: PLAN_RESULT.metricas_exito.objetivo_rechazos_por_trazabilidad, highlight: false },
                        { label: "Cooperativas piloto", value: PLAN_RESULT.metricas_exito.cooperativas_piloto },
                      ].map(({ label, value }) => (
                        <div
                          key={label}
                          className="p-3 rounded-md border border-[var(--border)] bg-[var(--bg)] text-center space-y-0.5"
                        >
                          <p className="text-base font-bold font-mono tabular-nums text-[var(--text-primary)]">{value}</p>
                          <p className="text-[10px] text-[var(--text-muted)] leading-tight">{label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Collapsible JSON */}
                    <CollapsibleJson
                      label="Ver JSON resultante (.agents/planning/plan-1786765532009.json)"
                      data={PLAN_RESULT}
                      open={planJsonOpen}
                      onToggle={() => setPlanJsonOpen((v) => !v)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* 7. Subcategory: GitHub Issues Sync */}
            {activeSubcategory === "github_issues" && (() => {
              const allItemsTyped = diagHistory.flatMap((rec) =>
                (rec.data.findings as Finding[]).map((finding, idx) => ({
                  id: `${rec.id}::${idx}`,
                  diagId: rec.id,
                  diagTimestamp: rec.timestamp,
                  diagRepo: rec.repo,
                  finding,
                  githubLabels: [`severity: ${finding.severity}`, ...finding.labels],
                }))
              );

              const filteredByDiag = githubDiagFilter === "all"
                ? allItemsTyped
                : allItemsTyped.filter((i) => i.diagId === githubDiagFilter);

              const filteredItems = filteredByDiag.filter((item) =>
                item.finding.title.toLowerCase().includes(search.toLowerCase()) ||
                item.finding.file.toLowerCase().includes(search.toLowerCase()) ||
                item.finding.severity.toLowerCase().includes(search.toLowerCase()) ||
                item.finding.labels.some((l) => l.toLowerCase().includes(search.toLowerCase()))
              );

              const allFilteredIds = filteredItems.map((i) => i.id);
              const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedForIssue.includes(id));

              if (diagHistory.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)]">
                      <GitHubIcon />
                    </div>
                    <p className="text-xs font-semibold text-[var(--text-primary)]">Sin diagnósticos completados</p>
                    <p className="text-[11px] text-[var(--text-muted)] max-w-xs leading-relaxed">
                      Completá al menos un diagnóstico en la sección PLANNING → Diagnóstico para habilitar la conversión a GitHub Issues.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary text-xs py-1.5 px-4 font-semibold"
                      onClick={() => handleSubcategoryChange("planning_diagnosis")}
                    >
                      Ir a Diagnóstico →
                    </button>
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  {/* Header: Diagnoses filter pills + batch actions */}
                  <div className="p-3.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] space-y-3">
                    {/* Diagnosis source filter */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold block">
                        FUENTE — DIAGNÓSTICO
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors border ${
                            githubDiagFilter === "all"
                              ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)] font-semibold"
                              : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]"
                          }`}
                          onClick={() => { setGithubDiagFilter("all"); setSelectedForIssue([]); }}
                        >
                          Todos ({allItemsTyped.length})
                        </button>
                        {diagHistory.map((rec) => {
                          const count = (rec.data.findings as Finding[]).length;
                          const isActive = githubDiagFilter === rec.id;
                          return (
                            <button
                              key={rec.id}
                              type="button"
                              className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors border max-w-[220px] truncate ${
                                isActive
                                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)] font-semibold"
                                  : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]"
                              }`}
                              onClick={() => { setGithubDiagFilter(rec.id); setSelectedForIssue([]); }}
                              title={`${rec.repo} · ${rec.timestamp}`}
                            >
                              {rec.timestamp} · {count} hallazgo{count !== 1 ? "s" : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Batch action row */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border)]">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          aria-label="Filtrar hallazgos por texto, archivo o label"
                          placeholder="Filtrar por texto, archivo o label…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="textarea-minimal text-xs py-1.5 max-w-xs"
                        />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10.5px] font-mono text-[var(--text-muted)] tabular-nums">
                          {filteredItems.length} visible{filteredItems.length !== 1 ? "s" : ""}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost text-xs py-1.5 px-3"
                          onClick={() => handleSelectAllForIssue(allFilteredIds)}
                        >
                          {isAllSelected ? "Desmarcar todos" : "Seleccionar todos"}
                        </button>
                        <button
                          type="button"
                          disabled={selectedForIssue.length === 0}
                          className="btn btn-primary text-xs py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                          onClick={handleConvertBatch}
                        >
                          <GitHubIcon />
                          <span>Convertir seleccionados ({selectedForIssue.length})</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Items list — findings from diagnoses */}
                  {filteredItems.length === 0 ? (
                    <p className="text-[11px] text-[var(--text-muted)] text-center py-8">
                      Sin hallazgos que coincidan con el filtro.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {filteredItems.map((item) => {
                        const iState = issueState[item.id] || { status: "pending" };
                        const isSelected = selectedForIssue.includes(item.id);
                        const f = item.finding;
                        const sBadge = f.severity === "critical"
                          ? "text-red-400 bg-red-500/15 border-red-500/25"
                          : f.severity === "high"
                          ? "text-amber-400 bg-amber-500/15 border-amber-500/20"
                          : "text-[var(--text-muted)] bg-[var(--surface)] border-[var(--border)]";

                        return (
                          <div
                            key={item.id}
                            onClick={() => { if (iState.status !== "converted") handleToggleSelectForIssue(item.id); }}
                            className={`p-3 rounded-md border text-xs transition-all flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                              iState.status === "converted"
                                ? "bg-emerald-500/5 border-emerald-500/20"
                                : isSelected
                                ? "bg-[var(--bg)] border-[var(--accent)] ring-1 ring-[var(--accent)] cursor-pointer"
                                : "bg-[var(--bg)] border-[var(--border)] hover:border-[var(--text-muted)] cursor-pointer"
                            }`}
                          >
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={iState.status === "converted"}
                                onChange={() => handleToggleSelectForIssue(item.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer shrink-0"
                              />
                              <div className="space-y-1.5 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${sBadge}`}>
                                    {f.severity.toUpperCase()}
                                  </span>
                                  {githubDiagFilter === "all" && (
                                    <span className="font-mono text-[9.5px] text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)] shrink-0 truncate max-w-[140px]" title={item.diagTimestamp}>
                                      {item.diagTimestamp}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{f.title}</p>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono text-[9.5px] text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                                    {f.file}:{f.line}
                                  </span>
                                  <span className="text-[9.5px] font-mono text-[var(--text-muted)]">Labels:</span>
                                  {item.githubLabels.map((lbl, idx) => (
                                    <span key={idx} className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)]">
                                      {lbl}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                              {iState.status === "pending" && (
                                <button
                                  type="button"
                                  className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] hover:bg-[var(--surface-hover)] flex items-center gap-1.5"
                                  onClick={(e) => { e.stopPropagation(); handleConvertToIssue(item.id); }}
                                >
                                  <GitHubIcon />
                                  <span>Convertir (IA)</span>
                                </button>
                              )}
                              {iState.status === "converting" && (
                                <span className="text-[11px] font-mono text-[var(--accent)] animate-pulse">⚡ Generando…</span>
                              )}
                              {iState.status === "converted" && (
                                <a
                                  href={iState.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded border border-emerald-500/20 flex items-center gap-1.5 transition-colors"
                                >
                                  <span>Issue #{iState.issueNumber}</span>
                                  <ExternalLinkIcon />
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
