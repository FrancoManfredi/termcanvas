/**
 * ResultStore — tienda única de `result.json` (refactor ① E1, A1).
 *
 * Rico/pobre/ausente/corrupto/viejos; compat legacy enriquecida (H-001);
 * poda del pobre (H-008); conciliación de `createdFiles` (punto H-012).
 * Todo offline en tmp, sin daemon, sin docker, sin LLM.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildResultPayload,
  ensureResultJsonCompat,
  isRichResultJson,
  pruneIfPoor,
  readResult,
  reconcileCreatedFiles,
  writeResult,
} from "../headless-runtime/workItem/resultStore.ts";
import type { VerificationReport } from "../shared/types/implement.ts";

function mkDir(prefix = "rs-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkVerification(overall: "pass" | "fail" = "pass"): VerificationReport {
  const nowIso = new Date().toISOString();
  return {
    steps: [
      {
        name: "test",
        command: "pnpm test",
        exitCode: overall === "pass" ? 0 : 1,
        durationMs: 10,
        status: overall === "pass" ? "pass" : "fail",
        logSnippet: "ok",
        logPath: "logs/build.log",
      },
    ],
    overall,
    startedAt: nowIso,
    finishedAt: nowIso,
    durationMs: 10,
  };
}

function mkItem(dir: string, extra: Record<string, unknown> = {}): any {
  return {
    id: "job-rs01",
    prompt: "prompt de prueba para result store",
    worktree: dir,
    phase: "diagnosisLlm",
    status: "Complete",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline: [],
    cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
    dir,
    runnerId: "linux-build",
    ...extra,
  };
}

describe("resultStore: escritura rica (valida + atómica + .done)", () => {
  it("write → read round-trip con verification + createdFiles + evidence", () => {
    const dir = mkDir();
    const verification = {
      ...mkVerification("fail"),
      evidence: [
        { kind: "note", status: "fail", summary: "setup corepack enable exit 127" },
      ],
    } as unknown as VerificationReport;
    const payload = buildResultPayload({
      workItemId: "job-rs01",
      worktreePath: dir,
      verification,
      createdFiles: ["a.txt"],
    });
    assert.equal(payload.status, "fail");
    assert.equal(payload.runnerId, "linux-build");
    writeResult(dir, payload);
    const back = readResult(dir);
    assert.ok(back, "debe leerse lo escrito");
    assert.equal(back?.status, "fail");
    assert.deepEqual(back?.createdFiles, ["a.txt"]);
    assert.equal(back?.verification.overall, "fail");
    assert.equal(back?.verification.evidence?.[0]?.kind, "note");
    // Sin .tmp huérfanos (atómico tmp→rename).
    const leftovers = fs
      .readdirSync(dir)
      .filter((f) => f.includes(".tmp-"));
    assert.deepEqual(leftovers, []);
  });

  it("pass crea .done; fail lo borra (igual que el motor interno)", () => {
    const dirPass = mkDir();
    writeResult(
      dirPass,
      buildResultPayload({
        workItemId: "job-rs01",
        worktreePath: dirPass,
        verification: mkVerification("pass"),
        createdFiles: [],
      }),
    );
    assert.equal(fs.existsSync(path.join(dirPass, ".done")), true);
    const dirFail = mkDir();
    fs.writeFileSync(path.join(dirFail, ".done"), "", "utf-8");
    writeResult(
      dirFail,
      buildResultPayload({
        workItemId: "job-rs01",
        worktreePath: dirFail,
        verification: mkVerification("fail"),
        createdFiles: [],
      }),
    );
    assert.equal(fs.existsSync(path.join(dirFail, ".done")), false);
  });

  it("payload inválido lanza (validación con schema, no escritura a ciegas)", () => {
    const dir = mkDir();
    assert.throws(() =>
      writeResult(dir, {
        workItemId: "NO-VALIDO",
        worktreePath: dir,
        status: "pass",
        verification: mkVerification("pass"),
        createdFiles: [],
        timestamp: new Date().toISOString(),
        runnerId: "linux-build",
      } as unknown as Parameters<typeof writeResult>[1]),
    );
    assert.equal(fs.existsSync(path.join(dir, "result.json")), false);
  });

  it("buildPayload mapea overall→status y capa createdFiles a 50", () => {
    const many = Array.from({ length: 80 }, (_, i) => `f${i}.txt`);
    const p = buildResultPayload({
      workItemId: "job-rs01",
      worktreePath: "/tmp/wt",
      verification: mkVerification("pass"),
      createdFiles: many,
    });
    assert.equal(p.status, "pass");
    assert.equal(p.createdFiles.length, 50);
  });
});

describe("resultStore: isRich + poda (H-008)", () => {
  it("rico (con verification) → true; pobre → false", () => {
    const dir = mkDir();
    const rich = path.join(dir, "rich.json");
    const poor = path.join(dir, "poor.json");
    fs.writeFileSync(
      rich,
      JSON.stringify({ status: "fail", verification: { overall: "fail", steps: [] } }),
      "utf-8",
    );
    fs.writeFileSync(poor, JSON.stringify({ status: "Complete" }), "utf-8");
    assert.equal(isRichResultJson(rich), true);
    assert.equal(isRichResultJson(poor), false);
  });

  it("ausente/corrupto/vacío → false sin lanzar", () => {
    const dir = mkDir();
    assert.equal(isRichResultJson(path.join(dir, "no-existe.json")), false);
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{no-json", "utf-8");
    assert.equal(isRichResultJson(bad), false);
    const nul = path.join(dir, "null.json");
    fs.writeFileSync(nul, "null", "utf-8");
    assert.equal(isRichResultJson(nul), false);
    assert.equal(isRichResultJson(""), false);
  });

  it("pruneIfPoor: rico se conserva, pobre se poda, ausente intacto", () => {
    const dirRich = mkDir();
    writeResult(
      dirRich,
      buildResultPayload({
        workItemId: "job-rs01",
        worktreePath: dirRich,
        verification: mkVerification("fail"),
        createdFiles: [],
      }),
    );
    assert.equal(pruneIfPoor(dirRich), "kept");
    assert.equal(
      fs.existsSync(path.join(dirRich, "result.json")),
      true,
      "el rico sobrevive a la poda",
    );
    const dirPoor = mkDir();
    fs.writeFileSync(
      path.join(dirPoor, "result.json"),
      JSON.stringify({ jobId: "job-rs01", status: "Complete" }),
      "utf-8",
    );
    assert.equal(pruneIfPoor(dirPoor), "pruned");
    assert.equal(fs.existsSync(path.join(dirPoor, "result.json")), false);
    const dirAbsent = mkDir();
    assert.equal(pruneIfPoor(dirAbsent), "absent");
    assert.equal(pruneIfPoor(""), "absent");
  });

  it("readResult: pobre/corrupto/ausente → null (solo el rico valida)", () => {
    const dir = mkDir();
    assert.equal(readResult(dir), null);
    fs.writeFileSync(
      path.join(dir, "result.json"),
      JSON.stringify({ jobId: "job-rs01" }),
      "utf-8",
    );
    assert.equal(readResult(dir), null);
    fs.writeFileSync(path.join(dir, "result.json"), "{roto", "utf-8");
    assert.equal(readResult(dir), null);
  });
});

describe("resultStore: compat legacy enriquecida (H-001, ex-ensureResultJson)", () => {
  it("espeja createdFiles + última verification de la meta del timeline", () => {
    const dir = mkDir();
    const verification = { overall: "pass", steps: [{ name: "test", status: "pass" }] };
    ensureResultJsonCompat(
      mkItem(dir, {
        createdFiles: ["lab3-notas"],
        timeline: [
          {
            id: "t0",
            from: "Building",
            to: "Review",
            at: new Date().toISOString(),
            actor: "runner",
            message: "verification passed → Review",
            meta: { verification, createdFiles: ["lab3-notas"] },
          },
        ],
      }),
    );
    const r = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf-8")) as Record<string, unknown>;
    assert.deepEqual(r.createdFiles, ["lab3-notas"]);
    assert.deepEqual(r.verification, verification);
  });

  it("sin verification en timeline: omite la clave; sin createdFiles: [] honesto", () => {
    const dir = mkDir();
    ensureResultJsonCompat(mkItem(dir));
    const r = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf-8")) as Record<string, unknown>;
    assert.ok(!("verification" in r));
    assert.deepEqual(r.createdFiles, []);
  });

  it("con dos verifications gana la última del timeline", () => {
    const dir = mkDir();
    const v1 = { overall: "fail", steps: [] };
    const v2 = { overall: "pass", steps: [] };
    const meta = (v: unknown) => ({
      id: "t",
      from: "Building",
      to: "Review",
      at: new Date().toISOString(),
      actor: "runner",
      message: "m",
      meta: { verification: v },
    });
    ensureResultJsonCompat(mkItem(dir, { timeline: [meta(v1), meta(v2)] }));
    const r = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf-8")) as Record<string, unknown>;
    assert.deepEqual(r.verification, v2);
  });

  it("jamás pisa un rico existente (H-008 causa 1ª, estructural)", () => {
    const dir = mkDir();
    const rich = {
      workItemId: "job-rs01",
      worktreePath: dir,
      status: "fail",
      verification: mkVerification("fail"),
      createdFiles: ["evidencia.txt"],
      timestamp: new Date().toISOString(),
      runnerId: "linux-build",
    };
    fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(rich), "utf-8");
    ensureResultJsonCompat(
      mkItem(dir, {
        createdFiles: ["otro.txt"],
        timeline: [
          {
            id: "t0",
            from: "Building",
            to: "Triage",
            at: new Date().toISOString(),
            actor: "runner",
            message: "x",
            meta: { verification: mkVerification("pass") },
          },
        ],
      }),
    );
    const r = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf-8")) as Record<string, unknown>;
    assert.deepEqual(r.createdFiles, ["evidencia.txt"], "el rico no se pisa");
    assert.equal(
      (r.verification as { overall?: string })?.overall,
      "fail",
      "la verification rica no se pisa",
    );
  });
});

describe("resultStore: conciliación de createdFiles (punto H-012)", () => {
  it("existentes se conservan, fantasmas se descartan (como hoy)", () => {
    const wt = mkDir("wt-");
    fs.writeFileSync(path.join(wt, "real.txt"), "hola\n", "utf-8");
    const out = reconcileCreatedFiles(["real.txt", "fantasma.txt", ""], wt);
    assert.deepEqual(out.kept, ["real.txt"]);
    assert.ok(out.dropped.includes("fantasma.txt"));
  });

  it("entradas no-array o worktree raro → vacío sin lanzar", () => {
    assert.deepEqual(reconcileCreatedFiles(null, "/tmp"), { kept: [], dropped: [] });
    assert.deepEqual(reconcileCreatedFiles("a.txt", "/tmp"), { kept: [], dropped: [] });
    assert.deepEqual(reconcileCreatedFiles([], ""), { kept: [], dropped: [] });
  });
});

describe("resultStore: barrido de importaciones prohibidas (tienda única)", () => {
  // Nadie importa el motor interno `resultWriter` como escritor salvo el
  // store; nadie importa `ensureResultJson` de `workItemDisk` (alias
  // jubilado). Barrido acotado (sin walks recursivos): archivos vecinos.
  const NEIGHBORS = [
    "headless-runtime/workItem/workItemStore.ts",
    "headless-runtime/workItem/workItemDisk.ts",
    "headless-runtime/implement/implementService.ts",
    "headless-runtime/factory/factoryServer.ts",
    "src/features/factoryLab/components/VerificationPanel.tsx",
    "src/features/factoryLab/components/workItemSummary.ts",
  ];

  function srcOf(rel: string): string {
    return fs.readFileSync(path.join(process.cwd(), rel), "utf-8");
  }

  function importLines(src: string): string[] {
    return src.split("\n").filter((l) => /(^|\s)import[\s(]/.test(l));
  }

  it("ningún vecino importa resultWriter (solo resultStore lo usa como motor)", () => {
    for (const rel of NEIGHBORS) {
      const hits = importLines(srcOf(rel)).filter((l) => l.includes("resultWriter"));
      assert.deepEqual(hits, [], `${rel} no debe importar resultWriter`);
    }
    // El store sí lo usa (implementación interna, un solo importador).
    const storeImports = importLines(
      srcOf("headless-runtime/workItem/resultStore.ts"),
    ).filter((l) => l.includes("resultWriter"));
    assert.equal(storeImports.length, 1);
  });

  it("nadie importa ensureResultJson de workItemDisk (alias jubilado)", () => {
    for (const rel of NEIGHBORS) {
      if (rel.endsWith("workItemDisk.ts")) continue;
      const hits = importLines(srcOf(rel)).filter((l) =>
        l.includes("ensureResultJson"),
      );
      assert.deepEqual(hits, [], `${rel} no debe importar ensureResultJson`);
    }
  });
});
