/**
 * Neutral facade — single entry for harness-agnostic code.
 *
 * Add a new harness by implementing:
 *   - HarnessMcpAdapter       (shared/neutral/mcp.ts)
 *   - HarnessSkillAdapter     (shared/neutral/skills.ts)
 *   - HarnessInstructionAdapter (shared/neutral/instructions.ts)
 * and registering it in the corresponding adapter registry
 * (electron/mcp/adapters/, src/skills/adapters/, etc.)
 * without touching shared/mcp.ts or manager.ts.
 */

export * from "./mcp.ts";
export * from "./skills.ts";
export * from "./instructions.ts";
