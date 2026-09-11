# WarpPanel QA Report (T04, mock-first) — Round 1

Date: 2026-09-06. Scope: `src/features/warpPanel/` (T01–T03 output) + `~src/App.tsx` mount.
Design source: `software-warppanel/DESIGN-warppanel.md`. Figma reference: `figma/Crear panel lateral interactivo/`.
Constraints honored: explicit timeouts on every command, `-Encoding utf8` on file writes, daemon on
port 17680 / restarts / `taskkill` / repo `pnpm dev`/`build` never touched.

## Verdict: PASS (static + code audit) — live-visual BLOCKED, V1–V8 pending

All 7 mandated static checks are green and the §5 best-practices audit is clean (two Figma-faithful
observations, zero src bugs). Per the routing rule (assertion expects PRD/design behavior and gets it),
there is nothing to send to the Engineer. The live-visual pass (V1–V8) could not run: the user renderer
on `localhost:5173` refused connection and starting it is out of scope for this task. This PASS covers
static + audit only; do NOT treat it as visual approval against Figma.

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean | PASS — 0 errors, 0 warnings from warpPanel files |
| S2 | Zero `fetch` / IPC (`window.termcanvas`, `ipcRenderer`, `postMessage`) in `components/` | PASS — 0 code hits |
| S3 | Zero unprefixed `var(--*)` (must be `var(--wp-*)`) outside comments | PASS — 7 grep hits, all inside `*`-comments (`ActivityPanel.tsx:26`, `AgentConfig.tsx:10`, `AgentsPanel.tsx:10`, `IssueDrawer.tsx:17`, `KanbanBoard.tsx:15`, `WarpSidePanel.tsx:20`, `tokens.css:9`); 0 in code |
| S4 | Zero `components/` → `adapters/` imports | PASS — 2 grep hits, both comment-only (`ActivityPanel.tsx:121`, `KanbanBoard.tsx:23`); 0 import statements |
| S5 | `ViewMode` defined once in `types.ts`, never redefined, never imported from `KanbanBoard` | PASS — single definition `types.ts:27`; `ActivityPanel.tsx:2-8` and `KanbanBoard.tsx:2-7` both import it from `../types` |
| S6 | Dead `IssuesPanel` not ported | PASS — 0 references to `IssuesPanel` anywhere under `src/`; its types live in `types.ts` as designed |
| S7 | Zero `.png` / `src/imports/` weight | PASS — 0 matches under `src/features/warpPanel/` |

Dataset counts (done-criteria, §4): 12 kanban issues (`mockIssues.ts`, 5 columns
`backlog/ready/in-progress/in-review/done`), 10 activity issues (`mockActivity.ts`, `COLUMNS` +
`PHASE_LABELS` + `AWAITING_LABELS` present), 1 foreman + 4 sub-agents (`mockAgents.ts`,
`FOREMAN` + `SUB_AGENTS` + `AGENT_CONFIGS` present). `warpIcons.tsx` exports 16 icon functions —
matches the Figma `icons.tsx` export count exactly (16); the design doc's "15" is a doc typo, not a drift.

## 2. Best-practices audit vs DESIGN §5 (file:line or clean)

| Rule | Result |
|------|--------|
| Components never fetch; data via props, lives in `hooks/` + `adapters/` | clean — S2/S4 green; shell feeds `KanbanBoard` via `useIssues` (`WarpPanelShell.tsx:32,68-73`); `ActivityPanel`/`AgentsPanel` self-sufficient on `useActivity`/`useAgents` with optional prop overrides |
| Pure components + props | clean — rendering derives from props + explicitly local UI state only |
| Colocated state | clean — `hov` per card (`KanbanBoard.tsx:255,434`), section `open` (`KanbanBoard.tsx:904`), `viewMode`/`draggingId`/`overCol` board-local (`KanbanBoard.tsx:1062-1064`), drawer-mount-at-shell documented in `WarpPanelShell.tsx:19-23` (visually identical to Figma), `MOCK_REPOS` + picker index local to `WarpSidePanel.tsx:40-60` |
| Composition over prop-drilling (max 1 intermediate) | clean — shell → panels → rows/cards; `AgentsPanel` contract is flat (`AgentsPanel.tsx:22-31`) |
| Data hooks with default mock injection | clean — `useIssues(adapter = mockIssuesAdapter)` (`useIssues.ts:18-20`), `useActivity` (`useActivity.ts:16-18`), `useAgents` (`useAgents.ts:25-27`) |
| `memo`/`useMemo`/`useCallback` only with measurement | clean — 0 usages anywhere in the feature |
| A11y 1:1 (labels, expanded/selected/current, roles, keyboard, focus ring) | clean with 1 faithful obs — Escape closes drawer (`IssueDrawer.tsx:295`), detail (`ActivityPanel.tsx:446`), modals (`AgentConfig.tsx:102`); tabs `role="tablist"`/`role="tab"` + `aria-selected` (`AgentConfig.tsx:214-219`); icon-only buttons carry `aria-label` + `title`; host toggle has `aria-pressed` (`src/toolbar/Toolbar.tsx:159`); `:focus-visible` ring scoped (tokens.css). OBS-1 (not a bug): view-toggle icon buttons lack `aria-pressed` (`KanbanBoard.tsx:140-142`, `ActivityPanel.tsx:255-257`) — verified Figma-identical (Figma `KanbanBoard.tsx:118-122`, `ActivityPanel.tsx:204-208` also omit it); adding it would break 1:1 fidelity, proposed for the wiring phase |
| Timers with cleanup; rAF cancelled | clean with 1 faithful obs — `closeTimer` + unmount clear (`ActivityPanel.tsx:414,435-460`), toast timer + unmount clear (`AgentConfig.tsx:526,537-556`), rAF cancel (`IssueDrawer.tsx:288-289`), keydown listeners removed (`ActivityPanel.tsx:449`, `IssueDrawer.tsx:298`, `AgentConfig.tsx:105`). OBS-2 (not a bug): `IssueDrawer.tsx:304` `setTimeout(onClose, ANIM_MS)` has no ref/cleanup — verified Figma-verbatim (Figma `IssueDrawer.tsx:102` identical); exit path still unmounts correctly |
| No host leakage (`--wp-*`, `.warppanel` scoping, single `tokens.css` import) | clean — S3 green; no bare `:root`/`body`/`html` selectors in `tokens.css`; imported once via `WarpPanelShell.tsx:2` (not `main.tsx`); host mount is a factoryLab-style branch (`src/App.tsx:482-484`) |
| Inline-style fidelity (no class rewrites, no color/timing rounding) | clean — `120ms`/`220ms`/`ANIM_MS`/`DETAIL_MS` timings present in every component; filter input uncontrolled/decorative (`KanbanBoard.tsx:1121-1144`, O-4) |

## 3. Closed-file-list notes (no routing — permitted or cosmetic)

- `warpPanelStore.ts` (zustand, 44 lines, `localStorage` persistence) is not in the §2 list, but §1.2
  explicitly allows "a 20-line zustand store next to it" as the visibility-state option. Accepted.
- `src/toolbar/Toolbar.tsx` Warp toggle (`data-warp-panel-trigger`, `aria-pressed`, `WarpPanelIcon`)
  is not in the §2 list (only `~src/App.tsx` is), but it is the O-5 toggle affordance T04 needs to reach
  the panel. Accepted as T04 scope; no code issue.
- `MOCK_REPOS` lives in `WarpSidePanel.tsx:40` instead of `mockAgents.ts` (the §1.1 table names it among
  mock datasets, though §2 item 6 lists only foreman/sub-agents/configs). Colocation with the local
  picker state is sound; cosmetic doc drift only.
- `src/App.tsx` Warp hunk is correct; the same diff also carries the unrelated FactoryLab branch
  (other track, same file) — not Warp's defect.

## 4. Live-visual pass (V1–V8): BLOCKED — environment, not code

- Probe: `Invoke-WebRequest http://localhost:5173/ -TimeoutSec 15` → connection refused
  ("No es posible conectar con el servidor remoto"). Renderer is down; per task constraints nothing was
  started, restarted, or killed.
- Playwright navigation (Warp toggle), screenshots (issues / activity / agents / card-hover /
  open-drawer), and Figma side-by-side comparison: NOT RUN. Zero screenshots captured, zero invented.
- Figma could not be executed either, so no honest visible-diff claims are made.
- To unblock: bring up the user renderer, then capture V1–V8 per DESIGN §6 (100% zoom, same viewport,
  dark room) including hover (`#1c1c1c` + `#333` border), drag ghost (dashed, 0.35 opacity), drawer
  (backdrop dim, 220ms `cubic-bezier(0.32,0.72,0,1)`, Escape/backdrop close), and reduced-motion re-check.

## 5. Test rounds / routing

