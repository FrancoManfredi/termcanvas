#!/usr/bin/env node
// lintPacts.mjs — valida contratos Pact por F (Ola 13 — F13 JSON escaping con backslashes y emoji 2 interactions)
// - Cada consumer spec no menciona paths de otra F (F01 no puede POST /jobs)
// - Cada pact JSON tiene 1 interaction por F (F03 híbrido puede tener 2, F07 400/404 también 2, F08 cola 2, F09 robustez 2, F10 persistencia 2, F11 unicode 2, F12 cancel 409/404 2), headers plain
// - No headers regex con "application/json;?.*" (plain only)
// Windows PowerShell friendly output.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");
const CONSUMER_DIR = path.join(ROOT, "software-testing-playground-v2", "pact", "consumer");
const PACTS_DIR = path.join(ROOT, "software-testing-playground-v2", "pacts");

// Allowed paths per F (R1 aislamiento)
// F01: solo GET /factory/health
// F02: solo POST /factory/jobs + headers plain, no GET /factory/jobs/:id/events etc
// F03: GET /factory/jobs/:id, GET /factory/jobs/:id/events (híbrido)
// F04: GET /factory/jobs + POST /factory/jobs/:id/cancel (hybrid Ola Cancel)
// F05: POST /factory/jobs con modelRef gate (201 valid, 400 invalid con alternatives) — Windows only
// F06: GET /factory/jobs/:id/logs + GET /factory/jobs/:id con resultPreview (dedicated logs endpoint) — Ola 6
// F07: POST /factory/jobs sin prompt → 400 {prompt required, hint, received} + GET /factory/jobs/job-notexist-99 → 404 {job not found} — Ola 7 DX
// F08: GET /factory/jobs con jobs min:2 (eachLike) + GET /factory/health 200 con queue coherente — Ola 8 cola y concurrencia
// F09: POST /factory/jobs con body malformado (text/plain "not-json") → 400 {body must be valid JSON, hint, received} + GET /factory/jobs/job-zzz-invalid99 → 404 {job not found} — Ola 9 robustez (cubre curl sin .exe)
// F10: POST /factory/jobs con prompt a*1500 → 201 queued + GET /factory/jobs/job-f10-large01 → 200 con prompt large idéntico — Ola 10 persistencia (cierra gap >1K)
// F11: POST /factory/jobs con prompt "línea1\nlínea2 con ñ y → y tildes ó í" + worktree "C:\tmp\playground F11 ñ test" → 201 queued + GET /factory/jobs/job-f11-unicode01 → 200 con prompt/worktree unicode idéntico sin mojibake — Ola 11 Windows robustez (cierra gap encoding submitHuman)
// F12: POST /factory/jobs/job-f12-done01/cancel ya done → 409 already done/error + POST /factory/jobs/job-notexist-99/cancel inexistente → 404 job not found — Ola 12 Cancel errores (complementa F04 200, cierra gap nunca probado)
// F13: POST /factory/jobs con prompt 'He said "hola" y path C:\tmp\a\b\nlínea con emoji 😀 y →' + worktree "C:\tmp\playground-F13-escape" → 201 queued + GET /factory/jobs/job-f13-escape01 → 200 con prompt escaped idéntico sin mojibake — Ola 13 JSON escaping robustez (cierra gap curl.exe -d "{\"prompt\":\"...\"}" mal escapado)

