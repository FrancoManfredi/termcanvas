/**
 * Neutral Instructions layer — AGENTS.md / rules for all harnesses.
 *
 * Today AGENTS.md lives only in ~/.config/opencode/AGENTS.md and contains
 * three concatenated blocks:
 *   1. CodeGraph guidance  (<!-- gentle-ai:codegraph-guidance -->)
 *   2. Engram protocol     (<!-- gentle-ai:engram-protocol -->)
 *   3. Persona             (<!-- gentle-ai:persona -->)
 * plus any project-local AGENTS.md / CLAUDE.md / .codebuddy/rules files.
 *
 * In the neutral model, instructions are stored as discrete blocks in
 * ~/.termcanvas/neutral/instructions/ (or .agents/instructions/ for
 * project-scoped) and each harness adapter concatenates + writes them
 * to the file/location that harness reads:
 *   - opencode:  ~/.config/opencode/AGENTS.md  +  <project>/AGENTS.md  (agent.gentleman prompt {file:./AGENTS.md})
 *   - codebuddy: <project>/.codebuddy/rules/*.md or <project>/AGENTS.md (see https://www.codebuddy.ai/docs/ide/User-guide/Rules)
 *   - claude:    <project>/CLAUDE.md
 *
 * Engram and CodeGraph are first-class neutral capabilities, not "opencode MCPs".
 * Their instruction blocks travel with the MCP definitions so every harness
 * gets the same behavior.
 */

export type InstructionBlockId = "codegraph" | "engram" | "persona" | "project" | "custom";

export interface InstructionBlock {
  id: InstructionBlockId | (string & {});
  /** Human title, e.g. "CodeGraph" */
  title: string;
  /** Raw markdown (may contain HTML comments like <!-- gentle-ai:... -->). */
  content: string;
  /** Where it was sourced from — for diagnostics, not for harness logic. */
  source: "neutral:global" | "neutral:project" | "opencode:global" | "codebuddy:rules" | "file";
  /** Optional source path for migration / debugging. */
  sourcePath?: string;
  /** Sort order for concatenation (lower first). */
  order: number;
}

export const DEFAULT_BLOCK_ORDER: Record<InstructionBlockId, number> = {
  codegraph: 10,
  engram: 20,
  persona: 30,
  project: 40,
  custom: 100,
};

export function getBlockOrder(id: string): number {
  return (DEFAULT_BLOCK_ORDER as Record<string, number>)[id] ?? DEFAULT_BLOCK_ORDER.custom;
}

/**
 * Parse a concatenated AGENTS.md into blocks by gentle-ai markers.
 * Pure — no IO. Returns blocks in encountered order.
 */
export function parseAgentsMdIntoBlocks(raw: string, source: InstructionBlock["source"] = "file", sourcePath?: string): InstructionBlock[] {
  const blocks: InstructionBlock[] = [];
  // Match <!-- gentle-ai:xxx --> ... <!-- /gentle-ai:xxx -->  (or until next marker / EOF)
  const markerRe = /<!--\s*gentle-ai:([a-z-]+)\s*-->([\s\S]*?)(?=<!--\s*gentle-ai:[a-z-]+\s*-->|$)/g;
  let m: RegExpExecArray | null;
  let foundMarkers = false;
  // eslint-disable-next-line no-cond-assign
  while ((m = markerRe.exec(raw))) {
    foundMarkers = true;
    const marker = m[1].trim();
    const content = m[2].trim();
    // Map marker to block id
    let id: InstructionBlockId = "custom";
    if (marker === "codegraph-guidance") id = "codegraph";
    else if (marker === "engram-protocol") id = "engram";
    else if (marker === "persona") id = "persona";
    else id = marker as InstructionBlockId;
    const full = `<!-- gentle-ai:${marker} -->\n${content}`.trim();
    blocks.push({
      id,
      title: id,
      content: full,
      source,
      sourcePath,
      order: getBlockOrder(id),
    });
  }
  if (!foundMarkers) {
    // No markers — treat whole file as single project block
    const trimmed = raw.trim();
    if (trimmed) {
      blocks.push({
        id: "project",
        title: "project",
        content: trimmed,
        source,
        sourcePath,
        order: getBlockOrder("project"),
      });
    }
  }
  return blocks.sort((a, b) => a.order - b.order);
}

/**
 * Concatenate blocks back into a single AGENTS.md string.
 * Preserves marker comments so parseAgentsMdIntoBlocks is round-trip.
 */
export function concatBlocksToAgentsMd(blocks: InstructionBlock[]): string {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  return sorted.map((b) => b.content.trim()).join("\n\n");
}

/**
 * Contract for harness instruction adapters.
 */
export interface HarnessInstructionAdapter {
  readonly harnessId: string;
  /**
   * Write neutral blocks to the location(s) the harness reads.
   * Should be idempotent and create parent dirs as needed.
   * Returns written paths for verification.
   */
  syncToHarness(projectPath: string | null, blocks: InstructionBlock[]): Promise<string[]>;

  /**
   * Read back blocks from harness locations (for migration / drift detection).
   */
  readFromHarness(projectPath: string | null): Promise<InstructionBlock[]>;
}

export const SUPPORTED_INSTRUCTION_HARNESSES = ["opencode", "codebuddy", "claude"] as const;
export type InstructionHarnessId = (typeof SUPPORTED_INSTRUCTION_HARNESSES)[number];