- Round 1 (this report): static suite + audit executed, 0 src failures, 0 test-code failures
  (no repo test files were created — verification is grep/`tsc`/review-based per the task's checklist).
- Routing decision: **NoOne** (nothing to send to the Engineer; no self-fix needed). No Round 2 required.
- Known issues: none in source. Pending work (not defects): V1–V8 visual approval once the renderer is up;
  optional wiring-phase `aria-pressed` on the two `ViewToggle` buttons (would intentionally diverge from Figma).

## Screenshots (Round 1)

None — was blocked (see §4). No paths to report; no placeholders fabricated.

---

# WarpPanel QA Report (T04, mock-first) — Round 2: Live-visual pass V1–V8

Date: 2026-09-06. Renderer: `http://localhost:5173/` → `200 OK` (`Invoke-WebRequest -TimeoutSec 15`).
Method: Playwright MCP on the user-raised renderer. Warp enabled via `localStorage`
`warp-panel-active=true` + `factory-lab-active=false` + reload (bypasses the pre-existing host
canvas crash; no daemon/port 17680, restart, `taskkill`, or `pnpm dev`/`build` touched).
Figma compared as static source only (`figma/Crear panel lateral interactivo/src/`, dev server never run).

## V1–V8 results

| # | Check | Result + path |
|---|-------|---------------|
| V1 | Issues / kanban board | PASS — `software-warppanel/V1-issues-kanban.png` (72 KB). 5 columns (`Backlog/Ready/In progress/In review/Done`), 12 cards, filter input, `Columns` pressed state, `Add item` footers, horizontal scroll. Dark theme intact. |
| V2 | Drawer open (click 1 card, `#23`) | PASS — `software-warppanel/V2-drawer-open.png` (68 KB). Title `#23`, `Open` pill, repo `FrancoManfredi/term-canvas Private`, author line, body bullets, right rail `Assignees/Labels/Status=Backlog/Priority P1/Relationships`. Escape closes (verified before V3). |
| V3 | Hover on 1 card (`#27`, hover + screenshot) | PASS — `software-warppanel/V3-card-hover.png` (73 KB). No accidental navigation, no flicker; hover delta is subtle by design (`#1c1c1c` + `#333` border) and not clearly distinguishable in a compressed screenshot, which is expected. |
| V4 | Activity | PASS — `software-warppanel/V4-activity.png` (80 KB). Sections `Pending (3) / In Progress (2) / Awaiting You (3) / Done (2)`, pills `AGENT WORKING`, `YOUR TURN`, `Implementing`, `Implementing Fix`, `Merge PR`, `Review Issue`. 10 issues total. |
| V5 | Agents | PASS — `software-warppanel/V5-agents.png` (70 KB). 1 foreman + 4 sub-agents (`Triage/Spec/Implement/Review`) + `New agent`, dashed tree connectors, `Search/Filter/New` header. |
| V6 | Agent config (click 1 agent, Foreman) | PASS — `software-warppanel/V6-agent-config.png` (60 KB). `Settings/Automations` tabs, description text, `MCPs GitHub/Linear`, masked `GITHUB_TOKEN` / `LINEAR_API_KEY`, `Harness=Warp`, `Model`/`Runner`/`Host` combos, prompt body. |
| V7 | Toggle back to canvas (returns) | PASS (toggle behavior) — `software-warppanel/V7-back-to-canvas.png` (26 KB). Clicking `Close Warp Panel` unmounts Warp and returns to the canvas branch, which then shows the pre-existing host crash (`XyFlowCanvas.tsx:1165 reading 'github'`, `PinDrawer.tsx:357 reading 'pins'`). Host bug is unrelated to Warp; the toggle itself works both directions (canvas→Warp verified on entry via toolbar `aria-pressed`). |
| V8 | Responsive narrow (700×800, 1 of 2 options) | PASS — `software-warppanel/V8-narrow-700px.png` (63 KB). No overlap or page-level horizontal break; sidebar stays usable, description text wraps to two lines, `Harness`/`Model` selects intact. Reduced-motion not re-run; `tokens.css` `prefers-reduced-motion` guard was already audited clean in Round 1. |

## Figma comparison (honest diffs)

- Layout, dark tokens, column structure, drawer fields, activity pills, agent tree, and config
  sections match the Figma static source 1:1 at the values level (timings `120ms`/`220ms`,
  `cubic-bezier(0.32,0.72,0,1)` already verified in code; 16 icons; dataset counts 12/10/1+4).
- Expected host-embedding differences (not defects): TermCanvas top toolbar
  (`Untitled Workspace`, Warp toggle `aria-pressed`) and bottom-left `connected` dot surround
  the panel; Figma standalone chrome is absent.
- Expected mock adaptation (not a defect): issue titles are `term-canvas #N` domain mocks;
  counts and column splits match the design datasets.
- Intentional constraint diff (not a defect): zero PNG weight — avatars are initials, not the
  Figma `imports/*.png` files, per S7.
- No invented diffs: no color/timing rounding claims beyond what screenshots + code show.

## Visual verdict: PASS

All 8 live-visual checks pass. Zero Warp source bugs found; nothing to route to the Engineer.
Known non-Warp issue (pre-existing, out of scope): host canvas branch crashes without Warp
(`XyFlowCanvas` `github`, `PinDrawer` `pins` undefined) — visible only in V7 after Warp
unmounts; Warp itself never crashes across V1–V6 + V8.

## Test rounds / routing

- Round 2 (this addendum): V1–V8 executed live, 8/8 PASS, 8 screenshots captured.
- Routing decision: **NoOne**. No Round 3 needed.

---

# WarpPanel QA Report — Round 3: LiveIssues wiring (real canvas issues)

Date: 2026-09-06. Scope: `src/features/warpPanel/adapters/liveIssues.ts` (derivation table) +
`tests/warp-live-issues.test.ts` + live Warp panel vs canvas issues on user renderer.
Constraints honored: explicit timeouts on every command, file write with `-Encoding utf8`,
no daemon / restart / `taskkill` / repo `pnpm dev` / `build` touched.

## Verdict: PASS (static 4/4 + live honest-empty PASS) — nothing to route to Engineer

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, 0 errors (timeout 180s) |
| S2 | `tests/warp-live-issues` 12/12 | PASS — `npx tsx --test tests/warp-live-issues.test.ts`: 12 pass, 0 fail (timeout 120s) |
| S3 | Zero new GitHub fetch in `warpPanel/` | PASS — `rg "fetch\(|XMLHttpRequest|axios|octokit|Octokit" src/features/warpPanel/components/ hooks/ adapters/` = 0 hits; broader `rg "fetch\(|fetchIssues|octokit|/repos/|api.github|graphql" src/features/warpPanel/` = 1 hit, comment-only (`liveIssues.ts:12` doc: canvas hydrates via `fetchIssues`, adapter is thin in-memory read) |
| S4 | Components intact except `types.ts` (`url` optional) | PASS — `rg "from.*adapters|import.*adapters" src/features/warpPanel/components/` = 2 hits, both comment-only (`KanbanBoard.tsx:23`, `ActivityPanel.tsx:121`), 0 import statements; `types.ts:77-78` carries the only permitted delta: `/** GitHub issue URL (live adapter only; the Figma mock omits it). */ url?: string;`; `useIssues.ts:29` defaults to `liveIssuesAdapter`, `WarpPanelShell.tsx:32` calls `useIssues()` with no mock injection |

Derivation table verified in code (`liveIssues.ts:21-29`): override > done (MERGED or bulk-merge run) >
in-progress (reviewing/fixing/merging/resolving-conflict/resolving) > in-review (verdict or OPEN PR) >
backlog; `ready` reachable only via session override; CLOSED-but-unmerged falls through; honest
fields (`author="unknown"`, `openedAgo=""`, `activity=[]`, `repoName` = last path segment) match doc.

## 2. Live checks (renderer `http://localhost:5173/` → `200 OK`, GET timeout 15s)

Method: Playwright MCP on the user-raised renderer. Warp enabled via `localStorage`
`warp-panel-active=true` + `factory-lab-active=false` + reload (same bypass as Round 2 for the
pre-existing host canvas crash `XyFlowCanvas.tsx:1165 reading 'github'`; no daemon/port 17680,
restart, `taskkill`, or `pnpm dev`/`build` touched). Console errors with Warp active: 0.

| # | Check | Result + path |
|---|-------|---------------|
| W1 | Live kanban cards vs canvas issues | PASS — `software-warppanel/W1-live-kanban-wired.png` (36 KB). Panel header `Issues 0`; columns `Backlog 0 / Ready 0 / In progress 0 / In review 0 / Done 0`; DOM `cardCount=0`, `issueRefs=[]`. Canvas side confirms empty source: `0 projects`, `Add project folder…`, `Open a project to use waypoints`, `localStorage` holds only `warp-panel-active` + `factory-lab-active` (no persisted issues). Empty canvas → honest empty panel: PASS per task rule, not FAIL. Refresh-icon button (`KanbanBoard.tsx:1159-1188`, `aria-label="Fetch issues"`) is decorative (hover-only, no `onClick`, no network) — not a new GitHub fetch. |
| W2 | Drawer of 1 real issue | N/A (honest-empty consequence) — 0 cards exist so no drawer can be opened; nothing clicked, nothing fabricated. `hasDrawer` selector only matches the hidden Hub `dialog [aria-hidden]`, not an `IssueDrawer`. No screenshot invented for a non-existent issue. |
| W3 | Derived-status spot-check (PR/review issue) | N/A — canvas has zero issues, so no PR/review signal exists live. Derivation itself is covered statically: 12/12 unit tests including MERGED→done, OPEN/verdict→in-review, active-ops→in-progress, CLOSED-unmerged→backlog, and mixed-board end-to-end. |

## 3. Test rounds / routing

- Round 3 (this addendum): static 4/4 PASS + live W1 PASS / W2–W3 N/A-empty (honest).
- Routing decision: **NoOne** (no `src` failure; no `file:line` to send to Engineer; no test-code fix needed).
- Known issues: none in Warp source. Pre-existing host canvas crash without Warp unchanged (out of scope).

## Screenshots (Round 3)

- `software-warppanel/W1-live-kanban-wired.png` — live wired kanban, honest empty (5×0).
- Drawer screenshot: none — no real issue exists to open (documented N/A, not a gap).

---

# WarpPanel QA Report — Round 4: Fidelity batch (7 user items)

Date: 2026-09-06. Scope: fidelity batch over live adapter + kanban + drawer:
`src/features/warpPanel/adapters/liveIssues.ts`, `components/KanbanBoard.tsx`,
`components/IssueDrawer.tsx`, `types.ts`, `tests/warp-live-issues.test.ts`.
Engineer input read: working-tree implementation (files + decisions in the
`liveIssues.ts` module doc / derivation table) — no separate engineer report
file exists in the repo; decisions verified against code + tests.
Constraints honored: explicit timeouts on every command, no daemon / restart /
`taskkill` / repo `pnpm dev` / `build` touched.

## Verdict: PASS (static 4/4 + live honest-empty PASS + fidelity audit 7/7 clean) — nothing to route to Engineer

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, 0 errors (timeout 180s) |
| S2 | `tests/warp-live-issues` 26/26 | PASS — `npx tsx --test tests/warp-live-issues.test.ts`: 26 pass, 0 fail (timeout 120s) |
| S3 | Zero new deps (marked/dompurify reused) | PASS — `package.json` diff is test-script-only + trailing newline, 0 new dependencies; `marked ^17.0.4` + `dompurify ^3.4.1` pre-existing; drawer uses shared `renderMarkdown` (`src/utils/markdownClass.ts:45`) via `IssueDrawer.tsx:14` |
| S4 | `"unknown"` dead | PASS — literal `"unknown"` / `'unknown'`: 0 hits under `src/features/warpPanel/`; bare `unknown` hits are TS `unknown` types, honest-empty comments, and the pre-existing `mockAgents.ts:361 Unknown agent id` error (unrelated to author) |

## 2. Fidelity audit — 7 user items (file:line or clean)

| # | Item | Result |
|---|------|--------|
| F1 | Kanban dots green/violet per real state | clean — `issueStateDotColor` (`KanbanBoard.tsx:38-40`): CLOSED → `#a371f7`, else `#3fb950`; rendered per card (`KanbanBoard.tsx:336-344`, `title=issueStateLabel`) + compact row (`KanbanBoard.tsx:589-598`); legacy/unknown renders open-green, never inferred closed |
| F2 | Descending order by # | clean — `issues.sort((a, b) => b.number - a.number)` (`liveIssues.ts:405`); covered end-to-end (`tests/warp-live-issues.test.ts:510`) |
| F3 | Drawer markdown rendered | clean — shared marked+DOMPurify `renderMarkdown` (`IssueDrawer.tsx:14,314-317`), sanitized HTML at `IssueDrawer.tsx:829-834`; external links intercepted to the Electron bridge (`IssueDrawer.tsx:321-329`); empty body → honest "No description." (`IssueDrawer.tsx:835-847`) |
| F4 | View on GitHub button | clean — card (`KanbanBoard.tsx:367-412`, stopPropagation, `aria-label`, no-op without url) + drawer (`IssueDrawer.tsx:430-481`); opens via `openIssueInGitHub` Electron bridge (`KanbanBoard.tsx:48-51`), rendered only when `issue.url` is present |
| F5 | Badge Open/Closed real | clean — `issueStateLabel` (`KanbanBoard.tsx:42-44`) + `isClosed` pill (`IssueDrawer.tsx:308,650-679`): open `#14532d/#166534`, closed `#251d42/#553a9c`; driven by `githubState` only, absent → Open (legacy open-only fetch) |
| F6 | Real author | clean — `normalizeAuthor` (`liveIssues.ts:269-275`: login string or `{ login }` object, else `""`) + `authorColorFor` (`liveIssues.ts:293-300`, deterministic palette, `""` → `#6b7280`); drawer avatar + login (`IssueDrawer.tsx:775-806`) |
| F7 | Author row hidden without metadata | clean — `hasAuthorMeta` (`IssueDrawer.tsx:310`) gates the whole row (`IssueDrawer.tsx:766-819`); no fabricated placeholder |

Zero src failures; no `file:line` to send to the Engineer.

## 3. Live checks (renderer `http://localhost:5173/` → `200 OK`, GET timeout 15s)

Method: Playwright MCP on the user-raised renderer. Warp already active
(`warp-panel-active=true`, `factory-lab-active=false` in localStorage; no
daemon/port 17680, restart, `taskkill`, or `pnpm dev`/`build` touched).
Console errors with Warp active: 0.

| # | Check | Result + path |
|---|-------|---------------|
| L1 | Kanban dots + order live | N/A (honest-empty consequence) — `Issues 0`, 5×0 columns, DOM `cardCount=0`; canvas source confirms empty: `0 projects`, `Add project folder…`, localStorage holds only warp flags. Dots/order verified statically (F1–F2 + 26/26 tests); nothing clicked, nothing fabricated. Evidence: `software-warppanel/R4-live-fidelity-kanban.png` (36 KB). |
| L2 | Drawer (markdown + View on GitHub + badge + author) live | N/A — 0 cards exist so no drawer can be opened. Drawer fidelity verified statically (F3–F7); no screenshot invented for a non-existent issue. |

## 4. Test rounds / routing

- Round 4 (this addendum): static 4/4 PASS + fidelity audit 7/7 clean + live L1–L2 N/A-empty (honest, screenshot captured).
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). No further round needed — green on first pass of this batch.
- Known issues: none in Warp source. Pre-existing host canvas crash without Warp unchanged (out of scope, see Round 2 §V7).

## Screenshots (Round 4)

- `software-warppanel/R4-live-fidelity-kanban.png` — live wired kanban, honest empty (5×0), Warp active, 0 console errors.
- Drawer screenshot: none — no real issue exists to open (documented N/A, not a gap).

---

# WarpPanel QA Report — Round 5: Drawer relations + PR + labels

Date: 2026-09-06. Scope: QA of relations + PR + labels in the drawer:
`src/features/warpPanel/components/IssueDrawer.tsx` (new, 2266 lines, untracked),
`src/features/warpPanel/types.ts` (relation/timeline/PR/label shapes),
`src/features/warpPanel/adapters/liveIssues.ts` (mapRelationsFromNode /
mapTimelineFromNode / mapPrsFromNodeAndReview / toIssueLabel reuses),
`tests/warp-live-issues.test.ts` (35 tests).
Engineer input read: working-tree implementation itself (module doc + derivation
table in `liveIssues.ts`, parity comments in `IssueDrawer.tsx:87-90,573-578`) —
no separate engineer report file exists in the repo; files + reuses +
carry-overs verified against code + tests.
Constraints honored: explicit timeouts on every command, no daemon / restart /
`taskkill` / repo `pnpm dev` / `build` touched. Nothing merged, resolved, or
acted upon live — zero workflow buttons clicked.

## Verdict: PASS (static 3/3 + live honest-empty PASS + drawer audit 5/5 clean) — nothing to route to Engineer

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, 0 errors, 0 warnings (timeout 180s) |
| S2 | `tests/warp-live-issues` 35/35 + review suites | PASS — `npx tsx --test tests/warp-live-issues.test.ts`: 35 pass, 0 fail (timeout 120s). Review suites: `review-verdict` + `review-domain` + `review-summary` + `issue-review-store` + `issue-review-worktree` = 91 pass, 0 fail; `review-service` + `review-loop` + `review-hardening` + `review-prompt` + `review-reverify` + `review-reverify-skill` + `review-selector-fallback` + `review-reviewer-ref` + `review-model-selector` + `factory-review-raw` + `skills-review` + `provider-reviewer-table` = 132 pass, 0 fail (timeout 300s each). Total review: 223 pass, 0 fail |
| S3 | Zero duplicated handlers (grep resolveHandler/reviewHandler: drawer calls via stores, never reimplements) | PASS — `rg "(const\|function\|let\|var)\s+(resolveHandler\|reviewHandler\|fixHandler\|mergeHandler\|resolveConflictHandler)" IssueDrawer.tsx` = 0 definitions. All 13 handler-name hits are calls by reference: `useIssueResolveStore.getState().resolveHandler?.(issueNumber)` (`IssueDrawer.tsx:1268`), `useIssueReviewStore.getState().reviewHandler?.(issueNumber[, prNumber])` (`IssueDrawer.tsx:655,1295,1506`), `.mergeHandler?.` (`IssueDrawer.tsx:1341,1584`), `.fixHandler?.` (`IssueDrawer.tsx:1552`), `.resolveConflictHandler?.` (`IssueDrawer.tsx:1566`); `overrideGateForIssue` imported from `../../../canvas/issueGate` (`IssueDrawer.tsx:39`), called once (`IssueDrawer.tsx:649`) |

## 2. Drawer audit — relations + PR + labels + timeline + workflow (file:line or clean)

| # | Item | Result |
|---|------|--------|
| D1 | Relationships (4 canvas groups, real links) | clean — `Relationships` section (`IssueDrawer.tsx:1923-1993`) renders exactly the canvas sidebar groups `Parent / Blocked by / Blocking / Sub-issue` (filter on `rel.label`, `IssueDrawer.tsx:1932-1936`), each row a real link `#{number} {title} · {state}` opening via the shared `openIssueInGitHub(rel.url)` bridge (`IssueDrawer.tsx:1957-1984`), `title` attr carries full title + state; empty → honest `None yet` (`IssueDrawer.tsx:1990-1992`). Shape `KanbanRelation` (`types.ts:73-81`); mapping `mapRelationsFromNode` same sources as canvas `relationCards` (`liveIssues.ts:412`); covered by tests 27–28 + e2e 35 |
| D2 | Timeline (canvas derivation, honest empty) | clean — `Timeline` section with `{n} events` count (`IssueDrawer.tsx:1601-1623`), first 10 events with actor + `TimelineText` kind rendering (`labeled/milestoned/renamed-title/connected/disconnected/cross-referenced`, `IssueDrawer.tsx:269-321`) + `relativeTime` (`IssueDrawer.tsx:92-103`); empty → honest `No timeline events yet.` (`IssueDrawer.tsx:1652-1663`). Label pills reuse `#${labelColor}` canvas convention (`IssueDrawer.tsx:278-290`); mapping `mapTimelineFromNode` (`liveIssues.ts:440`); covered by test 29 + e2e 35 |
| D3 | PRs with real links (rows + Development sidebar) | clean — per-PR rows under `PRs abiertos` (`IssueDrawer.tsx:1380-1599`): state dot (`PrStateDot`, `IssueDrawer.tsx:194-209`, MERGED violet / CLOSED red / else green — same as canvas Development), `#{prNumber} {title}` link via `openIssueInGitHub(pr.url)` (`IssueDrawer.tsx:1437-1452`), live `VerdictBadge` per row (`IssueDrawer.tsx:1454`). `Development` sidebar mirrors the same PRs with verdict + conflict + gate badges (`IssueDrawer.tsx:1995-2126`); legacy `issue.prNumber`-only fallback kept (`IssueDrawer.tsx:2090-2123`). Empty → section absent (`prs.length > 0` guard, `IssueDrawer.tsx:1380`), no fabricated PR. Mapping `mapPrsFromNodeAndReview` with per-PR `labelsByPr[issue][pr] ?? labelsByIssue[issue]` chain (`liveIssues.ts:546-608`); covered by tests 30–32 + e2e 35 |
| D4 | Labels with colors (issue + PR rows) | clean — sidebar `Labels` section renders `issue.labels` pills with real `bg`/`fg` (`IssueDrawer.tsx:1723-1747`); PR rows render live label pills (`IssueDrawer.tsx:1456-1482`). Colors come from `toIssueLabel` matching the canvas `#${color}` convention (`liveIssues.ts`, covered by test 33); empty → honest `None yet` (`IssueDrawer.tsx:1744-1746`), never invented |
| D5 | Workflow buttons (spot-check: enabled/disabled + titles only — nothing clicked, nothing merged) | clean — `Workflow` section (`IssueDrawer.tsx:1234-1378`) same buttons/handlers as the canvas card footer: `Resolver Issue` disabled while any resolve runs (`IssueDrawer.tsx:1262-1274`); `Revisar Solución` disabled when `reviewing \|\| prStatus==null \|\| gate-fail \|\| gate-running` with per-state titles (`El gate de calidad falló…` / `Gate corriendo…` / `Review PR #N`, `IssueDrawer.tsx:1275-1305`); gate-fail reveals `Ver reporte` (on-demand `window.termcanvas.fs.readFile`, same bridge as canvas, `IssueDrawer.tsx:630-645`) + `Revisar igual` (`IssueDrawer.tsx:1306-1329`); `Merge PR` only when APPROVED + OPEN PR (`IssueDrawer.tsx:1330-1348`); per-PR `Revisar/Fix/Resolver conflicto/Merge` gated by `prDisabled` (non-OPEN, gate-fail, gate-running) with honest titles (`IssueDrawer.tsx:1402-1592`). Static spot-check only: all guards reference live store state, no dead/always-on button; zero clicks executed |

