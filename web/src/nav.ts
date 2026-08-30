// Navigation — SRP: única fuente de verdad de la navegación. OCP: agregar página = agregar id + item + case en App.
// Source: WarpFactories.md §10

/** Team-level nav ids — rendered in the top block of the sidebar (WarpFactories.md §10). */
export const TEAM_NAV_IDS = [
  "Quickstart",
  "Team Runs",
  "MCPs and apps",
  "Secrets",
  "Integrations",
  "Help",
] as const;

/** Factory-level nav ids — rendered inside the expanded factory node (WarpFactories.md §10). */
export const FACTORY_NAV_IDS = [
  "Dashboard",
  "Activity",
  "Agents",
  "Automations",
  "Runs",
  "Runners",
  "Scorers",
  "Skills",
  "Benchmarks",
  "MCP tools",
  "Factory API",
  "Factory definition",
  "Settings",
  "Self-improvement",
  "Troubleshooting",
  "Infra",
  "Validation",
  "Integrations Deep Dives",
  "GitHub routing",
  "GitLab Deep Dive",
  "Slack Deep Dive",
  "Linear Deep Dive",
  "Jira Deep Dive",
] as const;

/** Every navigable page of the app. Adding a member here breaks `tsc` until its case exists in App.tsx. */
export type NavItemId = (typeof TEAM_NAV_IDS)[number] | (typeof FACTORY_NAV_IDS)[number];

/** Where the item is rendered: the team block or inside a factory node. */
export type NavScope = "team" | "factory";

/** Tab preselected when the item opens the deep-dives container. */
export type DeepDiveTab = "gitlab" | "slack" | "linear" | "jira";

export interface NavItem {
  readonly id: NavItemId;
  /** Visible label — may differ from the id (e.g. id "Team Runs" is labelled "Runs"). */
  readonly label: string;
  readonly scope: NavScope;
  /** Traceability back to the spec: "§10", "§9 · US-081→091", "§12"… */
  readonly trace: string;
  /** Optional counter rendered as a pill (e.g. "7" on Self-improvement). */
  readonly badge?: string;
  /** Present only on the four per-provider deep dives. */
  readonly deepDiveTab?: DeepDiveTab;
}

const TEAM_ITEMS: readonly NavItem[] = [
  { id: "Quickstart", label: "Quickstart", scope: "team", trace: "§14 · US-142→144" },
  { id: "Team Runs", label: "Runs", scope: "team", trace: "§10" },
  { id: "MCPs and apps", label: "MCPs and apps", scope: "team", trace: "§10" },
  { id: "Secrets", label: "Secrets", scope: "team", trace: "§10" },
  { id: "Integrations", label: "Integrations", scope: "team", trace: "§10" },
  { id: "Help", label: "Help", scope: "team", trace: "§10 · US-006" },
];

const FACTORY_ITEMS: readonly NavItem[] = [
  { id: "Dashboard", label: "Dashboard", scope: "factory", trace: "§10" },
  { id: "Activity", label: "Activity", scope: "factory", trace: "§10" },
  { id: "Agents", label: "Agents", scope: "factory", trace: "§10" },
  { id: "Automations", label: "Automations", scope: "factory", trace: "§10" },
  { id: "Runs", label: "Runs", scope: "factory", trace: "§10" },
  { id: "Runners", label: "Runners", scope: "factory", trace: "§10" },
  { id: "Scorers", label: "Scorers", scope: "factory", trace: "§10" },
  { id: "Skills", label: "Skills", scope: "factory", trace: "§10" },
  { id: "Benchmarks", label: "Benchmarks", scope: "factory", trace: "§10" },
  { id: "MCP tools", label: "MCP tools", scope: "factory", trace: "§12 · US-149→155" },
  { id: "Factory API", label: "Factory API", scope: "factory", trace: "§19 · US-149→155" },
  { id: "Factory definition", label: "Factory definition", scope: "factory", trace: "§10" },
  { id: "Settings", label: "Settings", scope: "factory", trace: "§10" },
  { id: "Self-improvement", label: "Self-improvement", scope: "factory", trace: "§10", badge: "7" },
  { id: "Troubleshooting", label: "Troubleshooting", scope: "factory", trace: "§10" },
  { id: "Infra", label: "Infra", scope: "factory", trace: "§10" },
  { id: "Validation", label: "Validation", scope: "factory", trace: "§10" },
  { id: "Integrations Deep Dives", label: "Integrations Deep Dives", scope: "factory", trace: "§9 · US-081→091" },
  { id: "GitHub routing", label: "GitHub routing", scope: "factory", trace: "§9 · US-074→077" },
  { id: "GitLab Deep Dive", label: "GitLab Deep Dive", scope: "factory", trace: "§9 · US-081→085", deepDiveTab: "gitlab" },
  { id: "Slack Deep Dive", label: "Slack Deep Dive", scope: "factory", trace: "§9 · US-067→072", deepDiveTab: "slack" },
  { id: "Linear Deep Dive", label: "Linear Deep Dive", scope: "factory", trace: "§9 · US-086→091", deepDiveTab: "linear" },
  { id: "Jira Deep Dive", label: "Jira Deep Dive", scope: "factory", trace: "§9 · US-092→096", deepDiveTab: "jira" },
];

/** Complete, ordered catalogue. Team block first, then the factory block. */
export const NAV_ITEMS: readonly NavItem[] = [...TEAM_ITEMS, ...FACTORY_ITEMS];

/** Page rendered on first paint. */
export const DEFAULT_NAV_ITEM: NavItemId = "Dashboard";

/** Items for one scope, in catalogue order. Consumed by Sidebar. */
export function navItemsByScope(scope: NavScope): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.scope === scope);
}

/** Full descriptor for an id, or `undefined` when unknown. */
export function getNavItem(id: NavItemId): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.id === id);
}

/** Type guard for values coming from outside the type system (URLs, test fixtures…). */
export function isNavItemId(value: string): value is NavItemId {
  return NAV_ITEMS.some((item) => item.id === value);
}

/**
 * Exhaustiveness guard. Because the parameter is `never`, any `NavItemId` missing
 * from the App switch fails `tsc` instead of silently rendering a placeholder.
 */
export function assertNever(value: never): never {
  throw new Error(`Elemento de navegación no manejado: ${JSON.stringify(value)}`);
}
