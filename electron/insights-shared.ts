import crypto from "node:crypto";
import path from "node:path";

export type InsightsCliTool = "claude" | "codex";
export type InsightsScanSource = InsightsCliTool | "both";

export interface SessionMetrics {
  toolCounts: Record<string, number>;
  languages: Record<string, number>;
  modelCounts: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  gitCommits: number;
  gitPushes: number;
  filesModified: number;
  linesAdded: number;
  linesRemoved: number;
  toolErrorCategories: Record<string, number>;
  assistantResponseSeconds: number[];
  userReplySeconds: number[];
  userInterruptions: number;
  messageHours: Record<string, number>;
  featureUsage: Record<string, number>;
}

export interface SessionInfo {
  id: string;
  filePath: string;
  cliTool: InsightsCliTool;
  projectPath: string;
  startTimeMs: number;
  endTimeMs: number;
  messageCount: number;
  durationMinutes: number;
  contentSummary: string;
  analysisText: string;
  mtimeMs: number;
  fileSize: number;
  metrics: SessionMetrics;
  userMessageSnippets?: string[];
}

export interface SessionFacet {
  session_id: string;
  cli_tool: InsightsCliTool;
  underlying_goal: string;
  brief_summary: string;
  goal_categories: Record<string, number>;
  outcome:
    | "fully_achieved"
    | "mostly_achieved"
    | "partially_achieved"
    | "not_achieved"
    | "unclear";
  session_type:
    | "single_task"
    | "multi_task"
    | "iterative"
    | "exploratory"
    | "quick_question";
  friction_counts: Record<string, number>;
  user_satisfaction: "high" | "medium" | "low" | "unclear";
  project_path: string;
  project_area: string;
  notable_tools: string[];
  dominant_languages: string[];
  wins: string[];
  frictions: string[];
  recommended_next_step: string;
}

export interface InsightsProgress {
  jobId: string;
  stage:
    | "validating"
    | "scanning"
    | "extracting_facets"
    | "aggregating"
    | "analyzing"
    | "generating_report";
  current: number;
  total: number;
  message: string;
}

export interface InsightsError {
  code:
    | "cli_not_found"
    | "auth_failed"
    | "cli_error"
    | "parse_error"
    | "job_in_progress"
    | "unknown";
  message: string;
  detail?: string;
}

export interface InsightsPipelineCounts {
  sourceCli: InsightsScanSource;
  analyzerCli: InsightsCliTool;
  totalScannedSessions: number;
  totalEligibleSessions: number;
  cachedFacetSessions: number;
  failedFacetSessions: number;
  deferredFacetSessions: number;
  metricsOnlySessions: number;
}

export interface InsightsDailyBreakdownEntry {
  date: string;
  sessions: number;
  tokens: number;
  linesAdded: number;
}

export interface InsightsToolComparisonCard {
  sessionCount: number;
  successRate: number;
  topTools: Array<[string, number]>;
  topLanguages: Array<[string, number]>;
}

export interface InsightsAchievement {
  id:
    | "speed_demon"
    | "night_owl"
    | "early_bird"
    | "shipping_machine"
    | "marathon_runner"
    | "polyglot"
    | "tool_switcher"
    | "streak"
    | "token_whale"
    | "zero_friction";
  title: string;
  detail: string;
}

export interface AggregatedStats extends InsightsPipelineCounts {
  totalSessions: number;
  facetBackedSessions: number;
  totalMessages: number;
  totalDurationMinutes: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalReasoningTokens: number;
  totalGitCommits: number;
  totalGitPushes: number;
  totalFilesModified: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalUserInterruptions: number;
  averageAssistantResponseSeconds: number;
  averageUserReplySeconds: number;
  cliBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;
  sessionTypeBreakdown: Record<string, number>;
  goalCategories: Record<string, number>;
  frictionCounts: Record<string, number>;
  satisfactionBreakdown: Record<string, number>;
  projectBreakdown: Record<string, number>;
  projectAreaBreakdown: Record<string, number>;
  toolBreakdown: Record<string, number>;
  languageBreakdown: Record<string, number>;
  modelBreakdown: Record<string, number>;
  toolErrorBreakdown: Record<string, number>;
  messageHourBreakdown: Record<string, number>;
  responseTimeBreakdown: Record<string, number>;
  userReplyBreakdown: Record<string, number>;
  featureUsageBreakdown: Record<string, number>;
  dailyBreakdown: InsightsDailyBreakdownEntry[];
  toolComparison: Record<InsightsCliTool, InsightsToolComparisonCard>;
  achievements: InsightsAchievement[];
}

