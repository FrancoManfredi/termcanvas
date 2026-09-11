import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  JOB_INDEX_FILE,
  readJobIndexBases,
  readJobIndexDirs,
  recordJobDirInIndex,
  scanAndRestoreBases,
  shouldRestoreJobDir,
} from "../headless-runtime/workItem/workItemDisk.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

// P3b/P3c: índice de job-dirs para worktrees arbitrarios + create durable.
// El índice vive en TERMCANVAS_FACTORY_DIR (tmp en tests) o <repo>/factory.

const PREV_ENV = process.env.TERMCANVAS_FACTORY_DIR;
let factoryDir = "";

function useTmpFactory(prefix = "jobidx-"): string {
  factoryDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.TERMCANVAS_FACTORY_DIR = factoryDir;
  return factoryDir;
}

function restoreEnv(): void {
  if (PREV_ENV === undefined) delete process.env.TERMCANVAS_FACTORY_DIR;
  else process.env.TERMCANVAS_FACTORY_DIR = PREV_ENV;
}

function rmRf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

test("índice: record + read roundtrip deriva la base existente", () => {
  const fx = useTmpFactory();
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "jobidx-wt-"));
  try {
    const base = path.join(wt, ".agents", "factory");
    fs.mkdirSync(path.join(base, "job-idx-1"), { recursive: true });
    recordJobDirInIndex("job-idx-1", path.join(base, "job-idx-1"));
    assert.ok(fs.existsSync(path.join(fx, JOB_INDEX_FILE)), "índice escrito");
    assert.deepEqual(readJobIndexBases(), [base]);
  } finally {
    rmRf(wt);
    rmRf(fx);
    restoreEnv();
  }
});

test("índice: upsert por id sin duplicados y base inexistente se salta", () => {
  const fx = useTmpFactory();
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "jobidx-wt-"));
  try {
    const base = path.join(wt, ".agents", "factory");
    fs.mkdirSync(base, { recursive: true });
    recordJobDirInIndex("job-idx-2", path.join(base, "job-idx-2"));
    recordJobDirInIndex("job-idx-2", path.join(base, "job-idx-2"));
    recordJobDirInIndex("job-idx-3", path.join(wt, "borrado", "job-idx-3"));
    const bases = readJobIndexBases();
    assert.equal(bases.filter((b) => b === base).length, 1);
    assert.ok(!bases.some((b) => b.includes("borrado")), "base inexistente fuera");
  } finally {
    rmRf(wt);
    rmRf(fx);
    restoreEnv();
  }
});

test("índice: archivo roto o ausente → [] sin lanzar", () => {
  const fx = useTmpFactory();
  try {
    assert.deepEqual(readJobIndexBases(), []);
    fs.writeFileSync(path.join(fx, JOB_INDEX_FILE), "esto no es json {{", "utf-8");
    assert.deepEqual(readJobIndexBases(), []);
    recordJobDirInIndex("", "");
    recordJobDirInIndex(null as unknown as string, null as unknown as string);
    assert.deepEqual(readJobIndexBases(), []);
  } finally {
    rmRf(fx);
    restoreEnv();
  }
});

test("create es durable: job.json existe al nacer + índice registrado", () => {
  const fx = useTmpFactory();
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "jobidx-wt-"));
  const id = "job-idx-create01";
  try {
    workItemStore.create({ id, prompt: "hola índice", worktree: wt });
    try {
      const jobJson = path.join(wt, ".agents", "factory", id, "job.json");
      assert.ok(fs.existsSync(jobJson), "job.json escrito en el create");
      const bases = readJobIndexBases();
      assert.ok(
        bases.includes(path.join(wt, ".agents", "factory")),
        "base del job en el índice",
      );
    } finally {
      try {
        workItemStore.delete(id);
      } catch {}
    }
  } finally {
    rmRf(wt);
    rmRf(fx);
    restoreEnv();
  }
});

test("scanAndRestoreBases levanta un job indexado fuera de las bases fijas", () => {
  const fx = useTmpFactory();
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "jobidx-arbitrario-"));
  const id = "job-idx-restore01";
  try {
    workItemStore.create({ id, prompt: "job arbitrario", worktree: wt });
    try {
      const fresh = new Map();
      const n = scanAndRestoreBases(fresh as never);
      assert.ok(n >= 1, "al menos el job indexado");
      assert.ok((fresh as Map<string, unknown>).has(id), "el job indexado está en el mapa");
    } finally {
      try {
        workItemStore.delete(id);
      } catch {}
    }
  } finally {
    rmRf(wt);
    rmRf(fx);
    restoreEnv();
  }
});

test("shouldRestoreJobDir: repo e indexados siempre, tmp anónimo se salta (A3)", () => {
  const fx = useTmpFactory();
  const prevRestore = process.env.RESTORE_TMP_FULL;
  delete process.env.RESTORE_TMP_FULL;
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "jobidx-playground-"));
  try {
    const anonDir = path.join(wt, ".agents", "factory", "job-anon");
    fs.mkdirSync(anonDir, { recursive: true });
    const idxDir = path.join(wt, ".agents", "factory", "job-idxd");
    fs.mkdirSync(idxDir, { recursive: true });
    recordJobDirInIndex("job-idxd", idxDir);
    const indexed = readJobIndexDirs();
    assert.ok(indexed.has(path.resolve(idxDir).toLowerCase()));
    // Repo siempre restaura (aunque no indexado).
    assert.equal(
      shouldRestoreJobDir(path.join("C:", "repo", ".agents", "factory", "job-x"), indexed),
      true,
    );
    // Tmp indexado restaura; tmp anónimo se salta.
    assert.equal(shouldRestoreJobDir(idxDir, indexed), true);
    assert.equal(shouldRestoreJobDir(anonDir, indexed), false);
    // Override restaura todo; junk nunca lanza.
    process.env.RESTORE_TMP_FULL = "1";
    assert.equal(shouldRestoreJobDir(anonDir, indexed), true);
    delete process.env.RESTORE_TMP_FULL;
    assert.equal(shouldRestoreJobDir(null, indexed), false);
    assert.equal(shouldRestoreJobDir("", indexed), false);
    assert.equal(shouldRestoreJobDir(anonDir, null), false);
  } finally {
    if (prevRestore === undefined) delete process.env.RESTORE_TMP_FULL;
    else process.env.RESTORE_TMP_FULL = prevRestore;
    rmRf(wt);
    rmRf(fx);
    restoreEnv();
  }
});
