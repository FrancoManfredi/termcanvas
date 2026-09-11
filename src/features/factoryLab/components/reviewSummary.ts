/**
 * reviewSummary — helper puro (sin React) para ReviewPanel.
 * Los fallos de infraestructura del revisor (timeout, server 500, zod)
 * llegan como texto técnico crudo en `ReviewResult.summary`.
 * Esta función lo traduce a un mensaje accionable para humanos y
 * conserva el original como detalle técnico colapsable.
 */

export interface HumanizedReviewSummary {
  /** Mensaje corto y accionable para mostrar siempre. */
  friendly: string;
  /** Resumen crudo original (para <details> técnico). */
  technical: string;
  /** true si el fallo fue de infra (no del cambio revisado). */
  isInfraFailure: boolean;
}

const INFRA_PATTERNS: Array<{ re: RegExp; friendly: string }> = [
  {
    re: /review prompt fallo/i,
    friendly:
      "El revisor automático no pudo responder (error del servidor de modelos, no de tu cambio). " +
      "Si la verificación pasó y no hay findings, podés aceptar igual o mandar a Building para reintentar la revisión.",
  },
  {
    re: /revisor no disponible|opencode server no disponible|session\.prompt no disponible/i,
    friendly:
      "El revisor automático no está disponible en este momento. Tu cambio queda en espera: " +
      "aceptalo igual si la verificación pasó, o reintentá más tarde.",
  },
  {
    re: /review session\.create fallo|session\.create sin sessionId/i,
    friendly:
      "No se pudo abrir la sesión del revisor (infraestructura). El cambio no fue revisado, pero tampoco rechazado: " +
      "revisá la verificación y decidí manualmente.",
  },
  {
    re: /SDK no detectado/i,
    friendly:
      "Falta el SDK del revisor en el daemon (hace falta reiniciar el Factory). El cambio no fue revisado.",
  },
  {
    re: /review zod parse fallo|respuesta no parseable/i,
    friendly:
      "El revisor respondió en un formato inválido y no se pudo interpretar el veredicto. " +
      "Pedí reintento con “Mandar a Building” o decidí manualmente.",
  },
  {
    re: /mismo modelo/i,
    friendly:
      "Revisión bloqueada: el modelo revisor es el mismo que implementó (no se permite auto-aprobación). " +
      "Creá el job con otro modelo, o aceptá manualmente si corresponde.",
  },
  {
    re: /máximo \d+ revisiones alcanzado/i,
    friendly:
      "Revisión devuelta para retrabajo. El caso necesita una decisión humana: aceptá, mandá a Building otra vez, o llevá a Triage.",
  },
  {
    re: /timeout/i,
    friendly:
      "El revisor tardó demasiado en responder (timeout). No es un rechazo: reintentá con “Mandar a Building” o aceptá igual.",
  },
];

export function humanizeReviewSummary(summary: string): HumanizedReviewSummary {
  const technical = summary ?? "";
  for (const p of INFRA_PATTERNS) {
    if (p.re.test(technical)) {
      return { friendly: p.friendly, technical, isInfraFailure: true };
    }
  }
  return { friendly: technical, technical, isInfraFailure: false };
}
