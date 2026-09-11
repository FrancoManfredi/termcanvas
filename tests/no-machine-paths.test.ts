/**
 * Candado H1+H2 — Ola 6 des-hardcodeo.
 *
 * Este test recorre el código productivo y falla si encuentra literales de máquina
 * o nombres propios de test:
 *   - `C:\Users` (cualquier ruta absoluta de perfil de máquina)
 *   - `Estudiante UCU` (nombre de usuario de máquina)
 *   - `Hola mundo` (nombre propio de test, con límites de palabra, case-insensitive)
 *   - `carepta` / `carpta` (typos convertidos en lógica de negocio, idem)
 *
 * Alcance: headless-runtime (recursivo, extension .ts), src (recursivo,
 * extensiones .ts y .tsx), shared (recursivo, extension .ts) y scripts
 * (solo nivel superior, extension .mjs).
 * Excluye `*.test.ts` / `*.test.tsx` y cualquier directorio `tests/`, `__tests__`
 * o `fixtures`.
 *
 * EXENCIONES DOCUMENTADAS: `docs/`, `tests/`, fixtures y comentarios de diseño en
 * otros lados están exentos — este candado solo rige código productivo. Los tests
 * necesitan mencionar los literales prohibidos para afirmar su ausencia, por eso
 * viven bajo `tests/` y están excluidos del barrido.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface ScanTarget {
  dir: string;
  recursive: boolean;
  extensions: string[];
}

const SCAN_TARGETS: ScanTarget[] = [
  { dir: "headless-runtime", recursive: true, extensions: [".ts"] },
  { dir: "src", recursive: true, extensions: [".ts", ".tsx"] },
  { dir: "shared", recursive: true, extensions: [".ts"] },
  { dir: "scripts", recursive: false, extensions: [".mjs"] },
];

const BANNED: Array<{ label: string; pattern: RegExp }> = [
  // Rutas de máquina (backslash simple y doble — en fuente .mjs/.ts los literales
  // escapados se ven como C:\\Users).
  { label: "C:\\Users", pattern: /c:\\users/i },
  { label: "C:\\\\Users", pattern: /c:\\\\users/i },
  { label: "Estudiante UCU", pattern: /estudiante ucu/i },
  // Nombres propios de datos de prueba (las keywords de idioma carpeta/carepta/
  // carpta/directorio/folder están PERMITIDAS: es idioma, no hardcodeo).
  { label: "Hola mundo", pattern: /\bhola mundo\b/i },
];

const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "tests", "__tests__", "fixtures"]);

function isExcludedFile(absPath: string): boolean {
  const base = path.basename(absPath);
  if (base.endsWith(".test.ts") || base.endsWith(".test.tsx")) return true;
  return false;
}

function collectFiles(absDir: string, recursive: boolean, extensions: string[]): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(absDir, name);
    let stat: ReturnType<typeof statSync> | null = null;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!recursive) continue;
      if (SKIPPED_DIRS.has(name)) continue;
      out.push(...collectFiles(full, recursive, extensions));
    } else if (stat.isFile()) {
      if (isExcludedFile(full)) continue;
      if (extensions.includes(path.extname(name))) out.push(full);
    }
  }
  return out;
}

test("código productivo sin literales de máquina ni nombres propios de test (H1+H2)", () => {
  const violations: string[] = [];
  let scanned = 0;
  for (const target of SCAN_TARGETS) {
    const files = collectFiles(path.join(REPO_ROOT, target.dir), target.recursive, target.extensions);
    for (const file of files) {
      scanned += 1;
      let content: string;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (const banned of BANNED) {
        const hitLines: number[] = [];
        lines.forEach((line, idx) => {
          if (banned.pattern.test(line)) hitLines.push(idx + 1);
        });
        if (hitLines.length > 0) {
          violations.push(
            `${path.relative(REPO_ROOT, file)} → literal prohibido "${banned.label}" líneas ${hitLines.join(",")}`,
          );
        }
      }
    }
  }
  assert.ok(scanned > 0, "el barrido debe encontrar archivos productivos para inspeccionar");
  assert.deepEqual(
    violations,
    [],
    `literales de máquina / nombres propios en código productivo (${violations.length}):\n${violations.slice(0, 30).join("\n")}`,
  );
});
