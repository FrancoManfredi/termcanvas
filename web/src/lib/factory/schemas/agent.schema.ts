import { z } from "zod";
import { agentTypeSchema, credentialStrategySchema, harnessSchema, mcpServerRefSchema } from "./common.schema";

// Schema plano para harness matrix testing — permite validar harness/reasoningLevel/auth sin anidar.
// Source: WarpFactories.md §4 · US-020, US-022, US-023 · T04
// Codes testeables: reasoningLevel_only_codex, free_only_oz, invalid_harness, invalid_auth
export const AgentHarnessSchema = z
  .object({
    harness: z.enum(["oz", "claude", "codex", "gemini"]),
    reasoningLevel: z.string().optional(),
    auth: z.enum(["managedSecret", "workerEnvironment"]).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.reasoningLevel !== undefined && v.harness !== "codex") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasoningLevel"],
        message: "reasoningLevel solo aplica a codex",
        params: { code: "reasoningLevel_only_codex" },
      } as never);
    }
    // Gate Free solo oz — simulación LOCAL sin backend: harness distinto de oz requiere plan Pro.
    // En WarpFactories.md §4 Free tier solo oz; todos los demás harness requieren validación de plan.
    // Aquí lo testeamos como error con code free_only_oz para que ValidationPage pueda pintar file:line.
    if (v.harness !== "oz") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["harness"],
        message: "Free solo permite harness oz — usa plan Pro para claude/codex/gemini",
        params: { code: "free_only_oz" },
      } as never);
    }
  });

export type AgentHarness = z.output<typeof AgentHarnessSchema>;

export const agentFrontmatterSchema = z
  .object({
    description: z.string().optional(),
    agentType: agentTypeSchema.optional().default("CUSTOM"),
    credentialStrategy: credentialStrategySchema.optional(),
    model: z.string().min(1).optional(),
    harness: harnessSchema.optional(),
    runner: z.string().min(1).optional(),
    environmentId: z.string().min(1).optional(),
    secrets: z.array(z.string().min(1)).optional(),
    mcpServers: z.record(z.string().min(1), mcpServerRefSchema).optional(),
    workerHost: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.model && val.harness) {
      ctx.addIssue({ code: "custom", message: "agent: set exactly one of model or harness", path: ["model"] });
      ctx.addIssue({ code: "custom", message: "agent: set exactly one of model or harness", path: ["harness"] });
    }
    // either is allowed to be missing (inherits from agentDefaults), so no required check here
  })
  .strict();

export type AgentFrontmatter = z.output<typeof agentFrontmatterSchema>;
