/**
 * Guard H-008 en la tienda única (refactor ① E1, A4 — conversión de la suite
 * `writejobjson-result-guard`).
 *
 * Historia: el path de setup-fail de implementService escribe `result.json`
 * rico, pero el writer legacy `writeJobJson` lo borraba si el status no era
 * Complete. El guard (`isRichResultJson`) lo conservaba; en A4 el bloque
 * result pobre + el guard local se EXTIRPARON de `factoryServer.writeJobJson`
 * (conserva SOLO job.json legacy + `.done`) y la poda vive en la tienda
 * única (`resultStore.pruneIfPoor`). FASE 4 E1 enterró el re-export del server
 * (`export { isRichResultJson }`, uso-cero): la casa única es `resultStore` y
 * esta suite lo fija con aserción estática de ausencia (ver además
 * `tests/legacy-zero-use.test.ts` + techo final `tests/import-sweep-final.test.ts`).
 *
 * Todo offline en tmp, sin daemon, sin docker, sin LLM.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// La tienda única es la casa del predicado (el server ya no re-exporta).
import {
  isRichResultJson,
  pruneIfPoor,
} from "../headless-runtime/workItem/resultStore.ts";

const SERVER_SRC = fs.readFileSync(
  path.join(process.cwd(), "headless-runtime/factory/factoryServer.ts"),
  "utf-8",
);

describe("guard H-008 en resultStore (rico se conserva, pobre se poda)", () => {
  it("rico (con verification) → true; pobre → false", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rich-"));
    const rich = path.join(dir, "rich.json");
    const poor = path.join(dir, "poor.json");
    fs.writeFileSync(rich, JSON.stringify({ status: "fail", verification: { overall: "fail", steps: [] } }), "utf-8");
    fs.writeFileSync(poor, JSON.stringify({ status: "Complete" }), "utf-8");
    assert.equal(isRichResultJson(rich), true);
    assert.equal(isRichResultJson(poor), false);
  });

  it("ausente/corrupto/vacío → false sin lanzar", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rich-"));
    assert.equal(isRichResultJson(path.join(dir, "no-existe.json")), false);
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{no-json", "utf-8");
    assert.equal(isRichResultJson(bad), false);
    const nul = path.join(dir, "null.json");
    fs.writeFileSync(nul, "null", "utf-8");
    assert.equal(isRichResultJson(nul), false);
    assert.equal(isRichResultJson(""), false);
  });

  it("FASE 4 E1: el re-export jubilado ya no existe en el server (casa única resultStore)", () => {
    assert.doesNotMatch(SERVER_SRC, /export\s*\{\s*isRichResultJson\s*\}/);
    assert.doesNotMatch(SERVER_SRC, /function isRichResultJson/);
  });

  it("writeJobJson delega la poda (sin guard local ni bloque pobre; lectura estática)", () => {
    assert.match(SERVER_SRC, /resultStore\.pruneIfPoor\(wi\.dir\)/);
    assert.doesNotMatch(SERVER_SRC, /function isRichResultJson/);
    // El writer legacy ya no construye result pobre (`artifacts:` era solo
    // del bloque extirpado) ni lo escribe (`writeFileSync(resultPath`).
    // Los `promptPreview`/`resultPath` restantes son LECTURA (endpoints
    // `resultPreview` y GET /result), compat intacta.
    assert.doesNotMatch(SERVER_SRC, /artifacts:/);
    assert.doesNotMatch(SERVER_SRC, /writeFileSync\(resultPath/);
  });

  it("poda delegada: Triage con rico lo conserva, con pobre lo borra (comportamiento)", () => {
    const dirRich = fs.mkdtempSync(path.join(os.tmpdir(), "rich-"));
    fs.writeFileSync(
      path.join(dirRich, "result.json"),
      JSON.stringify({ status: "fail", verification: { overall: "fail", steps: [] } }),
      "utf-8",
    );
    assert.equal(pruneIfPoor(dirRich), "kept");
    assert.equal(fs.existsSync(path.join(dirRich, "result.json")), true);
    const dirPoor = fs.mkdtempSync(path.join(os.tmpdir(), "rich-"));
    fs.writeFileSync(
      path.join(dirPoor, "result.json"),
      JSON.stringify({ jobId: "job-x", status: "Complete" }),
      "utf-8",
    );
    assert.equal(pruneIfPoor(dirPoor), "pruned");
    assert.equal(fs.existsSync(path.join(dirPoor, "result.json")), false);
  });
});
