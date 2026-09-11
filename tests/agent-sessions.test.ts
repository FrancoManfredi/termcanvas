/**
 * Ola 16 E1 — Continuidad conversacional: UNA sesión por (job, rol).
 *
 * Suite del helper `headless-runtime/sessions/agentSessions.ts` + persistencia
 * (store/disco) + flag `agentSessions`:
 * - get/set en memoria (job inexistente → memoria solo, nunca lanza).
 * - persist/restore round-trip vía disco (job.json lleva `agentSessions`).
 * - resume OK: 2 turnos mismo job+rol con mocks (create=1, mismo sessionId).
 * - sesión muerta: promptWith falla not-found una vez → creates=2 exacto,
 *   `renewed=true`, resultado del 2º prompt retornado, evento "sesión
 *   renovada (la anterior expiró)" en timeline.
 * - fallo NO-notfound → lanza sin reintento (sin creates extra).
 * - flag OFF → create por llamada (2 turnos = 2 creates, nada guardado).
 * - job viejo sin `agentSessions` → restore tolerante (undefined, no rompe);
 *   `agentSessions` inválido → undefined, entradas válidas se conservan.
 * - cotas Regla 7: not-found eterno → ≤1 create y ≤2 prompts, siempre lanza
 *   (cero loops: el helper no tiene `while`/`for`/polling/TTL).
 * - store: `toJSON` expone `agentSessions`, get/set best-effort, evento de
 *   renovación con actor `system` + meta `{agentSessions:{role,renewed}}`.
 * - `isSessionNotFoundError`: los 7 patrones case-insensitive + negativos.
 * - `isAgentSessionsEnabled`: default true + seam de override para tests.
 *
 * Mocks del SDK solo en tests (la suite usa closures create/promptWith puras
 * + jobs reales en tmp; jamás daemon real, jamás red).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getAgentSession,
  setAgentSession,
  isAgentSessionsEnabled,
  isSessionNotFoundError,
  promptInAgentSession,
  readSessionAgent,
  resetSessionAgentShapeForTests,
  setAgentSessionsOverrideForTests,
  resetAgentSessionsOverrideForTests,
  resetAgentSessionsMemoryForTests,
  type AgentRole,
} from "../headless-runtime/sessions/agentSessions.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { readWorkItemFromDir } from "../headless-runtime/workItem/workItemDisk.ts";

let jobSeq = 0;
function freshJobId(tag: string): string {
  jobSeq += 1;
  return `job-agsess-${tag}-${jobSeq}`;
}

function withTempDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-sessions-"));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // noop: limpieza best-effort
      }
    },
  };
}

function setupFlag(on: boolean): void {
  resetAgentSessionsMemoryForTests();
  setAgentSessionsOverrideForTests(on);
}

function teardownFlag(): void {
  resetAgentSessionsOverrideForTests();
  resetAgentSessionsMemoryForTests();
}

// ── get/set en memoria ──

test("get/set en memoria: round-trip por (job, rol), roles aislados", () => {
  setupFlag(true);
  try {
    const job = freshJobId("mem");
    assert.equal(getAgentSession(job, "foreman"), null);
    setAgentSession(job, "foreman", "ses_mem_1");
    assert.equal(getAgentSession(job, "foreman"), "ses_mem_1");
    // Otro rol no ve la sesión del foreman.
    assert.equal(getAgentSession(job, "triage"), null);
    // Otro job no ve la sesión.
    assert.equal(getAgentSession(freshJobId("otro"), "foreman"), null);
    // Sobrescribir actualiza.
    setAgentSession(job, "foreman", "ses_mem_2");
    assert.equal(getAgentSession(job, "foreman"), "ses_mem_2");
  } finally {
    teardownFlag();
  }
});

test("get/set nunca lanzan ante entradas inválidas", () => {
  setupFlag(true);
  try {
    assert.doesNotThrow(() => {
      setAgentSession("", "foreman", "ses_x");
      setAgentSession("job-agsess-bad", "no-rol" as AgentRole, "ses_x");
      setAgentSession("job-agsess-bad", "foreman", "");
      setAgentSession("job-agsess-bad", "foreman", undefined as unknown as string);
    });
    assert.equal(getAgentSession("", "foreman"), null);
    assert.equal(getAgentSession("job-agsess-bad", "no-rol" as AgentRole), null);
    assert.equal(getAgentSession("job-agsess-bad", "foreman"), null);
  } finally {
    teardownFlag();
  }
});

test("set con job inexistente en store queda en memoria solo (sin throw)", () => {
  setupFlag(true);
  try {
    const job = freshJobId("solo-mem");
    assert.equal(workItemStore.get(job), undefined);
    setAgentSession(job, "spec", "ses_solo_mem");
    assert.equal(getAgentSession(job, "spec"), "ses_solo_mem");
  } finally {
    teardownFlag();
  }
});

// ── persist/restore round-trip vía disco ──

test("persist/restore round-trip: job.json lleva agentSessions y vuelve", () => {
  setupFlag(true);
  const { dir, cleanup } = withTempDir();
  const id = freshJobId("disco");
  try {
    const item = workItemStore.create({ id, prompt: "hola", worktree: dir });
    setAgentSession(id, "foreman", "ses_disk_1");
    setAgentSession(id, "review", "ses_disk_2");
    const raw = JSON.parse(fs.readFileSync(path.join(item.dir as string, "job.json"), "utf-8")) as Record<string, unknown>;
    assert.deepEqual(raw.agentSessions, { foreman: "ses_disk_1", review: "ses_disk_2" });
    const restored = readWorkItemFromDir(item.dir as string);
    assert.ok(restored, "el job debe restaurar");
    assert.deepEqual(restored?.agentSessions, { foreman: "ses_disk_1", review: "ses_disk_2" });
    // El helper también lo ve (hidrata desde el store).
    assert.equal(getAgentSession(id, "foreman"), "ses_disk_1");
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // best-effort
    }
    cleanup();
    teardownFlag();
  }
});

test("hookRuns round-trip: job.json lleva el resumen y vuelve (cap 20)", () => {
  setupFlag(true);
  const { dir, cleanup } = withTempDir();
  const id = freshJobId("hooks");
  try {
    const item = workItemStore.create({ id, prompt: "hola", worktree: dir });
    workItemStore.recordHookRun(id, { name: "tester", stage: "post-review", status: "fail", blocking: false, sessionId: "ses_h" });
    const raw = JSON.parse(fs.readFileSync(path.join(item.dir as string, "job.json"), "utf-8")) as Record<string, unknown>;
    assert.equal((raw.hookRuns as Array<{ name: string }>).length, 1);
    assert.equal((raw.hookRuns as Array<{ name: string }>)[0]?.name, "tester");
    const restored = readWorkItemFromDir(item.dir as string);
    assert.ok(restored, "el job debe restaurar");
    assert.deepEqual(
      (restored as unknown as { hookRuns?: unknown }).hookRuns,
      [{ name: "tester", stage: "post-review", status: "fail", blocking: false, sessionId: "ses_h", at: (restored as unknown as { hookRuns: Array<{ at: string }> }).hookRuns[0]?.at }],
    );
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // best-effort
    }
    cleanup();
    teardownFlag();
  }
});

test("hookRuns inválido restaura tolerante: basura fuera, válidos dentro", () => {
  setupFlag(true);
  const { dir, cleanup } = withTempDir();
  try {
    const jobDir = path.join(dir, ".agents", "factory", "job-agsess-hooksviejos");
    fs.mkdirSync(jobDir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(jobDir, "job.json"),
      JSON.stringify({
        id: "job-agsess-hooksviejos",
        prompt: "x",
        worktree: dir,
        phase: "diagnosisLlm",
        status: "Intake",
        state: "queued",
        createdAt: now,
        updatedAt: now,
        timeline: [],
        cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
        dir: jobDir,
        dotDonePath: path.join(jobDir, ".done"),
        runnerId: "linux-build",
        hookRuns: [
          { name: "ok", stage: "post-review", status: "pass" },
          { name: "", stage: "", status: "" },
          null,
          42,
        ],
      }),
      "utf-8",
    );
    const restored = readWorkItemFromDir(jobDir);
    assert.ok(restored, "el job debe cargar");
    assert.deepEqual((restored as unknown as { hookRuns?: unknown }).hookRuns, [
      { name: "ok", stage: "post-review", status: "pass" },
    ]);
  } finally {
    cleanup();
    teardownFlag();
  }
});

test("job viejo sin agentSessions restaura tolerante (undefined, no rompe)", () => {
  setupFlag(true);
  const { dir, cleanup } = withTempDir();
  try {
    const jobDir = path.join(dir, ".agents", "factory", "job-agsess-viejo");
    fs.mkdirSync(jobDir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(jobDir, "job.json"),
      JSON.stringify({
        id: "job-agsess-viejo",
        prompt: "job de antes de Ola 16",
        worktree: dir,
        phase: "diagnosisLlm",
        status: "Intake",
        state: "queued",
        createdAt: now,
        updatedAt: now,
        timeline: [{ id: "job-agsess-viejo-t0", from: "Intake", to: "Intake", at: now, actor: "user", message: "created Intake" }],
        cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
        dir: jobDir,
        dotDonePath: path.join(jobDir, ".done"),
        runnerId: "linux-build",
      }),
      "utf-8",
    );
    const restored = readWorkItemFromDir(jobDir);
    assert.ok(restored, "el job viejo debe cargar");
    assert.equal(restored?.agentSessions, undefined);
  } finally {
    cleanup();
    teardownFlag();
  }
});

test("agentSessions inválido restaura tolerante: basura → undefined, válidos se conservan", () => {
  setupFlag(true);
  const { dir, cleanup } = withTempDir();
  try {
    const now = new Date().toISOString();
    const base = {
      prompt: "x",
      worktree: dir,
      phase: "diagnosisLlm",
      status: "Intake",
      state: "queued",
      createdAt: now,
      updatedAt: now,
      timeline: [{ id: "t0", from: "Intake", to: "Intake", at: now, actor: "user", message: "created Intake" }],
      cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
      runnerId: "linux-build",
    };
    const caseDir = (name: string): string => {
      const d = path.join(dir, ".agents", "factory", name);
      fs.mkdirSync(d, { recursive: true });
      return d;
    };
    // Basura total → undefined.
    const d1 = caseDir("job-agsess-basura");
    fs.writeFileSync(path.join(d1, "job.json"), JSON.stringify({ ...base, id: "job-agsess-basura", dir: d1, dotDonePath: path.join(d1, ".done"), agentSessions: "nonsense" }), "utf-8");
    assert.equal(readWorkItemFromDir(d1)?.agentSessions, undefined);
    // Mixto: vacíos/desconocidos se ignoran, el válido se conserva.
    const d2 = caseDir("job-agsess-mixto");
    fs.writeFileSync(
      path.join(d2, "job.json"),
      JSON.stringify({
        ...base, id: "job-agsess-mixto", dir: d2, dotDonePath: path.join(d2, ".done"),
        agentSessions: { foreman: "", triage: 123, implement: "ses_ok", hacker: "x" },
      }),
      "utf-8",
    );
    assert.deepEqual(readWorkItemFromDir(d2)?.agentSessions, { implement: "ses_ok" });
  } finally {
    cleanup();
    teardownFlag();
  }
});

// ── resume OK ──

test("resume OK: 2 turnos mismo job+rol reutilizan la sesión (create=1)", async () => {
  setupFlag(true);
  try {
    const job = freshJobId("resume");
    let creates = 0;
    const seen: string[] = [];
    const create = async (): Promise<string> => {
      creates += 1;
      return `ses_resume_${creates}`;
    };
    const promptWith = async (sid: string): Promise<string> => {
      seen.push(sid);
      return `ok:${sid}`;
    };
    const t1 = await promptInAgentSession({ jobId: job, role: "triage", create, promptWith });
    assert.equal(t1.sessionId, "ses_resume_1");
    assert.equal(t1.res, "ok:ses_resume_1");
    assert.equal(t1.renewed, false);
    const t2 = await promptInAgentSession({ jobId: job, role: "triage", create, promptWith });
    assert.equal(creates, 1, "el 2º turno NO debe crear sesión");
    assert.equal(t2.sessionId, "ses_resume_1", "misma sesión entre turnos");
    assert.equal(t2.res, "ok:ses_resume_1");
    assert.equal(t2.renewed, false);
    assert.deepEqual(seen, ["ses_resume_1", "ses_resume_1"]);
    assert.equal(getAgentSession(job, "triage"), "ses_resume_1");
  } finally {
    teardownFlag();
  }
});

// ── sesión muerta → renovación lazy visible ──

test("sesión muerta: not-found una vez → creates=2, renewed=true, evento en timeline", async () => {
  setupFlag(true);
  const { dir, cleanup } = withTempDir();
  const id = freshJobId("muerta");
  try {
    workItemStore.create({ id, prompt: "hola", worktree: dir });
    let creates = 0;
    let prompts = 0;
    const create = async (): Promise<string> => {
      creates += 1;
      return creates === 1 ? "ses_old_dead" : "ses_new_alive";
    };
    const promptWith = async (sid: string): Promise<string> => {
      prompts += 1;
      // Turno 1 (primer prompt) OK; desde el turno 2 la vieja está muerta.
      if (prompts === 1) return `first:${sid}`;
      if (sid === "ses_old_dead") throw new Error("session not found: ses_old_dead");
      return `recovered:${sid}`;
    };
    const t1 = await promptInAgentSession({ jobId: id, role: "triage", create, promptWith });
    assert.equal(t1.renewed, false);
    const t2 = await promptInAgentSession({ jobId: id, role: "triage", create, promptWith });
    assert.equal(creates, 2, "exactamente 1 create inicial + 1 de renovación");
    assert.equal(t2.sessionId, "ses_new_alive");
    assert.equal(t2.res, "recovered:ses_new_alive", "se retorna el 2º prompt");
    assert.equal(t2.renewed, true);
    assert.equal(getAgentSession(id, "triage"), "ses_new_alive");
    const item = workItemStore.get(id);
    assert.ok(item, "el job debe existir");
    const last = item?.timeline[item.timeline.length - 1];
    assert.equal(last?.actor, "system");
    assert.ok(
      (last?.message ?? "").includes("sesión renovada (la anterior expiró)"),
      `el evento debe llevar el texto exacto, fue: ${last?.message}`,
    );
    assert.ok((last?.message ?? "").includes("triage"), "el evento nombra el rol");
    assert.ok((last?.message ?? "").includes("→"), "el evento muestra viejo→nuevo");
    const meta = (last?.meta ?? {}) as Record<string, unknown>;
    const ag = meta.agentSessions as Record<string, unknown>;
    assert.equal(ag?.role, "triage");
    assert.equal(ag?.renewed, true);
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // best-effort
    }
    cleanup();
    teardownFlag();
  }
});

// ── fallo NO-notfound → lanza sin reintento ──

test("fallo NO-notfound lanza sin reintento (sin creates extra)", async () => {
  setupFlag(true);
  try {
    const job = freshJobId("no-retry");
    let creates = 0;
    let prompts = 0;
    const create = async (): Promise<string> => {
      creates += 1;
      return "ses_fallo_1";
    };
    // Turno 1 OK (deja 1 create guardado).
    const t1 = await promptInAgentSession({ jobId: job, role: "spec", create, promptWith: async () => "ok1" });
    assert.equal(t1.sessionId, "ses_fallo_1");
    // Turno 2: fallo que NO es not-found → lanza, sin renovar.
    await assert.rejects(
      promptInAgentSession({
        jobId: job,
        role: "spec",
        create,
        promptWith: async (_sid: string): Promise<string> => {
          prompts += 1;
          throw new Error("boom 500 internal");
        },
      }),
      /boom 500/,
    );
    assert.equal(creates, 1, "cero reintentos: ningún create extra");
    assert.equal(prompts, 1, "un solo prompt fallido");
    assert.equal(getAgentSession(job, "spec"), "ses_fallo_1", "la guardada no se pisa");
  } finally {
    teardownFlag();
  }
});

// ── flag OFF = comportamiento viejo ──

test("flag OFF: create por llamada (2 turnos = 2 creates, nada guardado)", async () => {
  setupFlag(false);
  try {
    const job = freshJobId("off");
    let creates = 0;
    const create = async (): Promise<string> => {
      creates += 1;
      return `ses_off_${creates}`;
    };
    const t1 = await promptInAgentSession({ jobId: job, role: "foreman", create, promptWith: async (sid) => `r:${sid}` });
    const t2 = await promptInAgentSession({ jobId: job, role: "foreman", create, promptWith: async (sid) => `r:${sid}` });
    assert.equal(creates, 2, "apagado = sesión nueva por llamada");
    assert.notEqual(t1.sessionId, t2.sessionId);
    assert.equal(t1.renewed, false);
    assert.equal(t2.renewed, false);
    assert.equal(getAgentSession(job, "foreman"), null, "apagado = nada guardado");
  } finally {
    teardownFlag();
  }
});

// ── cotas Regla 7 ──

test("cotas: not-found eterno → ≤1 create y ≤2 prompts, lanza (cero loops)", async () => {
  setupFlag(true);
  try {
    const job = freshJobId("cota");
    setAgentSession(job, "review", "ses_dead_eterna");
    let creates = 0;
    let prompts = 0;
    await assert.rejects(
      promptInAgentSession({
        jobId: job,
        role: "review",
        create: async (): Promise<string> => {
          creates += 1;
          return "ses_nueva_igual_muerta";
        },
        promptWith: async (_sid: string): Promise<string> => {
          prompts += 1;
          throw new Error("unknown session");
        },
      }),
      /unknown session/,
    );
    assert.equal(creates, 1, "UN solo create de renovación, nunca más");
    assert.equal(prompts, 2, "UN solo reintento con la sesión nueva");
  } finally {
    teardownFlag();
  }
});

// ── isSessionNotFoundError ──

test("isSessionNotFoundError: los 7 patrones case-insensitive", () => {
  const positives = [
    "session not found: ses_abc",
    "SESSION_NOT_FOUND",
    "Unknown Session id",
    "invalid session 'ses_x'",
    "Session Expired, create a new one",
    "no such session",
    "session does not exist anymore",
    "Error: Session Not Found (mayúsculas)",
  ];
  for (const msg of positives) {
    assert.equal(isSessionNotFoundError(new Error(msg)), true, msg);
    assert.equal(isSessionNotFoundError(msg), true, `string: ${msg}`);
  }
  // Formas SDK con objeto.
  assert.equal(isSessionNotFoundError({ error: { message: "session not found" } }), true);
  assert.equal(isSessionNotFoundError({ message: "INVALID SESSION" }), true);
});

test("isSessionNotFoundError: negativos (timeout, red, 500, vacío)", () => {
  const negatives: unknown[] = [
    "boom 500 internal",
    "timeout 20000ms session.prompt",
    "fetch failed",
    "session created",
    "",
    null,
    undefined,
    42,
    {},
    new Error("all prompt variants failed — last: timeout"),
  ];
  for (const v of negatives) {
    assert.equal(isSessionNotFoundError(v), false, String(v));
  }
});

// ── flag ──

test("isAgentSessionsEnabled: default true + seam de override", () => {
  resetAgentSessionsOverrideForTests();
  try {
    assert.equal(isAgentSessionsEnabled(), true, "default true (factory.yaml trae agentSessions: true)");
    setAgentSessionsOverrideForTests(false);
    assert.equal(isAgentSessionsEnabled(), false);
    setAgentSessionsOverrideForTests(true);
    assert.equal(isAgentSessionsEnabled(), true);
  } finally {
    teardownFlag();
  }
});

// ── store: toJSON + respaldo + evento ──

test("store toJSON expone agentSessions (aditivo) y lo omite si ausente", () => {
  setupFlag(true);
  const { dir, cleanup } = withTempDir();
  const id = freshJobId("tojson");
  try {
    const item = workItemStore.create({ id, prompt: "hola", worktree: dir });
    const before = workItemStore.toJSON(item) as Record<string, unknown>;
    assert.ok(!("agentSessions" in before), "ausente → se omite (job viejo intacto)");
    workItemStore.setAgentSession(id, "implement", "ses_impl_1");
    const after = workItemStore.toJSON(workItemStore.get(id) as never) as Record<string, unknown>;
    assert.deepEqual(after.agentSessions, { implement: "ses_impl_1" });
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // best-effort
    }
    cleanup();
    teardownFlag();
  }
});

test("store get/set best-effort: job inexistente → null/sin throw", () => {
  assert.equal(workItemStore.getAgentSession("job-agsess-fantasma", "foreman"), null);
  assert.equal(workItemStore.getAgentSession("job-agsess-fantasma", "raro"), null);
  assert.doesNotThrow(() => {
    workItemStore.setAgentSession("job-agsess-fantasma", "foreman", "ses_x");
    workItemStore.setAgentSession("job-agsess-fantasma", "raro", "ses_x");
  });
  assert.equal(workItemStore.appendAgentSessionRenewed("job-agsess-fantasma", "foreman", "a", "b"), null);
});

test("store appendAgentSessionRenewed: mensaje, actor, meta y guardado", () => {
  setupFlag(true);
  const { dir, cleanup } = withTempDir();
  const id = freshJobId("evento");
  try {
    workItemStore.create({ id, prompt: "hola", worktree: dir });
    const next = workItemStore.appendAgentSessionRenewed(id, "foreman", "ses_vieja_123456789", "ses_nueva_987654321");
    assert.ok(next, "debe retornar el item");
    const last = next?.timeline[next.timeline.length - 1];
    assert.equal(last?.actor, "system");
    assert.ok((last?.message ?? "").includes("sesión renovada (la anterior expiró)"));
    assert.ok((last?.message ?? "").includes("foreman"));
    const meta = (last?.meta ?? {}) as Record<string, unknown>;
    assert.deepEqual(meta.agentSessions, {
      role: "foreman",
      renewed: true,
      oldSessionId: "ses_vieja_123456789",
      newSessionId: "ses_nueva_987654321",
    });
    assert.equal(workItemStore.getAgentSession(id, "foreman"), "ses_nueva_987654321");
    // Evidencia en disco.
    const raw = JSON.parse(
      fs.readFileSync(path.join(next?.dir as string, "job.json"), "utf-8"),
    ) as Record<string, unknown>;
    assert.deepEqual(raw.agentSessions, { foreman: "ses_nueva_987654321" });
    assert.ok(
      ((raw.timeline ?? []) as Array<{ message?: string }>).some((e) =>
        String(e?.message ?? "").includes("sesión renovada (la anterior expiró)"),
      ),
      "el evento debe estar en job.json",
    );
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // best-effort
    }
    cleanup();
    teardownFlag();
  }
});

// ── identidad de rol en reuse ──

const MIRROR_SIEMPRE = () => true;
const MIRROR_NUNCA = () => false;

async function turnoConIdentidad(
  job: string,
  role: AgentRole,
  create: () => Promise<string>,
  agentReportado: string | null | Error,
  hasMirror: (name: string) => boolean = MIRROR_SIEMPRE,
): Promise<{ sessionId: string; res: string; renewed: boolean }> {
  return promptInAgentSession({
    jobId: job,
    role,
    create,
    promptWith: async (sid: string) => `ok:${sid}`,
    expectAgent: role,
    getAgent: async (_sid: string) => {
      if (agentReportado instanceof Error) throw agentReportado;
      return agentReportado;
    },
    hasMirror,
  });
}

test("identidad: mismatch explícito renueva por el mismo canal (evento idéntico)", async () => {
  setupFlag(true);
  resetSessionAgentShapeForTests();
  const { dir, cleanup } = withTempDir();
  const id = freshJobId("ident");
  try {
    workItemStore.create({ id, prompt: "hola", worktree: dir });
    let creates = 0;
    const create = async (): Promise<string> => {
      creates += 1;
      return creates === 1 ? "ses_ident_vieja" : "ses_ident_nueva";
    };
    const t1 = await turnoConIdentidad(id, "foreman", create, "foreman");
    assert.equal(t1.renewed, false);
    assert.equal(creates, 1);
    // Turno 2: la guardada corre como build → se renueva UNA vez.
    const t2 = await turnoConIdentidad(id, "foreman", create, "build");
    assert.equal(creates, 2, "exactamente 1 create de renovación");
    assert.equal(t2.sessionId, "ses_ident_nueva");
    assert.equal(t2.res, "ok:ses_ident_nueva");
    assert.equal(t2.renewed, true);
    assert.equal(getAgentSession(id, "foreman"), "ses_ident_nueva");
    const item = workItemStore.get(id);
    const last = item?.timeline[item.timeline.length - 1];
    assert.ok(
      (last?.message ?? "").includes("sesión renovada (la anterior expiró)"),
      "mismo canal y texto que sesión muerta",
    );
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // best-effort
    }
    cleanup();
    teardownFlag();
  }
});

test("identidad: match, duda y sin-espejo reutilizan sin renovar", async () => {
  setupFlag(true);
  resetSessionAgentShapeForTests();
  try {
    // Match exacto → reuse.
    const j1 = freshJobId("ident-ok");
    let c1 = 0;
    await turnoConIdentidad(j1, "triage", async () => `ses_ok_${++c1}`, "triage");
    const r1 = await turnoConIdentidad(j1, "triage", async () => `ses_ok_${++c1}`, "triage");
    assert.equal(c1, 1, "match no crea");
    assert.equal(r1.renewed, false);
    // Lectura fallida → reuse (jamás se renueva por duda).
    const j2 = freshJobId("ident-duda");
    let c2 = 0;
    await turnoConIdentidad(j2, "triage", async () => `ses_duda_${++c2}`, "triage");
    const r2 = await turnoConIdentidad(j2, "triage", async () => `ses_duda_${++c2}`, new Error("boom get"));
    assert.equal(c2, 1);
    assert.equal(r2.renewed, false);
    // Sin agent reportado → reuse.
    const r3 = await turnoConIdentidad(j2, "triage", async () => `ses_duda_${++c2}`, null);
    assert.equal(c2, 1);
    assert.equal(r3.renewed, false);
    // Sin espejo → getAgent ni se llama, reuse.
    const j3 = freshJobId("ident-noespejo");
    let c3 = 0;
    let gets = 0;
    await promptInAgentSession({
      jobId: j3,
      role: "spec",
      create: async () => `ses_ne_${++c3}`,
      promptWith: async (sid: string) => `ok:${sid}`,
      expectAgent: "spec",
      getAgent: async (_sid: string) => {
        gets += 1;
        return "build";
      },
      hasMirror: MIRROR_NUNCA,
    });
    const r4 = await promptInAgentSession({
      jobId: j3,
      role: "spec",
      create: async () => `ses_ne_${++c3}`,
      promptWith: async (sid: string) => `ok:${sid}`,
      expectAgent: "spec",
      getAgent: async (_sid: string) => {
        gets += 1;
        return "build";
      },
      hasMirror: MIRROR_NUNCA,
    });
    assert.equal(gets, 0, "sin espejo no se verifica");
    assert.equal(c3, 1);
    assert.equal(r4.renewed, false);
  } finally {
    teardownFlag();
  }
});

test("readSessionAgent: formas canónica/plana/posicional, envelope y fallos → null", async () => {
  resetSessionAgentShapeForTests();
  const canon = { get: async (args: unknown) => ({ data: { id: "s", agent: "foreman" } }) };
  assert.equal(await readSessionAgent(canon, "s"), "foreman");
  resetSessionAgentShapeForTests();
  let seenArgs: unknown = null;
  const flat = {
    get: async (args: unknown) => {
      seenArgs = args;
      if (args && typeof args === "object" && "path" in (args as Record<string, unknown>)) {
        throw new Error("400 shape desconocida");
      }
      return { agent: "triage" };
    },
  };
  assert.equal(await readSessionAgent(flat, "s"), "triage");
  assert.ok(seenArgs !== null);
  resetSessionAgentShapeForTests();
  assert.equal(await readSessionAgent({}, "s"), null, "sin get → null");
  assert.equal(await readSessionAgent({ get: async () => { throw new Error("500"); } }, "s"), null);
  assert.equal(await readSessionAgent(canon, ""), null, "sid vacío → null");
  assert.equal(await readSessionAgent(null, "s"), null);
  resetSessionAgentShapeForTests();
});
