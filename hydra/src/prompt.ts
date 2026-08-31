export interface SpawnContext {
  task: string;
  worktreePath: string;
  branch: string | null;
  baseBranch: string;
  resultFile: string;
}

/**
 * Build the full task file content written to the agent-specific task file in the worktree.
 * The sub-agent reads this file for context.
 */
export function buildTaskFileContent(ctx: SpawnContext): string {
  const lines = [
    `# Hydra Sub-Agent Task`,
    ``,
    `You are working in an isolated git worktree.`,
    ``,
    `- Worktree: ${ctx.worktreePath}`,
    `- Branch: ${ctx.branch ?? "(existing worktree)"}`,
    `- Base branch: ${ctx.baseBranch}`,
    ``,
    `## Task`,
    ``,
    ctx.task,
    ``,
    `## Rules`,
    ``,
    `- Stay within this worktree. Do not modify files outside it.`,
    `- Commit your changes before finishing.`,
    `- Do not push to remote.`,
    `- Before finishing, write \`${ctx.resultFile}\` in the worktree root with:`,
    `  - Files changed and why`,
    `  - Issues found (if audit/review task)`,
    `  - Whether tests pass`,
    `  - Any unresolved problems`,
    ``,
  ];
  return lines.join("\n");
}

/**
 * Build the single-line initial prompt passed as a CLI argument.
 * Newlines are collapsed to spaces — CLI args must be a single string.
 */
export function buildSpawnInput(task: string, taskFile = ".hydra-task.md"): string {
  const safeTask = task.replace(/[\r\n]+/g, " ").trim();
  return `Read ${taskFile} for full context and rules, then execute the task: ${safeTask}`;
}
