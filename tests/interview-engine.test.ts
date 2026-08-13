// Tests del motor de entrevista. El SDK de opencode NO se toca: el gateway
// es un fake que decide la siguiente pregunta inspeccionando el prompt de
// turno (igual que haría el modelo real, que solo ve el resumen compacto).
// Cubren los criterios de aceptación 1-6 + casos de borde del ledger.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createInterview,
  submitAnswer,
  loadInterviewState,
  listInterviews,
  type InterviewEngineOptions,
} from "../headless-runtime/interview/engine.ts";
import {
  createLedger,
  loadLedger,
  markContradictionPending,
  normalizeConflictingAnswerId,
  recordAnswer,
  resolveContradictionsForAnswer,
  seedTopics,
  updateTopicStatusForQuestion,
} from "../headless-runtime/interview/ledger.ts";
import { buildRecentAnswersSummary, buildTurnPrompt } from "../headless-runtime/interview/prompt.ts";
import type { InterviewModelGateway } from "../headless-runtime/interview/open-code-client.ts";
import {
  InterviewEngineError,
  describeInterviewQuestionIssue,
  isValidInterviewQuestion,
  type InterviewQuestion,
  type UserAnswerInput,
} from "../headless-runtime/interview/types.ts";

function makeQuestion(partial: Partial<InterviewQuestion>): InterviewQuestion {
  return {
    topic_id: "vision.problem",
    topic_action: "open_new_topic",
    question_text: "¿Cuál es el problema que querés resolver?",
    kind: "single_select",
    options: [
      { id: "o1", label: "Opción 1", implies: "implica opción 1" },
      { id: "o2", label: "Opción 2", implies: "implica opción 2" },
    ],
    contradiction_flag: null,
    coverage_estimate: 0.1,
    ...partial,
  };
}

type GatewayBehavior = (prompt: string) => InterviewQuestion | InterviewEngineError;

class FakeGateway implements InterviewModelGateway {
  readonly modelID = "fake";
  sessionsCreated: Array<{ title: string; directory: string }> = [];
  prompts: string[] = [];
  behavior: GatewayBehavior;
  private sessionCounter = 0;

  constructor(behavior: GatewayBehavior) {
    this.behavior = behavior;
  }

  async createSession(title: string, directory: string): Promise<string> {
    this.sessionsCreated.push({ title, directory });
    this.sessionCounter += 1;
    return `session-${this.sessionCounter}`;
  }

  async nextQuestion(input: { sessionId: string; turnPrompt: string }): Promise<InterviewQuestion> {
    // El prompt se pushea ANTES de correr behavior: el contador arranca en 1
    // en la primera llamada (createInterview), 2 en la segunda, etc.
    this.prompts.push(input.turnPrompt);
    const result = this.behavior(input.turnPrompt);
    if (result instanceof InterviewEngineError) throw result;
    return result;
  }
}

function withTempProject(
  fn: (projectPath: string) => Promise<void>,
): (t: test.TestContext) => Promise<void> {
  return async (t) => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "interview-test-"));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true, maxRetries: 3 }));
    await fn(projectPath);
  };
}

function engineOptions(gateway: FakeGateway): InterviewEngineOptions {
  return { gateway };
}

// ─── Criterio 1: createInterview ────────────────────────────────────────

test("createInterview: primera pregunta válida + ledger con semilla de tópicos", withTempProject(async (projectPath) => {
  const gateway = new FakeGateway(() => makeQuestion({}));
  const { ledgerPath, firstQuestion } = await createInterview(projectPath, engineOptions(gateway));

  assert.ok(isValidInterviewQuestion(firstQuestion), "la primera pregunta debe cumplir el contrato");
  assert.equal(gateway.sessionsCreated.length, 1);
  assert.ok(fs.existsSync(ledgerPath));

  const ledger = loadLedger(ledgerPath);
  assert.equal(ledger.topics.length, 13, "la semilla debe tener los 13 tópicos");
  assert.equal(ledger.topics.filter((t) => t.category === "nonfunctional").every((t) => t.asr_candidate), true);
  assert.equal(ledger.answers.length, 0);
  assert.ok(
    ledger.project_context_path.endsWith(path.join(".agents", "repo-context.md")),
    "el contexto apunta al repo-context.md del proyecto",
  );
  assert.equal(ledger.last_question?.topic_id, "vision.problem", "la primera pregunta es la pendiente");
}));

