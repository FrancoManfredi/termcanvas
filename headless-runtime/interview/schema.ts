// Schemas Zod del motor de entrevista: los outputs del modelo se validan con
// zod (tipos correctos garantizados por el tipado) y los JSON schemas que se
// mandan en `format: json_schema` se DERIVAN de los zod schemas con
// z.toJSONSchema — una sola fuente de verdad, sin duplicación manual.
//
// Nota: el modelo es ruidoso (hy3: keys rotas, strings "null", objetos de
// nulos). Los ruidos CONOCIDOS y baratos de arreglar se sanean ANTES de
// validar (ver parseQuestionOutput en engine.ts); zod valida el contrato y
// dispara el reintento del motor solo cuando el ruido es irrecuperable.

import { z } from "zod";

// ─── Output de la llamada de pregunta (clasifica + juzga + detecta + genera)
export const QuestionOutputSchema = z.object({
  question_text: z
    .string()
    .min(1)
    .describe("Texto de la pregunta al usuario"),
  kind: z.enum(["single_select", "free_only"]),
  options: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string(),
        description: z.string().optional(),
      }),
    )
    // El server 1.18.18 no aplica estrictamente los "required": el modelo
    // a veces omite options en preguntas free_only. Se rellena con [].
    .default([]),
  previous_answer_sufficient: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "null si es la primera pregunta del tópico o si response_kind es noise/deferred. true/false evaluando la ÚLTIMA respuesta dada sobre este mismo tópico (solo respuestas informative).",
    ),
  response_kind: z
    .enum(["informative", "noise", "deferred"])
    .nullable()
    .optional()
    .describe(
      'Clasificación de la ÚLTIMA respuesta recibida: "informative" si aporta datos reales (aunque sea vaga); "noise" solo si es basura/ruido desconectado de la pregunta; "deferred" si el usuario dice explícitamente que no sabe o no decidió todavía ("no sé", "no lo pensé"). Una respuesta vaga NO es noise: es informative con previous_answer_sufficient=false.',
    ),
  contradiction: z
    .object({
      conflicting_answer_id: z.string().min(1).describe("id (entre corchetes del resumen) de la respuesta anterior en conflicto"),
      reason: z.string().describe("motivo del choque"),
    })
    .nullable()
    .optional()
    .describe("null si la respuesta nueva no choca con ninguna anterior."),
});

export type QuestionOutput = z.infer<typeof QuestionOutputSchema>;

// ─── Output del gap-check final (Fase 6A) ────────────────────────────────
export const GapCheckResultSchema = z.object({
  gaps: z.array(
    z.object({
      topic: z.string().min(1).describe("id del tópico de la entrevista al que corresponde el hueco"),
      reason: z.string().describe("por qué es un hueco real"),
      suggested_action: z.literal("reopen_topic"),
    }),
  ),
});

export type GapCheckResult = z.infer<typeof GapCheckResultSchema>;

// Registro individual de hueco (usado en ledger.gap_check.gaps).
export type GapRecord = GapCheckResult["gaps"][number];

// ─── Output de la doble validación ASR (Fase 6B) ─────────────────────────
// Contrato mínimo: is_genuine_asr + reason. (El formato GitHub Issue se
// descartó por decisión del usuario — se implementará en el futuro.)
export const AsrReviewVerdictSchema = z.object({
  is_genuine_asr: z
    .boolean()
    .describe(
      "true si la respuesta es una restricción GENUINAMENTE arquitectónica (rendimiento, disponibilidad, seguridad, escalabilidad, integración, restricciones legales obligatorias); false si es una preferencia de producto/UX.",
    ),
  reason: z.string().describe("motivo del veredicto, en una frase"),
});

export type AsrReviewVerdict = z.infer<typeof AsrReviewVerdictSchema>;

// ─── Historia de usuario (artefacto de producto de la síntesis) ──────────
// La síntesis genera PRIMERO las historias (intención: quién, qué, por qué,
// con el rol tomado del brief) y los requerimientos funcionales las
// FORMALIZAN. La relación es N:N: una historia puede ser formalizada por
// VARIOS RFs y un RF puede formalizar VARIAS historias (historias_origen es
// un array) — una misma capacidad de software puede satisfacer varias
// intenciones de negocio sin duplicar el RF (atomicidad / DRY).