Zero src failures; no `file:line` to send to the Engineer.

## 3. Live checks (renderer `http://localhost:5173/` → `200 OK`, GET timeout 15s)

Method: Playwright MCP on the user-raised renderer. Warp enabled via `localStorage`
`warp-panel-active=true` + `factory-lab-active=false` + reload (same bypass as
Rounds 2–4 for the pre-existing host canvas crash; no daemon/port 17680,
restart, `taskkill`, or `pnpm dev`/`build` touched). Console errors with Warp
active: 0. No workflow action executed (no clicks on any button).

| # | Check | Result + path |
|---|-------|---------------|
| L1 | Issues in canvas | Honest empty — panel header `Issues 0`, 5×0 columns, DOM `cardCount=0`, `hasDrawer=false`; canvas source confirms empty: `0 projects`, `Add project folder…`, `Open a project to use waypoints`, localStorage holds only warp flags. Evidence: `software-warppanel/R5-live-empty-kanban.png` (36 KB) |
| L2 | Drawer screenshots (relations, timeline, PRs, labels, workflow) | N/A (honest-empty consequence of L1) — 0 cards exist so no drawer can be opened; nothing clicked, nothing fabricated. All five surfaces verified statically (D1–D5 + 35/35 tests incl. e2e 35); no screenshot invented for a non-existent issue |
| L3 | Spot-check 1 action if safe | N/A live (no drawer open, no buttons rendered) — replaced by static spot-check D5: enabled/disabled + titles verified in code for all six action kinds; merge path additionally guarded to APPROVED + OPEN only |

## 4. Test rounds / routing

- Round 5 (this addendum): static S1–S3 PASS + drawer audit D1–D5 clean + live L1 PASS / L2–L3 N/A-empty (honest, screenshot captured).
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). Green on first pass of this batch — no Round 6.
- Known issues: none in Warp source. Pre-existing host canvas crash without Warp unchanged (out of scope, see Round 2 §V7).

## Screenshots (Round 5)

- `software-warppanel/R5-live-empty-kanban.png` — live wired kanban, honest empty (5×0), Warp active, 0 console errors.
- Drawer screenshots (relations / timeline / PRs / labels / workflow): none — no real issue exists to open (documented N/A, not a gap).

---

# WarpPanel QA Report — Round 6: Activity live wiring (T01+T02) + Relationships restyle

Date: 2026-09-06. Scope: `PLAN-activity-final.md` batch (T01 data layer + T02 reactivity/CTAs/tests) +
Relationships restyle in `src/features/warpPanel/components/IssueDrawer.tsx` vs canvas
`src/canvas/IssueNode.tsx:878-945`.
Engineer input read: working-tree implementation itself (module docs + derivation table in
`activityDerivation.ts` / `liveActivity.ts`, parity comment in `IssueDrawer.tsx:1204-1207`) —
no separate engineer report file exists in the repo; contracts verified against code + tests.
Constraints honored: explicit timeouts on every command, no daemon / restart / `taskkill` /
repo `pnpm dev` / `build` touched. Live: user renderer only, GET probe with `-TimeoutSec 15`.
Zero workflow actions executed live (no Resolve / Review / Merge clicks); safe spot-check was
toolbar refresh only.

## Verdict: PASS (static 8/8 + Relationships audit 5/5 + live honest-empty PASS) — nothing to route to Engineer

## 1. Static checks (PLAN §6 D1–D6 + types)

| # | Check | Result |
|---|-------|--------|
| D1 | `tsc --noEmit` clean (timeout 180s) | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, zero output, zero errors from warpPanel files |
| D2a | `tests/warp-live-activity` ≥20 (timeout 120s) | PASS — `npx tsx --test tests/warp-live-activity.test.ts`: 31 pass, 0 fail (A1–A9 ×9, mapping ×6, guard matrix ×8, invoke wiring ×8) |
| D2b | `tests/warp-live-issues` 35/35 unchanged (timeout 120s) | PASS — 35 pass, 0 fail, intact (incl. relations 27–28, timeline 29, PRs 30–32, labels 33, e2e 35) |
| D3 | Zero new network/IPC in panel surface (timeout 60s) | PASS — `rg "fetch\(|XMLHttpRequest|axios|Octokit|/repos/|api\.github|graphql" src/features/warpPanel/components/ hooks/ adapters/` = 0 hits. `rg "window\.termcanvas" ActivityPanel.tsx activityActions.ts` = 1 hit only: `activityActions.ts:427` (`window.termcanvas.fs.readFile`, gate report on demand). GitHub opens via shared `openIssueInGitHub` helper (`activityActions.ts:11,460`); panel comment `ActivityPanel.tsx:1638` is comment-only |
| D4 | Zero duplicated handlers (timeout 60s) | PASS — `rg "(const|function|let|var)\s+(resolveHandler|reviewHandler|fixHandler|mergeHandler|resolveConflictHandler|prLookupHandler)" ActivityPanel.tsx activityActions.ts useActivity.ts liveActivity.ts activityDerivation.ts` = 0 definitions (calls by reference + `requestPrLookup` only) |
| D5 | Zero new intervals; timers unchanged (timeout 60s) | PASS — `rg "setInterval" src/features/warpPanel/` = 0 hits. `rg "setTimeout" ActivityPanel.tsx` = 1 hit only: `ActivityPanel.tsx:458` (`closeTimer.current = window.setTimeout(...)`, pre-existing DETAIL exit timer region) |
| D6 | Components stay adapter-free (timeout 60s) | PASS — `rg "from.*adapters|import.*adapters" src/features/warpPanel/components/` = 2 hits, both comment-only (`ActivityPanel.tsx:144`, `KanbanBoard.tsx:23`); 0 import statements. Hook owns the seam (`useActivity.ts:4` imports `liveActivityAdapter`; `useActivity.ts:36` defaults `adapter = liveActivityAdapter`) |
| T | `types.ts` delta is `url` + `worktreePath` only | PASS — `Issue` gains exactly two OPTIONAL fields: `url?: string` (`types.ts:216`) + `worktreePath?: string` (`types.ts:221`); no other `Issue` change. (`KanbanIssue.url`/`worktreePath` at `types.ts:133,154` are prior-round precedent, untouched.) `package.json` diff is test-script-only + trailing newline, 0 new dependencies |

Wiring spot-check (static, no clicks): `ActivityPanel.tsx:39-40` imports
`describeActivityActions` + `invokeActivityAction`; rows call `describe...` (`ActivityPanel.tsx:1201`)
and `void invokeActivityAction(...)` (`ActivityPanel.tsx:1246`); `MergeProgressBlock`
(`ActivityPanel.tsx:2060-2113`, max 6 log lines + per-PR dots) renders only when the
`mergeProgress` slice references the issue's PRs (`ActivityPanel.tsx:2066`), read-only.

## 2. Relationships restyle audit — drawer vs `IssueNode.tsx:878-945` (file:line or clean)

| # | Item | Result |
|---|------|--------|
| R1 | Header | clean — canvas `Relationships` (`IssueNode.tsx:881`, `font-semibold text-[#c9d1d9] text-xs block mb-2`): drawer replicates exactly (`IssueDrawer.tsx:1215-1226`: 12px/600/`#c9d1d9`/block/marginBottom 8; text-xs=12px, mb-2=8px) |
| R2 | 4 groups always visible with em-dash | clean — same array (`IssueNode.tsx:883` / `IssueDrawer.tsx:1235`: `Parent / Blocked by / Blocking / Sub-issue`), same group label (11px/600/`#8b949e`, mb 6 = mb-1.5; `IssueNode.tsx:887` / `IssueDrawer.tsx:1240-1251`); empty → honest `—` (11px/`#8b949e`/pl 4 = pl-1; `IssueNode.tsx:939` / `IssueDrawer.tsx:1449-1458`) |
| R3 | Cards border/radius/padding/bg | clean — `border #30363d / radius 6 (rounded-md) / padding 8 (p-2) / bg #010409 / flex-start / gap 8 (gap-2)` identical (`IssueNode.tsx:894` / `IssueDrawer.tsx:1268-1279`); icon box 24×24 shrink-0 (`IssueNode.tsx:895` / `IssueDrawer.tsx:1280-1286`) |
| R4 | State icons | clean — CLOSED → violet check `#8957E5` (`IssueNode.tsx:896-900` / `IssueDrawer.tsx:1287-1308`, same circle+check paths); blocking → green + red-minus badge (`IssueNode.tsx:903-912` / `IssueDrawer.tsx:1309-1347`); blocked-by → red (`IssueNode.tsx:913-918` / `IssueDrawer.tsx:1348-1368`); default → green (`IssueNode.tsx:919-924` / `IssueDrawer.tsx:1369-1389`). Drawer keys icon off `kind`/`label` (`IssueDrawer.tsx:1261-1266`) vs canvas `rc.icon` (`IssueNode.tsx:891-892`) — equivalent mapping, covered by tests 27–28 |
| R5 | Links without underline | clean — 12px/600/`#c9d1d9`, `no-underline`, hover shifts to `#58a6ff` only (`IssueNode.tsx:929` Tailwind / `IssueDrawer.tsx:1400-1433` inline + `onMouseEnter/Leave` `IssueDrawer.tsx:1407-1416`); ellipsis/nowrap kept. Drawer adds `title` with full title + state (`IssueDrawer.tsx:1430`) — improvement, not divergence; opens via shared `openIssueInGitHub` bridge (`IssueDrawer.tsx:1402-1406`), same family as canvas `openUrl` |

Zero src failures; no `file:line` to send to the Engineer. Live drawer screenshot: none possible
(see §3 L2 — 0 cards, documented N/A per task rule "screenshot si hay issues").

## 3. Live checks (renderer `http://localhost:5173/` → `200 OK`, GET `-TimeoutSec 15`)

Method: Playwright on the user-raised renderer (nothing started/restarted/killed). Warp already
active from prior rounds; clicked `Activity` nav (`e71`). Console errors with Warp active: 0.
No Resolve / Review / Merge ever clicked (none rendered in honest-empty state).

| # | Check | Result + path |
|---|-------|---------------|
| A1 | Activity section with real data | PASS (honest-empty per §8-D9 / R3–R5 precedent) — header `Activity 0`; `Pending 0 / In Progress 0 (AGENT WORKING) / Awaiting You 0 (YOUR TURN) / Done 0`, each `No issues`; canvas source confirms empty: Hub `0 projects`, `Add project folder…`, `Open a project to use waypoints`. Evidence: `software-warppanel/R6-activity-live.png` (36 KB) |
| A2 | Detail with CTAs + merge-progress | N/A (honest-empty consequence of A1) — 0 rows exist so no detail can be opened and no `mergeProgress` references any PR; nothing clicked, nothing fabricated. Detail CTA matrix covered statically (§1 D2a guard/invoke tests); merge block verified in code (`ActivityPanel.tsx:1635-1636,2060-2113`) |
| A3 | Narrow 700px | PASS — resized 700×800: no overlap, no page-level horizontal break; pills (`AGENT WORKING`, `YOUR TURN`) and counts intact. Evidence: `software-warppanel/R6-activity-narrow-700px.png` (36 KB) |
| S | Safe spot-check: toolbar refresh | PASS (safe only) — clicked `Fetch latest issues` (`e243`): button entered `[active]` state, panel stayed 4×0 honest-empty, 0 console errors, zero workflow side effects. Spinner binding verified in code: `onClick={refresh}` + `busy={isFetching}` + `spin-icon` class (`ActivityPanel.tsx:549-556`) over `isFetchingIssues` (`useActivity.ts:17-18,67,137`); transient spinner not capturable on an empty canvas with no fetch in flight, which is expected |

## 4. Test rounds / routing

- Round 6 (this addendum): static 8/8 PASS + Relationships 5/5 clean + live A1 PASS / A2 N/A-empty (honest) / A3 PASS / S PASS (safe).
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). Green on first pass — no Round 7 (hard limit is 2 per batch; this batch needed 1).
- Known issues: none in Warp source. Pre-existing host canvas crash without Warp unchanged (out of scope, see Round 2 §V7).

## Screenshots (Round 6)

- `software-warppanel/R6-activity-live.png` — Activity section live, honest empty (4×0 + pills), Warp active, 0 console errors.
- `software-warppanel/R6-activity-narrow-700px.png` — same at 700×800, no overlap / no horizontal break.
- Detail / merge-progress screenshots: none — no real issue exists to open (documented N/A, not a gap).

---

# WarpPanel QA Report — Round 7: Buttons + header fix (3 engineer deliveries)

Date: 2026-09-06. Scope: engineer fix batch — (D1) `src/App.tsx` keep-canvas-mounted
hidden wrapper, (D2) `WarpSidePanel` honest header (project name / "No project", no
owner/repo slug), (D3) buttons path (Toolbar Warp toggle + ActivityPanel refresh wired;
Kanban refresh stays decorative per Round 3).
Constraints honored: explicit timeouts on every command, no daemon / restart / `taskkill` /
repo `pnpm dev` / `build` touched (user renderer only navigated). The 15 GitHub issues
were never touched — zero reads/writes, zero workflow clicks.

