# PRD — Total Visual Replica of Figma Reference (Phase 1) + Functional Wiring (Phase 2)

> **Project:** `web/` — TermCanvas Web → Software Factories  
> **Source of truth (UI):** `figma/Factories frontend/src/App.tsx` (1774 LOC, single-file reference) + `figma/Factories frontend/src/index.css`  
> **Source of truth (domain):** `web/WarpFactories.md` (19 sections), `web/WarpFactories-Tickets.md`, `web/WarpFactories-UserStories.md`, `web/src/lib/factory/**`  
> **Stack:** Vite + React 19 + Tailwind CSS v4 (`@tailwindcss/vite`) + TypeScript 6 + Vitest + oxlint  
> **Language:** Artifact in English. Replies in Rioplatense Spanish.

---

## 1. Product Goal

Replace `web/` frontend **entirely** with a 1:1 visual replica of the Figma reference, then wire it to real domain stores/ports. No feature may exist in `web/` that does not exist in Figma.

| # | Goal | Measurable criterion |
|---|------|----------------------|
| G1 | **Pixel-perfect visual parity** — every state, spacing, color, radius, shadow and animation matches Figma reference | Side-by-side diff: no visible delta at 1440px in Chrome; `index.css` tokens 1:1 |
| G2 | **Zero static data in UI** — no `MOCK_*` constant reaches a rendered component; every list/detail reads from `web/src/lib/factory` (store / port / adapter) | `grep -r "MOCK_" web/src` returns 0 in `components/` ; all pages render with store-seeded or port-fetched data |
| G3 | **Minimal, correct navigation surface** — only the 13 routes that exist in Figma are reachable; everything else is deleted | `nav.ts` exports exactly 13 `NavItem`s; removed routes return no match / redirect, not a placeholder |

---

## 2. Scope

### 2.1 Phase 1 — Visual 1:1 (this PRD's implementation scope)

> Pure UI replica. Components may read from stores with fixture/adapter data, but **no new backend wiring** beyond what already exists in `lib/factory`. The emphasis is structure, tokens, and navigation cut.

**Included:**

- **App shell:** `AppMode = "wizard" | "app"` state, `MainApp` + `Sidebar` (w-52, `bg-white`, `border-r border-gray-100`, `h-full overflow-y-auto`).
- **Wizard (5 steps + step 6 startup):**
  - `Shell` + `ProgressBar` (5 segments, `h-1.5 rounded-full`, active `bg-violet-600`, inactive `bg-gray-200`, `duration-300`) + `BackBtn` / `NextBtn` (`BTN_PRIMARY` / `BTN_SECONDARY`).
  - Step 1 `Connect your code host` — single GitHub card (`hover:border-gray-300 hover:bg-gray-50`, `BTN_PRESS`, `shadow: 0 1px 3px oklch(0 0 0 / 0.06)`).
  - Step 2 `Select a repository` — `MOCK_REPOS` list layout (5 rows), selected row `bg-gray-900` / white text + `text-violet-400 "Selected"`, `divide-y divide-gray-100`, `active:scale-[0.99]`.
  - Step 3 `Give your factory some personality` — `Factory name` (required), `Foreman name`, `Description` textarea, `Add an avatar` dashed button (`w-12 h-12 border-dashed`).
  - Step 4 `Configure your agents` — `AGENTS_SETUP` 5 rows with `AgentTypeIcon` + `Toggle` (Foreman = `Required` label, no toggle).
  - Step 5 `Connect your issue trackers` — Linear + Jira cards (`w-10 h-10` icon, `Connect` → `Connected bg-violet-600` toggle).
  - Step 6 `Starting up your factory…` — centered `WarpLogo`, `anim-fade-in-up` staggered grid `grid-cols-4` pipeline (Triage/Planning/Building/Reviewing), `Open factory` CTA.
- **Sidebar (factory mode):**
  - Header: `WarpLogo` + search + split-view icons.
  - Top nav (team scope): 4 items — `Runs`, `MCPs and apps`, `Secrets`, `Integrations` (`text-xs text-gray-500 hover:text-gray-800`).
  - `Factories` section: factory selector pill (`bg-gray-50`, `bg-violet-600` avatar circle, `initial` letter), left border `ml-2 pl-3 border-l border-gray-200`, 9 factory nav items (see §2.3). Active item `text-gray-900 font-semibold bg-white shadow-sm border border-gray-100`.
  - Footer: user pill (`bg-gray-300` avatar `U`, `youruser@example.com`).
