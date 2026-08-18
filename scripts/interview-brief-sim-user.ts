// Simulación de usuario para la Fase 0 (brief) — el bot responde TODAS las
// preguntas del template, con una empresa inventada ("FrescaMente").
//
//   npx tsx scripts/interview-brief-sim-user.ts [projectPath]
//
// Qué hace:
//   1. Arranca el brief (sesión única) y crea el mini-ledger.
//   2. El bot responde cada pregunta del template con el fixture de abajo
//      (respuestas LARGAS y detalladas, a propósito, para ejercitar la
//      regla "NO CONDENSAR" de la síntesis y el campo respuestas_detalladas).
//   3. Sintetiza el brief (1 llamada) y verifica:
//      - fixture completo: todas las preguntas del template tienen respuesta;
//      - fidelidad estructural: respuestas_detalladas == ledger.answers (1-a-1,
//        copiado por código — el modelo no transcribe);
//      - documento completo: campos temáticos no vacíos.
//   4. Imprime el resumen + el contexto que se inyectaría a la entrevista.
//
// El script guarda el ledger en <projectPath>/.agents/interview/ y al final
// imprime los paths — pegar esa salida para verificar. NO se ejecuta desde
// el repo automatizado; lo corre una persona y comparte la salida.

import {
  BRIEF_BLOCKS,
  startBriefInterview,
  recordBriefAnswer,
  synthesizeBrief,
  formatBriefForPrompt,
  cleanupBrief,
} from "../headless-runtime/interview/brief.ts";

const PROJECT_PATH = process.argv[2] ?? process.cwd();

