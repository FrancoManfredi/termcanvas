import { z } from "zod";


// SRP: shared primitives reused across factory/agent/runner schemas

export const ownerNameSchema = z
  .string()
  .trim()
  .min(1, "owner required")
  .regex(/^[A-Za-z0-9_.-]+$/, "owner: allowed [A-Za-z0-9._-]")
  .transform((v) => {
    return v.trim();
  });

export const harnessTypeSchema = z.enum(["oz", "claude", "claude-code", "codex", "gemini"]);

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
    if (val.type === "oz" && val.auth) {
      ctx.addIssue({ code: "custom", message: "harness type 'oz' must not have auth", path: ["auth"] });
    }
    if ((val.type === "claude" || val.type === "claude-code" || val.type === "codex") && val.auth?.source === "managedSecret" && !val.auth.secretName) {
      ctx.addIssue({ code: "custom", message: "managedSecret auth requires secretName", path: ["auth", "secretName"] });
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

export function zodToParseIssues(error: z.ZodError, file: string) {
  return error.issues.map((i) => ({
    path: i.path.length ? `${file}.${String(i.path.join("."))}` : file,
    message: i.message,
    code: i.code,
  }));
}