- **Agents page:**
  - List: foreman card (`border-gray-200 rounded-xl`, `anim-fade-in-up delay-0`, shows MCP pills + `DotMenu`), sub-agents (`border-gray-100 rounded-xl`, stagger `delay-60…240`), `New agent` dashed CTA.
  - `AgentDetail`: breadcrumb `← Agents / {name}`, `Managed in GitHub` banner, `AgentTypeIcon lg`, tabs `Settings | Automations` (`border-b-2`, active `border-gray-900`), sections `Description`, `Agent resources` (MCPs / Secrets / Harness / Model / Runner / Host), `Agent prompt` monospaced block.
  - `NewAgentForm`: `Enter Agent Name` input (`text-2xl font-semibold`), same sections but editable (`Add MCP` → `McpModal`, `Add secret`, selects for Harness/Model/Runner, Host `Warp hosted` readonly, textarea prompt), Save disabled until `name.trim()`.
  - `McpModal`: overlay `bg oklch(0 0 0 / 0.35)` `anim-fade-in`, card `w-[780px] max-h-[560px] rounded-2xl anim-scale-in`, left pane search + `Custom MCP` + empty state, right pane JSON editor with line-number gutter.
- **Activity page:**
  - Filter bar: chips `Stage is …`, `Created by …` (`bg-white border border-gray-200 rounded-lg`, `shadow 0 1px 2px`), `+` dashed button, `Showing N results` + `Clear`.
  - Grouped list by stage (`triage | planning | building | reviewing`) — headers `Chevron` + `StageIcon` + `label` + `count` (`STAGE_META` bg/text), rows `StageIcon` + title + `hash mono uppercase` + avatar `U` + time.
  - Right drawer (`w-[340px] border-l anim-slide-right`, `shadow -4px 0 16px`): header hash + nav arrows + stop + `View agent` + history + close; body title + stage + origin card (`Slack/Github/Linear` icon + `Origin …` + `Started …`); footer `Task details` with chevron.
- **Runs page:** sticky header + 3 icon buttons + `New`; list `divide-y divide-gray-50`, row `RunStatusIcon` + title + `hash` + tag pills (`PR Creat`, `Slack` etc with inline icons) + agent initial circle (`bg-gray-900`) + time.
- **Automations page:**
  - List: header grid `grid-cols-[180px_1fr_180px_120px]` + rows same grid (`hover:bg-gray-50 rounded-lg anim-fade-in-up`).
  - `NewAutomationForm`: breadcrumb, tabs `Settings | Runs`, `Triggers` card (`border rounded-xl shadow 0 1px 3px`), selected trigger row (`Weekly on Monday at 09:00 AM EDT` with selects + `Next run` + close X), `Add trigger` → `TriggerDropdown`; `Agents` select with `AgentTypeIcon sm` prefix; `Agent prompt` textarea.
  - `TriggerDropdown`: two-panel `rounded-xl border shadow 0 8px 24px`, left `Scheduled (hover → submenu) + GitHub/Linear/Slack/Jira` (disabled with `Not connected`), right submenu `Hourly/Daily/Weekly/Custom (cron)`.
- **Scorers page:**
  - List: rows `group flex border-b hover:bg-gray-50 anim-fade-in-up`, name + `{n} outcome classifications • {agents}` + delete trash on `group-hover:opacity-100`.
  - `NewScorerForm`: title input `text-[28px] font-semibold`, sections `Description`, `Agent(s) to evaluate` (chips + `Add agent` dashed → `AgentPickerModal`), `Judge instructions` textarea, `Judge model` select (`JUDGE_MODELS`), `Classifications` list (`pass/fail` pills `bg-green-100/bg-red-100` + delete X → `ClassificationModal`), `SliderRow` ×2 (`Pass threshold 0–1 step 0.01`, `Sample rate 0–100%`), `Self-improvement Toggle`.
  - `ClassificationModal`: overlay, `w-[480px] rounded-2xl`, Name input, Outcome `pass/fail` toggle (`bg-green-50 border-green-300` vs `bg-red-50 border-red-300`), Description textarea, Cancel/Add.
  - `AgentPickerModal`: `w-[420px] rounded-2xl`, checklist with `border-2` checkbox (`bg-violet-600` when checked) + `AgentTypeIcon sm`.
  - `SliderRow`: range input with `linear-gradient(to right, #111827 {pct}%, #e5e7eb {pct}%)`, number input `w-14` + suffix, thumb `w-18 h-18 bg-gray-900 rounded-full shadow`.
- **Placeholders (4 factory pages):** `Dashboard`, `Self-improvement`, `Factory definition`, `Settings` — centered `w-12 h-12 bg-gray-100 rounded-2xl` + `{label}` + `Coming soon` (`anim-fade-in`). Must exist as routes but render only this.
- **Design tokens (global):** `Inter` via `@import url('...Inter...')`, `html/body/#root { height:100%; font-family:'Inter',sans-serif }`, `button:not(:disabled),[role="switch"],select { cursor:pointer }`, scrollbar `w-4px thumb #d1d5db`, animations `anim-fade-in-up 200ms cubic-bezier(0.2,0,0,1)`, `anim-fade-in 150ms`, `anim-slide-right 220ms`, `anim-scale-in 180ms`, stagger `delay-0/60/120/180/240`, `BTN_PRESS = transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]`, `BTN_PRIMARY = px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 + BTN_PRESS`, `BTN_SECONDARY = px-4 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-md hover:border-gray-300 hover:bg-gray-50 + BTN_PRESS`.

