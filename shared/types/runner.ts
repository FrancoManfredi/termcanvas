/**
 * Runner types — shared.
 * Canonical source: factory/runners/*.yaml (yaml is truth; this module
 * only validates generic shape, never concrete image names).
 * Loaded via headless-runtime/factory/agentLoader.getRunner; TS holds
 * zero image literals (even in comments).
 *
 * Refactor E2 3: thinned to a generic validator with `superRefine`
 * (zod 4, no legacy `.refine`):
 * - `isolation` closed enum none|docker (optional for legacy compat).
 * - non-empty image only when `isolation` is "docker" (legacy `dockerImage`
 *   or `platform.dockerImage`); honest absence when "none".
 * - `setupCommands` non-empty, no empty entries.
 * - positive shape (`cpuCount`/`memoryGB` > 0 when present).
 * - ZERO concrete image literals (image lives in yaml).
 * Otherwise additive only: legacy fields (`id`/`os`/`arch`/
 * `dockerImage`/`instanceShape`/`setupCommands`/`workdir`/`description`)
 * stay accepted as generic strings to avoid breaking live
 * consumers (runnerConfig/runnerService/factoryServer).
 */

import { z } from "zod";

export const InstanceShapeSchema = z.object({
  cpu: z.string(),
  cpuCount: z.number().int().min(1),
  memory: z.string(),
  memoryGB: z.number().min(1),
});

export type InstanceShape = z.infer<typeof InstanceShapeSchema>;

export const RunnerIsolationSchema = z.enum(["none", "docker"]);

export type RunnerIsolation = z.infer<typeof RunnerIsolationSchema>;

export const RunnerPlatformSchema = z.object({
  os: z.string().min(1),
  arch: z.string().min(1),
  dockerImage: z.string().min(1).optional(),
});

export type RunnerPlatform = z.infer<typeof RunnerPlatformSchema>;

export const RunnerSpecSchema = z
  .object({
    id: z.string().min(1),
    os: z.string().min(1),
    arch: z.string().min(1),
    dockerImage: z.string().min(1).optional(),
    instanceShape: InstanceShapeSchema,
    setupCommands: z.array(z.string()),
    workdir: z.string().optional(),
    description: z.string().optional(),
    isolation: RunnerIsolationSchema.optional(),
    platform: RunnerPlatformSchema.optional(),
  })
  .superRefine((d, ctx) => {
    if (!Array.isArray(d.setupCommands) || d.setupCommands.length === 0) {
      ctx.addIssue({ code: "custom", message: "setupCommands no puede estar vacía" });
    } else {
      d.setupCommands.forEach((cmd, i) => {
        if (typeof cmd !== "string" || cmd.trim().length === 0) {
          ctx.addIssue({ code: "custom", message: `setupCommands[${i}] no puede estar vacío` });
        }
      });
    }
    const cpuCount = d.instanceShape?.cpuCount;
    if (typeof cpuCount !== "number" || !(cpuCount > 0)) {
      ctx.addIssue({
        code: "custom",
        message: "instanceShape.cpuCount debe ser número > 0",
        path: ["instanceShape", "cpuCount"],
      });
    }
    const memoryGB = d.instanceShape?.memoryGB;
    if (typeof memoryGB !== "number" || !(memoryGB > 0)) {
      ctx.addIssue({
        code: "custom",
        message: "instanceShape.memoryGB debe ser número > 0",
        path: ["instanceShape", "memoryGb"],
      });
    }
    const isolation = typeof d.isolation === "string" ? d.isolation.trim() : "";
    if (isolation === "docker") {
      const legacy = typeof d.dockerImage === "string" ? d.dockerImage.trim() : "";
      const plat = typeof d.platform?.dockerImage === "string" ? d.platform.dockerImage.trim() : "";
      if (!legacy && !plat) {
        ctx.addIssue({
          code: "custom",
          message: 'dockerImage requerido cuando isolation es "docker"',
          path: ["platform", "dockerImage"],
        });
      }
    }
  });

export type RunnerSpec = z.infer<typeof RunnerSpecSchema>;

export type RunnerId = "linux-build";

export const RUNNER_IDS = ["linux-build"] as const;