export interface InsightsProjectAreaCard {
  name: string;
  share: string;
  evidence: string;
  opportunities: string;
}

export interface InsightsProjectAreasSection {
  summary: string;
  areas: InsightsProjectAreaCard[];
}

export interface InsightsInteractionPattern {
  title: string;
  signal: string;
  impact: string;
  coaching: string;
}

export interface InsightsInteractionStyleSection {
  summary: string;
  patterns: InsightsInteractionPattern[];
}

export interface InsightsWinCard {
  title: string;
  evidence: string;
  whyItWorks: string;
  doMoreOf: string;
}

export interface InsightsWhatWorksSection {
  summary: string;
  wins: InsightsWinCard[];
}

export interface InsightsFrictionCard {
  title: string;
  severity: "high" | "medium" | "low";
  evidence: string;
  likelyCause: string;
  mitigation: string;
}

export interface InsightsFrictionSection {
  summary: string;
  issues: InsightsFrictionCard[];
}

export interface InsightsSuggestionCard {
  title: string;
  priority: "now" | "next" | "later";
  rationale: string;
  playbook: string;
  copyablePrompt: string;
}

export interface InsightsSuggestionsSection {
  summary: string;
  actions: InsightsSuggestionCard[];
}

export interface InsightsHorizonCard {
  title: string;
  whyNow: string;
  experiment: string;
  copyablePrompt: string;
}

export interface InsightsOnTheHorizonSection {
  summary: string;
  bets: InsightsHorizonCard[];
}

export interface InsightsCodingStoryMoment {
  title: string;
  narrative: string;
}

export interface InsightsCodingStorySection {
  summary: string;
  moments: InsightsCodingStoryMoment[];
}

export interface InsightsAtAGlanceSection {
  headline: string;
  bullets: string[];
}

export type InsightsSectionKey =
  | "projectAreas"
  | "interactionStyle"
  | "whatWorks"
  | "frictionAnalysis"
  | "suggestions"
  | "onTheHorizon"
  | "codingStory"
  | "atAGlance";

export type InsightsSectionValueMap = {
  projectAreas: InsightsProjectAreasSection;
  interactionStyle: InsightsInteractionStyleSection;
  whatWorks: InsightsWhatWorksSection;
  frictionAnalysis: InsightsFrictionSection;
  suggestions: InsightsSuggestionsSection;
  onTheHorizon: InsightsOnTheHorizonSection;
  codingStory: InsightsCodingStorySection;
  atAGlance: InsightsAtAGlanceSection;
};

export interface InsightsResult {
  stats: AggregatedStats;
  projectAreas: InsightsProjectAreasSection | null;
  interactionStyle: InsightsInteractionStyleSection | null;
  whatWorks: InsightsWhatWorksSection | null;
  frictionAnalysis: InsightsFrictionSection | null;
  suggestions: InsightsSuggestionsSection | null;
  onTheHorizon: InsightsOnTheHorizonSection | null;
  codingStory: InsightsCodingStorySection | null;
  atAGlance: InsightsAtAGlanceSection;
  sectionErrors: Partial<Record<InsightsSectionKey, string>>;
}

export type InsightsGenerateResult =
  | { ok: true; jobId: string; reportPath: string }
  | { ok: false; jobId: string; error: InsightsError };

