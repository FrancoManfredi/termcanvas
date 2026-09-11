/**
 * AgentGuardrails — listas canónicas de protección para los agentes factory.
 *
 * ÚNICA fuente de paths/patrones denegados. La consumen dos niveles de
 * enforcement (ninguno es el prompt: el prompt se puede ignorar, estos no):
 *
 * 1. Daemon headless (`headless-runtime/opencodeServerManager.ts` →
 *    `daemonGuardrailPermission()`): config granular del server efímero.
 *    `deny` bloquea sin preguntar (cero intervención humana); `ask` está
 *    prohibido en este pipeline porque estanca el job para siempre.
 * 2. Espejos interactivos (`headless-runtime/factory/opencodeAgentSync.ts`):
 *    bloque `permission` de `.opencode/agents/*.md` con los mismos denies.
 *
 * Semántica opencode V1 (object syntax, SDK 1.18.x): dentro de cada mapa la
 * ÚLTIMA regla que matchea gana — por eso los builders emiten `"*": allow`
 * primero y los denies después. En `edit` un deny alcanza para las 3 tools
 * de escritura (write/edit/patch comparten la acción).
 *
 * ESM puro, cero imports, nunca lanza.
 */

/**
 * Escritura denegada (edit cubre write/edit/patch): secretos, lockfiles,
 * dependencias, git, build outputs y estado interno del orquestador.
 * Vale para LOS 5 agentes (el que no tiene escritura ni lo nota).
 */
export const PROTECTED_EDIT_PATHS: readonly string[] = [
  // Secretos: nunca tocados por un agente.
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "credentials*.json",
  // Lockfiles: los regenera el package manager, no el LLM.
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  // Ruido/peligro: dependencias, historia git, outputs de build.
  "node_modules/**",
  ".git/**",
  "dist*/**",
  // Estado del orquestador: solo el daemon escribe acá.
  ".agents/factory/**",
  "logs/**",
  "**/result.json",
];

/**
 * Lectura denegada: solo secretos (leer un lockfile o un dist es inofensivo
 * y a veces útil; leer un .env vuelca credenciales al contexto).
 */
export const PROTECTED_READ_PATHS: readonly string[] = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "credentials*.json",
];

/**
 * Comandos shell denegados: patrones que cuelgan la tool `bash` esperando
 * stdin o un pipe que nunca cierra (dev servers, watchers, `tail -f`).
 * El watchdog del turno (180s idle) los mataría igual, pero tarde y con
 * tokens quemados: el deny los frena ANTES de ejecutar, sin humano.
 * `pnpm test` / `pnpm build` normales no matchean ninguno.
 */
export const FORBIDDEN_SHELL_PATTERNS: readonly string[] = [
  "*--watch*",
  "*tail -f*",
  "npm run dev*",
  "pnpm dev*",
  "pnpm run dev*",
  "yarn dev*",
];

function denyMap(patterns: readonly string[]): Record<string, string> {
  const out: Record<string, string> = { "*": "allow" };
  try {
    for (const p of patterns) {
      if (typeof p === "string" && p.trim().length > 0) out[p] = "deny";
    }
  } catch {
    // listas estáticas: este catch nunca corre, pero el contrato es no lanzar
  }
  return out;
}

/**
 * Objeto `permission` granular para la config del server efímero
 * (`createOpencodeServer({ config })`). Incluye los allows operativos del
 * daemon (bash/webfetch/external_directory/glob/grep) MÁS los denies de
 * arriba. `TERMCANVAS_DAEMON_ASK_PERMISSIONS=1` lo ignora (modo supervisado).
 * Puro, nunca lanza.
 */
export function daemonGuardrailPermission(): Record<string, unknown> {
  try {
    return {
      edit: denyMap(PROTECTED_EDIT_PATHS),
      read: denyMap(PROTECTED_READ_PATHS),
      bash: denyMap(FORBIDDEN_SHELL_PATTERNS),
      glob: "allow",
      grep: "allow",
      webfetch: "allow",
      external_directory: "allow",
    };
  } catch {
    return { edit: "allow", bash: "allow", webfetch: "allow", external_directory: "allow" };
  }
}
