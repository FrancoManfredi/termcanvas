/**
 * Runner config-as-code — zod validation + yaml loader.
 * Lee runners/linux-build.yaml y valida contra RunnerSpecSchema.
 * Ola 1: solo resuelve spec, no spawnea Docker.
 *
 * Si `yaml` package no está instalado, usa parser manual minimal para este archivo.
 * Así no rompemos pnpm build/typecheck sin nueva dep.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  RunnerSpecSchema,
  type RunnerSpec,
} from "../../shared/types/runner";

// Re-export for convenience
export { RunnerSpecSchema, type RunnerSpec };

/**
 * Fallback OBSOLETO para yaml ausente/ilegible (legado Ola 1).
 * NO pretende ser verdad: la imagen real vive en
 * factory/runners/linux-build.yaml y se lee vía agentLoader.getRunner.
 * Sin dockerImage a propósito (cero hardcodeos): el schema genérico
 * (shared/types/runner.ts) la exige solo cuando isolation es "docker",
 * y este fallback declara isolation "none" honesto (local) hasta que
 * el yaml vuelva. Se conserva solo para no romper callers sync que
 * esperan un RunnerSpec ante yaml ausente.
 */
export const LINUX_BUILD_FALLBACK: RunnerSpec = {
  id: "linux-build",
  os: "linux",
  arch: "x86_64",
  instanceShape: {
    cpu: "4vCPU",
    cpuCount: 4,
    memory: "8GB",
    memoryGB: 8,
  },
  setupCommands: ["corepack enable"],
  workdir: "/workspace",
  description: "Linux build runner (fallback obsoleto: yaml ausente, local honesto)",
  isolation: "none",
};

function getRepoRoot(): string {
  try {
    const current = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(current), "../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {}
  try {
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, "package.json")) &&
      fs.existsSync(path.join(cwd, "runners"))
    )
      return cwd;
    const parent = path.resolve(cwd, "..");
    if (
      fs.existsSync(path.join(parent, "package.json")) &&
      fs.existsSync(path.join(parent, "runners"))
    )
      return parent;
  } catch {}
  return process.cwd();
}

function getRunnerYamlPath(id: string): string {
  const repoRoot = getRepoRoot();
  return path.join(repoRoot, "runners", `${id}.yaml`);
}

/**
 * Minimal yaml parser for our known linux-build.yaml shape.
 * Handles:
 *  - top-level keys: id, os, arch, dockerImage, workdir, description
 *  - nested instanceShape with 4 keys
 *  - setupCommands list with "- "
 */
function parseSimpleYaml(content: string): unknown {
  const lines = content.split("\n");
  const result: Record<string, unknown> = {};
  let currentParent: string | null = null;
  let parentIndent = -1;
  let listKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Handle list items "- corepack enable"
    if (trimmed.startsWith("- ")) {
      if (listKey) {
        const arr = result[listKey] as unknown[] | undefined;
        const value = trimmed.slice(2).trim();
        if (Array.isArray(arr)) arr.push(value);
        else if (currentParent && typeof result[currentParent] === "object") {
          // nested list inside parent? not in our yaml, but handle
          const parentObj = result[currentParent] as Record<string, unknown>;
          if (Array.isArray(parentObj[listKey])) {
            (parentObj[listKey] as unknown[]).push(value);
          }
        }
      }
      continue;
    }

    // Reset list context if indent back to parent
    if (listKey && indent <= parentIndent) {
      listKey = null;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const valuePart = trimmed.slice(colonIdx + 1).trim();

    if (indent === 0) {
      currentParent = null;
      parentIndent = -1;
      listKey = null;
      if (valuePart === "") {
        // Could be parent for nested object or list
        if (key === "instanceShape") {
          currentParent = key;
          parentIndent = indent;
          result[key] = {};
        } else if (key === "setupCommands") {
          result[key] = [];
          listKey = key;
          parentIndent = indent;
        } else {
          result[key] = {};
          currentParent = key;
          parentIndent = indent;
        }
      } else {
        // scalar value - try to coerce numbers
        let value: unknown = valuePart;
        if (/^-?\d+$/.test(valuePart)) value = Number(valuePart);
        else if (/^-?\d+\.\d+$/.test(valuePart)) value = Number(valuePart);
        result[key] = value;
      }
    } else {
      // nested under currentParent
      if (currentParent && typeof result[currentParent] === "object") {
        const parentObj = result[currentParent] as Record<string, unknown>;
        if (valuePart === "") {
          // nested list or object
          if (Array.isArray(parentObj[key])) {
            // already list
          } else {
            // Could be new nested structure
            parentObj[key] = [];
            listKey = key;
          }
        } else {
          let value: unknown = valuePart;
          if (/^-?\d+$/.test(valuePart)) value = Number(valuePart);
          else if (/^-?\d+\.\d+$/.test(valuePart)) value = Number(valuePart);
          parentObj[key] = value;
        }
      }
    }
  }

  return result;
}

async function tryParseWithYamlPackage(content: string): Promise<unknown | null> {
  // Ola 1: no require yaml package — use manual parser only to avoid extra dep.
  // If yaml is later added, this can be enabled by uncommenting.
  void content;
  return null;
}

/**
 * Loads and validates a RunnerSpec by id.
 * Reads runners/{id}.yaml, parses yaml, validates with zod.
 * Returns fallback spec if file missing but id is linux-build (Ola 1 stub).
 */
export async function loadRunnerSpec(id: string): Promise<RunnerSpec> {
  if (id !== "linux-build") {
    throw Object.assign(new Error(`unknown runner id: ${id}`), {
      status: 404,
    });
  }

  const yamlPath = getRunnerYamlPath(id);
  let rawContent: string | null = null;
  try {
    if (fs.existsSync(yamlPath)) {
      rawContent = fs.readFileSync(yamlPath, "utf-8");
    }
  } catch {
    // ignore
  }

  if (!rawContent) {
    // fallback hardcoded — still validate
    return RunnerSpecSchema.parse(LINUX_BUILD_FALLBACK);
  }

  let parsed: unknown = null;
  const withPackage = await tryParseWithYamlPackage(rawContent);
  if (withPackage !== null) {
    parsed = withPackage;
  } else {
    parsed = parseSimpleYaml(rawContent);
  }

  // Validate with zod
  try {
    return RunnerSpecSchema.parse(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw Object.assign(
      new Error(`invalid runner spec ${id}: ${msg}`),
      { status: 500 },
    );
  }
}

/**
 * Sync variant for Node contexts where async not needed (uses fallback or manual parse).
 * Useful for factoryServer sync paths.
 */
export function loadRunnerSpecSync(id: string): RunnerSpec {
  if (id !== "linux-build") {
    throw Object.assign(new Error(`unknown runner id: ${id}`), {
      status: 404,
    });
  }
  const yamlPath = getRunnerYamlPath(id);
  let rawContent: string | null = null;
  try {
    if (fs.existsSync(yamlPath)) {
      rawContent = fs.readFileSync(yamlPath, "utf-8");
    }
  } catch {
    // ignore
  }
  if (!rawContent) {
    return RunnerSpecSchema.parse(LINUX_BUILD_FALLBACK);
  }
  const parsed = parseSimpleYaml(rawContent);
  return RunnerSpecSchema.parse(parsed);
}

/**
 * Validate an unknown object as RunnerSpec (zod).
 */
export function validateRunnerSpec(data: unknown): RunnerSpec {
  return RunnerSpecSchema.parse(data);
}

// Zod schema for external callers that want to validate raw yaml object
export const runnerSpecSchema = RunnerSpecSchema;
