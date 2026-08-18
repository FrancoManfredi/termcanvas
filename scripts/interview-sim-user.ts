// Simulación de usuario automatizado para la entrevista de requerimientos.
//
//   npx tsx scripts/interview-sim-user.ts [projectPath]
//
// Qué hace:
//   1. Tabla de casos del parseo de respuestas (parseUserResponse, sin
//      modelo, sin costo): "1" → opción 1, "[id]" → opción, "1 hora" →
//      texto libre, etc.
//   2. Arranca una entrevista nueva (session única, opencode-go/deepseek-v4-flash).
//   3. El "usuario simulado" responde: cuando la pregunta ofrece opciones
//      sugeridas (single_select) elige la opción 1 (probando el parseo
//      numérico "1"); cuando es free_only escribe su texto simulado.
//   4. A MITAD DE CAMINO simula el CIERRE de la app (guarda el ledger y
//      cierra el server, sin borrar la sesión).
//   5. REABRE la entrevista desde el ledger guardado (resumeInterview) y
//      verifica que retoma en el tópico correcto, con la MISMA sesión y el
//      historial intacto.
//   6. Termina y verifica que las opciones elegidas quedaron registradas
//      con su id + label legible en el ledger.
//
// El script guarda el ledger en <projectPath>/.agents/interview/ y al final
// imprime el path — pegar esa salida para verificar.
//
// Nota: este script NO se ejecuta desde el repo automatizado; lo corre una
// persona y comparte la salida.

import {
  BRIEF_BLOCKS,
  startBriefInterview,
  recordBriefAnswer,
  synthesizeBrief,
  formatBriefForPrompt,
  cleanupBrief,
} from "../headless-runtime/interview/brief.ts";
import {
  startInterview,
  askQuestion,
  submitAnswer,
  resumeInterview,
  synthesizeInterview,
  loadLedger,
  cleanupInterview,
  closeInterviewServer,
  pickNextTopic,
  topicState,
  parseUserResponse,
  CONTRADICTION_TOPIC_ID,
  type InterviewLedger,
  type InterviewQuestion,
  type TurnResult,
  type UserAnswerInput,
} from "../headless-runtime/interview/index.ts";

const PROJECT_PATH = process.argv[2] ?? process.cwd();

// Respuestas del bot por bloque del brief (texto libre completo).
const BRIEF_RESPUESTAS: Record<string, string> = {
  contexto_inicial:
    "Una plataforma digital de movilidad compartida y logística verde para optimizar los traslados diarios de empleados en grandes ciudades.\nEl flujo ideal: el empleado abre la app, ve los viajes disponibles hacia su trabajo, reserva un asiento en un vehículo compartido verde, el sistema confirma la ruta y el pago se debita de la suscripción corporativa.\nLa acción de éxito de una sesión: que el empleado complete una reserva de viaje en menos de 2 minutos sin ayuda.",
  mision:
    "Quiero que las ciudades dejen de estar llenas de autos particulares yendo a trabajar. Vale la pena si logro que una empresa grande cambie sus traslados a movilidad compartida y baje sus emisiones.\nMe motiva saber que cada viaje compartido es un auto menos en la calle, aunque los primeros años sean difíciles.",
  problema:
    "El problema es que millones de empleados van solos al trabajo en auto, generando congestión y emisiones. Los servicios actuales de movilidad son para uso individual y no están pensados para las empresas.\nLe duele a las áreas de RRHH y sustentabilidad de empresas grandes, y a los empleados que pierden horas en tránsito.\nSi sigue sin resolverse, la congestión y las emisiones van a seguir creciendo.\nLo vi de primera mano trabajando en el área de sustentabilidad de una empresa de 5000 empleados.",
  origen:
    "Trabajé 5 años en RRHH de una empresa grande y vi cómo los empleados iban solos al trabajo en auto. Intenté armar un programa de carpooling manual con planillas y fracasó por lo engorroso.\nMe frustra que las empresas tengan presupuesto para estacionamiento pero no para movilidad compartida.",
  vision:
    "En 10 años quiero que las ciudades tengan menos autos en hora pico y que las empresas ofrezcan movilidad compartida como beneficio estándar.\nEl cambio que quiero generar: que viajar al trabajo en vehículo compartido sea lo normal, no la excepción.",
  valores:
    "No sacrifico la transparencia con los empleados ni el compromiso ambiental real: no quiero greenwashing.\nNo quiero construir un negocio que dependa de explotar a los conductores.\nQuiero que un empleado se sienta orgulloso de usar el servicio.",
  stakeholders:
    "Interesados: la empresa ancla (RRHH y sustentabilidad) como cliente piloto; un inversor seed; el equipo de desarrollo.\nLas decisiones finales las toma la dueña del producto (María); RRHH del cliente opina y condiciona el diseño del beneficio.\nEl regulador municipal de transporte puede condicionar la operación de vehículos.\nValidé la idea con el área de RRHH de una empresa grande y mostraron interés en ser piloto.",
  alcance:
    "Mínimo para lanzar: registro de empleados de la empresa ancla, alta de viajes compartidos, reserva de asiento, y el cobro de la suscripción.\nFuera de alcance en la primera versión: pagos por viaje individual, app nativa, multi-idioma, integración con flotas de terceros.\nRestricciones: presupuesto de USD 5000 para el MVP, lanzamiento antes de fin de trimestre, datos de empleados deben residir en servidores locales por normativa.",
  cierre:
    "La forma más simple de movilidad compartida para empleados: menos autos, menos emisiones y menos horas perdidas, todo en una sola app.",
};

