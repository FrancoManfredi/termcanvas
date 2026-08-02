# Skill Registry - TermCanvas
# Generated: 2026-07-31

## Available Skills

### SDD Skills
- **sdd-init**: Initialize SDD context, testing capabilities, registry, and persistence
- **sdd-explore**: Explore SDD ideas before committing to a change
- **sdd-propose**: Create an SDD change proposal with intent, scope, and approach
- **sdd-spec**: Write SDD delta specs with requirements and scenarios
- **sdd-design**: Create the SDD technical design and architecture approach
- **sdd-tasks**: Break an SDD change into implementation tasks
- **sdd-apply**: Implement SDD tasks from specs and design
- **sdd-verify**: Execute tests and prove implementation matches specs, design, and tasks
- **sdd-archive**: Archive a completed SDD change by syncing delta specs
- **sdd-onboard**: Walk users through the SDD workflow on the real codebase

### Development Skills
- **brainstorming**: Creative work exploration before implementation
- **test-driven-development**: TDD workflow for features and bugfixes
- **systematic-debugging**: Structured debugging with hypothesis tracking
- **investigate**: Systematic debugging skill for bugs and unexpected behavior
- **writing-plans**: Implementation planning before coding
- **executing-plans**: Execute implementation plans with review checkpoints
- **subagent-driven-development**: Execute implementation plans with independent tasks
- **using-git-worktrees**: Create isolated git worktrees for feature work

### Code Quality Skills
- **code-review**: Multi-pass code review with specialist focus areas
- **receiving-code-review**: Handle code review feedback with technical rigor
- **requesting-code-review**: Request code review before merging
- **verification-before-completion**: Run verification before claiming work is complete
- **work-unit-commits**: Plan commits as reviewable work units

### Architecture Skills
- **impeccable**: Frontend interface design and polish
- **cognitive-doc-design**: Design docs that reduce cognitive load
- **comment-writer**: Write warm, direct collaboration comments
- **issue-creation**: Create issues with issue-first checks
- **branch-pr**: Create PRs with issue-first checks
- **chained-pr**: Split oversized changes into chained PRs

### HyperFrames Skills
- **hyperframes**: Entry point for HyperFrames video/animation work
- **hyperframes-animation**: Animation knowledge for HyperFrames
- **hyperframes-cli**: CLI development loop for HyperFrames
- **hyperframes-core**: Composition contract for HyperFrames
- **hyperframes-creative**: Non-animation creative direction
- **hyperframes-keyframes**: Seek-safe keyframes for HyperFrames
- **hyperframes-registry**: Registry blocks for HyperFrames

### Specialized Skills
- **media-use**: Media asset management for HyperFrames
- **nlm-skill**: NotebookLM CLI and MCP server
- **skill-creator**: Create LLM-first skills with valid frontmatter
- **skill-improver**: Audit and upgrade existing skills
- **skill-registry**: Index available skills by trigger and path

### Testing Skills
- **qa**: QA testing with real browser automation
- **go-testing**: Go testing patterns
- **security-audit**: Security audit with OWASP Top 10

### Workflow Skills
- **dispatching-parallel-agents**: Run parallel independent tasks
- **hydra**: Multi-agent orchestration workflow
- **challenge**: Adversarial review from multiple angles
- **judgment-day**: Dual review with fix/re-judgment rounds
- **using-superpowers**: Find and use skills effectively
- **using-termcanvas**: Route work in TermCanvas-managed repos

## Skill Resolution Rules

1. **Context Matching**: Match by file context (extensions, paths) and task context
2. **Multiple Skills**: Multiple skills can apply at once
3. **Blocking Requirement**: Read matching SKILL.md before generating reply
4. **Self-Check**: Check `<available_skills>` before every response
5. **Persona Scope**: Persona governs reply text, not artifacts
6. **Language Domain**: Artifacts default to English unless explicitly requested

## TermCanvas-Specific Patterns

### State Management
- 48 Zustand stores in `src/stores/`
- Store naming: `*Store.ts` pattern
- Middleware: debug, persistence

### Component Structure
- Components in `src/components/`
- UI primitives in `src/components/ui/`
- Hooks in `src/hooks/`
- Actions in `src/actions/`

### Canvas Architecture
- React Flow (@xyflow/react) for canvas
- Custom nodes in `src/canvas/xyflowNodes.tsx`
- Scene state management in `src/canvas/sceneState.ts`

### Terminal Integration
- xterm.js with WebGL rendering
- Custom @wterm/* packages
- Terminal state in `src/stores/terminalState.ts`

### Electron Integration
- Main process in `electron/`
- Preload bridge in `electron/preload.ts`
- IPC via `window.termcanvas` namespace

## Quick Reference

### Common Commands
- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm test` - Run test suite
- `pnpm typecheck` - Run TypeScript type checking
- `pnpm test:hydra` - Run Hydra tests

### Key Files
- `package.json` - Project configuration
- `vite.config.ts` - Build configuration
- `tsconfig.json` - TypeScript configuration
- `electron/main.ts` - Electron main process
- `src/App.tsx` - React application root

### Architecture Decisions
- Zustand over Redux for state management
- React Flow over custom canvas implementation
- xterm.js over custom terminal emulator
- pnpm over npm/yarn for package management
- Node.js test runner over Jest/Vitest