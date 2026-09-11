/**
 * json-extract — extractor tolerante compartido (review/triage/foreman).
 * Un solo módulo dueño de la extracción; los 3 parsers delegan con sus
 * preferKeys (`verdict`/`decision`). Casos vivos: prosa + eco de tool-call
 * `{"id":...}` + JSON + prosa final; llaves dentro de strings; `{` sin
 * cerrar que no esconde objetos válidos internos. Puro, offline.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractBalancedJSONObject, stripJsonFences } from "../headless-runtime/llm/jsonExtract.ts";
import {
  readStructuredRaw,
  structuredFormat,
  STRUCTURED_OUTPUT_RETRY_COUNT,
  isFormatUnsupportedError,
  stripStructuredFormat,
} from "../headless-runtime/llm/structuredOutput.ts";
import { extractReviewJSONObject } from "../headless-runtime/review/reviewPrompt.ts";
import { parseTriageLLMResponse } from "../headless-runtime/triage/triagePrompt.ts";
import { parseForemanLLMResponse } from "../headless-runtime/foreman/foremanPrompt.ts";

const MIXED =
  "During attempt 1 I ran checks. Tool call result: " +
  '{"id":"toolu_01","type":"read"} - JSON below:\n' +
  '{"verdict":"revise","confidence":0.8,"summary":"falta cubrir reload","findings":[{"message":"agregar test","axis":"tests","severity":"major"}]}\n' +
  "That concludes my review.";

test("prefiere el objeto con la key pedida entre varios", () => {
  const found = extractBalancedJSONObject(MIXED, ["verdict"]);
  assert.ok(found !== null);
  assert.equal((JSON.parse(found as string) as Record<string, unknown>).verdict, "revise");
});

test("sin preferKeys devuelve el primer objeto parseable", () => {
  const found = extractBalancedJSONObject('previo {"a":1} resto');
  assert.equal(found, '{"a":1}');
});

test("jurk y vacíos → null, nunca lanza", () => {
  assert.equal(extractBalancedJSONObject("pura prosa"), null);
  assert.equal(extractBalancedJSONObject(""), null);
  assert.equal(extractBalancedJSONObject(null), null);
  assert.equal(extractBalancedJSONObject("{ roto"), null);
  assert.equal(extractBalancedJSONObject("} suelta {{}}"), "{}");
});

test("llaves dentro de strings no rompen el balanceo", () => {
  const found = extractBalancedJSONObject('nota {x} y {"k":"v {w}"} fin', ["k"]);
  assert.equal(found, '{"k":"v {w}"}');
});

test("un { sin cerrar no esconde objetos válidos internos", () => {
  const found = extractBalancedJSONObject('{ roto {"decision":"building"}', ["decision"]);
  assert.equal(found, '{"decision":"building"}');
});

test("stripJsonFences limpia fences y marcadores sueltos", () => {
  assert.equal(stripJsonFences('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripJsonFences('```\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripJsonFences(""), "");
  assert.equal(stripJsonFences(null), "");
});

test("review/triage/foreman parsean texto mixto con sus keys", () => {  const rev = extractReviewJSONObject(MIXED);
  assert.ok(rev !== null && rev.includes('"verdict":"revise"'));
  const tri = parseTriageLLMResponse(
    'Clasificando. Eco {"id":"t1"}.\n{"decision":"building","scope":"fix acotado","complexity":"trivial","openQuestions":[],"reason":"claro","confidence":0.9}\nListo.',
  );
  assert.equal(tri.decision, "building");
  assert.equal(tri.complexity, "trivial");
  const foreman = parseForemanLLMResponse(
    'The user wants me to act as the Foreman. Eco {"id":"f1"}.\n{"decision":"building","reason":"ejecutable","confidence":0.9}\nFin.',
  );
  assert.equal(foreman.decision, "building");
});

test("structuredFormat envuelve el schema en body.format del servidor", () => {
  const out = structuredFormat({ type: "object", properties: { a: { type: "string" } } });
  assert.equal(out.type, "json_schema");
  assert.deepEqual(out.schema, { type: "object", properties: { a: { type: "string" } } });
  assert.equal(out.retryCount, STRUCTURED_OUTPUT_RETRY_COUNT);
  const junk = structuredFormat(null);
  assert.equal(junk.type, "json_schema");
  assert.deepEqual(junk.schema, { type: "object" });
});

test("readStructuredRaw lee info.structured en ambas envolturas", () => {
  const obj = { verdict: "accept", confidence: 0.9, summary: "ok", findings: [] };
  assert.equal(
    readStructuredRaw({ data: { info: { structured: obj }, parts: [] } }),
    JSON.stringify(obj),
  );
  assert.equal(
    readStructuredRaw({ info: { structured: obj } }),
    JSON.stringify(obj),
  );
  assert.equal(readStructuredRaw({ data: { info: {}, parts: [] } }), null);
  assert.equal(readStructuredRaw({}), null);
  assert.equal(readStructuredRaw(null), null);
  assert.equal(readStructuredRaw("texto plano"), null);
});

test("fallback por capacidad: solo el 400 OutputFormat dispara texto plano", () => {
  assert.equal(
    isFormatUnsupportedError(new Error('Expected OutputFormatJsonSchema, got {"type":"json_schema"}')),
    true,
  );
  assert.equal(isFormatUnsupportedError(new Error("timeout 120000ms review")), false);
  assert.equal(isFormatUnsupportedError(new Error("StructuredOutputError: Model did not produce")), false);
  assert.equal(isFormatUnsupportedError(null), false);
  const stripped = stripStructuredFormat({ sessionID: "ses_1", format: { type: "json_schema" }, parts: [] });
  assert.deepEqual(stripped, { sessionID: "ses_1", parts: [] });
  assert.deepEqual(stripStructuredFormat(null), {});
});
