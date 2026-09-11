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
 * F14 — Prompt markdown con code fence y backticks (TermCanvas real)
 *
 * Valida que Factory maneja correctamente prompt markdown con bloques
 * ```js ... ``` que contienen backticks, comillas, saltos de línea y flecha →.
 * Gap: nunca probamos markdown con triple backtick, que es el caso real de
 * TermCanvas (diagnóstico, planning) donde el prompt incluye code fences.
 *
 * Contrato Pact (2 interactions) — Windows only, headers plain, PactV3 MatchersV3:
 *  1) POST /factory/jobs con {prompt: like("```js\nconsole.log(\"hola\")\n```\nMarkdown con `code` y →"), worktree: like("C:\\tmp\\playground-F14-markdown"), phase: like("diagnosisLlm")}
 *     Given "factory is healthy" — valida que Factory almacena prompt markdown tal cual via JSON.parse y devuelve via JSON.stringify sin truncar salvo preview
 *     → 201 {id: regex ^job-, path: regex Windows, job:{state:"queued", prompt: regex "```js"}}
 *     Usar like para prompt con fences/backticks/newlines/arrow, regex para id/path. Headers plain application/json.
 *  2) GET /factory/jobs/job-f14-md01 → 200 {id: regex ^job-f14-md01$, prompt: regex "```js.*console\.log.*```" con s flag via [\s\S]*, worktree: regex "playground-F14-markdown", phase: type, state: regex "^(queued|running|done|error)$"}
 *     Given "a job with markdown prompt exists" con {id:"job-f14-md01"} — stateHandler asegura job con markdown prompt exista via POST id determinístico o fallback manual utf-8 con fences
 *     Validar que fences/backticks/newlines se persisten idénticos sin truncamiento ni escaping roto, contiene ```js y `code` y → y \n, worktree correcto.
 *
 * factoryServer ya hace JSON.parse/JSON.stringify correcto y escribe prompt.md utf-8 sin truncar, solo validar contrato.
 * No menciona endpoints de otras features (R1 aislamiento). Windows only.
 */

const MARKDOWN_PROMPT = "```js\nconsole.log(\"hola\")\n```\nMarkdown con `code` y →";
const WORKTREE_F14 = "C:\\tmp\\playground-F14-markdown";
const JOB_F14_ID = "job-f14-md01";
const JOB_F14_PATH_REGEX = "^\\/factory\\/jobs\\/job-f14-md01$";
const JOB_F14_PATH = `/factory/jobs/${JOB_F14_ID}`;
const WINDOWS_DIR_REGEX = "^[A-Z]:\\\\.*\\.agents\\\\factory\\\\job-.*";
const WINDOWS_DIR_EXAMPLE = "C:\\tmp\\playground-F14-markdown\\.agents\\factory\\job-f14-md01";
const JOB_ID_REGEX = "^job-[a-z0-9\\-]+$";
const JOB_ID_EXAMPLE = "job-f14-md01";
const WINDOWS_WORKTREE_REGEX = "^[A-Z]:\\\\.*playground-F14-markdown.*";
const ISO8601_FLEX_REGEX = "^\\d{4}-\\d{2}-\\d{2}T.*Z$";
const ISO8601_FLEX_EXAMPLE = "2026-05-13T14:22:10.123Z";
const STATE_REGEX = "^(queued|running|done|error)$";
const STATE_EXAMPLE = "queued";

describe("F14 — Prompt markdown con code fence y backticks", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F14"), // "playground-F14"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("creates job with markdown prompt (code fence backticks) and persists it identically via GET", async () => {
    // ── Interaction 1: POST /factory/jobs con prompt markdown → 201 queued ──
    // Given "factory is healthy" — valida que Factory maneja markdown fences correctamente
    pact
      .given("factory is healthy")
      .uponReceiving("a request to create a job with markdown prompt (code fence)")
      .withRequest({
        method: "POST",
        path: "/factory/jobs",
        headers: { "Content-Type": "application/json" },
        body: {
          prompt: like(MARKDOWN_PROMPT),
          worktree: like(WORKTREE_F14),
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
            prompt: regex("[\\s\\S]*```js[\\s\\S]*", MARKDOWN_PROMPT),
            phase: like("diagnosisLlm"),
            state: regex("^queued$", "queued"),
            worktree: regex(WINDOWS_WORKTREE_REGEX, WORKTREE_F14),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          },
        },
      });

    // ── Interaction 2: GET /factory/jobs/job-f14-md01 → 200 con prompt markdown persistido ──
    // Given "a job with markdown prompt exists" con params id job-f14-md01 — stateHandler asegura job exista
    pact
      .given("a job with markdown prompt exists", { id: JOB_F14_ID })
      .uponReceiving("a request for job with markdown prompt (persistencia GET)")
      .withRequest({
        method: "GET",
        path: regex(JOB_F14_PATH_REGEX, JOB_F14_PATH),
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          id: regex("^job-f14-md01$", JOB_F14_ID),
          prompt: regex("[\\s\\S]*```js[\\s\\S]*console\\.log[\\s\\S]*```[\\s\\S]*", MARKDOWN_PROMPT),
          worktree: regex(".*playground-F14-markdown.*", WORKTREE_F14),
          phase: like("diagnosisLlm"),
          state: regex(STATE_REGEX, STATE_EXAMPLE),
          createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          updatedAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
          logs: eachLike("opencode: streaming tokens…"),
          dir: regex(WINDOWS_DIR_REGEX, WINDOWS_DIR_EXAMPLE),
          resultPreview: {
            jobId: regex("^job-f14-md01$", JOB_F14_ID),
            phase: like("diagnosisLlm"),
            worktree: regex(WINDOWS_WORKTREE_REGEX, WORKTREE_F14),
            state: regex(STATE_REGEX, STATE_EXAMPLE),
            promptPreview: like(MARKDOWN_PROMPT.slice(0, 120)),
            createdAt: regex(ISO8601_FLEX_REGEX, ISO8601_FLEX_EXAMPLE),
            summary: like("Job completado correctamente (local)."),
          },
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: POST markdown prompt → 201 queued con prompt completo markdown ──
      const resPost = await fetch(`${mockServer.url}/factory/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: MARKDOWN_PROMPT,
          worktree: WORKTREE_F14,
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
      // Validar markdown fences/backticks persistidos: contiene ```js, ```, console.log("hola"), `code`, →, saltos de línea, sin mojibake ni truncamiento
      expect(promptPost).toContain("```js");
      expect(promptPost).toContain("```");
      expect(promptPost).toContain("console.log");
      expect(promptPost).toContain('"hola"');
      expect(promptPost).toContain("hola");
      expect(promptPost).toContain("`code`");
      expect(promptPost).toContain("Markdown con");
      expect(promptPost).toContain("→");
      expect(promptPost).toContain("\n");
      expect(promptPost).not.toContain("Ã"); // mojibake check — no UTF-8 mojibake
      expect(promptPost).not.toContain("Ã³");
      expect(promptPost).toBe(MARKDOWN_PROMPT);
      expect(typeof bodyPost.job.worktree).toBe("string");
      expect(String(bodyPost.job.worktree)).toMatch(/playground-F14-markdown/);
      expect(String(bodyPost.job.worktree)).not.toContain("Ã");
      // Validar que code fence no fue truncado — contiene ambos fences
      const fenceCountPost = (promptPost.match(/```/g) || []).length;
      expect(fenceCountPost).toBeGreaterThanOrEqual(2);

      // ── Validate interaction 2: GET markdown prompt → 200 con prompt idéntico (persistencia) ──
      const resGet = await fetch(`${mockServer.url}/factory/jobs/${JOB_F14_ID}`, {
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
      expect(String(bodyGet.id)).toBe(JOB_F14_ID);
      expect(typeof bodyGet.prompt).toBe("string");
      const promptGet = bodyGet.prompt as string;
      expect(promptGet).toContain("```js");
      expect(promptGet).toContain("console.log");
      expect(promptGet).toContain("```");
      expect(promptGet).toContain("`code`");
      expect(promptGet).toContain("→");
      expect(promptGet).toContain("\n");
      expect(promptGet).toContain('"hola"');
      expect(promptGet).not.toContain("Ã");
      expect(promptGet).not.toContain("Ã³");
      expect(promptGet).toBe(MARKDOWN_PROMPT);
      // Verifica worktree con markdown isolation
      expect(typeof bodyGet.worktree).toBe("string");
      expect(String(bodyGet.worktree)).toMatch(/playground-F14-markdown/);
      expect(String(bodyGet.worktree)).not.toContain("Ã");
      // fences count en GET también
      const fenceCountGet = (promptGet.match(/```/g) || []).length;
      expect(fenceCountGet).toBeGreaterThanOrEqual(2);
      // Phase type
      expect(typeof bodyGet.phase).toBe("string");
      // State queued|running|done|error
      expect(["queued", "running", "done", "error"]).toContain(bodyGet.state as string);
      // Logs type array
      expect(Array.isArray(bodyGet.logs)).toBe(true);
      // Dir Windows
      expect(typeof bodyGet.dir).toBe("string");
      expect(String(bodyGet.dir)).toMatch(/\.agents\\factory\\job-/);
      expect(String(bodyGet.dir)).toMatch(/playground-F14-markdown/);
    });
  });
});
