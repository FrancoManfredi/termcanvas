# Warp Factories delivery report

**Date:** 2026-08-30
**Scope:** `web/` package of TermCanvas

## TL;DR

Implemented the open product slices for factory workspace management, GitHub dual-label routing, Factory/Agent API stubs, Quickstart onboarding, navigation/hygiene, and the existing lifecycle/dashboard foundations. The web package is type-safe, lint-clean, test-green, and builds successfully.

## Ticket status

| Ticket | Status | Main delivery |
|---|---|---|
| T01 | Complete | React/Vite shell, typed navigation, stores, ErrorBoundary, theme and test configuration |
| T02 | Complete | Factory CRUD, persistence, alias/name validation, selection, pinning, glossary, one-policy invariant |
| T03 | Complete for implemented lifecycle slice | Work Item stages, skip logic, human gates, terminal transitions, activity filtering |
| T04 | Partial | Agent models/pages and defaults exist; full harness/provider credential workflows remain outside this slice |
| T05 | Complete for registry slice | Global/per-agent skill registry, preview and self-improvement surface |
| T06 | Partial | Parsers/schemas and definition surfaces exist; full PR-check integration is not implemented |
| T07 | Complete for implemented engine slice | Trigger catalog, matching, AND/OR and schedule/factory primitives |
| T08 | Complete for implemented model slice | Runner constraints, platform/shape validation and per-agent selection surfaces |
| T09 | Complete for local routing slice | Dual label + mention gate, custom handles, edit/bot/code exclusions, simulator and tests |
| T10 | Partial | Integration surface and deep-dive UI exist; live Slack OAuth/Home tab are not connected |
| T11 | Partial | Linear/Jira/GitLab and schedule/factory surfaces exist; live provider credentials and external calls are not connected |
| T12 | Partial | Dashboard, Activity, Runs and Settings slices exist; some full definition/settings parity remains |
| T13 | Partial | Scorers and self-improvement surfaces exist; full benchmark execution is not implemented |
| T14 | Complete for local stub contract | 19-tool MCP behavior and in-process Factory/Agent API routes, follow-ups and cancellation |
| T15 | Complete for Quickstart slice | Seven-step wizard, optional integrations, agent invariants, MCP alternative and first work item |
| T16 | Complete | Troubleshooting/help content and navigation integration |

## Quickstart delivery

Created:

- `src/lib/factory/domain/quickstart.wizard.ts`
- `src/lib/factory/domain/quickstart.data.ts`
- `src/lib/factory/hooks/useQuickstart.ts`
- `src/components/quickstart/QuickstartWizard.tsx`
- `src/lib/factory/__tests__/quickstart.test.ts`

The flow is `source → repos → identity → slack → agents → tracker → review`. It supports GitHub/GitLab selection, one or two repositories, progressive alias derivation, optional Slack and Linear/Jira, at least one active agent with Implement required, and a Factory MCP external-onboarding alternative. The canonical first work-item prompt is preserved verbatim.

## Other key changes

- Added `Factory API` and `GitHub routing` navigation pages with lazy routes.
- GitHub routing modules: `src/lib/factory/domain/github.routing.ts`, `github.routing.derive.ts`, `src/components/routing/GitHubRoutingPage.tsx`, and focused routing tests.
- Factory API modules: `src/lib/factory/domain/factoryApi.types.ts`, `factoryApi.routes.ts`, `factoryApi.router.ts`, `factoryApi.snippets.ts`, plus `src/components/factory-api/FactoryApiPage.tsx` and API tests.
- Added case-insensitive factory search and local API validation for `ticket_ref`. 
- Added additive known-factory synchronization so MCP initialization cannot erase user-created factories.
- Added focused routing and API tests and fixed the Windows Vitest pool configuration.
- Ignored generated `dist`, `dist-verify`, and dependency output in oxlint.

## Validation

- Full Vitest suite: **33 files passed, 847 tests passed**.
- Quickstart focused suite: **5 tests passed**.
- TypeScript: `tsc --noEmit` passed with 0 errors.
- Oxlint: passed with 0 warnings and 0 errors across 158 files.
- Vite production build: passed; generated verification output was removed afterwards.
- `git diff --check`: passed; Git reports only line-ending normalization warnings.

## Limitations and blockers

- No product-level credentials, tokens, or user decisions are required for the local implementation.
- Playwright MCP was unavailable, so browser smoke validation was not executed.
- A usable debugger MCP session was unavailable; static checks and test runners were used instead.
- Live GitHub, Slack, Linear, Jira, GitLab, Factory MCP, and cloud API calls remain intentionally mocked/local and require external credentials/configuration before production integration.
- The repository's OneDrive-backed nested Git ref/index state remains an environment concern; staging must stay scoped to `web/` and avoid broad `git add -A`.

## Recommended next steps

1. Connect provider credentials and validate each live integration in a controlled environment.
2. Add Playwright smoke tests for Quickstart, navigation, routing simulator, and API console.
3. Complete the remaining partial T04/T06/T10–T13 parity slices if production fidelity is required.
4. Repair/verify the Git index before committing the complete `web/` change set.
