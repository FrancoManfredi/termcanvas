// Tests de sincronización de contexto: identidad canónica + flujo completo
// push/pull/conflicto entre dos "máquinas" simuladas con repos git locales
// (bare como remoto del sidecar). Sin red y sin gh.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseOriginToSlug,
  resolveProjectIdentity,
} from "../cli/context-sync/identity.ts";
import { listFilesRecursive } from "../cli/context-sync/fs-utils.ts";
import type { ContextSyncConfig } from "../cli/context-sync/sidecar.ts";
import { CONTEXT_SYNC_SCHEMA_VERSION } from "../cli/context-sync/sidecar.ts";
import {
  contextInit,
  contextPull,
  contextPush,
  contextStatus,
} from "../cli/context-sync/operations.ts";
import type { CommandRunner } from "../cli/context-sync/types.ts";

// ─── parseOriginToSlug ──────────────────────────────────────────────────────

test("parseOriginToSlug acepta https con y sin .git", () => {
  assert.deepEqual(parseOriginToSlug("https://github.com/owner/repo.git"), {
    owner: "owner",
    name: "repo",
  });
  assert.deepEqual(parseOriginToSlug("https://github.com/owner/repo"), {
    owner: "owner",
    name: "repo",
  });
});

test("parseOriginToSlug acepta scp-like y ssh://", () => {
  assert.deepEqual(parseOriginToSlug("git@github.com:owner/repo.git"), {
    owner: "owner",
    name: "repo",
  });
  assert.deepEqual(parseOriginToSlug("ssh://git@github.com/owner/repo.git"), {
    owner: "owner",
    name: "repo",
  });
});

test("parseOriginToSlug tolera slashes finales y puertos", () => {
  assert.deepEqual(parseOriginToSlug("https://github.com/owner/repo/"), {
    owner: "owner",
    name: "repo",
  });
  assert.deepEqual(parseOriginToSlug("https://git.example.com:8443/owner/repo.git"), {
    owner: "owner",
    name: "repo",
  });
});

test("parseOriginToSlug rechaza basura, paths de Windows y single-segment", () => {
  assert.equal(parseOriginToSlug(""), null);
  assert.equal(parseOriginToSlug("no es una url"), null);
  assert.equal(parseOriginToSlug("C:\\Users\\Franco\\proyecto"), null);
  assert.equal(parseOriginToSlug("https://github.com/solo-uno"), null);
});

// ─── Helpers de infraestructura de test ─────────────────────────────────────

const runner: CommandRunner = (cmd, args, opts) =>
  Promise.resolve(
    (() => {
      const res = spawnSync(cmd, args, {
        cwd: opts?.cwd,
        encoding: "utf-8",
        windowsHide: true,
      });
      return {
        status: res.status ?? 1,
        stdout: res.stdout ?? "",
        stderr: res.stderr ?? "",
      };
    })(),
  );

function git(args: string[], cwd?: string): void {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
  });
  assert.equal(res.status, 0, `git ${args.join(" ")} falló: ${res.stderr}`);
}

const baseDeps = {
  run: runner,
  now: () => new Date("2026-08-21T12:00:00Z"),
  hostname: "test-host",
};

interface TwoMachineFixture {
  base: string;
  projectA: string;
  projectB: string;
  homeA: string;
  homeB: string;
  depA: typeof baseDeps & { home: string };
  depB: typeof baseDeps & { home: string };
}

/**
 * Dos máquinas (A y B): cada una con su proyecto git (origin fake de GitHub,
 * solo para la identidad), su contextHome pre-configurado apuntando a un
 * bare local que hace de remoto del sidecar. gh no se invoca nunca.
 */
function makeTwoMachines(): TwoMachineFixture {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-sync-e2e-"));
  const bare = path.join(base, "origin.git");
  fs.mkdirSync(bare, { recursive: true });
  git(["init", "--bare", "-b", "main", "."], bare);

  // Ambas máquinas trabajan el MISMO repo: dirs locales distintos pero el
  // MISMO origin (identidad canónica idéntica) — esa es la premisa del sync.
  const makeProject = (dirName: string): string => {
    const dir = path.join(base, dirName);
    fs.mkdirSync(dir, { recursive: true });
    git(["init"], dir);
    git(["remote", "add", "origin", "https://github.com/testowner/proyecto-compartido.git"], dir);
    return dir;
  };

  const makeHome = (name: string): string => {
    const home = path.join(base, name);
    fs.mkdirSync(home, { recursive: true });
    const config: ContextSyncConfig = {
      schema_version: CONTEXT_SYNC_SCHEMA_VERSION,
      slug: "testowner/termcanvas-context",
      remote: bare,
    };
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify(config, null, 2),
    );
    return home;
  };

  return {
    base,
    projectA: makeProject("maquina-a"),
    projectB: makeProject("maquina-b"),
    homeA: makeHome("home-a"),
    homeB: makeHome("home-b"),
    depA: { ...baseDeps, home: path.join(base, "home-a") },
    depB: { ...baseDeps, home: path.join(base, "home-b") },
  };
}

