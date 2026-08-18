import { useState, useRef, useEffect } from "react";
import type {
  InterviewQuestion,
  InterviewSummaryItem,
  SummariesData,
  SynthesisResult,
  BriefInfo,
  InterviewPhase,
} from "../components/InterviewModal";

export const FAKE_BRIEF_INFO: BriefInfo = {
  path: ".agents/interview/brief-2026-08-10-cosecha-brief.json",
  activePath: ".agents/interview/brief-2026-08-10-cosecha-brief.json",
  brief: {
    resumen_proyecto:
      "Cosecha es una plataforma comunitaria de huertas urbanas compartidas: vecinos registran parcelas disponibles, coordinan cultivos por estación y reparten la cosecha entre quienes participaron del trabajo.",
  },
};

export const FAKE_SUMMARIES: SummariesData = {
  enProgreso: [
    {
      ledgerPath: ".agents/interview/interview-1755202000000.json",
      created_at: "14/8/2026 · 18:47",
      answers_count: 6,
      topics_closed: 3,
      topics_total: 6,
      pending_contradictions: 1,
    },
  ],
  completadas: [
    {
      ledgerPath: ".agents/interview/interview-1755013000000.json",
      created_at: "12/8/2026 · 09:12",
      answers_count: 14,
      topics_closed: 6,
      topics_total: 6,
      pending_contradictions: 0,
    },
  ],
  vacias: [
    {
      ledgerPath: ".agents/interview/interview-1755289000000.json",
      created_at: "15/8/2026 · 10:03",
      answers_count: 0,
      topics_closed: 0,
      topics_total: 6,
      pending_contradictions: 0,
    },
  ],
};

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    topic: "problema",
    kind: "single_select",
    question_text:
      "¿Qué problema principal resuelve **Cosecha** para los vecinos? Ya contaste que en tu barrio hay patios y baldíos *sin uso* — ¿qué es lo que hoy impide que se conviertan en huertas?",
    options: [
      { id: "o1", label: "No hay espacio para cultivar en los departamentos" },
      { id: "o2", label: "Falta coordinación entre los vecinos interesados" },
      { id: "o3", label: "Los insumos de huerta son caros para empezar solo" },
      { id: "o4", label: "La gente no sabe cómo mantener una huerta" },
    ],
    contradiction: null,
  },
  {
    topic: "usuarios",
    kind: "single_select",
    question_text:
      "¿Quién es la persona que **más** va a usar la plataforma? Tratá de describir un perfil concreto: edad, situación de vivienda, relación con la jardinería.",
    options: [
      { id: "o1", label: "Jubilados con patio propio y tiempo disponible" },
      { id: "o2", label: "Familias jóvenes en departamentos con balcón" },
      { id: "o3", label: "Estudiantes que comparten casa con patio" },
    ],
    contradiction: null,
  },
  {
    topic: "__contradiction__",
    kind: "free_only",
    question_text:
      "Detecté una contradicción con tus respuestas anteriores: dijiste que el **alcance mínimo** no necesita coordinación entre barrios, pero tu visión a 10 años habla de una *red nacional de huertas*.\n\n¿Cómo conviven esas dos respuestas?",
    options: [],
    contradiction: {
      explanation:
        "Dijiste que el alcance mínimo no necesita coordinación entre barrios, pero tu visión a 10 años habla de una red nacional de huertas.",
    },
  },
  {
    topic: "flujo_principal",
    kind: "single_select",
    question_text:
      "Pensá en un vecino que acaba de registrarse: ¿cuál es el **primer paso** que da para sumarse a una huerta compartida?",
    options: [
      { id: "o1", label: "Explora el mapa de parcelas disponibles cerca" },
      { id: "o2", label: "Completa su perfil con qué sabe hacer" },
      { id: "o3", label: "Publica su patio como parcela disponible" },
    ],
    contradiction: null,
  },
  {
    topic: "rendimiento",
    kind: "free_only",
    question_text:
      "¿Cuánta gente estimás que va a usar la plataforma en el primer año? ¿Y qué esperás que pase **si se llena** una huerta con 30 vecinos a la vez?",
    options: [],
    contradiction: null,
  },
];

