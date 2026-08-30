// GitHubRoutingDerive — SRP: datos y copy para el simulador de routing, sin reglas ni React.
// DIP: la página consume estos presets/tablas y delega la evaluación al dominio github.routing.
// Source: WarpFactories.md §9 · US-074, US-075, US-076, US-077

import { DEFAULT_WARP_HANDLE } from "./github.routing";
import type { GitHubRoutingEvent, RoutingPolicy } from "./github.routing";

export interface GitHubEventOption {
  readonly id: string;
  readonly label: string;
  readonly category: "issues" | "pull_requests" | "reviews" | "code_ci";
}

/** Los 20 eventos de §9: 4 issues + 9 PRs + 2 reviews + 5 code/CI. */
export const GITHUB_EVENTS: readonly GitHubEventOption[] = [
  { id: "issues_opened", label: "Issue opened", category: "issues" },
  { id: "issues_edited", label: "Issue edited", category: "issues" },
  { id: "issues_labeled", label: "Issue labeled", category: "issues" },
  { id: "issue_comment_created", label: "Issue comment created", category: "issues" },
  { id: "pull_request_opened", label: "Pull request opened", category: "pull_requests" },
  { id: "pull_request_edited", label: "Pull request edited", category: "pull_requests" },
  { id: "pull_request_labeled", label: "Pull request labeled", category: "pull_requests" },
  { id: "pull_request_synchronize", label: "Pull request synchronized", category: "pull_requests" },
  { id: "pull_request_reopened", label: "Pull request reopened", category: "pull_requests" },
  { id: "pull_request_closed", label: "Pull request closed", category: "pull_requests" },
  { id: "pull_request_assigned", label: "Pull request assigned", category: "pull_requests" },
  { id: "pull_request_review_requested", label: "Pull request review requested", category: "pull_requests" },
  { id: "pull_request_unlabeled", label: "Pull request unlabeled", category: "pull_requests" },
  { id: "pull_request_review_submitted", label: "Pull request review submitted", category: "reviews" },
  { id: "pull_request_review_comment_created", label: "Pull request review comment created", category: "reviews" },
  { id: "push", label: "Push", category: "code_ci" },
  { id: "workflow_run_completed", label: "Workflow run completed", category: "code_ci" },
  { id: "check_run_completed", label: "Check run completed", category: "code_ci" },
  { id: "deployment_status", label: "Deployment status", category: "code_ci" },
  { id: "release_published", label: "Release published", category: "code_ci" },
];

export interface GitHubFilterAppearsOn {
  readonly key: string;
  readonly label: string;
  readonly appearsOn: readonly string[];
}

/** 12 filtros documentados por US-075 con los eventos donde son observables. */
export const GITHUB_FILTER_APPEARS_ON: readonly GitHubFilterAppearsOn[] = [
  { key: "repos", label: "Repos", appearsOn: GITHUB_EVENTS.map((event) => event.id) },
  { key: "labels", label: "Labels", appearsOn: ["issues_labeled", "pull_request_labeled", "pull_request_unlabeled"] },
  { key: "branches", label: "Branches", appearsOn: ["push", "pull_request_opened", "pull_request_synchronize", "pull_request_closed"] },
  { key: "base_branches", label: "Base branches", appearsOn: ["pull_request_opened", "pull_request_synchronize", "pull_request_closed"] },
  { key: "authors", label: "Authors", appearsOn: GITHUB_EVENTS.map((event) => event.id) },
  { key: "assignees", label: "Assignees", appearsOn: ["issues_opened", "issue_comment_created", "pull_request_opened", "pull_request_assigned"] },
  { key: "reviewers", label: "Reviewers", appearsOn: ["pull_request_review_requested", "pull_request_review_submitted", "pull_request_review_comment_created"] },
  { key: "teams", label: "Teams", appearsOn: ["pull_request_review_requested", "pull_request_assigned"] },
  { key: "milestones", label: "Milestones", appearsOn: ["issues_opened", "issues_edited", "pull_request_opened", "pull_request_edited"] },
  { key: "draft", label: "Draft", appearsOn: ["pull_request_opened", "pull_request_edited", "pull_request_synchronize"] },
  { key: "event", label: "Event", appearsOn: GITHUB_EVENTS.map((event) => event.id) },
  { key: "provider", label: "Provider", appearsOn: GITHUB_EVENTS.map((event) => event.id) },
];

export interface RoutingPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly trace: string;
  readonly policy: RoutingPolicy;
  readonly event: GitHubRoutingEvent;
}

const DEFAULT_POLICY: RoutingPolicy = {
  foremanName: "payments",
  handle: DEFAULT_WARP_HANDLE,
  requireFactoryLabel: true,
};

function event(overrides: Partial<GitHubRoutingEvent>): GitHubRoutingEvent {
  return {
    provider: "github",
    event: "issue_comment_created",
    repo: "acme/payments-service",
    number: 42,
    labels: ["factory:payments"],
    body: "Please review this @warp-factory",
    isEdit: false,
    authorIsBot: false,
    ...overrides,
  };
}

/** Cinco presets de un clic requeridos por §9 y US-076 — copy ES pulido con traza. El primero es el caso válido. */
export const GITHUB_ROUTING_PRESETS: readonly RoutingPreset[] = [
  {
    id: "valid_routing",
    label: "Caso válido — Enruta",
    description: "Label + mention presentes, new content, no bot, fuera de code block — enruta.",
    trace: "WarpFactories.md §9 · US-076 — dual requirement (caso válido)",
    policy: DEFAULT_POLICY,
    event: event({}),
  },
  {
    id: "mention_without_label",
    label: "Mention sin label",
    description: "La mention está presente, pero falta el label de la factory — no enruta.",
    trace: "WarpFactories.md §9 · US-076 — dual requirement",
    policy: DEFAULT_POLICY,
    event: event({ labels: [] }),
  },
  {
    id: "label_without_mention",
    label: "Label sin mention",
    description: "El label está, pero no hay mention ni assignee — no enruta.",
    trace: "WarpFactories.md §9 · US-076 — dual requirement",
    policy: DEFAULT_POLICY,
    event: event({ body: "Please review this change" }),
  },
  {
    id: "mention_in_code_block",
    label: "Mention en code block",
    description: "La mention vive dentro de un bloque fenced y se ignora — no enruta.",
    trace: "WarpFactories.md §9 · US-076 — mention en code block ignorada",
    policy: DEFAULT_POLICY,
    event: event({ body: "```\n@warp-factory\n```" }),
  },
  {
    id: "edit_with_mention",
    label: "Edit con mention",
    description: "Las ediciones no disparan routing aunque contengan mention — no enruta.",
    trace: "WarpFactories.md §9 · US-076 — solo new content cuenta",
    policy: DEFAULT_POLICY,
    event: event({ isEdit: true }),
  },
];

/** Alias corto para consumers que prefieren la forma singular del diseño. */
export const ROUTING_PRESETS = GITHUB_ROUTING_PRESETS;

export function getGitHubEventLabel(eventId: string): string {
  return GITHUB_EVENTS.find((eventOption) => eventOption.id === eventId)?.label ?? eventId;
}

export function getGitHubFilter(key: string): GitHubFilterAppearsOn | undefined {
  return GITHUB_FILTER_APPEARS_ON.find((filter) => filter.key === key);
}
