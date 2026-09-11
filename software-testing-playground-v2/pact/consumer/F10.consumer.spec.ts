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
 * F10 — Prompt largo y persistencia en disco
 *
 * Contrato Pact (2 interactions) — valida que Factory no trunca prompt grande y que GET lo devuelve idéntico.
 * Gap real: nunca probamos prompt >1K (F02 usa ~20 chars, F03/F06 usan <30).
 *   1) POST /factory/jobs con prompt = "a".repeat(1500) (regex ^a{1000,}$) + worktree C:\tmp\playground-F10-large + phase diagnosisLlm
 *      Given "factory is healthy" (reuse) — valida creación sin truncamiento, body <2MB, prompt completo guardado en job.prompt y prompt.md
 *      → 201 {id: regex ^job-, path: regex Windows .agents\factory\job-, job:{state:"queued", prompt: like large}}
 *      Nota: resultPreview (si existiera) truncaría a 120, pero job.prompt debe ser completo — este pact valida job.prompt, no preview
 *   2) GET /factory/jobs/job-f10-large01 → 200 {id regex ^job-f10-large01$, prompt regex ^a{1000,}$, phase type, state regex queued|running|done|error, logs type}
 *      Given "a job with large prompt exists" with params {id:"job-f10-large01"} — stateHandler asegura job con prompt large (1500 a) exista via POST id determinístico o fallback manual
 *      Valida persistencia: prompt devuelto idéntico al enviado (1500 a, no truncado), logs array existe, dir Windows
 *
 * factoryServer ya soporta ambos: POST acepta prompt string sin límite salvo 2MB body (readBody 2MB), GET devuelve job.prompt completo.
 * Ver headless-runtime/factory/factoryServer.ts ensureJobDir escribe prompt.md con job.prompt completo y writeJobJson persiste job.prompt.
 * Headers plain application/json, Windows only — worktree ejemplo C:\tmp\...
 */

const LARGE_PROMPT = "a".repeat(1500);
const LARGE_PROMPT_REGEX = "^a{1000,}$";
const WORKTREE_F10 = "C:\\tmp\\playground-F10-large";
const WINDOWS_DIR_REGEX = "^[A-Z]:\\\\.*\\.agents\\\\factory\\\\job-.*";
const WINDOWS_DIR_EXAMPLE = "C:\\tmp\\playground-F10-large\\.agents\\factory\\job-f10-large01";
const WINDOWS_WORKTREE_REGEX = "^[A-Z]:\\\\.*";
const JOB_ID_REGEX = "^job-[a-z0-9\\-]+$";
const JOB_ID_EXAMPLE = "job-f10-large01";
const JOB_F10_ID = "job-f10-large01";
const JOB_F10_PATH_REGEX = "^\\/factory\\/jobs\\/job-f10-large01$";
const JOB_F10_PATH = `/factory/jobs/${JOB_F10_ID}`;
const ISO8601_FLEX_REGEX = "^\\d{4}-\\d{2}-\\d{2}T.*Z$";
const ISO8601_FLEX_EXAMPLE = "2026-05-13T14:22:10.123Z";
const STATE_REGEX = "^(queued|running|done|error)$";
const STATE_EXAMPLE = "queued";

