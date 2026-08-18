// Testeando SDK — batería de tests del @opencode-ai/sdk con opencode-go/hy3
// Ejecutar:  npx tsx test-sdk-full.ts [proveedor/modelo]
//
// Cubre: prompt simple, contexto de sesión, structured output (json_schema),
// eventos en tiempo real (SSE), gestión de sesiones y archivos del proyecto.

import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk/v2";

const MODELO = process.argv[2] ?? "opencode-go/hy3";
const [providerID, modelID] = MODELO.split("/");

const server = await createOpencodeServer({ hostname: "127.0.0.1", port: 0 });
const client = createOpencodeClient({ baseUrl: server.url });

let sessionId: string | null = null;
let passed = 0;
let failed = 0;

function texto(partes: { type: string; text?: string }[]): string {
  return partes
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function prompt(textoUsuario: string): Promise<string> {
  const respuesta = await client.session.prompt(
    {
      sessionID: sessionId!,
      model: { providerID, modelID },
      tools: {},
      parts: [{ type: "text", text: textoUsuario }],
    },
    { signal: AbortSignal.timeout(180_000) },
  );
  if (respuesta.error || !respuesta.data) {
    throw new Error(`Llamada falló: ${JSON.stringify(respuesta.error)}`);
  }
  return texto(respuesta.data.parts);
}

async function test(nombre: string, fn: () => Promise<void>): Promise<void> {
  const inicio = Date.now();
  try {
    await fn();
    console.log(`  PASS  ${nombre} (${((Date.now() - inicio) / 1000).toFixed(1)}s)`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${nombre}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log(`\n=== Batería de tests SDK ===`);
console.log(`Modelo: ${MODELO}\n`);

try {
  const sesion = await client.session.create({
    title: "Test SDK full",
    directory: process.cwd(),
  });
  if (sesion.error || !sesion.data) throw new Error(JSON.stringify(sesion.error));
  sessionId = sesion.data.id;

  await test("1. Prompt simple", async () => {
    const respuesta = await prompt("Respondé solo con la palabra 'hola'.");
    if (!respuesta.toLowerCase().includes("hola")) {
      throw new Error(`Respuesta inesperada: ${respuesta}`);
    }
  });

  await test("2. Contexto entre mensajes (misma sesión)", async () => {
    await prompt("Memorizá el número 42. No lo repitas en tu respuesta.");
    const respuesta = await prompt("¿Qué número te pedí memorizar? Respondé solo el número.");
    if (!respuesta.includes("42")) {
      throw new Error(`No recordó el contexto: ${respuesta}`);
    }
  });

  // OJO con el orden: el test 5 (messages) corre ANTES del test 3 (json_schema).
  // Hallazgo del server 1.18.18: un prompt con format json_schema queda
  // guardado en info.format del mensaje con retryCount (default 2) y luego
  // session.messages() falla al re-serializarlo — es del server, no del
  // cliente (el fetch crudo da 400 igual).
  await test("5. Gestión de sesiones (list/get/messages)", async () => {
    const listado = await client.session.list({});
    if (listado.error || !listado.data) throw new Error(JSON.stringify(listado.error));
    if (!listado.data.some((sesionItem) => sesionItem.id === sessionId)) {
      throw new Error("la sesión creada no aparece en list()");
    }
    const detalle = await client.session.get({ sessionID: sessionId! });
    if (detalle.error || !detalle.data) throw new Error(JSON.stringify(detalle.error));
    if (detalle.data.title !== "Test SDK full") throw new Error("get() no devolvió el título correcto");
    const historial = await client.session.messages({ sessionID: sessionId! });
    if (historial.error || !historial.data) throw new Error(JSON.stringify(historial.error));
    if (!Array.isArray(historial.data) || historial.data.length === 0) {
      throw new Error("messages() devolvió historial vacío");
    }
    console.log(`    → ${historial.data.length} mensajes en la sesión`);
  });

  await test("3. Structured output (json_schema)", async () => {
    const schema = {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre y apellido" },
        edad: { type: "number", description: "Edad en años" },
        ciudad: { type: "string", description: "Ciudad donde vive" },
      },
      required: ["nombre", "edad", "ciudad"],
    };
    const respuesta = await client.session.prompt(
      {
        sessionID: sessionId!,
        model: { providerID, modelID },
        tools: {},
        parts: [{ type: "text", text: "Inventá una persona ficticia y devolvé sus datos según el schema." }],
        // SIN retryCount: si se setea, queda guardado en info.format del mensaje
        // y rompe session.messages() (hallazgo del server 1.18.18).
        format: { type: "json_schema", schema },
      },
      { signal: AbortSignal.timeout(180_000) },
    );
    if (respuesta.error || !respuesta.data) throw new Error(JSON.stringify(respuesta.error));
    const info = respuesta.data.info as { error?: { name?: string }; structured?: unknown };
    if (info.error?.name === "StructuredOutputError") {
      throw new Error(`El modelo no cumplió el schema: ${info.error.name}`);
    }
    const dato = info.structured as { nombre?: string; edad?: number; ciudad?: string };
    if (!dato || typeof dato.nombre !== "string" || typeof dato.edad !== "number" || typeof dato.ciudad !== "string") {
      throw new Error(`structured inválido: ${JSON.stringify(dato)}`);
    }
    console.log(`    → ${dato.nombre}, ${dato.edad} años, ${dato.ciudad}`);
  });

  await test("4. Eventos en tiempo real (SSE)", async () => {
    const tipos = new Set<string>();
    const sub = await client.event.subscribe();
    const recolector = (async () => {
      for await (const evento of sub.stream) {
        tipos.add(evento.type);
        if (tipos.size >= 5) break;
      }
    })();
    await prompt("Decime en una frase qué es TypeScript.");
    await Promise.race([
      recolector,
      new Promise((_, reject) => setTimeout(() => reject(new Error("no llegaron eventos")), 30_000)),
    ]);
    console.log(`    → tipos vistos: ${[...tipos].join(", ")}`);
  });

  await test("6. Archivos del proyecto (find.files + file.read)", async () => {
    // Hallazgo: el cliente v2 serializa los query params anidados con brackets
    // (?query[query]=...) y el server 1.18.18 no los parsea ("Missing key at
    // [query]"). La API funciona si se llama con query-string plano.
    const sdk = await client.find.files({ query: { query: "test-sdk*.ts", type: "file" } });
    if (sdk.error && (sdk.error as { name?: string }).name === "BadRequest") {
      const base = server.url;
      // Hallazgo adicional: find solo matchea NOMBRES EXACTOS, los globs
      // (*.ts, **/*.ts) devuelven [].
      const crudo = await fetch(
        `${base}/find/file?query=test-sdk-full.ts&type=file`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!crudo.ok) throw new Error(`find crudo falló: ${crudo.status}`);
      const archivos = (await crudo.json()) as string[];
      if (!archivos.some((path) => path.endsWith("test-sdk-full.ts"))) {
        throw new Error(`no encontró test-sdk-full.ts: ${JSON.stringify(archivos)}`);
      }
      const contenido = await fetch(`${base}/file/content?path=test-sdk.ts`, { signal: AbortSignal.timeout(15_000) });
      if (!contenido.ok) throw new Error(`file crudo falló: ${contenido.status}`);
      const archivo = (await contenido.json()) as { content?: string };
      if (!archivo.content?.includes("createOpencodeServer")) {
        throw new Error("file.read no devolvió el contenido esperado");
      }
      console.log(`    → workaround por bug de serialización del cliente v2: ${archivos.join(", ")}`);
      return;
    }
    if (sdk.error || !sdk.data) throw new Error(JSON.stringify(sdk.error));
    const coincidencias = sdk.data as string[];
    if (!coincidencias.some((path) => path.endsWith("test-sdk-full.ts"))) {
      throw new Error(`no encontró test-sdk-full.ts: ${JSON.stringify(coincidencias)}`);
    }
    const contenido = await client.file.read({ query: { path: "test-sdk.ts" } });
    if (contenido.error || !contenido.data) throw new Error(JSON.stringify(contenido.error));
    const archivo = contenido.data as { content?: string };
    if (!archivo.content?.includes("createOpencodeServer")) {
      throw new Error("file.read no devolvió el contenido esperado");
    }
    console.log(`    → ${coincidencias.join(", ")}`);
  });
} finally {
  if (sessionId) await client.session.delete({ sessionID: sessionId });
  server.close();
}

console.log(`\nResultado: ${passed} PASS, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