**Explicitly not building in Phase 1:** any new API call, persistence, or domain logic beyond rendering store-shaped data.

### 2.2 Phase 2 — Functional Wiring (out of scope for Phase 1 build, but PRD must define it)

- Replace every remaining `MOCK_*` feed with `web/src/lib/factory`:
  - `MOCK_REPOS` → `GitHub repos port` / `FactoryWorkspaceStore`.
  - `DEFAULT_AGENTS` / `agents` state → `Agent` domain + `FactoryWorkspaceStore` + `parsers` + `store` CRUD.
  - `MOCK_WORK_ITEMS` / `MOCK_RUNS` / `MOCK_AUTOMATIONS` / `MOCK_SCORERS` → corresponding ports/stores (Activity `WorkItem` machine, Runs, Automations, Scorers).
- Wizard persists `FactoryConfig` into workspace store; Step 6 → real factory creation.
- `Managed in GitHub` banner links to real repo/ref.
- `Save` / `New` / `Delete` mutate stores (optimistic + error boundary).
- Empty/loading/error states driven by store status, not static branches.
- Deep-linking via `window.location` / hash for factory-scoped routes (`/factory/:uid/{page}`) if adopted.

### 2.3 Navigation — The 13 Allowed Items

**After Phase 1, `web/src/nav.ts` MUST export exactly:**

| Scope | `id` (NavItemId) | `label` |
|-------|-------------------|---------|
| team | `Team Runs` | `Runs` |
| team | `MCPs and apps` | `MCPs and apps` |
| team | `Secrets` | `Secrets` |
| team | `Integrations` | `Integrations` |
| factory | `Dashboard` | `Dashboard` |
| factory | `Activity` | `Activity` |
| factory | `Agents` | `Agents` |
| factory | `Automations` | `Automations` |
| factory | `Runs` | `Runs` |
| factory | `Scorers` | `Scorers` |
| factory | `Self-improvement` | `Self-improvement` |
| factory | `Factory definition` | `Factory definition` |
| factory | `Settings` | `Settings` |

`NAV_ITEMS = [...TEAM_ITEMS(4), ...FACTORY_ITEMS(9)]`. `DEFAULT_NAV_ITEM = "Dashboard"` (Figma `MainApp` defaults to `agents`, but app default per `nav.ts` stays Dashboard; both are acceptable if documented — pick one and keep it).

---

## 3. User Stories (INVEST) + Gherkin

### 3.1 Wizard

#### US-W1 — Connect code host
> As a **factory owner**, I want to **connect GitHub as my code host** so that I can select a repo for the new factory.

- **I** — independent (no repo selection). **N** — negotiable copy. **V** — unblocks creation. **E** — estimable (1 card). **S** — small. **T** — testable via click.

```gherkin
Feature: Wizard Step 1 — Connect code host
  Scenario: Advance on GitHub card click
    Given I am on wizard step 1
    When I click "I want to use repos from GitHub"
    Then I advance to step 2
    And the progress bar shows 2 of 5 filled
```

#### US-W2 — Select repository
> As a **factory owner**, I want to **pick one GitHub repo** so that the factory is bound to the correct codebase.

```gherkin
Feature: Wizard Step 2 — Select repository
  Scenario: Next disabled until a repo is selected
    Given I am on step 2 with no selection
    Then the Next button is disabled
    When I click "acme-corp/payments-service"
    Then that row shows bg-gray-900 with "Selected" in violet
    And Next becomes enabled
    When I click Next
    Then I advance to step 3
```

#### US-W3 — Give personality
> As a **factory owner**, I want to **name my factory and foreman** so that teammates can identify and @-mention it.

```gherkin
Feature: Wizard Step 3 — Factory personality
  Scenario: Factory name is required
    Given I am on step 3
    Then Next is disabled
    When I type "payments-factory" in Factory name
    Then Next becomes enabled
    And the hint "This is the name that you will see in Warp Factories." is visible
```

#### US-W4 — Configure agents
> As a **factory owner**, I want to **toggle Triage/Spec/Code/Review** so that the factory has the right specialist coverage.

```gherkin
Feature: Wizard Step 4 — Configure agents
  Scenario: Foreman is always required
    Given I am on step 4
    Then the Foreman row shows "Required" not a toggle
    When I toggle Triage off
    Then its Toggle shows bg-gray-200 and aria-checked false
```

#### US-W5 — Connect issue trackers
> As a **factory owner**, I want to **connect Linear and/or Jira** so that issues flow into the factory.

