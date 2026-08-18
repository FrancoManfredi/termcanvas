// Testeando SDK — entrevista interactiva de 3 preguntas con @opencode-ai/sdk
// Ejecutar desde esta carpeta:  npx tsx test-sdk.ts [proveedor/modelo]
//
// Modelos gratis disponibles (proveedor "opencode"):
//   opencode/big-pickle
//   opencode/deepseek-v4-flash-free
//   opencode/hy3-free
//   opencode/laguna-s-2.1-free
//   opencode/mimo-v2.5-free
//   opencode/nemotron-3-ultra-free
//   opencode/nemotron-3.5-lightning-free

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk/v2";

const MODELO = process.argv[2] ?? "opencode/deepseek-v4-flash-free";
const [providerID, modelID] = MODELO.split("/");

// Server DEDICADO en un puerto libre (0 = aleatorio): no toca el server de
// opencode que ya esté corriendo en el 4096 (la TUI), que además está ocupado.
async function conectar() {
  const server = await createOpencodeServer({ hostname: "127.0.0.1", port: 0 });
  const client = createOpencodeClient({ baseUrl: server.url });
  return { client, server };
}

const preguntas = [
  "En dos frases: ¿qué es opencode?",
  "En tus palabras: ¿qué es el SDK de opencode y para qué sirve?",
  "¿Qué diferencia hay entre usar el CLI de opencode y usar el SDK desde un programa?",
];

function textoDeLaRespuesta(partes: { type: string; text?: string }[]): string {
  return partes
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function main(): Promise<void> {
  console.log("\n=== Testeando SDK ===");
  console.log(`Modelo: ${MODELO}\n`);

  // Levanta el server dedicado y el cliente contra él.
  const { client, server } = await conectar();
  console.log(`Server: ${server.url}\n`);

  // La sesión es la "conversación": las 3 preguntas y tus respuestas
  // comparten el historial, así el modelo tiene contexto.
  const sesion = await client.session.create({
    title: "Test SDK",
    directory: process.cwd(),
  });
  if (sesion.error || !sesion.data) {
    throw new Error(`No se pudo crear la sesión: ${JSON.stringify(sesion.error)}`);
  }

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    for (let i = 0; i < preguntas.length; i++) {
      console.log(`\n─── Pregunta ${i + 1} ───`);
      console.log(`>> ${preguntas[i]}`);

      // Espera tu respuesta escrita en la terminal.
      // (Si la entrada ya se cerró —v.g. entrada por pipe—, responde vacío.)
      const tuRespuesta = rl.closed ? "" : await rl.question("Tú: ");

      // Envía la pregunta + tu respuesta a la sesión (el modelo ve el historial).
      const respuesta = await client.session.prompt(
        {
          sessionID: sesion.data.id,
          model: { providerID, modelID },
          tools: {}, // sin herramientas: el modelo responde directo, sin ejecutar nada
          parts: [
            {
              type: "text",
              text: `Pregunta: ${preguntas[i]}\nRespuesta del usuario: ${tuRespuesta}`,
            },
          ],
        },
        { signal: AbortSignal.timeout(180_000) },
      );

      if (respuesta.error || !respuesta.data) {
        throw new Error(`Fallo la llamada: ${JSON.stringify(respuesta, null, 2)}`);
      }

      console.log(`\nModelo: ${textoDeLaRespuesta(respuesta.data.parts)}`);
    }
  } finally {
    // Limpieza: borra la sesión y apaga el server que levantó este proceso.
    rl.close();
    await client.session.delete({ sessionID: sesion.data.id });
    server.close();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