const SELF_INSIGHT_MARKERS = [
  "Analyze this AI coding session and return a JSON object",
  "RESPOND WITH ONLY A VALID JSON OBJECT",
  "Write a concise AT-A-GLANCE summary",
  "Analyze this Claude Code session and extract structured facets.",
  "Write the final executive summary for an AI coding insights report.",
  "You are generating an executive-quality AI coding insights report.",
  "Detect the primary language of the sampled user messages below.",
];

export function createEmptySessionMetrics(): SessionMetrics {
  return {
    toolCounts: {},
    languages: {},
    modelCounts: {},
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    gitCommits: 0,
    gitPushes: 0,
    filesModified: 0,
    linesAdded: 0,
    linesRemoved: 0,
    toolErrorCategories: {},
    assistantResponseSeconds: [],
    userReplySeconds: [],
    userInterruptions: 0,
    messageHours: {},
    featureUsage: {},
  };
}

export function buildSessionFingerprint(
  session: Pick<SessionInfo, "cliTool" | "filePath" | "mtimeMs" | "fileSize">,
): string {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify([
        session.cliTool,
        path.resolve(session.filePath),
        session.mtimeMs,
        session.fileSize,
      ]),
    )
    .digest("hex");
}

export function isSelfInsightSession(content: string): boolean {
  if (SELF_INSIGHT_MARKERS.some((marker) => content.includes(marker))) {
    return true;
  }

  const normalized = content.toLowerCase();
  return (
    normalized.includes("codex_exec") &&
    (normalized.includes("insights report") ||
      normalized.includes("extract structured facets") ||
      normalized.includes("at-a-glance summary") ||
      normalized.includes("executive summary"))
  );
}

function incr(map: Record<string, number>, key: string, amount = 1): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + amount;
}

function averageRounded(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function responseBucket(seconds: number): string {
  if (seconds < 30) return "under_30s";
  if (seconds < 120) return "30s_to_2m";
  if (seconds < 600) return "2m_to_10m";
  return "over_10m";
}

function userReplyBucket(seconds: number): string {
  if (seconds < 120) return "under_2m";
  if (seconds < 600) return "2m_to_10m";
  if (seconds < 1_800) return "10m_to_30m";
  return "over_30m";
}

export function buildTranscriptWindow(parts: string[], maxChars = 12_000): string {
  const joined = parts.join("\n");
  if (joined.length <= maxChars) return joined;

  const marker = "\n[... transcript condensed ...]\n";
  const available = Math.max(maxChars - marker.length * 2, 90);
  const segmentBudget = Math.max(Math.floor(available / 3), 30);

  const takeFromStart = (items: string[]): string[] => {
    const kept: string[] = [];
    let used = 0;
    for (const item of items) {
      if (kept.length > 0 && used + item.length + 1 > segmentBudget) break;
      kept.push(item);
      used += item.length + 1;
    }
    return kept;
  };

  const takeFromEnd = (items: string[]): string[] => {
    const kept: string[] = [];
    let used = 0;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (kept.length > 0 && used + item.length + 1 > segmentBudget) break;
      kept.unshift(item);
      used += item.length + 1;
    }
    return kept;
  };

  const middleStart = Math.max(Math.floor(parts.length / 2) - 1, 0);
  const middleSlice = parts.slice(middleStart);

  const head = takeFromStart(parts).join("\n");
  const middle = takeFromStart(middleSlice).join("\n");
  const tail = takeFromEnd(parts).join("\n");

  return `${head}${marker}${middle}${marker}${tail}`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map((item) => getString(item)).filter(Boolean) as string[];
  return items.length === value.length ? items : null;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseObjectArray<T>(
  value: unknown,
  parser: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parser);
  return parsed.every(Boolean) ? (parsed as T[]) : null;
}

function parseProjectAreaCard(value: unknown): InsightsProjectAreaCard | null {
  const obj = getObject(value);
  if (!obj) return null;
  const name = getString(obj.name);
  const share = getString(obj.share);
  const evidence = getString(obj.evidence);
  const opportunities = getString(obj.opportunities);
  return name && share && evidence && opportunities
    ? { name, share, evidence, opportunities }
    : null;
}

