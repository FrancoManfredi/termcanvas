/**
 * Artefactos por run: layout en disco, transcript JSONL y redacción de secretos.
 * Layout: <runsDir>/<runId>/{run.json,events.jsonl,artifacts/,state/}
 */

import fs from "node:fs";
import path from "node:path";
import type { WorkflowEvent } from "./types";

const SECRET_ENV_PATTERN = /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i;

export function defaultRunsDir(): string {
  const factoryDir = process.env.TERMCANVAS_FACTORY_DIR;
  if (factoryDir) return path.join(factoryDir, "workflow-runs");
  return path.join(process.cwd(), ".agents", "factory", "workflow-runs");
}

/** Reemplaza valores de credenciales presentes en el entorno por [REDACTED]. */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let redacted = text;
  const values = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 8) continue;
    if (SECRET_ENV_PATTERN.test(name)) values.add(value);
  }
  for (const value of values) {
    if (redacted.includes(value)) {
      redacted = redacted.split(value).join("[REDACTED]");
    }
  }
  return redacted;
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export class RunArtifacts {
  readonly runDir: string;
  readonly artifactsDir: string;
  readonly stateDir: string;
  readonly nodesDir: string;

  constructor(
    readonly runsDir: string,
    readonly runId: string,
  ) {
    this.runDir = path.join(runsDir, runId);
    this.artifactsDir = path.join(this.runDir, "artifacts");
    this.stateDir = path.join(this.runDir, "state");
    this.nodesDir = path.join(this.artifactsDir, "nodes");
  }

  get eventsPath(): string {
    return path.join(this.runDir, "events.jsonl");
  }

  get runJsonPath(): string {
    return path.join(this.runDir, "run.json");
  }

  init(): void {
    fs.mkdirSync(this.nodesDir, { recursive: true });
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  appendEvent(event: WorkflowEvent): void {
    fs.mkdirSync(this.runDir, { recursive: true });
    fs.appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, "utf-8");
  }

  writeNodeOutput(nodeId: string, output: string): string {
    const filePath = path.join(this.nodesDir, `${nodeId}.out`);
    fs.mkdirSync(this.nodesDir, { recursive: true });
    fs.writeFileSync(filePath, output, "utf-8");
    return filePath;
  }

  writeNodeStructured(nodeId: string, outputJson: unknown): string {
    const filePath = path.join(this.nodesDir, `${nodeId}.json`);
    writeJsonAtomic(filePath, outputJson);
    return filePath;
  }

  writeNodeSidecar(nodeId: string, outputType: string, output: string): string {
    const filePath = path.join(this.nodesDir, `${nodeId}.md`);
    const body = `---\noutput_type: ${outputType}\nrun_id: ${this.runId}\n---\n\n${output}\n`;
    fs.mkdirSync(this.nodesDir, { recursive: true });
    fs.writeFileSync(filePath, body, "utf-8");
    return filePath;
  }
}
