import { z } from "zod";
import type { LineCounter } from "yaml";
import { lineForPath } from "../domain/validation.lineCounter";

// SRP: shared primitives reused across factory/agent/runner schemas

export const ownerNameSchema = z
  .string()
  .trim()
  .min(1, "owner required")
  .regex(/^[A-Za-z0-9_.-]+$/, "owner: allowed [A-Za-z0-9._-]")
  .transform((v) => {
    return v.trim();
  });

export const harnessTypeSchema = z.enum(["oz"]);

export const harnessSchema = z
  .object({
    type: harnessTypeSchema,
    model: z.string().min(1).optional(),
    reasoningLevel: z.string().optional(),
    auth: z
      .object({
        source: z.enum(["managedSecret", "workerEnvironment"]),
        secretName: z.string().min(1).optional(),
      })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.auth) {
      ctx.addIssue({ code: "custom", message: "harness type 'oz' must not have auth (solo oz, sin credenciales externas)", path: ["auth"] });
    }
    if (val.reasoningLevel) {
      ctx.addIssue({ code: "custom", message: "reasoningLevel no aplica para oz", path: ["reasoningLevel"] });
    }
  });

export const mcpServerRefSchema = z.object({
  warpId: z
    .string()
    .trim()
    .min(1, "warpId required")
    .refine((v) => !/^\s*$/.test(v), "warpId cannot be whitespace")
    .refine((v) => v.trim() === v, "warpId must be trimmed"),
});

export const credentialStrategySchema = z.enum(["EXECUTOR", "CREATOR"]);

export const agentTypeSchema = z.enum(["CUSTOM", "FOREMAN", "MAIN", "TRIAGE", "SPEC", "IMPLEMENT", "REVIEW", "VERIFY"]);

export const runnerInputShapeSchema = z.object({
  vcpus: z.number().int().positive(),
  memoryGb: z.number().positive(),
});

function findLineForPath(raw: string, path: (string | number)[]): number | undefined {
  if (!raw || path.length === 0) return undefined;
  const last = path[path.length - 1];
  const key = String(last);
  // Search for key: either "key:" or '"key":' or "'key':" at line start (allow indent)
  const lines = raw.split("\n");
  // Try exact key match first: line trimmed starts with key + ":" or `"key":` or `'key':`
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith(`${key}:`) || trimmed.startsWith(`"${key}":`) || trimmed.startsWith(`'${key}':`) || trimmed.startsWith(`${key} :`)) {
      return i + 1;
    }
  }
  // Fallback: any line containing "key:" with word boundary
  const needle = `${key}:`;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i + 1;
  }
  // Fallback: search for second-to-last segment if nested (e.g. repositories -> owner)
  if (path.length > 1) {
    const parent = String(path[path.length - 2]);
    const parentNeedle = `${parent}:`;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(parentNeedle)) return i + 1;
    }
  }
  return undefined;
}

export function zodToParseIssues(
  error: z.ZodError,
  file: string,
  raw?: string,
  lineCounter?: LineCounter,
) {
  return error.issues.map((i) => {
    const filteredPath = i.path.filter((k): k is string | number => typeof k === "string" || typeof k === "number");
    const basePath = filteredPath.length ? `${file}.${String(filteredPath.join("."))}` : file;
    if (!raw) {
      return { path: basePath, message: i.message, code: i.code };
    }
    // Prefer LineCounter (yaml) for file+line real — ~20 LOC wrapper, exact offset.
    let line: number | undefined;
    if (lineCounter) {
      const pos = lineForPath(lineCounter, filteredPath);
      if (pos) line = pos.line;
    }
    // Fallback to string search if LineCounter didn't resolve (no dep nueva).
    if (line === undefined) {
      line = findLineForPath(raw, filteredPath);
    }
    if (line) {
      return { path: `${file}:${line} — ${String(filteredPath.join("."))}`, message: i.message, code: i.code };
    }
    return { path: basePath, message: i.message, code: i.code };
  });
}

export function parseYamlLineFromMessage(msg: string): number | undefined {
  const m = msg.match(/line (\d+), column \d+/i) ?? msg.match(/at line (\d+)/i);
  if (m) return Number(m[1]);
  return undefined;
}