const RULES = {
  F01: {
    allowedPaths: [/^\/factory\/health$/],
    disallowedSubstrings: ["/factory/jobs", "/events", "POST", "worktree", "prompt"],
    maxInteractions: 1,
    description: "F01 solo debe definir GET /factory/health, nunca POST /jobs",
  },
  F02: {
    allowedPaths: [/^\/factory\/jobs$/],
    disallowedSubstrings: ["/factory/jobs/job-", "/events", "GET /factory/jobs/"],
    maxInteractions: 1,
    description: "F02 solo POST /factory/jobs, no debe mencionar GET/:id ni /events",
  },
  F03: {
    allowedPaths: [/^\/factory\/jobs\/job-/, /^\/factory\/jobs$/, /\/events$/],
    disallowedSubstrings: [], // F03 can use both
    maxInteractions: 2, // híbrido: GET /jobs/:id + GET /events
    minInteractions: 2,
    description: "F03 híbrido: GET /jobs/:id + GET /events (2 interactions)",
  },
  F04: {
    allowedPaths: [/^\/factory\/jobs$/, /^\/factory\/jobs\/job-/, /\/logs$/, /\/cancel$/],
    disallowedSubstrings: ["/factory/health"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F04 hybrid — GET /factory/jobs (lista panel) + POST /factory/jobs/:id/cancel — no debe mencionar /factory/health, no flaky 409",
  },
  F05: {
    allowedPaths: [/^\/factory\/jobs$/],
    disallowedSubstrings: ["/factory/health", "/events", "/cancel", "/logs"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F05 gate — POST /factory/jobs valida modelRef (201 valid, 400 invalid con alternatives) — sin PTY",
  },
  F06: {
    allowedPaths: [/^\/factory\/jobs\/job-/, /^\/factory\/jobs$/, /\/logs$/],
    disallowedSubstrings: ["/factory/health", "/events", "/cancel"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F06 logs — GET /factory/jobs/:id/logs + GET /factory/jobs/:id con resultPreview (2 interactions) — valida logs dedicado y disco",
  },
  F07: {
    allowedPaths: [/^\/factory\/jobs$/, /^\/factory\/jobs\/job-/],
    disallowedSubstrings: ["/factory/health", "/events", "/cancel", "/logs"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F07 DX 400/404 — POST /factory/jobs sin prompt → 400 {prompt required, hint, received} + GET /factory/jobs/job-notexist-99 → 404 {job not found} (2 interactions) — Windows PowerShell DX",
  },
  F08: {
    allowedPaths: [/^\/factory\/jobs$/, /^\/factory\/health$/],
    disallowedSubstrings: ["/events", "/cancel", "/logs"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F08 cola y concurrencia — GET /factory/jobs con jobs min:2 (eachLike) + GET /factory/health 200 con queue coherente (2 interactions) — Windows PowerShell, cierra gap F02/F04 concurrencia",
  },
  F09: {
    allowedPaths: [/^\/factory\/jobs$/, /^\/factory\/jobs\/job-/],
    disallowedSubstrings: ["/factory/health", "/events", "/cancel", "/logs"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F09 robustez — POST /factory/jobs con body malformado text/plain \"not-json\" → 400 {body must be valid JSON, hint, received} + GET /factory/jobs/job-zzz-invalid99 → 404 {job not found} (2 interactions) — cubre curl sin .exe, cierra gap F07 prompt missing",
  },
  F10: {
    allowedPaths: [/^\/factory\/jobs$/, /^\/factory\/jobs\/job-/],
    disallowedSubstrings: ["/factory/health", "/events", "/cancel", "/logs"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F10 prompt largo — POST /factory/jobs con prompt a*1500 (regex ^a{1000,}$) → 201 queued + GET /factory/jobs/job-f10-large01 → 200 con prompt large idéntico (persistencia) (2 interactions) — cierra gap prompt >1K nunca probado, valida que job.prompt no trunca a 120",
  },
  F11: {
    allowedPaths: [/^\/factory\/jobs$/, /^\/factory\/jobs\/job-/],
    disallowedSubstrings: ["/factory/health", "/events", "/cancel"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F11 unicode y espacio — POST /factory/jobs con prompt 'línea1\\nlínea2 con ñ y → y tildes ó í' + worktree 'C:\\tmp\\playground F11 ñ test' → 201 queued + GET /factory/jobs/job-f11-unicode01 → 200 con prompt/worktree unicode idéntico sin mojibake (2 interactions) — cierra gap encoding submitHuman, valida Factory maneja espacio + unicode UTF-8",
  },
  F12: {
    allowedPaths: [/^\/factory\/jobs\/job-.*\/cancel$/, /^\/factory\/jobs$/],
    disallowedSubstrings: ["/factory/health", "/events", "/logs"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F12 cancel errores — POST /factory/jobs/job-f12-done01/cancel ya done → 409 already done/error + POST /factory/jobs/job-notexist-99/cancel → 404 job not found (2 interactions) — complementa F04 200, cierra gap nunca probado, no flaky 409",
  },
  F13: {
    allowedPaths: [/^\/factory\/jobs$/, /^\/factory\/jobs\/job-/],
    disallowedSubstrings: ["/factory/health", "/events", "/cancel", "/logs"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F13 JSON escaping — POST /factory/jobs con prompt 'He said \"hola\" y path C:\\tmp\\a\\b\\nlínea con emoji 😀 y →' + worktree \"C:\\tmp\\playground-F13-escape\" → 201 queued + GET /factory/jobs/job-f13-escape01 → 200 con prompt escaped idéntico sin mojibake (2 interactions) — cierra gap JSON escaping backslashes/emoji PowerShell curl.exe mal escapado",
  },
  F14: {
    allowedPaths: [/^\/factory\/jobs$/, /^\/factory\/jobs\/job-/],
    disallowedSubstrings: ["/factory/health", "/events", "/cancel", "/logs"],
    maxInteractions: 2,
    minInteractions: 2,
    description: "F14 markdown fences — POST /factory/jobs con prompt '```js\\nconsole.log(\"hola\")\\n```\\nMarkdown con `code` y →' + worktree \"C:\\tmp\\playground-F14-markdown\" → 201 queued + GET /factory/jobs/job-f14-md01 → 200 con prompt markdown idéntico sin truncamiento ni mojibake (2 interactions) — cierra gap markdown con triple backtick nunca probado, fences + backticks + newlines",
  },
};

function logError(msg) {
  console.error(`[lintPacts] ✗ ${msg}`);
}

function logOk(msg) {
  console.log(`[lintPacts] ✓ ${msg}`);
}

function logWarn(msg) {
  console.warn(`[lintPacts] ⚠ ${msg}`);
}

let errors = 0;
let warnings = 0;

// 1. Validar consumer specs no mencionan paths de otra F
function lintConsumerSpecs() {
  if (!fs.existsSync(CONSUMER_DIR)) {
    logWarn(`Consumer dir no existe: ${CONSUMER_DIR}`);
    warnings++;
    return;
  }
  const files = fs.readdirSync(CONSUMER_DIR).filter((f) => f.endsWith(".spec.ts") || f.endsWith(".spec.js"));

  for (const file of files) {
    const match = file.match(/(F\d{2})/i);
    if (!match) {
      logWarn(`Archivo consumer sin Fxx en nombre: ${file}`);
      warnings++;
      continue;
    }
    const featureId = match[1].toUpperCase();
    const rule = RULES[featureId];
    if (!rule) {
      logWarn(`No hay regla para ${featureId} (${file}), skip`);
      continue;
    }
    const full = path.join(CONSUMER_DIR, file);
    const content = fs.readFileSync(full, "utf-8");

    // Check disallowed substrings
    let hasDisallowed = false;
    for (const bad of rule.disallowedSubstrings) {
      if (content.includes(bad)) {
        // Allow comments mentioning? But spec says "no menciona paths de otra F" strict
        // Check if bad appears inside a string literal path context
        // For F01, flag if POST /jobs appears
        if (featureId === "F01" && (content.includes("/factory/jobs") || content.includes("POST"))) {
          logError(`${featureId} (${file}) menciona path prohibido "${bad}" — F01 no puede POST /jobs (R1 aislamiento)`);
          errors++;
          hasDisallowed = true;
        } else if (featureId === "F02" && bad.includes("/factory/jobs/job-")) {
          // For F02, check if it mentions job/:id or events
          if (content.includes("/factory/jobs/job-") || content.includes("/events")) {
            logError(`${featureId} (${file}) menciona path prohibido "${bad}" — F02 no debe validar GET /jobs/:id ni SSE`);
            errors++;
            hasDisallowed = true;
          }
        } else if (featureId !== "F03") {
          // Generic disallowed
          if (content.includes(bad) && !content.includes("// allow") ) {
            // Only error if not in comment? Simple check
            logWarn(`${featureId} (${file}) contiene "${bad}" — revisar aislamiento`);
            warnings++;
          }
        }
      }
    }

    // Special strict checks
    if (featureId === "F01") {
      if (content.includes("POST") && content.includes("/factory/jobs")) {
        if (!content.includes("// lint-allow")) {
          // already counted
        }
      }
      if (content.includes('regex("application/json;?.*"') || content.includes("regex('application/json")) {
        logError(`${featureId} (${file}) usa headers regex "application/json;?.*" — debe ser plain "application/json" (ver § lint headers plain)`);
        errors++;
      }
    }
    if (featureId === "F02" || featureId === "F03") {
      // Check headers plain
      if (content.includes('regex("application/json;?.*"') || content.includes("jsonContentTypeMatcher") && content.includes("regex")) {
        // Allow only if not in header? F02 now uses plain, so if spec still has regex, warn
        if (featureId === "F02" && content.includes('regex("application/json;?.*"')) {
          logError(`${featureId} (${file}) usa header regex "application/json;?.*" — usar plain "application/json" para estabilidad Windows`);
          errors++;
        }
      }
    }
    if (featureId === "F11") {
      // F11 debe contener unicode real y worktree con espacio, sin health/events/cancel
      if (!content.includes("línea1") || !content.includes("ñ") || !content.includes("→") || !content.includes("línea2 con ñ")) {
        logError(`${featureId} (${file}) no contiene prompt unicode real "línea1\\n...ñ y →" — F11 debe usar strings con unicode real y tildes`);
        errors++;
      }
      if (!content.includes("playground F11") || !content.includes("C:\\\\tmp\\\\playground F11 ñ test") && !content.includes("playground F11 ñ test")) {
        logError(`${featureId} (${file}) no contiene worktree con espacio y unicode "C:\\tmp\\playground F11 ñ test" — F11 debe usar worktree con espacio y ñ`);
        errors++;
      }
      if (content.includes("/factory/health") || content.includes("/events") || content.includes("/cancel")) {
        logError(`${featureId} (${file}) menciona endpoint prohibido health/events/cancel — F11 solo debe usar /factory/jobs (R1 aislamiento)`);
        errors++;
        hasDisallowed = true;
      }
      if (content.includes('regex("application/json;?.*"') || content.includes("regex('application/json")) {
        logError(`${featureId} (${file}) usa headers regex "application/json;?.*" — debe ser plain "application/json"`);
        errors++;
      }
      // Nota: consumer F11 contiene comentarios y aserciones con "Ã" para validar mojibake — no se considera error en consumer.
      // El mojibake real se valida en pact JSON (ver lintPactJson F11).
      // Debe tener 2 interactions (POST 201 + GET 200)
      const postCount = (content.match(/method:\s*"POST"/g) || []).length;
      const getCount = (content.match(/method:\s*"GET"/g) || []).length;
      if (postCount < 1 || getCount < 1) {
        logError(`${featureId} (${file}) no tiene POST y GET interactions — F11 debe tener 2 (POST 201 unicode + GET 200 unicode)`);
        errors++;
      }
      if (content.includes("like(\"línea1") || content.includes("like('línea1")) {
        logOk(`${featureId} (${file}) usa like para prompt/worktree unicode OK`);
      } else if (!content.includes('like(UNICODE_PROMPT') && !content.includes('like(WORKTREE_F11')) {
        logWarn(`${featureId} (${file}) no usa like(UNICODE_PROMPT) / like(WORKTREE_F11) — F11 debe usar like para prompt/worktree unicode (ver spec)`);
        warnings++;
      }
    }
    if (featureId === "F12") {
      // F12 debe contener 2 POST cancel, sin health/events/logs, con regex already done y job not found
      if (!content.includes("job-f12-done01") || !content.includes("job-notexist-99")) {
        logError(`${featureId} (${file}) no contiene ids job-f12-done01 y job-notexist-99 — F12 debe usar ambos para 409 y 404`);
        errors++;
      }
      if (!content.includes("/cancel")) {
        logError(`${featureId} (${file}) no contiene /cancel — F12 debe validar POST /factory/jobs/:id/cancel`);
        errors++;
      }
      if (!content.includes("already (done|error)") && !content.includes("already done")) {
        logError(`${featureId} (${file}) no contiene regex \"already (done|error)\" — F12 409 debe usar regex already (done|error)`);
        errors++;
      }
      if (!content.includes("job not found")) {
        logError(`${featureId} (${file}) no contiene \"job not found\" — F12 404 debe validar job not found`);
        errors++;
      }
      if (content.includes("/factory/health") || content.includes("/events") || content.includes("/logs")) {
        logError(`${featureId} (${file}) menciona endpoint prohibido health/events/logs — F12 solo debe usar /factory/jobs/:id/cancel (R1 aislamiento, no debe mencionar health/events/logs)`);
        errors++;
        hasDisallowed = true;
      }
      if (content.includes('regex("application/json;?.*"') || content.includes("regex('application/json")) {
        logError(`${featureId} (${file}) usa headers regex \"application/json;?.*\" — debe ser plain \"application/json\"`);
        errors++;
      }
      // Debe tener 2 POST interactions (409 y 404)
      const postCountF12 = (content.match(/method:\s*"POST"/g) || []).length;
      if (postCountF12 < 2) {
        logError(`${featureId} (${file}) no tiene 2 POST interactions — F12 debe tener 2 (POST 409 already done + POST 404 job not found)`);
        errors++;
      }
      // Validar que usa body: {} y headers plain
      if (!content.includes("body: {}") && !content.includes("body: {}")) {
        logWarn(`${featureId} (${file}) no contiene \"body: {}\" — F12 POST cancel debe usar body {} y headers plain`);
        warnings++;
      }
      if (content.includes("a job that is done") && content.includes("no job exists")) {
        logOk(`${featureId} (${file}) contiene providerStates correctos "a job that is done" y "no job exists" OK`);
      } else {
        logError(`${featureId} (${file}) debe contener providerStates \"a job that is done\" (con id job-f12-done01) y \"no job exists\" para 409/404`);
        errors++;
      }
      // Ensure 409 and 404 status literals exist
      if (!content.includes("409") || !content.includes("404")) {
        logError(`${featureId} (${file}) no contiene status 409 y 404 — F12 debe validar 409 already done y 404 job not found`);
        errors++;
      }
    }
    if (featureId === "F13") {
      // F13 debe contener prompt con escaping: comillas, backslash, emoji, newline, y worktree playground-F13-escape, sin health/events/cancel
      if (!content.includes("He said") || !content.includes("hola") || !content.includes("😀")) {
        logError(`${featureId} (${file}) no contiene prompt escaped "He said \\"hola\\" ... 😀" — F13 debe usar prompt con comillas y emoji real`);
        errors++;
      }
      if (!content.includes("\\tmp") && !content.includes("C:\\\\tmp")) {
        logError(`${featureId} (${file}) no contiene prompt con backslash Windows "C:\\\\tmp\\\\a\\\\b" — F13 debe usar backslashes reales`);
        errors++;
      }
      if (!content.includes("playground-F13-escape") || !content.includes("C:\\\\tmp\\\\playground-F13-escape") && !content.includes("playground-F13-escape")) {
        logError(`${featureId} (${file}) no contiene worktree "C:\\tmp\\playground-F13-escape" — F13 debe usar worktree Windows con escaping`);
        errors++;
      }
      if (!content.includes("\\n") && !content.includes("línea con emoji")) {
        logWarn(`${featureId} (${file}) no parece contener salto de línea \\n en prompt — F13 debe incluir \\n (línea con emoji)`);
        warnings++;
      }
      if (content.includes("/factory/health") || content.includes("/events") || content.includes("/cancel")) {
        logError(`${featureId} (${file}) menciona endpoint prohibido health/events/cancel — F13 solo debe usar /factory/jobs (R1 aislamiento)`);
        errors++;
        hasDisallowed = true;
      }
      if (content.includes('regex("application/json;?.*"') || content.includes("regex('application/json")) {
        logError(`${featureId} (${file}) usa headers regex "application/json;?.*" — debe ser plain "application/json"`);
        errors++;
      }
      // Debe tener 1 POST 201 y 1 GET 200
      const postCountF13 = (content.match(/method:\s*"POST"/g) || []).length;
      const getCountF13 = (content.match(/method:\s*"GET"/g) || []).length;
      if (postCountF13 < 1 || getCountF13 < 1) {
        logError(`${featureId} (${file}) no tiene POST y GET interactions — F13 debe tener 2 (POST 201 escaped + GET 200 escaped persistencia)`);
        errors++;
      }
      if (!content.includes("201") || !content.includes("200")) {
        logError(`${featureId} (${file}) no contiene status 201 y 200 — F13 debe validar POST 201 y GET 200`);
        errors++;
      }
      if (!content.includes("factory is healthy") || !content.includes("a job with escaped prompt exists")) {
        logError(`${featureId} (${file}) debe contener providerStates "factory is healthy" y "a job with escaped prompt exists" para POST y GET`);
        errors++;
      } else {
        logOk(`${featureId} (${file}) contiene providerStates correctos "factory is healthy" y "a job with escaped prompt exists" OK`);
      }
      if (!content.includes('like(ESCAPED_PROMPT') && !content.includes('like("He said')) {
        logWarn(`${featureId} (${file}) no usa like(ESCAPED_PROMPT) — F13 debe usar like para prompt con escaping (ver spec)`);
        warnings++;
      } else {
        logOk(`${featureId} (${file}) usa like para prompt escaped OK`);
      }
      if (content.includes("Ã") && !content.includes("not.toContain(\"Ã\")")) {
        // consumer may check mojibake via not.toContain("Ã") but should not contain literal mojibake
        // we already check via not containing Ã in actual prompt string? The check below is for prompt string itself
        // Allow assertions with Ã but not in ESCAPED_PROMPT definition — just warn if prompt definition has mojibake
      }
      // Validate that consumer checks for escaping preservation
      if (!content.includes("not.toContain(\"Ã\")") && !content.includes('not.toContain("Ã")')) {
        logWarn(`${featureId} (${file}) no verifica mojibake via not.toContain("Ã") — F13 debe validar sin mojibake`);
        warnings++;
      }
      if (!content.includes("\"hola\"") && !content.includes('\\"hola\\"')) {
        logWarn(`${featureId} (${file}) no verifica que prompt contiene comillas "hola" — debe validar escaping de comillas`);
        warnings++;
      }
    }
    if (featureId === "F14") {
      // F14 debe contener prompt markdown con fences: ```js, console.log("hola"), `code`, →, \n, worktree playground-F14-markdown, sin health/events/cancel
      if (!content.includes("```js") || !content.includes("console.log") || !content.includes("`code`")) {
        logError(`${featureId} (${file}) no contiene prompt markdown "\`\`\`js ... console.log ... \`\`\` ... \`code\`" — F14 debe usar prompt con fences y backticks reales`);
        errors++;
      }
      if (!content.includes("→") || !content.includes("Markdown con")) {
        logError(`${featureId} (${file}) no contiene prompt markdown con flecha → y "Markdown con" — F14 debe usar arrow y markdown text`);
        errors++;
      }
      if (!content.includes("playground-F14-markdown") || !content.includes("C:\\\\tmp\\\\playground-F14-markdown")) {
        logError(`${featureId} (${file}) no contiene worktree "C:\\tmp\\playground-F14-markdown" — F14 debe usar worktree Windows con markdown`);
        errors++;
      }
      if (!content.includes("\\n") || !content.includes("console.log")) {
        logWarn(`${featureId} (${file}) no parece contener salto de línea \\n y console.log en prompt — F14 debe incluir \\n y code fence`);
        warnings++;
      }
      if (content.includes("/factory/health") && content.includes("factory is healthy") === false) {
        // factory is healthy is allowed via providerState, but direct health path outside pact interaction? Just warn if contains extra health outside spec
      }
      // Disallow health/events/cancel/logs except correct usage: POST /jobs and GET /jobs/:id only. Check that content does not mention disallowed paths outside allowed interactions
      // We consider that mentioning "/events" or "/cancel" is forbidden for F14 (like F13)
      if (content.includes("/events") || content.includes("/cancel") || content.includes("/logs") && content.includes("playground-F14-markdown") === false) {
        // need precise: if contains /events or /cancel in request path => error
        const hasBadEvent = content.includes('"/factory/jobs/job-') && content.includes("/events");
        const hasBadCancel = content.includes('"/factory/jobs/job-') && content.includes("/cancel");
        if (hasBadEvent || hasBadCancel || (content.includes("/events") && !content.includes("// allow"))) {
          // Generic check: count occurrences of /events and /cancel strings that are inside withRequest path
          if (content.includes("/events")) {
            logError(`${featureId} (${file}) menciona endpoint prohibido /events — F14 solo debe usar /factory/jobs (R1 aislamiento)`);
            errors++;
            hasDisallowed = true;
          }
          if (content.includes("/cancel")) {
            logError(`${featureId} (${file}) menciona endpoint prohibido /cancel — F14 solo debe usar /factory/jobs (R1 aislamiento)`);
            errors++;
            hasDisallowed = true;
          }
        }
      }
      if (content.includes('regex("application/json;?.*"') || content.includes("regex('application/json")) {
        logError(`${featureId} (${file}) usa headers regex "application/json;?.*" — debe ser plain "application/json"`);
        errors++;
      }
      // Debe tener 1 POST 201 y 1 GET 200
      const postCountF14 = (content.match(/method:\s*"POST"/g) || []).length;
      const getCountF14 = (content.match(/method:\s*"GET"/g) || []).length;
      if (postCountF14 < 1 || getCountF14 < 1) {
        logError(`${featureId} (${file}) no tiene POST y GET interactions — F14 debe tener 2 (POST 201 markdown + GET 200 markdown persistencia)`);
        errors++;
      }
      if (!content.includes("201") || !content.includes("200")) {
        logError(`${featureId} (${file}) no contiene status 201 y 200 — F14 debe validar POST 201 y GET 200`);
        errors++;
      }
      if (!content.includes("factory is healthy") || !content.includes("a job with markdown prompt exists")) {
        logError(`${featureId} (${file}) debe contener providerStates "factory is healthy" y "a job with markdown prompt exists" para POST y GET`);
        errors++;
      } else {
        logOk(`${featureId} (${file}) contiene providerStates correctos "factory is healthy" y "a job with markdown prompt exists" OK`);
      }
      if (!content.includes('like(MARKDOWN_PROMPT') && !content.includes('like("```js')) {
        logWarn(`${featureId} (${file}) no usa like(MARKDOWN_PROMPT) — F14 debe usar like para prompt markdown con fences (ver spec)`);
        warnings++;
      } else {
        logOk(`${featureId} (${file}) usa like para prompt markdown OK`);
      }
      if (!content.includes("not.toContain(\"Ã\")") && !content.includes('not.toContain("Ã")')) {
        logWarn(`${featureId} (${file}) no verifica mojibake via not.toContain("Ã") — F14 debe validar sin mojibake`);
        warnings++;
      }
      if (!content.includes("```") || !content.includes("`code`")) {
        logWarn(`${featureId} (${file}) no verifica que prompt contiene fences \`\`\` y \`code\` — debe validar fences/backticks`);
        warnings++;
      }
      // Validar que contiene verificación de fences count o contains
      if (!content.includes("```js") || !content.includes("console.log")) {
        logWarn(`${featureId} (${file}) no verifica fences \`\`\`js y console.log — debe validar persistencia de fences`);
        warnings++;
      }
    }

    if (!hasDisallowed) {
      logOk(`Consumer ${featureId} (${file}) aislamiento OK — ${rule.description}`);
    }
  }
}

// 2. Validar pact JSON: 1 interaction por F, headers plain
function lintPactJson() {
  if (!fs.existsSync(PACTS_DIR)) {
    logWarn(`Pacts dir no existe: ${PACTS_DIR} — corre pnpm p:consumer`);
    warnings++;
    return;
  }
  const files = fs.readdirSync(PACTS_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    logWarn(`No hay pacts/*.json — corre pnpm p:consumer primero`);
    warnings++;
    return;
  }

  for (const file of files) {
    const match = file.match(/playground-(F\d{2})-FactoryProvider\.json/i);
    if (!match) {
      logWarn(`Pact file nombre no estándar: ${file}`);
      warnings++;
      continue;
    }
    const featureId = match[1].toUpperCase();
    const rule = RULES[featureId];
    if (!rule) {
      logWarn(`No hay regla para pact ${featureId} (${file})`);
      continue;
    }
    const full = path.join(PACTS_DIR, file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, "utf-8"));
    } catch (e) {
      logError(`Pact ${featureId} (${file}) no es JSON válido: ${String(e)}`);
      errors++;
      continue;
    }

    const interactions = Array.isArray(raw.interactions) ? raw.interactions : [];
    const count = interactions.length;

    // Check count: F01,F02 exactly 1, F03 2, F04 2, F05 2, F06 2
    if (featureId === "F03") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (GET /jobs/:id + GET /events) — híbrido F03 debe tener 2`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (híbrido)`);
      }
    } else if (featureId === "F04") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (GET /factory/jobs + POST /cancel) — F04 Ola Cancel`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (GET lista + POST cancel)`);
      }
      // Extra flaky guard: ensure at least one POST cancel interaction exists, no 409 handling
      const hasCancel = interactions.some((it) => {
        const req = it.request ?? {};
        const pathStr = typeof req.path === "string" ? req.path : "";
        return (req.method ?? "").toUpperCase() === "POST" && pathStr.includes("/cancel");
      });
      if (!hasCancel) {
        logError(`Pact ${featureId} (${file}) no tiene interacción POST /cancel — Ola Cancel requiere cancel pacteado`);
        errors++;
      }
      // Ensure no interaction expects 409 (flaky guard)
      for (let idx = 0; idx < interactions.length; idx++) {
        const resStatus = interactions[idx].response?.status;
        if (resStatus === 409) {
          logError(`Pact ${featureId} (${file}) interaction ${idx} espera 409 — flaky cancel (job ya done) no permitido; stateHandler debe asegurar queued`);
          errors++;
        }
      }
    } else if (featureId === "F01" || featureId === "F02") {
      if (count !== 1) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se espera 1 (una interacción por F, R1)`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 1 interaction OK`);
      }
    } else if (featureId === "F05") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (POST valid 201 + POST invalid 400 gate) — F05 gate`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (gate 201+400)`);
      }
      // Extra: debe tener un 201 y un 400, y el 400 con alternatives
      const has201 = interactions.some((it) => (it.response?.status ?? it.response?.status) === 201);
      const has400 = interactions.some((it) => it.response?.status === 400);
      if (!has201) {
        logError(`Pact ${featureId} (${file}) no tiene interacción 201 — gate válido debe responder 201 queued`);
        errors++;
      }
      if (!has400) {
        logError(`Pact ${featureId} (${file}) no tiene interacción 400 — gate inválido (gpt-99) debe responder 400 con alternatives`);
        errors++;
      }
      // Check that 400 body contains error and alternatives matcher
      const bad400 = interactions.find((it) => it.response?.status === 400);
      if (bad400) {
        const body = bad400.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        if (!bodyStr.includes("model not in catalog") && !bodyStr.includes("error")) {
          logWarn(`Pact ${featureId} (${file}) 400 body no contiene 'model not in catalog' — revisar contrato gate`);
          warnings++;
        }
        if (!bodyStr.includes("alternatives")) {
          logError(`Pact ${featureId} (${file}) 400 body no contiene 'alternatives' — gate debe devolver alternatives`);
          errors++;
        }
      }
    } else if (featureId === "F06") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (GET /logs + GET /jobs/:id con resultPreview) — F06 logs`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (GET /logs dedicado + GET /jobs/:id resultPreview)`);
      }
      // Extra: debe tener un GET /logs y un GET /jobs/:id ambos 200
      const hasLogs = interactions.some((it) => {
        const req = it.request ?? {};
        const pathStr = typeof req.path === "string" ? req.path : "";
        return (req.method ?? "").toUpperCase() === "GET" && pathStr.includes("/logs") && it.response?.status === 200;
      });
      const hasJobWithPreview = interactions.some((it) => {
        const req = it.request ?? {};
        const pathStr = typeof req.path === "string" ? req.path : "";
        const isGetJob = (req.method ?? "").toUpperCase() === "GET" && pathStr.includes("/factory/jobs/job-");
        if (!isGetJob || it.response?.status !== 200) return false;
        const body = it.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        return bodyStr.includes("resultPreview") && bodyStr.includes("logs");
      });
      if (!hasLogs) {
        logError(`Pact ${featureId} (${file}) no tiene interacción GET /logs → 200 — F06 debe validar endpoint dedicado`);
        errors++;
      }
      if (!hasJobWithPreview) {
        logError(`Pact ${featureId} (${file}) no tiene interacción GET /jobs/:id con resultPreview+logs → 200 — F06 debe validar disco via resultPreview`);
        errors++;
      }
      // Check logs body has id and logs matcher
      const logsInter = interactions.find((it) => {
        const req = it.request ?? {};
        const p = typeof req.path === "string" ? req.path : "";
        return typeof p === "string" && p.includes("/logs");
      });
      if (logsInter) {
        const body = logsInter.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        if (!bodyStr.includes("logs")) {
          logError(`Pact ${featureId} (${file}) GET /logs body no contiene 'logs' — debe ser {id, logs: string[]}`);
          errors++;
        }
      }
    } else if (featureId === "F07") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (POST 400 prompt required + GET 404 job not found) — F07 DX 400/404`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (POST 400 prompt required + GET 404 job not found)`);
      }
      // Debe tener un 400 con prompt required y un 404 con job not found
      const has400Prompt = interactions.some((it) => {
        if (it.response?.status !== 400) return false;
        const body = it.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        return bodyStr.includes("prompt is required") || bodyStr.includes("prompt");
      });
      const has404Job = interactions.some((it) => {
        if (it.response?.status !== 404) return false;
        const body = it.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        return bodyStr.includes("job not found");
      });
      if (!has400Prompt) {
        logError(`Pact ${featureId} (${file}) no tiene interacción 400 con 'prompt is required' — F07 debe validar POST sin prompt → 400 {error, hint, received}`);
        errors++;
      }
      if (!has404Job) {
        logError(`Pact ${featureId} (${file}) no tiene interacción 404 con 'job not found' — F07 debe validar GET job nonexist → 404`);
        errors++;
      }
      // Extra: 400 body debe contener hint y received
      const bad400 = interactions.find((it) => it.response?.status === 400);
      if (bad400) {
        const body = bad400.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        if (!bodyStr.includes("hint")) {
          logError(`Pact ${featureId} (${file}) 400 body no contiene 'hint' — F07 400 debe devolver hint para DX PowerShell`);
          errors++;
        }
        if (!bodyStr.includes("received")) {
          logError(`Pact ${featureId} (${file}) 400 body no contiene 'received' — F07 400 debe devolver received para DX`);
          errors++;
        }
        if (!bodyStr.includes("prompt is required")) {
          logWarn(`Pact ${featureId} (${file}) 400 body no contiene 'prompt is required' exacto — revisar regex`);
          warnings++;
        }
      }
      // 404 body debe contener error
      const bad404 = interactions.find((it) => it.response?.status === 404);
      if (bad404) {
        const body = bad404.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        if (!bodyStr.includes("job not found")) {
          logError(`Pact ${featureId} (${file}) 404 body no contiene 'job not found' — F07 404 debe devolver job not found`);
          errors++;
        }
      }
    } else if (featureId === "F08") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (GET /factory/jobs min:2 + GET /factory/health 200 con queue) — F08 cola y concurrencia`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (GET /jobs min:2 + GET /health 200 con queue)`);
      }
      // Debe tener un GET /factory/jobs con jobs min:2 (eachLike) y un GET /factory/health 200 con queue
      const hasJobsList = interactions.some((it) => {
        const req = it.request ?? {};
        const res = it.response ?? {};
        const pathStr = typeof req.path === "string" ? req.path : "";
        const isGetJobs = (req.method ?? "").toUpperCase() === "GET" && pathStr === "/factory/jobs" && res.status === 200;
        if (!isGetJobs) return false;
        // Check body contains jobs and matchingRules $.jobs min >=2
        const body = res.body ?? {};
        const bodyStr = JSON.stringify(body);
        if (!bodyStr.includes("jobs")) return false;
        const mr = res.matchingRules ?? (it.response && it.response.matchingRules) ?? {};
        const bodyMr = mr && mr.body;
        if (bodyMr && typeof bodyMr === "object") {
          const jobsRule = bodyMr["$.jobs"];
          if (jobsRule) {
            const matchers = jobsRule.matchers;
            if (Array.isArray(matchers)) {
              const hasMin2 = matchers.some((m) => typeof m.min === "number" && m.min >= 2);
              if (hasMin2) return true;
              // fallback: check min property on rule itself
              if (typeof jobsRule.min === "number" && jobsRule.min >= 2) return true;
            }
            // also check if rule has min directly (Pact JS v3 serializes min at top level of $.jobs)
            if (typeof jobsRule.min === "number") {
              return jobsRule.min >= 2;
            }
          }
        }
        // As fallback, accept if interaction has matchingRules for $.jobs with min 2 in raw JSON string (check raw file)
        // But for strict, require min 2; if not found, still check body has jobs and interaction count ok — but we want to error if min <2
        // We'll do secondary check: look at raw interactions JSON for "min":2 alongside $.jobs
        const rawStr = JSON.stringify(it);
        if (rawStr.includes("$.jobs") && rawStr.includes('"min":2')) return true;
        return false;
      });
      const hasHealthQueue = interactions.some((it) => {
        const req = it.request ?? {};
        const res = it.response ?? {};
        const pathStr = typeof req.path === "string" ? req.path : "";
        const isGetHealth = (req.method ?? "").toUpperCase() === "GET" && pathStr === "/factory/health" && res.status === 200;
        if (!isGetHealth) return false;
        const body = res.body ?? {};
        const bodyStr = JSON.stringify(body);
        return bodyStr.includes("queue") && bodyStr.includes("pending") && bodyStr.includes("running") && bodyStr.includes("uptime") && bodyStr.includes("version") && bodyStr.includes("ts");
      });
      if (!hasJobsList) {
        logError(`Pact ${featureId} (${file}) no tiene interacción GET /factory/jobs con jobs min:2 (eachLike) — F08 debe validar lista con al menos 2 jobs para concurrencia`);
        errors++;
      }
      if (!hasHealthQueue) {
        logError(`Pact ${featureId} (${file}) no tiene interacción GET /factory/health → 200 con queue {pending, running} + uptime/version/ts — F08 debe validar health coherente tras jobs`);
        errors++;
      }
      // Extra: check jobs body has state regex and dir Windows regex
      const jobsInter = interactions.find((it) => {
        const req = it.request ?? {};
        const p = typeof req.path === "string" ? req.path : "";
        return (req.method ?? "").toUpperCase() === "GET" && p === "/factory/jobs";
      });
      if (jobsInter) {
        const bodyStr = JSON.stringify(jobsInter.response?.body ?? {});
        if (!bodyStr.includes("queued|running|done|error") && !bodyStr.includes("state")) {
          logWarn(`Pact ${featureId} (${file}) GET /jobs body no contiene state regex queued|running|done|error — revisar matcher`);
          warnings++;
        }
        if (!bodyStr.includes("\\.agents\\\\factory") && !bodyStr.includes("dir")) {
          logWarn(`Pact ${featureId} (${file}) GET /jobs body no contiene dir regex Windows (\\.agents\\\\factory) — revisar`);
          warnings++;
        }
      }
    } else if (featureId === "F09") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (POST 400 body must be valid JSON + GET 404 job not found) — F09 robustez`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (POST 400 body must be valid JSON + GET 404 job not found)`);
      }
      // Debe tener un 400 con body must be valid JSON y un 404 con job not found
      const has400Body = interactions.some((it) => {
        if (it.response?.status !== 400) return false;
        const body = it.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        return bodyStr.includes("body must be valid JSON");
      });
      const has404Job = interactions.some((it) => {
        if (it.response?.status !== 404) return false;
        const body = it.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        return bodyStr.includes("job not found");
      });
      if (!has400Body) {
        logError(`Pact ${featureId} (${file}) no tiene interacción 400 con 'body must be valid JSON' — F09 debe validar POST malformado → 400 {error, hint, received}`);
        errors++;
      }
      if (!has404Job) {
        logError(`Pact ${featureId} (${file}) no tiene interacción 404 con 'job not found' — F09 debe validar GET job-zzz-invalid99 → 404`);
        errors++;
      }
      // Extra: 400 body debe contener hint y received
      const bad400 = interactions.find((it) => it.response?.status === 400);
      if (bad400) {
        const body = bad400.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        if (!bodyStr.includes("hint")) {
          logError(`Pact ${featureId} (${file}) 400 body no contiene 'hint' — F09 400 debe devolver hint para DX`);
          errors++;
        }
        if (!bodyStr.includes("received")) {
          logError(`Pact ${featureId} (${file}) 400 body no contiene 'received' — F09 400 debe devolver received para DX`);
          errors++;
        }
        if (!bodyStr.includes("body must be valid JSON")) {
          logWarn(`Pact ${featureId} (${file}) 400 body no contiene 'body must be valid JSON' exacto — revisar regex`);
          warnings++;
        }
        // Verificar que request sea POST /factory/jobs con body raw not-json y header text/plain o application/json
        const req400 = bad400.request ?? {};
        const reqBody = req400.body;
        const reqBodyStr = typeof reqBody === "string" ? reqBody : JSON.stringify(reqBody ?? "");
        if (!reqBodyStr.includes("not-json")) {
          logWarn(`Pact ${featureId} (${file}) request 400 body no contiene 'not-json' — debería ser body malformado crudo`);
          warnings++;
        }
      }
      // 404 body debe contener error job not found
      const bad404 = interactions.find((it) => it.response?.status === 404);
      if (bad404) {
        const body = bad404.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        if (!bodyStr.includes("job not found")) {
          logError(`Pact ${featureId} (${file}) 404 body no contiene 'job not found' — F09 404 debe devolver job not found`);
          errors++;
        }
        const req404 = bad404.request ?? {};
        const pathStr = typeof req404.path === "string" ? req404.path : "";
        if (!pathStr.includes("job-zzz-invalid99")) {
          logWarn(`Pact ${featureId} (${file}) 404 path no contiene 'job-zzz-invalid99' — esperado GET /factory/jobs/job-zzz-invalid99`);
          warnings++;
        }
      }
    } else if (featureId === "F10") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (POST 201 prompt large + GET 200 prompt large persistencia) — F10 prompt largo`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (POST 201 large prompt + GET 200 persistencia)`);
      }
      // Debe tener un POST 201 con prompt large y un GET 200 con prompt large idéntico
      const hasPost201Large = interactions.some((it) => {
        if ((it.request?.method ?? "").toUpperCase() !== "POST" || it.response?.status !== 201) return false;
        const reqBody = it.request?.body ?? {};
        const resBody = it.response?.body ?? {};
        const reqStr = JSON.stringify(reqBody);
        const resStr = JSON.stringify(resBody);
        // Check prompt large: regex ^a{1000,}$ present or like with 100+ a's or body contains large prompt example
        const hasPromptMatcher = reqStr.includes("a{1000") || reqStr.includes("^a{1000") || reqStr.includes("a".repeat(50)) || resStr.includes("a{1000") || resStr.includes("^a{1000");
        const hasPromptExample = reqStr.includes("a".repeat(20)) && resStr.includes("a".repeat(20));
        return hasPromptMatcher || hasPromptExample;
      });
      const hasGet200Large = interactions.some((it) => {
        if ((it.request?.method ?? "").toUpperCase() !== "GET" || it.response?.status !== 200) return false;
        const resBody = it.response?.body ?? {};
        const reqPath = typeof it.request?.path === "string" ? it.request.path : "";
        const resStr = JSON.stringify(resBody);
        const hasPromptLarge = resStr.includes("a{1000") || resStr.includes("^a{1000") || resStr.includes("a".repeat(50));
        const isJobF10 = reqPath.includes("job-f10-large01");
        return hasPromptLarge && isJobF10;
      });
      if (!hasPost201Large) {
        logError(`Pact ${featureId} (${file}) no tiene interacción POST /factory/jobs → 201 con prompt large (regex ^a{1000,}$ + ejemplo 1500 a) — F10 debe validar POST con prompt a*1500 no truncado`);
        errors++;
      }
      if (!hasGet200Large) {
        logError(`Pact ${featureId} (${file}) no tiene interacción GET /factory/jobs/job-f10-large01 → 200 con prompt large (regex ^a{1000,}$) — F10 debe validar persistencia GET devuelve prompt idéntico 1500 a`);
        errors++;
      }
      // Extra: ambas bodies deben contener prompt large y worktree Windows, y validar headers plain
      const post201 = interactions.find((it) => (it.request?.method ?? "").toUpperCase() === "POST" && it.response?.status === 201);
      if (post201) {
        const resBody = post201.response?.body ?? {};
        const resStr = JSON.stringify(resBody);
        if (!resStr.includes("queued")) {
          logError(`Pact ${featureId} (${file}) POST 201 body no contiene 'queued' — job debe estar queued tras POST large prompt`);
          errors++;
        }
        if (!resStr.includes("prompt")) {
          logError(`Pact ${featureId} (${file}) POST 201 body no contiene 'prompt' — debe validar job.prompt large`);
          errors++;
        }
        if (!resStr.includes("\\.agents\\\\factory") && !resStr.includes("path")) {
          logWarn(`Pact ${featureId} (${file}) POST 201 body no contiene dir Windows regex (\\.agents\\\\factory) — revisar path`);
          warnings++;
        }
        const reqBody = post201.request?.body ?? {};
        const reqStr = JSON.stringify(reqBody);
        if (!reqStr.includes("a".repeat(20)) && !reqStr.includes("a{1000")) {
          logWarn(`Pact ${featureId} (${file}) POST request body no parece contener prompt large (a*100+ o regex) — revisar matcher like("a".repeat(1500)) o regex ^a{1000,}$`);
          warnings++;
        }
        if (!reqStr.includes("C:\\\\tmp") && !reqStr.includes("playground-F10")) {
          logWarn(`Pact ${featureId} (${file}) POST request worktree no contiene Windows path C:\\tmp\\playground-F10-large — debe ser Windows path`);
          warnings++;
        }
      }
      const get200 = interactions.find((it) => (it.request?.method ?? "").toUpperCase() === "GET" && it.response?.status === 200);
      if (get200) {
        const resBody = get200.response?.body ?? {};
        const resStr = JSON.stringify(resBody);
        const rawStr = JSON.stringify(get200);
        if (!resStr.includes("prompt")) {
          logError(`Pact ${featureId} (${file}) GET 200 body no contiene 'prompt' — debe validar prompt large persistido`);
          errors++;
        }
        if (!rawStr.includes("queued|running|done|error") && !resStr.includes("state")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no contiene state regex queued|running|done|error — revisar matcher`);
          warnings++;
        }
        if (!resStr.includes("logs") && !rawStr.includes("logs")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no contiene 'logs' — debe ser type logs array`);
          warnings++;
        }
        if (!resStr.includes("job-f10-large01") && !rawStr.includes("job-f10-large01")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body/id no contiene 'job-f10-large01' — debe ser regex ^job-f10-large01$`);
          warnings++;
        }
        const reqPath = typeof get200.request?.path === "string" ? get200.request.path : "";
        if (!reqPath.includes("job-f10-large01")) {
          logError(`Pact ${featureId} (${file}) GET 200 path no contiene 'job-f10-large01' — esperado /factory/jobs/job-f10-large01`);
          errors++;
        }
      }
    } else if (featureId === "F11") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (POST 201 unicode + GET 200 unicode persistencia) — F11 unicode y espacio`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (POST 201 unicode + GET 200 persistencia unicode)`);
      }
      // Debe tener POST 201 con prompt unicode y worktree con espacio, y GET 200 con prompt unicode
      const hasPost201Unicode = interactions.some((it) => {
        if ((it.request?.method ?? "").toUpperCase() !== "POST" || it.response?.status !== 201) return false;
        const reqBody = it.request?.body ?? {};
        const resBody = it.response?.body ?? {};
        const reqStr = JSON.stringify(reqBody);
        const resStr = JSON.stringify(resBody);
        const hasUnicodeReq = reqStr.includes("línea1") && reqStr.includes("ñ") && reqStr.includes("→") && (reqStr.includes("playground F11") || reqStr.includes("playground"));
        const hasUnicodeRes = resStr.includes("línea1") && (resStr.includes("playground F11") || resStr.includes("playground"));
        // path must contain playground F11 with space
        const hasPathSpace = resStr.includes("playground F11") || reqStr.includes("playground F11");
        return (hasUnicodeReq || hasUnicodeRes) && hasPathSpace;
      });
      const hasGet200Unicode = interactions.some((it) => {
        if ((it.request?.method ?? "").toUpperCase() !== "GET" || it.response?.status !== 200) return false;
        const resBody = it.response?.body ?? {};
        const reqPath = typeof it.request?.path === "string" ? it.request.path : "";
        const resStr = JSON.stringify(resBody);
        const hasUnicode = resStr.includes("línea1") && resStr.includes("ñ") && resStr.includes("playground F11");
        const isJobF11 = reqPath.includes("job-f11-unicode01");
        return hasUnicode && isJobF11;
      });
      if (!hasPost201Unicode) {
        logError(`Pact ${featureId} (${file}) no tiene interacción POST /factory/jobs → 201 con prompt unicode "línea1\\n...ñ →" + worktree con espacio "playground F11 ñ test" — F11 debe validar POST con unicode y espacio sin mojibake`);
        errors++;
      }
      if (!hasGet200Unicode) {
        logError(`Pact ${featureId} (${file}) no tiene interacción GET /factory/jobs/job-f11-unicode01 → 200 con prompt unicode (línea1.*ñ) y worktree con espacio — F11 debe validar persistencia GET devuelve prompt/worktree unicode idéntico sin Ã³`);
        errors++;
      }
      // Extra checks
      const post201 = interactions.find((it) => (it.request?.method ?? "").toUpperCase() === "POST" && it.response?.status === 201);
      if (post201) {
        const resBody = post201.response?.body ?? {};
        const resStr = JSON.stringify(resBody);
        const reqBody = post201.request?.body ?? {};
        const reqStr = JSON.stringify(reqBody);
        if (!resStr.includes("queued")) {
          logError(`Pact ${featureId} (${file}) POST 201 body no contiene 'queued' — job debe estar queued tras POST unicode`);
          errors++;
        }
        if (!resStr.includes("línea1") || !resStr.includes("playground F11")) {
          logError(`Pact ${featureId} (${file}) POST 201 body no contiene unicode prompt 'línea1' o worktree 'playground F11' — debe validar prompt/worktree unicode`);
          errors++;
        }
        if (!resStr.includes("\\.agents\\\\factory") && !resStr.includes("playground F11")) {
          logWarn(`Pact ${featureId} (${file}) POST 201 body no contiene dir Windows regex (\\.agents\\\\factory) con espacio — revisar path regex .*playground F11.*\\.agents\\\\factory`);
          warnings++;
        }
        if (!reqStr.includes("línea1") || !reqStr.includes("ñ") || !reqStr.includes("→")) {
          logWarn(`Pact ${featureId} (${file}) POST request body no contiene prompt unicode completo (línea1, ñ, →) — revisar matcher like("línea1\\nlínea2 con ñ y →")`);
          warnings++;
        }
        if (!reqStr.includes("C:\\\\tmp") && !reqStr.includes("playground F11")) {
          logWarn(`Pact ${featureId} (${file}) POST request worktree no contiene Windows path con espacio "C:\\tmp\\playground F11 ñ test" — debe ser Windows path con espacio y ñ`);
          warnings++;
        }
        // check mojibake not present: should not contain Ã³ encoded
        if (reqStr.includes("Ã") || resStr.includes("Ã")) {
          logError(`Pact ${featureId} (${file}) POST pact contiene mojibake Ã — pact debe ser UTF-8 sin Ã³, verificar file encoding utf-8`);
          errors++;
        }
      }
      const get200 = interactions.find((it) => (it.request?.method ?? "").toUpperCase() === "GET" && it.response?.status === 200);
      if (get200) {
        const resBody = get200.response?.body ?? {};
        const resStr = JSON.stringify(resBody);
        const rawStr = JSON.stringify(get200);
        if (!resStr.includes("línea1") || !resStr.includes("ñ")) {
          logError(`Pact ${featureId} (${file}) GET 200 body no contiene prompt unicode 'línea1'/'ñ' — debe validar prompt unicode persistido`);
          errors++;
        }
        if (!resStr.includes("playground F11")) {
          logError(`Pact ${featureId} (${file}) GET 200 body no contiene worktree con espacio 'playground F11 ñ' — debe validar worktree unicode persistido`);
          errors++;
        }
        if (!rawStr.includes("queued|running|done|error") && !resStr.includes("state")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no contiene state regex queued|running|done|error — revisar matcher`);
          warnings++;
        }
        if (!resStr.includes("logs") && !rawStr.includes("logs")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no contiene 'logs' — debe ser type logs array`);
          warnings++;
        }
        if (!resStr.includes("job-f11-unicode01") && !rawStr.includes("job-f11-unicode01")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body/id no contiene 'job-f11-unicode01' — debe ser regex ^job-f11-unicode01$`);
          warnings++;
        }
        const reqPath = typeof get200.request?.path === "string" ? get200.request.path : "";
        if (!reqPath.includes("job-f11-unicode01")) {
          logError(`Pact ${featureId} (${file}) GET 200 path no contiene 'job-f11-unicode01' — esperado /factory/jobs/job-f11-unicode01`);
          errors++;
        }
        if (resStr.includes("Ã") || rawStr.includes("Ã")) {
          logError(`Pact ${featureId} (${file}) GET pact contiene mojibake Ã — debe ser UTF-8 sin mojibake`);
          errors++;
        }
        // Ensure prompt not truncated and contains newline
        if (!resStr.includes("\\n") && !resStr.includes("línea1")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no parece contener prompt con salto de línea \\n — revisar unicode prompt con \\n`);
          warnings++;
        }
      }
    } else if (featureId === "F12") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (POST job-f12-done01/cancel 409 already done + POST job-notexist-99/cancel 404) — F12 cancel errores 409/404`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (POST cancel 409 already done + POST cancel 404 job not found)`);
      }
      // Debe tener POST 409 already done/error y POST 404 job not found
      const has409AlreadyDone = interactions.some((it) => {
        if ((it.request?.method ?? "").toUpperCase() !== "POST" || it.response?.status !== 409) return false;
        const body = it.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        return bodyStr.includes("already") && (bodyStr.includes("done") || bodyStr.includes("error"));
      });
      const has404JobNotFound = interactions.some((it) => {
        if ((it.request?.method ?? "").toUpperCase() !== "POST" || it.response?.status !== 404) return false;
        const body = it.response?.body ?? {};
        const bodyStr = JSON.stringify(body);
        return bodyStr.includes("job not found");
      });
      if (!has409AlreadyDone) {
        logError(`Pact ${featureId} (${file}) no tiene interacción POST /factory/jobs/job-f12-done01/cancel → 409 already (done|error) — F12 debe validar cancel sobre done`);
        errors++;
      }
      if (!has404JobNotFound) {
        logError(`Pact ${featureId} (${file}) no tiene interacción POST /factory/jobs/job-notexist-99/cancel → 404 job not found — F12 debe validar cancel sobre inexistente`);
        errors++;
      }
      const hasPostCancel409 = interactions.some((it) => (it.request?.method ?? "").toUpperCase() === "POST" && String(it.request?.path ?? "").includes("/cancel") && it.response?.status === 409);
      const hasPostCancel404 = interactions.some((it) => (it.request?.method ?? "").toUpperCase() === "POST" && String(it.request?.path ?? "").includes("/cancel") && it.response?.status === 404);
      if (!hasPostCancel409) {
        logError(`Pact ${featureId} (${file}) no tiene POST /cancel → 409 — F12 debe tener cancel 409`);
        errors++;
      }
      if (!hasPostCancel404) {
        logError(`Pact ${featureId} (${file}) no tiene POST /cancel → 404 — F12 debe tener cancel 404`);
        errors++;
      }
      for (const it of interactions) {
        const p = typeof it.request?.path === "string" ? it.request.path : "";
        const rawStr = JSON.stringify(it);
        if (!p.includes("/cancel") && !rawStr.includes("/cancel")) {
          logWarn(`Pact ${featureId} (${file}) interaction path "${p}" no contiene /cancel — F12 todas deben ser POST /cancel`);
          warnings++;
        }
      }
      const batchStr = JSON.stringify(interactions);
      if (!batchStr.includes("already (done|error)") && !batchStr.includes("already")) {
        logWarn(`Pact ${featureId} (${file}) no contiene regex "already (done|error)" — revisar matcher 409`);
        warnings++;
      }
      if (!batchStr.includes("job not found")) {
        logWarn(`Pact ${featureId} (${file}) no contiene "job not found" — revisar matcher 404`);
        warnings++;
      }
      // Ensure no 200 cancel flaky (should be 409 for done, not 200)
      const has200Cancel = interactions.some((it) => (it.request?.method ?? "").toUpperCase() === "POST" && String(it.request?.path ?? "").includes("/cancel") && it.response?.status === 200);
      if (has200Cancel) {
        logWarn(`Pact ${featureId} (${file}) tiene POST /cancel → 200 — F12 solo debe tener 409/404, no 200 (F04 ya cubre 200 success)`);
        warnings++;
      }
    } else if (featureId === "F13") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (POST 201 escaped + GET 200 escaped persistencia) — F13 JSON escaping con backslashes y emoji`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (POST 201 escaped + GET 200 persistencia escaped)`);
      }
      // Debe tener POST 201 con prompt escaped y GET 200 con prompt escaped idéntico
      const hasPost201Escaped = interactions.some((it) => {
        if ((it.request?.method ?? "").toUpperCase() !== "POST" || it.response?.status !== 201) return false;
        const reqBody = it.request?.body ?? {};
        const resBody = it.response?.body ?? {};
        const reqStr = JSON.stringify(reqBody);
        const resStr = JSON.stringify(resBody);
        const hasEscapedReq = reqStr.includes("He said") && reqStr.includes("hola") && reqStr.includes("😀") && (reqStr.includes("\\tmp") || reqStr.includes("\\\\tmp"));
        const hasEscapedRes = resStr.includes("He said") && (resStr.includes("hola") || resStr.includes("He said"));
        return hasEscapedReq || hasEscapedRes;
      });
      const hasGet200Escaped = interactions.some((it) => {
        if ((it.request?.method ?? "").toUpperCase() !== "GET" || it.response?.status !== 200) return false;
        const resBody = it.response?.body ?? {};
        const reqPath = typeof it.request?.path === "string" ? it.request.path : "";
        const resStr = JSON.stringify(resBody);
        const hasEscaped = resStr.includes("He said") && resStr.includes("hola") && resStr.includes("😀");
        const isJobF13 = reqPath.includes("job-f13-escape01");
        return hasEscaped && isJobF13;
      });
      if (!hasPost201Escaped) {
        logError(`Pact ${featureId} (${file}) no tiene interacción POST /factory/jobs → 201 con prompt escaped "He said \\"hola\\" ... 😀" + backslash — F13 debe validar POST con escaping correcto`);
        errors++;
      }
      if (!hasGet200Escaped) {
        logError(`Pact ${featureId} (${file}) no tiene interacción GET /factory/jobs/job-f13-escape01 → 200 con prompt escaped (He said.*hola.*😀) — F13 debe validar persistencia GET devuelve prompt escaped idéntico`);
        errors++;
      }
      // Extra: ambas bodies deben contener prompt escaped y worktree, validar headers plain y no mojibake
      const post201 = interactions.find((it) => (it.request?.method ?? "").toUpperCase() === "POST" && it.response?.status === 201);
      if (post201) {
        const resBody = post201.response?.body ?? {};
        const resStr = JSON.stringify(resBody);
        const reqBody = post201.request?.body ?? {};
        const reqStr = JSON.stringify(reqBody);
        if (!resStr.includes("queued")) {
          logError(`Pact ${featureId} (${file}) POST 201 body no contiene 'queued' — job debe estar queued tras POST escaped`);
          errors++;
        }
        if (!resStr.includes("He said") || !resStr.includes("hola")) {
          logError(`Pact ${featureId} (${file}) POST 201 body no contiene prompt escaped 'He said'/'hola' — debe validar job.prompt escaped`);
          errors++;
        }
        if (!resStr.includes("playground-F13-escape")) {
          logError(`Pact ${featureId} (${file}) POST 201 body no contiene worktree 'playground-F13-escape' — debe validar worktree escaped`);
          errors++;
        }
        if (!resStr.includes("\\.agents\\\\factory") && !resStr.includes("playground-F13-escape")) {
          logWarn(`Pact ${featureId} (${file}) POST 201 body no contiene dir Windows regex (\\.agents\\\\factory) — revisar path`);
          warnings++;
        }
        if (!reqStr.includes("He said") || !reqStr.includes("hola") || !reqStr.includes("😀")) {
          logWarn(`Pact ${featureId} (${file}) POST request body no contiene prompt escaped completo (He said, hola, 😀, backslash) — revisar matcher like("He said \\"hola\\" ...")`);
          warnings++;
        }
        if (!reqStr.includes("C:\\\\tmp") && !reqStr.includes("playground-F13-escape")) {
          logWarn(`Pact ${featureId} (${file}) POST request worktree no contiene Windows path C:\\tmp\\playground-F13-escape — debe ser Windows path`);
          warnings++;
        }
        if (reqStr.includes("Ã") || resStr.includes("Ã")) {
          logError(`Pact ${featureId} (${file}) POST pact contiene mojibake Ã — pact debe ser UTF-8 sin mojibake, verificar file encoding utf-8`);
          errors++;
        }
        // Check that pact JSON actually contains escaped characters correctly: should have \" and \\ and \n and emoji
        const rawPostStr = JSON.stringify(post201);
        if (!rawPostStr.includes("😀") || !rawPostStr.includes("He said")) {
          logWarn(`Pact ${featureId} (${file}) POST raw no contiene 😀 o He said — revisar que pact JSON preserve escaping UTF-8`);
          warnings++;
        }
      }
      const get200 = interactions.find((it) => (it.request?.method ?? "").toUpperCase() === "GET" && it.response?.status === 200);
      if (get200) {
        const resBody = get200.response?.body ?? {};
        const resStr = JSON.stringify(resBody);
        const rawStr = JSON.stringify(get200);
        if (!resStr.includes("He said") || !resStr.includes("hola") || !resStr.includes("😀")) {
          logError(`Pact ${featureId} (${file}) GET 200 body no contiene prompt escaped 'He said'/'hola'/'😀' — debe validar prompt escaped persistido`);
          errors++;
        }
        if (!resStr.includes("playground-F13-escape")) {
          logError(`Pact ${featureId} (${file}) GET 200 body no contiene worktree 'playground-F13-escape' — debe validar worktree escaped persistido`);
          errors++;
        }
        if (!rawStr.includes("queued|running|done|error") && !resStr.includes("state")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no contiene state regex queued|running|done|error — revisar matcher`);
          warnings++;
        }
        if (!resStr.includes("logs") && !rawStr.includes("logs")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no contiene 'logs' — debe ser type logs array`);
          warnings++;
        }
        if (!resStr.includes("job-f13-escape01") && !rawStr.includes("job-f13-escape01")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body/id no contiene 'job-f13-escape01' — debe ser regex ^job-f13-escape01$`);
          warnings++;
        }
        const reqPath = typeof get200.request?.path === "string" ? get200.request.path : "";
        if (!reqPath.includes("job-f13-escape01")) {
          logError(`Pact ${featureId} (${file}) GET 200 path no contiene 'job-f13-escape01' — esperado /factory/jobs/job-f13-escape01`);
          errors++;
        }
        if (resStr.includes("Ã") || rawStr.includes("Ã")) {
          logError(`Pact ${featureId} (${file}) GET pact contiene mojibake Ã — debe ser UTF-8 sin mojibake`);
          errors++;
        }
        if (!resStr.includes("\\n") && !resStr.includes("He said")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no parece contener prompt con salto de línea \\n — revisar escaped prompt con \\n`);
          warnings++;
        }
        // Ensure prompt contains backslash and quote in pact JSON (escaped)
        if (!rawStr.includes("\\tmp") && !rawStr.includes("\\\\tmp")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 raw no contiene backslash \\\\tmp — pact debe preservar backslashes Windows`);
          warnings++;
        }
      }
      // Ensure pact JSON contains both 201 and 200
      const statuses = interactions.map((it) => it.response?.status);
      if (!statuses.includes(201) || !statuses.includes(200)) {
        logError(`Pact ${featureId} (${file}) no contiene ambos status 201 y 200 — F13 debe tener POST 201 y GET 200`);
        errors++;
      }
    } else if (featureId === "F14") {
      if (count !== 2) {
        logError(`Pact ${featureId} (${file}) tiene ${count} interactions, se esperan 2 (POST 201 markdown + GET 200 markdown persistencia) — F14 markdown con code fence y backticks`);
        errors++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene 2 interactions OK (POST 201 markdown + GET 200 persistencia markdown)`);
      }
      // Debe tener POST 201 con prompt markdown fences y GET 200 con prompt markdown idéntico
      const hasPost201Markdown = interactions.some((it) => {
        if ((it.request?.method ?? "").toUpperCase() !== "POST" || it.response?.status !== 201) return false;
        const reqBody = it.request?.body ?? {};
        const resBody = it.response?.body ?? {};
        const reqStr = JSON.stringify(reqBody);
        const resStr = JSON.stringify(resBody);
        const hasMarkdownReq = reqStr.includes("```js") && reqStr.includes("console.log") && reqStr.includes("`code`") && reqStr.includes("→");
        const hasMarkdownRes = resStr.includes("```js") && (resStr.includes("console.log") || resStr.includes("```js"));
        return hasMarkdownReq || hasMarkdownRes;
      });
      const hasGet200Markdown = interactions.some((it) => {
        if ((it.request?.method ?? "").toUpperCase() !== "GET" || it.response?.status !== 200) return false;
        const resBody = it.response?.body ?? {};
        const reqPath = typeof it.request?.path === "string" ? it.request.path : "";
        const resStr = JSON.stringify(resBody);
        const hasMarkdown = resStr.includes("```js") && resStr.includes("console.log") && resStr.includes("```") && resStr.includes("`code`") && resStr.includes("→");
        const isJobF14 = reqPath.includes("job-f14-md01");
        return hasMarkdown && isJobF14;
      });
      if (!hasPost201Markdown) {
        logError(`Pact ${featureId} (${file}) no tiene interacción POST /factory/jobs → 201 con prompt markdown "\`\`\`js ... console.log ... \`\`\` ... \`code\` y →" — F14 debe validar POST con fences correctos`);
        errors++;
      }
      if (!hasGet200Markdown) {
        logError(`Pact ${featureId} (${file}) no tiene interacción GET /factory/jobs/job-f14-md01 → 200 con prompt markdown (\`\`\`js.*console\\.log.*\`\`\`) — F14 debe validar persistencia GET devuelve prompt markdown idéntico`);
        errors++;
      }
      // Extra: ambas bodies deben contener prompt markdown y worktree, validar headers plain y no mojibake ni truncamiento
      const post201 = interactions.find((it) => (it.request?.method ?? "").toUpperCase() === "POST" && it.response?.status === 201);
      if (post201) {
        const resBody = post201.response?.body ?? {};
        const resStr = JSON.stringify(resBody);
        const reqBody = post201.request?.body ?? {};
        const reqStr = JSON.stringify(reqBody);
        if (!resStr.includes("queued")) {
          logError(`Pact ${featureId} (${file}) POST 201 body no contiene 'queued' — job debe estar queued tras POST markdown`);
          errors++;
        }
        if (!resStr.includes("```js") || !resStr.includes("```")) {
          logError(`Pact ${featureId} (${file}) POST 201 body no contiene prompt markdown '\`\`\`js'/'\`\`\`' — debe validar job.prompt markdown fences`);
          errors++;
        }
        if (!resStr.includes("playground-F14-markdown")) {
          logError(`Pact ${featureId} (${file}) POST 201 body no contiene worktree 'playground-F14-markdown' — debe validar worktree markdown`);
          errors++;
        }
        if (!resStr.includes("\\.agents\\\\factory") && !resStr.includes("playground-F14-markdown")) {
          logWarn(`Pact ${featureId} (${file}) POST 201 body no contiene dir Windows regex (\\.agents\\\\factory) — revisar path`);
          warnings++;
        }
        if (!reqStr.includes("```js") || !reqStr.includes("console.log") || !reqStr.includes("`code`") || !reqStr.includes("→")) {
          logWarn(`Pact ${featureId} (${file}) POST request body no contiene prompt markdown completo (\`\`\`js, console.log, \`code\`, →) — revisar matcher like("...")`);
          warnings++;
        }
        if (!reqStr.includes("C:\\\\tmp") && !reqStr.includes("playground-F14-markdown")) {
          logWarn(`Pact ${featureId} (${file}) POST request worktree no contiene Windows path C:\\tmp\\playground-F14-markdown — debe ser Windows path`);
          warnings++;
        }
        if (reqStr.includes("Ã") || resStr.includes("Ã")) {
          logError(`Pact ${featureId} (${file}) POST pact contiene mojibake Ã — pact debe ser UTF-8 sin mojibake`);
          errors++;
        }
        // Check fences not truncated: should contain both fences and newline
        const rawPostStr = JSON.stringify(post201);
        if (!rawPostStr.includes("```js") || !rawPostStr.includes("console.log")) {
          logWarn(`Pact ${featureId} (${file}) POST raw no contiene \`\`\`js o console.log — revisar que pact JSON preserve fences markdown`);
          warnings++;
        }
        if (!rawPostStr.includes("\\n") && !rawPostStr.includes("console.log")) {
          logWarn(`Pact ${featureId} (${file}) POST raw no contiene \\n — prompt markdown debe tener saltos de línea`);
          warnings++;
        }
      }
      const get200 = interactions.find((it) => (it.request?.method ?? "").toUpperCase() === "GET" && it.response?.status === 200);
      if (get200) {
        const resBody = get200.response?.body ?? {};
        const resStr = JSON.stringify(resBody);
        const rawStr = JSON.stringify(get200);
        if (!resStr.includes("```js") || !resStr.includes("console.log") || !resStr.includes("```") || !resStr.includes("`code`")) {
          logError(`Pact ${featureId} (${file}) GET 200 body no contiene prompt markdown '\`\`\`js'/'\`\`\`'/'\`code\`' — debe validar prompt markdown persistido`);
          errors++;
        }
        if (!resStr.includes("playground-F14-markdown")) {
          logError(`Pact ${featureId} (${file}) GET 200 body no contiene worktree 'playground-F14-markdown' — debe validar worktree markdown persistido`);
          errors++;
        }
        if (!rawStr.includes("queued|running|done|error") && !resStr.includes("state")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no contiene state regex queued|running|done|error — revisar matcher`);
          warnings++;
        }
        if (!resStr.includes("logs") && !rawStr.includes("logs")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no contiene 'logs' — debe ser type logs array`);
          warnings++;
        }
        if (!resStr.includes("job-f14-md01") && !rawStr.includes("job-f14-md01")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body/id no contiene 'job-f14-md01' — debe ser regex ^job-f14-md01$`);
          warnings++;
        }
        const reqPath = typeof get200.request?.path === "string" ? get200.request.path : "";
        if (!reqPath.includes("job-f14-md01")) {
          logError(`Pact ${featureId} (${file}) GET 200 path no contiene 'job-f14-md01' — esperado /factory/jobs/job-f14-md01`);
          errors++;
        }
        if (resStr.includes("Ã") || rawStr.includes("Ã")) {
          logError(`Pact ${featureId} (${file}) GET pact contiene mojibake Ã — debe ser UTF-8 sin mojibake`);
          errors++;
        }
        if (!resStr.includes("\\n") && !rawStr.includes("\\n")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 body no parece contener prompt con salto de línea \\n — revisar markdown prompt con \\n`);
          warnings++;
        }
        // Ensure prompt contains backticks and fences: pact JSON should have ``` counts
        const fenceMatches = (rawStr.match(/```/g) || []).length;
        if (fenceMatches < 2) {
          logWarn(`Pact ${featureId} (${file}) GET 200 raw fence count ${fenceMatches} <2 — pact debe preservar ambos fences \`\`\``);
          warnings++;
        }
        if (!rawStr.includes("`code`")) {
          logWarn(`Pact ${featureId} (${file}) GET 200 raw no contiene \`code\` — pact debe preservar backticks inline`);
          warnings++;
        }
      }
      // Ensure pact JSON contains both 201 and 200
      const statuses = interactions.map((it) => it.response?.status);
      if (!statuses.includes(201) || !statuses.includes(200)) {
        logError(`Pact ${featureId} (${file}) no contiene ambos status 201 y 200 — F14 debe tener POST 201 y GET 200`);
        errors++;
      }
    } else {
      // Unknown F: generic check
      if (count > 1) {
        logWarn(`Pact ${featureId} (${file}) tiene ${count} interactions — revisar regla para ${featureId}`);
        warnings++;
      } else {
        logOk(`Pact ${featureId} (${file}) tiene ${count} interaction(s) OK`);
      }
    }

    // Validate each interaction headers plain and path
    for (let i = 0; i < interactions.length; i++) {
      const inter = interactions[i];
      const req = inter.request ?? {};
      const res = inter.response ?? {};
      const reqHeaders = req.headers ?? {};
      const resHeaders = res.headers ?? {};

      // Headers plain: valores deben ser strings simples, no matcher objects
      for (const [k, v] of Object.entries(reqHeaders)) {
        if (typeof v !== "string") {
          logError(`Pact ${featureId} (${file}) interaction ${i} request.header ${k} no es plain string: ${JSON.stringify(v)} — headers deben ser plain (ver § linter)`);
          errors++;
        } else if (v.includes("application/json;?.*") || v.includes("regex")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} request.header ${k}="${v}" contiene regex — debe ser plain "application/json" o "text/event-stream"`);
          errors++;
        }
      }
      for (const [k, v] of Object.entries(resHeaders)) {
        if (typeof v !== "string") {
          logError(`Pact ${featureId} (${file}) interaction ${i} response.header ${k} no es plain: ${JSON.stringify(v)}`);
          errors++;
        } else if (v.includes("application/json;?.*")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} response.header ${k}="${v}" contiene regex — debe ser plain`);
          errors++;
        }
      }

      // Path isolation: F01 should only be /factory/health
      const reqPath = typeof req.path === "string" ? req.path : "";
      if (featureId === "F01" && reqPath !== "/factory/health") {
        // Could be regex path for F03, but F01 must be exact
        if (reqPath !== "/factory/health") {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es "/factory/health" — F01 solo health`);
          errors++;
        }
      }
      if (featureId === "F02" && reqPath !== "/factory/jobs") {
        logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es "/factory/jobs" — F02 solo POST /jobs`);
        errors++;
      }
      // F03: check allowed patterns
      if (featureId === "F03") {
        const allowedF03 = ["/factory/jobs/job-", "/factory/jobs", "/events"];
        const matchesAllowed = allowedF03.some((p) => reqPath.includes(p) || (req.matchingRules?.path));
        if (!matchesAllowed && !reqPath.includes("/factory/jobs")) {
          logWarn(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no parece F03 (esperado /factory/jobs/:id o /events)`);
          warnings++;
        }
      }
      // F04: should be GET /factory/jobs (lista panel) — allow /factory/jobs and /factory/jobs/:id variants
      if (featureId === "F04") {
        const allowedF04 = ["/factory/jobs"];
        const matchesAllowed = allowedF04.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs — F04 solo lista panel`);
          errors++;
        }
        // F04 must NOT use POST /factory/jobs with body prompt (that's F02) — warn if contains prompt
        // but GET list is fine
      }
      // F05: gate — solo POST /factory/jobs con modelRef, no health/events/cancel/logs
      if (featureId === "F05") {
        const allowedF05 = ["/factory/jobs"];
        const matchesAllowed = allowedF05.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs — F05 solo POST /jobs gate`);
          errors++;
        }
        if (reqPath.includes("/events") || reqPath.includes("/cancel") || reqPath.includes("/logs") || reqPath === "/factory/health") {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" usa endpoint prohibido para F05 (no health/events/cancel/logs)`);
          errors++;
        }
      }
      // F06: logs — GET /factory/jobs/:id/logs + GET /factory/jobs/:id (dedicado y preview)
      if (featureId === "F06") {
        const allowedF06 = ["/factory/jobs"];
        const matchesAllowed = allowedF06.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs — F06 solo logs endpoints`);
          errors++;
        }
        if (reqPath.includes("/events") || reqPath.includes("/cancel") || reqPath === "/factory/health") {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" usa endpoint prohibido para F06 (no health/events/cancel)`);
          errors++;
        }
        // Must be either /logs or plain /factory/jobs/:id, no other weird paths
        const isLogs = reqPath.includes("/logs");
        const isJob = reqPath.includes("/factory/jobs/job-");
        if (!isLogs && !isJob) {
          logWarn(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no parece F06 (esperado /logs o /factory/jobs/:id)`);
          warnings++;
        }
      }
      // F07: DX 400/404 — POST /factory/jobs sin prompt → 400 + GET /factory/jobs/job-notexist-99 → 404
      if (featureId === "F07") {
        const allowedF07 = ["/factory/jobs"];
        const matchesAllowed = allowedF07.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs — F07 solo 400/404 endpoints`);
          errors++;
        }
        if (reqPath === "/factory/health" || reqPath.includes("/events") || reqPath.includes("/cancel") || reqPath.includes("/logs")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" usa endpoint prohibido para F07 (no health/events/cancel/logs — solo /jobs y /jobs/:id 404)`);
          errors++;
        }
        const method = (req.method ?? "GET").toUpperCase();
        const isPost400 = method === "POST" && reqPath === "/factory/jobs";
        const isGet404 = method === "GET" && reqPath.includes("/factory/jobs/job-");
        if (!isPost400 && !isGet404) {
          logWarn(`Pact ${featureId} (${file}) interaction ${i} ${method} ${reqPath} no parece F07 (esperado POST /factory/jobs →400 o GET /factory/jobs/job-notexist-99 →404)`);
          warnings++;
        }
      }
      // F08: cola y concurrencia — GET /factory/jobs con jobs min:2 + GET /factory/health con queue
      if (featureId === "F08") {
        const allowedF08 = ["/factory/jobs", "/factory/health"];
        const matchesAllowed = allowedF08.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs ni /factory/health — F08 solo cola y health`);
          errors++;
        }
        if (reqPath.includes("/events") || reqPath.includes("/cancel") || reqPath.includes("/logs")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" usa endpoint prohibido para F08 (no events/cancel/logs — solo /jobs y /health)`);
          errors++;
        }
        const method = (req.method ?? "GET").toUpperCase();
        const isGetJobs = method === "GET" && reqPath === "/factory/jobs";
        const isGetHealth = method === "GET" && reqPath === "/factory/health";
        if (!isGetJobs && !isGetHealth) {
          logWarn(`Pact ${featureId} (${file}) interaction ${i} ${method} ${reqPath} no parece F08 (esperado GET /factory/jobs →200 con jobs min:2 o GET /factory/health →200 con queue)`);
          warnings++;
        }
      }
      // F09: robustez — POST /factory/jobs con body malformado →400 + GET /factory/jobs/job-zzz-invalid99 →404
      if (featureId === "F09") {
        const allowedF09 = ["/factory/jobs"];
        const matchesAllowed = allowedF09.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs — F09 solo robustez endpoints`);
          errors++;
        }
        if (reqPath === "/factory/health" || reqPath.includes("/events") || reqPath.includes("/cancel") || reqPath.includes("/logs")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" usa endpoint prohibido para F09 (no health/events/cancel/logs — solo /jobs y /jobs/:id 404)`);
          errors++;
        }
        const method = (req.method ?? "GET").toUpperCase();
        const isPost400 = method === "POST" && reqPath === "/factory/jobs";
        const isGet404 = method === "GET" && reqPath.includes("/factory/jobs/job-");
        if (!isPost400 && !isGet404) {
          logWarn(`Pact ${featureId} (${file}) interaction ${i} ${method} ${reqPath} no parece F09 (esperado POST /factory/jobs →400 body must be valid JSON o GET /factory/jobs/job-zzz-invalid99 →404)`);
          warnings++;
        }
      }
      // F10: prompt largo — POST /factory/jobs con prompt large →201 + GET /factory/jobs/job-f10-large01 →200 persistencia
      if (featureId === "F10") {
        const allowedF10 = ["/factory/jobs"];
        const matchesAllowed = allowedF10.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs — F10 solo prompt largo endpoints`);
          errors++;
        }
        if (reqPath === "/factory/health" || reqPath.includes("/events") || reqPath.includes("/cancel") || (reqPath.includes("/logs") && !reqPath.includes("job-"))) {
          // /logs endpoint not allowed for F10 (only /factory/jobs and /factory/jobs/:id via GET, not /logs)
          // But allow GET /jobs/:id logs array is body field, not path
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" usa endpoint prohibido para F10 (no health/events/cancel/logs endpoint — solo /jobs y /jobs/:id)`);
          errors++;
        }
        const method = (req.method ?? "GET").toUpperCase();
        const isPost201 = method === "POST" && reqPath === "/factory/jobs";
        const isGet200 = method === "GET" && reqPath.includes("/factory/jobs/job-f10-large01");
        if (!isPost201 && !isGet200) {
          logWarn(`Pact ${featureId} (${file}) interaction ${i} ${method} ${reqPath} no parece F10 (esperado POST /factory/jobs →201 prompt large o GET /factory/jobs/job-f10-large01 →200 persistencia)`);
          warnings++;
        }
      }
      // F11: unicode y espacio — POST /factory/jobs con unicode →201 + GET /factory/jobs/job-f11-unicode01 →200 persistencia unicode sin mojibake
      if (featureId === "F11") {
        const allowedF11 = ["/factory/jobs"];
        const matchesAllowed = allowedF11.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs — F11 solo unicode/space endpoints`);
          errors++;
        }
        if (reqPath === "/factory/health" || reqPath.includes("/events") || reqPath.includes("/cancel") || (reqPath.includes("/logs") && !reqPath.includes("job-"))) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" usa endpoint prohibido para F11 (no health/events/cancel/logs endpoint — solo /jobs y /jobs/:id)`);
          errors++;
        }
        const method = (req.method ?? "GET").toUpperCase();
        const isPost201 = method === "POST" && reqPath === "/factory/jobs";
        const isGet200 = method === "GET" && reqPath.includes("/factory/jobs/job-f11-unicode01");
        if (!isPost201 && !isGet200) {
          logWarn(`Pact ${featureId} (${file}) interaction ${i} ${method} ${reqPath} no parece F11 (esperado POST /factory/jobs →201 unicode + GET /factory/jobs/job-f11-unicode01 →200 persistencia)`);
          warnings++;
        }
        // Extra: validar que consumer spec no menciona health/events/cancel (R1 aislamiento) — ya chequeado arriba, pero validar contenido raw
        const rawInterStr = JSON.stringify(inter);
        if (rawInterStr.includes("/factory/health") || rawInterStr.includes("/events") || rawInterStr.includes("/cancel")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} menciona endpoint prohibido health/events/cancel — F11 no debe mencionar health/events/cancel (solo /factory/jobs)`);
          errors++;
        }
        if (rawInterStr.includes("Ã") || rawInterStr.includes("Ã³")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} contiene mojibake Ã — debe ser UTF-8 puro con ñ, →, ó, í`);
          errors++;
        }
      }
      // F12: cancel errores — POST /factory/jobs/job-f12-done01/cancel →409 + POST /factory/jobs/job-notexist-99/cancel →404
      if (featureId === "F12") {
        const allowedF12 = ["/factory/jobs"];
        const matchesAllowed = allowedF12.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs — F12 solo cancel endpoints`);
          errors++;
        }
        if (reqPath === "/factory/health" || reqPath.includes("/events") || reqPath.includes("/logs")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" usa endpoint prohibido para F12 (no health/events/logs — solo /jobs/:id/cancel)`);
          errors++;
        }
        if (!reqPath.includes("/cancel")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no contiene /cancel — F12 todas deben ser POST /factory/jobs/:id/cancel`);
          errors++;
        }
        const method = (req.method ?? "GET").toUpperCase();
        const isPostCancel = method === "POST" && reqPath.includes("/cancel");
        if (!isPostCancel) {
          logWarn(`Pact ${featureId} (${file}) interaction ${i} ${method} ${reqPath} no parece F12 (esperado POST /factory/jobs/:id/cancel →409/404)`);
          warnings++;
        }
        // Validate body error patterns via raw JSON
        const rawStrF12 = JSON.stringify(inter);
        if (inter.response?.status === 409 && !rawStrF12.includes("already")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} 409 body no contiene "already (done|error)" — F12 409 debe ser already done/error`);
          errors++;
        }
        if (inter.response?.status === 404 && !rawStrF12.includes("job not found")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} 404 body no contiene "job not found" — F12 404 debe ser job not found`);
          errors++;
        }
        // Ensure headers plain already checked above, but also check body not empty for errors
        if (inter.response?.status === 409 || inter.response?.status === 404) {
          const bodyStr = JSON.stringify(inter.response?.body ?? {});
          if (!bodyStr.includes("error")) {
            logError(`Pact ${featureId} (${file}) interaction ${i} body no contiene "error" — F12 debe devolver {error: ...}`);
            errors++;
          }
        }
        // Check providerState isolation: should not mention health/events/logs in any inter
        if (rawStrF12.includes("/factory/health") || rawStrF12.includes("/events") || rawStrF12.includes("/logs")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} menciona endpoint prohibido health/events/logs — F12 aislamiento falla`);
          errors++;
        }
      }
      // F13: JSON escaping — POST /factory/jobs con escaped →201 + GET /factory/jobs/job-f13-escape01 →200 persistencia escaped sin mojibake
      if (featureId === "F13") {
        const allowedF13 = ["/factory/jobs"];
        const matchesAllowed = allowedF13.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs — F13 solo escaping endpoints`);
          errors++;
        }
        if (reqPath === "/factory/health" || reqPath.includes("/events") || reqPath.includes("/cancel") || (reqPath.includes("/logs") && !reqPath.includes("job-"))) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" usa endpoint prohibido para F13 (no health/events/cancel/logs endpoint — solo /jobs y /jobs/:id)`);
          errors++;
        }
        const method = (req.method ?? "GET").toUpperCase();
        const isPost201 = method === "POST" && reqPath === "/factory/jobs";
        const isGet200 = method === "GET" && reqPath.includes("/factory/jobs/job-f13-escape01");
        if (!isPost201 && !isGet200) {
          logWarn(`Pact ${featureId} (${file}) interaction ${i} ${method} ${reqPath} no parece F13 (esperado POST /factory/jobs →201 escaped + GET /factory/jobs/job-f13-escape01 →200 persistencia)`);
          warnings++;
        }
        const rawInterStr = JSON.stringify(inter);
        if (rawInterStr.includes("/factory/health") || rawInterStr.includes("/events") || rawInterStr.includes("/cancel")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} menciona endpoint prohibido health/events/cancel — F13 no debe mencionar health/events/cancel (solo /factory/jobs)`);
          errors++;
        }
        if (rawInterStr.includes("Ã") || rawInterStr.includes("Ã³")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} contiene mojibake Ã — debe ser UTF-8 puro con He said "hola" y 😀 y \\tmp`);
          errors++;
        }
        // Ensure escaping: request/response should contain He said and 😀 and backslash
        if (inter.response?.status === 201 || inter.request?.method?.toUpperCase() === "POST") {
          const combined = JSON.stringify(inter.request?.body ?? {}) + JSON.stringify(inter.response?.body ?? {});
          if (!combined.includes("He said") || !combined.includes("😀")) {
            logWarn(`Pact ${featureId} (${file}) interaction ${i} no contiene He said y 😀 — F13 debe preservar escaping con comillas y emoji`);
            warnings++;
          }
        }
        if (inter.response?.status === 200 && (inter.request?.method ?? "").toUpperCase() === "GET") {
          const resStr = JSON.stringify(inter.response?.body ?? {});
          if (!resStr.includes("He said") || !resStr.includes("😀") || !resStr.includes("playground-F13-escape")) {
            logWarn(`Pact ${featureId} (${file}) interaction ${i} GET 200 no contiene prompt escaped y worktree — revisar`);
            warnings++;
          }
        }
      }
      // F14: markdown fences — POST /factory/jobs con markdown →201 + GET /factory/jobs/job-f14-md01 →200 persistencia markdown sin mojibake ni truncamiento
      if (featureId === "F14") {
        const allowedF14 = ["/factory/jobs"];
        const matchesAllowed = allowedF14.some((p) => reqPath.includes(p));
        if (!matchesAllowed) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" no es /factory/jobs — F14 solo markdown endpoints`);
          errors++;
        }
        if (reqPath === "/factory/health" || reqPath.includes("/events") || reqPath.includes("/cancel") || (reqPath.includes("/logs") && !reqPath.includes("job-"))) {
          logError(`Pact ${featureId} (${file}) interaction ${i} path="${reqPath}" usa endpoint prohibido para F14 (no health/events/cancel/logs endpoint — solo /jobs y /jobs/:id)`);
          errors++;
        }
        const method = (req.method ?? "GET").toUpperCase();
        const isPost201 = method === "POST" && reqPath === "/factory/jobs";
        const isGet200 = method === "GET" && reqPath.includes("/factory/jobs/job-f14-md01");
        if (!isPost201 && !isGet200) {
          logWarn(`Pact ${featureId} (${file}) interaction ${i} ${method} ${reqPath} no parece F14 (esperado POST /factory/jobs →201 markdown + GET /factory/jobs/job-f14-md01 →200 persistencia)`);
          warnings++;
        }
        const rawInterStr = JSON.stringify(inter);
        if (rawInterStr.includes("/factory/health") || rawInterStr.includes("/events") || rawInterStr.includes("/cancel")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} menciona endpoint prohibido health/events/cancel — F14 no debe mencionar health/events/cancel (solo /factory/jobs)`);
          errors++;
        }
        if (rawInterStr.includes("Ã") || rawInterStr.includes("Ã³")) {
          logError(`Pact ${featureId} (${file}) interaction ${i} contiene mojibake Ã — debe ser UTF-8 puro con \`\`\`js y \`code\` y →`);
          errors++;
        }
        // Ensure fences: request/response should contain ```js and ``` and `code` and →
        if (inter.response?.status === 201 || inter.request?.method?.toUpperCase() === "POST") {
          const combined = JSON.stringify(inter.request?.body ?? {}) + JSON.stringify(inter.response?.body ?? {});
          if (!combined.includes("```js") || !combined.includes("console.log") || !combined.includes("```")) {
            logWarn(`Pact ${featureId} (${file}) interaction ${i} no contiene \`\`\`js y console.log y \`\`\` — F14 debe preservar fences markdown`);
            warnings++;
          }
          if (!combined.includes("`code`") || !combined.includes("→")) {
            logWarn(`Pact ${featureId} (${file}) interaction ${i} no contiene \`code\` y → — F14 debe preservar backticks inline y flecha`);
            warnings++;
          }
        }
        if (inter.response?.status === 200 && (inter.request?.method ?? "").toUpperCase() === "GET") {
          const resStr = JSON.stringify(inter.response?.body ?? {});
          if (!resStr.includes("```js") || !resStr.includes("```") || !resStr.includes("`code`") || !resStr.includes("playground-F14-markdown")) {
            logWarn(`Pact ${featureId} (${file}) interaction ${i} GET 200 no contiene prompt markdown fences y worktree — revisar`);
            warnings++;
          }
          if (!resStr.includes("console.log") || !resStr.includes("→")) {
            logWarn(`Pact ${featureId} (${file}) interaction ${i} GET 200 no contiene console.log y → — revisar markdown persistencia`);
            warnings++;
          }
          // Validate that pact preserves newlines
          if (!resStr.includes("\\n")) {
            logWarn(`Pact ${featureId} (${file}) interaction ${i} GET 200 no contiene \\n — prompt markdown debe tener saltos de línea`);
            warnings++;
          }
        }
      }

      // Log method+path for audit
      logOk(`Pact ${featureId} (${file}) interaction ${i}: ${req.method ?? "GET"} ${reqPath} → ${res.status ?? "?"}`);
    }

    // Also validate metadata pactSpecification version 3
    const specVersion = raw.metadata?.pactSpecification?.version;
    if (specVersion && !String(specVersion).startsWith("3")) {
      logWarn(`Pact ${featureId} (${file}) spec version ${specVersion} no es 3.x — esperado 3.0.0`);
      warnings++;
    }
  }
}

