// Datos MOCK de las secciones PLANNING (diseño v2 del figma). El
// DIAGNÓSTICO ya corre una sesión REAL y headless de opencode y su
// historial se sincroniza con los JSON reales de .agents/planning/
// (diagnosisStore.loadHistory). Este archivo conserva solo el PLANIFICADOR
// (roadmap), que sigue simulado con terminal falsa (streaming de logs) y
// resultados de ejemplo.

export interface MockRoadmapPlan {
  session_id: string;
  timestamp: string;
  proyecto: string;
  fases: {
    fase: number;
    nombre: string;
    duracion_semanas: number;
    items: string[];
  }[];
  metricas_exito: {
    plazo_total_semanas: number;
    objetivo_rechazos_por_trazabilidad: number;
    cooperativas_piloto: number;
  };
}

export const MOCK_PLAN_RESULT: MockRoadmapPlan = {
  session_id: "plan-1786765532009",
  timestamp: "2026-08-16T14:45:33Z",
  proyecto: "education-games",
  fases: [
    {
      fase: 1,
      nombre: "MVP Core",
      duracion_semanas: 6,
      items: [
        "Alta de juegos de matemática por grado y materia desde el panel",
        "5 juegos jugables en netbooks de 2012 con 2GB de RAM",
        "Panel de progreso por alumno (actividad completada y puntaje)",
      ],
    },
    {
      fase: 2,
      nombre: "Offline & Sync",
      duracion_semanas: 4,
      items: [
        "Service Worker y caché local de la PWA",
        "Cola de escritura offline con IDs de cliente",
        "Motor de sincronización idempotente con la netbook",
      ],
    },
    {
      fase: 3,
      nombre: "Privacidad & Legal",
      duracion_semanas: 3,
      items: [
        "Consentimiento parental y minimización de datos",
        "Cumplimiento Ley 18.331 (datos de menores)",
        "Panel de derechos del titular para las escuelas",
      ],
    },
    {
      fase: 4,
      nombre: "Piloto Escuela",
      duracion_semanas: 11,
      items: [
        "Deploy de la PWA en netbooks del aula",
        "Onboarding de la escuela piloto con la maestra",
        "Validación con la directora y el inspector de ANEP",
      ],
    },
  ],
  metricas_exito: {
    plazo_total_semanas: 24,
    objetivo_rechazos_por_trazabilidad: 0,
    cooperativas_piloto: 1,
  },
};

// Líneas de log simuladas del Diagnóstico (streaming de la terminal falsa).
export const MOCK_DIAG_LOG_LINES = [
  "> opencode run --mode audit --repo FrancoManfredi/education-games",
  "  ✓ Cargando contexto del repositorio…",
  "  ✓ 4 archivos referenciados en hallazgos",
  "  ⚡ Analizando cobertura de tests…",
  "  ⚡ Verificando integridad de sincronización offline…",
  "  ⚠ [CRITICAL] src/lib/sync.ts:24 — Clave de API expuesta…",
  "  ⚠ [HIGH] src/lib/offline-queue.ts:87 — Race condition en la cola…",
  "  ⚠ [HIGH] src/game/runtime.ts:156 — Memoria retenida entre niveles…",
  "  · [medium] src/lib/offline-queue.ts:0 — Flujo offline sin tests…",
  "  ✓ Diagnóstico completado → .agents/planning/plan-nuevo.json",
];

// Líneas de log simuladas del Planificador.
export const MOCK_PLAN_LOG_LINES = [
  "> opencode run --task plan --roadmap rfas",
  "  ✓ Leyendo RFs y ASRs del proyecto…",
  "  ✓ Restricciones de tiempo y presupuesto incorporadas",
  "  ⚡ Estructurando fases del roadmap…",
  "  ⚡ Estimando duraciones por fase…",
  "  ✓ Fase 1 – MVP Core (6 sem)",
  "  ✓ Fase 2 – Offline & Sync (4 sem)",
  "  ✓ Fase 3 – Privacidad & Legal (3 sem)",
  "  ✓ Fase 4 – Piloto Escuela (11 sem)",
  "  ✓ Planificación completada → .agents/planning/plan-1786765532009.json",
];