describe("F10 — Prompt largo y persistencia (1500 chars)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F10"), // "playground-F10"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("creates job with large prompt and persists it identically via GET", async () => {
    // ── Interaction 1: POST /factory/jobs con prompt large (1500 a) → 201 queued ──
    // Given "factory is healthy" reuse — valida que Factory no trunca prompt grande
    // Body prompt usa regex ^a{1000,}$ con ejemplo 1500 a para asegurar largo (>1K)
    // Worktree like Windows path, phase like diagnosisLlm — headers plain application/json
    pact
      .given("factory is healthy")
      .uponReceiving("a request to create a job with large prompt (persistencia 1500)")
      .withRequest({
        method: "POST",
        path: "/factory/jobs",
        headers: { "Content-Type": "application/json" },
        body: {
          prompt: regex(LARGE_PROMPT_REGEX, LARGE_PROMPT),
          worktree: like(WORKTREE_F10),
          phase: like("diagnosisLlm"),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { "Content-Type": "application/json" },
        body: {
          id: regex(JOB_ID_REGEX, JOB_ID_EXAMPLE),
          path: regex(WINDOWS_DIR_REGEX, WINDOWS_DIR_EXAMPLE),
          job: {
            id: regex(JOB_ID_REGEX, JOB_ID_EXAMPLE),
            prompt: regex(LARGE_PROMPT_REGEX, LARGE_PROMPT),
            phase: like("diagnosisLlm"),
            state: regex("^queued$", "queued"),
            worktree: like(WORKTREE_F10),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          },
        },
      });

    // ── Interaction 2: GET /factory/jobs/job-f10-large01 → 200 con prompt large idéntico ──
    // Given "a job with large prompt exists" con params id job-f10-large01 — stateHandler asegura job con prompt large exista
    // Valida persistencia: prompt devuelto idéntico (1500 a, no truncado), state queued|running|done|error, logs type array, dir Windows
    pact
      .given("a job with large prompt exists", { id: JOB_F10_ID })
      .uponReceiving("a request for job with large prompt (persistencia GET)")
      .withRequest({
        method: "GET",
        path: regex(JOB_F10_PATH_REGEX, JOB_F10_PATH),
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          id: regex("^job-f10-large01$", JOB_F10_ID),
          prompt: regex(LARGE_PROMPT_REGEX, LARGE_PROMPT),
          worktree: regex(WINDOWS_WORKTREE_REGEX, WORKTREE_F10),
          phase: like("diagnosisLlm"),
          state: regex(STATE_REGEX, STATE_EXAMPLE),
          createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          updatedAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          logs: eachLike("opencode: streaming tokens…"),
          dir: regex(WINDOWS_DIR_REGEX, WINDOWS_DIR_EXAMPLE),
          resultPreview: {
            jobId: regex("^job-f10-large01$", JOB_F10_ID),
            phase: like("diagnosisLlm"),
            worktree: regex(WINDOWS_WORKTREE_REGEX, WORKTREE_F10),
            state: regex(STATE_REGEX, STATE_EXAMPLE),
            promptPreview: like(LARGE_PROMPT.slice(0, 120)),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
            summary: like("Job completado correctamente (local)."),
          },
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: POST large prompt → 201 queued con prompt completo ──
      const resPost = await fetch(`${mockServer.url}/factory/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: LARGE_PROMPT,
          worktree: WORKTREE_F10,
          phase: "diagnosisLlm",
        }),
      });
      expect(resPost.status).toBe(201);
      const ctypePost = resPost.headers.get("content-type") ?? "";
      expect(ctypePost).toMatch(/application\/json/);
      const bodyPost = (await resPost.json()) as unknown as {
        id: unknown;
        path: unknown;
        job: { id: unknown; prompt: unknown; state: unknown; worktree: unknown };
      };
      expect(typeof bodyPost.id).toBe("string");
      expect(String(bodyPost.id)).toMatch(/^job-[a-z0-9\-]+$/);
      expect(typeof bodyPost.path).toBe("string");
      expect(String(bodyPost.path)).toMatch(/^[A-Z]:\\.*\.agents\\factory\\job-.*/);
      expect(typeof bodyPost.job.id).toBe("string");
      expect(bodyPost.job.state).toBe("queued");
      expect(typeof bodyPost.job.prompt).toBe("string");
      // Validar que prompt no fue truncado — debe tener 1500 a y matching regex ^a{1000,}$
      const promptPost = bodyPost.job.prompt as string;
      expect(promptPost.length).toBeGreaterThanOrEqual(1000);
      expect(promptPost.length).toBe(1500);
      expect(promptPost).toMatch(/^a{1000,}$/);
      expect(promptPost).toBe(LARGE_PROMPT);

      // ── Validate interaction 2: GET large prompt → 200 con prompt idéntico (persistencia) ──
      const resGet = await fetch(`${mockServer.url}/factory/jobs/${JOB_F10_ID}`, {
        headers: { Accept: "application/json" },
      });
      expect(resGet.status).toBe(200);
      const ctypeGet = resGet.headers.get("content-type") ?? "";
      expect(ctypeGet).toMatch(/application\/json/);
      const bodyGet = (await resGet.json()) as unknown as {
        id: unknown;
        prompt: unknown;
        phase: unknown;
        state: unknown;
        worktree: unknown;
        logs: unknown;
        dir: unknown;
        resultPreview?: { promptPreview: unknown; state: unknown };
      };
      expect(typeof bodyGet.id).toBe("string");
      expect(String(bodyGet.id)).toBe(JOB_F10_ID);
      expect(typeof bodyGet.prompt).toBe("string");
      const promptGet = bodyGet.prompt as string;
      expect(promptGet.length).toBeGreaterThanOrEqual(1000);
      expect(promptGet.length).toBe(1500);
      expect(promptGet).toMatch(/^a{1000,}$/);
      expect(promptGet).toBe(LARGE_PROMPT);
      // Phase debe ser string type
      expect(typeof bodyGet.phase).toBe("string");
      // State debe ser uno de queued|running|done|error
      expect(["queued", "running", "done", "error"]).toContain(bodyGet.state as string);
      // Logs debe ser array type (eachLike)
      expect(Array.isArray(bodyGet.logs)).toBe(true);
      // Dir debe ser Windows path con .agents\factory
      expect(typeof bodyGet.dir).toBe("string");
      expect(String(bodyGet.dir)).toMatch(/^[A-Z]:\\.*\.agents\\factory\\job-.*/);
      // Worktree Windows path
      expect(typeof bodyGet.worktree).toBe("string");
      expect(String(bodyGet.worktree)).toMatch(/^[A-Z]:\\/);
      // resultPreview promptPreview sí trunca a 120 — validar que preview existe y es prefijo
      if (bodyGet.resultPreview) {
        expect(typeof bodyGet.resultPreview.promptPreview).toBe("string");
        const preview = bodyGet.resultPreview.promptPreview as string;
        expect(preview.length).toBeLessThanOrEqual(120);
        expect(LARGE_PROMPT.startsWith(preview)).toBe(true);
      }
    });
  });
});
