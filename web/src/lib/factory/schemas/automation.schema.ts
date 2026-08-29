import { z } from "zod";
import { harnessSchema, mcpServerRefSchema } from "./common.schema";


const triggerSchema = z.object({
  provider: z.enum(["github", "gitlab", "linear", "jira", "slack", "schedule", "factory"]),
  event: z.string().min(1),
  filter: z.record(z.string(), z.unknown()).optional(),
  schedule: z.string().min(1).optional(),
  name: z.string().optional(),
});

export const automationFrontmatterSchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    agent: z.string().min(1).optional().default("foreman"),
    triggers: z.array(triggerSchema).min(1, "at least one trigger required"),
    model: z.string().optional(),
    harness: harnessSchema.optional(),
    runner: z.string().optional(),
    environmentId: z.string().optional(),
    secrets: z.array(z.string()).optional(),
    mcpServers: z.record(z.string(), mcpServerRefSchema).optional(),
    workerHost: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.model && val.harness) {
      ctx.addIssue({ code: "custom", message: "automation: set exactly one of model or harness", path: ["model"] });
    }
    for (let i = 0; i < val.triggers.length; i++) {
      const t = val.triggers[i];
      if (t.provider === "schedule" && !t.schedule) {
        // schedule trigger needs schedule
        if (t.event !== "cron_fired") {
          ctx.addIssue({ code: "custom", message: "schedule provider requires schedule field", path: ["triggers", i.toString(), "schedule"] });
        }
      }
    }
  })
  .strict();

export type AutomationFrontmatter = z.output<typeof automationFrontmatterSchema>;