function writeAgent(projectPath: string, relKey: string, content: string): string {
  const full = path.join(projectPath, ".agents", ...relKey.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

// ─── resolveProjectIdentity ────────────────────────────────────────────────

test("resolveProjectIdentity resuelve el slug desde origin y falla sin origin", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-id-"));
  git(["init"], dir);

  await assert.rejects(() => resolveProjectIdentity(dir, runner));

  git(["remote", "add", "origin", "git@github.com:acme/widgets.git"], dir);
  assert.deepEqual(await resolveProjectIdentity(dir, runner), {
    owner: "acme",
    name: "widgets",
  });
});

// ─── Flujo e2e entre dos máquinas ───────────────────────────────────────────

test("push desde A → pull en B trae el contexto", async () => {
  const fx = makeTwoMachines();
  try {
    writeAgent(fx.projectA, "interview/requerimientos/entrevista-1.json", '{"a":1}');
    writeAgent(fx.projectA, "repo-context.md", "# contexto\n");

    // init en A: agrega .agents/ al .gitignore
    const initA = await contextInit(fx.projectA, fx.depA);
    assert.equal(initA.slug, "testowner/proyecto-compartido");
    assert.equal(initA.gitignoreUpdated, true);
    const gi = fs.readFileSync(path.join(fx.projectA, ".gitignore"), "utf-8");
    assert.match(gi, /^\.agents\/$/m);

    const pushA = await contextPush(fx.projectA, fx.depA);
    assert.equal(pushA.pushed, true);
    assert.ok(pushA.copiedCount >= 2);

    const pullB = await contextPull(fx.projectB, fx.depB);
    assert.equal(pullB.pulled, true);
    assert.deepEqual(pullB.conflicts, []);
    const brought = path.join(
      fx.projectB,
      ".agents",
      "interview",
      "requerimientos",
      "entrevista-1.json",
    );
    assert.equal(fs.readFileSync(brought, "utf-8"), '{"a":1}');
    assert.equal(pullB.onlyLocalCount, 0);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("push idempotente: segunda corrida sin cambios no commitea", async () => {
  const fx = makeTwoMachines();
  try {
    writeAgent(fx.projectA, "contexto/contexto-1.json", "{}");
    await contextInit(fx.projectA, fx.depA);
    await contextPush(fx.projectA, fx.depA);

    const second = await contextPush(fx.projectA, fx.depA);
    assert.equal(second.changed, false);
    assert.equal(second.pushed, false);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("pull nunca pisa cambios locales: divergencia genera .conflict-<ts> y el push posterior funciona", async () => {
  const fx = makeTwoMachines();
  try {
    const key = "interview/requerimientos/entrevista-7.json";
    writeAgent(fx.projectA, key, '{"version":"base"}');
    await contextPush(fx.projectA, fx.depA);

    // B lo trae...
    await contextPull(fx.projectB, fx.depB);
    const localB = path.join(fx.projectB, ".agents", ...key.split("/"));

    // ...y AMBAS máquinas editan el mismo archivo.
    writeAgent(fx.projectA, key, '{"version":"editada-en-A"}');
    await contextPush(fx.projectA, fx.depA);
    writeAgent(fx.projectB, key, '{"version":"editada-en-B"}');

    const pullB = await contextPull(fx.projectB, fx.depB);
    assert.equal(pullB.pulled, true);
    assert.equal(pullB.conflicts.length, 1);
    assert.equal(pullB.conflicts[0].key, key);

    // La local quedó intacta; la entrante vive al lado como conflicto.
    assert.equal(fs.readFileSync(localB, "utf-8"), '{"version":"editada-en-B"}');
    const incoming = pullB.conflicts[0].incomingPath;
    assert.match(path.basename(incoming), /\.conflict-\d{8}T\d{6}Z$/);
    assert.equal(fs.readFileSync(incoming, "utf-8"), '{"version":"editada-en-A"}');

    // El push de B (con su versión + la copia de conflicto) es fast-forward.
    const pushB = await contextPush(fx.projectB, fx.depB);
    assert.equal(pushB.pushed, true);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("push espeja borrados locales en el sidecar", async () => {
  const fx = makeTwoMachines();
  try {
    const viejo = writeAgent(fx.projectA, "planning/viejo.json", "1");
    writeAgent(fx.projectA, "planning/nuevo.json", "2");
    await contextInit(fx.projectA, fx.depA);
    await contextPush(fx.projectA, fx.depA);

    fs.unlinkSync(viejo);
    const push = await contextPush(fx.projectA, fx.depA);
    assert.equal(push.deletedCount >= 1, true);

    const repoDir = path.join(fx.homeA, "repo");
    const subtreeKeys = listFilesRecursive(
      path.join(repoDir, "projects", "testowner", "proyecto-compartido"),
    ).filter((k) => k.startsWith("planning/"));
    assert.deepEqual(subtreeKeys.sort(), ["planning/nuevo.json"]);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("status reporta diferencias por lado y commits sin pushear", async () => {
  const fx = makeTwoMachines();
  try {
    writeAgent(fx.projectA, "a.json", "a");
    await contextPush(fx.projectA, fx.depA);
    await contextPull(fx.projectB, fx.depB);

    writeAgent(fx.projectB, "b.json", "b");   // solo local en B
    writeAgent(fx.projectA, "c.json", "c");
    await contextPush(fx.projectA, fx.depA);     // c.json queda solo remoto para B

    const st = await contextStatus(fx.projectB, fx.depB);
    assert.equal(st.initialized, true);
    assert.deepEqual(st.onlyLocal, ["b.json"]);
    assert.deepEqual(st.onlyRemote, ["c.json"]);
    assert.deepEqual(st.changed, []);
    assert.equal(st.unpushedCommits, 0);
    assert.equal(st.behindRemote, 1);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("init es idempotente con el .gitignore", async () => {
  const fx = makeTwoMachines();
  try {
    await contextInit(fx.projectA, fx.depA);
    const second = await contextInit(fx.projectA, fx.depA);
    assert.equal(second.gitignoreUpdated, false);
    const count = (fs.readFileSync(path.join(fx.projectA, ".gitignore"), "utf-8").match(/^\.agents\/$/gm) ?? []).length;
    assert.equal(count, 1);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("push/pull fallan con mensaje claro si el proyecto no tiene .agents", async () => {
  const fx = makeTwoMachines();
  try {
    await assert.rejects(() => contextPush(fx.projectA, fx.depA), /no hay contexto/);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});