export const UserStorySchema = z.object({
  id: z.string().min(1).catch("HS-000").describe("Formato HS-000"),
  titulo: z.string().catch("(sin titulo)").describe("Título corto de la historia, apto para un issue"),
  rol: z.string().catch("(sin rol)").describe("Rol del usuario (del brief: usuarios_objetivo o stakeholders)"),
  quiero: z.string().catch("(sin accion)").describe("La acción que el rol quiere poder realizar"),
  para: z.string().catch("(sin motivo)").describe("El beneficio/motivo por el que la quiere"),
  criterios_de_aceptacion: z
    .array(z.string())
    .catch([])
    .describe("Criterios verificables que definen cuándo la historia está completa"),
  prioridad: z.string().catch("(sin prioridad)").describe("Must have | Should have | Nice to have"),
  origen: z.string().catch("(sin origen)").describe("id de la answer del ledger que originó esta historia (ej: a3), o 'manual' si la agregó el dueño"),
});

export type UserStory = z.infer<typeof UserStorySchema>;

// Input de las operaciones de curaduría add/update: campos editables por el
// dueño. id y origen NO son editables (identidad y trazabilidad se preservan).
export const UserStoryInputSchema = z.object({
  titulo: z.string().max(200).optional().describe("Título corto de la historia"),
  rol: z.string().min(1, "El rol es obligatorio").describe("Rol del usuario"),
  quiero: z.string().min(1, "La acción 'quiero' es obligatoria").describe("La acción que el rol quiere poder realizar"),
  para: z.string().min(1, "El beneficio 'para' es obligatorio").describe("El beneficio/motivo por el que la quiere"),
  prioridad: z.string().optional().describe("Must have | Should have | Nice to have"),
  criterios_de_aceptacion: z.array(z.string()).optional().describe("Criterios verificables de aceptación"),
});

export type UserStoryInput = z.infer<typeof UserStoryInputSchema>;

// Tombstone de una historia eliminada: conserva la historia completa + cuándo
// se eliminó + qué RFs la referenciaban (para restaurar los vínculos N:N).
export const DeletedUserStorySchema = UserStorySchema.extend({
  eliminada_at: z.string().catch("(sin fecha)").describe("Cuándo se eliminó (ISO8601)"),
  rf_ids_origen: z
    .array(z.string())
    .default([])
    .describe("ids de los RFs que referenciaban esta historia al momento de eliminarla (para restaurar los vínculos N:N)"),
});

export type DeletedUserStory = z.infer<typeof DeletedUserStorySchema>;

// ─── Ítems de la síntesis (RF / ASR / restricción) como schemas nombrados ─
// Extraídos para poder componer tombstones de curaduría sin duplicar formas.

export const RfSchema = z.object({
  id: z.string().min(1).catch("RF-000").describe("Formato RF-000"),
  descripcion: z.string().min(1).catch("(sin descripcion)").describe("Acción específica que el sistema debe permitir realizar"),
  justificacion: z.string().catch("(sin justificacion)").describe("El 'por qué' de este requerimiento para el negocio"),
  prioridad: z.string().catch("(sin prioridad)").describe("Must have | Should have | Nice to have"),
  criterio_de_ajuste: z.string().catch("(sin criterio)").describe("Cómo se verificará que la función es correcta"),
  origen: z.string().catch("(sin origen)").describe("id de la answer del ledger que originó este requerimiento (ej: a3)"),
  historia_origen: z.string().catch("(sin historia)").describe("[LEGADO] id de la historia que este RF formalizaba en el contrato 1:N — se migra a historias_origen al leer"),
  historias_origen: z
    .array(z.string())
    .default([])
    .describe("ids de las historias de usuario que este requerimiento formaliza (N:N — un RF puede satisfacer varias intenciones)"),
});

export type RfItem = z.infer<typeof RfSchema>;