function parseInteractionPattern(value: unknown): InsightsInteractionPattern | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const signal = getString(obj.signal);
  const impact = getString(obj.impact);
  const coaching = getString(obj.coaching);
  return title && signal && impact && coaching
    ? { title, signal, impact, coaching }
    : null;
}

function parseWinCard(value: unknown): InsightsWinCard | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const evidence = getString(obj.evidence);
  const whyItWorks = getString(obj.whyItWorks);
  const doMoreOf = getString(obj.doMoreOf);
  return title && evidence && whyItWorks && doMoreOf
    ? { title, evidence, whyItWorks, doMoreOf }
    : null;
}

function parseFrictionCard(value: unknown): InsightsFrictionCard | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const evidence = getString(obj.evidence);
  const likelyCause = getString(obj.likelyCause);
  const mitigation = getString(obj.mitigation);
  const severity = obj.severity;
  return title &&
    evidence &&
    likelyCause &&
    mitigation &&
    (severity === "high" || severity === "medium" || severity === "low")
    ? { title, severity, evidence, likelyCause, mitigation }
    : null;
}

function parseSuggestionCard(value: unknown): InsightsSuggestionCard | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const rationale = getString(obj.rationale);
  const playbook = getString(obj.playbook);
  const copyablePrompt = getString(obj.copyablePrompt);
  const priority = obj.priority;
  return title &&
    rationale &&
    playbook &&
    copyablePrompt &&
    (priority === "now" || priority === "next" || priority === "later")
    ? { title, priority, rationale, playbook, copyablePrompt }
    : null;
}

function parseHorizonCard(value: unknown): InsightsHorizonCard | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const whyNow = getString(obj.whyNow);
  const experiment = getString(obj.experiment);
  const copyablePrompt = getString(obj.copyablePrompt);
  return title && whyNow && experiment && copyablePrompt
    ? { title, whyNow, experiment, copyablePrompt }
    : null;
}

function parseCodingStoryMoment(value: unknown): InsightsCodingStoryMoment | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const narrative = getString(obj.narrative);
  return title && narrative ? { title, narrative } : null;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseStructuredSection<K extends InsightsSectionKey>(
  key: K,
  text: string,
): ParseResult<InsightsSectionValueMap[K]> {
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return { ok: false, error: `No JSON object found for ${key}` };
  }

  const summary = getString(parsed.summary);
  switch (key) {
    case "projectAreas": {
      const areas = parseObjectArray(parsed.areas, parseProjectAreaCard);
      return summary && areas
        ? { ok: true, value: { summary, areas } as InsightsSectionValueMap[K] }
        : { ok: false, error: "projectAreas is missing summary or areas" };
    }
    case "interactionStyle": {
      const patterns = parseObjectArray(parsed.patterns, parseInteractionPattern);
      return summary && patterns
        ? { ok: true, value: { summary, patterns } as InsightsSectionValueMap[K] }
        : { ok: false, error: "interactionStyle is missing summary or patterns" };
    }
    case "whatWorks": {
      const wins = parseObjectArray(parsed.wins, parseWinCard);
      return summary && wins
        ? { ok: true, value: { summary, wins } as InsightsSectionValueMap[K] }
        : { ok: false, error: "whatWorks is missing summary or wins" };
    }
    case "frictionAnalysis": {
      const issues = parseObjectArray(parsed.issues, parseFrictionCard);
      return summary && issues
        ? { ok: true, value: { summary, issues } as InsightsSectionValueMap[K] }
        : { ok: false, error: "frictionAnalysis is missing summary or issues" };
    }
    case "suggestions": {
      const actions = parseObjectArray(parsed.actions, parseSuggestionCard);
      return summary && actions
        ? { ok: true, value: { summary, actions } as InsightsSectionValueMap[K] }
        : { ok: false, error: "suggestions is missing summary or actions" };
    }
    case "onTheHorizon": {
      const bets = parseObjectArray(parsed.bets, parseHorizonCard);
      return summary && bets
        ? { ok: true, value: { summary, bets } as InsightsSectionValueMap[K] }
        : { ok: false, error: "onTheHorizon is missing summary or bets" };
    }
    case "codingStory": {
      const moments = parseObjectArray(parsed.moments, parseCodingStoryMoment);
      return summary && moments && moments.length > 0
        ? { ok: true, value: { summary, moments } as InsightsSectionValueMap[K] }
        : { ok: false, error: "codingStory is missing summary or moments" };
    }
    case "atAGlance": {
      const headline = getString(parsed.headline);
      const bullets = getStringArray(parsed.bullets);
      return headline && bullets && bullets.length > 0
        ? { ok: true, value: { headline, bullets } as InsightsSectionValueMap[K] }
        : { ok: false, error: "atAGlance is missing headline or bullets" };
    }
  }
}

