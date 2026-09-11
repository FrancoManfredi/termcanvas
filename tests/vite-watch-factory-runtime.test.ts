/**
 * vite-watch-factory-runtime — the review→awaiting "app restarted" flash.
 *
 * Root cause (live evidence, 2026-09-07): on every review→ask_human
 * transition the daemon writes `factory/.notifications.json` (tmp→rename in
 * the same dir) at the exact tick the row moves to AWAITING YOU — e.g.
 * notification `n-1788763222508-501` for `job-mtqvcgby-8rbx` carries the
 * `err_a068c707` body the user saw, and the file mtime matches the ask to
 * the millisecond. When the announce-ask-human event fires,
 * `factory/.automations.json` is written ~40ms later too. Neither path was
 * in `vite.config.ts` `server.watch.ignored`, so Vite's chokidar watcher
 * treated the daemon write as a source change and sent a WS `full-reload`:
 * 1s black screen, console wiped (which is why console.log hunting was
 * hopeless — the recorder ring `warp-last-crash` stays EMPTY on this path
 * because no JS threw), then the 2.5s poll repainted with the issue in
 * Awaiting You. Intake/foreman/building/review never flashed because those
 * write under the already-ignored `.agents/` tree or outside the repo.
 *
 * Fix: ignore the factory dot-runtime (rings + tmp→rename siblings +
 * proposals/benchmark-results dirs) while keeping factory SOURCE watched.
 *
 * Follow-up (resolve→In Progress flash, same bug class): EVERY
 * POST /factory/jobs — i.e. every Resolve click in the Warp panel —
 * synchronously rewrites `factory/.job-index.json`
 * (`workItemStore.create` → `recordJobDirInIndex`, tmp→rename in the same
 * dir, ~100ms after the click). The index was missing from the ignore list,
 * so the panel always full-reloaded ~1s after Resolve and the 2.5s poll
 * repainted with the card in In Progress. Same fix, same pattern.
 *
 * Follow-up 2 (Agents Save → black screen + app "restart", same bug class):
 * EVERY PUT /factory/agents/:name — i.e. every Save changes in the Agents
 * panel — rewrites `factory/agents/<name>/agent.md` (body-only, tmp→rename
 * sibling `agent.md.tmp-<ts>-<rand>` in the same dir) and regenerates the
 * `.opencode/agents/<name>.md` mirror. `agent.md` is watched SOURCE (not
 * dot-runtime), so the save full-reloaded the renderer: black screen, state
 * wiped, app seemingly restarted. Fix: ignore the agents agent.md glob
 * (file + tmp siblings, same trailing-star idiom as the rings; see the
 * pinned pattern strings in the test below) and the `.opencode/agents/`
 * mirror subtree. Accepted tradeoff, pinned below:
 * editing an agent.md in an external editor no longer hot-reloads — the
 * Agents panel is its live editor now.
 *
 * Offline: zero network, zero daemon. Reads vite.config.ts as text and
 * matches paths with a documented mini-matcher (all patterns start with a
 * globstar prefix: trailing "/**" = subtree, trailing "*" = prefix incl.
 * tmp siblings, else exact suffix).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

function readIgnoredPatterns(): string[] {
  const src = readFileSync(join(repoRoot, "vite.config.ts"), "utf8");
  const block = /watch\s*:\s*\{\s*ignored\s*:\s*\[([\s\S]*?)\]/m.exec(src);
  assert.ok(block, "server.watch.ignored block must exist in vite.config.ts");
  const out: string[] = [];
  for (const m of block[1].matchAll(/"([^"]+)"/g)) out.push(m[1]);
  assert.ok(out.length > 0, "ignored list must be non-empty");
  return out;
}

// Mini-matcher for the globstar-prefixed patterns used in vite.config.ts
// (all entries start with a globstar prefix). Converted to a segment-aware
// regex so INNER wildcards work too (`agents/**/` in the Agents Save glob):
// `**/` = any depth (incl. zero), `**` = anything, `*` = within one segment.
// Match must start on a segment boundary; end needs boundary or end-of-path
// (so trailing-`*` prefixes still cover tmp→rename siblings).
function globBodyToRegExpSource(body: string): string {
  let out = "";
  for (let i = 0; i < body.length;) {
    if (body.startsWith("**/", i)) { out += "(?:.*/)?"; i += 3; }
    else if (body.startsWith("**", i)) { out += ".*"; i += 2; }
    else if (body[i] === "*") { out += "[^/]*"; i += 1; }
    else { out += body[i].replace(/[.*+?^${}()|[\]\\]/, "\\$&"); i += 1; }
  }
  return out;
}

function isIgnored(filePath: string, patterns: string[]): boolean {
  const p = filePath.split("\\").join("/");
  for (const pat of patterns) {
    if (pat.slice(0, 3) !== "**/") continue;
    const re = new RegExp("(?:^|/)" + globBodyToRegExpSource(pat.slice(3)) + "(?:$|/)");
    if (re.test(p)) return true;
  }
  return false;
}

const RUNTIME_WRITES = [
  // Ask-human ring (written on EVERY review→awaiting transition).
  "factory/.notifications.json",
  "factory/.notifications.json.tmp-1788763222508-ab12",
  "C:/repos/termcanvas/factory/.notifications.json",
  // Automation ring (written when announce-ask-human fires, ~40ms later).
  "factory/.automations.json",
  "factory/.automations.json.tmp-1788761099437-xy99",
  // Mock-integration ring (same writer class, same dir).
  "factory/.integrations-mock.json",
  "factory/.integrations-mock.json.tmp-1234-abcd",
  // Job index (rewritten on EVERY POST /factory/jobs, i.e. every Resolve
  // click — workItemStore.create → recordJobDirInIndex, tmp→rename).
  "factory/.job-index.json",
  "factory/.job-index.json.tmp-1788763222508-ab12",
  "C:/repos/termcanvas/factory/.job-index.json",
  // Proposal + benchmark evidence dirs.
  "factory/.proposals/imp-mtq3v3s1-4dbuhx.json",
  "factory/.proposals/imp-mtq3v3s1-4dbuhx.bak",
  "factory/.benchmark-results/bench-mtoce4ee2ph0ap.json",
  "factory/.benchmark-results/bench-mtoce4ee2ph0ap.decision.json",
  // Agents panel Save (PUT /factory/agents/:name): body rewrite + tmp sibling
  // + opencode mirror. Daemon write must not full-reload (black screen).
  "factory/agents/triage/agent.md",
  "factory/agents/triage/agent.md.tmp-1788763222508-ab12",
  "factory/agents/foreman/agent.md",
  "C:/repos/termcanvas/factory/agents/review/agent.md",
  ".opencode/agents/triage.md",
  "C:/repos/termcanvas/.opencode/agents/spec.md",
];

const FACTORY_SOURCE = [
  "factory/factory.yaml",
  "factory/prompts/nightly.md",
  "factory/runners/run.mjs",
  "factory/scorers/review-formato-valido/scorer.md",
  "factory/skills/repo-conventions/SKILL.md",
  "factory/benchmarks/bench.md",
  "src/App.tsx",
];

test("factory runtime evidence files are ignored by the dev watcher", () => {
  const ignored = readIgnoredPatterns();
  for (const file of RUNTIME_WRITES) {
    assert.equal(
      isIgnored(file, ignored),
      true,
      file + " must be ignored (daemon write must not full-reload)",
    );
  }
});

test("factory source files stay watched (edits still reload)", () => {
  const ignored = readIgnoredPatterns();
  for (const file of FACTORY_SOURCE) {
    assert.equal(
      isIgnored(file, ignored),
      false,
      file + " must stay watched (source edits must reload)",
    );
  }
});

test("agents exception: agent.md is UI-runtime, not hot-reloaded source", () => {
  // `factory/agents/<name>/agent.md` is the ONLY factory source the daemon
  // rewrites at runtime (Agents panel Save). It must stay ignored or every
  // save black-screens the app. If you remove it from the ignore list, the
  // RUNTIME_WRITES case above goes red first — read its header before touching
  // vite.config.ts.
  const ignored = readIgnoredPatterns();
  assert.ok(
    ignored.includes("**/factory/agents/**/agent.md*"),
    "agent.md + tmp siblings must remain ignored (Agents panel PUT path)",
  );
  assert.ok(
    ignored.includes("**/.opencode/agents/**"),
    "opencode mirror must remain ignored (regenerated on every PUT)",
  );
});

test("pre-existing runtime ignores are intact", () => {
  const ignored = readIgnoredPatterns();
  for (const must of [
    "**/.hydra/**",
    "**/.worktrees/**",
    "**/.agents/**",
    "**/.termcanvas/**",
  ]) {
    assert.ok(
      ignored.includes(must),
      must + " must remain in server.watch.ignored",
    );
  }
});