export const AsrSchema = z.object({
  id: z.string().min(1).catch("ASR-000").describe("Formato ASR-000"),
  atributo: z.string().min(1).catch("(sin atributo)").describe("Rendimiento | Disponibilidad | Seguridad | etc."),
  es_asr_genuino: z.boolean().catch(false).describe("true si fuerza una decisión estructural profunda"),
  justificacion_arquitectonica: z.string().catch("(sin justificacion)").describe("Por qué es significativo para la estructura del sistema"),
  escenario_tecnico_6_partes: z.object({
    fuente: z.string().catch("(sin especificar)").describe("Quién genera el evento (usuario, atacante, monitor)"),
    estimulo: z.string().catch("(sin especificar)").describe("El evento o falla que llega al sistema"),
    artefacto: z.string().catch("(sin especificar)").describe("Componente o parte del sistema afectada"),
    entorno: z.string().catch("(sin especificar)").describe("Condiciones (carga normal, pico, modo recuperación)"),
    respuesta: z.string().catch("(sin especificar)").describe("Actividad que el sistema realiza ante el estímulo"),
    medida_de_respuesta: z.string().catch("(sin especificar)").describe("Métrica cuantificable y testeable (ej. < 100ms)"),
  }),
  trade_offs_identificados: z.string().catch("(sin trade-offs)").describe("Atributos afectados negativamente por este requerimiento"),
  origen: z.string().catch("(sin origen)").describe("id de la answer del ledger que originó este ASR (ej: a6)"),
});

export type AsrItem = z.infer<typeof AsrSchema>;

export const ConstraintSchema = z.object({
  id: z.string().min(1).catch("CON-000").describe("Formato CON-000"),
  tipo: z.string().min(1).catch("No especificado").describe("Legal | Presupuesto | Stack Tecnológico | Tiempo"),
  descripcion: z.string().catch("(sin descripcion)").describe("Limitación impuesta externamente que restringe el diseño"),
  impacto: z.string().catch("(sin especificar)").describe("Qué libertad de diseño elimina esta restricción"),
});

export type ConstraintItem = z.infer<typeof ConstraintSchema>;

// ─── Tombstones de curaduría (RF / ASR / restricción / término) ───────────
// Conservan el ítem completo + cuándo se eliminó para poder recuperarlo.

export const DeletedRfSchema = RfSchema.extend({
  eliminada_at: z.string().catch("(sin fecha)").describe("Cuándo se eliminó (ISO8601)"),
});
export const DeletedAsrSchema = AsrSchema.extend({
  eliminada_at: z.string().catch("(sin fecha)").describe("Cuándo se eliminó (ISO8601)"),
});
export const DeletedConstraintSchema = ConstraintSchema.extend({
  eliminada_at: z.string().catch("(sin fecha)").describe("Cuándo se eliminó (ISO8601)"),
});
// El glosario es un Record (término → definición); el tombstone guarda el par.
export const DeletedTermSchema = z.object({
  termino: z.string().min(1).catch("(sin termino)").describe("El término eliminado"),
  definicion: z.string().catch("(sin definicion)").describe("La definición que tenía"),
  eliminada_at: z.string().catch("(sin fecha)").describe("Cuándo se eliminó (ISO8601)"),
});

export type DeletedRf = z.infer<typeof DeletedRfSchema>;
export type DeletedAsr = z.infer<typeof DeletedAsrSchema>;
export type DeletedConstraint = z.infer<typeof DeletedConstraintSchema>;
export type DeletedTerm = z.infer<typeof DeletedTermSchema>;

// ─── Inputs de curaduría (campos editables por el dueño; id/origen no se tocan) ──

export const RfInputSchema = z.object({
  descripcion: z.string().min(1, "La descripción es obligatoria"),
  justificacion: z.string().optional(),
  prioridad: z.string().optional(),
  criterio_de_ajuste: z.string().optional(),
  historias_origen: z.array(z.string()).optional(),
});

export const AsrInputSchema = z.object({
  atributo: z.string().min(1, "El atributo es obligatorio"),
  es_asr_genuino: z.boolean().optional(),
  justificacion_arquitectonica: z.string().optional(),
  escenario_tecnico_6_partes: z
    .object({
      fuente: z.string().optional(),
      estimulo: z.string().optional(),
      artefacto: z.string().optional(),
      entorno: z.string().optional(),
      respuesta: z.string().optional(),
      medida_de_respuesta: z.string().optional(),
    })
    .optional(),
  trade_offs_identificados: z.string().optional(),
});

export const ConstraintInputSchema = z.object({
  tipo: z.string().min(1, "El tipo es obligatorio"),
  descripcion: z.string().min(1, "La descripción es obligatoria"),
  impacto: z.string().optional(),
});