## Verdict: FAIL (static 6/6 PASS, live BLOCKED by pre-existing host crash now propagated into the Warp branch) — routed to Engineer (Round 1 of this batch)

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean (timeout 180s) | PASS — EXIT 0, zero output |
| S2 | warp suites 66/66 (timeout 180s) | PASS — `tests/warp-live-issues.test.ts` + `tests/warp-live-activity.test.ts`: 66 pass, 0 fail |
| S3 | `App.tsx` mounts canvas hidden, never unmounts, with panel active | PASS — `src/App.tsx:482-502`: `warpPanelActive` branch renders hidden wrapper (`style={{ display: "none" }}`, `aria-hidden="true"`, `LeftPanel/RightPanel/CanvasRoot/BottomToolbar`) + fixed `Warp Panel` div with `WarpPanelShell`; rationale comment `App.tsx:484-493` (handler cleanup on unmount = dead buttons) |
| S4 | Header without owner/repo slug | PASS — `WarpSidePanel.tsx:67-86` resolves names from `useProjectStore` by `projectId`, `activeName` fallback `"No project"`, picker empty `"No projects on canvas"` (`WarpSidePanel.tsx:303-313`); `rg FrancoManfredi` over `components/ hooks/ WarpPanelShell.tsx types.ts warpPanelStore.ts` = 0 hits (only repo-wide hits are the `mockIssues.ts` mock dataset, never header surface); `rg MOCK_REPOS\|term-canvas slug` in live adapters + `WarpSidePanel` = 0 hits |
| S5 | Buttons entry path (toggle + refresh) | PASS — Toolbar Warp toggle: `data-warp-panel-trigger`, `aria-pressed`, `onClick={toggleWarpPanel}` (`Toolbar.tsx` hunks `@@ +125/+147`); ActivityPanel refresh `onClick={refresh}` + `busy={isFetching}` (`ActivityPanel.tsx:547-556`); Kanban `Fetch issues` still decorative, no `onClick` (`KanbanBoard.tsx:1338-1367`) — pre-existing, documented Round 3, not a regression |
| S6 | GitHub issues untouched | PASS — no `gh` calls, no issue mutations, zero workflow-button clicks this round |

## 2. Live checks (renderer `http://localhost:5173/` → `200 OK`, GET `-TimeoutSec 15`)

Method: Playwright on the user-raised renderer (nothing started/restarted/killed).
Panel enabled via `localStorage warp-panel-active=true + factory-lab-active=false` + reload
(same bypass as Rounds 2–6). Console errors with Warp active: 8 (all host, see below).

| # | Check | Result + path |
|---|-------|---------------|
| L1 | Activate panel, canvas stays in DOM hidden (`display:none`) | BLOCKED — app-level `ErrorBoundary` replaces the whole tree: `[aria-label="Warp Panel"]` absent, `display:none` divs 0, body `Something went wrong / reading 'github'`. Evidence: `software-warppanel/R7-panel-blocked-crash.png` (24 KB) |
| L2 | Header shows project name or honest "No project" (no slug) | BLOCKED (same cause) — header never renders live; verified statically (S4) |
| L3 | Buttons alive (toggle / panel nav) | BLOCKED (same cause) — nothing clickable renders; zero workflow clicks executed |

Root cause (host, pre-existing, now coupled): the web renderer has no Electron IPC
(`window.termcanvas` undefined) → `PinDrawer.tsx:357` reading `pins` +
`XyFlowCanvas` reading `github` throw on mount → the App-level `ErrorBoundary`
unmounts everything. Counter-proof: the `warp-panel-active=false` branch crashes
identically (same 8 console errors), so the crash is independent of the fix; but D1
(keep-mounted) now propagates it into the Warp branch, where Rounds 2–6 (unmounted
canvas) rendered fine. In production Electron (`window.termcanvas` present) the fix
path is sound by code reasoning — not verified live here.

## 3. Test rounds / routing

- Round 7 (this addendum, Round 1 of the fix batch): static 6/6 PASS + live L1–L3 BLOCKED (host crash, evidence captured, nothing fabricated).
- Routing decision: **Engineer (Alex)** — suggested scope: isolate the hidden canvas
  behind an error boundary (or keep it mounted only when `window.termcanvas` exists)
  so a host crash cannot take down the Warp branch in the web renderer. Warp files
  themselves need no changes (static 6/6 green, zero `file:line` defects inside
  `src/features/warpPanel/`). Re-verify live in Round 8 after the fix.
- Known issues: host empty-state crash in the web renderer (`PinDrawer` `pins`,
  `XyFlowCanvas` `github`) — pre-existing since Round 2, still open, now Warp-visible.

## Screenshots (Round 7)

- `software-warppanel/R7-panel-blocked-crash.png` — Warp-active branch blocked by the host `ErrorBoundary` (honest evidence, not a pass).

---

# WarpPanel QA Report — Round 8: Re-verify Round 7 after boundary + gate

Date: 2026-09-06. Scope: re-verification of Round 7 L1–L3 after the engineer
fix — `src/features/warpPanel/HiddenCanvasBoundary.tsx` (new, 46 lines) +
`src/App.tsx` `hasHostBridge` gate (`window.termcanvas`).
Constraints honored: explicit timeouts on every command, no daemon / restart /
`taskkill` / repo `pnpm dev` / `build` touched (user renderer only navigated).
The 15 GitHub issues were never touched — zero reads/writes, zero workflow
clicks (Issues/Activity/Agents nav only).

## Verdict: PASS (static 3/3 + live L1–L3 PASS) — final verdict for the fix batch

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean (timeout 180s) | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, zero output |
| S2 | warp suites 66/66 (timeout 180s) | PASS — `npx tsx --test tests/warp-live-issues.test.ts tests/warp-live-activity.test.ts`: 66 pass, 0 fail |
| S3 | `App.tsx` with boundary + gate (timeout 60s) | PASS — import `HiddenCanvasBoundary` (`App.tsx:41`); `hasHostBridge` gate on `window.termcanvas` (`App.tsx:478-480`); hidden tree mounted only when the bridge exists (`App.tsx:505-513`, `{hasHostBridge ? (<HiddenCanvasBoundary>…</HiddenCanvasBoundary>) : null}`) with rationale comment (`App.tsx:484-493`, `501-503`); boundary fallback is null with `console.error` diagnostics (`HiddenCanvasBoundary.tsx:30-45`). Header surface unchanged: `activeName` fallback `"No project"` (`WarpSidePanel.tsx:86`), picker empty `"No projects on canvas"` (`WarpSidePanel.tsx:312`), 0 `FrancoManfredi` hits in `WarpSidePanel.tsx` |

## 2. Live checks (renderer `http://localhost:5173/` → `200 OK`, GET `-TimeoutSec 15`)

Method: Playwright on the user-raised renderer (nothing started/restarted/killed).
Panel enabled via `localStorage warp-panel-active=true + factory-lab-active=false`
+ reload (same bypass as Rounds 2–7). Console errors with Warp active: 0
(down from 8 in Round 7 — the host crash no longer reaches the Warp branch).

| # | Check (Round 7 L1–L3) | Result + path |
|---|------------------------|---------------|
| L1 | Panel renders; canvas NOT mounted without bridge (expected) or mounted hidden without breaking anything | PASS — `[aria-label="Warp Panel"]` present, app `ErrorBoundary` absent (`Something went wrong` not in body), `window.termcanvas` undefined (web renderer), `display:none` divs 0 (gate correctly skips the hidden tree without the bridge). Evidence: `software-warppanel/R8-panel-issues.png` (36 KB) |
| L2 | Header shows project name or honest "No project" (no owner/repo slug) | PASS — header `No project` (`Toggle repository section`), picker `Switch repository` intact; DOM `headerHasSlug=false` (no `FrancoManfredi` / `term-canvas Private` in panel text); canvas source confirms empty (`0 projects`, `Add project folder…`, `Open a project to use waypoints`). Static backstop: `WarpSidePanel.tsx:86,312` (see S3) |
| L3 | Buttons alive (toggle / panel nav) | PASS — toolbar `Close Warp Panel` pressed state; nav `Issues → Activity → Agents → Issues` all render: kanban `Issues 0` 5×0, Activity `Activity 0` 4×0 with `AGENT WORKING` / `YOUR TURN` pills + `Fetch latest issues`, Agents foreman + 4 sub-agents + `New agent`. Zero workflow clicks executed (no Resolve / Review / Merge rendered in honest-empty state). Evidence: `software-warppanel/R8-panel-activity.png` (36 KB) |

## 3. Test rounds / routing

- Round 8 (this addendum, Round 2 of the fix batch): static 3/3 PASS + live L1–L3 PASS, 2 screenshots captured, 0 console errors.
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). Fix batch closed — no further round.
- Known issues: none in Warp source. Pre-existing host canvas crash without Warp
  remains open but is now fully decoupled: the Warp branch renders cleanly in the
  web renderer because the hidden tree is gated + isolated; production Electron
  (`window.termcanvas` present) keeps the keep-mounted handler path behind the boundary.

## Screenshots (Round 8)

- `software-warppanel/R8-panel-issues.png` — Warp panel live post-fix, honest empty kanban (5×0), `No project` header, 0 console errors.
- `software-warppanel/R8-panel-activity.png` — Activity section live post-fix (`Activity 0`, 4×0 + pills), same session, 0 console errors.

---

# WarpPanel QA Report — Round 9: Activity batch (static-only, Playwright paused per user order)

Date: 2026-09-06. Scope: activity batch — `src/features/warpPanel/adapters/activityDerivation.ts` (membership table + mapping), `src/features/warpPanel/adapters/liveActivity.ts`, `src/features/warpPanel/components/ActivityPanel.tsx` (markdown + gate wiring), `src/features/warpPanel/components/activityActions.ts` (CTA state machine + gate), `src/features/warpPanel/adapters/liveIssues.ts` (shared `resolveBlockedGate`/`blockedByTitle`), `src/canvas/IssueNode.tsx` (canvas gate), `src/skills/registry.ts` (`categoryIdFromLabels`), `src/utils/markdownClass.ts` (shared renderer), plus suites `warp-live-activity` + `warp-live-issues` + `specialized-skills` + `derive-audit-labels` + `review-verdict` + `markdown-class`.
Constraints honored: explicit timeouts on every command (`tsc` 180s, suites 300s, greps 60s), file append with `-Encoding utf8`, no daemon / restart / `taskkill` / repo `pnpm dev` / `build` touched, ZERO Playwright (static-only; user sends screenshots).

## Verdict: PASS (static 7/7) — nothing to route to Engineer

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean (timeout 180s) | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, zero output |
| S2 | Suites `warp-live-activity` + `warp-live-issues` + `specialized-skills` + `derive-audit-labels` + `review-verdict` + `markdown-class` (timeout 300s) | PASS — 122 pass, 0 fail total: `warp-live-activity` 38/38, `warp-live-issues` 39/39, `specialized-skills` 9/9, `derive-audit-labels` 7/7, `review-verdict` 23/23, `markdown-class` 6/6 (`npx tsx --test` on all six files; per-suite counts via individual runs) |
| S3 | Zero new deps in `package.json` (timeout 60s) | PASS — `git diff -- package.json` is test-script-only + trailing newline (1 file, 2 insertions, 1 deletion on the `test` script line); 0 changes under `dependencies`/`devDependencies`; `marked ^17.0.4` + `dompurify ^3.4.1` + `@types/dompurify` pre-existing (`package.json:66,70,88`); Activity/Drawer reuse shared `renderMarkdown` (`src/utils/markdownClass.ts:45`) |
| S4 | `categoryIdFromLabels` normalizes non-array (timeout 60s) | PASS — `src/skills/registry.ts:160-176`: `if (!Array.isArray(labels)) return null;` with defensive doc `registry.ts:155-159` (legacy string / null / `{nodes}` / junk → null, never throws; junk entries skipped); covered by `tests/specialized-skills.test.ts:80-92` (string, `{nodes}`, `42`, `null`, `[null,42,{name:7}]`) |
| S5 | Membership table documented in `activityDerivation.ts` (timeout 60s) | PASS — `src/features/warpPanel/adapters/activityDerivation.ts:33-48` first-match-wins table D / I1-I4 / A1-A3 / P with section targets; grounding real cases `activityDerivation.ts:50-60` (#46 fix-aplicado→in-progress/fixing, #44 pendiente→awaiting/review-ready, #1 comentado→awaiting/changes-requested); `effective` + `conflicto:main`/`gate:fallo` notes `activityDerivation.ts:62-69`; pure `deriveActivityStatus` `activityDerivation.ts:215-303` implements the table exactly |
| S6 | `blocked-by` gate in canvas AND panel, same shared rule (timeout 60s) | PASS — shared rule `src/features/warpPanel/adapters/liveIssues.ts:469-482` (`resolveBlockedGate`: only `blockedBy` kind, non-CLOSED blocks, sorted/deduped, non-array → unblocked, never throws) + `liveIssues.ts:489-497` (`blockedByTitle`, honest singular/plural). Canvas: `src/canvas/IssueNode.tsx:21-23` imports rule, `IssueNode.tsx:226-229` comment + `resolveBlockedGate(mapRelationsFromNode(data ?? {}))`. Panel: `src/features/warpPanel/components/activityActions.ts:10-13` imports rule, `activityActions.ts:181-198` gate (disabled resolve + `blockedByTitle`), `src/features/warpPanel/components/ActivityPanel.tsx:46` imports rule, `ActivityPanel.tsx:1228` describe wiring (`blockedByBlockers: resolveBlockedGate(issue.relations).blockers`) + `ActivityPanel.tsx:1276` invoke wiring (same call). Covered by `resolveBlockedGate` tests + activity `describe: resolve refuses while blocked` / `invoke: resolve refuses while blocked`. Note: the two `components/`→`adapters/` pure-helper imports (`activityActions.ts:10-13`, `ActivityPanel.tsx:46`) are the gate requirement itself by design — no store/IPC/fetch introduced; `KanbanBoard.tsx:23` remains comment-only |
| S7 | Markdown in Activity without new fetch (timeout 60s) | PASS — `src/features/warpPanel/components/ActivityPanel.tsx:45` imports shared `renderMarkdown`, `ActivityPanel.tsx:171-173` comment (zero new deps), `ActivityPanel.tsx:1300-1305` `bodyHtml` via `renderMarkdown(issue.body)` (same renderer as drawer `IssueDrawer.tsx:17,479-482`), link interception `ActivityPanel.tsx:1307-1317` via shared `openIssueInGitHub`. `rg "fetch\(|XMLHttpRequest|axios|Octokit|/repos/|api\.github|graphql" ActivityPanel.tsx activityActions.ts activityDerivation.ts liveActivity.ts` = 0 hits; `rg "window.termcanvas" ActivityPanel.tsx activityActions.ts` = 1 hit only `activityActions.ts:471` (`fs.readFile` gate report on demand, pre-existing bridge); `rg "setInterval" src/features/warpPanel/` = 0 hits, `setTimeout` only pre-existing `ActivityPanel.tsx:478` DETAIL exit timer |

Zero src failures; no `file:line` defect to send to the Engineer.

## 2. Live checks

Not run — static-only round per user order (Playwright paused; user sends screenshots). Zero screenshots captured, zero invented.

## 3. Test rounds / routing

- Round 9 (this addendum): static 7/7 PASS on first pass of this batch.
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). No Round 10 needed.
- Known issues: none in Warp source. Pre-existing host canvas crash without Warp remains decoupled behind the Round 8 gate + boundary (out of scope, see Round 8 §3).

## Screenshots (Round 9)

- None — static-only round (see §2). No paths to report; no placeholders fabricated.

---

# WarpPanel QA Report — Round 10: Resolve to factory job (panel pivot, NO terminal)