// ─── El usuario simulado: textos para preguntas free_only (específicos,
// sin cabos sueltos, para no disparar reaperturas del gap-check). ────────
const RESPUESTAS: Record<string, string> = {
  problema: "que no hay forma de coordinar tareas entre varias personas sin reunirse",
  usuarios:
    "roles: el coordinador crea, asigna, revisa, edita y cierra tareas y da de alta miembros; los miembros crean, ejecutan y actualizan sus propias tareas",
  flujo_principal:
    "crear la tarea, asignarle dueño, el coordinador la revisa; si no aprueba vuelve al dueño con comentario; si aprueba se marca como hecha y todos ven el estado",
  criterio_exito: "que dos personas vean la misma lista actualizada en menos de un segundo",
  rendimiento: "que hasta 10 usuarios simultáneos mantengan la velocidad acordada sin degradarse",
};

// ─── Fase 0: el bot completa el brief (bloques estáticos, texto libre) ───
async function correrBriefConBot(): Promise<string> {
  console.log("\n--- Fase 0: encuadre del problema (brief, con bot) ---");
  const { ledgerPath, ledger } = await startBriefInterview(PROJECT_PATH);
  console.log(`  Ledger del brief: ${ledgerPath}`);
  try {
    for (const bloque of BRIEF_BLOCKS) {
      // El bot responde a cada pregunta del bloque con el texto del bloque
      // (repetido — es un fixture de prueba; la síntesis igual recibe todo).
      for (const pregunta of bloque.preguntas) {
        const respuesta = BRIEF_RESPUESTAS[bloque.id] ?? "(sin respuesta simulada para este bloque)";
        recordBriefAnswer(ledgerPath, ledger, { bloque: bloque.id, pregunta, respuesta });
      }
      const primera = BRIEF_RESPUESTAS[bloque.id]?.split("\n")[0] ?? "";
      console.log(`  [${bloque.id}] ${primera.slice(0, 90)}… (${bloque.preguntas.length} preguntas respondidas)`);
    }
    const { brief, briefPath } = await synthesizeBrief(ledgerPath);
    console.log(`  BRIEF: ${brief.resumen_proyecto.slice(0, 100)}…`);
    console.log(`  Propuesta de valor: ${brief.propuesta_de_valor}`);
    console.log(`  Incertidumbres: ${brief.incertidumbres_criticas.map((i) => i.tema).join("; ") || "(ninguna)"}`);
    if (brief.alertas_consistencia.length > 0) {
      for (const alerta of brief.alertas_consistencia) {
        console.log(`  ⚠ [${alerta.gravedad.toUpperCase()}] ${alerta.descripcion}`);
      }
    }
    console.log(`  Brief guardado en: ${briefPath}`);
    return formatBriefForPrompt(brief);
  } finally {
    await cleanupBrief(ledger);
  }
}

let pasos = 0;
let fallas = 0;

