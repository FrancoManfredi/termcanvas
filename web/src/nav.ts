export const TEAM_NAV_IDS = [
  "Team Runs",
  "MCPs and apps",
  "Secrets",
  "Integrations",
] as const;

export const FACTORY_NAV_IDS = [
  "Dashboard",
  "Activity",
  "Agents",
  "Automations",
  "Runs",
  "Scorers",
  "Self-improvement",
  "Factory definition",
  "Settings",
] as const;

export type NavItemId = (typeof TEAM_NAV_IDS)[number] | (typeof FACTORY_NAV_IDS)[number];
export type NavScope = "team" | "factory";

export interface NavItem {
  readonly id: NavItemId;
  readonly label: string;
  readonly scope: NavScope;
  readonly trace: string;
}

const TEAM_ITEMS: readonly NavItem[] = [
  { id: "Team Runs", label: "Runs", scope: "team", trace: "§10" },
  { id: "MCPs and apps", label: "MCPs and apps", scope: "team", trace: "§10" },
  { id: "Secrets", label: "Secrets", scope: "team", trace: "§10" },
  { id: "Integrations", label: "Integrations", scope: "team", trace: "§10" },
];

const FACTORY_ITEMS: readonly NavItem[] = [
  { id: "Dashboard", label: "Dashboard", scope: "factory", trace: "§10" },
  { id: "Activity", label: "Activity", scope: "factory", trace: "§10" },
  { id: "Agents", label: "Agents", scope: "factory", trace: "§10" },
  { id: "Automations", label: "Automations", scope: "factory", trace: "§10" },
  { id: "Runs", label: "Runs", scope: "factory", trace: "§10" },
  { id: "Scorers", label: "Scorers", scope: "factory", trace: "§10" },
  { id: "Self-improvement", label: "Self-improvement", scope: "factory", trace: "§10" },
  { id: "Factory definition", label: "Factory definition", scope: "factory", trace: "§10" },
  { id: "Settings", label: "Settings", scope: "factory", trace: "§10" },
];

export const NAV_ITEMS: readonly NavItem[] = [...TEAM_ITEMS, ...FACTORY_ITEMS];

export const DEFAULT_NAV_ITEM: NavItemId = "Dashboard";

export function navItemsByScope(scope: NavScope): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.scope === scope);
}

export function getNavItem(id: NavItemId): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.id === id);
}

export function isNavItemId(value: string): value is NavItemId {
  return NAV_ITEMS.some((item) => item.id === value);
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled nav item: ${JSON.stringify(value)}`);
}

if (NAV_ITEMS.length !== 13) {
  throw new Error(`NAV_ITEMS must be 13, got ${NAV_ITEMS.length}`);
}