Date: 2026-09-07. Scope: Resolver to factory-job change — `src/features/warpPanel/adapters/factoryIssueJobs.ts`
(new, 353 lines, renderer half of the `issueRef` link), `src/features/warpPanel/components/activityActions.ts`
(resolve invokes the factory daemon via `src/lib/factoryClient`, describe guards for daemon-down / active-job /
blocked-by), `src/lib/factoryClient.ts` (create + health seams), `headless-runtime/factory/jobs/jobCreate.ts`
(daemon `issueRef` stamp), suites `warp-resolve-factory` (25) + `warp-live-activity` (39).
Engineer input read: working-tree implementation itself (module docs + contracts in
`factoryIssueJobs.ts:1-22`, `activityActions.ts:31-73`, suite contract header
`tests/warp-resolve-factory.test.ts:1-26`) — no separate engineer report file exists in the repo;
files + `issueRef` + live proposal verified against code + tests.
Constraints honored: explicit timeouts on every command (`tsc` 180s, suites 180s, greps 60s,
daemon GETs `-TimeoutSec 15`), ZERO Playwright (paused per order), no daemon / restart / `taskkill` /
repo `pnpm dev` / `build` touched, live budget max 1 job (0 created — see section 2).

## Verdict: PASS (static 4/4 + neighbors green) — live panel-click BLOCKED (environmental, not code) — nothing to route to Engineer

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean, renderer (timeout 180s) | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, zero output |
| S2 | Suites `warp-resolve-factory` 25/25 + `warp-live-activity` 39/39 + neighbors green (timeout 180s each) | PASS — `warp-resolve-factory` 25/25 (prompt 2, repo 1, issueRef 3, active/match 6, client 4, describe 3, invoke 4, derivation 1, daemon 3 — incl. double-click single-create, junk-never-400, byte-identical); `warp-live-activity` 39/39; `warp-live-issues` 39/39; `factory-client-contract` + `jobs-domain` + `review-verdict` 56/56 (19 + 14 + 23) |
| S3 | Zero terminal / opencode-spawn in the panel resolve path (timeout 60s) | PASS — `rg "resolveHandler\|spawn\|opencode\(\|createPty\|openTerminal\|xterm" activityActions.ts factoryIssueJobs.ts` = 0 hits. Remaining `terminal` hits are comment-only (`factoryIssueJobs.ts:6` module doc "instead of opening a canvas terminal", `:45-57/:274` `FACTORY_TERMINAL_*` status-const names, `activityActions.ts:47` doc + `:288` busy-label comment, `factoryClient.ts:1959` unrelated integrations post-back doc) plus the read-only canvas-busy guard (`activityActions.ts:589` `resolvingIssueNumber` read; `ActivityPanel.tsx:1170-1171,1273-1296` same subscription). Resolve invokes factory only — locked by tests 31-32 ("resolve never touches the canvas resolve handler"). Zero new polls/intervals (2.5s poll owned by factoryLab; module owns zero fetches) |
| S4 | Canvas card intact (its terminal flow unchanged) | PASS — `src/canvas/IssueNode.tsx:74-75` `resolvingIssueNumber` subscription, `:643` button disabled guard, `:648` `resolveHandler?.(issueNumber)` (canvas opencode-terminal path), `:650` `Resolviendo... / Resolver Issue` labels — all present, untouched |

Headless note (out of track, pre-existing): `npx tsc --noEmit -p tsconfig.headless.json` reports errors
only outside the Warp path (`electron/memory-service.ts`, `electron/opencode-session.ts`,
`electron/telemetry-service.ts`, `headless-runtime/subprocess-worker.ts`) — pre-existing, not this change.

## 2. Live checks (daemon gate + read-only; 0 jobs created)

- Gate probe: `GET http://127.0.0.1:17680/factory/health` (`-TimeoutSec 15`) → `200 OK`
  (`version local`, `uptime 451414`, queue `pending 65 / running 9`, opencode `healthy`). Daemon UP.
  (First probe `GET /health` → 404: non-canonical path per `factoryDiscovery.ts`; still proved the port listens.)
- Read-only list: `GET /factory/jobs` (`-TimeoutSec 15`) → `200 OK`, 341 jobs
  (head: `Triage/queued`, `Review/running`). Live-read OK, nothing mutated.
- Panel-click verification (Resolve → job created with `issueRef` + row In Progress + 2nd click disabled +
  notify with job id): NOT RUN — BLOCKED, environmental (not code): (a) ZERO Playwright per explicit order,
  so the panel click path cannot be driven; (b) no disposable test-orquestador issue was supplied in the inputs,
  and inventing an `issueRef` against a busy daemon (341 jobs, 65 pending) would fabricate data and add queue
  load. 0 jobs created (jobId: none). The full click contract stays covered offline: invoke-create with stamped
  `issueRef` (test 18), daemon-down / missing-worktree / failed-create refusals (19), busy/active/blocked/invalid
  backstop (20), concurrent double-click single create (21), describe guards daemon-down / active / blocked-wins
  (15-17), derivation to in-progress/implementing (22), daemon stamp / byte-identical / junk-never-400 (23-25).
- Budget: 3 read-only calls used of 8 (2 health + 1 list). No pipeline started or stopped by this QA;
  nothing touched beyond reads.

## 3. Test rounds / routing

- Round 10 (this addendum): static 4/4 PASS + neighbors green + live gate UP with panel-click
  BLOCKED-environmental (0 jobs created, jobId none).
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). Green on first pass of this
  batch — no Round 11 (hard limit is 2 per batch; this batch needed 1).
- Known issues: none in Warp source. Operational note (not a defect): daemon queue loaded
  (65 pending / 9 running, 341 listed) — to run the panel-click live pass, supply one disposable
  test-orquestador issue and re-enable browser driving; create exactly 1 trivial job and report its jobId.

## Screenshots (Round 10)

- None — static + daemon-probe round (Playwright paused). No paths to report; no placeholders fabricated.

---

# WarpPanel QA Report — Round 11: warp-factory-progress (poll + stages + dashboardUrl)

Date: 2026-09-07. Scope: shared 2.5s poll mounted in WarpPanelShell (root cause of pending-never-in-progress), verbatim factory stage lanes Intake→Foreman→Triage→Building→Review→Complete, live session URL pass-through (`job.dashboardUrl`, never synthesized). Constraints: explicit timeouts everywhere, zero writes by QA (this section appended by coordinator), no daemon/restart/dev/build, 0 jobs created, Playwright paused.

## Verdict: PASS (static 4/4 + warp suites 103/103 + warp-factory-progress 15/15 + daemon read-only L1-L3)

## 1. Static checks

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean | PASS — EXIT 0 |
| S2 | `warp-factory-progress` 15/15 + `warp-live-issues` + `warp-live-activity` + `warp-resolve-factory` 103/103 | PASS |
| S3 | Zero new `setInterval` (shared poll refcount in `useWorkItemsPolling.ts`; WarpPanelShell + FactoryLabPage call the same hook) | PASS |
| S4 | View Agent never synthesizes URL from `sessionId` (pass-through of daemon `dashboardUrl` only) | PASS |

## 2. Live checks (read-only)

- L1 `GET /factory/health` → 200 OK, queue pending 65 / running 10.
- L2 `GET /factory/jobs` → 200 OK, 342 jobs, 272 WITH_DASHBOARDURL (full live session URLs).
- L3 Stage distribution matches verbatim lanes (Intake 4 / Foreman 2 / Triage 59 / Building 3 / Review 7 / Complete 252 / Cancelled 15).
- Renderer panel-click path BLOCKED-environmental (renderer down, Playwright paused).

## 3. Routing

- **NoOne** — no defects. Known issues: none in Warp source.

---

# WarpPanel QA Report — Round 12: awaiting-you + polish + View Agent (static-only, Playwright paused)

Date: 2026-09-07. Scope: awaiting-you batch (`src/features/warpPanel/adapters/factoryIssueJobs.ts` human gates H1–H4 + cost passthrough, `src/features/warpPanel/adapters/activityDerivation.ts` rows F-A1–F-A4, `src/features/warpPanel/adapters/liveActivity.ts` adapter wiring, `src/features/warpPanel/components/activityActions.ts` describe/invoke human gates + View Agent session CTA, `src/features/warpPanel/components/ActivityPanel.tsx` awaiting/polish rendering) + suite `tests/warp-factory-awaiting.test.ts` (30).
Engineer input read: working-tree implementation itself (module docs + contracts in `factoryIssueJobs.ts:1-64`, `activityActions.ts:37-59`, derivation table `activityDerivation.ts:39-83`, suite contract header `tests/warp-factory-awaiting.test.ts:1-32`) — no separate engineer report file exists in the repo; files + F-A1–F-A4 table verified against code + tests.
Constraints honored: explicit timeouts on every command (`tsc` 180s, suites 300s, greps 60s), file append with `-Encoding utf8`, no daemon / restart / `taskkill` / repo `pnpm dev` / `build` touched, ZERO Playwright (static-only; no live), 0 jobs created, 0 screenshots invented.

## Verdict: PASS (static 5/5 + F-A1–F-A4 audit 4/4 + View Agent clean) — nothing to route to Engineer

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean (timeout 180s) | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, zero output, 0 errors from warpPanel files |
| S2 | `tests/warp-factory-awaiting` 30/30 + neighbors 118/118 (timeout 300s) | PASS — `npx tsx --test tests/warp-factory-awaiting.test.ts`: 30 pass, 0 fail (H1 3, H2 4, H3 2, H4 3, cost 2, derivation F-A 3, adapter 4, View Agent 1, describe 2, invoke 6). Neighbors `npx tsx --test tests/warp-live-issues.test.ts tests/warp-live-activity.test.ts tests/warp-resolve-factory.test.ts tests/warp-factory-progress.test.ts`: 118 pass, 0 fail (39 + 39 + 25 + 15) |
| S3 | Zero new daemon routes — only existing approve/respond/accept reused (timeout 60s) | PASS — `rg "fetch\(|XMLHttpRequest|axios|Octokit|/repos/|api\.github|graphql" ActivityPanel.tsx activityActions.ts factoryIssueJobs.ts liveActivity.ts activityDerivation.ts` = 0 hits (panel performs zero fetches; H4 reads the injected poll-list notifications). `rg "/factory/|factoryUrl|requestRaw" src/features/warpPanel/` = comment-only (`factoryIssueJobs.ts:5,9,57,874`, `ActivityPanel.tsx:1263`, `activityActions.ts:64,263`) plus the pre-existing Round 10 resolve path. Live seams reuse the pre-existing `factoryClient` routes only: `POST …/spec/approve` (`activityActions.ts:725`, `factoryClient.ts:863-875`), `POST …/triage/respond` (`activityActions.ts:735`, `factoryClient.ts:825-839`), `POST …/review/accept` (`activityActions.ts:746`, `factoryClient.ts:783`), all behind injected `approveSpecJob/respondTriageJob/acceptReviewJob` seams with explicit timeouts (`FACTORY_SPEC_TIMEOUT_MS` / `FACTORY_TRIAGE_TIMEOUT_MS` / `FACTORY_REVIEW_ACTION_TIMEOUT_MS`, `activityActions.ts:7-15`). Module doc states the contract explicitly (`activityActions.ts:49-54`, `factoryIssueJobs.ts:616-617`). No new endpoint, no new poll |
| S4 | Zero new `setInterval`; timers unchanged (timeout 60s) | PASS — `rg "setInterval" src/features/warpPanel/` = 0 hits (shared 2.5s poll stays owned by `useWorkItemsPolling`, unchanged). `rg "setTimeout" src/features/warpPanel/` = 3 pre-existing hits only, all with cleanup and none in the new batch: `ActivityPanel.tsx:522` DETAIL exit `closeTimer`, `AgentConfig.tsx:537` toast timer, `IssueDrawer.tsx:393,524` close timer (`393` ref + `524` pre-existing verbatim path). `factoryIssueJobs.ts` / `activityActions.ts` / `liveActivity.ts` / `activityDerivation.ts` own zero timers |
| S5 | `var(--wp-*)` scoping holds in new/retouched code (timeout 60s) | PASS — `rg --pcre2 "var\(--(?!wp-)" src/features/warpPanel/` = 7 hits, all comment-only parity notes (`WarpSidePanel.tsx:21`, `AgentConfig.tsx:10`, `KanbanBoard.tsx:15`, `AgentsPanel.tsx:10`, `tokens.css:9`, `ActivityPanel.tsx:63`, `IssueDrawer.tsx:40`); 0 in code. New/retouched awaiting + View Agent surfaces use only scoped tokens, e.g. `ActivityPanel.tsx:250-251,355-367,2392-2393,2408-2409,2454-2457` (`--wp-border`, `--wp-bg-elevated`, `--wp-accent`, `--wp-accent-hover`, `--wp-text-*`) |

Zero src failures; no `file:line` defect to send to the Engineer.

## 2. F-A1–F-A4 + View Agent + polish audit (file:line or clean)

| # | Item | Result |
|---|------|--------|
| F-A1 | Spec approval → awaiting/spec-approval ("Approve Spec") | clean — table `activityDerivation.ts:44` + pure gate `activityDerivation.ts:310-318` (requires `factoryActive === true`, junk kinds fall through to I3); need H1 `factoryIssueJobs.ts:878-910` (extras `specApprovalPending` beats timeline `needsSpecApproval` meta, Triage-only, terminal frees); adapter attaches `factoryAwaiting` + moves row to awaiting (`tests/warp-factory-awaiting.test.ts:564-577`); describe enables `approve-spec` only for the matching kind + usable job id (`activityActions.ts:105,535,1189-1229`); invoke posts via injected `approveSpecJob` seam with debounce + honest notify (`activityActions.ts:1189-1229,725`) |
| F-A2 | Triage answers → awaiting/triage-respond ("Answer Questions") | clean — table `activityDerivation.ts:45`; need H2 trims/answers logic with answered-job release (`tests/warp-factory-awaiting.test.ts:279-339`); precedence spec-beats-questions locked (`tests/warp-factory-awaiting.test.ts:341-349`); describe additionally requires drafted answers (`activityActions.ts:666-667,692-711`); invoke sends cleaned answers, empty answers never reach the seam (`tests/warp-factory-awaiting.test.ts:753-786`, `activityActions.ts:1231-1277,735`) |
| F-A3 | Review ask_human → awaiting/ask-human ("Accept Review") | clean — table `activityDerivation.ts:46`; need H3 Review + `lastReview.verdict === "ask_human"` only, accept/non-Review/terminal report nothing (`tests/warp-factory-awaiting.test.ts:372-390`, `factoryIssueJobs.ts:878-910`); label is honest "Accept" (`tests/warp-factory-awaiting.test.ts:676`) |
| F-A4 | Pending-notification fallback → awaiting/ask-human | clean — table `activityDerivation.ts:47`; matcher requires pending + `ask_human` kind + `workItemId` link, terminal frees even with a pending note (`tests/warp-factory-awaiting.test.ts:407-451`, `factoryIssueJobs.ts:836-878`); adapter end-to-end idle→waiting via threaded notifications (`tests/warp-factory-awaiting.test.ts:595-604`); derivation gate still needs a live linked job, junk `merge-ready` falls to I3 implementing (`tests/warp-factory-awaiting.test.ts:534-548`); live canvas terminals I1/I2 keep priority over the gate (`tests/warp-factory-awaiting.test.ts:509-532`, `activityDerivation.ts:288-303` before `310-318`) |
| VA | View Agent reactivity + honesty (polish) | clean — no URL synthesis: `readFactoryJobSessionLink` passes through daemon-built `dashboardUrl` only (`factoryIssueJobs.ts:54-61,534-582`); session CTA flips disabled→enabled on next poll when the URL arrives (`tests/warp-factory-awaiting.test.ts:608-643`); panel renders `View Agent` for in-progress (`ActivityPanel.tsx:2402-2416`, `var(--wp-accent)` / `var(--wp-accent-hover)`) and keeps the pre-existing done-column `View Session` wording with the shared def (`ActivityPanel.tsx:2443-2464`); all new CTA surfaces carry `title` + `ariaLabel` (`ActivityPanel.tsx:2410-2413,2434-2438,2459-2461`) and scoped `--wp-*` tokens (see S5) |
| P | Polish: cost honesty + guards | clean — `readFactoryJobCostSummary` null = off / absent = undefined / junk = undefined, threaded into the panel snapshot without inventing `0.00` (`tests/warp-factory-awaiting.test.ts:464-495`); human-gate guards refuse silently on junk id / kind mismatch / busy / unknown issue (`tests/warp-factory-awaiting.test.ts:803-842`), throwing seams never throw and concurrent clicks debounce per job (`tests/warp-factory-awaiting.test.ts:844-888`); junk/inactive shapes never claim a gate (`tests/warp-factory-awaiting.test.ts:453-460`) |