function check(nombre: string, ok: boolean, detalle = ""): void {
  pasos += 1;
  if (!ok) fallas += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

// ─── Tabla de casos del parseo (sin modelo, sin costo) ───────────────────
function tablaDeParseo(): void {
  console.log("\n--- Tabla de casos: parseUserResponse ---");
  const q: InterviewQuestion = {
    question_text: "¿Qué nivel de disponibilidad necesitás?",
    kind: "single_select",
    options: [
      { id: "basica", label: "Disponibilidad básica: tolera caídas de horas" },
      { id: "critica", label: "Disponibilidad crítica: menos de 5 min de caída por mes" },
      { id: "alta", label: "Disponibilidad alta: menos de 1 hora por mes" },
    ],
  };
  check("'1' → opción 1 (id=basica)", parseUserResponse(q, "1")?.selected_option_id === "basica");
  check("'3' → opción 3 (id=alta)", parseUserResponse(q, "3")?.selected_option_id === "alta");
  check("'2' → label legible de la opción", parseUserResponse(q, "2")?.selected_option_label === "Disponibilidad crítica: menos de 5 min de caída por mes");
  check("'[critica]' → opción critica", parseUserResponse(q, "[critica]")?.selected_option_id === "critica");
  check("'BASICA' → opción basica (case-insensitive)", parseUserResponse(q, "BASICA")?.selected_option_id === "basica");
  check("'1 hora' → texto libre (no es un número puro)", parseUserResponse(q, "1 hora")?.free_text === "1 hora");
  check("'0' (fuera de rango) → texto libre", parseUserResponse(q, "0")?.free_text === "0");
  check("'9' (fuera de rango) → texto libre", parseUserResponse(q, "9")?.free_text === "9");
  check("'' → null (respuesta inválida)", parseUserResponse(q, "") === null);
  const fq: InterviewQuestion = { question_text: "¿Describí el problema?", kind: "free_only", options: [] };
  check("free_only: '1' → texto libre (no hay opciones)", parseUserResponse(fq, "1")?.free_text === "1");
}

// ─── Respuesta del bot: opciones sugeridas → elige la 1; free_only → texto
// simulado; resolución de contradicción → elige "anterior" (opción 2). ────
function respuestaDelBot(turno: TurnResult, ledger: InterviewLedger): UserAnswerInput {
  if (turno.done) {
    throw new Error("respuestaDelBot llamado sin pregunta pendiente");
  }
  if (turno.kind === "resolution") {
    // La resolución siempre ofrece [nueva, anterior, ambas] → "2" = anterior.
    const parsed = parseUserResponse(turno.question, "2");
    return {
      topic: CONTRADICTION_TOPIC_ID,
      question_text: turno.question.question_text,
      selected_option_id: parsed?.selected_option_id ?? null,
      selected_option_label: parsed?.selected_option_label ?? null,
      free_text: parsed?.free_text ?? null,
    };
  }
  const question = turno.question;
  if (question.kind === "single_select" && (question.options?.length ?? 0) > 0) {
    const parsed = parseUserResponse(question, "1");
    return {
      topic: turno.topic,
      question_text: question.question_text,
      selected_option_id: parsed?.selected_option_id ?? null,
      selected_option_label: parsed?.selected_option_label ?? null,
      free_text: parsed?.free_text ?? null,
    };
  }
  const texto = RESPUESTAS[turno.topic] ?? "(sin respuesta simulada para este tópico)";
  return {
    topic: turno.topic,
    question_text: question.question_text,
    selected_option_id: null,
    selected_option_label: null,
    free_text: texto,
  };
}

function mostrarRespuestaDelBot(input: UserAnswerInput): void {
  if (input.selected_option_id) {
    console.log(`  A (simulada): elige la opción — ${input.selected_option_label}`);
  } else {
    console.log(`  A (simulada): ${input.free_text}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n=== Usuario simulado (Fase 0 brief + opciones + cierre/reapertura) ===");
  console.log(`Proyecto: ${PROJECT_PATH}`);
  tablaDeParseo();
  console.log("\n");

  // ── Fase 0: brief (el bot lo completa) ────────────────────────────────
  const PROJECT_BRIEF = await correrBriefConBot();
  console.log(`\n--- Contexto inyectado a la entrevista ---\n${PROJECT_BRIEF}\n`);

  // ── Fase 1: entrevista nueva hasta la 2da respuesta ────────────────────
  const { ledgerPath, ledger } = await startInterview(PROJECT_PATH);
  const sessionIdInicial = ledger.session_id;
  console.log(`Ledger: ${ledgerPath}`);
  console.log(`session_id inicial: ${sessionIdInicial}\n`);

  let turno: TurnResult;
  {
    const primerTopic = ledger.topics[0];
    const primera = await askQuestion(ledger, primerTopic, PROJECT_BRIEF);
    turno = {
      done: false,
      kind: "question",
      question: primera.question,
      topic: primerTopic,
      sufficient: null,
      contradiction: null,
      usage: primera.usage,
    };
  }
  let respuestasDadas = 0;

  try {
    while (!turno.done && respuestasDadas < 2) {
      console.log(`  Q: ${turno.question.question_text}`);
      const input = respuestaDelBot(turno, ledger);
      mostrarRespuestaDelBot(input);
      turno = await submitAnswer(ledgerPath, ledger, input, PROJECT_BRIEF);
      respuestasDadas += 1;
      if (turno.done) break;
    }

    // ── Fase 2: CIERRE SIMULADO ─────────────────────────────────────────
    console.log("\n── CIERRE SIMULADO: el usuario cierra la app ──");
    console.log(`  Answers guardadas hasta acá: ${ledger.answers.length}`);
    closeInterviewServer();
    console.log("  Server cerrado. Ledger persistido en disco.\n");

    // ── Fase 3: REAPERTURA desde el ledger ──────────────────────────────
    console.log("── REAPERTURA: el usuario vuelve a abrir la app ──");
    const cargado = loadLedger(ledgerPath);
    check(
      "la sesión es la MISMA (no se creó una nueva al reabrir)",
      cargado.session_id === sessionIdInicial,
      cargado.session_id,
    );
    const esperado = pickNextTopic(cargado);
    check("el ledger tiene el historial (2 answers)", cargado.answers.length === 2, `real=${cargado.answers.length}`);

    turno = await resumeInterview(ledgerPath, PROJECT_BRIEF);
    if (turno.done) {
      check("al reabrir quedaba algo pendiente", false, "done inesperado");
    } else {
      check(
        "la pregunta al reabrir es del tópico que el scheduler decide (no repite lo ya respondido salvo drill-down)",
        turno.topic === esperado,
        `scheduler: ${esperado}, motor: ${turno.topic}`,
      );
      console.log(`  Q (post-reapertura): ${turno.question.question_text}`);
    }

    // ── Fase 4: terminar la entrevista con el usuario simulado ──────────
    let salvaguarda = 0;
    while (!turno.done && salvaguarda < 20) {
      salvaguarda += 1;
      console.log(`  Q: ${turno.question.question_text}`);
      const input = respuestaDelBot(turno, ledger);
      mostrarRespuestaDelBot(input);
      turno = await submitAnswer(ledgerPath, ledger, input, PROJECT_BRIEF);
    }

    // ── Verificación final ──────────────────────────────────────────────
    const persistido = loadLedger(ledgerPath);
    console.log("\n=== Verificación final ===");
    check("la entrevista terminó", turno.done, turno.done ? `reason: ${turno.reason}` : "loop");
    check(
      "misma session_id de punta a punta (tras la reapertura)",
      persistido.session_id === sessionIdInicial,
      persistido.session_id,
    );
    const secuencia = persistido.answers.map((a) => a.topic);
    console.log(`  Secuencia de tópicos: ${secuencia.join(" → ")}`);
    const todosCerrados = persistido.topics.every(
      (t) => topicState(persistido, t) === "covered" || topicState(persistido, t) === "exhausted",
    );
    check("todos los tópicos quedaron cerrados (covered o exhausted)", todosCerrados);
    check(
      "el historial no se duplicó (cada respuesta guardada una sola vez)",
      persistido.answers.length === new Set(persistido.answers.map((a) => `${a.topic}|${a.question_text}`)).size,
    );
    const opcionesElegidas = persistido.answers.filter((a) => a.selected_option_id !== null);
    check(
      "las opciones elegidas quedaron con id + label legible (no texto basura)",
      opcionesElegidas.length >= 1 &&
        opcionesElegidas.every((a) => a.selected_option_label && a.selected_option_label.length > 0),
      `opciones elegidas: ${opcionesElegidas.length}, labels: ${opcionesElegidas.map((a) => a.selected_option_label).join(" | ")}`,
    );
    console.log(`  Gap-check: ${persistido.gap_check ? `${persistido.gap_check.gaps.length} huecos` : "no corrió"}`);
    console.log(`  Contradicciones: ${persistido.contradictions.length}`);
    console.log(`  Reaperturas: ${persistido.reopens.length}`);
    console.log(`  ASR reviews: ${persistido.asr_reviews.length}`);

    // ── Síntesis final (planilla de salida) ─────────────────────────────
    console.log("\n── SÍNTESIS FINAL (planilla de salida) ──");
    const { synthesis, synthesisPath } = await synthesizeInterview(ledgerPath, PROJECT_BRIEF);
    console.log(`  RFs: ${synthesis.requerimientos_funcionales.length}`);
    console.log(`  ASRs/atributos: ${synthesis.atributos_de_calidad_y_asrs.length}`);
    console.log(`  Restricciones: ${synthesis.restricciones_globales.length}`);
    console.log(`  Glosario: ${Object.keys(synthesis.glosario_de_terminos).length} términos`);
    check(
      "la síntesis quedó completa (metadata + al menos 1 RF y 1 ASR)",
      synthesis.proyecto_metadata.nombre_proyecto.length > 0 &&
        synthesis.proyecto_metadata.id_sesion === persistido.session_id &&
        synthesis.requerimientos_funcionales.length >= 1 &&
        synthesis.atributos_de_calidad_y_asrs.length >= 1,
      JSON.stringify({ rf: synthesis.requerimientos_funcionales.length, asr: synthesis.atributos_de_calidad_y_asrs.length }),
    );
    console.log(`  SÍNTESIS GUARDADA EN: ${synthesisPath}`);
    console.log(`\n  LEDGER GUARDADO EN: ${ledgerPath}`);
  } finally {
    await cleanupInterview(ledger);
  }

  console.log(`\nResultado: ${pasos - fallas}/${pasos} checks PASS`);
  process.exit(fallas > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
