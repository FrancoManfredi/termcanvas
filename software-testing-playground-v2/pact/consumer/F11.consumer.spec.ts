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
 * F11 — Unicode y espacio en worktree/prompt (Windows robustez)
 *
 * Contrato Pact (2 interactions) — valida que Factory maneja correctamente paths con espacio
 * y caracteres unicode (tildes, ñ, →) sin mojibake, cerrando gap de encoding visto en submitHuman.
 * Gap: nunca probamos worktree "C:\tmp\playground F11 ñ test" con espacio + prompt con saltos de línea y tildes.
 *
 * 1) POST /factory/jobs con prompt "línea1\nlínea2 con ñ y → y tildes ó í" + worktree "C:\tmp\playground F11 ñ test" + phase diagnosisLlm
 *    Given "factory is healthy" — valida creación con unicode y espacio, headers plain application/json
 *    → 201 {id regex ^job-, path regex Windows con espacio y \.agents\factory, job:{state:"queued", prompt regex "línea1", worktree regex "playground F11"}}
 *    Usar like para prompt/worktree con unicode (preserva utf-8), regex para path con espacio permitido (.*playground F11.*)
 *
 * 2) GET /factory/jobs/job-f11-unicode01 → 200 {id regex ^job-f11-unicode01$, prompt regex "línea1.*ñ", worktree regex "playground F11 ñ", phase type, state regex queued|running|done|error, logs type}
 *    Given "a job with unicode prompt exists" with params {id:"job-f11-unicode01"} — stateHandler asegura job con prompt unicode exista via POST id determinístico o fallback manual utf-8
 *    Valida persistencia: prompt/worktree con unicode se persisten idénticos (no Ã³), phase type, state queued|running|done|error, logs array
 *
 * factoryServer ya almacena prompt/worktree UTF-8 sin truncar ni escape mal (prompt.md utf-8, job.json utf-8, readBody utf8).
 * Headers plain application/json, Windows only. Validar via fetch con utf-8 que file prompt.md contiene unicode.
 */

const UNICODE_PROMPT = "línea1\nlínea2 con ñ y → y tildes ó í";
const WORKTREE_F11 = "C:\\tmp\\playground F11 ñ test";
const JOB_F11_ID = "job-f11-unicode01";
const JOB_F11_PATH_REGEX = "^\\/factory\\/jobs\\/job-f11-unicode01$";
const JOB_F11_PATH = `/factory/jobs/${JOB_F11_ID}`;
// Windows dir con espacio: debe contener "playground F11" y ".agents\factory\job-"
const WINDOWS_DIR_REGEX = "^[A-Z]:\\\\.*playground F11.*\\.agents\\\\factory\\\\job-.*";
const WINDOWS_DIR_EXAMPLE = "C:\\tmp\\playground F11 ñ test\\.agents\\factory\\job-f11-unicode01";
const JOB_ID_REGEX = "^job-[a-z0-9\\-]+$";
const JOB_ID_EXAMPLE = "job-f11-unicode01";
const WINDOWS_WORKTREE_REGEX = "^[A-Z]:\\\\.*playground F11.*";
const ISO8601_FLEX_REGEX = "^\\d{4}-\\d{2}-\\d{2}T.*Z$";
const ISO8601_FLEX_EXAMPLE = "2026-05-13T14:22:10.123Z";
const STATE_REGEX = "^(queued|running|done|error)$";
const STATE_EXAMPLE = "queued";

