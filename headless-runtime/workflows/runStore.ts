/**
 * Persistencia de runs del workflow engine: run.json + events.jsonl por run.
 * Escritura atómica (tmp + rename) y listado por fecha descendente.
 */

import fs from "node:fs";
import path from "node:path";
import { RunArtifacts, writeJsonAtomic } from "./artifacts";
import type { WorkflowRun } from "./types";

export interface CreateRunInput {
  workflow: string;
  description: string;
  inputs: Record<string, unknown>;
  args: string;
  sourceDigest: string;
  sourcePath: string;
}

let sequence = 0;

function newRunId(): string {
  sequence = (sequence + 1) % 1_000_000;
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `run-${stamp}-${sequence.toString(36)}-${rand}`;
}

export class WorkflowRunStore {
  constructor(readonly runsDir: string) {}

  artifactsFor(runId: string): RunArtifacts {
    return new RunArtifacts(this.runsDir, runId);
  }

  create(input: CreateRunInput): WorkflowRun {
    const id = newRunId();
    const artifacts = this.artifactsFor(id);
    artifacts.init();
    const run: WorkflowRun = {
      id,
      workflow: input.workflow,
      description: input.description,
      status: "pending",
      startedAt: new Date().toISOString(),
      inputs: input.inputs,
      args: input.args,
      nodes: {},
      sourceDigest: input.sourceDigest,
      sourcePath: input.sourcePath,
      artifactsDir: artifacts.artifactsDir,
    };
    this.save(run);
    return run;
  }

  save(run: WorkflowRun): void {
    writeJsonAtomic(this.artifactsFor(run.id).runJsonPath, run);
  }

  load(runId: string): WorkflowRun | null {
    const filePath = this.artifactsFor(runId).runJsonPath;
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as WorkflowRun;
    } catch {
      return null;
    }
  }

  list(limit = 50): WorkflowRun[] {
    if (!fs.existsSync(this.runsDir)) return [];
    const runs: WorkflowRun[] = [];
    for (const entry of fs.readdirSync(this.runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const run = this.load(entry.name);
      if (run) runs.push(run);
    }
    runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return runs.slice(0, limit);
  }
}