```gherkin
Feature: Wizard Step 5 — Issue trackers
  Scenario: Connect button toggles state
    Given I am on step 5
    When I click Connect on Linear
    Then the button shows "Connected" with bg-violet-600
    When I click Finish
    Then I advance to step 6 startup
```

#### US-W6 — Startup & enter factory
> As a **factory owner**, I want to **see the startup pipeline and open the factory** so that I land in the app shell.

```gherkin
Feature: Wizard Step 6 — Startup
  Scenario: Pipeline and CTA
    Given I am on step 6
    Then I see 4 cards Triage/Planning/Building/Reviewing in a 4-col grid
    And they stagger with anim-fade-in-up delays 120/180/240/300ms
    When I click "Open factory"
    Then the app switches to MainApp with the factory name from step 3
```

### 3.2 Sidebar & Shell

#### US-S1 — Navigate factory pages
> As a **factory member**, I want to **switch between the 9 factory pages** so that I can operate the factory.

```gherkin
Feature: Sidebar — Factory navigation
  Scenario: Active page is highlighted
    Given I am on Agents
    Then Agents shows text-gray-900 font-semibold bg-white shadow-sm border
    When I click Activity
    Then Activity becomes active and the main pane renders ActivityPage
```

#### US-S2 — Top nav is present but inert in Phase 1
> As a **factory member**, I want to **see the 4 team links** in the sidebar so that the shell matches Figma.

```gherkin
Feature: Sidebar — Team links
  Scenario: Four team items rendered
    Given the sidebar is visible
    Then I see Runs, MCPs and apps, Secrets, Integrations in that order
    And none of them navigates outside the shell in Phase 1 (no-op or no handler)
```

### 3.3 Agents

#### US-A1 — List agents
> As a **factory owner**, I want to **see the foreman + sub-agents** so that I know the fleet composition.

```gherkin
Feature: Agents — List
  Scenario: Foreman card distinct
    Given the factory has foreman + 4 sub-agents
    Then the foreman card has border-gray-200 and shows MCP pills
    And each sub-agent card shows AgentTypeIcon and DotMenu on hover
```

#### US-A2 — View agent detail (Settings tab)
> As a **factory member**, I want to **open an agent and see its Settings** so that I can audit its resources and prompt.

```gherkin
Feature: Agents — Detail Settings
  Scenario: Open detail
    When I click the foreman card
    Then I see breadcrumb "← Agents / foreman"
    And a "Managed in GitHub" banner with "Open in GitHub"
    And tabs Settings | Automations with Settings active
    And sections Description, Agent resources (MCPs/Secrets/Harness/Model/Runner/Host), Agent prompt
```

#### US-A3 — Switch to Automations tab
> As a **factory member**, I want to **switch to the Automations tab** inside an agent so that I can see its automations.

```gherkin
Feature: Agents — Detail Automations tab
  Scenario: Empty state
    Given I am on an agent detail Settings tab
    When I click Automations
    Then I see "No automations configured for this agent."
```

#### US-A4 — Create new agent
> As a **factory owner**, I want to **create a new custom agent** so that I can extend the fleet.

```gherkin
Feature: Agents — New agent
  Scenario: Save disabled until name entered
    Given I click New
    Then I see "Enter Agent Name" input with text-2xl
    And Save is disabled
    When I type "security-auditor"
    Then Save becomes enabled
    When I click Save
    Then the agent list includes "security-auditor" and I land on its detail
```

#### US-A5 — Add MCP via modal
> As a **factory owner**, I want to **open the MCP modal from New Agent** so that I can attach MCPs.

```gherkin
Feature: Agents — McpModal
  Scenario: Open and close
    Given I am on New Agent
    When I click Add MCP
    Then a modal anim-scale-in appears with w-[780px] and overlay oklch(0 0 0 / 0.35)
    And it shows search, Custom MCP, "No connected MCP servers" and a JSON Configuration editor
    When I click the close X
    Then the modal dismisses
```

### 3.4 Activity

#### US-AC1 — Browse grouped work items
> As a **factory member**, I want to **browse work items grouped by stage** so that I can see factory flow.

```gherkin
Feature: Activity — Grouped list
  Scenario: Four stage headers
    Given work items exist in triage and reviewing
    Then I see headers Triage/Planning/Building/Reviewing with counts
    When I click the Chevron on Planning
    Then its items collapse and Chevron rotates -90deg with 200ms cubic-bezier(0.2,0,0,1)
```

#### US-AC2 — Filter bar
> As a **factory member**, I want to **see the filter chips** so that the page matches Figma parity (Phase 1 visual only).

```gherkin
Feature: Activity — Filters
  Scenario: Chips and results count
    Given I am on Activity
    Then I see chips "Stage is Triage, Planning…" and "Created by youruser"
    And "Showing 7 results" with a Clear button on the right
```

#### US-AC3 — Open item drawer
> As a **factory member**, I want to **click a work item and see its drawer** so that I can inspect its context.

