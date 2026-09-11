import { describe, it, expect } from "vitest";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import {
  PACT_DIR,
  PACT_LOG_LEVEL,
  FACTORY_PROVIDER,
  consumerNameFor,
} from "../support/pactConfig.js";

const { like, integer, regex } = MatchersV3;

// Regex ISO-8601 UTC (simple, no valida calendario, alcanza para contrato)
const ISO8601 = regex(
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
  "2026-05-13T14:22:10.123Z",
);

describe("F01 — Servidor único + health (Playground)", () => {
  const pact = new PactV3({
    consumer: consumerNameFor("F01"), // "playground-F01"
    provider: FACTORY_PROVIDER, // "FactoryProvider"
    dir: PACT_DIR, // "software-testing-playground-v2/pacts"
    logLevel: PACT_LOG_LEVEL, // "warn"
  });

  it("a request for health returns queue with pending and running", async () => {
    pact
      .given("factory is healthy")
      .uponReceiving("a request for health")
      .withRequest({
        method: "GET",
        path: "/factory/health",
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          queue: {
            pending: integer(0),
            running: integer(0),
          },
          uptime: integer(12345),
          version: like("local"),
          ts: ISO8601,
        },
      });

    await pact.executeTest(async (mockServer) => {
      const t0 = performance.now();
      const res = await fetch(`${mockServer.url}/factory/health`, {
        headers: { Accept: "application/json" },
      });
      const durationMs = Math.round(performance.now() - t0);
      const body = (await res.json()) as unknown as {
        queue: { pending: unknown; running: unknown };
        uptime: unknown;
        version: unknown;
        ts: unknown;
      };

      expect(res.status).toBe(200);
      expect(typeof body.queue.pending).toBe("number");
      expect(typeof body.queue.running).toBe("number");
      expect(durationMs).toBeLessThan(500);
      // No validar uptime/version/ts exactos — matchers ya los flexibilizan
      expect(typeof body.uptime).toBe("number");
      expect(typeof body.version).toBe("string");
      expect(typeof body.ts).toBe("string");
    });
  });
});
