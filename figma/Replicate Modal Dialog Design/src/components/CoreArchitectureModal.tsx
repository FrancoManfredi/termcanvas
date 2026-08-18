import React, { useState, useEffect, useRef } from "react";
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

            {/* Category Group 3: INTEGRACIONES */}
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

            {/* 7. Subcategory: GitHub Issues Sync */}
            {activeSubcategory === "github_issues" && (() => {
              const allConvertibleItems = [
                ...SYNTHESIS_REQUIREMENTS.map((r) => ({
                  id: r.id,
                  type: "rf" as const,
                  isGenuineAsr: false,
                  title: r.descripcion,
                  detail: r.justificacion,
                  categoryLabel: "Requerimiento Funcional",
                  priorityTag: r.prioridad,
                  githubLabels: ["type: functional-requirement", `priority: ${r.prioridad.toLowerCase().replace(/\s+/g, "-")}`],
                })),
                ...SYNTHESIS_QUALITY_ATTRIBUTES.map((q) => ({
                  id: q.id,
                  type: "asr" as const,
                  isGenuineAsr: q.es_asr_genuino,
                  title: `${q.atributo} — ${q.justificacion_arquitectonica.slice(0, 110)}…`,
                  detail: q.justificacion_arquitectonica,
                  categoryLabel: q.es_asr_genuino ? "ASR Genuino" : "Atributo de Calidad (UX)",
                  priorityTag: q.es_asr_genuino ? "Decisión Estructural Deep" : "Preferencia UX",
                  githubLabels: q.es_asr_genuino
                    ? ["type: asr", "asr: genuino", "architecture-decision"]
                    : ["type: quality-attribute", "quality: ux-preference"],
                })),
              ];

              const filteredItems = allConvertibleItems.filter((item) => {
                const matchesSearch =
                  item.id.toLowerCase().includes(search.toLowerCase()) ||
                  item.title.toLowerCase().includes(search.toLowerCase());
                const matchesType =
                  githubFilterType === "all" ||
                  (githubFilterType === "rf" && item.type === "rf") ||
                  (githubFilterType === "asr" && item.type === "asr");
                return matchesSearch && matchesType;
              });

              const allFilteredIds = filteredItems.map((i) => i.id);
              const isAllSelected =
                allFilteredIds.length > 0 &&
                allFilteredIds.every((id) => selectedForIssue.includes(id));

              return (
                <div className="space-y-4">
                  {/* Dashboard Integration Banner */}
                  <div className="p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)] space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <GitHubIcon />
                          <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase font-semibold">
                            CONVERSIÓN AUTOMÁTICA A GITHUB ISSUES CON ETIQUETAS
                          </span>
                        </div>
                        <h3 className="text-xs font-bold text-[var(--text-primary)]">
                          Sincronización Diferenciada por Tipo (RF, ASR Genuino y Atributos de Calidad)
                        </h3>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                          La IA distingue automáticamente entre Requerimientos Funcionales, ASRs Genuinos (decisiones estructurales profundas) y Atributos de Calidad de UX, aplicando sus respectivas etiquetas de GitHub.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="btn btn-ghost text-xs py-1.5 px-3 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                          onClick={() => handleSelectAllForIssue(allFilteredIds)}
                        >
                          {isAllSelected ? "Desmarcar todos" : "Seleccionar todos"}
                        </button>
                        <button
                          type="button"
                          disabled={selectedForIssue.length === 0}
                          className="btn btn-primary text-xs py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                          onClick={handleConvertBatch}
                        >
                          <GitHubIcon />
                          <span>
                            Convertir Seleccionados ({selectedForIssue.length})
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        aria-label="Buscar requerimiento o ASR para convertir"
                        placeholder="Filtrar por ID o texto…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="textarea-minimal text-xs py-1.5 max-w-xs focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                      />
                      <div className="flex bg-[var(--bg)] p-0.5 rounded border border-[var(--border)] text-xs">
                        <button
                          type="button"
                          className={`px-2.5 py-1 rounded text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                            githubFilterType === "all"
                              ? "bg-[var(--surface)] text-[var(--text-primary)] font-semibold shadow-xs"
                              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          }`}
                          onClick={() => setGithubFilterType("all")}
                        >
                          Todos ({allConvertibleItems.length})
                        </button>
                        <button
                          type="button"
                          className={`px-2.5 py-1 rounded text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                            githubFilterType === "rf"
                              ? "bg-[var(--surface)] text-[var(--text-primary)] font-semibold shadow-xs"
                              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          }`}
                          onClick={() => setGithubFilterType("rf")}
                        >
                          RFs ({SYNTHESIS_REQUIREMENTS.length})
                        </button>
                        <button
                          type="button"
                          className={`px-2.5 py-1 rounded text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
                            githubFilterType === "asr"
                              ? "bg-[var(--surface)] text-[var(--text-primary)] font-semibold shadow-xs"
                              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          }`}
                          onClick={() => setGithubFilterType("asr")}
                        >
                          ASRs / Atributos ({SYNTHESIS_QUALITY_ATTRIBUTES.length})
                        </button>
                      </div>
                    </div>

                    <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
                      {filteredItems.length} elementos visibles
                    </span>
                  </div>

                  {/* Items List */}
                  <div className="space-y-2">
                    {filteredItems.map((item) => {
                      const state = issueState[item.id] || { status: "pending" };
                      const isSelected = selectedForIssue.includes(item.id);

                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (state.status !== "converted") {
                              handleToggleSelectForIssue(item.id);
                            }
                          }}
                          className={`p-3 rounded-md border text-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            state.status === "converted"
                              ? "bg-emerald-500/5 border-emerald-500/20"
                              : isSelected
                              ? "bg-[var(--bg)] border-[var(--accent)] ring-1 ring-[var(--accent)] cursor-pointer"
                              : "bg-[var(--bg)] border-[var(--border)] hover:border-[var(--text-muted)] cursor-pointer"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={state.status === "converted"}
                              onChange={() => handleToggleSelectForIssue(item.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
                              aria-label={`Seleccionar ${item.id} para convertir`}
                            />

                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[10.5px] font-semibold text-[var(--text-primary)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                                  {item.id}
                                </span>

                                {/* Distinct classification badges */}
                                {item.type === "rf" ? (
                                  <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border bg-[var(--red-soft)] text-[var(--red)] border-red-500/20">
                                    Requerimiento Funcional
                                  </span>
                                ) : item.isGenuineAsr ? (
                                  <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/15 text-emerald-400 border-emerald-500/20">
                                    ASR Genuino
                                  </span>
                                ) : (
                                  <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/20">
                                    Atributo de Calidad (UX)
                                  </span>
                                )}

                                <span className="text-[9.5px] font-mono text-[var(--text-muted)] font-semibold">
                                  {item.priorityTag}
                                </span>
                              </div>

                              <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug">
                                {item.title}
                              </p>

                              {/* Target GitHub Labels preview */}
                              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                <span className="text-[9.5px] font-mono text-[var(--text-muted)]">Labels de GitHub:</span>
                                {item.githubLabels.map((lbl, idx) => (
                                  <span
                                    key={idx}
                                    className="font-mono text-[9px] px-1.5 py-0.2 rounded border bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)]"
                                  >
                                    label:{lbl}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                            {state.status === "pending" && (
                              <button
                                type="button"
                                className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] hover:bg-[var(--surface-hover)] flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleConvertToIssue(item.id);
                                }}
                              >
                                <GitHubIcon />
                                <span>Convertir (IA)</span>
                              </button>
                            )}

                            {state.status === "converting" && (
                              <span className="text-[11px] font-mono text-[var(--accent)] flex items-center gap-1.5 animate-pulse">
                                <span>⚡ Generando Issue con IA…</span>
                              </span>
                            )}

                            {state.status === "converted" && (
                              <a
                                href={state.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded border border-emerald-500/20 flex items-center gap-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                              >
                                <span>Issue #{state.issueNumber}</span>
                                <ExternalLinkIcon />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