```gherkin
Feature: Activity — Drawer
  Scenario: Select and deselect
    When I click "Update pin UI to left hover"
    Then a right drawer w-[340px] anim-slide-right appears with hash 93C5DB
    And it shows Stage, origin card (Slack/GitHub/Linear) and "Started …"
    When I click the same row again or the close X
    Then the drawer dismisses
```

### 3.5 Runs

#### US-R1 — List runs
> As a **factory member**, I want to **see the runs feed** so that I can monitor execution.

```gherkin
Feature: Runs — List
  Scenario: Runs rendering
    Given 12 runs exist
    Then each row shows RunStatusIcon + title + hash mono uppercase + tag pills + agent initial circle + time
    And rows are divide-y divide-gray-50 with hover:bg-gray-50
```

### 3.6 Automations (+ TriggerDropdown)

#### US-AU1 — List automations
> As a **factory owner**, I want to **see automations in a 4-col grid** so that triggers, agent and date are scannable.

```gherkin
Feature: Automations — List
  Scenario: Table layout
    Given 2 automations exist
    Then the header reads Automation | Trigger | Agent | Created
    And each row uses grid-cols-[180px_1fr_180px_120px] with DotMenu on hover
```

#### US-AU2 — Create automation with Scheduled trigger
> As a **factory owner**, I want to **add a Scheduled weekly trigger** so that the automation can run on a cadence.

```gherkin
Feature: Automations — New with TriggerDropdown
  Scenario: Pick weekly schedule
    Given I click New on Automations
    When I click Add trigger
    Then TriggerDropdown appears with Scheduled + GitHub/Linear/Slack/Jira
    When I hover Scheduled and click Weekly
    Then the form shows "Weekly on Monday at 09:00 AM EDT Next run …"
    And I can change day/time via selects
    When I pick an agent and click Save
    Then I return to the list and the new automation appears
```

### 3.7 Scorers (+ modals + sliders)

#### US-SC1 — List scorers
> As a **factory owner**, I want to **see scorers with their classification count and agents** so that I can audit quality gates.

```gherkin
Feature: Scorers — List
  Scenario: Rows with delete on hover
    Given 5 scorers exist
    Then each row shows name + "N outcome classifications • Agent …"
    And a trash icon appears on group-hover
```

#### US-SC2 — Create scorer with validations and modals
> As a **factory owner**, I want to **create a scorer via the full form** so that evaluation can be configured.

```gherkin
Feature: Scorers — New form
  Scenario: Required fields gate Save
    Given I click New on Scorers
    Then Save is disabled
    When I enter name, pick agents via AgentPickerModal, fill Judge instructions, add a classification via ClassificationModal, leave judge model default
    Then Save becomes enabled
    When I adjust Pass threshold to 0.8 and Sample rate to 75% via SliderRow
    And toggle Self-improvement on
    And click Save
    Then the scorer appears at the top of the list
```

#### US-SC3 — ClassificationModal
> As a **factory owner**, I want to **add a classification with pass/fail outcome** so that scoring has criteria.

```gherkin
Feature: Scorers — ClassificationModal
  Scenario: Add classification
    Given I am on New Scorer
    When I click Add classification
    Then a w-[480px] modal appears with Name, Outcome (pass green / fail red), Description
    And Add is disabled until Name is non-empty
    When I enter "Concise" with pass and click Add
    Then the classification list shows a green "pass" pill with "Concise"
```

#### US-SC4 — AgentPickerModal and SliderRow
> As a **factory owner**, I want to **pick multiple agents and set thresholds** so that the scorer is scoped correctly.

```gherkin
Feature: Scorers — AgentPickerModal + Sliders
  Scenario: Pick agents and slide
    When I click Add agent
    Then a w-[420px] modal shows agents with checkbox + AgentTypeIcon
    When I check triage and spec and click Done
    Then chips for those agents appear with a remove X
    When I drag Pass threshold
    Then the track fill pct updates via linear-gradient and the number input reflects the value
```

### 3.8 Placeholders

#### US-P1 — Placeholder pages
> As a **factory member**, I want to **navigate to Dashboard / Self-improvement / Factory definition / Settings** and see a coming-soon state so that the nav feels complete.

```gherkin
Feature: Placeholders
  Scenario: Coming soon
    When I click Dashboard
    Then I see a centered w-12 h-12 bg-gray-100 rounded-2xl icon
    And "Dashboard" with "Coming soon" and anim-fade-in
```

---

## 4. Functional Requirements (Priority Pool)

### P0 — Must have (Phase 1 ships without these is a failure)

