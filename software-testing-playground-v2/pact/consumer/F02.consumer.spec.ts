import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import {
  PACT_DIR,
  PACT_LOG_LEVEL,
  FACTORY_PROVIDER,
  consumerNameFor,
} from "../support/pactConfig.js";

const { like, regex } = MatchersV3;

// Windows path for job dir: e.g. C:\tmp\playground-F02-abc\.agents\factory\job-...
const windowsPathRegex = regex(
  "^[A-Z]:\\\\.*\\.agents\\\\factory\\\\job-.*",
  "C:\\tmp\\playground-F02-abc123\\.agents\\factory\\job-m4n5o6p7",
);
const jobIdRegex = regex("^job-[a-z0-9\\-]+$", "job-m4n5o6p7-q8r9");

describe("F02 — Job en disco (Playground)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F02"), // "playground-F02"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("creates a job and returns queued with disk artifacts", async () => {
    // Worktree temp por corrida, aislado por F — Windows only
    const uuid = crypto.randomUUID().slice(0, 8);
    const prompt = `playground-F02-${uuid}`;
    const worktree = path.join(os.tmpdir(), `playground-F02-${uuid}`);
    fs.mkdirSync(worktree, { recursive: true });

    pact
      .given("a valid playground worktree", { worktree })
      .uponReceiving("a request to create a job")
      .withRequest({
        method: "POST",
        path: "/factory/jobs",
        // Nota: headers plain "application/json" — regex "application/json;?.*" rompía en Pact JS 14
        // con Warning de header matching (ver F01). Mantener plain para estabilidad Windows.
        headers: { "Content-Type": "application/json" },
        body: {
          prompt: like(prompt),
          worktree: like(worktree),
          phase: like("diagnosisLlm"),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { "Content-Type": "application/json" },
        body: {
          id: jobIdRegex,
          path: windowsPathRegex,
          job: {
            id: jobIdRegex,
            prompt: like(prompt),
            phase: like("diagnosisLlm"),
            // Exigir literal "queued" — regex exacto, no solo type
            state: regex("^queued$", "queued"),
            worktree: like(worktree),
            createdAt: regex(
              "^\\d{4}-\\d{2}-\\d{2}T.*Z$",
              "2026-05-13T14:22:10.123Z",
            ),
          },
        },
      });

    await pact.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/factory/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, worktree, phase: "diagnosisLlm" }),
      });
      const body = (await res.json()) as unknown as {
        id: unknown;
        path: unknown;
        job: { state: unknown; id: unknown; prompt: unknown };
      };

      expect(res.status).toBe(201);
      expect(body.job.state).toBe("queued");
      expect(typeof body.id).toBe("string");
      expect(typeof body.path).toBe("string");
      // No validar disco acá — el mock no escribe disco. El provider sí.
      // El Verifier validará disco vía stateHandler + check fs.
    });
  });
});
