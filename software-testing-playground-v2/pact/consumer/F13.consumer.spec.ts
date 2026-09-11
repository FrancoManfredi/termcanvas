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
 * F13 — Prompt con JSON escaping, backslashes y emoji (PowerShell robustez)
 *
 * Valida que Factory maneja correctamente prompt con caracteres que rompen JSON
 * si no se escapan: comillas dobles, backslashes Windows, saltos de línea y emoji.
 * Gap: nunca probamos prompt con " y \ y 😀, que es el caso real de
 * `curl.exe -d "{\"prompt\":\"...\"}"` mal escapado.
 *
 * Contrato Pact (2 interactions) — Windows only, headers plain, PactV3 MatchersV3:
 *  1) POST /factory/jobs con {prompt: like("He said \"hola\" y path C:\\tmp\\a\\b\nlínea con emoji 😀 y →"), worktree: like("C:\\tmp\\playground-F13-escape"), phase: like("diagnosisLlm")}
 *     Given "factory is healthy" — valida que Factory almacena prompt tal cual via JSON.parse y devuelve via JSON.stringify sin perder escaping
 *     → 201 {id: regex ^job-, path: regex Windows, job:{state:"queued", prompt: regex "He said"}}
 *     Usar like para prompt con comillas/backslash/newline/emoji, regex para id/path. Headers plain application/json.
 *  2) GET /factory/jobs/job-f13-escape01 → 200 {id: regex ^job-f13-escape01$, prompt: regex "He said.*hola.*😀", worktree: regex "playground-F13-escape", phase: type, state: regex "^(queued|running|done|error)$"}
 *     Given "a job with escaped prompt exists" con {id:"job-f13-escape01"} — stateHandler asegura job con prompt escaped exista via POST id determinístico o fallback manual utf-8
 *     Validar que prompt con escaping se persiste idéntico sin mojibake ni truncamiento, contiene " y \ y 😀 y \n, worktree correcto.
 *
 * factoryServer ya hace JSON.parse/JSON.stringify correcto, solo validar contrato.
 * No menciona endpoints de otras features (R1 aislamiento). Windows only.
 */

const ESCAPED_PROMPT = "He said \"hola\" y path C:\\tmp\\a\\b\nlínea con emoji 😀 y →";
const WORKTREE_F13 = "C:\\tmp\\playground-F13-escape";
const JOB_F13_ID = "job-f13-escape01";
const JOB_F13_PATH_REGEX = "^\\/factory\\/jobs\\/job-f13-escape01$";
const JOB_F13_PATH = `/factory/jobs/${JOB_F13_ID}`;
const WINDOWS_DIR_REGEX = "^[A-Z]:\\\\.*\\.agents\\\\factory\\\\job-.*";
const WINDOWS_DIR_EXAMPLE = "C:\\tmp\\playground-F13-escape\\.agents\\factory\\job-f13-escape01";
const JOB_ID_REGEX = "^job-[a-z0-9\\-]+$";
const JOB_ID_EXAMPLE = "job-f13-escape01";
const WINDOWS_WORKTREE_REGEX = "^[A-Z]:\\\\.*playground-F13-escape.*";
const ISO8601_FLEX_REGEX = "^\\d{4}-\\d{2}-\\d{2}T.*Z$";
const ISO8601_FLEX_EXAMPLE = "2026-05-13T14:22:10.123Z";
const STATE_REGEX = "^(queued|running|done|error)$";
const STATE_EXAMPLE = "queued";