function topKey(map: Record<string, number>): string {
  const [key = "unknown"] = Object.entries(map).sort((a, b) => b[1] - a[1])[0] ?? [];
  return key;
}

function topEntries(
  map: Record<string, number>,
  limit = 3,
): Array<[string, number]> {
  return Object.entries(map)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function toDateKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function successRateFromOutcomes(outcomes: Record<string, number>): number {
  const successes =
    (outcomes.fully_achieved ?? 0) + (outcomes.mostly_achieved ?? 0);
  const total = Object.values(outcomes).reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  return Math.round((successes / total) * 100);
}

function buildAchievements(
  sessions: SessionInfo[],
  stats: Pick<
    AggregatedStats,
    | "messageHourBreakdown"
    | "languageBreakdown"
    | "totalInputTokens"
    | "totalOutputTokens"
    | "dailyBreakdown"
    | "toolErrorBreakdown"
  >,
): InsightsAchievement[] {
  const achievements: InsightsAchievement[] = [];
  const totalMessages = Object.values(stats.messageHourBreakdown).reduce(
    (sum, value) => sum + value,
    0,
  );
  const nightMessages = Object.entries(stats.messageHourBreakdown).reduce(
    (sum, [hour, value]) => {
      const numericHour = Number(hour);
      return numericHour >= 22 || numericHour < 6 ? sum + value : sum;
    },
    0,
  );
  const earlyMessages = Object.entries(stats.messageHourBreakdown).reduce(
    (sum, [hour, value]) => {
      const numericHour = Number(hour);
      return numericHour >= 6 && numericHour < 10 ? sum + value : sum;
    },
    0,
  );

  const sessionsByDay = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    const dayKey = toDateKey(session.startTimeMs);
    const daySessions = sessionsByDay.get(dayKey) ?? [];
    daySessions.push(session);
    sessionsByDay.set(dayKey, daySessions);
  }

  const dayEntries = [...sessionsByDay.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const maxSessionsInDay = Math.max(
    ...stats.dailyBreakdown.map((entry) => entry.sessions),
    0,
  );
  if (maxSessionsInDay > 30) {
    const peakDay = stats.dailyBreakdown.find(
      (entry) => entry.sessions === maxSessionsInDay,
    );
    achievements.push({
      id: "speed_demon",
      title: "Speed Demon",
      detail: `${maxSessionsInDay} sessions on ${peakDay?.date ?? "one day"}.`,
    });
  }

  if (totalMessages > 0 && nightMessages / totalMessages > 0.5) {
    achievements.push({
      id: "night_owl",
      title: "Night Owl",
      detail: `${Math.round((nightMessages / totalMessages) * 100)}% of messages landed between 22:00 and 06:00.`,
    });
  }

  if (totalMessages > 0 && earlyMessages / totalMessages > 0.4) {
    achievements.push({
      id: "early_bird",
      title: "Early Bird",
      detail: `${Math.round((earlyMessages / totalMessages) * 100)}% of messages landed between 06:00 and 10:00.`,
    });
  }

  const shippingDay = stats.dailyBreakdown.find(
    (entry) => entry.linesAdded > 1_000,
  );
  const commitDay = dayEntries.find(([, daySessions]) =>
    daySessions.reduce((sum, session) => sum + session.metrics.gitCommits, 0) > 5,
  );
  if (shippingDay || commitDay) {
    achievements.push({
      id: "shipping_machine",
      title: "Shipping Machine",
      detail: shippingDay
        ? `${shippingDay.linesAdded} lines added on ${shippingDay.date}.`
        : `${commitDay?.[1].reduce((sum, session) => sum + session.metrics.gitCommits, 0) ?? 0} commits on ${commitDay?.[0] ?? "one day"}.`,
    });
  }

  const marathonSession = sessions.find((session) => session.durationMinutes > 120);
  if (marathonSession) {
    achievements.push({
      id: "marathon_runner",
      title: "Marathon Runner",
      detail: `${marathonSession.durationMinutes} minutes in ${marathonSession.id}.`,
    });
  }

  if (Object.keys(stats.languageBreakdown).length >= 5) {
    achievements.push({
      id: "polyglot",
      title: "Polyglot",
      detail: `${Object.keys(stats.languageBreakdown).length} languages showed up across the session set.`,
    });
  }

  for (const [dayKey, daySessions] of dayEntries) {
    const ordered = [...daySessions].sort((a, b) => a.startTimeMs - b.startTimeMs);
    let switches = 0;
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1];
      const current = ordered[i];
      if (
        prev.projectPath &&
        prev.projectPath === current.projectPath &&
        prev.cliTool !== current.cliTool
      ) {
        switches += 1;
      }
    }
    if (switches >= 3) {
      achievements.push({
        id: "tool_switcher",
        title: "Tool Switcher",
        detail: `${switches} cross-tool handoffs on ${dayKey} inside the same project.`,
      });
      break;
    }
  }

  let bestStreak = 0;
  let currentStreak = 0;
  let previousDate: number | null = null;
  for (const [dayKey] of dayEntries) {
    const dayValue = new Date(`${dayKey}T00:00:00`).getTime();
    if (previousDate !== null && dayValue - previousDate === 86_400_000) {
      currentStreak += 1;
    } else {
      currentStreak = 1;
    }
    bestStreak = Math.max(bestStreak, currentStreak);
    previousDate = dayValue;
  }
  if (bestStreak >= 5) {
    achievements.push({
      id: "streak",
      title: "Streak",
      detail: `${bestStreak} consecutive active days.`,
    });
  }

  const totalTokens = stats.totalInputTokens + stats.totalOutputTokens;
  if (totalTokens > 10_000_000) {
    achievements.push({
      id: "token_whale",
      title: "Token Whale",
      detail: `${totalTokens.toLocaleString("en-US")} total tokens processed.`,
    });
  }

  if (dayEntries.some(([, daySessions]) =>
    daySessions.reduce(
      (sum, session) =>
        sum +
        Object.values(session.metrics.toolErrorCategories).reduce(
          (innerSum, value) => innerSum + value,
          0,
        ),
      0,
    ) === 0,
  )) {
    achievements.push({
      id: "zero_friction",
      title: "Zero Friction",
      detail: "At least one active day finished without a recorded tool failure.",
    });
  }

  return achievements;
}

