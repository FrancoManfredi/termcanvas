/**
 * Re-export del OpencodeServerManager singleton.
 * Ubicación canónica según system_design: headless-runtime/opencode/opencodeServerManager.ts
 * Implementación real vive en headless-runtime/opencodeServerManager.ts (requerida por el fix Gao)
 */
export * from "../opencodeServerManager";
export { default } from "../opencodeServerManager";
