// Fase 0 — Entrevista del brief (encuadre del problema).
//
// Precede a la entrevista de requerimientos (Problem Framing: ADD paso 1,
// lanzamiento de proyecto de Volere, Design Thinking — Empatizar/Definir).
//
// REDISEÑO (v2): las preguntas son un TEMPLATE ESTÁTICO orientado al
// negocio (contexto, misión, problema, origen, visión, valores,
// stakeholders, alcance, propuesta de valor) — el dueño del negocio se
// expresa LIBREMENTE en un campo de texto por bloque, sin opciones y sin
// IA en los turnos. La IA interviene UNA sola vez: la síntesis que arma el
// BriefDocument estructurado, con la REGLA OBLIGATORIA de NO OMITIR NADA
// de lo que dijo el dueño (las respuestas crudas quedan siempre en el
// mini-ledger para trazabilidad total).
//
// Costo: 1 llamada (la síntesis). Presupuesto mínimo.

import fs from "node:fs";
import path from "node:path";
import {
  ensureClient,
  promptStructured,
  cleanupInterview,
  ensureInterviewLayout,
  contextDir,
  SYNTHESIS_TIMEOUT_MS,
  phaseModelRef,
  type ModelUsage,
  type InterviewLedger,
} from "./engine.ts";
import {
  BRIEF_DOCUMENT_SCHEMA,
  BriefDocumentSchema,
  type BriefDocument,
} from "./schema.ts";

// ─── Bloques estáticos del encuadre (template, sin IA) ───────────────────

export interface BriefBlock {
  id: string;
  titulo: string;
  // A qué campo(s) del documento alimenta (orientación, no restrictivo).
  campo: string;
  preguntas: string[];
}

export const BRIEF_BLOCKS: BriefBlock[] = [
  {
    id: "contexto_inicial",
    titulo: "0. Contexto inicial",
    campo: "resumen_proyecto, flujo_principal_ideal",
    preguntas: [
      "¿Qué estás construyendo? Contame de qué se trata en pocas palabras.",
      "¿Cómo te imaginás el flujo principal de la aplicación en el mejor escenario? Contame paso a paso qué hace un usuario desde que entra hasta que logra lo que busca.",
      '¿Qué acción concreta define el "éxito" de una sola sesión de uso? (la métrica mínima de que "funcionó")',
    ],
  },
  {
    id: "mision",
    titulo: '1. El "por qué" central',
    campo: "mision / proposito",
    preguntas: [
      "¿Por qué querés dedicarle años de tu vida a esto, más allá de ganar dinero?",
      "¿Qué es lo que, si lo lograras, sentirías que valió la pena aunque nadie más lo notara?",
      "¿Qué te seguiría motivando incluso si los primeros años no fueran rentables?",
    ],
  },
  {
    id: "problema",
    titulo: "2. El problema y para quién",
    campo: "problema, usuarios_objetivo",
    preguntas: [
      "¿Qué problema ves en el mundo que sentís que nadie está resolviendo bien?",
      "¿A quién le duele ese problema hoy, y por qué te importa esa persona en particular?",
      "¿Qué pasa si ese problema sigue sin resolverse los próximos 10 años?",
      "¿Dónde viste ese problema de primera mano, no solo de oídas?",
    ],
  },
  {
    id: "origen",
    titulo: "3. Origen y motivación personal",
    campo: "contexto_origen (background interno)",
    preguntas: [
      '¿Qué experiencia propia te hizo pensar "esto tiene que existir"?',
      "¿Qué te frustra profundamente de cómo se hacen las cosas hoy en esta área?",
      "¿Hay algo que llevás mucho tiempo pensando o intentando resolver, aunque sea de forma informal?",
    ],
  },
  {
    id: "vision",
    titulo: "4. Impacto y visión de futuro",
    campo: "vision",
    preguntas: [
      "Si esto funcionara y tuviera éxito en 10 años, ¿cómo se vería el mundo o la vida de tus clientes?",
      "¿Qué cambio querés generar que hoy no existe?",
      "¿Qué historia te gustaría poder contar dentro de 10 años sobre por qué empezaste esto?",
    ],
  },
  {
    id: "valores",
    titulo: "5. Valores no negociables",
    campo: "valores_no_negociables (principios y límites)",
    preguntas: [
      "¿Qué principios no estarías dispuesto a sacrificar, incluso si fuera más rentable hacerlo?",
      "¿Qué tipo de negocio definitivamente no querés construir?",
      "¿Cómo querés que se sienta alguien después de interactuar con lo que vas a crear?",
    ],
  },
  {
    id: "stakeholders",
    titulo: "6. Interesados (stakeholders)",
    campo: "stakeholders",
    preguntas: [
      "¿Ya identificaste quiénes son los interesados en este proyecto? (socios, inversores, clientes piloto, proveedores clave, equipo)",
      "De esas personas, ¿quién toma las decisiones finales y quién solo opina o es consultado?",
      "¿Hay alguien externo (regulador, cliente ancla, socio estratégico) cuyos requisitos u objeciones puedan condicionar el proyecto?",
      "¿Ya validaste esta idea con alguien fuera de tu círculo cercano? ¿Qué te dijeron?",
    ],
  },
  {
    id: "alcance",
    titulo: "7. Alcance y restricciones",
    campo: "alcance_minimo, fuera_de_alcance, restricciones_y_supuestos",
    preguntas: [
      '¿Qué es lo mínimo que tiene que existir para considerar esto "lanzado"? (evita scope creep desde el día 1)',
      "¿Qué queda explícitamente fuera de esta primera versión?",
      "¿Tenés límites de tiempo, presupuesto o tecnología que el analizador debería conocer desde ya?",
    ],
  },
  {
    id: "cierre",
    titulo: "8. Cierre / síntesis",
    campo: "propuesta_de_valor",
    preguntas: [
      "Si tuvieras que resumir todo esto en una sola frase para explicarle a un extraño por qué existe esto que estás creando, ¿qué dirías?",
    ],
  },
];