export const TermInputSchema = z.object({
  termino: z.string().min(1, "El término es obligatorio"),
  definicion: z.string().min(1, "La definición es obligatoria"),
});

export type RfInput = z.infer<typeof RfInputSchema>;
export type AsrInput = z.infer<typeof AsrInputSchema>;
export type ConstraintInput = z.infer<typeof ConstraintInputSchema>;
export type TermInput = z.infer<typeof TermInputSchema>;

// ─── Síntesis final de la entrevista (planilla de salida) ────────────────
// Se llena en UNA llamada al terminar la entrevista (ver synthesizeInterview
// en engine.ts). Los campos "origen" dan trazabilidad a la answer del ledger.
// NOTA de robustez: igual que el brief — el server 1.18.18 no aplica los
// "required" y el modelo omite campos; .catch() con valores por defecto
// garantiza que la validación no falle por un campo faltante.
export const SynthesisSchema = z.object({
  proyecto_metadata: z.object({
    nombre_proyecto: z.string().min(1).catch("(sin nombre)").describe("Nombre del proyecto (del brief)"),
    id_sesion: z.string().min(1).catch("(sin sesión)").describe("session_id de la entrevista"),
    fecha_relevamiento: z.string().min(1).catch("(sin fecha)").describe("Fecha del relevamiento, ISO8601"),
    brief_contexto: z.string().catch("(sin contexto)").describe("Resumen del dominio y metas del negocio analizadas"),
  }),
  requerimientos_funcionales: z.array(RfSchema),
  historias_de_usuario: z.array(UserStorySchema).default([]).describe("Historias de usuario derivadas de la evidencia (roles del brief): son el artefacto de producto primario; los RFs las formalizan"),
  historias_backfilled: z
    .boolean()
    .catch(false)
    .describe("true si las historias fueron derivadas de los RFs en una migración de una síntesis legacy (no generadas en la síntesis original)"),
  historias_eliminadas: z
    .array(DeletedUserStorySchema)
    .default([])
    .describe("Historias eliminadas por el dueño (tombstones): conservan la historia y los RFs que referenciaba para poder recuperarlas"),
  atributos_de_calidad_y_asrs: z.array(AsrSchema),
  restricciones_globales: z.array(ConstraintSchema),
  glosario_de_terminos: z
    .record(z.string(), z.string().describe("Definición acordada con el creador para evitar ambigüedad"))
    .catch({}),
  rfs_eliminados: z
    .array(DeletedRfSchema)
    .default([])
    .describe("Requerimientos funcionales eliminados por el dueño (tombstones recuperables)"),
  asrs_eliminados: z
    .array(DeletedAsrSchema)
    .default([])
    .describe("Atributos de calidad eliminados por el dueño (tombstones recuperables)"),
  restricciones_eliminadas: z
    .array(DeletedConstraintSchema)
    .default([])
    .describe("Restricciones globales eliminadas por el dueño (tombstones recuperables)"),
  terminos_eliminados: z
    .array(DeletedTermSchema)
    .default([])
    .describe("Términos del glosario eliminados por el dueño (tombstones recuperables)"),
});

export type SynthesisResult = z.infer<typeof SynthesisSchema>;

export const SYNTHESIS_SCHEMA = z.toJSONSchema(SynthesisSchema);

// ─── Fase 0 — Entrevista del brief (encuadre del problema) ───────────────

