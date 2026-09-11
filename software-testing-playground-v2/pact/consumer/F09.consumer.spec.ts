import { describe, it, expect } from "vitest";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import {
  PACT_DIR,
  PACT_LOG_LEVEL,
  FACTORY_PROVIDER,
  consumerNameFor,
} from "../support/pactConfig.js";

const { like, regex } = MatchersV3;

/**
 * F09 — Robustez: body malformado y hint DX
 *
 * Contrato Pact (2 interactions) — cubre el error que sufrimos al usar curl sin .exe (JSON malformado)
 * que hoy solo F07 cubre prompt missing pero no JSON inválido:
 *   1) POST /factory/jobs con body string malformado (no JSON object, ej "not-json" crudo) → 400 {error, hint, received}
 *      Given "factory is healthy" (reuse) — valida DX body must be valid JSON útil
 *      Body raw "not-json" con Content-Type text/plain (alternativa sólida que garantiza parseError true en factoryServer.readBody)
 *      → factoryServer hace readBody → JSON.parse(raw) falla → resolve parseError true → responde 400 body must be valid JSON con hint
 *   2) GET /factory/jobs/job-zzz-invalid99 → 404 {error: "job not found"}
 *      Given "no job exists" (reuse con param id) — asegura que job inexistente responde 404 no 500 ni 200
 *
 * Verifica que factoryServer.ts ya implementa:
 *   - POST intenta JSON.parse(raw), si falla → 400 body must be valid JSON con hint (line ~288)
 *   - GET /jobs/:id 404 con {error: `job not found: ${id}`}
 *
 * Windows only — factoryServer real, sin PTY. PactV3 permite body como string raw; usamos body: "not-json" string literal
 * con Content-Type text/plain para garantizar que Verifier envíe raw que dispare parseError (sin JSON.stringify).
 * Si Pact cambiase a serializar body string como JSON, alternativa es body: {raw:"not-json"} pero perdería parseError;
 * por eso elegimos text/plain que es sólida (factoryServer.readBody siempre intenta JSON.parse(raw) sin mirar Content-Type).
 */

const JOB_INVALID_ID = "job-zzz-invalid99";
const JOB_INVALID_PATH_REGEX = "^\\/factory\\/jobs\\/job-zzz-invalid99$";
const JOB_INVALID_PATH = `/factory/jobs/${JOB_INVALID_ID}`;
const RAW_MALFORMED = "not-json";

describe("F09 — Robustez: body malformado y hint DX", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F09"), // "playground-F09"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR,
    logLevel: PACT_LOG_LEVEL,
  });

  it("returns 400 for malformed JSON body with hint and 404 for nonexistent job", async () => {
    // ── Interaction 1: POST /factory/jobs con body malformado → 400 {error, hint, received} ──
    // Given "factory is healthy" reuse — valida DX body must be valid JSON (cubre curl sin .exe)
    // Body raw "not-json" con Content-Type text/plain → garantiza parseError true en provider real
    pact
      .given("factory is healthy")
      .uponReceiving("a request with malformed JSON body (robustez 400)")
      .withRequest({
        method: "POST",
        path: "/factory/jobs",
        headers: { "Content-Type": "text/plain" },
        body: RAW_MALFORMED,
      })
      .willRespondWith({
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: {
          error: regex(".*body must be valid JSON.*", "body must be valid JSON"),
          hint: like(
            "En PowerShell usa Invoke-RestMethod o curl.exe con -d '{\"prompt\":...}' — curl sin .exe es alias a Invoke-WebRequest",
          ),
          received: like(RAW_MALFORMED),
        },
      });

    // ── Interaction 2: GET /factory/jobs/:id inexistente → 404 {error} ──
    pact
      .given("no job exists", { id: JOB_INVALID_ID })
      .uponReceiving("a request for nonexistent job job-zzz-invalid99 (robustez 404)")
      .withRequest({
        method: "GET",
        path: regex(JOB_INVALID_PATH_REGEX, JOB_INVALID_PATH),
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: {
          error: regex(".*job not found.*", `job not found: ${JOB_INVALID_ID}`),
        },
      });

    await pact.executeTest(async (mockServer) => {
      // ── Validate interaction 1: POST malformed → 400 ──
      const res400 = await fetch(`${mockServer.url}/factory/jobs`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: RAW_MALFORMED,
      });
      expect(res400.status).toBe(400);
      const ctype400 = res400.headers.get("content-type") ?? "";
      expect(ctype400).toMatch(/application\/json/);
      const body400 = (await res400.json()) as unknown as {
        error: unknown;
        hint: unknown;
        received: unknown;
      };
      expect(typeof body400.error).toBe("string");
      expect(String(body400.error)).toMatch(/body must be valid JSON/);
      expect(typeof body400.hint).toBe("string");
      expect((body400.hint as string).length).toBeGreaterThan(0);
      expect(typeof body400.received).toBe("string");
      expect(String(body400.received)).toMatch(/not-json/);

      // ── Validate interaction 2: GET nonexistent → 404 ──
      const res404 = await fetch(`${mockServer.url}/factory/jobs/${JOB_INVALID_ID}`, {
        headers: { Accept: "application/json" },
      });
      expect(res404.status).toBe(404);
      const ctype404 = res404.headers.get("content-type") ?? "";
      expect(ctype404).toMatch(/application\/json/);
      const body404 = (await res404.json()) as unknown as { error: unknown };
      expect(typeof body404.error).toBe("string");
      expect(String(body404.error)).toMatch(/job not found/);
    });
  });
});
