// GitHubRouting — SRP: evalúa el dual-requirement de GitHub sin I/O, store ni React.
// DIP: recibe evento, policy y automations; delega el matching genérico al engine existente.
// OCP: los checks viven en ROUTING_CHECK_ORDER; automation.engine.ts permanece intacto.
// Source: WarpFactories.md §9 "Mencionar la factory (routing exacto — dual requirement)" · US-074, US-075, US-076, US-077

import type { AutomationDefinition } from "./types";
import type { MockEvent } from "./automation.engine";
import { findMatchingAutomations } from "./automation.engine";

export const DEFAULT_WARP_HANDLE = "@warp-factory";
export const FACTORY_LABEL_PREFIX = "factory:";

/** Orden estable que respeta la traza del simulador. */
export const ROUTING_CHECK_ORDER = [
  "new_content",
  "not_bot_author",
  "label_present",
  "not_code_block",
  "mention_present",
] as const;
export type RoutingCheckId = (typeof ROUTING_CHECK_ORDER)[number];

export interface RoutingCheck {
  readonly id: RoutingCheckId;
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly source: string;
}

export interface GitHubRoutingEvent {
  readonly provider: "github";
  readonly event: string;
  readonly repo: string;
  readonly number?: number;
  readonly labels: readonly string[];
  readonly body: string;
  readonly isEdit: boolean;
  readonly authorIsBot: boolean;
  readonly mentioned?: readonly string[];
  readonly assigned?: readonly string[];
}

export interface RoutingPolicy {
  readonly foremanName: string;
  readonly handle: string;
  readonly requireFactoryLabel: boolean;
}

export interface RoutingDecision {
  readonly routable: boolean;
  readonly checks: readonly RoutingCheck[];
  readonly reason: string;
  readonly expectedLabel: string;
  readonly matchedHandle?: string;
}