// Documento final del brief: insumo de diseño para la entrevista de
// requerimientos. Se arma en UNA llamada de síntesis a partir de las
// respuestas LIBRES del dueño del negocio (preguntas estáticas por bloque,
// sin IA en los turnos). Incluye: misión, problema, visión, valores,
// stakeholders, alcance, incertidumbres críticas y alertas de consistencia.
//
// NOTA de robustez: igual que el resto — el server 1.18.18 no aplica los
// "required" y el modelo omite campos; .catch() con valores por defecto
// garantiza que la validación no falle por un campo faltante.
export const BriefDocumentSchema = z.object({
  resumen_proyecto: z.string().min(1).catch("(sin responder)").describe("De qué se trata el proyecto, en pocas palabras"),
  flujo_principal_ideal: z
    .string()
    .catch("(sin responder)")
    .describe("Happy path: paso a paso qué hace un usuario desde que entra hasta que logra lo que busca"),
  mision: z.string().catch("(sin responder)").describe("El 'por qué' central: la motivación profunda del creador"),
  problema: z.string().catch("(sin responder)").describe("El problema que nadie está resolviendo bien y qué pasa si sigue sin resolverse"),
  usuarios_objetivo: z.string().catch("(sin responder)").describe("A quién le duele el problema / buyer persona"),
  contexto_origen: z.string().catch("(sin responder)").describe("Origen y motivación personal (background interno)"),
  vision: z.string().catch("(sin responder)").describe("Cómo se vería el mundo o la vida de los clientes si esto funciona en 10 años"),
  valores_no_negociables: z.string().catch("(sin responder)").describe("Principios que no se sacrifican y qué negocio NO se quiere construir"),
  stakeholders: z.string().catch("(sin responder)").describe("Interesados: decisores, consultados, validadores externos"),
  alcance_minimo: z.string().catch("(sin responder)").describe("Lo mínimo que tiene que existir para considerar el proyecto 'lanzado'"),
  fuera_de_alcance: z.string().catch("(sin responder)").describe("Qué queda explícitamente fuera de esta primera versión"),
  restricciones_y_supuestos: z.string().catch("(sin responder)").describe("Límites de tiempo, presupuesto, tecnología y supuestos"),
  propuesta_de_valor: z.string().catch("(sin responder)").describe("Frase única que resume por qué existe lo que se está creando"),
  incertidumbres_criticas: z
    .array(
      z.object({
        tema: z.string().min(1).catch("(sin tema)").describe("Qué no se pudo responder o quedó vago"),
        por_que_importa: z.string().catch("(sin especificar)").describe("Por qué es un riesgo de diseño"),
        impacto_en_diseno: z.string().catch("(sin especificar)").describe("Qué decisión de arquitectura podría afectar"),
      }),
    )
    .default([]),
  alertas_consistencia: z
    .array(
      z.object({
        descripcion: z.string().min(1).catch("(sin descripcion)").describe("La inconsistencia lógica detectada"),
        gravedad: z.enum(["alta", "media", "baja"]).catch("media"),
      }),
    )
    .default([]),
  // TRANSCRIPCIÓN 1-a-1 de las respuestas del dueño. La llena el MOTOR
  // (copiada del ledger, nunca el modelo): garantía estructural de que
  // nada de lo dicho se omite. Los campos temáticos de arriba son la
  // síntesis fiel; este bloque es la fuente textual completa.
  respuestas_detalladas: z
    .array(
      z.object({
        bloque: z.string().catch("(sin bloque)"),
        pregunta: z.string().catch("(sin pregunta)"),
        respuesta: z.string().catch("(sin respuesta)"),
      }),
    )
    .default([]),
  brief_contexto: z
    .string()
    .min(1)
    .catch("(sin contexto)")
    .describe("Párrafo que integra el resumen del negocio completo (dominio, misión, problema, visión), listo para inyectar en la entrevista"),
});

export type BriefDocument = z.infer<typeof BriefDocumentSchema>;

export const BRIEF_DOCUMENT_SCHEMA = z.toJSONSchema(BriefDocumentSchema);

// ─── JSON schemas derivados (para el format: json_schema del prompt) ─────
export const QUESTION_SCHEMA = z.toJSONSchema(QuestionOutputSchema);
export const GAP_CHECK_SCHEMA = z.toJSONSchema(GapCheckResultSchema);
export const ASR_REVIEW_SCHEMA = z.toJSONSchema(AsrReviewVerdictSchema);

// Output de la migración legacy (derivar historias de RFs existentes).
// Cada historia declara el RF del que deriva (rf_origen) para poder enlazar
// RF.historia_origen tras la validación. "epic" = historia transversal que no
// formaliza un RF puntual.
export const BackfillStoriesOutputSchema = z.object({
  historias: z
    .array(
      UserStorySchema.extend({
        rf_origen: z.string().catch("epic").describe("id del RF que formaliza (ej: RF-001) o 'epic' si es transversal"),
      }),
    )
    .default([]),
});

export type BackfillStoriesOutput = z.infer<typeof BackfillStoriesOutputSchema>;

export const BACKFILL_STORIES_SCHEMA = z.toJSONSchema(BackfillStoriesOutputSchema);
