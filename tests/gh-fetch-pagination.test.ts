/**
 * gh-fetch-pagination — regresión del fetch de issues colgado.
 *
 * Historial: `gh api graphql --paginate` solo inyecta `$endCursor`; con
 * `$cursor` el `after:` quedaba siempre en null → página 1 en loop hasta
 * el timeout → panel sin issues (explotó al superar 50 issues). El fetch
 * ahora pagina manualmente (loop propio con `endCursor` + flag
 * `complete`), así no depende de rarezas del CLI y el canvas solo poda
 * equipos obsoletos con un fetch completo, nunca parcial.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainTs = fs.readFileSync(path.join(here, "..", "electron", "main.ts"), "utf-8");

test("fetch-issues pagina manualmente (sin --paginate) con endCursor y flag complete", () => {
  assert.ok(
    !mainTs.includes('"--paginate"'),
    "el fetch no debe usar gh --paginate (loop silencioso con otra variable)",
  );
  assert.ok(
    mainTs.includes("after: $endCursor"),
    "el after: debe usar $endCursor",
  );
  assert.ok(
    mainTs.includes("MAX_ISSUE_PAGES"),
    "el loop manual debe estar acotado",
  );
  assert.ok(
    mainTs.includes("fetchComplete"),
    "el fetch debe reportar completeness para el prune",
  );
});

test("preload expone complete en el resultado del fetch", () => {
  const preload = fs.readFileSync(
    path.join(here, "..", "electron", "preload.ts"),
    "utf-8",
  );
  assert.ok(
    preload.includes("complete?: boolean"),
    "fetchIssues debe tipar complete como opcional",
  );
});