export function buildDeterministicAtAGlance(
  stats: AggregatedStats,
): InsightsAtAGlanceSection {
  const topGoal = topKey(stats.goalCategories);
  const topProject = topKey(stats.projectBreakdown);
  const topArea = topKey(stats.projectAreaBreakdown);
  const topTool = topKey(stats.toolBreakdown);
  const successfulSessions =
    (stats.outcomeBreakdown.fully_achieved ?? 0) +
    (stats.outcomeBreakdown.mostly_achieved ?? 0);
  const sourceLabel =
    stats.sourceCli === "both" ? "Cross-cli" : formatCliLabel(stats.sourceCli);

  return {
    headline: `${sourceLabel} sessions show the strongest value in ${topArea.replace(/_/g, " ")} work.`,
    bullets: [
      `${stats.totalSessions} eligible sessions produced ${stats.totalLinesAdded} added lines across ${stats.totalFilesModified} modified files, with ${stats.facetBackedSessions} sessions contributing rich facet evidence and ${successfulSessions} facet-backed sessions landing in fully or mostly achieved outcomes.`,
      `The dominant work pattern is ${topGoal.replace(/_/g, " ")} inside ${topProject}, and ${topTool} is the tool most frequently involved in getting those sessions over the line.`,
      `Average assistant response time sits around ${stats.averageAssistantResponseSeconds}s, while the user usually follows up after ${stats.averageUserReplySeconds}s, which signals a hands-on but not chaotic review loop.`,
      `${stats.failedFacetSessions > 0 ? `${stats.failedFacetSessions} facet extractions failed, so some evidence is missing.` : "Facet extraction completed wherever tier rules allowed it."} ${stats.metricsOnlySessions > 0 ? `${stats.metricsOnlySessions} eligible sessions remained metrics-only because of time decay.` : "No eligible sessions were held to metrics-only coverage."} ${Object.keys(stats.toolErrorBreakdown).length > 0 ? `The main failure mode was ${topKey(stats.toolErrorBreakdown).replace(/_/g, " ")}.` : "Tool errors were limited."}`,
    ],
  };
}

