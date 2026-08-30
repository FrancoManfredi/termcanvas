// continuation.ts — SRP: clave estable para deduplicar ejecuciones de issue/PR/comentario
// O17: usada por webhook.routes.ts para sourceRef y workItem linking
// Matching web/src/lib/factory/domain/github.routing.ts continuationKey

export function continuationKey(repo: string, number: number | string): string {
  return `${repo}#${number ?? "unknown"}`;
}

export function continuationKeyFromEvent(repo: string, number?: number): string {
  return continuationKey(repo, number ?? "unknown");
}