test("createInterview: si el primer turno falla, el ledger se descarta", withTempProject(async (projectPath) => {
  const gateway = new FakeGateway(() => new InterviewEngineError("structured_output_error", "boom"));
  await assert.rejects(() => createInterview(projectPath, engineOptions(gateway)), (err: unknown) => {
    assert.ok(err instanceof InterviewEngineError);
    assert.equal(err.kind, "structured_output_error");
    return true;
  });
  const dir = path.join(projectPath, ".agents", "interview");
  assert.ok(
    !fs.existsSync(dir) || fs.readdirSync(dir).length === 0,
    "no debe quedar ningún ledger de una entrevista fallida",
  );
}));

// ─── Criterio 2: submitAnswer ───────────────────────────────────────────

test("submitAnswer: segunda pregunta coherente con la respuesta dada", withTempProject(async (projectPath) => {
  const gateway = new FakeGateway((prompt) => {
    if (gateway.prompts.length === 1) {
      return makeQuestion({ topic_id: "vision.problem", question_text: "¿Qué problema?" });
    }
    assert.match(prompt, /\[vision\.problem\] ¿Qué problema\? → Opción 1/, "el prompt del turno 2 debe resumir la respuesta del turno 1");
    return makeQuestion({ topic_id: "vision.users", topic_action: "open_new_topic", question_text: "¿Quiénes son los usuarios?" });
  });

  const { ledgerPath } = await createInterview(projectPath, engineOptions(gateway));
  const second = await submitAnswer(
    ledgerPath,
    { topic_id: "vision.problem", selected_option_id: "o1", free_text: null },
    engineOptions(gateway),
  );

  assert.equal(second.topic_id, "vision.users", "la 2da pregunta debe ser coherente con la respuesta (nuevo tópico)");

  const ledger = loadLedger(ledgerPath);
  assert.equal(ledger.answers.length, 1);
  assert.equal(ledger.answers[0].implies, "implica opción 1");
  assert.equal(
    ledger.topics.find((t) => t.id === "vision.problem")?.status,
    "closed",
    "el tópico respondido se infiere cerrado cuando el modelo se movió a otro",
  );
  assert.equal(ledger.last_question?.topic_id, "vision.users");
}));

// ─── Criterio 3: drill_down ante respuesta vaga ─────────────────────────

test("criterio 3: respuesta vaga → drill_down sobre el mismo tópico", withTempProject(async (projectPath) => {
  const gateway = new FakeGateway((prompt) => {
    if (gateway.prompts.length === 1) {
      return makeQuestion({
        topic_id: "nonfunctional.performance",
        topic_action: "open_new_topic",
        question_text: "¿Qué latencia necesitás?",
        options: [],
        kind: "free_only",
      });
    }
    assert.match(prompt, /implica: rápido/, "el modelo debe recibir la respuesta vaga con su implies");
    return makeQuestion({
      topic_id: "nonfunctional.performance",
      topic_action: "drill_down",
      question_text: "¿Qué latencia máxima en milisegundos es aceptable?",
      options: [],
      kind: "free_only",
    });
  });

  const { ledgerPath } = await createInterview(projectPath, engineOptions(gateway));
  const drillDown = await submitAnswer(
    ledgerPath,
    { topic_id: "nonfunctional.performance", selected_option_id: null, free_text: "rápido" },
    engineOptions(gateway),
  );

  assert.equal(drillDown.topic_action, "drill_down", "debe repreguntar el mismo tópico");
  assert.equal(drillDown.topic_id, "nonfunctional.performance");

  const ledger = loadLedger(ledgerPath);
  assert.equal(
    ledger.topics.find((t) => t.id === "nonfunctional.performance")?.status,
    "open_vague",
    "drill_down deja el tópico en open_vague",
  );
}));

// ─── Criterio 4: contradicciones ────────────────────────────────────────