// ─── La empresa inventada ─────────────────────────────────────────────────
// "FrescaMente": plataforma de trazabilidad (cosecha → mayorista) para
// cooperativas hortícolas, con QR por lote y alertas de proximidad a
// vencimiento. La dueña es Lucía, fundadora de la Cooperativa El Vergel.
//
// Clave de las respuestas: `<bloque>#<índice de la pregunta>`, donde el
// índice es la posición de la pregunta DENTRO del bloque en BRIEF_BLOCKS.
const RESPUESTAS: Record<string, string> = {
  "contexto_inicial#0":
    "Una plataforma de trazabilidad para cooperativas hortícolas: cada lote de fruta o verdura se registra con un QR al cosecharse y queda visible para el mayorista y el comprador desde ese momento hasta que se vende. La idea es que el origen, la fecha de cosecha y el estado del lote se puedan demostrar en segundos, sin llamadas telefónicas ni planillas de papel.",
  "contexto_inicial#1":
    "El flujo ideal es simple: la encargada de la cooperativa abre la app en su celular, crea el lote escaneando el QR de una caja nueva, le pone producto, fecha de cosecha y el productor responsable, y lo deja listo. Cuando el camión llega al mayorista, el comprador escanea el QR de una caja y ve al instante todo el historial del lote: de qué chacra salió, cuándo se cosechó, qué controles pasó. Si el lote está por vencer, la app le avisa a la cooperativa con una alerta antes de que el mayorista tenga que rechazarlo.",
  "contexto_inicial#2":
    'Que una cooperativa logre registrar un lote nuevo en menos de 90 segundos desde el celular, y que un mayorista escanee el QR y encuentre toda la información del lote sin tener que llamar a nadie. Eso para mí es la sesión exitosa: datos completos, cero llamadas, cero dudas.',
  "mision#0":
    "Porque vi durante tres años cómo la falta de trazabilidad le hacía perder plata y dignidad a los productores que conozco. Las lechugas de la cooperativa de mi abuelo se descartaban por no poder demostrar de dónde venían, mientras que la misma lechuga con una etiqueta de una empresa grande se vendía al doble. Es un problema de información, no de calidad, y eso se puede resolver con ingeniería.",
  "mision#1":
    "Que una cooperativa chica cobre por lo que realmente produce, sin que un intermediario descarte su mercadería porque no puede demostrar el origen. Si logro que un solo productor deje de tirar su cosecha por esto, valió la pena, aunque nadie más lo note.",
  "mision#2":
    "Ver el orgullo de los productores cuando muestran el QR de su lote en el mayorista. Eso me seguiría motivando aunque los primeros años no sean rentables: saber que la herramienta les devolvió el control sobre su propio trabajo.",
  "problema#0":
    "En la cadena hortícola local el problema no es producir: es DEMOSTRAR. El origen de cada caja se maneja con planillas de papel, anotaciones a mano y WhatsApp, y cuando un mayorista o un control sanitario pide trazabilidad real, nadie la puede mostrar. Eso hace que lotes perfectamente sanos se descarten, que los controles se tomen al azar y que la responsabilidad caiga siempre sobre el productor más chico, que es el que menos puede defenderse.",
  "problema#1":
    "Le duele principalmente a las cooperativas chicas y a los productores familiares, que son los que no tienen infraestructura para certificar nada y a los que más les descuentan o rechazan la mercadería. Me importa porque crecí viendo a mi abuelo y a mis tíos laburando la tierra, y sé el esfuerzo que hay detrás de cada caja; no es justo que el que menos puede absorber la pérdida sea el que más la sufra.",
  "problema#2":
    "Si esto sigue sin resolverse en 10 años, la producción hortícola familiar va a seguir achicándose: más chacras abandonadas, más concentración en unos pocos mayoristas que sí tienen sistemas, y más comida tirada en un país donde el desperdicio post-cosecha ya ronda el 40% en el eslabón que va del campo al mercado. El que pierde es el consumidor y el productor; el que gana es el intermediario.",
  "problema#3":
    "Lo vi de primera mano cuando el camión de la cooperativa llegó al Mercado Central con dos toneladas de tomates y el controlador los rechazó porque la planilla de origen decía 'hortalizas varias'. Mi abuelo me contó que hace veinte años la palabra del productor alcanzaba; hoy, sin datos, no alcanza. Ese día en la playa de descarga entendí que esto no se arregla con más paciencia, se arregla con una herramienta.",
  "origen#0":
    'El disparador fue ese camión de tomates rechazado en el Mercado Central: dos toneladas que se tiraron por un papel mal llenado. A mi abuelo le costó un mes de laburo y a mí me quedó la imagen de la fruta en la playa de descarga. Ahí pensé "esto tiene que existir": un QR que cuente la historia del lote mejor que cualquier planilla.',
  "origen#1":
    "Me frustra profundamente que sigamos usando planillas de papel y grupos de WhatsApp para algo tan crítico como la seguridad alimentaria y el origen de lo que comemos. Me frustra que un controlador tenga que creerle a un productor que es honesto, cuando con un QR podría VERLO. Y me frustra que las soluciones que existen sean ERPs carísimos pensados para frigoríficos multinacionales, no para una cooperativa de veinte familias.",
  "origen#2":
    "Llevo casi dos años pensando en cómo hacer un sistema de trazabilidad que funcione sin infraestructura: productores con celulares básicos, sin internet estable en la chacra, y sin plata para servidores grandes. Probé de forma informal con etiquetas y un Google Sheets compartido, y funcionó a medias: la gente se olvidaba de cargarlo. Por eso pienso que la clave es que el QR y el escaneo hagan el trabajo pesado, no la persona.",
  "vision#0":
    "En 10 años me gustaría que ningún camión con producto de una cooperativa local sea rechazado por falta de trazabilidad, y que el QR de origen sea tan normal en el Mercado Central como el precio. Que un mayorista pueda decidir en segundos con datos, no con corazonadas.",
  "vision#1":
    "El cambio que quiero generar es que el lote deje de ser un concepto de papel y pase a ser un objeto digital: con historia, responsable y estado, consultable por cualquiera que tenga derecho. Eso hoy no existe en el eslabón chico de la cadena, y es el que más lo necesita.",
  "vision#2":
    "Me gustaría contar la historia de cómo empezamos pegando etiquetas a mano en cajas de tomates y terminamos haciendo que la trazabilidad sea un requisito de compra en el Mercado Central. Que las generaciones nuevas de productores no conozcan el día en que un papel mal llenado tiraba dos toneladas de comida a la basura.",
  "valores#0":
    "No vendería jamás los datos de los productores, ni permitiría que la información de un lote se use para perjudicar a una cooperativa frente a otra. Tampoco sacrificaría la veracidad de los datos por hacerle un favor a nadie: si el sistema dice que algo pasó, tiene que ser verdad, aunque incomode.",
  "valores#1":
    "Definitivamente no quiero construir una 'certificadora de humo': una plataforma que venda sellos de trazabilidad sin datos reales detrás, que es el negocio fácil en este rubro. Tampoco quiero una empresa que dependa de cobrarle caro a los productores chicos, que son los que menos tienen.",
  "valores#2":
    "Quiero que un productor se sienta dueño de su información y orgulloso de mostrarla; que un mayorista se sienta seguro comprando; y que un controlador sienta que su trabajo se vuelve más fácil, no más burocrático. En resumen: que nadie sienta que la herramienta le vigila, sino que le respalda.",
  "stakeholders#0":
    "Ya identificados: las cooperativas hortícolas chicas como clientes piloto (la nuestra primero), el Mercado Central como canal de validación, un ingeniero agrónomo amigo que conoce la normativa, y la imprenta que nos provee las etiquetas QR. También veo como proveedor clave a la empresa que nos presta el servidor donde van a vivir los datos.",
  "stakeholders#1":
    "Las decisiones finales de adopción las toma la asamblea de cada cooperativa (son organizaciones horizontales, hay que convencer a la asamblea, no a un jefe). En el Mercado Central, el que decide si nos dejan instalar el lector es el director de operaciones. Los productores, los choferes y los controladores son consultados: si a ellos no les simplifica la vida, el sistema muere aunque la asamblea lo apruebe.",
  "stakeholders#2":
    "Sí: el regulador sanitario municipal que audita los puestos del Mercado Central, que puede exigir ciertos formatos de etiquetado o rechazar el QR si no cumple la normativa vigente de rotulado. Y los clientes ancla corporativos: las cadenas de supermercados que compran al Mercado, que tienen requisitos de trazabilidad propios y podrían condicionar qué datos mínimos hay que mostrar.",
  "stakeholders#3":
    "Sí, lo conversé con tres cooperativas fuera de la nuestra y con un encargado de compras del Mercado Central. La respuesta fue contundente: 'si me evitás un rechazo de camión, te compro'. El encargado de compras me dijo que hoy rechaza lotes con dudas de origen varias veces por mes y que odia hacerlo. Todos pidieron lo mismo: que sea simple, que no requiera escritorio.",
  "alcance#0":
    "Lo mínimo para considerar esto lanzado: que una cooperativa pueda dar de alta un lote con QR desde el celular, que ese QR se pueda imprimir en una etiqueta o caja, que un mayorista lo escanee y vea el historial completo del lote, y que el sistema avise por alerta cuando un lote registrado esté por vencer. Eso, funcionando de punta a punta con UNA cooperativa real en el Mercado Central, es 'lanzado' para mí.",
  "alcance#1":
    "Fuera de la primera versión: marketplace o venta directa al consumidor, pagos, lectura automática por RFID, integración con los ERPs de las cadenas grandes, multi-mercado y la app para el consumidor final. El QR impreso y la app para productores son el alcance; todo lo que brilla queda para después.",
  "alcance#2":
    "Sí: el presupuesto es bootstrapped, plata propia, casi nula (pagué el dominio y el servidor chico con lo que saqué de changas). De tiempo tengo poco porque sigo estudiando ingeniería: calculo 6 meses para el piloto. En tecnología estoy atada al stack que manejo: Node.js, TypeScript y PostgreSQL, y una app web liviana (PWA) porque los productores tienen celulares básicos. Los datos tienen que vivir en Uruguay por la ley de protección de datos personales.",
  "cierre#0":
    "Que ningún productor tenga que tirar su cosecha porque no puede demostrar de dónde viene.",
};