## 3. Live checks

Not run — static-only round per order (Playwright paused; no renderer probe, no daemon reads, no panel clicks). Zero screenshots captured, zero invented. Renderer panel-click path (Resolve → job with `issueRef` → row awaiting → Approve/Respond/Accept → daemon) stays covered offline by the invoke/describe/debounce tests above; live re-verification needs one disposable test-orquestador issue + browser driving re-enabled.

## 4. Test rounds / routing

- Round 12 (this addendum): static 5/5 PASS + F-A1–F-A4 4/4 clean + View Agent + polish clean, on first pass of this batch.
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). No Round 13 needed (hard limit is 2 per batch; this batch needed 1).
- Known issues: none in Warp source. Pre-existing host canvas crash without Warp remains decoupled behind the Round 8 gate + boundary (out of scope, see Round 8 §3).

## Screenshots (Round 12)

- None — static-only round (see §3). No paths to report; no placeholders fabricated.

# WarpPanel QA Report — Round 13: B1–B5 perf + session-worktree + index + stalled + attach (static-only, Playwright paused)

Date: 2026-09-07. Scope: B1 memoized Kanban (`src/features/warpPanel/components/KanbanBoard.tsx`), B2 session worktree (`headless-runtime/factory/isolation/sessionWorktree.ts` + 4 call sites), B3 job index (`src/features/warpPanel/adapters/factoryJobIndex.ts` + `liveIssues.ts`/`liveActivity.ts`), B4 stalled (`isFactoryJobStalled` + caption), B5 attach (`sessionAttachState` + `describeFactorySessionLine` + `readFactoryJobSessionLink` + `activityActions.ts` CTA) + suites `warp-kanban-memo` (5) + `factory-session-worktree` (7) + `warp-job-index` (6) + `warp-job-timing` (5) + `warp-session-attach` (6).
Engineer input read: working-tree implementation itself (module docs + derivation tables + suite contract headers `warp-kanban-memo.test.ts:1-19`, `factory-session-worktree.test.ts:1-24`, `warp-job-index.test.ts:1-26`, `warp-job-timing.test.ts:1-25`, `warp-session-attach.test.ts:1-18`, `sessionWorktree.ts:1-20`, `factoryJobIndex.ts:1-22`) — no separate engineer report file exists in the repo; files + reuses verified against code + tests.
Constraints honored: explicit timeouts on every command (`tsc` 180s, suites 180s/300s, greps 60s), file append with `-Encoding utf8`, no daemon / restart / `taskkill` / repo `pnpm dev` / `build` touched, ZERO Playwright (static-only; user sends screenshots), 0 jobs created, 0 screenshots invented.

## Verdict: PASS (static 8/8 + neighbors 210/210 + 151/151 green) — nothing to route to Engineer

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean, renderer (timeout 180s) | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, zero output |
| S1h | `tsc -p tsconfig.headless.json` preexisting aside (timeout 180s) | PASS (out of track) — 8 errors only outside the Warp path: `electron/memory-service.ts:169` x2, `electron/opencode-session.ts:508`, `electron/telemetry-service.ts:310,311,1349`, `headless-runtime/subprocess-worker.ts:346,385`; 0 errors in `warpPanel/` or `sessionWorktree` |
| S2 | New suites 29/29 (timeout 180s) | PASS — `npx tsx --test tests/warp-kanban-memo.test.ts tests/warp-job-index.test.ts tests/warp-job-timing.test.ts tests/warp-session-attach.test.ts tests/factory-session-worktree.test.ts`: 29 pass, 0 fail (kanban-memo 5 + session-worktree 7 + job-index 6 + job-timing 5 + session-attach 6) |
| S3 | Neighbors 210/210 (timeout 300s) | PASS — `warp-live-issues` 39 + `warp-live-activity` 39 + `warp-resolve-factory` 25 + `warp-factory-progress` 15 + `warp-factory-awaiting` 30 + `warp-isolation-panel` 17 + `factory-isolation` 45 = 210 pass, 0 fail |
| S4 | Neighbors 151/151 (timeout 300s) | PASS — `triage-spec` 27 + `triage-spec-domain` 12 + `foreman-prompt` 9 + `factory-client-contract` 19 + `jobs-domain` 14 + `review-verdict` 23 + `handlers-delegation` 27 + `intake-session-delegation` 12 + `issue-gate` 8 = 151 pass, 0 fail |
| S5 | Zero new `setInterval` in `warpPanel/` (timeout 60s) | PASS — `rg "setInterval" src/features/warpPanel/` = 0 hits. `setTimeout` only 4 pre-existing with cleanup, none in the new batch: `IssueDrawer.tsx:393,524`, `ActivityPanel.tsx:523`, `AgentConfig.tsx:537`; `factoryJobIndex.ts` / `activityActions.ts` / `liveActivity.ts` / `activityDerivation.ts` own zero timers |
| S6 | `sessionWorktree` used in all 4 sites (timeout 60s) | PASS — `foreman.ts:20` import + `:342` `directory = resolveSessionWorktree(workItem)`; `triageFlow.ts:21` + `:138` `worktreePath: resolveSessionWorktree(workItem)`; `specFlow.ts:21` + `:173` same; `factoryServer.ts:77` + `:1322` and `:1447` `stored ? resolveSessionWorktree(stored) : job.worktree` (2 call sites, 1 file). Single choke point `sessionWorktree.ts:37` delegates to `effectiveWorktreeFor`, never throws, never invents a root |
| S7 | Invoke resolve intact, no terminal (timeout 60s) | PASS — `rg "resolveHandler|spawn|createPty|openTerminal|xterm|opencode\(" activityActions.ts factoryIssueJobs.ts` = 0 hits. `invokeActivityAction` `resolve` case (`activityActions.ts:1008-1125`) creates a factory job only (`safeFactoryCreate` with `prompt` + `worktree` + `issueRef`, `activityActions.ts:1093-1101`), honest notify on daemon-down / missing-worktree / failed-create; canvas `resolveHandler` never referenced (locked by `warp-resolve-factory` + `warp-live-activity` "resolve never touches the canvas resolve handler" tests) |
| S8 | Attach states without synthesized URL + stalled caption 10min (timeout 60s) | PASS — `readFactoryJobSessionLink` passes through daemon `dashboardUrl` only (`factoryIssueJobs.ts:563-575` via `cleanSessionUrl:542-552`); `sessionId` hits are comment-only (`factoryIssueJobs.ts:58,558` "NEVER synthesized"). `sessionAttachState` spells ready/attaching/overdue/absent (`factoryJobIndex.ts:212-243`, `SESSION_ATTACH_TIMEOUT_MS = 5*60*1000 :120`); CTA titles exact (`activityActions.ts:417-448`: ready "Open the live agent session in a new tab", attaching "Attaching… (elapsed)", overdue "never attached…session handshake", absent legacy honest) + caption mirror (`activityActions.ts:614-647`). `STALLED_JOB_THRESHOLD_MS = 10*60*1000` (`factoryJobIndex.ts:117`); `isFactoryJobStalled` non-terminal + stale `updatedAt` only (`factoryJobIndex.ts:163-181`); caption honest (`ActivityPanel.tsx:2182-2192` "stalled — no daemon update for a while…") wired via `liveActivity.ts:419-420`; `liveIssues.ts:827,851` + `liveActivity.ts:124-125,292` resolve via `buildFactoryJobIndex` + `findActiveFactoryJobForIssueIndexed` (single index per snapshot, same match semantics) |

Zero src failures; no `file:line` defect to send to the Engineer.

## 2. B1–B5 audit (file:line or clean)

| # | Item | Result |
|---|------|--------|
| B1 | Memoized Kanban bails out per-poll | clean — `isSameIssueCardProps` rendered-fields-only guard (`KanbanBoard.tsx:345-385`), `IssueCard = memo(..., isSameIssueCardProps)` (`KanbanBoard.tsx:387-633`), body preview `useMemo` on body string (`KanbanBoard.tsx:397-400`), `isSameCompactRowProps` adds column dot (`KanbanBoard.tsx:652-668`), drag callbacks stable `useCallback` (`KanbanBoard.tsx:1325-1329`); covered by `warp-kanban-memo` 5/5 |
| B2 | Sessions open in the jail, not the anchor | clean — 4 sites above (S6); parity with `effectiveWorktreeFor` locked by `factory-session-worktree` tests 5-7 (memory wins, timeline durable after restart, anchor fallback, triage/spec forward the jail) |
| B3 | One index per snapshot, same semantics | clean — `buildFactoryJobIndex` single pass (`factoryJobIndex.ts:55-74`), `findActiveFactoryJobForIssueIndexed` map-get + active check (`factoryJobIndex.ts:82-114`); adopted in `liveIssues.ts:827,851` + `liveActivity.ts:124-125,292`; parity locked by `warp-job-index` 6/6 incl. 342x342 full-board agreement |
| B4 | Stalled reads honestly past 10min | clean — threshold + helper + caption above (S8); fresh/terminal/timestamp-less/junk never stalled (`warp-job-timing` tests 2-3); restart mode (timeline-only `issueRef` still matches) covered by `warp-job-index` test 4 |
| B5 | View Agent states honestly, never a dead tab | clean — four states + elapsed + titles + caption above (S8); URL never synthesized (`factoryIssueJobs.ts:554-575` doc + code); covered by `warp-session-attach` 6/6 + `warp-job-timing` tests 4-5 |

## 3. Live checks

Not run — static-only round per order (Playwright paused; no renderer probe, no daemon reads, no panel clicks). Zero screenshots captured, zero invented. Panel-click path (Resolve → job with `issueRef` → row In Progress / stalled / attaching → View Agent when attached) stays covered offline by the invoke/describe/debounce/parity tests above; live re-verification needs one disposable test-orquestador issue + browser driving re-enabled.

## 4. Test rounds / routing

- Round 13 (this addendum): static 8/8 PASS + B1–B5 5/5 clean + neighbors 210 + 151 green, on first pass of this batch.
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). No Round 14 needed (hard limit is 2 per batch; this batch needed 1).
- Known issues: none in Warp source. Pre-existing headless type errors unchanged and out of track (see S1h); host canvas crash without Warp remains decoupled behind the Round 8 gate + boundary (out of scope).

## Screenshots (Round 13)

- None — static-only round (see §3). No paths to report; no placeholders fabricated.

---

# WarpPanel QA Report — Round 14: Batch 5 (completed→done, no-reload boundary, overrides persist, PR chain, worktree delete) — static-only, Playwright paused

Date: 2026-09-07. Scope: engineer batch 5 —
(1) completed→done (`deriveKanbanStatus` row 6b + `findCompletedFactoryJobForIssueIndexed` in
`liveIssues.ts`/`liveActivity.ts`/`activityDerivation.ts`),
(2) no-reload boundary (`WarpPanelBoundary.tsx` new + `WarpPanelShell.tsx` mount),
(3) overrides persist (`KANBAN_STATUS_OVERRIDES_STORAGE_KEY` + `setIssueStatus` in `liveIssues.ts`),
(4) PR chain (`projectIsolation` in `headless-runtime/workItem/jobView.ts` + `readFactoryJobPrLink` in
`factoryIssueJobs.ts`),
(5) worktree delete (`delete-worktree` describe/invoke + two-stage confirm in
`activityActions.ts`/`ActivityPanel.tsx`) +
suites `warp-factory-complete-done` (14) + `warp-panel-no-reload` (6) + `warp-overrides-persist` (8) +
`warp-pr-chain` (9) + `warp-worktree-delete` (12).
Engineer input read: working-tree implementation itself (module docs + contract headers
`warp-factory-complete-done.test.ts:1-~20`, `warp-panel-no-reload.test.ts:1-~40`,
`warp-overrides-persist.test.ts:1-12`, `warp-pr-chain.test.ts:1-23`, `warp-worktree-delete.test.ts:1-14`) —
no separate engineer report file exists in the repo; files + tables verified against code + tests.
Constraints honored: explicit timeouts on every command (`tsc` 180s, suites 180s/300s, greps 60s),
file append with `-Encoding utf8`, no daemon / restart / `taskkill` / repo `pnpm dev` / `build` touched,
ZERO Playwright (static-only; user sends screenshots), 0 jobs created, 0 screenshots invented.

## Verdict: PASS (static 6/6 + batch audit 5/5 + 49/49 new + 187 + 162 neighbors green) — nothing to route to Engineer

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean, renderer (timeout 180s) | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, zero output |
| S2 | New suites 49/49 (timeout 180s each) | PASS — `warp-factory-complete-done` 14/14 + `warp-panel-no-reload` 6/6 + `warp-overrides-persist` 8/8 + `warp-pr-chain` 9/9 + `warp-worktree-delete` 12/12 (`npx tsx --test` per file): 49 pass, 0 fail |
| S3 | Warp neighbors 187/187 (timeout 300s) | PASS — `warp-live-issues` 39 + `warp-live-activity` 39 + `warp-resolve-factory` 25 + `warp-factory-progress` 15 + `warp-factory-awaiting` 30 + `warp-kanban-memo` 5 + `warp-job-index` 6 + `warp-job-timing` 5 + `warp-session-attach` 6 + `warp-isolation-panel` 17 = 187 pass, 0 fail |
| S4 | Neighbors 162/162 (timeout 300s) | PASS — `triage-spec` 27 + `triage-spec-domain` 12 + `foreman-prompt` 9 + `factory-client-contract` 19 + `jobs-domain` 14 + `review-verdict` 23 + `handlers-delegation` 27 + `intake-session-delegation` 12 + `issue-gate` 8 + `factory-session-worktree` 7 + `workitem-summary` 4 = 162 pass, 0 fail |
| S5 | Zero new `location.reload` (timeout 60s) | PASS — `rg "location\.reload" src/` = 4 hits: `WarpPanelBoundary.tsx:17,23` comment-only (documents the root boundary it replaces), `ErrorBoundary.tsx:24` pre-existing manual Reload button (committed, untouched), `FactoryLabPage.tsx:931` pre-existing dashboard-popup refresh (`opened.location.reload()`, committed, unrelated to Warp). `rg "location\.reload\|window\.open" src/features/warpPanel/` = the 2 comment hits above, 0 code calls — recovery is `setState` retry, never a reload |
| S6 | Overrides touch `localStorage warp-*` only, never daemon (timeout 60s) | PASS — key `warp-kanban-status-overrides-v1` (`liveIssues.ts:845-846`, versioned envelope, 500-row cap); `getItem`/`setItem` only (`liveIssues.ts:867-954`, window-guarded, never throws); `setIssueStatus` touches map + storage only (`liveIssues.ts:1101-1110`); suite drives injected storage fakes with a `fetch`-throws global guard (`warp-overrides-persist.test.ts:24-31`) |

