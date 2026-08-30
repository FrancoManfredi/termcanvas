
// SRP: only pure evaluation — no I/O, no mutation.
// DIP: depends on AutomationDefinition abstraction, not concretion.

import type { AutomationDefinition, AutomationTrigger } from "./types";

export interface MockEvent {
  provider: string;
  event: string;
  schedule?: string;
  repos?: string[];
  labels?: string[];
  branches?: string[];
  base_branches?: string[];
  // extensible for Slack/Linear/Jira specific keys
  [key: string]: unknown;
}

type FilterValue = string[] | { in?: string[]; not_in?: string[] } | string;

function normalizeToArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (typeof value === "string") {
    return [value];
  }
  if (value == null) {
    return [];
  }
  return [];
}

function getEventValues(event: MockEvent, filterKey: string): string[] {
  // direct match
  const direct = event[filterKey];
  if (direct !== undefined) {
    return normalizeToArray(direct);
  }
  // singular/plural fallback
  const singular = filterKey.endsWith("s") ? filterKey.slice(0, -1) : `${filterKey}s`;
  const fallback = event[singular];
  if (fallback !== undefined) {
    return normalizeToArray(fallback);
  }
  // alias map for common WarpFactories keys
  const aliasMap: Record<string, string[]> = {
    repos: ["repo", "repository", "repositories"],
    labels: ["label"],
    branches: ["branch"],
    base_branches: ["base_branch"],
    authors: ["author"],
    assignees: ["assignee"],
    reviewers: ["reviewer"],
    teams: ["team"],
  };
  const aliases = aliasMap[filterKey];
  if (aliases) {
    for (const a of aliases) {
      const v = event[a];
      if (v !== undefined) {
        return normalizeToArray(v);
      }
    }
  }
  return [];
}

function matchesFilterValue(filterValue: FilterValue, eventValues: string[]): boolean {
  if (Array.isArray(filterValue)) {
    if (filterValue.length === 0) {
      return true;
    }
    if (eventValues.length === 0) {
      return false;
    }
    const anyMatch = filterValue.some((v) => eventValues.includes(String(v)));
    return anyMatch;
  }
  if (typeof filterValue === "string") {
    return eventValues.includes(filterValue);
  }
  if (filterValue !== null && typeof filterValue === "object") {
    const obj = filterValue as { in?: unknown; not_in?: unknown };
    let inOk = true;
    let notInOk = true;
    if (obj.in !== undefined) {
      const inArr = normalizeToArray(obj.in);
      if (inArr.length > 0) {
        inOk = inArr.some((v) => eventValues.includes(v));
      } else {
        inOk = true;
      }
    }
    if (obj.not_in !== undefined) {
      const notInArr = normalizeToArray(obj.not_in);
      if (notInArr.length > 0) {
        const hasBlocked = notInArr.some((v) => eventValues.includes(v));
        notInOk = !hasBlocked;
      }
    }
    const result = inOk && notInOk;
    return result;
  }
  return false;
}

function matchesFilter(filter: Record<string, unknown> | undefined, event: MockEvent): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }
  for (const [key, rawVal] of Object.entries(filter)) {
    // schedule key is handled at trigger level; skip if present as filter? but filter schedule not expected
    if (key === "schedule") {
      continue;
    }
    const eventValues = getEventValues(event, key);
    const ok = matchesFilterValue(rawVal as FilterValue, eventValues);
    if (!ok) {
      return false;
    }
  }
  return true;
}

export function matchesTrigger(trigger: AutomationTrigger, event: MockEvent): boolean {
  if (trigger.provider !== event.provider) {
    return false;
  }
  if (trigger.event !== event.event) {
    return false;
  }
  // schedule triggers: if trigger has schedule, optionally compare if event provides schedule
  if (trigger.provider === "schedule" && trigger.schedule && event.schedule) {
    if (trigger.schedule !== event.schedule) {
      return false;
    }
  }
  const filter = trigger.filter as Record<string, unknown> | undefined;
  const filterOk = matchesFilter(filter, event);
  return filterOk;
}

export function matchesAutomation(automation: AutomationDefinition, event: MockEvent): boolean {
  if (!automation.enabled) {
    return false;
  }
  if (!automation.triggers || automation.triggers.length === 0) {
    return false;
  }
  const any = automation.triggers.some((t) => matchesTrigger(t, event));
  return any;
}

export function findMatchingAutomations(automations: AutomationDefinition[], event: MockEvent): AutomationDefinition[] {
  const matched = automations.filter((a) => matchesAutomation(a, event));
  return matched;
}

export function evaluateEvent(automations: AutomationDefinition[], event: MockEvent): { matched: AutomationDefinition[]; unmatched: AutomationDefinition[] } {
  const matched = findMatchingAutomations(automations, event);
  const matchedNames = new Set(matched.map((m) => m.name));
  const unmatched = automations.filter((a) => !matchedNames.has(a.name));
  return { matched, unmatched };
}

export function isScheduleTrigger(trigger: AutomationTrigger): boolean {
  return trigger.provider === "schedule" || trigger.event === "cron_fired" || !!trigger.schedule;
}

export function describeFilter(filter: Record<string, unknown> | undefined): string {
  if (!filter || Object.keys(filter).length === 0) return "sin filtros (match todo)";
  const parts = Object.entries(filter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  const desc = parts.join(" AND ");
  return desc;
}
