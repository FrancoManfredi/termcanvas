import { useState, useRef, useEffect } from "react";
import type {
  BriefItem,
  InProgressItem,
  InterviewPosition,
  ModalPhase,
  ModalView,
} from "../components/RepoContextModal";

export const QUESTIONS = [
  { bloque: 1, bloqueTitulo: "Contexto inicial", totalBloques: 9, pregunta: "¿De qué se trata el proyecto, en pocas palabras?", total: 8 },
  { bloque: 1, bloqueTitulo: "Contexto inicial", totalBloques: 9, pregunta: "¿Cuál es el flujo principal ideal de un usuario, paso a paso?", total: 8 },
  { bloque: 2, bloqueTitulo: "El porqué central", totalBloques: 9, pregunta: "¿Cuál es la motivación profunda por la que estás construyendo esto?", total: 8 },
  { bloque: 3, bloqueTitulo: "El problema y para quién", totalBloques: 9, pregunta: "¿Qué problema nadie está resolviendo bien y qué pasa si sigue sin resolverse?", total: 8 },
  { bloque: 3, bloqueTitulo: "El problema y para quién", totalBloques: 9, pregunta: "¿A quién le duele este problema? ¿Quién es el usuario objetivo?", total: 8 },
  { bloque: 8, bloqueTitulo: "Alcance y restricciones", totalBloques: 9, pregunta: "¿Cuál es el alcance mínimo para considerar el proyecto lanzado?", total: 8 },
  { bloque: 8, bloqueTitulo: "Alcance y restricciones", totalBloques: 9, pregunta: "¿Qué queda explícitamente fuera de esta primera versión?", total: 8 },
  { bloque: 9, bloqueTitulo: "Cierre", totalBloques: 9, pregunta: "¿Cuál es tu propuesta de valor en una sola frase?", total: 8 },
];

export const FAKE_BRIEFS: BriefItem[] = [
  {
    path: ".agents/interview/brief-2026-08-10-cosecha-brief.json",
    timestamp: "10/8/2026 · 15:30",
    brief: {
      resumen_proyecto:
        "Cosecha es una plataforma comunitaria de huertas urbanas compartidas: vecinos registran parcelas disponibles, coordinan cultivos por estación y reparten la cosecha entre quienes participaron del trabajo.",
      propuesta_de_valor:
        "Convertir el patio o el baldío de un vecino en comida fresca para el barrio, sin que nadie cargue solo con el trabajo.",
      incertidumbres_criticas: [
        {
          tema: "Modelo de reparto cuando hay más participantes que kilos cosechados",
          por_que_importa: "Es la promesa central del producto",
          impacto_en_diseno: "Reglas de asignación por sorteo/rotación",
        },
        {
          tema: "¿Quién se hace responsable del mantenimiento del agua?",
          por_que_importa: "Riesgo de abandono de parcelas",
          impacto_en_diseno: "Sistema de roles y compromisos",
        },
      ],
      alertas_consistencia: [
        {
          descripcion:
            "La visión a 10 años incluye una red nacional de huertas, pero el alcance mínimo no menciona coordinación entre barrios.",
          gravedad: "media",
        },
      ],
    },
  },
  {
    path: ".agents/interview/brief-2026-07-28-puente-brief.json",
    timestamp: "28/7/2026 · 09:12",
    brief: {
      resumen_proyecto:
        "Puente conecta jubilados con estudiantes secundarios para clases de oficio (carpintería, costura, herrería) a cambio de ayuda con tecnología y trámites digitales.",
      propuesta_de_valor: "Que el saber de un oficio no se jubile junto con quien lo tiene.",
      incertidumbres_criticas: [
        {
          tema: "Verificación de antecedentes de los voluntarios",
          por_que_importa: "Menores en el programa",
          impacto_en_diseno: "Flujo de validación antes del primer encuentro",
        },
      ],
      alertas_consistencia: [],
    },
  },
];

export const FAKE_IN_PROGRESS: InProgressItem[] = [
  {
    ledgerPath: ".agents/interview/ledger-2026-08-14-brief.json",
    timestamp: "14/8/2026 · 18:47",
    answers_count: 4,
    total_questions: 8,
  },
];

export const FAKE_DONE: BriefItem = {
  path: ".agents/interview/brief-2026-08-14-vereda-brief.json",
  timestamp: "14/8/2026 · 18:59",
  brief: {
    resumen_proyecto:
      "Vereda es una app para que los vecinos reporten y sigan baches, luminarias apagadas y obstrucciones de ramas: foto, ubicación y estado en vivo hasta que el municipio lo resuelve.",
    propuesta_de_valor:
      "Que el reclamo no quede en el grupo de WhatsApp: cada reporte tiene dueño, estado y fecha de resolución.",
    incertidumbres_criticas: [
      {
        tema: "¿El municipio se compromete a responder dentro de la app?",
        por_que_importa: "Sin respuesta oficial el estado 'en gestión' se inventa",
        impacto_en_diseno: "Modo solo-reporte vs integración con mesas de entrada",
      },
    ],
    alertas_consistencia: [
      {
        descripcion:
          "El dueño quiere moderación comunitaria pero también 'cero fricción al reportar' — los dos requisitos chocan en el flujo de primera publicación.",
        gravedad: "alta",
      },
      {
        descripcion: "Alcance mínimo incluye geolocalización precisa, pero las restricciones no contemplan costo de mapas.",
        gravedad: "baja",
      },
    ],
  },
};

