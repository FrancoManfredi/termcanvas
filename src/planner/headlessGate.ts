// Gate de finalización para sesiones headless que producen un artefacto en
// disco (toolsSession: tool-findings; securitySession: security-result).
//
// La corrida está COMPLETA solo cuando existen AMBAS señales — artefacto
// escrito y proceso salido con código 0 — pero el ORDEN de llegada es una
// carrera real: el orquestador escribe el archivo y sale milisegundos
// después, así que el evento de exit suele llegar ANTES de que el poller vea
// el archivo. Un gate que exige fileFound && exit en un único instante se
// traga una de las dos señales y la sesión queda trabada para siempre (bug
// real: "Esperando a que todas las herramientas terminen…" con exit 0 visible
// en el log, categoría diseno-patrones, 25/8/2026).
//
// Esta máquina de estados es PURA y recibe callbacks inyectados para poder
// testear todas las ordenaciones sin terminal ni window (mismo patrón que
// applyMergeProgressEvent en issueReviewStore). Las sesiones que la usan
// guardan su propia semántica de stop/timeouts alrededor.

export interface HeadlessGateCallbacks<T> {
  // El artefacto apareció (se entrega UNA sola vez), con el detalle que
  // trajo markArtifact (la ruta descubierta por el poller).
  onArtifactReady: (detail: T) => void;
  // AMBAS señales presentes (artefacto + exit 0), EN CUALQUIER ORDEN.
  // Se entrega EXACTAMENTE una vez.
  onCompleted: (exitCode: number) => void;
  // El proceso salió con código != 0: corrida fallida aunque el artefacto
  // haya alcanzado a escribirse. El caller compone el mensaje con
  // artifactReady para aclarar si hubo artefacto o no.
  onFailed: (message: string) => void;
}

export interface HeadlessGate<T> {
  // Señal del exit del proceso. La PRIMERA señal de exit es la válida; las
  // siguientes se ignoran (no hay reintentos que pasen por acá).
  // buildFailMessage recibe si el artefacto había aparecido, para que el
  // mensaje distinga "(exit N)" de "(exit N) sin escribir <artefacto>".
  markExit: (
    exitCode: number,
    buildFailMessage: (artifactReady: boolean) => string,
  ) => void;
  // Señal de artefacto en disco (idempotente: marcar dos veces no duplica
  // la entrega ni revoca un fallo ya decidido).
  markArtifact: (detail: T) => void;
}

export function createHeadlessGate<T>(
  callbacks: HeadlessGateCallbacks<T>,
): HeadlessGate<T> {
  let exitSeen = false;
  let lastExitCode = 0;
  let hasArtifact = false;
  // Ya se decidió el desenlace (completed O failed): nada más se entrega.
  let settled = false;

  const deliverIfComplete = () => {
    if (settled || !hasArtifact || !exitSeen) return;
    settled = true;
    callbacks.onCompleted(lastExitCode);
  };

  return {
    markExit(exitCode, buildFailMessage) {
      if (exitSeen) return;
      exitSeen = true;
      lastExitCode = exitCode;
      if (exitCode !== 0) {
        settled = true;
        callbacks.onFailed(buildFailMessage(hasArtifact));
        return;
      }
      deliverIfComplete();
    },
    markArtifact(detail) {
      if (hasArtifact || settled) return;
      hasArtifact = true;
      callbacks.onArtifactReady(detail);
      deliverIfComplete();
    },
  };
}