function formatCliLabel(cliTool: InsightsCliTool): string {
  return cliTool === "claude" ? "Claude Code" : "Codex";
}

export function aggregateFacets(
  facets: SessionFacet[],
  sessions: SessionInfo[],
  counts: InsightsPipelineCounts,
): AggregatedStats {
  const facetsById = new Map(facets.map((facet) => [facet.session_id, facet]));
  const facetBackedSessions = sessions.filter((session) => facetsById.has(session.id));

  const assistantResponseSeconds = sessions.flatMap(
    (session) => session.metrics.assistantResponseSeconds,
  );
  const userReplySeconds = sessions.flatMap(
    (session) => session.metrics.userReplySeconds,
  );

  const dailyMap = new Map<string, InsightsDailyBreakdownEntry>();
  const cliSessionCounts: Record<InsightsCliTool, number> = {
    claude: 0,
    codex: 0,
  };
  const cliToolCounts: Record<InsightsCliTool, Record<string, number>> = {
    claude: {},
    codex: {},
  };
  const cliLanguageCounts: Record<InsightsCliTool, Record<string, number>> = {
    claude: {},
    codex: {},
  };
  const cliOutcomes: Record<InsightsCliTool, Record<string, number>> = {
    claude: {},
    codex: {},
  };

  const stats: AggregatedStats = {
    ...counts,
    totalSessions: sessions.length,
    facetBackedSessions: facetBackedSessions.length,
    totalMessages: sessions.reduce((sum, session) => sum + session.messageCount, 0),
    totalDurationMinutes: sessions.reduce(
      (sum, session) => sum + session.durationMinutes,
      0,
    ),
    totalInputTokens: sessions.reduce(
      (sum, session) => sum + session.metrics.inputTokens,
      0,
    ),
    totalOutputTokens: sessions.reduce(
      (sum, session) => sum + session.metrics.outputTokens,
      0,
    ),
    totalCachedInputTokens: sessions.reduce(
      (sum, session) => sum + session.metrics.cachedInputTokens,
      0,
    ),
    totalReasoningTokens: sessions.reduce(
      (sum, session) => sum + session.metrics.reasoningTokens,
      0,
    ),
    totalGitCommits: sessions.reduce(
      (sum, session) => sum + session.metrics.gitCommits,
      0,
    ),
    totalGitPushes: sessions.reduce(
      (sum, session) => sum + session.metrics.gitPushes,
      0,
    ),
    totalFilesModified: sessions.reduce(
      (sum, session) => sum + session.metrics.filesModified,
      0,
    ),
    totalLinesAdded: sessions.reduce(
      (sum, session) => sum + session.metrics.linesAdded,
      0,
    ),
    totalLinesRemoved: sessions.reduce(
      (sum, session) => sum + session.metrics.linesRemoved,
      0,
    ),
    totalUserInterruptions: sessions.reduce(
      (sum, session) => sum + session.metrics.userInterruptions,
      0,
    ),
    averageAssistantResponseSeconds: averageRounded(assistantResponseSeconds),
    averageUserReplySeconds: averageRounded(userReplySeconds),
    cliBreakdown: {},
    outcomeBreakdown: {},
    sessionTypeBreakdown: {},
    goalCategories: {},
    frictionCounts: {},
    satisfactionBreakdown: {},
    projectBreakdown: {},
    projectAreaBreakdown: {},
    toolBreakdown: {},
    languageBreakdown: {},
    modelBreakdown: {},
    toolErrorBreakdown: {},
    messageHourBreakdown: {},
    responseTimeBreakdown: {},
    userReplyBreakdown: {},
    featureUsageBreakdown: {},
    dailyBreakdown: [],
    toolComparison: {
      claude: { sessionCount: 0, successRate: 0, topTools: [], topLanguages: [] },
      codex: { sessionCount: 0, successRate: 0, topTools: [], topLanguages: [] },
    },
    achievements: [],
  };

  for (const session of sessions) {
    incr(stats.cliBreakdown, session.cliTool);
    cliSessionCounts[session.cliTool] += 1;

    for (const [tool, count] of Object.entries(session.metrics.toolCounts)) {
      incr(stats.toolBreakdown, tool, count);
      incr(cliToolCounts[session.cliTool], tool, count);
    }
    for (const [language, count] of Object.entries(session.metrics.languages)) {
      incr(stats.languageBreakdown, language, count);
      incr(cliLanguageCounts[session.cliTool], language, count);
    }
    for (const [model, count] of Object.entries(session.metrics.modelCounts)) {
      incr(stats.modelBreakdown, model, count);
    }
    for (const [category, count] of Object.entries(session.metrics.toolErrorCategories)) {
      incr(stats.toolErrorBreakdown, category, count);
    }
    for (const [hour, count] of Object.entries(session.metrics.messageHours)) {
      incr(stats.messageHourBreakdown, hour, count);
    }
    for (const [feature, count] of Object.entries(session.metrics.featureUsage)) {
      incr(stats.featureUsageBreakdown, feature, count);
    }
    for (const seconds of session.metrics.assistantResponseSeconds) {
      incr(stats.responseTimeBreakdown, responseBucket(seconds));
    }
    for (const seconds of session.metrics.userReplySeconds) {
      incr(stats.userReplyBreakdown, userReplyBucket(seconds));
    }

    const dayKey = toDateKey(session.startTimeMs);
    const existing = dailyMap.get(dayKey) ?? {
      date: dayKey,
      sessions: 0,
      tokens: 0,
      linesAdded: 0,
    };
    existing.sessions += 1;
    existing.tokens += session.metrics.inputTokens + session.metrics.outputTokens;
    existing.linesAdded += session.metrics.linesAdded;
    dailyMap.set(dayKey, existing);
  }

  for (const facet of facets) {
    incr(stats.outcomeBreakdown, facet.outcome);
    incr(stats.sessionTypeBreakdown, facet.session_type);
    incr(stats.satisfactionBreakdown, facet.user_satisfaction);
    incr(cliOutcomes[facet.cli_tool], facet.outcome);
    incr(
      stats.projectBreakdown,
      facet.project_path ? path.basename(facet.project_path) : "unknown",
    );
    incr(stats.projectAreaBreakdown, facet.project_area || "unknown");

    for (const [category, weight] of Object.entries(facet.goal_categories)) {
      incr(stats.goalCategories, category, weight);
    }
    for (const [type, count] of Object.entries(facet.friction_counts)) {
      incr(stats.frictionCounts, type, count);
    }
  }

  stats.dailyBreakdown = [...dailyMap.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  for (const cliTool of ["claude", "codex"] as const) {
    stats.toolComparison[cliTool] = {
      sessionCount: cliSessionCounts[cliTool],
      successRate: successRateFromOutcomes(cliOutcomes[cliTool]),
      topTools: topEntries(cliToolCounts[cliTool]),
      topLanguages: topEntries(cliLanguageCounts[cliTool]),
    };
  }

  stats.achievements = buildAchievements(sessions, stats);

  return stats;
}