const SOURCE = "WarpFactories.md §9";
const CHECK_LABELS: Readonly<Record<RoutingCheckId, string>> = {
  new_content: "Solo new content cuenta",
  not_bot_author: "El autor no es un bot",
  label_present: "Label de factory presente",
  not_code_block: "La mención no vive en code block",
  mention_present: "Mention o assignee presente",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsHandle(values: readonly string[] | undefined, handle: string): boolean {
  if (!values || values.length === 0) return false;
  const expected = handle.trim().toLowerCase();
  return values.some((value) => {
    const candidate = value.trim().toLowerCase();
    const candidateWithAt = candidate.startsWith("@") ? candidate : `@${candidate}`;
    return candidate === expected || candidateWithAt === expected || candidate.includes(expected);
  });
}

/** Label canónico de routing, derivado del alias del Foreman. */
export function factoryLabel(foremanName: string): string {
  return `${FACTORY_LABEL_PREFIX}${foremanName.trim()}`;
}

/**
 * Elimina fenced code (` ``` ` y `~~~`) e inline code (`...`).
 * El reemplazo por espacio evita unir texto adyacente y conserva una decisión pura.
 */
export function stripCodeBlocks(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

/** Busca un handle completo, sin distinguir mayúsculas y sin aceptar prefijos/sufijos de palabra. */
export function findMention(text: string, handle: string): string | undefined {
  const normalized = handle.trim();
  if (normalized === "") return undefined;
  const pattern = new RegExp(`(^|[^A-Za-z0-9_./-])(${escapeRegExp(normalized)})(?![A-Za-z0-9_./-])`, "i");
  const match = pattern.exec(text);
  return match?.[2];
}

/** Labels son case-insensitive; el valor retornado no depende del casing del evento. */
export function hasFactoryLabel(labels: readonly string[], foremanName: string): boolean {
  const expected = factoryLabel(foremanName).toLowerCase();
  return labels.some((label) => label.trim().toLowerCase() === expected);
}

/** Clave estable para deduplicar ejecuciones de issue/PR/comentario. */
export function continuationKey(event: GitHubRoutingEvent): string {
  return `${event.repo}#${event.number ?? "unknown"}`;
}

function check(
  id: RoutingCheckId,
  ok: boolean,
  detail: string
): RoutingCheck {
  return { id, label: CHECK_LABELS[id], ok, detail, source: SOURCE };
}

/**
 * Evalúa siempre los cinco checks (sin cortocircuito), para que la UI tenga una traza completa.
 * `routeGitHubEvent` es el nombre narrativo público; `isRoutable` conserva la API del diseño.
 */
export function routeGitHubEvent(event: GitHubRoutingEvent, policy: RoutingPolicy): RoutingDecision {
  const expectedLabel = factoryLabel(policy.foremanName);
  const cleanedBody = stripCodeBlocks(event.body);
  const bodyMention = findMention(cleanedBody, policy.handle);
  const listedMention = containsHandle(event.mentioned, policy.handle);
  const listedAssignee = containsHandle(event.assigned, policy.handle);
  const matchedHandle = bodyMention ?? (listedMention || listedAssignee ? policy.handle : undefined);

  const mentionOutsideCode = cleanedBody.trim().length > 0 || listedMention || listedAssignee;

  const checks: readonly RoutingCheck[] = [
    check(
      "new_content",
      !event.isEdit,
      event.isEdit ? "Es una edición; solo el contenido nuevo dispara routing." : "El evento contiene contenido nuevo."
    ),
    check(
      "not_bot_author",
      !event.authorIsBot,
      event.authorIsBot ? "El autor es un bot; sus menciones se ignoran." : "El autor no es bot."
    ),
    check(
      "label_present",
      !policy.requireFactoryLabel || hasFactoryLabel(event.labels, policy.foremanName),
      !policy.requireFactoryLabel
        ? "El filtro de label está desactivado por policy."
        : hasFactoryLabel(event.labels, policy.foremanName)
          ? `Encontrado ${expectedLabel}.`
          : `Falta ${expectedLabel}.`
    ),
    check(
      "not_code_block",
      mentionOutsideCode,
      mentionOutsideCode
        ? listedMention || listedAssignee
          ? "La mention/assign está fuera de bloques de código."
          : "Quedó contenido fuera de bloques de código."
        : "La mención solo aparece dentro de un bloque de código."
    ),
    check(
      "mention_present",
      matchedHandle !== undefined,
      matchedHandle === undefined
        ? `No aparece ${policy.handle} en body, mentions ni assignees.`
        : `Encontrado ${matchedHandle} en body, mentions o assignees.`
    ),
  ];

  const routable = checks.every((routingCheck) => routingCheck.ok);
  const failed = checks.find((routingCheck) => !routingCheck.ok);
  const reason = routable
    ? `Enruta a ${expectedLabel}.`
    : failed?.detail ?? "El evento no cumple el dual-requirement.";

  return {
    routable,
    checks,
    reason,
    expectedLabel,
    ...(matchedHandle === undefined ? {} : { matchedHandle }),
  };
}

export function isRoutable(event: GitHubRoutingEvent, policy: RoutingPolicy): RoutingDecision {
  return routeGitHubEvent(event, policy);
}

/** Mapea el evento GitHub al contrato que ya entiende automation.engine.ts. */
export function toMockEvent(event: GitHubRoutingEvent): MockEvent {
  return {
    provider: event.provider,
    event: event.event,
    repos: [event.repo],
    labels: [...event.labels],
    repo: event.repo,
    number: event.number,
    body: event.body,
    mentioned: [...(event.mentioned ?? [])],
    assigned: [...(event.assigned ?? [])],
  };
}

/** Gate dual antes del engine: un evento no routable jamás consulta automations. */
export function evaluateGitHubEvent(
  automations: readonly AutomationDefinition[],
  event: GitHubRoutingEvent,
  policy: RoutingPolicy
): { decision: RoutingDecision; matched: readonly AutomationDefinition[] } {
  const decision = routeGitHubEvent(event, policy);
  if (!decision.routable) return { decision, matched: [] };
  return {
    decision,
    matched: findMatchingAutomations([...automations], toMockEvent(event)),
  };
}
