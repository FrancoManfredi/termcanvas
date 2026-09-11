// Selector de puertos para servers efímeros de opencode (motor y catálogo).
//
// BUG RAÍZ: el SDK sorteaba en [20000, 65000), pero Windows asigna conexiones
// salientes en su RANGO DINÁMICO (default: 49152-65535). Cuando el sorteo
// pisa un puerto efímero en uso por una conexión activa del SO, el bind de
// `opencode serve` falla con un críptico "Server exited with code 1 —
// Unexpected error / ServeError" (bun no reporta EADDRINUSE legible).
// Reproducido 1/8 veces en máquina real.
//
// Doble defensa:
//   1. Sorteo CAPPEADO por debajo del inicio del rango dinámico detectable.
//   2. PRE-BIND: se valida con node:net que el candidato acepte listen ANTES
//      de entregárselo al SDK — descarta también ocupantes cualesquiera
//      (otros servers de la propia app, servicios del sistema, etc.).
//
// Ola 3 Real (Gao): puerto efímero con hint 20274.
// 20274 está dentro de [20000,45000] y se intenta primero como hint
// documentado. Si ocupado, se sortea otro. Nunca hardcode fijo,
// valida con probarBind y evita 49000+ dinámico de Windows.

import net from "node:net";
import { EventEmitter } from "node:events";

/** Inicio del rango dinámico típico de Windows (49152). Dejar margen. */
export const LIMITE_RANGO_DINAMICO = 49000;

/** Puerto efímero documentado para Opencode (Gao §1.2). Dentro de [20000,45000]. */
export const OPENCODE_EPHEMERAL_HINT = 20274;

export function probarBind(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    // Cast a EventEmitter: el tipado de net.Server de este repo no expone
    // once/removeListener directamente y acá solo hacen falta los eventos.
    const events = server as unknown as EventEmitter;
    const onError = (err: Error) => {
      server.close();
      reject(err);
    };
    events.once("error", onError);
    server.listen(port, host, () => {
      events.removeListener("error", onError);
      server.close(() => resolve());
    });
  });
}

/**
 * Devuelve un puerto LIBRE para un server local, validado con bind real.
 * Sortea en [min, min(max, límiteDinámico)] — fuera del rango efímero del SO
 * — y prueba hasta `intentos` candidatos antes de rendirse.
 *
 * Ola 3: intenta OPENCODE_EPHEMERAL_HINT (20274) primero si está dentro del rango.
 */
export async function encontrarPuertoServidor(
  min = 20000,
  max = 45000,
  intentos = 12,
): Promise<number> {
  const techo = Math.min(max, LIMITE_RANGO_DINAMICO);
  // Hint 20274 primero (Gao): probarBind y retornar si libre
  if (OPENCODE_EPHEMERAL_HINT >= min && OPENCODE_EPHEMERAL_HINT <= techo) {
    try {
      await probarBind("127.0.0.1", OPENCODE_EPHEMERAL_HINT);
      return OPENCODE_EPHEMERAL_HINT;
    } catch {
      // ocupado, seguir a sorteo
    }
  }
  let ultimoError: unknown = null;
  for (let i = 0; i < intentos; i++) {
    const port = min + Math.floor(Math.random() * (techo - min + 1));
    // Evitar reintentar hint ya probado
    if (port === OPENCODE_EPHEMERAL_HINT) continue;
    try {
      await probarBind("127.0.0.1", port);
      return port;
    } catch (err) {
      ultimoError = err;
    }
  }
  throw new Error(
    `No se encontró un puerto libre tras ${intentos} intentos (${ultimoError instanceof Error ? ultimoError.message : String(ultimoError)}).`,
  );
}