interface HistoryEntry {
  pos: InterviewPosition;
  answer: string;
}

interface ModalState {
  theme: "dark" | "light";
  isOpen: boolean;
  phase: ModalPhase;
  view: ModalView;
  briefs: BriefItem[];
  activePath: string;
  selectedPath: string;
  inProgress: InProgressItem[];
  position: InterviewPosition | null;
  briefAnswer: string;
  history: HistoryEntry[];
  canGoBack: boolean;
  busy: boolean;
  briefDone: BriefItem | null;
  briefError: string | null;
}

export function useRepoContextModal() {
  const [state, setState] = useState<ModalState>({
    theme: "dark",
    isOpen: true,
    phase: "idle",
    view: "list",
    briefs: FAKE_BRIEFS,
    activePath: FAKE_BRIEFS[0]?.path || "",
    selectedPath: FAKE_BRIEFS[0]?.path || "",
    inProgress: FAKE_IN_PROGRESS,
    position: null,
    briefAnswer: "",
    history: [],
    canGoBack: false,
    busy: false,
    briefDone: null,
    briefError: null,
  });

  const synthTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  const toggleTheme = () => {
    setState((prev) => ({
      ...prev,
      theme: prev.theme === "dark" ? "light" : "dark",
    }));
  };

  const openModal = () => setState((prev) => ({ ...prev, isOpen: true }));
  const closeModal = () => setState((prev) => ({ ...prev, isOpen: false }));

  const setSelectedPath = (path: string) => {
    setState((prev) => ({ ...prev, selectedPath: path }));
  };

  const setBriefAnswer = (val: string) => {
    setState((prev) => ({ ...prev, briefAnswer: val }));
  };

  const switchView = (view: ModalView) => {
    setState((prev) => ({ ...prev, view }));
  };

  const startInterview = (resumeAt?: number) => {
    const idx = resumeAt ?? 0;
    const q = QUESTIONS[idx];
    setState((prev) => ({
      ...prev,
      phase: "interview",
      position: {
        bloqueNumero: q.bloque,
        bloqueTotal: q.totalBloques,
        preguntaNumero: idx + 1,
        preguntaTotal: q.total,
        respondidas: idx,
        bloque: { titulo: q.bloqueTitulo },
        pregunta: q.pregunta,
      },
      briefAnswer: "",
      history: [],
      canGoBack: false,
    }));
  };

  const submitAnswer = () => {
    setState((prev) => {
      if (prev.busy || !prev.briefAnswer.trim() || !prev.position) return prev;

      const newHistory = [...prev.history, { pos: { ...prev.position }, answer: prev.briefAnswer }];
      const nextIdx = prev.position.preguntaNumero;

      if (nextIdx >= QUESTIONS.length) {
        if (synthTimerRef.current) clearTimeout(synthTimerRef.current);
        synthTimerRef.current = setTimeout(() => {
          setState((p) => ({
            ...p,
            phase: "done",
            briefDone: FAKE_DONE,
          }));
        }, 1600);

        return {
          ...prev,
          phase: "synthesizing",
          position: null,
          briefAnswer: "",
          history: newHistory,
        };
      }

      const q = QUESTIONS[nextIdx];
      return {
        ...prev,
        position: {
          bloqueNumero: q.bloque,
          bloqueTotal: q.totalBloques,
          preguntaNumero: nextIdx + 1,
          preguntaTotal: q.total,
          respondidas: nextIdx,
          bloque: { titulo: q.bloqueTitulo },
          pregunta: q.pregunta,
        },
        briefAnswer: "",
        history: newHistory,
        canGoBack: true,
      };
    });
  };

  const goBack = () => {
    setState((prev) => {
      if (prev.history.length === 0) return prev;
      const copy = [...prev.history];
      const last = copy.pop()!;
      return {
        ...prev,
        position: last.pos,
        briefAnswer: last.answer,
        history: copy,
        canGoBack: copy.length > 0,
      };
    });
  };

  // When exiting interview mid-way, create/update an in-progress draft item so it appears under "inProgress"
  const exitInterview = () => {
    setState((prev) => {
      let updatedInProgress = [...prev.inProgress];

      if (prev.phase === "interview" && prev.position) {
        const answersCount = prev.position.respondidas + (prev.briefAnswer.trim() ? 1 : 0);
        if (answersCount > 0) {
          const now = new Date();
          const timestamp = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} · ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
          const newLedger: InProgressItem = {
            ledgerPath: `.agents/interview/ledger-${Date.now()}-brief.json`,
            timestamp,
            answers_count: answersCount,
            total_questions: prev.position.preguntaTotal,
          };
          updatedInProgress = [newLedger, ...prev.inProgress];
        }
      }

      return {
        ...prev,
        inProgress: updatedInProgress,
        phase: "idle",
        position: null,
        briefAnswer: "",
        history: [],
        canGoBack: false,
        briefDone: null,
        briefError: null,
        view: "list",
      };
    });
  };

  const useDoneAsContext = () => {
    setState((prev) => {
      if (!prev.briefDone) return prev;
      return {
        ...prev,
        briefs: [...prev.briefs, prev.briefDone],
        activePath: prev.briefDone.path,
        selectedPath: prev.briefDone.path,
        phase: "idle",
        briefDone: null,
        view: "detail",
      };
    });
  };

  const activateSelected = (targetPath?: string) => {
    setState((prev) => ({
      ...prev,
      activePath: targetPath || prev.selectedPath,
    }));
  };

  const deleteBrief = (path: string) => {
    setState((prev) => {
      if (prev.activePath === path) return prev; // Cannot delete active context
      const updated = prev.briefs.filter((b) => b.path !== path);
      const newSelected = prev.selectedPath === path ? updated[0]?.path || "" : prev.selectedPath;
      const newView = prev.view === "detail" && prev.selectedPath === path ? "list" : prev.view;

      return {
        ...prev,
        briefs: updated,
        selectedPath: newSelected,
        view: newView,
      };
    });
  };

  const deleteLedger = (path: string) => {
    setState((prev) => ({
      ...prev,
      inProgress: prev.inProgress.filter((i) => i.ledgerPath !== path),
    }));
  };

  const resumeLedger = (path: string) => {
    const item = state.inProgress.find((i) => i.ledgerPath === path);
    // Remove ledger from inProgress when resuming
    deleteLedger(path);
    startInterview(item ? item.answers_count : 0);
  };

  const retrySynthesis = () => {
    if (synthTimerRef.current) clearTimeout(synthTimerRef.current);
    setState((prev) => ({
      ...prev,
      phase: "synthesizing",
      briefError: null,
    }));
    synthTimerRef.current = setTimeout(() => {
      setState((prev) => ({
        ...prev,
        phase: "done",
        briefDone: FAKE_DONE,
      }));
    }, 1600);
  };

  const forceState = (newPhase: ModalPhase, newView: ModalView) => {
    if (synthTimerRef.current) clearTimeout(synthTimerRef.current);
    setState((prev) => ({
      ...prev,
      phase: newPhase,
      view: newView,
      position: null,
      briefAnswer: "",
      history: [],
      canGoBack: false,
      briefDone: newPhase === "done" ? FAKE_DONE : null,
      briefError:
        newPhase === "error"
          ? "El motor de entrevista no respondió: timeout de 60s esperando la síntesis del brief."
          : null,
    }));

    if (newPhase === "synthesizing") {
      synthTimerRef.current = setTimeout(() => {
        setState((prev) => ({
          ...prev,
          phase: "done",
          briefDone: FAKE_DONE,
        }));
      }, 1600);
    }
  };

  const restoreDemo = () => {
    if (synthTimerRef.current) clearTimeout(synthTimerRef.current);
    setState({
      theme: "dark",
      isOpen: true,
      phase: "idle",
      view: "list",
      briefs: FAKE_BRIEFS,
      activePath: FAKE_BRIEFS[0].path,
      selectedPath: FAKE_BRIEFS[0].path,
      inProgress: FAKE_IN_PROGRESS,
      position: null,
      briefAnswer: "",
      history: [],
      canGoBack: false,
      busy: false,
      briefDone: null,
      briefError: null,
    });
  };

  const clearAllBriefs = () => {
    if (synthTimerRef.current) clearTimeout(synthTimerRef.current);
    setState((prev) => ({
      ...prev,
      phase: "idle",
      view: "list",
      briefs: [],
      inProgress: [],
      briefDone: null,
      briefError: null,
      position: null,
    }));
  };

  return {
    theme: state.theme,
    toggleTheme,
    isOpen: state.isOpen,
    openModal,
    closeModal,
    phase: state.phase,
    view: state.view,
    briefs: state.briefs,
    activePath: state.activePath,
    selectedPath: state.selectedPath,
    inProgress: state.inProgress,
    position: state.position,
    briefAnswer: state.briefAnswer,
    canGoBack: state.canGoBack,
    busy: state.busy,
    briefDone: state.briefDone,
    briefError: state.briefError,
    setSelectedPath,
    activateSelected,
    deleteBrief,
    startInterview,
    submitAnswer,
    setBriefAnswer,
    goBack,
    exitInterview,
    useDoneAsContext,
    deleteLedger,
    resumeLedger,
    retrySynthesis,
    switchView,
    forceState,
    restoreDemo,
    clearAllBriefs,
  };
}