test("criterio 4: respuesta contradictoria → resolve_contradiction → resolución", withTempProject(async (projectPath) => {
  const gateway = new FakeGateway((prompt) => {
    switch (gateway.prompts.length) {
      case 1:
        return makeQuestion({
          topic_id: "vision.success_criteria",
          topic_action: "open_new_topic",
          question_text: "¿Qué uptime necesitás?",
          options: [
            { id: "p99", label: "99%", implies: "uptime 99%" },
            { id: "p999", label: "99.9%", implies: "uptime 99.9%" },
          ],
        });
      case 2:
        return makeQuestion({
          topic_id: "nonfunctional.availability",
          topic_action: "open_new_topic",
          question_text: "¿Y para el servicio en producción?",
          options: [
            { id: "q99", label: "99%", implies: "uptime 99%" },
            { id: "q999", label: "99.9%", implies: "uptime 99.9%" },
          ],
        });
      case 3:
        // El modelo "detecta" el choque: dos implies incompatibles en el resumen.
        assert.match(prompt, /implica: uptime 99%[\s\S]*implica: uptime 99\.9%/, "ambas versiones deben estar en el resumen");
        return makeQuestion({
          topic_id: "nonfunctional.availability",
          topic_action: "resolve_contradiction",
          question_text: "Antes dijiste 99% y ahora 99.9%: ¿cuál vale?",
          options: [
            { id: "keep99", label: "99%", implies: "uptime 99%" },
            { id: "keep999", label: "99.9%", implies: "uptime 99.9%" },
          ],
          contradiction_flag: { conflicting_answer_id: "id_que_no_existe", explanation: "uptime inconsistente" },
        });
      default:
        return makeQuestion({ topic_id: "scope.explicit_exclusions", topic_action: "open_new_topic", question_text: "¿Qué queda fuera?" });
    }
  });

  const { ledgerPath } = await createInterview(projectPath, engineOptions(gateway));
  await submitAnswer(ledgerPath, { topic_id: "vision.success_criteria", selected_option_id: "p99", free_text: null }, engineOptions(gateway));
  const contradictionQuestion = await submitAnswer(ledgerPath, { topic_id: "nonfunctional.availability", selected_option_id: "q999", free_text: null }, engineOptions(gateway));

  assert.equal(contradictionQuestion.topic_action, "resolve_contradiction");

  let ledger = loadLedger(ledgerPath);
  assert.equal(ledger.contradictions.length, 1);
  const pending = ledger.contradictions[0];
  assert.equal(pending.resolved, false);
  assert.equal(pending.answer_b, "a_002", "answer_b es la respuesta disparadora");
  assert.equal(
    pending.answer_a,
    "a_001",
    "el conflicting_answer_id inexistente se normalizó a la respuesta más antigua del tópico",
  );
  assert.equal(
    ledger.topics.find((t) => t.id === "nonfunctional.availability")?.status,
    "in_contradiction",
  );

  // El usuario resuelve: se queda con 99%.
  await submitAnswer(ledgerPath, { topic_id: "nonfunctional.availability", selected_option_id: "keep99", free_text: null }, engineOptions(gateway));
  ledger = loadLedger(ledgerPath);
  assert.equal(ledger.contradictions[0].resolved, true, "la contradicción debe marcarse resuelta");
  assert.equal(ledger.contradictions[0].resolution_answer_id, "a_003");
}));

// ─── Criterio 5: instanciación dinámica de core_flow ────────────────────

test("criterio 5: flujo nuevo en texto libre → tópico flow.<slug> instanciado", withTempProject(async (projectPath) => {
  const gateway = new FakeGateway((prompt) => {
    if (gateway.prompts.length === 1) {
      return makeQuestion({ topic_id: "vision.problem", topic_action: "open_new_topic", question_text: "¿Qué problema?", options: [], kind: "free_only" });
    }
    return makeQuestion({
      topic_id: "flow.onboarding",
      topic_label: "Onboarding de usuarios",
      topic_category: "core_flow",
      topic_action: "open_new_topic",
      question_text: "Contame el camino feliz del onboarding.",
      options: [],
      kind: "free_only",
    });
  });

  const { ledgerPath } = await createInterview(projectPath, engineOptions(gateway));
  await submitAnswer(
    ledgerPath,
    { topic_id: "vision.problem", selected_option_id: null, free_text: "los usuarios nuevos pasan por un onboarding de 5 pasos" },
    engineOptions(gateway),
  );

  const ledger = loadLedger(ledgerPath);
  const flowTopic = ledger.topics.find((t) => t.id === "flow.onboarding");
  assert.ok(flowTopic, "el tópico flow.onboarding debe existir tras el turno siguiente");
  assert.equal(flowTopic.category, "core_flow");
  assert.equal(flowTopic.label, "Onboarding de usuarios");
  assert.equal(flowTopic.status, "open_new");
  assert.equal(flowTopic.asr_candidate, false);
}));

// ─── Criterio 6: retomar sesión sin perder contexto ─────────────────────

