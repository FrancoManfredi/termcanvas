/**
 * sseHelper — helper fuera de Pact para validar SSE vivo.
 *
 * IMPORTANTE (hybrid Pact §3.3):
 *  Pact puede validar el *handshake* HTTP de SSE (GET /factory/jobs/:id/events → 200 + Content-Type: text/event-stream)
 *  pero NO puede validar el stream vivo (mensajes `data: ...\n\n` emitidos cada 700ms, heartbeat, `event: done`).
 *  Pact es request→response síncrono; SSE es request→stream infinito keep-alive.
 *  Por eso F03 es híbrido: Pact cubre polling GET /jobs/:id + handshake SSE, y este helper cubre
 *  la validación humana/automática del stream real con timeout.
 *
 * Uso fuera del pact spec (no dentro de PactV3.executeTest):
 *  - En test manual `pnpm p:verify` + helper, o en `F03.sse.manual.spec.ts` separado.
 *  - En PowerShell manual: `curl.exe --silent -H "Accept: text/event-stream" http://127.0.0.1:17680/factory/jobs/<id>/events`
 *  - En código:
 *    ```ts
 *    import { collectSse } from "../support/sseHelper.js";
 *    const lines = await collectSse(`http://127.0.0.1:${port}/factory/jobs/${id}/events`, 3500);
 *    expect(lines.length).toBeGreaterThanOrEqual(1);
 *    expect(lines[0]).toMatch(/^data: /);
 *    ```
 *
 * Este helper NO se usa dentro del pact consumer spec (F03.consumer.spec.ts). El consumer spec solo valida
 * handshake (status 200 + header). Documentar limitación SSE aquí es intencional para que reviewer entienda
 * por qué F03 no es 100% Pact y requiere verificación humana/helper.
 *
 * Windows only — usa fetch con AbortController, compatible con Node 18+ (global fetch).
 */

/**
 * Consume un SSE endpoint y colecta líneas `data:` hasta timeout o `event: done`.
 *
 * @param url - URL completa del endpoint SSE, ej `http://127.0.0.1:17680/factory/jobs/job-xxx/events`
 * @param timeoutMs - tiempo máximo de espera en ms (default 3500, suficiente para ver ≥1 log del stub 700/2200)
 * @returns array de líneas que empiezan con `data: ` (JSON stringified { line, ts })
 *
 * @throws si fetch falla (status no ok, body null) o timeout sin datos
 *
 * Ejemplo PowerShell equivalente:
 *  ```powershell
 *  curl.exe --silent -H "Accept: text/event-stream" http://127.0.0.1:17680/factory/jobs/<id>/events --max-time 4
 *  ```
 */
export async function collectSse(url: string, timeoutMs = 3500): Promise<string[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    throw new Error(`SSE fetch failed for ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    clearTimeout(timeout);
    throw new Error(`SSE failed ${url} → ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    clearTimeout(timeout);
    throw new Error(`SSE failed ${url} → no body`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // SSE se delimita por líneas; cada evento termina en \n\n
      // Extraemos líneas completas del buffer
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trimEnd();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.startsWith("data: ")) {
          lines.push(line);
        }
        if (line.startsWith("event: done")) {
          clearTimeout(timeout);
          try {
            await reader.cancel();
          } catch {}
          ctrl.abort();
          return lines;
        }
        // Si ya tenemos evidencia suficiente, cortamos temprano para no esperar todo el timeout
        if (lines.length >= 3) {
          clearTimeout(timeout);
          try {
            await reader.cancel();
          } catch {}
          ctrl.abort();
          return lines;
        }
      }
    }
  } catch (e) {
    // AbortError es esperado por timeout
    if (e instanceof Error && e.name === "AbortError") {
      // timeout — retornamos lo colectado hasta ahora
    } else {
      clearTimeout(timeout);
      throw e;
    }
  } finally {
    clearTimeout(timeout);
    try {
      await reader.cancel();
    } catch {}
  }

  return lines;
}

/**
 * Variante que valida que al menos un `data:` llega en timeoutMs.
 * Útil para test helper rápido:
 *   await assertSseLive(`http://127.0.0.1:${port}/factory/jobs/${id}/events`);
 */
export async function assertSseLive(url: string, timeoutMs = 3500): Promise<void> {
  const lines = await collectSse(url, timeoutMs);
  if (lines.length === 0) {
    throw new Error(`SSE live assertion failed: no data: lines received from ${url} within ${timeoutMs}ms`);
  }
  // Validación mínima: cada línea debe ser JSON parseable tras `data: `
  for (const line of lines) {
    const jsonPart = line.slice(6); // remove "data: "
    try {
      const parsed = JSON.parse(jsonPart) as { line: unknown; ts: unknown };
      if (typeof parsed.line !== "string") {
        throw new Error(`parsed.line is not string`);
      }
    } catch (e) {
      throw new Error(`SSE data line is not valid JSON {line, ts}: "${line}" → ${String(e)}`);
    }
  }
}