// 3. Cross-check criteria slim vs pact pointer (optional)
function lintCriteria() {
  const criteriaDir = path.join(ROOT, "software-testing-playground-v2", "criteria");
  if (!fs.existsSync(criteriaDir)) {
    logWarn(`Criteria dir no existe: ${criteriaDir} — se creará en Ola 4`);
    warnings++;
    return;
  }
  const files = fs.readdirSync(criteriaDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const match = file.match(/(F\d{2})\.json/i);
    if (!match) continue;
    const featureId = match[1].toUpperCase();
    const full = path.join(criteriaDir, file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, "utf-8"));
    } catch (e) {
      logError(`Criteria ${featureId} (${file}) JSON inválido: ${String(e)}`);
      errors++;
      continue;
    }
    // Check pact pointer if present
    if (raw.pact) {
      const pactPath = path.isAbsolute(raw.pact) ? raw.pact : path.join(ROOT, raw.pact);
      if (!fs.existsSync(pactPath)) {
        logWarn(`Criteria ${featureId} apunta a pact ${raw.pact} que no existe — corre pnpm p:consumer`);
        warnings++;
      } else {
        logOk(`Criteria ${featureId} (${file}) pact pointer OK → ${raw.pact}`);
      }
    }
    // Check slim: should NOT have expected (old shape)
    if (raw.expected) {
      logWarn(`Criteria ${featureId} (${file}) aún tiene "expected" — con Pact debe ser slim (solo metadata + pact pointer)`);
      warnings++;
    }
  }
}

// Main
console.log("[lintPacts] Validando contratos Pact por F (Windows PowerShell) — architecture-pact-v2.md §8");
console.log(`[lintPacts] Consumer dir: ${CONSUMER_DIR}`);
console.log(`[lintPacts] Pacts dir: ${PACTS_DIR}`);
console.log("---");

lintConsumerSpecs();
console.log("---");
lintPactJson();
console.log("---");
lintCriteria();
console.log("---");
if (errors === 0) {
  console.log(`[lintPacts] PASS — ${warnings} warnings, 0 errors`);
  console.log("[lintPacts] PowerShell check:");
  console.log("  Get-ChildItem software-testing-playground-v2\\pacts\\ | Format-Table Name, Length");
  console.log("  node software-testing-playground-v2/pact/support/lintPacts.mjs");
  process.exit(0);
} else {
  console.error(`[lintPacts] FAIL — ${errors} errors, ${warnings} warnings`);
  console.error("[lintPacts] Corrige los errores arriba antes de mergear. Ver architecture-pact-v2.md §8 linter.");
  process.exit(1);
}