test("criterio 6: loadInterviewState retoma y la 4ta respuesta es coherente", withTempProject(async (projectPath) => {
  const script = [
    ["vision.problem", "¿Qué problema?"],
    ["vision.users", "¿Quiénes son los usuarios?"],
    ["data.entities", "¿Qué entidades hay?"],
    ["data.lifecycle", "¿Qué pasa con los datos al borrarlos?"],
    ["vision.success_criteria", "¿Cómo se mide el éxito?"],
  ] as const;
  let step = 0;
  const gateway = new FakeGateway(() =>
    makeQuestion({ topic_id: script[step][0], topic_action: "open_new_topic", question_text: script[step][1] }),
  );

  const { ledgerPath } = await createInterview(projectPath, engineOptions(gateway));
  for (let i = 0; i < 3; i += 1) {
    step += 1;
    await submitAnswer(ledgerPath, { topic_id: script[i][0], selected_option_id: null, free_text: `respuesta de ${script[i][0]}` }, engineOptions(gateway));
  }

  // "Cerrar" la app: nada en memoria, solo el ledger en disco.
  const resumed = await loadInterviewState(ledgerPath);
  assert.equal(resumed.ledger.answers.length, 3);
  assert.equal(resumed.lastQuestion?.topic_id, "data.lifecycle", "la pregunta pendiente se re-renderiza");

  step += 1;
  const fourth = await submitAnswer(ledgerPath, { topic_id: "data.lifecycle", selected_option_id: null, free_text: "respuesta de data.lifecycle" }, engineOptions(gateway));
  assert.equal(fourth.topic_id, "vision.success_criteria");

  const finalPrompt = gateway.prompts[gateway.prompts.length - 1];
  assert.match(finalPrompt, /\[vision\.problem\]/, "la 4ta llamada conserva el contexto de las 3 respuestas anteriores");
  assert.match(finalPrompt, /\[vision\.users\]/);
  assert.match(finalPrompt, /\[data\.entities\]/);
}));

// ─── Errores y API pública ──────────────────────────────────────────────

test("StructuredOutputError → InterviewEngineError y la respuesta queda registrada", withTempProject(async (projectPath) => {
  const gateway = new FakeGateway(() => makeQuestion({ topic_id: "vision.problem", topic_action: "open_new_topic" }));
  const { ledgerPath } = await createInterview(projectPath, engineOptions(gateway));

  gateway.behavior = () => new InterviewEngineError("structured_output_error", "el modelo no cumplió el schema");
  await assert.rejects(
    () => submitAnswer(ledgerPath, { topic_id: "vision.problem", selected_option_id: "o1", free_text: null }, engineOptions(gateway)),
    (err: unknown) => err instanceof InterviewEngineError && err.kind === "structured_output_error",
  );

  const ledger = loadLedger(ledgerPath);
  assert.equal(ledger.answers.length, 1, "la respuesta se persiste antes de la llamada al modelo");

  // El reintento no duplica la respuesta y puede avanzar.
  gateway.behavior = () => makeQuestion({ topic_id: "vision.users", topic_action: "open_new_topic" });
  await submitAnswer(ledgerPath, { topic_id: "vision.problem", selected_option_id: "o1", free_text: null }, engineOptions(gateway));
  assert.equal(loadLedger(ledgerPath).answers.length, 1, "reintentar tras fallo no duplica");
}));

test("output malformado → invalid_question sin perseguir preguntas rotas", withTempProject(async (projectPath) => {
  const gateway = new FakeGateway(() => makeQuestion({ topic_id: "vision.problem", topic_action: "open_new_topic" }));
  const { ledgerPath } = await createInterview(projectPath, engineOptions(gateway));

  gateway.behavior = () => new InterviewEngineError("invalid_question", "objeto fuera de contrato");
  await assert.rejects(
    () => submitAnswer(ledgerPath, { topic_id: "vision.problem", selected_option_id: "o1", free_text: null }, engineOptions(gateway)),
    (err: unknown) => err instanceof InterviewEngineError && err.kind === "invalid_question",
  );
  assert.equal(loadLedger(ledgerPath).last_question?.topic_id, "vision.problem", "solo se persiste lo que el modelo decidió válido");
}));