let pasos = 0;
let fallas = 0;

function check(nombre: string, ok: boolean, detalle = ""): void {
  pasos += 1;
  if (!ok) fallas += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

async function main(): Promise<void> {
  console.log("\n=== Brief simulado (Fase 0, con bot — 'FrescaMente') ===");
  console.log(`Proyecto: ${PROJECT_PATH}`);
  console.log("  El bot responde como Lucía, fundadora de la Cooperativa El Vergel.\n");

  const { ledgerPath, ledger } = await startBriefInterview(PROJECT_PATH);
  console.log(`  Ledger del brief: ${ledgerPath}\n`);

  try {
    // ── El bot responde TODAS las preguntas del template ────────────────
    let sinRespuesta = 0;
    for (const bloque of BRIEF_BLOCKS) {
      console.log(`── ${bloque.titulo} ──`);
      for (let j = 0; j < bloque.preguntas.length; j++) {
        const respuesta = RESPUESTAS[`${bloque.id}#${j}`];
        if (!respuesta) {
          sinRespuesta += 1;
          console.log(`  [${bloque.id}#${j}] ⚠ SIN RESPUESTA SIMULADA`);
        }
        recordBriefAnswer(ledgerPath, ledger, {
          bloque: bloque.id,
          pregunta: bloque.preguntas[j],
          respuesta: respuesta ?? "(sin respuesta simulada para esta pregunta)",
        });
        console.log(`  [${bloque.id}#${j}] ${respuesta?.split("\n")[0]?.slice(0, 80) ?? ""}…`);
      }
    }

    // ── Verificación del fixture ─────────────────────────────────────────
    const totalPreguntas = BRIEF_BLOCKS.reduce((n, b) => n + b.preguntas.length, 0);
    check("fixture completo: todas las preguntas del template tienen respuesta", sinRespuesta === 0, `faltantes=${sinRespuesta}`);
    check("ledger con 1 respuesta por pregunta", ledger.answers.length === totalPreguntas, `${ledger.answers.length}/${totalPreguntas}`);

    // ── Síntesis (1 llamada) ─────────────────────────────────────────────
    console.log("\n── SÍNTESIS DEL BRIEF ──");
    const { brief, briefPath } = await synthesizeBrief(ledgerPath);

    check(
      "fidelidad estructural: respuestas_detalladas == answers del ledger (1-a-1 por código)",
      brief.respuestas_detalladas.length === ledger.answers.length &&
        brief.respuestas_detalladas.every((r, i) => r.respuesta === ledger.answers[i].respuesta && r.pregunta === ledger.answers[i].pregunta),
      `${brief.respuestas_detalladas.length}/${ledger.answers.length}`,
    );
    const tematicos = [
      brief.resumen_proyecto,
      brief.mision,
      brief.problema,
      brief.usuarios_objetivo,
      brief.vision,
      brief.valores_no_negociables,
      brief.stakeholders,
      brief.alcance_minimo,
      brief.fuera_de_alcance,
      brief.propuesta_de_valor,
    ];
    check("documento completo: campos temáticos no vacíos", tematicos.every((t) => t && t.trim().length > 0));
    check(
      "fidelidad del fixture: el brief menciona datos del dueño simulado",
      /tomates|lechuga|chacra|cooperativa/i.test(brief.mision + " " + brief.problema + " " + brief.contexto_origen),
      "buscando términos del fixture en mision/problema/origen",
    );

    console.log(`  Resumen: ${brief.resumen_proyecto}`);
    console.log(`  Propuesta de valor: ${brief.propuesta_de_valor}`);
    console.log(`  Incertidumbres: ${brief.incertidumbres_criticas.map((i) => i.tema).join("; ") || "(ninguna)"}`);
    if (brief.alertas_consistencia.length > 0) {
      for (const alerta of brief.alertas_consistencia) {
        console.log(`  ⚠ [${alerta.gravedad.toUpperCase()}] ${alerta.descripcion}`);
      }
    }
    console.log(`  Brief guardado en: ${briefPath}`);

    console.log(`\n--- Contexto inyectado a la entrevista ---\n${formatBriefForPrompt(brief)}`);
    console.log(`\n  LEDGER GUARDADO EN: ${ledgerPath}`);
  } finally {
    await cleanupBrief(ledger);
  }

  console.log(`\nResultado: ${pasos - fallas}/${pasos} checks PASS`);
  process.exit(fallas > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