Zero src failures; no `file:line` defect to send to the Engineer.

## 2. Batch audit — 5 items (file:line or clean)

| # | Item | Result |
|---|------|--------|
| B1 | Completed→done | clean — row 6b `if (factoryCompleted === true) return "done"` (`liveIssues.ts:296-298`), placed after live-work/human-turn rows (MERGED/CLOSED → in-progress → verdict/OPEN-PR) and before the backlog fallback, so an OPEN PR still shows in-review and running canvas work still shows in-progress (`liveIssues.ts:264-300`, doc `:255-262`); terminal-`Complete` match via `findCompletedFactoryJobForIssueIndexed`, `Cancelled`/legacy-error never match; wired in both adapters (`liveIssues.ts:1032-1066`, `liveActivity.ts:369-389`); covered by `warp-factory-complete-done` 14/14 incl. cancelled-never-done + identity-honesty |
| B2 | No-reload boundary | clean — `WarpPanelBoundary` (`WarpPanelBoundary.tsx:32-119`): `getDerivedStateFromError` + `componentDidCatch` diagnostics, `handleRetry` resets state (`:53-55`), fallback offers "Retry panel" (`:97-114`) with canvas-untouched copy (`:94-95`); mounted in `WarpPanelShell.tsx:78-109` wrapping all three panels (Issues/Activity/Agents) with parity comment (`:75-77`); 0 `location.reload` code calls in the feature (see S5); covered by `warp-panel-no-reload` 6/6 |
| B3 | Overrides persist | clean — dedicated versioned key + corrupt/over-cap/junk degrades to empty-or-truncated map, never throws, never invents rows (`liveIssues.ts:861-916`); save swallows storage failure, memory stays authoritative (`:918-954`); constructor restores via injected seam defaulting to `loadPersistedStatusOverrides` (`:235-236,970-987`); stale-issue entries pruned on next snapshot with storage kept honest (`:1077-1087`); `useIssues` exposes `setIssueStatus` passthrough (`useIssues.ts:115`); covered by `warp-overrides-persist` 8/8 incl. restart-simulation round-trip |
| B4 | PR chain (URL travels in `toListItem`, never synthesized) | clean — `projectIsolation` projects the daemon `isolation` record verbatim (trim/clean only: `branch/baseBranch/worktreePath/repoRoot/prUrl/state` + integer `prNumber`; branch-less/`{error}` records project nothing, `jobView.ts:60-89`); `toListItem` (`:148-188`) and `toDetail` (`:221-260`) both spread it additively; panel reads memory-first then timeline durable (`readFactoryJobIsolation`, `factoryIssueJobs.ts:782-797`), and `readFactoryJobPrLink` doc-locks NEVER-synthesized: bare `prNumber` without URL → null (`factoryIssueJobs.ts:799-833`); surface renders `factory.prUrl` via the shared `openIssueInGitHub` bridge (`ActivityPanel.tsx:2430-2443`); covered by `warp-pr-chain` 9/9 |
| B5 | Worktree delete (terminal + force respected, branch intact) | clean — describe enables only for terminal job + usable job id + recorded path (`activityActions.ts:581-596`), honest titles per refusal shape (`:588-596`); invoke backstop refuses non-terminal even with force (`:1597-1607`), refuses junk path (`:1608-1619`), `force` only ever true after the explicit second confirm (`:1623`), dirty/open-PR 409 escalates to the force confirm (`:1643-1645`, `ActivityPanel.tsx:1464-1469`); copy keeps daemon semantics verbatim — "the branch is kept" (`activityActions.ts:596,1631`, `ActivityPanel.tsx:2903`); existing daemon `DELETE …/jobs/:id/worktree` route reused with explicit timeout via `deleteFactoryJobWorktree` seam (`:370-373,1624-1628`); covered by `warp-worktree-delete` 12/12 |

## 3. Live checks

Not run — static-only round per order (Playwright paused; no renderer probe, no daemon reads, no panel clicks).
Zero screenshots captured, zero invented. Panel-click path (Complete → done row → View Agent/PR link →
worktree delete two-stage) stays covered offline by the describe/invoke/projection tests above;
live re-verification needs one disposable test-orquestador issue + browser driving re-enabled.

## 4. Test rounds / routing

- Round 14 (this addendum): static 6/6 PASS + batch audit 5/5 clean + 49/49 new + 187 + 162 neighbors green,
  on first pass of this batch.
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). No Round 15 needed
  (hard limit is 2 per batch; this batch needed 1).
- Known issues: none in Warp source. Pre-existing headless type errors unchanged and out of track
  (see Round 13 S1h); host canvas crash without Warp remains decoupled behind the Round 8 gate + boundary
  (out of scope).

## Screenshots (Round 14)

- None — static-only round (see §3). No paths to report; no placeholders fabricated.

---

# WarpPanel QA Report — Round 15: Batch 3 (done-merge-only, reset/section-persist, PR pre-check) — static-only, Playwright paused

Date: 2026-09-07. Scope: engineer batch 3 —
(1) done-merge-only (row 6b removed in `liveIssues.ts:deriveKanbanStatus`, C1 merge-invitation only in `activityDerivation.ts:deriveActivityStatus`),
(2) reset/section-persist (`panelSection.ts` key `warp-panel-section-v1` + `WarpPanelShell.tsx` restore/persist + `WarpPanelBoundary.tsx` retry-by-state),
(3) PR pre-check empty-branch (`countBranchCommitsVsBase` + `openPrForJob` ahead===0 honest report in `headless-runtime/factory/isolation/gitHubPr.ts`, never-synthesized PR link in `factoryIssueJobs.ts:readFactoryJobPrLink`) +
suites `warp-factory-complete-done` (18) + `warp-panel-no-reload` (9) + `factory-isolation` (49) + `warp-job-index`/`warp-resolve-factory`/`warp-pr-chain` (40).
Engineer input read: working-tree implementation itself (module docs + contract headers + derivation tables) — no separate engineer report file exists in the repo; files + tables verified against code + tests.
Constraints honored: explicit timeouts on every command (`tsc` 180s, suites 180s, greps 60s), file append with `-Encoding utf8`, no daemon / restart / `taskkill` / repo `pnpm dev` / `build` touched, ZERO Playwright (static-only; user sends screenshots), 0 jobs created, 0 screenshots invented.

## Verdict: PASS (static 6/6 + batch audit 3/3 + 18 + 9 + 49 + 40 green) — nothing to route to Engineer

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean, renderer (timeout 180s) | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, zero output |
| S2 | `warp-factory-complete-done` 18/18 (timeout 180s) | PASS — 18 pass, 0 fail (done-merge-only locks: factoryCompleted-alone-never-done kanban+activity, Complete+OPEN stays in-review/merge-ready, cancelled-never-done, identity-honesty) |
| S3 | `warp-panel-no-reload` 9/9 (timeout 180s) | PASS — 9 pass, 0 fail (junk-review coercion, row-isolation drop-poisoned-row, persisted-section validation, boundary healthy/contains-throw-no-reload) |
| S4 | `factory-isolation` 49/49 (timeout 180s) | PASS — 49 pass, 0 fail (incl. pre-check 46-49: zero-commits reports nothing-to-propose without push/pr, non-empty proceeds, probe-failure fails open, count-helper bare-integer/null) |
| S5 | `warp-job-index` + `warp-resolve-factory` + `warp-pr-chain` 40/40 (timeout 180s) | PASS — 40 pass, 0 fail (index 6 + pr-chain 9 + resolve 25; repo-scoped match, byte-identical issueRef, double-click single-create, bare-prNumber-never-synthesized) |
| S6 | Zero `Complete→done` residual (timeout 60s) | PASS — `rg "factoryCompleted.*done\|Complete.*return \"done\"\|Complete.*status: \"done\""` over `src/features/warpPanel/` = 0 hits; `done` returns only on real merge evidence (`liveIssues.ts:417-425` MERGED/merged-list/CLOSED; `activityDerivation.ts:284-302` same) |

Zero src failures; no `file:line` defect to send to the Engineer.

## 2. Batch audit — 3 items (file:line or clean)

| # | Item | Result |
|---|------|--------|
| B1 | Done-merge-only | clean — kanban `factoryCompleted` carries NO board signal (row 6b removed; `Complete`+OPEN returns in-review via row 6, `Complete` w/o PR falls to backlog; param kept + `void`ed for call-site compat `liveIssues.ts:398-405,439-443`); activity C1 maps `Complete`+OPEN PR to `awaiting/merge-ready` only (`activityDerivation.ts:366-377`, row-isolated try/catch), `Complete` w/o OPEN PR falls to `pending` (`activityDerivation.ts:388-393`); both adapters still read the flag via `findCompletedFactoryJobForIssueIndexed` (`liveIssues.ts:1213-1234`, `liveActivity.ts:369-381`); covered by `warp-factory-complete-done` 18/18 |
| B2 | Reset/section-persist + boundary | clean — versioned key `warp-panel-section-v1` (`panelSection.ts:14`), validated load degrades junk to `"issues"` never-throw (`panelSection.ts:35-50`), persist validates + swallows storage failure (`panelSection.ts:52-65`); shell restores on init + persists on change (`WarpPanelShell.tsx:43-60`), owns `activeSection` while panels stay prop-pure; panel-scoped boundary recovers by state `handleRetry` reset (`WarpPanelBoundary.tsx:53-55`, `getDerivedStateFromError` `:38-43`), fallback `Retry panel` with canvas-untouched copy (`:97-114`); mounted in shell wrapping all panels (`WarpPanelShell.tsx:97-131`); per-row isolation in BOTH adapters (`liveIssues.ts:1157-1167` guard + `liveActivity.ts:309-314` guard, parity comment each side); `location.reload` in feature = 2 comment-only hits (`WarpPanelBoundary.tsx:17,23`), 0 code calls; covered by `warp-panel-no-reload` 9/9 |
| B3 | PR pre-check empty-branch, no synthesized PR | clean — probe `git rev-list --count base..branch` with `GIT_REV_LIST_TIMEOUT_MS=10000` (`gitHubPr.ts:27-28,147-178`), bare-integer-only parse else null, fail-open on null; `openPrForJob` short-circuits `ahead === 0` to honest `nothing to propose ... no PR was opened` + manual hint, zero push/PR (`gitHubPr.ts:241-263`); renderer link `readFactoryJobPrLink` NEVER synthesizes: bare `prNumber` w/o URL yields null (`factoryIssueJobs.ts:799-833`); covered by `factory-isolation` tests 46-49 + `warp-pr-chain` bare-number test |

## 3. Live checks

Not run — static-only round per order (Playwright paused; no renderer probe, no daemon reads, no panel clicks). Zero screenshots captured, zero invented. Panel-click path (Complete → merge-ready/in-review → merge → done → PR link → worktree delete) stays covered offline by the describe/invoke/projection/parity tests above; live re-verification needs one disposable test-orquestador issue + browser driving re-enabled.

## 4. Test rounds / routing

- Round 15 (this addendum): static 6/6 PASS + batch audit 3/3 clean + 18 + 9 + 49 + 40 green, on first pass of this batch.
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). No Round 16 needed (hard limit is 2 per batch; this batch needed 1).
- Known issues: none in Warp source. Pre-existing headless type errors unchanged and out of track (see Round 13 S1h); host canvas crash without Warp remains decoupled behind the Round 8 gate + boundary (out of scope).

## Screenshots (Round 15)

- None — static-only round (see §3). No paths to report; no placeholders fabricated.

---

# WarpPanel QA Report â€” Round 16: implement-trace-strict + LOOPS L12 + 1 live job (strict executor)

Date: 2026-09-07. Scope: engineer batch implement-trace-strict (headless-runtime/implement/implementAgent.ts consume strictSecondPass, implementService.ts timeline mirror, shared/types/implement.ts branch union incl fallback-refused, docs/LOOPS.md L12) + suites implement-trace-strict (22) + neighbors + meta-test no-unbounded-loops + 1 live factory job.
Engineer input read: working-tree files + timeline nuevo (jobView isolation projection + implement trace branches llm-ok/fallback-refused/no-sdk/no-git/timeout/patch-applied/rollback in code + tests). No separate engineer report file in repo; decisions verified against code + tests + live timeline.
Constraints honored: explicit timeouts on every command (tsc 360s, suites 180s/300s, daemon TimeoutSec 15, polls Start-Sleep 45/60), file appends with -Encoding utf8, no restart/taskkill/repo pnpm dev/build touched, ZERO Playwright (paused), 1 SOLO job, zero user-issue mutations.

## Verdict: FAIL (static meta-test 30/31 red â€” Regla 7 doc drift; vivo PASS) â€” routed to Engineer

## 1. Static checks

- S1r tsc renderer PASS â€” EXIT 0, zero output (timeout 360s).
- S1h tsc headless PASS with pre-existing note â€” 8 errors only outside implement path (electron/memory-service.ts:169 x2, electron/opencode-session.ts:508, electron/telemetry-service.ts:310,311,1349, headless-runtime/subprocess-worker.ts:346,385); 0 errors in warpPanel/ or implement/ (same set as Round 13 S1h, out of track).
- S2 implement-trace-strict 22/22 PASS (timeout 180s) â€” L12 bounds test 1, snippet cap 2, prompt order 3-4, modify-intent 5, fallback refusal 6-8, code-block 9-10, patch-apply 11-12, llm-ok 13, strict-second-pass 14-15, honest no-ghost-doc 16, timeout 17, no-sdk 18, no-git 19, excerpt cap 20, timeline mirror 21, Triage route 22.
- S3 Vecinas implement verdes PASS (timeout 300s) â€” implement-fallback-literal + implement-late-flush-preverify + implement-setup-fail + implement-spec-demo-quoted all green (tests 1-26 of combined 31-run).
- S4 LOOPS L12 + meta-test FAIL 30/31 (timeout 300s) â€” L12 itself green (IMPLEMENT_LLM_RETRY_MAX=1 in implementAgent.ts:36, doc LOOPS.md:45 row L12, test 1 green); meta-test RED on headless-runtime/workItem/jobView.ts:68 for (const key of ISOLATION_TEXT_KEYS) â€” 6 fixed keys (branch/baseBranch/worktreePath/repoRoot/prUrl/state, jobView.ts:32-39), bounded for-of with pure cleanIsolationText + try/catch never-throw (jobView.ts:62-100), qualifies for Exencion 1 but file missing from FOR_EXEMPT_FILES (no-unbounded-loops.test.ts:222-246 lists workItemDisk/Store/resultStore, not jobView.ts) and from LOOPS.md Exencion 1 file list. Test correctly red per Regla 7; needs Engineer doc/test update, not silent QA whitelist. Other meta checks green: doc exists + SIN COTA verdict, anti-drift numbers match, no for(;;)/while(true).
- S5 Grep cero doc-fantasma + fallback-refused existe PASS (timeout 60s) â€” fallback-refused exists (4 code hits: implementAgent.ts:320,340 pushTrace, implementService.ts:362 mirror find, shared/types/implement.ts:65 union + :56 doc); ghost hits are honest-refusal guards only (minimalChange.ts:852,865,877, implementService.ts:354,368,387, implementAgent.ts:9), zero actual ghost creation (live anchor clean, jail exact 1 file; createdFiles filtered vs disk per implement-fallback-literal tests 5-7).

