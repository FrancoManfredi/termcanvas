/**
 * reviewDiff — el reviewer ve líneas agregadas/borradas, no solo la lista.
 * getReviewDiffBlock combina `git diff HEAD` (tracked) + contenido de
 * untracked nuevos, acotado a 12KB. Nunca lanza.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getReviewDiffBlock,
  REVIEW_DIFF_MAX_BYTES,
} from "../headless-runtime/review/reviewDiff.ts";

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd: dir,
    encoding: "utf-8",
    timeout: 15000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-diff-"));
  git(dir, "init");
  fs.writeFileSync(path.join(dir, "src-auth.ts"), "old\n", "utf-8");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "base");
  return dir;
}

test("tracked modificado: muestra agregados y borrados", () => {
  const dir = tmpRepo();
  try {
    fs.writeFileSync(path.join(dir, "src-auth.ts"), "old\nnew-line\n", "utf-8");
    const out = getReviewDiffBlock(dir, ["src-auth.ts"]);
    assert.ok(out.includes("+new-line"), "agregado visible");
    assert.ok(out.includes("src-auth.ts"), "path visible");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("untracked nuevo: muestra contenido con header", () => {
  const dir = tmpRepo();
  try {
    fs.writeFileSync(path.join(dir, "nuevo.ts"), "export const x = 1;\n", "utf-8");
    const out = getReviewDiffBlock(dir, ["nuevo.ts"]);
    assert.ok(out.includes("### Nuevo archivo: nuevo.ts"), "header de nuevo");
    assert.ok(out.includes("export const x = 1;"), "contenido visible");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lista con archivo fuera del diff igual trae el resto", () => {
  const dir = tmpRepo();
  try {
    fs.writeFileSync(path.join(dir, "src-auth.ts"), "old\ncambio\n", "utf-8");
    const out = getReviewDiffBlock(dir, ["src-auth.ts", "inexistente.ts"]);
    assert.ok(out.includes("+cambio"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("acota a 12KB con marca", () => {
  const dir = tmpRepo();
  try {
    fs.writeFileSync(path.join(dir, "big.ts"), `${"x\n".repeat(20000)}`, "utf-8");
    const before = getReviewDiffBlock(dir, ["big.ts"]);
    assert.ok(before.length <= REVIEW_DIFF_MAX_BYTES + 512, `acotado, son ${before.length}`);
    const tiny = getReviewDiffBlock(dir, ["big.ts"], 100);
    assert.ok(tiny.includes("truncado") || tiny.includes("fuera del tope"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("traversal, no-repo y vacíos devuelven string vacío sin lanzar", () => {
  const dir = tmpRepo();
  try {
    assert.equal(getReviewDiffBlock(dir, ["../evil.ts"]), "");
    assert.equal(getReviewDiffBlock(dir, []), "");
    assert.equal(getReviewDiffBlock(os.tmpdir(), ["a.ts"]), "");
    assert.equal(getReviewDiffBlock(null, ["a.ts"]), "");
    assert.equal(getReviewDiffBlock(dir, "no-array" as never), "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