test("listInterviews: ordena por última actividad y resume tópicos/contradicciones", withTempProject(async (projectPath) => {
  const { ledgerPath: firstPath } = await createInterview(projectPath, { gateway: new FakeGateway(() => makeQuestion({ topic_id: "a" })) });
  await createInterview(projectPath, { gateway: new FakeGateway(() => makeQuestion({ topic_id: "b" })) });
  await submitAnswer(firstPath, { topic_id: "a", selected_option_id: null, free_text: "respuesta" }, { gateway: new FakeGateway(() => makeQuestion({ topic_id: "vision.users" })) });

  const list = await listInterviews(projectPath);
  assert.equal(list.length, 2);
  assert.equal(list[0].ledgerPath, firstPath, "la más reciente primero");
  assert.equal(list[0].answers_count, 1);
  assert.equal(list[0].topics_total, 14, "el tópico 'a' nuevo se instanció");
  assert.equal(list[0].topics_closed, 1, "al moverse a vision.users, 'a' quedó cubierto");
  assert.equal(list[1].answers_count, 0);

  // Los archivos que no matchean el patrón se ignoran.
  fs.writeFileSync(path.join(projectPath, ".agents", "interview", "otro.json"), "{}");
  assert.equal((await listInterviews(projectPath)).length, 2);
}));

// ─── Unidades del ledger y del prompt ───────────────────────────────────

test("recordAnswer: implies viene de la opción elegida o del texto libre", () => {
  const ledger = createLedger({ projectPath: "/repo", sessionId: "s1" });
  ledger.last_question = makeQuestion({
    topic_id: "vision.problem",
    options: [
      { id: "o1", label: "A", implies: "implica A" },
      { id: "o2", label: "B", implies: "implica B" },
    ],
  });

  const byOption = recordAnswer(ledger, { topic_id: "vision.problem", selected_option_id: "o2", free_text: null });
  assert.equal(byOption.implies, "implica B");

  const byText = recordAnswer(ledger, { topic_id: "vision.problem", selected_option_id: null, free_text: "  texto libre  " });
  assert.equal(byText.implies, "texto libre");
  assert.equal(byText.id, "a_002");
});

test("buildRecentAnswersSummary: una línea por respuesta, trunca texto libre a 80 chars", () => {
  const ledger = createLedger({ projectPath: "/repo", sessionId: "s1" });
  ledger.last_question = makeQuestion({ topic_id: "t1", question_text: "¿Pregunta?", options: [], kind: "free_only" });
  recordAnswer(ledger, { topic_id: "t1", selected_option_id: null, free_text: "x".repeat(200) });

  const summary = buildRecentAnswersSummary(ledger);
  assert.match(summary, /^\- \[t1\] ¿Pregunta\? → x{80}… \(implica: x{200}\)$/);
});

test("buildTurnPrompt: incluye contexto del proyecto, tópicos y contradicciones pendientes", () => {
  const ledger = createLedger({ projectPath: "/repo", sessionId: "s1" });
  ledger.last_question = makeQuestion({ topic_id: "nonfunctional.performance", topic_action: "open_new_topic" });
  recordAnswer(ledger, { topic_id: "nonfunctional.performance", selected_option_id: null, free_text: "rápido" });
  markContradictionPending(ledger, makeQuestion({
    topic_id: "nonfunctional.performance",
    topic_action: "resolve_contradiction",
    contradiction_flag: { conflicting_answer_id: "a_001", explanation: "conflicto" },
  }));

  const prompt = buildTurnPrompt(ledger);
  assert.match(prompt, /Sos un analista de requerimientos senior/);
  assert.match(prompt, new RegExp(`\\.agents[\\\\/]repo-context\\.md`));
  assert.match(prompt, /"id": "nonfunctional\.performance"/);
  assert.match(prompt, /implica: rápido/);
  assert.match(prompt, /"explanation": "conflicto"/, "la contradicción pendiente viaja al modelo");
});

test("updateTopicStatusForQuestion: transiciones según topic_action del modelo", () => {
  const ledger = createLedger({ projectPath: "/repo", sessionId: "s1" });
  const q = makeQuestion({ topic_id: "nonfunctional.performance", topic_action: "drill_down" });
  updateTopicStatusForQuestion(ledger, q, "nonfunctional.performance");
  assert.equal(ledger.topics.find((t) => t.id === "nonfunctional.performance")?.status, "open_vague");

  const q2 = makeQuestion({ topic_id: "scope.explicit_exclusions", topic_action: "close_topic" });
  updateTopicStatusForQuestion(ledger, q2, "nonfunctional.performance");
  assert.equal(ledger.topics.find((t) => t.id === "scope.explicit_exclusions")?.status, "closed");
  assert.equal(
    ledger.topics.find((t) => t.id === "nonfunctional.performance")?.status,
    "closed",
    "el modelo que se movió a otro tópico implica que el anterior quedó cubierto",
  );
});