describe("F11 — Unicode y espacio en worktree/prompt (Windows robustez)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F11"), // "playground-F11"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("creates job with unicode prompt and worktree with space, and persists it identically via GET", async () => {
    // ── Interaction 1: POST /factory/jobs con prompt unicode + worktree con espacio → 201 queued ──
    // Given "factory is healthy" — valida que Factory no hace mojibake con unicode
    pact
      .given("factory is healthy")
      .uponReceiving("a request to create a job with unicode prompt and worktree with space")
      .withRequest({
        method: "POST",
        path: "/factory/jobs",
        headers: { "Content-Type": "application/json" },
        body: {
          prompt: like(UNICODE_PROMPT),
          worktree: like(WORKTREE_F11),
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
            prompt: regex("[\\s\\S]*línea1[\\s\\S]*", UNICODE_PROMPT),
            phase: like("diagnosisLlm"),
            state: regex("^queued$", "queued"),
            worktree: regex(".*playground F11.*", WORKTREE_F11),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          },
        },
      });

    // ── Interaction 2: GET /factory/jobs/job-f11-unicode01 → 200 con prompt unicode persistido ──
    // Given "a job with unicode prompt exists" con params id job-f11-unicode01 — stateHandler asegura job exista
    pact
      .given("a job with unicode prompt exists", { id: JOB_F11_ID })
      .uponReceiving("a request for job with unicode prompt (persistencia GET)")
      .withRequest({
        method: "GET",
        path: regex(JOB_F11_PATH_REGEX, JOB_F11_PATH),
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          id: regex("^job-f11-unicode01$", JOB_F11_ID),
          prompt: regex("[\\s\\S]*línea1[\\s\\S]*ñ[\\s\\S]*", UNICODE_PROMPT),
          worktree: regex(".*playground F11 ñ.*", WORKTREE_F11),
          phase: like("diagnosisLlm"),
          state: regex(STATE_REGEX, STATE_EXAMPLE),
          createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          updatedAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          logs: eachLike("opencode: streaming tokens…"),
          dir: regex(WINDOWS_DIR_REGEX, WINDOWS_DIR_EXAMPLE),
          resultPreview: {
            jobId: regex("^job-f11-unicode01$", JOB_F11_ID),
            phase: like("diagnosisLlm"),
            worktree: regex(WINDOWS_WORKTREE_REGEX, WORKTREE_F11),
            state: regex(STATE_REGEX, STATE_EXAMPLE),
            promptPreview: like(UNICODE_PROMPT.slice(0, 120)),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
            summary: like("Job completado correctamente (local)."),
          },
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: POST unicode → 201 queued con prompt completo unicode ──
      const resPost = await fetch(`${mockServer.url}/factory/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: UNICODE_PROMPT,
          worktree: WORKTREE_F11,
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
      // path debe contener espacio + .agents\factory (Windows con espacio)
      expect(String(bodyPost.path)).toMatch(/playground F11/);
      expect(String(bodyPost.path)).toMatch(/\.agents\\factory\\job-/);
      expect(typeof bodyPost.job.id).toBe("string");
      expect(bodyPost.job.state).toBe("queued");
      expect(typeof bodyPost.job.prompt).toBe("string");
      const promptPost = bodyPost.job.prompt as string;
      // Validar unicode persistido sin mojibake (no Ã³) y con salto de línea
      expect(promptPost).toContain("línea1");
      expect(promptPost).toContain("ñ");
      expect(promptPost).toContain("→");
      expect(promptPost).toContain("ó");
      expect(promptPost).toContain("í");
      expect(promptPost).not.toContain("Ã"); // mojibake check
      expect(promptPost).toContain("\n");
      expect(promptPost).toBe(UNICODE_PROMPT);
      expect(typeof bodyPost.job.worktree).toBe("string");
      expect(String(bodyPost.job.worktree)).toMatch(/playground F11/);
      expect(String(bodyPost.job.worktree)).toContain("ñ");

      // ── Validate interaction 2: GET unicode → 200 con prompt idéntico (persistencia) ──
      const resGet = await fetch(`${mockServer.url}/factory/jobs/${JOB_F11_ID}`, {
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
      expect(String(bodyGet.id)).toBe(JOB_F11_ID);
      expect(typeof bodyGet.prompt).toBe("string");
      const promptGet = bodyGet.prompt as string;
      expect(promptGet).toContain("línea1");
      expect(promptGet).toContain("ñ");
      expect(promptGet).toContain("→");
      expect(promptGet).not.toContain("Ã");
      expect(promptGet).toBe(UNICODE_PROMPT);
      // Verifica worktree unicode con espacio
      expect(typeof bodyGet.worktree).toBe("string");
      expect(String(bodyGet.worktree)).toMatch(/playground F11 ñ/);
      expect(String(bodyGet.worktree)).toContain(" ");
      expect(String(bodyGet.worktree)).not.toContain("Ã");
      // Phase type
      expect(typeof bodyGet.phase).toBe("string");
      // State queued|running|done|error
      expect(["queued", "running", "done", "error"]).toContain(bodyGet.state as string);
      // Logs type array
      expect(Array.isArray(bodyGet.logs)).toBe(true);
      // Dir Windows con espacio
      expect(typeof bodyGet.dir).toBe("string");
      expect(String(bodyGet.dir)).toMatch(/playground F11/);
      expect(String(bodyGet.dir)).toMatch(/\.agents\\factory\\job-/);
    });
  });
});
