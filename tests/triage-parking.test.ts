/**
 * triage-parking — T3: el parking Building→Triage avisa y no se tranca en
 * silencio (caso job-mts6bh9o-sjzx).
 *
 * Contrato bajo test (offline: store en memoria + tmp, sin daemon, sin LLM):
 * - Puros (`shared/types/triage`): `shouldAutoContinueFromTriage` solo con
 *   building + confianza alta + sin fallback + sin marca previa;
 *   `hasFreshOpenQuestions` solo con preguntas posteriores al parking y sin
 *   respuesta posterior; formas junk nunca.
 * - `maybeAutoContinueFromTriage`: Triage + findings building → Foreman con
 *   marca en meta + redispatch una vez; segunda vez (marca) / no-Triage /
 *   baja confianza → null sin redispatch.
 * - `notifyTriageParking`: ping al centro (sandbox) una vez; repetido con la
 *   misma key se dedupea; nunca lanza ante junk.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Sandbox del centro de notificaciones + índice de jobs (no muta el repo).
const SANDBOX_FACTORY = fs.mkdtempSync(path.join(os.tmpdir(), "triage-park-factory-"));
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import {
  hasFreshOpenQuestions,
  hasTriageAutoContinueMarker,
  latestBuildingToTriageIndex,
  latestTriageFindings,
  shouldAutoContinueFromTriage,
  TRIAGE_AUTO_CONTINUE_META_KEY,
  TRIAGE_AUTO_CONTINUE_MIN_CONFIDENCE,
  type TriageFindings,
} from "../shared/types/triage.ts";
import {
  maybeAutoContinueFromTriage,
  notifyTriageParking,
} from "../headless-runtime/implement/implementService.ts";

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const createdIds: string[] = [];
const createdDirs: string[] = [];

function mkJob(id: string): string {
  const dir = mkTmp("triage-park-job-");
  createdDirs.push(dir);
  workItemStore.create({ id, prompt: `prompt de prueba ${id}`, worktree: dir });
  createdIds.push(id);
  return dir;
}

function toTriage(id: string): void {
  workItemStore.transition(id, "Foreman", "system", "park → Foreman");
  workItemStore.transition(id, "Triage", "foreman", "park → Triage");
}

function cleanup(): void {
  for (const id of createdIds.splice(0)) {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
  }
  for (const dir of createdDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function buildingFindings(patch: Partial<TriageFindings> = {}): TriageFindings {
  return {
    decision: "building",
    scope: "alcance acotado",
    complexity: "simple",
    openQuestions: [],
    reason: "prompt concreto con criterios explícitos",
    confidence: 0.92,
    ...patch,
  };
}

type Entry = {
  id: string;
  from: string;
  to: string;
  at: string;
  actor: string;
  message: string;
  meta?: Record<string, unknown>;
};

function entry(to: string, from = "Building", meta?: Record<string, unknown>): Entry {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    from,
    to,
    at: new Date().toISOString(),
    actor: "system",
    message: `${from} → ${to}`,
    ...(meta ? { meta } : {}),
  };
}

// ─── Puros: auto-continue ───

test("triage parking: auto-continue solo con building confiable sin marca", () => {
  assert.equal(TRIAGE_AUTO_CONTINUE_MIN_CONFIDENCE, 0.8);
  assert.equal(shouldAutoContinueFromTriage(buildingFindings(), []), true);
  assert.equal(
    shouldAutoContinueFromTriage(buildingFindings({ confidence: 0.79 }), []),
    false,
  );
  assert.equal(
    shouldAutoContinueFromTriage(buildingFindings({ fallback: true }), []),
    false,
  );
  assert.equal(
    shouldAutoContinueFromTriage(buildingFindings({ decision: "triage" }), []),
    false,
  );
  assert.equal(
    shouldAutoContinueFromTriage(buildingFindings({ decision: "spec" }), []),
    false,
  );
  const marked = [entry("Foreman", "Triage", { [TRIAGE_AUTO_CONTINUE_META_KEY]: true })];
  assert.equal(hasTriageAutoContinueMarker(marked), true);
  assert.equal(shouldAutoContinueFromTriage(buildingFindings(), marked), false);
  for (const junk of [null, undefined, 42, "building", {}, { decision: "building" }]) {
    assert.equal(shouldAutoContinueFromTriage(junk, []), false, String(junk));
  }
});

// ─── Puros: preguntas frescas ───

function triageMeta(findings: Partial<TriageFindings> & { decision: TriageFindings["decision"] }) {
  return {
    triage: {
      scope: "s",
      complexity: "simple",
      openQuestions: [],
      reason: "r",
      confidence: 0.9,
      ...findings,
    },
  };
}

test("triage parking: preguntas frescas solo si son posteriores al parking y sin respuesta", () => {
  assert.equal(hasFreshOpenQuestions([]), false);
  assert.equal(hasFreshOpenQuestions([entry("Triage")]), false);
  const fresh = [
    entry("Triage", "Building"),
    entry("Triage", "Triage", triageMeta({ decision: "triage", openQuestions: ["¿qué alcance?"] })),
  ];
  assert.equal(hasFreshOpenQuestions(fresh), true);
  const answered = [
    ...fresh,
    entry("Triage", "Triage", { triageRespond: { answers: ["alcance X"] } }),
  ];
  assert.equal(hasFreshOpenQuestions(answered), false);
  const stale = [
    entry("Triage", "Triage", triageMeta({ decision: "triage", openQuestions: ["¿qué?"] })),
    entry("Triage", "Building"),
  ];
  assert.equal(hasFreshOpenQuestions(stale), false);
  assert.equal(latestBuildingToTriageIndex(stale), 1);
  assert.equal(latestBuildingToTriageIndex([]), -1);
  const latest = latestTriageFindings(fresh);
  assert.equal(latest?.decision, "triage");
  assert.deepEqual(latest?.openQuestions, ["¿qué alcance?"]);
  assert.equal(latestTriageFindings([]), null);
});

// ─── Store: auto-continue una vez ───

test("triage parking: building confiable retoma a Foreman una sola vez", () => {
  mkJob("job-park-auto-a");
  try {
    toTriage("job-park-auto-a");
    let redispatched = 0;
    const moved = maybeAutoContinueFromTriage("job-park-auto-a", buildingFindings(), {
      redispatch: () => {
        redispatched += 1;
      },
    });
    assert.ok(moved);
    assert.equal(workItemStore.get("job-park-auto-a")?.status, "Foreman");
    assert.equal(redispatched, 1);
    const again = maybeAutoContinueFromTriage("job-park-auto-a", buildingFindings(), {
      redispatch: () => {
        redispatched += 1;
      },
    });
    assert.equal(again, null);
    assert.equal(redispatched, 1);
  } finally {
    cleanup();
  }
});

test("triage parking: sin confianza o fuera de Triage no retoma", () => {
  mkJob("job-park-auto-b");
  mkJob("job-park-auto-c");
  try {
    toTriage("job-park-auto-b");
    let redispatched = 0;
    const low = maybeAutoContinueFromTriage(
      "job-park-auto-b",
      buildingFindings({ confidence: 0.6 }),
      {
        redispatch: () => {
          redispatched += 1;
        },
      },
    );
    assert.equal(low, null);
    assert.equal(workItemStore.get("job-park-auto-b")?.status, "Triage");
    assert.equal(redispatched, 0);
    const wrongState = maybeAutoContinueFromTriage("job-park-auto-c", buildingFindings(), {
      redispatch: () => {
        redispatched += 1;
      },
    });
    assert.equal(wrongState, null);
    assert.equal(redispatched, 0);
    assert.equal(maybeAutoContinueFromTriage("job-no-existe", buildingFindings()), null);
  } finally {
    cleanup();
  }
});

// ─── Aviso ───

function readSandboxNotifications(): string {
  const target = path.join(SANDBOX_FACTORY, ".notifications.json");
  if (!fs.existsSync(target)) return "";
  try {
    return fs.readFileSync(target, "utf-8");
  } catch {
    return "";
  }
}

test("triage parking: avisa una vez y se dedupea (nunca lanza)", () => {
  assert.doesNotThrow(() => notifyTriageParking("", ""));
  assert.doesNotThrow(() => notifyTriageParking("job-park-n", ""));
  notifyTriageParking("job-park-n", "verification failed: pnpm test exit 1", [
    "¿qué alcance cubre el fix?",
  ]);
  const first = readSandboxNotifications();
  assert.match(first, /Triage necesita tu decisión/);
  assert.match(first, /job-park-n/);
  assert.match(first, /¿qué alcance cubre el fix\?/);
  notifyTriageParking("job-park-n", "verification failed: pnpm test exit 1", [
    "¿qué alcance cubre el fix?",
  ]);
  const second = readSandboxNotifications();
  assert.equal(second, first);
});