test("normalizeConflictingAnswerId: fallback determinístico cuando el id no existe", () => {
  const ledger = createLedger({ projectPath: "/repo", sessionId: "s1" });
  ledger.last_question = makeQuestion({ topic_id: "t1", options: [{ id: "o1", label: "A", implies: "implica A" }] });
  recordAnswer(ledger, { topic_id: "t1", selected_option_id: "o1", free_text: null });
  ledger.last_question = makeQuestion({ topic_id: "t2", options: [{ id: "o1", label: "B", implies: "implica B" }] });
  recordAnswer(ledger, { topic_id: "t2", selected_option_id: "o1", free_text: null });

  assert.equal(normalizeConflictingAnswerId(ledger, makeQuestion({ topic_id: "t2", contradiction_flag: { conflicting_answer_id: "a_001", explanation: "x" } })), "a_001");
  assert.equal(normalizeConflictingAnswerId(ledger, makeQuestion({ topic_id: "t2", contradiction_flag: { conflicting_answer_id: "id_inexistente", explanation: "x" } })), "a_001");
  assert.equal(normalizeConflictingAnswerId(ledger, makeQuestion({ topic_id: "t9", contradiction_flag: { conflicting_answer_id: "id_inexistente", explanation: "x" } })), "a_001");
});

test("resolveContradictionsForAnswer: resuelve la contradicción de la pregunta respondida", () => {
  const ledger = createLedger({ projectPath: "/repo", sessionId: "s1" });
  ledger.last_question = makeQuestion({ topic_id: "t1", options: [{ id: "o1", label: "A", implies: "implica A" }] });
  recordAnswer(ledger, { topic_id: "t1", selected_option_id: "o1", free_text: null });
  ledger.last_question = makeQuestion({ topic_id: "t1", topic_action: "resolve_contradiction", contradiction_flag: { conflicting_answer_id: "a_001", explanation: "conflicto" } });
  const resolution = recordAnswer(ledger, { topic_id: "t1", selected_option_id: "o1", free_text: null });
  markContradictionPending(ledger, makeQuestion({ topic_id: "t1", topic_action: "resolve_contradiction", contradiction_flag: { conflicting_answer_id: "a_001", explanation: "conflicto" } }));

  resolveContradictionsForAnswer(ledger, resolution);
  assert.equal(ledger.contradictions[0].resolved, true);
  assert.equal(ledger.contradictions[0].resolution_answer_id, "a_002");
});

test("seedTopics: la semilla no se muta entre ledgers", () => {
  const first = seedTopics();
  first[0].status = "closed";
  const second = seedTopics();
  assert.equal(second[0].status, "unopened");
});

test("guard de pregunta: replica el schema, no lo endurece", () => {
  // El schema permite options vacías en cualquier kind y opciones en
  // free_only (descripciones, no restricciones). Rechazarlas rompería
  // turnos largos con invalid_question por casos degenerados pero válidos.
  assert.ok(isValidInterviewQuestion(makeQuestion({ kind: "single_select", options: [] })));
  assert.ok(isValidInterviewQuestion(makeQuestion({ kind: "free_only", options: [{ id: "o", label: "L", implies: "I" }] })));
  assert.ok(isValidInterviewQuestion(makeQuestion({ kind: "free_only", options: [] })));
});

test("guard de pregunta: describeInterviewQuestionIssue reporta la causa exacta", () => {
  const withoutAction = makeQuestion({});
  delete (withoutAction as Partial<InterviewQuestion>).topic_action;
  assert.match(describeInterviewQuestionIssue(withoutAction) ?? "", /topic_action/);

  assert.match(
    describeInterviewQuestionIssue(makeQuestion({ options: Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, label: "L", implies: "I" })) })) ?? "",
    /excede el máximo/,
  );

  const badCoverage = makeQuestion({ coverage_estimate: 1.5 });
  assert.match(describeInterviewQuestionIssue(badCoverage) ?? "", /fuera de rango/);

  const badKind = makeQuestion({ kind: "radio" as never });
  assert.match(describeInterviewQuestionIssue(badKind) ?? "", /kind inválido/);

  assert.equal(describeInterviewQuestionIssue(makeQuestion({})), null);
});