- **NAV-01** — `nav.ts` trimmed to exactly 13 `NavItem`s (4 team + 9 factory) with `NAV_ITEMS = [...TEAM_ITEMS, ...FACTORY_ITEMS]`. No other `NavItemId` may remain. `assertNever` still enforces exhaustiveness.
- **NAV-02** — `App.tsx` switch handles exactly those 13 ids (plus exhaustive `default: assertNever`). Removed cases and their lazy imports deleted.
- **SHELL-01** — `Sidebar` matches Figma: w-52, header WarpLogo + 2 icons, top 4 team links, Factories section with pill + left border + 9 items, footer user pill. Active factory item style exactly `text-gray-900 font-semibold bg-white shadow-sm border border-gray-100`.
- **WIZ-01..06** — Wizard Shell + 5 steps + Step 6 all render with exact copy, spacing, shadows, radii and button tokens per §2.1.
- **AG-01** — Agents list/detail/new + `McpModal` with exact dimensions, animations and empty states.
- **AC-01** — Activity grouped list + filter bar + drawer (`w-[340px] anim-slide-right`) per §2.1.
- **RU-01** — Runs list with `RunStatusIcon`, tags, initial circle, hash mono.
- **AU-01** — Automations list grid + `NewAutomationForm` + `TriggerDropdown` (hover submenu).
- **SC-01** — Scorers list + `NewScorerForm` + `ClassificationModal` + `AgentPickerModal` + `SliderRow` ×2.
- **PH-01** — 4 placeholder pages render `Coming soon` with icon and label.
- **TOK-01** — `index.css` carries Inter import, `@import 'tailwindcss'`, `height:100%`, scrollbar 4px, cursor:pointer rule, keyframes + anim classes, range input styling — 1:1 with Figma `index.css`.
- **DEL-01** — Every component/file/route not in Figma is **deleted** (see §7).

### P1 — Should have (Phase 1 should include; defer only with written reason)

- **STATE-01** — Wizard `FactoryConfig` and page lists sourced from `FactoryWorkspaceStore` / domain fixtures, not inline `MOCK_*` in UI files. UI files must import from `lib/factory`, not define data.
- **A11Y-01** — `Toggle` has `role="switch"` + `aria-checked`; all icon buttons have accessible name or `aria-label`.
- **PERF-01** — Wizard + MainApp code-split: `lazy` + `Suspense` kept; Sidebar is not lazy.
- **ERR-01** — Every lazy boundary wrapped in `<ErrorBoundary>`.

### P2 — Nice to have (may slip to Phase 2)

- **ANIM-01** — Stagger delays `delay-0/60/120/180/240` applied consistently to list items.
- **EMPTY-01** — Empty states for Agents/Automations/Scorers/Activity when store is empty reuse Figma's exact strings.

---

## 5. Non-Functional Requirements

| Area | Requirement |
|------|-------------|
| **Styling** | Tailwind CSS v4 via `@tailwindcss/vite` only. No Tailwind config file, no PostCSS config. Global CSS lives in `src/index.css` (imports first). |
| **Typography** | `Inter` 400/500/600/700 via Google Fonts `@import`. Fallback `sans-serif`. No other font. |
| **Animations** | Exact keyframes: `fade-in-up {0→6px}`, `fade-in`, `slide-in-right {12px}`, `scale-in {0.96→1}`. Durations: `fade-in-up 200ms`, `fade-in 150ms`, `slide-right 220ms`, `scale-in 180ms`, all `cubic-bezier(0.2,0,0,1)` + `both`. Delays 0/60/120/180/240ms. |
| **Button press** | `BTN_PRESS = transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]` (or `active:scale-[0.98]`/`[0.99]` where Figma specifies). No other press effect. |
| **Colors / shadows** | `oklch(0 0 0 / …)` shadows exactly as in Figma class strings (e.g. `0 8px 32px oklch(0 0 0 / 0.16)`). Do not replace with `shadow-lg`. |
| **Structure** | SOLID: SRP per component, OCP via `navItemsByScope`, DIP — UI depends on `ports`/`store` abstractions, not concrete fetch. Avoid God Component: `App.tsx` is a router only; each page is its own folder with container + presentational split. |
| **Pattern** | Atomic Design + Container-Presentational: pages = containers (store/port), rows/cards/icons = presentational. No prop drilling >2 levels — use composition or context. |
| **Duplication** | No duplicated icon SVGs: each icon is one component (`WarpLogo`, `GithubIcon`, `LinearIcon`, `JiraIcon`, `SlackIcon`, `AgentTypeIcon`, `StageIcon`, `RunStatusIcon`, `Chevron`, `DotMenu`). |
| **Build** | `pnpm --filter web check` = `tsc --noEmit && tsc -b && vitest run --pool=threads && vite build && oxlint` must be green. `pnpm --filter web typecheck` and `oxlint` must pass with zero errors. |
| **A11y** | Keyboard reachable; focus ring `focus:ring-2 focus:ring-violet-500`; `aria-*` on toggles/selects/modals. |
| **No mock leakage** | `grep -R "MOCK_" web/src/components` must be 0 after Phase 1. `MOCK_*` may live only inside `lib/factory/fixtures` or tests. |