Zero src logic failures; one Regla 7 doc/test drift (see routing).

## 2. Vivo â€” 1 SOLO job, disposable closed 192 (no user issue touched)

- Precondition: 60 is MERGED (not open), all 26 OPEN are user issues, zero disposable OPEN exists; only disposable in repo is closed [disposable] isolation probe T02 192. Used 192 as read-only issueRef stamp (no gh write, no reopen, no comment, no close) â€” respects NO toques issues del usuario. Smallest-disposable rule satisfied (192 is the sole disposable).
- Resolve path (user-equivalent): POST /factory/jobs (-TimeoutSec 15), same canonical route the panel uses via factoryClient.createFactoryJob ({prompt, worktree, issueRef}), phase defaults to diagnosisLlm. Body: trivial 2-line probe (qa-round16-probe.txt with qa probe / ok, no PR), worktree repo root (anchor), issueRef {provider:github, issueNumber:192, repo:FrancoManfredi/termcanvas, url:.../issues/192}. No terminal, no Playwright, no daemon restart.
- jobId: job-mtqt3i6i-4okb (single create; guard file qa16-create.json; NUNCA more than 1 job).
- Timeline (polls via GET /factory/jobs/<id> -TimeoutSec 15, no duplicates): created Intake (t0) to resolve link github#192 (t1, issueRef meta) to isolation created branch=issue-192 (t2, worktreePath .worktrees/issue-192, repoRoot anchor) to foreman review started (t3) to triage building (trivial) conf=1 (t5) to decided building (t7, runner linux-build) to runner:prepared/accepted (t8-t9) to worker picked job (t10) to implement:changed 1 files strategy=llm duration=17824ms to implement:llm-ok: Model edited 1 file(s) via tools: qa-round16-probe.txt. Branches explicit with implement: prefix; zero implement:fallback-refused (honest â€” not needed because exact parse succeeded).
- Real edits vs honest refusal: REAL EDITS (1 file via tools, llm-ok branch). Jail .worktrees/issue-192/qa-round16-probe.txt exists (Test-Path True) with exact qa probe / ok; anchor qa-round16-probe.txt absent (Test-Path False) â€” isolation holds, no anchor pollution, no ghost doc, no PR opened (prompt forbade it; job still Building/running at last poll, review not yet reached).
- Quota: 5 daemon calls (1 health + 1 create + 3 polls) of 12; 1 job total. Daemon UP (/factory/health version local, opencode healthy, queue pending 64 / running 9 at create).
- Cost: ~3 LLM calls / ~3780 tokens / ~USD 0.0004 at implement time (daemon-reported, trivial probe).

## 3. Test rounds / routing

- Round 16 (this addendum): static S1r/S1h/S2/S3/S5 green + S4 red (1 unjustified for, doc drift) + vivo 1/1 PASS with explicit implement:llm-ok + real-file proof.
- Routing decision: Engineer (Alex) â€” single file:line: add headless-runtime/workItem/jobView.ts (for (const key of ISOLATION_TEXT_KEYS), 6 fixed keys, pure projection for the 2.5s poll) to tests/no-unbounded-loops.test.ts:222-246 FOR_EXEMPT_FILES + mirror it in docs/LOOPS.md Exencion 1 file list (same pattern as workItemDisk/Store/resultStore). No logic change needed; Warp/implement logic itself is green (22/22 + neighbors + vivo llm-ok). Re-verify live NOT needed for this doc fix (no behavior change); next QA round runs meta-test green on first pass.
- Known issues: none in Warp/implement logic. Pre-existing notes unchanged: headless 8 type errors out of track (Round 13 S1h); host canvas crash decoupled behind Round 8 gate+boundary; daemon queue loaded (64 pending at create) â€” vivo still progressed Intake to Building to implement in ~107s.

## Screenshots (Round 16)

- None â€” static + daemon-API round (Playwright paused). No paths to report; no placeholders fabricated. Live evidence is timeline JSON (qa16-poll2.json) + jail file content above, not screenshots.

---

# WarpPanel QA Report — Round 17: review→awaiting hardening (11 suspects + recorder) — static-only, Playwright paused

Date: 2026-09-07. Scope: review→awaiting transition hardening — `src/features/warpPanel/components/ActivityPanel.tsx` (`asRecordSlice` / `asStringList` / `prStateForIssue` guards), `src/features/warpPanel/components/activityActions.ts` (`describeActivityActions` junk-shape guards), `src/features/warpPanel/adapters/liveActivity.ts` (row-isolation junk-slice reader, parity with `liveIssues.ts`), `src/features/warpPanel/warpCrashRecorder.ts` (new, offline crash ring), `src/features/warpPanel/panelSection.ts` (persisted section), `src/features/warpPanel/WarpPanelShell.tsx` (lazy restore + recorder install), `src/features/warpPanel/components/WarpPanelBoundary.tsx` (boundary records into the same ring) + suite `tests/warp-review-awaiting-hardening.test.ts` (10).
Engineer input read: working-tree implementation itself (module docs + contract header `tests/warp-review-awaiting-hardening.test.ts:1-11`, guard docs `ActivityPanel.tsx:2945-2986`, `liveActivity.ts:151-157`, `liveIssues.ts:171-178`, recorder contract `warpCrashRecorder.ts:1-18`, shell comments `WarpPanelShell.tsx:44-58`) — no separate engineer report file exists in the repo; files + tables verified against code + tests.
Constraints honored: explicit timeouts on every command (`tsc` 180s, hardening suite 180s, neighbors 300s, greps 60s), file append with `-Encoding utf8`, no daemon / restart / `taskkill` / repo `pnpm dev` / `build` touched, ZERO Playwright (static-only; user sends screenshots), 0 jobs created, 0 screenshots invented.

## Verdict: PASS (static 6/6 + 10/10 hardening + 117 neighbors green) — nothing to route to Engineer

## 1. Static checks (mandated list)

| # | Check | Result |
|---|-------|--------|
| S1 | `tsc --noEmit` clean, renderer (timeout 180s) | PASS — `npx tsc --noEmit --pretty false`, EXIT 0, zero output |
| S2 | `tests/warp-review-awaiting-hardening` 10/10 (timeout 180s) | PASS — 10 pass, 0 fail (transition shapes 1-3, describe guards 4-5, liveActivity junk 6, recorder ring/hostile/events 7-9, section lazy 10) |
| S3 | Neighbors green (timeout 300s) | PASS — 117 pass, 0 fail: `warp-factory-awaiting` 30 + `warp-live-activity` 39 + `warp-live-issues` 39 + `warp-panel-no-reload` 9 (single `tsx --test` run, 4 files) |
| S4 | Recorder never throws — hostile storage + no-window + throwing getter (timeout 180s, inside S2) | PASS — test 8 covers throwing `setItem` (quota boom), throwing section getter, and full no-`window` SSR/node noop (`read` → `[]`, `record`/`install` → safe noop); `warpCrashRecorder.ts` wraps every path in try/catch (`safeSection` :41-50, `safeMessage` :52-70, `safeStack` :72-84, `readWarpLastCrash` :102-144, `recordWarpCrash` :150-192, handlers :213-250, `installWarpCrashRecorder` :260-348) |
| S5 | Section restore lazy — sync `useState` initializer, no late effect (timeout 60s) | PASS — `WarpPanelShell.tsx:47-53` restores via `useState<NavSection>(() => { loadPersistedPanelSection(); })`; the only `useEffect` in the shell (`:61-67`) installs the crash recorder, never restores section; `persistPanelSection` on change only (`:70-78`); locked by hardening test 10 (regex asserts the lazy initializer + `installWarpCrashRecorder` + boundary `recordWarpCrash`) |
| S6 | Zero new `location.reload` in the feature (timeout 60s) | PASS — `rg "location\.reload" src/features/warpPanel/` = 2 hits, both comment-only (`WarpPanelBoundary.tsx:19,25` documenting the root boundary it replaces); 0 code calls — recovery is `handleRetry` state reset (`WarpPanelBoundary.tsx:71-73`), never a reload. Repo-wide: only pre-existing `src/components/ErrorBoundary.tsx:24` manual Reload button + `src/features/factoryLab/FactoryLabPage.tsx:931` dashboard-popup refresh, both committed and unrelated |

Zero src failures; no `file:line` defect to send to the Engineer.

## 2. Hardening audit — 11 suspects + recorder (file:line or clean)

| # | Suspect | Result |
|---|---------|--------|
| H1 | `prsByIssue[n]` `"loading"` sentinel mid-flip | clean — `prStateForIssue` returns `"loading"` honestly while the lookup runs (`ActivityPanel.tsx:2997-2999,3024`); covered by hardening tests 1-2 (`warp-review-awaiting-hardening.test.ts:69-122`) |
| H2 | `openPrsByIssue[n]` wrong-type (`"loading"` string instead of array) reaching `.map`/`.find` | clean — non-array degrades to `[]` (`ActivityPanel.tsx:3000-3003`); live readers coerce the same way (`liveActivity.ts:240-247`, `liveIssues.ts:231-245`); covered by tests 1-2 + 6 |
| H3 | `verdictByIssue` / `verdictByPr` junk slices (string/array/number) | clean — `asRecordSlice` degrades non-records to `null` (`ActivityPanel.tsx:2951-2960`); readers use `asPlainRecord`/`safeRecord` (`liveActivity.ts:165-178,396-409`); covered by tests 3 + 6 |
| H4 | `labelsByIssue` / `labelsByPr` junk slices | clean — same `asRecordSlice` guard at every read site (`ActivityPanel.tsx:1292-1301,1751`); covered by tests 3 + 6 |
| H5 | `conflictByPr` / `gateByPr` junk slices | clean — guarded reads (`ActivityPanel.tsx:1337-1350`); gate map built entry-by-entry with per-entry try/catch (`liveActivity.ts:285-341`); covered by tests 3 + 6 |
| H6 | `factoryAwaiting.kind` junk (`"loading"`, number, array, `{}`) | clean — unknown kinds fall through to the disabled matrix, 13 defs kept (`activityActions.ts` describe guard); covered by hardening test 4 (`warp-review-awaiting-hardening.test.ts:139-170`) |
| H7 | `factoryAwaiting.jobId` junk (null/number/blank/array/object) | clean — matching gate stays disabled, never enables on junk id; covered by test 4 |
| H8 | `factory` object wrong-type (`"loading"` string) | clean — degrades to honest-disabled session row; covered by test 4 |
| H9 | Top-level describe args mistyped (undefined/null/string/number/array) | clean — degrades to the 13-row disabled matrix, never throws; covered by test 4; valid shapes still enable (`approve-spec` / `triage-respond` / `merge`, test 5) |
| H10 | Poisoned review snapshot rows (`verdictByIssue: "junk"`, `mergedPrNumbers: "junk"`, fractional busy numbers) | clean — `LiveActivityAdapter` snapshot coerces every slice (`liveActivity.ts:472-509`) and drops malformed nodes row-by-row (`:512-658`); covered by test 6 |
| H11 | Poisoned node row dropped without breaking the panel + section reset to default after remount | clean — row isolation both adapters (`liveIssues.ts:1157-1167` guard + `liveActivity.ts:309-314` guard); section persists versioned `warp-panel-section-v1` (`panelSection.ts:14-65`) and restores lazily (`WarpPanelShell.tsx:47-53`); covered by test 10 |
| R | Crash recorder (offline hunt, not a guess) | clean — ring of 3 `{ at, message, stack <=500, section }` under `warp-last-crash` (`warpCrashRecorder.ts:20-39,150-192`); trims stack/message/section bounds (`:26-32`); corrupt payload degrades to `[]` (test 7); window `error` + `unhandledrejection` captured with live section via ref getter (`:213-250`, installed `:260-348`, mounted `WarpPanelShell.tsx:59-67`); boundary double-records render throws that never reach the window handler (`WarpPanelBoundary.tsx:47-69`); install idempotent per window with bound cleanup (`:301-344`); covered by tests 7-9 |

## 3. Live checks

Not run — static-only round per order (Playwright paused; no renderer probe, no daemon reads, no panel clicks). Zero screenshots captured, zero invented. The review→awaiting click path (verdict lands → PR re-lookup flips → awaiting row, no black screen, section kept) stays covered offline by the transition-shape/describe/snapshot/recorder tests above; live re-verification needs browser driving re-enabled. To reproduce live: open the panel on Activity, trigger a review→awaiting flip, and watch the section stay put; if anything still throws, the recorder entry appears (see §5) instead of a reset.

## 4. Test rounds / routing

- Round 17 (this addendum): static 6/6 PASS + hardening audit 11 + recorder clean + 10/10 + 117 neighbors green, on first pass of this batch.
- Routing decision: **NoOne** (no `src` failure; no test-code fix needed). No Round 18 needed (hard limit is 2 per batch; this batch needed 1).
- Known issues: none in Warp source. Pre-existing notes unchanged: headless 8 type errors out of track (see Round 13 S1h); host canvas crash without Warp remains decoupled behind the Round 8 gate + boundary (out of scope).

## 5. How the user reads the recorder (DevTools, 30 seconds)

1. Open DevTools → Application → Local Storage → select the app origin → key `warp-last-crash`.
2. Read the JSON ring (max 3 entries, oldest dropped): each entry is `{ at, message, stack (first 500 chars), section }`.
3. `section` tells where the panel was (`issues` / `activity` / `agents`, e.g. `awaiting-now-activity` in tests); `stack` is trimmed to 500 chars by design (PII bound — no URLs, titles, or user data, `warpCrashRecorder.ts:10-14`).
4. Empty or missing key = no crash recorded since the last clear (honest-empty, not a gap). Corrupt JSON degrades to `[]`, never breaks the panel.
5. After copying the entry for the report, clear the key to reset the ring; the next throw starts a fresh ring.

## Screenshots (Round 17)

- None — static-only round (see §3). No paths to report; no placeholders fabricated.