describe("F13 — Prompt con JSON escaping, backslashes y emoji (PowerShell robustez)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F13"), // "playground-F13"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("creates job with escaped prompt (quotes, backslashes, newline, emoji) and persists it identically via GET", async () => {
    // ── Interaction 1: POST /factory/jobs con prompt escaped → 201 queued ──
    // Given "factory is healthy" — valida que Factory maneja JSON escaping correctamente
    pact
      .given("factory is healthy")
      .uponReceiving("a request to create a job with escaped prompt (quotes, backslashes, emoji)")
      .withRequest({
        method: "POST",
        path: "/factory/jobs",
        headers: { "Content-Type": "application/json" },
        body: {
          prompt: like(ESCAPED_PROMPT),
          worktree: like(WORKTREE_F13),
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
            prompt: regex("[\\s\\S]*He said[\\s\\S]*", ESCAPED_PROMPT),
            phase: like("diagnosisLlm"),
            state: regex("^queued$", "queued"),
            worktree: regex(WINDOWS_WORKTREE_REGEX, WORKTREE_F13),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          },
        },
      });

    // ── Interaction 2: GET /factory/jobs/job-f13-escape01 → 200 con prompt escaped persistido ──
    // Given "a job with escaped prompt exists" con params id job-f13-escape01 — stateHandler asegura job exista
    pact
      .given("a job with escaped prompt exists", { id: JOB_F13_ID })
      .uponReceiving("a request for job with escaped prompt (persistencia GET)")
      .withRequest({
        method: "GET",
        path: regex(JOB_F13_PATH_REGEX, JOB_F13_PATH),
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          id: regex("^job-f13-escape01$", JOB_F13_ID),
          prompt: regex("[\\s\\S]*He said[\\s\\S]*hola[\\s\\S]*😀[\\s\\S]*", ESCAPED_PROMPT),
          worktree: regex(".*playground-F13-escape.*", WORKTREE_F13),
          phase: like("diagnosisLlm"),
          state: regex(STATE_REGEX, STATE_EXAMPLE),
          createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          updatedAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          logs: eachLike("opencode: streaming tokens…"),
          dir: regex(WINDOWS_DIR_REGEX, WINDOWS_DIR_EXAMPLE),
          resultPreview: {
            jobId: regex("^job-f13-escape01$", JOB_F13_ID),
            phase: like("diagnosisLlm"),
            worktree: regex(WINDOWS_WORKTREE_REGEX, WORKTREE_F13),
            state: regex(STATE_REGEX, STATE_EXAMPLE),
            promptPreview: like(ESCAPED_PROMPT.slice(0, 120)),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
            summary: like("Job completado correctamente (local)."),
          },
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: POST escaped prompt → 201 queued con prompt completo escaped ──
      const resPost = await fetch(`${mockServer.url}/factory/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: ESCAPED_PROMPT,
          worktree: WORKTREE_F13,
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
      const promptPost = bodyPost.job.prompt as string;
      // Validar escaping persistido: contiene comillas, backslash, newline, emoji, flecha, sin mojibake
      expect(promptPost).toContain("He said");
      expect(promptPost).toContain("\"hola\"");
      expect(promptPost).toContain("hola");
      expect(promptPost).toContain("\\");
      expect(promptPost).toContain("C:\\tmp\\a\\b");
      expect(promptPost).toContain("\n");
      expect(promptPost).toContain("línea");
      expect(promptPost).toContain("😀");
      expect(promptPost).toContain("→");
      expect(promptPost).not.toContain("Ã"); // mojibake check — no UTF-8 mojibake
      expect(promptPost).not.toContain("Ã³");
      expect(promptPost).toBe(ESCAPED_PROMPT);
      expect(typeof bodyPost.job.worktree).toBe("string");
      expect(String(bodyPost.job.worktree)).toMatch(/playground-F13-escape/);
      expect(String(bodyPost.job.worktree)).not.toContain("Ã");

      // ── Validate interaction 2: GET escaped prompt → 200 con prompt idéntico (persistencia) ──
      const resGet = await fetch(`${mockServer.url}/factory/jobs/${JOB_F13_ID}`, {
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
      expect(String(bodyGet.id)).toBe(JOB_F13_ID);
      expect(typeof bodyGet.prompt).toBe("string");
      const promptGet = bodyGet.prompt as string;
      expect(promptGet).toContain("He said");
      expect(promptGet).toContain("\"hola\"");
      expect(promptGet).toContain("hola");
      expect(promptGet).toContain("\\");
      expect(promptGet).toContain("C:\\tmp");
      expect(promptGet).toContain("\n");
      expect(promptGet).toContain("😀");
      expect(promptGet).toContain("→");
      expect(promptGet).not.toContain("Ã");
      expect(promptGet).not.toContain("Ã³");
      expect(promptGet).toBe(ESCAPED_PROMPT);
      // Verifica worktree con escaping
      expect(typeof bodyGet.worktree).toBe("string");
      expect(String(bodyGet.worktree)).toMatch(/playground-F13-escape/);
      expect(String(bodyGet.worktree)).not.toContain("Ã");
      // Phase type
      expect(typeof bodyGet.phase).toBe("string");
      // State queued|running|done|error
      expect(["queued", "running", "done", "error"]).toContain(bodyGet.state as string);
      // Logs type array
      expect(Array.isArray(bodyGet.logs)).toBe(true);
      // Dir Windows
      expect(typeof bodyGet.dir).toBe("string");
      expect(String(bodyGet.dir)).toMatch(/\.agents\\factory\\job-/);
      expect(String(bodyGet.dir)).toMatch(/playground-F13-escape/);
    });
  });
});