---

## 6. Out of Scope — Explicit Kill List

> Everything below **exists today in `web/` but does NOT exist in Figma** and MUST be deleted in Phase 1. No "keep for later" — if it is not one of the 13 nav items or the wizard, it goes. Phase 2 may re-add a feature only if Figma gains it or a new ADR explicitly overrides this PRD.

**Team nav items to delete:** `Quickstart` (and the whole `quickstart/` wizard — replaced by Figma wizard), `Help` (and `FactoryGlossary`, `HelpLinks`).

**Factory nav items to delete (17):** `Runners`, `Skills`, `Benchmarks`, `MCP tools`, `Factory API`, `Troubleshooting`, `Infra`, `Validation`, `Integrations Deep Dives`, `GitHub routing`, `GitLab Deep Dive`, `Slack Deep Dive`, `Linear Deep Dive`, `Jira Deep Dive`, `Schedule Deep Dive`, `Factory Deep Dive` (and their `initialTab` wiring).

**Components/pages to delete:** `components/quickstart/`, `components/skills/`, `components/runners/`, `components/benchmarks/`, `components/mcp/McpStubPage`, `components/factory-api/`, `components/help/`, `components/infra/`, `components/validation/`, `components/integrations-deep/`, `components/routing/`, `components/dashboard/DashboardPage` (replace with Figma placeholder or keep only if Dashboard placeholder already covers it — do not keep current dashboard content that exceeds placeholder), `components/factories/FactoryGlossary`.

**Routing to delete:** `/quickstart`, `/factory/:uid/dashboard` special-case, hash-based `Troubleshooting` anchors (`#setup`, `#two-runs`, …), `HelpNavProvider`.

**Feature flags to delete or gate:** `isQuickstartFullscreenEnabled`, `shouldFullscreen` logic (wizard is now the Figma `AppMode` wizard, not a fullscreen flag).

> If any deleted item is later proven required, it must be re-proposed via ADR and added to Figma first — not re-added ad-hoc.

---

## 7. Dependencies & Risks

| # | Dependency / Risk | Impact | Mitigation |
|---|-------------------|--------|------------|
| D1 | `web/src/lib/factory` domain (parsers, `workItem` machine, `FactoryWorkspaceStore`, ports/adapters/schemas) is the wiring target | Phase 2 blocked if ports incomplete | Phase 1 renders from store/fixtures only; wire in Phase 2 ticket-by-ticket |
| D2 | Tailwind v4 + `@tailwindcss/vite` plugin already in `vite.config.ts` — do not add config file | Wrong setup breaks `index.css` | Copy Figma `index.css` verbatim (keep `@import 'tailwindcss'` first) |
| D3 | `oxlint` + `tsc -b` strict. Figma reference uses inline SVGs and loose types | Build red if types not tightened | Extract icons as typed components; define `Repo/Agent/WorkItem/Run/Automation/Scorer` once in `lib/factory/domain` and import |
| R1 | **Scope creep — re-adding deleted nav items** | Violates hard constraint | CI check: assert `NAV_ITEMS.length === 13` and no import of deleted pages |
| R2 | **Mock leakage** — copy-pasting `MOCK_*` into UI for speed | Violates G2 | Lint rule / grep in `check` script; fixtures live only in `lib/factory/fixtures` |
| R3 | **God Component regression** — cramming 1774 LOC back into one `App.tsx` | Unmaintainable, violates SOLID | Enforce folder-per-page: `components/agents/`, `components/activity/`, `components/runs/`, `components/automations/`, `components/scorers/`, `components/wizard/`, `components/shell/` |
| R4 | **Pixel drift** — approximating radii/shadows/colors | Fails G1 | Token-for-token copy: `BTN_PRESS/PRIMARY/SECONDARY`, `STAGE_META`, `JUDGE_MODELS`, oklch shadows |
| R5 | **Animation jank** — wrong cubic-bezier or missing `both` | Visual regression | Keep Figma `index.css` keyframes + `anim-*` classes exactly |
| R6 | **Prop drilling through wizard config** | Fragile | Wizard state in a small `WizardStore` or context; steps are presentational |

---

## 8. Global Acceptance Criteria

