// Tests del selector de puertos para servers efímeros.
//
// Bug raíz: el sorteo crudo [20000, 65000) pisaba a veces el RANGO DINÁMICO
// de Windows (49152-65535, verificado con `netsh int ipv4 show dynamicport`)
// donde el SO asigna puertos a conexiones salientes activas — el bind de
// `opencode serve` fallaba con "Unexpected error/ServeError". El selector
// cappea por debajo del rango dinámico y PRE-VALIDA con bind real.

import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { encontrarPuertoServidor } from "../headless-runtime/interview/puerto-libre.ts";

test("encontrarPuertoServidor: devuelve un puerto bindeable dentro del techo (fuera del rango dinámico)", async () => {
  for (let i = 0; i < 5; i++) {
    const port = await encontrarPuertoServidor(20000, 45000);
    assert.ok(port >= 20000 && port <= 49000, `${port} fuera del rango permitido`);
    // El puerto quedó libre al cerrar el pre-bind: debe ser bindeable ahora.
    await new Promise<void>((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(port, "127.0.0.1", () => {
        s.close(() => resolve());
      });
    });
  }
});

test("encontrarPuertoServidor: salta puertos ocupados sin fallar", async () => {
  // Ocupa un puerto del rango y fuerza candidatos hasta chocarlo: el
  // selector nunca debe entregar un puerto que NO acepte bind.
  const bloqueos: net.Server[] = [];
  const ocupados = new Set<number>();
  for (let i = 0; i < 8; i++) {
    const s = net.createServer();
    await new Promise<void>((resolve) => {
      s.listen(0, "127.0.0.1", () => resolve());
    });
    bloqueos.push(s);
    ocupados.add((s.address() as net.AddressInfo).port);
  }
  try {
    for (let i = 0; i < 10; i++) {
      const port = await encontrarPuertoServidor(20000, 45000);
      assert.ok(!ocupados.has(port), `entregó un puerto ocupado (${port})`);
      await new Promise<void>((resolve, reject) => {
        const s = net.createServer();
        s.once("error", reject);
        s.listen(port, "127.0.0.1", () => {
          s.close(() => resolve());
        });
      });
    }
  } finally {
    for (const s of bloqueos) s.close();
  }
});
