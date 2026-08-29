// Fixtures — SRP: only test data for Skills (WarpFactories.md §5)
// Nombres exactos del doc: repository-conventions (global) e incident-triage (solo foreman)

export const SAMPLE_SKILL_REPOSITORY_CONVENTIONS = `---
name: repository-conventions
description: Enforce repository conventions for every PR before marking work complete
---
# Repository Conventions

This skill enforces the repository's standards for every pull request.

## Instructions

- Follow the repo's lint, test and validation commands before considering a change complete.
- Never approve your own edits; request independent review.
- Preserve file structure and naming conventions.

## Arguments

No required arguments. The skill is applied automatically.

## Edit location

- **Warp-managed**: Factory definition tab — save validates and commits in one step.
- **GitHub-backed**: edit \`skills/repository-conventions/SKILL.md\` and open PR; applies atomically on merge.
`;

export const SAMPLE_SKILL_INCIDENT_TRIAGE = `---
name: incident-triage
description: Runbook for incident triage — only foreman handles intake and routing
---
# Incident Triage

Per-agent skill for foreman only. Handles repeated incident categories using a shared runbook.

## Instructions

- When an incident arrives via Slack or GitHub, gather evidence, scope and complexity first.
- Reproduce only when investigation is insufficient.
- Route to the appropriate specialist agent with context preserved.

## Arguments

\`\`\`yaml
severity: low | medium | high
channel: string
\`\`\`

## Edit location

- **Warp-managed**: Factory definition tab.
- **GitHub-backed**: edit \`agents/foreman/skills/incident-triage/SKILL.md\` via PR.
`;