export const FAKE_SYNTHESIS: SynthesisResult = {
  proyecto_metadata: {
    nombre_proyecto: "Cosecha",
    id_sesion: "ses_1755202000000",
    fecha_relevamiento: "2026-08-14",
    brief_contexto: "Huertas urbanas compartidas entre vecinos con reparto de cosecha.",
  },
  requerimientos_funcionales: Array.from({ length: 8 }, (_, i) => ({ id: `RF-00${i + 1}` })),
  atributos_de_calidad_y_asrs: Array.from({ length: 3 }, (_, i) => ({ id: `ASR-00${i + 1}` })),
  restricciones_globales: Array.from({ length: 4 }, (_, i) => ({ id: `CON-00${i + 1}` })),
  glosario_de_terminos: { parcela: true, cosecha: true, ronda: true, compost: true, feria: true, brigada: true },
};

interface HistoryRecord {
  qIndex: number;
  selectedOptionId: string | null;
  freeText: string;
}

interface State {
  isOpen: boolean;
  phase: InterviewPhase;
  busy: boolean;
  summaries: SummariesData;
  showBrief: boolean;
  briefInfo: BriefInfo | null;
  qIndex: number;
  selectedOptionId: string | null;
  freeText: string;
  history: HistoryRecord[];
  canGoBack: boolean;
  answered: number;
  doneReason: string | null;
  ledgerPath: string | null;
  errorMessage: string | null;
  synthesis: SynthesisResult;
  activeInterviewPath: string;
}

