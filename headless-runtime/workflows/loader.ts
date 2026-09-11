/**
 * Descubrimiento y carga de workflows YAML.
 * Precedencia: bundled (factory/workflows) < global (~/.termcanvas/workflows) < repo (.agents/workflows).
 * Soporta layout flat (<root>/<name>.yaml) y empaquetado (<root>/<pack>/<name>/workflow.yaml).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { WorkflowDefinition } from "./schema";
import { formatSchemaIssues, WorkflowSchema } from "./schema";
import { validateWorkflow } from "./graph";
import { WorkflowValidationError } from "./errors";
import type { LoadedWorkflow } from "./executor";

export type WorkflowScope = "repo" | "global" | "bundled";

export interface DiscoveredWorkflow {
  name: string;
  filePath: string;
  scope: WorkflowScope;
  source: string;
}

export interface DiscoverWorkflowOptions {
  repoRoot: string;
  globalDir?: string;
  bundledDir?: string;
}

export interface LoadedWorkflowSource extends LoadedWorkflow {
  scope: WorkflowScope;
}

export function defaultGlobalWorkflowsDir(): string {
  return (
    process.env.TERMCANVAS_WORKFLOWS_DIR ??
    path.join(os.homedir(), ".termcanvas", "workflows")
  );
}

export function defaultBundledWorkflowsDir(repoRoot: string): string {
  return path.join(repoRoot, "factory", "workflows");
}

export function repoWorkflowsDir(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "workflows");
}

function workflowNameFromSource(source: string, fallback: string): string {
  try {
    const doc = parseYaml(source) as { name?: unknown } | null;
    if (doc && typeof doc.name === "string" && doc.name.trim()) {
      return doc.name.trim();
    }
  } catch {
    // nombre inválido: cae al fallback y el error real aparece al cargar
  }
  return fallback;
}

function scanRoot(
  rootDir: string,
  scope: WorkflowScope,
  out: Map<string, DiscoveredWorkflow>,
): void {
  if (!fs.existsSync(rootDir)) return;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
      const filePath = path.join(rootDir, entry.name);
      const source = fs.readFileSync(filePath, "utf-8");
      const fallback = entry.name.replace(/\.ya?ml$/i, "");
      const name = workflowNameFromSource(source, fallback);
      out.set(name, { name, filePath, scope, source });
      continue;
    }
    if (!entry.isDirectory()) continue;
    const candidates = [
      path.join(rootDir, entry.name, "workflow.yaml"),
      path.join(rootDir, entry.name, "workflow.yml"),
    ];
    const filePath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!filePath) continue;
    const source = fs.readFileSync(filePath, "utf-8");
    const name = workflowNameFromSource(source, entry.name);
    out.set(name, { name, filePath, scope, source });
  }
}

export function discoverWorkflows(
  opts: DiscoverWorkflowOptions,
): Map<string, DiscoveredWorkflow> {
  const out = new Map<string, DiscoveredWorkflow>();
  scanRoot(
    opts.bundledDir ?? defaultBundledWorkflowsDir(opts.repoRoot),
    "bundled",
    out,
  );
  scanRoot(opts.globalDir ?? defaultGlobalWorkflowsDir(), "global", out);
  scanRoot(repoWorkflowsDir(opts.repoRoot), "repo", out);
  return out;
}

export function parseWorkflowDefinition(
  source: string,
  filePath: string,
): WorkflowDefinition {
  let doc: unknown;
  try {
    doc = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowValidationError(`${filePath}: YAML inválido — ${message}`);
  }
  const parsed = WorkflowSchema.safeParse(doc);
  if (!parsed.success) {
    throw new WorkflowValidationError(
      `${filePath}: schema inválido\n${formatSchemaIssues(parsed.error)}`,
    );
  }
  validateWorkflow(parsed.data);
  return parsed.data;
}

export function loadWorkflow(
  name: string,
  opts: DiscoverWorkflowOptions,
): LoadedWorkflowSource {
  const discovered = discoverWorkflows(opts);
  const found = discovered.get(name);
  if (!found) {
    const available = [...discovered.keys()].sort().join(", ") || "(ninguno)";
    throw new WorkflowValidationError(
      `workflow "${name}" no encontrado. Disponibles: ${available}`,
    );
  }
  const def = parseWorkflowDefinition(found.source, found.filePath);
  const digest = crypto.createHash("sha256").update(found.source).digest("hex");
  return {
    def,
    source: found.source,
    sourcePath: found.filePath,
    digest,
    dir: path.dirname(found.filePath),
    scope: found.scope,
  };
}

export function listWorkflowSummaries(opts: DiscoverWorkflowOptions): Array<{
  name: string;
  description: string;
  tags: string[];
  scope: WorkflowScope;
  filePath: string;
}> {
  const summaries = [];
  for (const found of discoverWorkflows(opts).values()) {
    try {
      const def = parseWorkflowDefinition(found.source, found.filePath);
      summaries.push({
        name: def.name,
        description: def.description,
        tags: def.tags,
        scope: found.scope,
        filePath: found.filePath,
      });
    } catch (error) {
      summaries.push({
        name: found.name,
        description: `(inválido) ${error instanceof Error ? error.message : String(error)}`,
        tags: [],
        scope: found.scope,
        filePath: found.filePath,
      });
    }
  }
  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}
