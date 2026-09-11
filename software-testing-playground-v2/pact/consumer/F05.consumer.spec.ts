import { describe, it, expect } from "vitest";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import {
  PACT_DIR,
  PACT_LOG_LEVEL,
  FACTORY_PROVIDER,
  consumerNameFor,
} from "../support/pactConfig.js";

const { like, regex, eachLike } = MatchersV3;

/**
 * F05 — Planning/Tools vía Factory — gate de modelo (pact gate)
 *
 * Contrato Pact (HTTP) — gate validación server-side simulada:
 *   - POST /factory/jobs con modelRef válido (ej gpt-4o) → 201 queued (gate pass)
 *   - POST /factory/jobs con modelRef inválido (ej gpt-99) → 400 {error: "model not in catalog", alternatives: [...]} (gate fail fast)
 *
 * Antes (Ola 5 human slim): gate era validación local `validatePhaseAgainstCatalog` sin endpoint.
 * Ahora pacteado: Factory POST valida modelRef opcional si viene; si es inválido responde 400 con alternatives.
 * Mantiene compatibilidad con F02/F04 (sin modelRef → 201).
 *
 * Provider: headless-runtime/factory/factoryServer.ts POST /factory/jobs extiende body con
 *           opcional `modelRef: {providerID, modelID, variant}` y `cli`, validando modelID === "gpt-99" → 400.
 *
 * Windows only — worktree ejemplo C:\tmp\...
 */

const JOB_ID_REGEX = "^job-[a-z0-9\\-]+$";
const JOB_ID_VALID_EXAMPLE = "job-f05-valid01";
const WINDOWS_WORKTREE_REGEX = "^[A-Z]:\\\\.*";
const WINDOWS_WORKTREE_VALID = "C:\\tmp\\playground-F05-valid";
const WINDOWS_WORKTREE_INVALID = "C:\\tmp\\playground-F05-invalid";
const WINDOWS_PATH_REGEX = "^[A-Z]:\\\\.*\\.agents\\\\factory\\\\job-.*";
const WINDOWS_PATH_VALID = "C:\\tmp\\playground-F05-valid\\.agents\\factory\\job-f05-valid01";
const ISO8601_FLEX_REGEX = "^\\d{4}-\\d{2}-\\d{2}T.*Z$";
const ISO8601_FLEX_EXAMPLE = "2026-05-13T14:22:10.123Z";

describe("F05 — Planning/Tools vía Factory — gate de modelo (pact gate 201 vs 400)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F05"),
    provider: FACTORY_PROVIDER,
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("validates model gate via POST /factory/jobs (201 for valid, 400 for gpt-99 with alternatives)", async () => {
    const validPrompt = "playground-F05-valid-prompt";
    const invalidPrompt = "playground-F05-invalid-prompt";

    // ── Interaction 1: gate allows valid model → 201 queued ──
    // Nota: body modelRef usa regex estricto para modelID para diferenciar de gpt-99; like para otros campos mantiene flexibilidad
    pact
      .given("gate allows valid model", { worktree: WINDOWS_WORKTREE_VALID })
      .uponReceiving("a request to create a job with valid modelRef (gate pass)")
      .withRequest({
        method: "POST",
        path: "/factory/jobs",
        headers: { "Content-Type": "application/json" },
        body: {
          prompt: like(validPrompt),
          worktree: like(WINDOWS_WORKTREE_VALID),
          phase: like("diagnosisLlm"),
          modelRef: {
            providerID: like("openai"),
            modelID: regex("^gpt-4o$", "gpt-4o"),
            variant: like("default"),
          },
          cli: like("claude"),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { "Content-Type": "application/json" },
        body: {
          id: regex(JOB_ID_REGEX, JOB_ID_VALID_EXAMPLE),
          path: regex(WINDOWS_PATH_REGEX, WINDOWS_PATH_VALID),
          job: {
            id: regex(JOB_ID_REGEX, JOB_ID_VALID_EXAMPLE),
            prompt: like(validPrompt),
            phase: like("diagnosisLlm"),
            state: regex("^queued$", "queued"),
            worktree: like(WINDOWS_WORKTREE_VALID),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          },
        },
      });

    // ── Interaction 2: gate rejects invalid model (gpt-99) → 400 {error, alternatives} ──
    pact
      .given("gate rejects invalid model", { worktree: WINDOWS_WORKTREE_INVALID })
      .uponReceiving("a request to create a job with invalid modelRef gpt-99 (gate fail)")
      .withRequest({
        method: "POST",
        path: "/factory/jobs",
        headers: { "Content-Type": "application/json" },
        body: {
          prompt: like(invalidPrompt),
          worktree: like(WINDOWS_WORKTREE_INVALID),
          phase: like("diagnosisLlm"),
          modelRef: {
            providerID: like("openai"),
            modelID: regex("^gpt-99$", "gpt-99"),
            variant: like("default"),
          },
          cli: like("claude"),
        },
      })
      .willRespondWith({
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: {
          error: regex("^model not in catalog$", "model not in catalog"),
          alternatives: eachLike("gpt-4o"),
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: valid modelRef → 201 queued ──
      const resValid = await fetch(`${mockServer.url}/factory/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: validPrompt,
          worktree: WINDOWS_WORKTREE_VALID,
          phase: "diagnosisLlm",
          modelRef: { providerID: "openai", modelID: "gpt-4o", variant: "default" },
          cli: "claude",
        }),
      });
      expect(resValid.status).toBe(201);
      const bodyValid = (await resValid.json()) as unknown as {
        id: unknown;
        path: unknown;
        job: { state: unknown; id: unknown; prompt: unknown };
      };
      expect(typeof bodyValid.id).toBe("string");
      expect(typeof bodyValid.path).toBe("string");
      expect(bodyValid.job.state).toBe("queued");
      expect(typeof bodyValid.job.id).toBe("string");

      // ── Validate interaction 2: invalid modelRef gpt-99 → 400 with alternatives ──
      const resInvalid = await fetch(`${mockServer.url}/factory/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: invalidPrompt,
          worktree: WINDOWS_WORKTREE_INVALID,
          phase: "diagnosisLlm",
          modelRef: { providerID: "openai", modelID: "gpt-99", variant: "default" },
          cli: "claude",
        }),
      });
      expect(resInvalid.status).toBe(400);
      const bodyInvalid = (await resInvalid.json()) as unknown as {
        error: unknown;
        alternatives: unknown;
      };
      expect(typeof bodyInvalid.error).toBe("string");
      expect(String(bodyInvalid.error)).toMatch(/model not in catalog/);
      expect(Array.isArray(bodyInvalid.alternatives)).toBe(true);
      expect((bodyInvalid.alternatives as unknown[]).length).toBeGreaterThanOrEqual(1);
      // Each alternative should be a non-empty string (Pact eachLike guarantees shape)
      for (const alt of bodyInvalid.alternatives as unknown[]) {
        expect(typeof alt).toBe("string");
        expect((alt as string).length).toBeGreaterThan(0);
      }
    });
  });
});