export function useInterviewModal() {
  const [state, setState] = useState<State>({
    isOpen: false,
    phase: "pick",
    busy: false,
    summaries: FAKE_SUMMARIES,
    showBrief: true,
    briefInfo: FAKE_BRIEF_INFO,
    qIndex: 0,
    selectedOptionId: null,
    freeText: "",
    history: [],
    canGoBack: false,
    answered: 0,
    doneReason: null,
    ledgerPath: null,
    errorMessage: null,
    synthesis: FAKE_SYNTHESIS,
    activeInterviewPath: FAKE_SUMMARIES.completadas[0]?.ledgerPath || "",
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const openModal = () => setState((p) => ({ ...p, isOpen: true }));
  const closeModal = () => setState((p) => ({ ...p, isOpen: false }));

  const startNew = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState((p) => ({
      ...p,
      phase: "generating_questions",
      busy: false,
      qIndex: 0,
      history: [],
      selectedOptionId: null,
      freeText: "",
      canGoBack: false,
      answered: 0,
    }));

    timerRef.current = setTimeout(() => {
      setState((p) => ({
        ...p,
        phase: "interview",
      }));
    }, 1200);
  };

  const selectOption = (id: string) => {
    setState((p) => ({
      ...p,
      selectedOptionId: p.selectedOptionId === id ? null : id,
      freeText: "",
    }));
  };

  const setText = (val: string) => {
    setState((p) => ({
      ...p,
      freeText: val,
      selectedOptionId: val.trim() ? null : p.selectedOptionId,
    }));
  };

  const submitAnswer = () => {
    setState((p) => {
      if (p.busy || (p.selectedOptionId === null && !p.freeText.trim())) return p;

      const newHistory = [
        ...p.history,
        { qIndex: p.qIndex, selectedOptionId: p.selectedOptionId, freeText: p.freeText },
      ];
      const nextCount = p.answered + 1;
      const nextQIndex = p.qIndex + 1;

      if (nextQIndex >= INTERVIEW_QUESTIONS.length) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setState((prevDone) => ({
            ...prevDone,
            phase: "done",
            doneReason: "all_topics_closed",
            ledgerPath: ".agents/interview/interview-1755202000000.json",
            busy: false,
          }));
        }, 1600);

        return {
          ...p,
          phase: "synthesizing",
          busy: true,
          history: newHistory,
        };
      }

      // Reuse the synthesizing-style loading screen for "Cargando siguiente pregunta..."
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setState((prev) => ({
          ...prev,
          phase: "interview",
          qIndex: nextQIndex,
          selectedOptionId: null,
          freeText: "",
          canGoBack: true,
          busy: false,
          answered: nextCount,
        }));
      }, 1000);

      return {
        ...p,
        phase: "loading_next",
        busy: true,
        history: newHistory,
      };
    });
  };

  const goBack = () => {
    setState((p) => {
      if (!p.history.length) return p;
      const copy = [...p.history];
      const last = copy.pop()!;
      return {
        ...p,
        qIndex: last.qIndex,
        selectedOptionId: last.selectedOptionId,
        freeText: last.freeText,
        history: copy,
        canGoBack: copy.length > 0,
        answered: Math.max(0, p.answered - 1),
      };
    });
  };

  const goToPick = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState((p) => {
      let updatedEnProgreso = [...p.summaries.enProgreso];

      if (p.phase === "interview" && p.answered > 0) {
        const now = new Date();
        const timestamp = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} · ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const newSummary: InterviewSummaryItem = {
          ledgerPath: `.agents/interview/interview-${Date.now()}.json`,
          created_at: timestamp,
          answers_count: p.answered,
          topics_closed: Math.min(6, Math.floor(p.answered / 2)),
          topics_total: 6,
          pending_contradictions: 0,
        };
        updatedEnProgreso = [newSummary, ...updatedEnProgreso];
      }

      return {
        ...p,
        summaries: {
          ...p.summaries,
          enProgreso: updatedEnProgreso,
        },
        phase: "pick",
        busy: false,
        qIndex: 0,
        history: [],
        selectedOptionId: null,
        freeText: "",
        canGoBack: false,
      };
    });
  };

  const resume = (path: string, completed: boolean) => {
    const all = [...state.summaries.enProgreso, ...state.summaries.completadas, ...state.summaries.vacias];
    const found = all.find((s) => s.ledgerPath === path);
    if (!found) return;

    if (completed) {
      setState((p) => ({
        ...p,
        phase: "done",
        doneReason: "all_topics_closed",
        ledgerPath: path,
        isOpen: true,
      }));
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    setState((p) => ({
      ...p,
      phase: "generating_questions",
      busy: false,
      isOpen: true,
    }));

    timerRef.current = setTimeout(() => {
      setState((p) => ({
        ...p,
        phase: "interview",
        qIndex: found.answers_count % INTERVIEW_QUESTIONS.length,
        history: [],
        selectedOptionId: null,
        freeText: "",
        canGoBack: false,
        answered: found.answers_count,
      }));
    }, 1000);
  };

  const activateInterview = (path: string) => {
    setState((p) => ({ ...p, activeInterviewPath: path }));
  };

  const deleteSummary = (path: string) => {
    setState((p) => ({
      ...p,
      summaries: {
        enProgreso: p.summaries.enProgreso.filter((s) => s.ledgerPath !== path),
        completadas: p.summaries.completadas.filter((s) => s.ledgerPath !== path),
        vacias: p.summaries.vacias.filter((s) => s.ledgerPath !== path),
      },
    }));
  };

  const forceState = (newPhase: InterviewPhase) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState((p) => ({
      ...p,
      phase: newPhase,
      busy: false,
      errorMessage: newPhase === "error" ? "Timeout de 60s esperando la respuesta del modelo de inteligencia." : null,
      isOpen: true,
    }));

    if (newPhase === "synthesizing") {
      timerRef.current = setTimeout(() => {
        setState((p) => ({
          ...p,
          phase: "done",
          doneReason: "all_topics_closed",
          ledgerPath: ".agents/interview/interview-1755202000000.json",
        }));
      }, 1600);
    }
  };

  const toggleShowBrief = () => {
    setState((p) => ({ ...p, showBrief: !p.showBrief }));
  };

  return {
    isOpen: state.isOpen,
    openModal,
    closeModal,
    phase: state.phase,
    busy: state.busy,
    summaries: state.summaries,
    showBrief: state.showBrief,
    briefInfo: state.briefInfo,
    qIndex: state.qIndex,
    questions: INTERVIEW_QUESTIONS,
    selectedOptionId: state.selectedOptionId,
    freeText: state.freeText,
    canGoBack: state.canGoBack,
    answered: state.answered,
    doneReason: state.doneReason,
    ledgerPath: state.ledgerPath,
    errorMessage: state.errorMessage,
    synthesis: state.synthesis,
    activeInterviewPath: state.activeInterviewPath,
    activateInterview,
    startNew,
    resume,
    deleteSummary,
    selectOption,
    setText,
    submitAnswer,
    goBack,
    goToPick,
    forceState,
    toggleShowBrief,
  };
}