- [ ] **AC-G1 Pixel-perfect** — At 1440×900, Figma reference and `web/` side-by-side are indistinguishable for: wizard steps 1–6, sidebar (all states), Agents (list/detail/new/modal), Activity (filters + grouped list + open drawer), Runs, Automations (list + new + dropdown), Scorers (list + new + 2 modals + sliders), 4 placeholders.
- [ ] **AC-G2 Navigation cut** — `web/src/nav.ts` exports **exactly 13** items listed in §2.3 in that order. `pnpm --filter web typecheck` fails if any other `NavItemId` is referenced. No deleted route is importable.
- [ ] **AC-G3 No extra chrome** — No button, tab, page or icon exists in `web/` that does not exist in `figma/.../App.tsx`. Spot-check: `Benchmarks`, `Infra`, `Validation`, `MCP tools`, `Factory API`, `Quickstart`, `Troubleshooting`, `GitHub routing`, deep dives absent from UI and nav.
- [ ] **AC-G4 Zero MOCK in UI** — `grep -R "MOCK_" web/src/components` and `web/src/App.tsx` return 0. All data comes from `lib/factory` (store/ports/fixtures). `web/src/lib/factory/fixtures` is the only place `MOCK_*` may remain (and even there, behind a port).
- [ ] **AC-G5 Tokens exact** — `index.css` contains Inter import, `@import 'tailwindcss'`, `anim-fade-in-up 200ms cubic-bezier(0.2,0,0,1)`, `BTN_PRESS active:scale-[0.96]`, scrollbar 4px, cursor rule. No extra global CSS.
- [ ] **AC-G6 Architecture** — No file >300 LOC except `lib` domain. No God Component. Atomic/Container-Presentational split visible. Icons are single components, not inline copies. `oxlint` and `tsc -b` green.
- [ ] **AC-G7 Build green** — `pnpm --filter web check` (`tsc --noEmit && tsc -b && vitest run && vite build && oxlint`) exits 0. No `any` in new code without `// TODO` + ticket.
- [ ] **AC-G8 Behavior parity** — Wizard progress 5/5, toggles, selects, modals (overlay + `anim-scale-in` + close X), drawer `anim-slide-right`, `DotMenu` `group-hover:opacity-100`, `TriggerDropdown` hover submenu, `SliderRow` gradient track — all match Figma interaction spec.

---

## 9. Open Questions

1. **Default landing page** — Figma `MainApp` defaults to `agents`; current `nav.ts` defaults to `Dashboard`. Keep `Dashboard` as `DEFAULT_NAV_ITEM` or align to `agents`? **Proposed:** keep `Dashboard` (less churn), document divergence.
2. **Team nav click behavior in Phase 1** — Figma top 4 are inert placeholders; should they no-op, toast, or navigate to placeholder? **Proposed:** no-op (no handler) to avoid inventing UI.
3. **Fixture seeding** — Should Phase 1 seed stores from current `MOCK_*` values verbatim or from `lib/factory/fixtures` canonical fixtures? **Proposed:** `lib/factory/fixtures` canonical, with a one-time copy of `MOCK_*` values into fixtures if missing.
4. **Dashboard placeholder content** — Figma shows generic "Coming soon" for Dashboard; current `DashboardPage` has richer content. Delete richer content or keep behind flag? **Proposed:** delete — Phase 1 is strict replica; richer dashboard returns only if Figma adds it.

---

## 10. Appendix — Figma Inventory (for implementers)

**Single file:** `figma/Factories frontend/src/App.tsx` — 1774 lines.

| Area | Symbols to replicate exactly |
|------|------------------------------|
| Types | `AppMode`, `WizardStep`, `NavPage`, `Repo`, `FactoryConfig`, `Agent`, `WorkItem`, `Run`, `Automation`, `ScorerClassification`, `Scorer`, `TriggerConfig` |
| Constants | `MOCK_REPOS(5)`, `DEFAULT_AGENTS(5)`, `MOCK_WORK_ITEMS(7)`, `MOCK_RUNS(12)`, `MOCK_AUTOMATIONS(2)`, `MOCK_SCORERS(5)`, `JUDGE_MODELS(6)`, `STAGE_META(4)`, `AGENTS_SETUP(5)`, `PIPELINE(4)`, `NAV_ITEMS(9 factory)`, `BTN_PRESS/PRIMARY/SECONDARY`, `TYPE_MAP` |
| Icons | `WarpLogo`, `GithubIcon`, `LinearIcon`, `JiraIcon`, `SlackIcon`, `AgentTypeIcon(6 types)`, `StageIcon(4)`, `RunStatusIcon(4)`, `Chevron`, `DotMenu` |
| Shell | `ProgressBar`, `Shell`, `BackBtn`, `NextBtn`, `Sidebar`, `MainApp` |
| Wizard | Steps 1–6 inline in `App` |
| Pages | `AgentDetail`, `NewAgentForm`, `McpModal`, `AgentsPage`, `ActivityPage`, `RunsPage`, `TriggerDropdown`, `NewAutomationForm`, `AutomationsPage`, `ClassificationModal`, `AgentPickerModal`, `SliderRow`, `NewScorerForm`, `ScorersPage` |
| CSS | `index.css` 98 lines — Inter, tailwind import, height/cursor/scrollbar, 4 keyframes, 4 anim classes, 4 delays, range styling |

**Do not invent:** no new `NavPage`, no new `MOCK_*`, no new button variant, no new page.

---

*End of PRD. Phase 1 is visual-complete when §8 all boxes are checked.*