// ─── Mini-ledger del brief ───────────────────────────────────────────────

export interface BriefBlockAnswer {
  bloque: string;
  // Texto exacto de la pregunta respondida (1-a-1 por pregunta del bloque).
  pregunta: string;
  // Texto completo (multilínea) del dueño del negocio — se guarda SIEMPRE
  // tal cual, para que nada de lo dicho se pierda (trazabilidad total).
  respuesta: string;
}

export interface BriefLedger {
  session_id: string;
  project_path: string;
  bloques: string[];
  answers: BriefBlockAnswer[];
}

export function briefLedgerPath(projectPath: string, timestamp: number = Date.now()): string {
  return path.join(contextDir(projectPath), `contexto-${timestamp}.json`);
}

export function briefDocumentPath(ledgerPath: string): string {
  return ledgerPath.replace(/\.json$/, "-documento.json");
}

function saveBriefLedger(ledgerPath: string, ledger: BriefLedger): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
}

export function loadBriefLedger(ledgerPath: string): BriefLedger {
  if (!fs.existsSync(ledgerPath)) {
    throw new Error(`Ledger del brief no encontrado: ${ledgerPath}`);
  }
  return JSON.parse(fs.readFileSync(ledgerPath, "utf-8")) as BriefLedger;
}

// Carga un documento de brief YA sintetizado desde disco, para arrancar la
// entrevista de requerimientos sin repetir la Fase 0.
export function loadBriefDocument(briefPath: string): BriefDocument {
  if (!fs.existsSync(briefPath)) {
    throw new Error(`Documento del brief no encontrado: ${briefPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(briefPath, "utf-8")) as unknown;
  const parsed = BriefDocumentSchema.safeParse(raw);
  return parsed.success ? parsed.data : (raw as BriefDocument);
}

// El brief sintetizado más reciente del proyecto, o null si no hay ninguno.
// Busca los documentos de la subcarpeta de contexto y devuelve el de
// timestamp más alto (los nombres incluyen Date.now()).
export function findLatestBriefDocument(
  projectPath: string,
): { brief: BriefDocument; path: string } | null {
  const todos = listBriefDocuments(projectPath);
  return todos.length > 0 ? { brief: todos[todos.length - 1].brief, path: todos[todos.length - 1].path } : null;
}

// TODOS los contextos sintetizados del proyecto, de más antiguo a más
// reciente. Lee la subcarpeta contexto/ (migrando el layout legacy si hace
// falta): contexto-<ts>-documento.json.
export function listBriefDocuments(
  projectPath: string,
): { brief: BriefDocument; path: string; timestamp: number }[] {
  ensureInterviewLayout(projectPath);
  const dir = contextDir(projectPath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => /^contexto-(\d+)-documento\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => {
      const path_ = path.join(dir, m[0]);
      return { brief: loadBriefDocument(path_), path: path_, timestamp: Number(m[1]) };
    });
}

// Entrevistas de contexto EN PROGRESO: mini-ledgers (contexto-<ts>.json)
// que todavía no tienen su documento sintetizado (contexto-<ts>-documento.json).
// La UI las muestra como "a medio hacer" (respuestas respondidas / total).
export function listBriefInterviews(
  projectPath: string,
): { ledgerPath: string; timestamp: number; answers_count: number; total_questions: number }[] {
  ensureInterviewLayout(projectPath);
  const dir = contextDir(projectPath);
  if (!fs.existsSync(dir)) return [];
  const totalPreguntas = BRIEF_BLOCKS.reduce((n, b) => n + b.preguntas.length, 0);
  const sintetizados = new Set(
    fs
      .readdirSync(dir)
      .filter((f) => /^contexto-(\d+)-documento\.json$/.test(f))
      .map((f) => f.replace(/-documento\.json$/, ".json")),
  );
  return fs
    .readdirSync(dir)
    .map((f) => /^contexto-(\d+)\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .filter((m) => !sintetizados.has(m[0]))
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => {
      const ledgerPath = path.join(dir, m[0]);
      let answers_count = 0;
      try {
        answers_count = loadBriefLedger(ledgerPath).answers.length;
      } catch {
        // Ledger corrupto: se muestra con 0 respuestas.
      }
      return { ledgerPath, timestamp: Number(m[1]), answers_count, total_questions: totalPreguntas };
    });
}

// ─── Contexto ACTIVO del proyecto (elección explícita del dueño) ────────
// El motor usa el contexto seleccionado; si no hay selección, cae al más
// reciente. El marcador vive en la subcarpeta de contexto/.

const ACTIVE_BRIEF_FILE = path.join(".agents", "interview", "contexto", "contexto-activo.json");

export function activeBriefPath(projectPath: string): string {
  return path.join(projectPath, ACTIVE_BRIEF_FILE);
}

// Elimina un contexto sintetizado (contexto-<ts>-documento.json) junto con
// su borrador de origen (contexto-<ts>.json) — sin el borrador, la
// entrevista "resucitaría" en la lista de en progreso. Si el contexto
// eliminado era el activo, limpia también el marcador. Valida la ruta
// contra el patrón de la subcarpeta de contexto.
export function deleteBriefDocument(projectPath: string, briefPath: string): void {
  const name = path.basename(briefPath);
  const match = /^contexto-(\d+)-documento\.json$/.exec(name);
  if (!match) {
    throw new Error(`Ruta de contexto inválida: ${briefPath}`);
  }
  const dir = contextDir(projectPath);
  for (const target of [
    path.join(dir, name),
    path.join(dir, `contexto-${match[1]}.json`),
  ]) {
    try {
      fs.unlinkSync(target);
    } catch {
      // El archivo ya no existe (o no se pudo borrar): no es crítico.
    }
  }
  const activo = getActiveBrief(projectPath);
  if (activo && path.normalize(activo.path) === path.normalize(path.join(dir, name))) {
    try {
      fs.unlinkSync(activeBriefPath(projectPath));
    } catch {
      // Marcador huérfano: getActiveBrief ya lo trata como inexistente.
    }
  }
}

// Marca el brief que el dueño eligió como contexto del proyecto.
export function setActiveBrief(projectPath: string, briefPath: string): void {
  const dir = path.join(projectPath, ".agents", "interview");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(activeBriefPath(projectPath), JSON.stringify({ path: briefPath, at: new Date().toISOString() }, null, 2));
}

// El contexto activo si la elección sigue apuntando a un archivo existente.
export function getActiveBrief(
  projectPath: string,
): { brief: BriefDocument; path: string } | null {
  ensureInterviewLayout(projectPath);
  const marker = activeBriefPath(projectPath);
  if (!fs.existsSync(marker)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(marker, "utf-8")) as { path?: string };
    if (typeof parsed.path !== "string" || !fs.existsSync(parsed.path)) return null;
    return { brief: loadBriefDocument(parsed.path), path: parsed.path };
  } catch {
    return null;
  }
}

// cleanupInterview espera un InterviewLedger; en runtime solo usa
// session_id + el server, así que el mini-ledger sirve con el cast.
async function cleanupBrief(ledger: BriefLedger): Promise<void> {
  await cleanupInterview(ledger as unknown as InterviewLedger);
}

// ─── API pública de la Fase 0 ────────────────────────────────────────────

// Arranca la fase de encuadre: UNA sesión (para la síntesis final) +
// mini-ledger con los bloques estáticos.
export async function startBriefInterview(
  projectPath: string,
): Promise<{ ledgerPath: string; ledger: BriefLedger }> {
  ensureInterviewLayout(projectPath);
  const client = await ensureClient();
  const sesion = await client.session.create({
    title: "Fase 0 — Encuadre del proyecto",
    directory: projectPath,
  });
  if (sesion.error || !sesion.data) {
    throw new Error(`No se pudo crear la sesión del brief: ${JSON.stringify(sesion.error)}`);
  }
  const ledger: BriefLedger = {
    session_id: sesion.data.id,
    project_path: projectPath,
    bloques: BRIEF_BLOCKS.map((b) => b.id),
    answers: [],
  };
  const ledgerPath = briefLedgerPath(projectPath);
  saveBriefLedger(ledgerPath, ledger);
  return { ledgerPath, ledger };
}

// Registra la respuesta cruda de UNA pregunta del bloque (texto libre).
// UPSERT: si la pregunta ya tenía respuesta guardada, la REEMPLAZA (soporta
// volver atrás y editar); si no, la agrega al final.
export function recordBriefAnswer(
  ledgerPath: string,
  ledger: BriefLedger,
  input: { bloque: string; pregunta: string; respuesta: string },
): void {
  const existente = ledger.answers.find(
    (a) => a.bloque === input.bloque && a.pregunta === input.pregunta,
  );
  if (existente) {
    existente.respuesta = input.respuesta;
  } else {
    ledger.answers.push({ bloque: input.bloque, pregunta: input.pregunta, respuesta: input.respuesta });
  }
  saveBriefLedger(ledgerPath, ledger);
}

// ─── Posición de la entrevista de contexto (para la UI) ──────────────────

export interface BriefInterviewPosition {
  // Bloque y pregunta pendiente (la primera sin responder, en orden).
  bloque: BriefBlock;
  pregunta: string;
  preguntaIndex: number;
  // Números 1-based para la UI.
  preguntaNumero: number;
  preguntaTotal: number;
  bloqueNumero: number;
  bloqueTotal: number;
  respondidas: number;
  // Respuesta YA guardada de esta pregunta, si existe (tras "volver atrás"
  // o una reapertura en modo edición) — la UI la precarga en el textarea.
  respuesta_actual: string | null;
}

// La siguiente pregunta pendiente del mini-ledger, o null si el dueño ya
// respondió TODAS (listo para sintetizar).
export function briefInterviewState(ledgerPath: string): BriefInterviewPosition | null {
  const ledger = loadBriefLedger(ledgerPath);
  const preguntaTotal = BRIEF_BLOCKS.reduce((n, b) => n + b.preguntas.length, 0);
  let respondidas = 0;
  let global = 0;
  for (const bloque of BRIEF_BLOCKS) {
    for (let j = 0; j < bloque.preguntas.length; j++) {
      global += 1;
      const guardada = ledger.answers.find(
        (a) => a.bloque === bloque.id && a.pregunta === bloque.preguntas[j],
      );
      if (guardada) {
        respondidas += 1;
      } else {
        return {
          bloque,
          pregunta: bloque.preguntas[j],
          preguntaIndex: j,
          preguntaNumero: global,
          preguntaTotal,
          bloqueNumero: BRIEF_BLOCKS.indexOf(bloque) + 1,
          bloqueTotal: BRIEF_BLOCKS.length,
          respondidas,
          respuesta_actual: null,
        };
      }
    }
  }
  return null;
}

// Síntesis del brief: UNA llamada que arma el documento estructurado con
// TODO el texto del dueño del negocio (mandato: NO OMITIR NADA).
export async function synthesizeBrief(
  ledgerPath: string,
): Promise<{ brief: BriefDocument; usage: ModelUsage; briefPath: string }> {
  const ledger = loadBriefLedger(ledgerPath);

  const bloques = BRIEF_BLOCKS.map((b) => {
    const porPregunta = b.preguntas
      .map((p, idx) => {
        const answer = ledger.answers.find((a) => a.bloque === b.id && a.pregunta === p);
        const texto = answer?.respuesta?.trim() ?? "(sin responder)";
        return `Pregunta ${idx + 1}: ${p}\nRespuesta: ${texto}`;
      })
      .join("\n\n");
    return `— Bloque ${b.titulo} (alimenta: ${b.campo}):\n${porPregunta}`;
  }).join("\n\n");

  const prompt = `Sos un Analista de Requerimientos y Arquitecto de Software Senior. El dueño del negocio terminó de responder la entrevista de ENCUADRE (fase previa a la entrevista de requerimientos). Completá el documento del brief con TODOS los campos.

REGLA OBLIGATORIA — NO CONDENSAR: cada campo temático debe incorporar TODO el detalle textual de sus respuestas fuente, manteniendo el lenguaje del dueño del negocio. No resumas, no recortes matices, no reescribas en "lenguaje formal" lo que el dueño dijo con sus palabras. Si una idea no encaja en su campo, va al campo más cercano o a brief_contexto. Si el dueño no respondió una pregunta, dejá el campo con "(sin responder)" y marcá la incertidumbre correspondiente.

NOTA: NO completes el campo respuestas_detalladas (lo llena el sistema automáticamente desde las respuestas originales).

Respuestas del dueño del negocio (por bloque, texto completo):
${bloques}

Reglas de distribución:
- resumen_proyecto y flujo_principal_ideal salen del bloque "Contexto inicial"; mision del bloque "El por qué central"; problema y usuarios_objetivo del bloque "El problema y para quién"; contexto_origen del bloque "Origen y motivación"; vision del bloque "Impacto y visión"; valores_no_negociables del bloque "Valores no negociables"; stakeholders del bloque "Interesados"; alcance_minimo, fuera_de_alcance y restricciones_y_supuestos del bloque "Alcance y restricciones"; propuesta_de_valor del bloque "Cierre".
- incertidumbres_criticas: TODO lo que el dueño no supo responder o quedó vago (incluí los bloques sin responder) — es un riesgo de diseño, no un dato.
- alertas_consistencia: contradicciones lógicas entre respuestas (ej: visión ambiciosa que choca con un alcance mínimo contradictorio), con su gravedad.
- brief_contexto: párrafo que integra el resumen del negocio completo (dominio, misión, problema, visión), listo para inyectar como contexto en la entrevista de requerimientos.
- propuesta_de_valor: la frase exacta del cierre (o la mejor síntesis si no la dio).

Completá TODOS los campos.`;

  const { data, usage } = await promptStructured(
    ledger as unknown as InterviewLedger,
    BRIEF_DOCUMENT_SCHEMA,
    prompt,
    (v): v is BriefDocument => BriefDocumentSchema.safeParse(v).success,
    "Síntesis del brief",
    SYNTHESIS_TIMEOUT_MS,
    // Única llamada del flujo del brief: rige la fase "brief" completa
    // (default de turno hy3 — fiel a la conducta actual, NO el heavy).
    phaseModelRef("brief"),
    "brief",
  );
  const parsed = BriefDocumentSchema.safeParse(data);
  const brief = parsed.success ? parsed.data : (data as BriefDocument);
  // GARANTÍA ESTRUCTURAL de "no omitir nada": la transcripción 1-a-1 se
  // copia del ledger por CÓDIGO (el modelo jamás transcribe — no puede
  // omitir lo que el motor copia literalmente).
  brief.respuestas_detalladas = ledger.answers.map((a) => ({
    bloque: a.bloque,
    pregunta: a.pregunta,
    respuesta: a.respuesta,
  }));
  const briefPath = briefDocumentPath(ledgerPath);
  fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2));
  return { brief, usage, briefPath };
}

// Formatea el brief como texto para inyectar en {projectBrief} de la
// entrevista de requerimientos.
export function formatBriefForPrompt(brief: BriefDocument): string {
  const incertidumbres = brief.incertidumbres_criticas.map((i) => i.tema).join("; ") || "(ninguna)";
  return `${brief.resumen_proyecto}

Misión: ${brief.mision}
Problema: ${brief.problema}
Usuarios objetivo: ${brief.usuarios_objetivo}
Contexto de origen: ${brief.contexto_origen}
Flujo principal ideal: ${brief.flujo_principal_ideal}
Visión: ${brief.vision}
Valores no negociables: ${brief.valores_no_negociables}
Stakeholders: ${brief.stakeholders}
Alcance mínimo (lanzado): ${brief.alcance_minimo}
Fuera de alcance: ${brief.fuera_de_alcance}
Restricciones y supuestos: ${brief.restricciones_y_supuestos}
Propuesta de valor: ${brief.propuesta_de_valor}
Incertidumbres críticas: ${incertidumbres}`;
}

export { cleanupBrief };
