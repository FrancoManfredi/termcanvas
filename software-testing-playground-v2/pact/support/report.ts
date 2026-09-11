#!/usr/bin/env tsx
/**
 * Report — genera docs/playground-report.md con tabla F01..F05
 *
 * Campos: feature | title | wave | pactStatus | pactFile | commitSha | verdictId | duration | updatedAt
 * Fuente: pactReader + pactState + pactVerdictStore + git
 *
 * Uso PowerShell:
 *   pnpm p:report --md                 # genera docs/playground-report.md
 *   pnpm p:report                      # solo stdout
 *   pnpm playground:report --md
 *   tsx software-testing-playground-v2/pact/support/report.ts --md
 *   tsx software-testing-playground-v2/pact/support/report.ts --json
 */

import fs from "node:fs";
import path from "node:path";
import { deriveAllStates } from "./pactState.js";
import { listPactContracts } from "./pactReader.js";
import { getCommitSha, isDirty } from "./git.js";

const OUT_MD = path.resolve("docs/playground-report.md");
const FEATURE_IDS = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09", "F10", "F11", "F12", "F13", "F14"] as const;

function parseArgs(): { md: boolean; json: boolean; outPath: string } {
  const args = process.argv.slice(2);
  const md = args.includes("--md") || args.includes("--markdown");
  const json = args.includes("--json");
  let outPath = OUT_MD;
  const outIdx = args.findIndex((a) => a === "--out" || a === "-o");
  if (outIdx !== -1 && args[outIdx + 1]) outPath = path.resolve(args[outIdx + 1]);
  const outEq = args.find((a) => a.startsWith("--out="));
  if (outEq) outPath = path.resolve(outEq.split("=")[1]);
  return { md, json, outPath };
}

function criteriaFor(featureId: string): Record<string, unknown> | null {
  const file = path.resolve(`software-testing-playground-v2/criteria/${featureId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildRows(): Array<{
  featureId: string;
  title: string;
  wave: string;
  pactStatus: string;
  pactExists: boolean;
  pactFile: string;
  commitSha: string;
  verdictId: string | null;
  verdictAt: string | null;
  durationMs: number | null;
  providerBaseUrl: string | null;
}> {
  const states = deriveAllStates([...FEATURE_IDS]);
  const pactsByF = new Map(listPactContracts().map((p) => [p.featureId, p] as const));
  const sha = getCommitSha();
  const dirty = isDirty();
  const commitSha = dirty ? `dirty-${sha.slice(0, 8)}` : sha.slice(0, 8);

  return FEATURE_IDS.map((fid) => {
    const state = states[fid];
    const pact = pactsByF.get(fid) ?? null;
    const criteria = criteriaFor(fid);
    const latest = state?.latestVerdict ?? null;
    return {
      featureId: fid,
      title: (criteria?.title as string | undefined) ?? (pact ? `${pact.consumer} pact` : "—"),
      wave: (criteria?.wave as string | undefined) ?? "—",
      pactStatus: state?.pactStatus ?? (pact ? "mock_only" : "not_generated"),
      pactExists: !!state?.pactExists,
      pactFile: pact?.pactFileRelative ?? `software-testing-playground-v2/pacts/playground-${fid}-FactoryProvider.json`,
      commitSha: (latest?.commitSha as string | undefined) ?? commitSha,
      verdictId: (latest?.id as string | undefined) ?? null,
      verdictAt: (latest?.finishedAt as string | undefined) ?? null,
      durationMs: (latest?.durationMs as number | undefined) ?? null,
      providerBaseUrl: (latest?.providerBaseUrl as string | undefined) ?? null,
    };
  });
}

function renderMarkdown(rows: ReturnType<typeof buildRows>): string {
  const now = new Date().toISOString();
  const sha = getCommitSha();
  const dirty = isDirty();

  const header = `# Playground Report — Pact v2

> Generado: ${now}
> Commit: \`${sha}\` ${dirty ? "(dirty — hay cambios sin commitear)" : ""}
> Fuente: \`software-testing-playground-v2/pacts/*.json\` + \`verdicts/Fxx/*.json\` + \`state.json\`
> Comandos PowerShell: \`pnpm p:consumer\` → \`pnpm p:verify\` → \`pnpm p:report --md\`

## Resumen F01..F14

| Feature | Título | Wave | Estado | Pact | Commit | Verdict | Duración | Actualizado |
|---------|--------|------|--------|------|--------|---------|----------|-------------|
`;

  const rowsMd = rows
    .map((r) => {
      const statusBadge =
        r.pactStatus === "verified"
          ? "✓ verified"
          : r.pactStatus === "mock_only"
            ? "⚠ mock_only"
            : r.pactStatus === "failed"
              ? "✗ failed"
              : "○ not_generated";
      const pactExistsStr = r.pactExists ? "✓" : "—";
      const verdictShort = r.verdictId ? `\`${r.verdictId.slice(0, 8)}…\`` : "—";
      const dur = r.durationMs !== null ? `${r.durationMs}ms` : "—";
      const at = r.verdictAt ? new Date(r.verdictAt).toLocaleString("es-UY") : "—";
      const pactFileShort = `\`${r.pactFile}\` ${pactExistsStr}`;
      return `| ${r.featureId} | ${r.title} | ${r.wave} | ${statusBadge} | ${pactFileShort} | \`${r.commitSha.slice(0, 8)}\` | ${verdictShort} | ${dur} | ${at} |`;
    })
    .join("\n");

  const legend = `
## Leyenda estados (architecture-pact-v2.md §2.5)

- **verified** (verde) — p:consumer ✓ + p:verify ✓ — desbloquea F dependientes
- **mock_only** (ámbar rayado \`⚠ MOCK PACT\`) — solo p:consumer ✓, sin p:verify — NO desbloquea
- **failed** (rojo) — p:verify ✗ — diff Expected vs Actual en VerdictDrawer
- **not_generated** (gris) — sin pact JSON — corre \`pnpm p:consumer\`

## Detalle por Feature

${rows
  .map(
    (r) => `### ${r.featureId} — ${r.title}
- **Wave:** ${r.wave}
- **Estado:** \`${r.pactStatus}\`
- **Pact:** \`${r.pactFile}\` ${r.pactExists ? "✓ existe" : "○ no generado (human slim)"}
- **Commit:** \`${r.commitSha}\`
- **Verdict:** ${r.verdictId ? `\`${r.verdictId}\`` : "—"} ${r.verdictAt ? `— ${r.verdictAt}` : ""}
- **Provider:** ${r.providerBaseUrl ?? "— (no verificado contra Factory real)"}
`,
  )
  .join("\n")}

## PowerShell — Verificación manual

\`\`\`powershell
# Ver pacts generados
Get-ChildItem software-testing-playground-v2\\pacts\\ | Format-Table Name, Length, LastWriteTime
Get-Content software-testing-playground-v2\\pacts\\playground-F01-FactoryProvider.json | ConvertFrom-Json | ConvertTo-Json -Depth 10

# Ver state derivado
Get-Content software-testing-playground-v2\\state.json | ConvertFrom-Json | ConvertTo-Json -Depth 8

# Ver verdicts
Get-ChildItem software-testing-playground-v2\\verdicts\\F01\\ | Sort-Object LastWriteTime -Descending | Select-Object -First 5
Get-Content software-testing-playground-v2\\verdicts\\F01\\*.json | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Select-Object -First 80

# GC dry-run
pnpm p:gc --dry-run
pnpm playground:gc --dry-run

# Report regenerar
pnpm p:report --md
Get-Content docs\\playground-report.md
\`\`\`

## Notas Ola 7

- F04 es **hybrid pact + human** — Pact valida \`GET /factory/jobs\` (lista panel) + \`POST /factory/jobs/:id/cancel\` (Ola Cancel 2 interactions), human valida filtros Queued/Running/Done + Ver logs tail vivo (ver \`verifiers/verify-F04.human.md\`)
- F05 es **pact gate** — Pact valida \`POST /factory/jobs\` gate: modelo válido (gpt-4o) → 201 queued vs inválido (gpt-99) → 400 \`{error:"model not in catalog", alternatives:[...]}\` fail fast (2 interactions, 201+400). Cero PTY, alternatives útiles (ver \`verifiers/verify-F05.human.md\` y \`pact/consumer/F05.consumer.spec.ts\`)
- F06 es **logs dedicado** — Pact valida \`GET /factory/jobs/:id/logs\` → 200 \`{id, logs}\` con \`eachLike("opencode: streaming")\` + \`GET /factory/jobs/:id\` → 200 con \`resultPreview\` valida \`result.json\`/\`logs.ndjson\` en disco tras done (2 interactions). Reusa job-abc123 de F03 (ver \`pact/consumer/F06.consumer.spec.ts\`)
- F07 es **DX 400/404** — Pact valida \`POST /factory/jobs\` sin prompt → 400 \`{error:"prompt is required", hint, received}\` + \`GET /factory/jobs/job-notexist-99\` → 404 \`{error:"job not found"}\` (2 interactions, DX crítico). Reusa \`factory is healthy\` + \`no job exists\` no-op (ver \`pact/consumer/F07.consumer.spec.ts\`)

## Notas Ola 8

- F08 es **cola y concurrencia básica** — Pact valida \`GET /factory/jobs\` → 200 \`{jobs: eachLike min:2}\` con \`id regex, phase type, state queued|running|done|error, dir Windows\` + \`GET /factory/health\` → 200 \`{queue:{pending:integer, running:integer}, uptime:integer, version like "local", ts regex ISO8601}\` (2 interactions). StateHandler "multiple jobs exist" crea 2 jobs si <2 (POST + 200ms), "factory is healthy after jobs" reuse health con providerState distinto (ver \`pact/consumer/F08.consumer.spec.ts\`). Cierra gap F02/F04 (solo 1 job).

## Notas Ola 9

- F09 es **robustez: body malformado y hint DX** — Pact valida \`POST /factory/jobs\` con body malformado \`text/plain "not-json"\` → 400 \`{error:"body must be valid JSON", hint, received}\` (cubre curl sin .exe — JSON malformado) + \`GET /factory/jobs/job-zzz-invalid99\` → 404 \`{error:"job not found"}\` (2 interactions). StateHandler "factory is healthy" reuse + "no job exists" con id job-zzz-invalid99 (ver \`pact/consumer/F09.consumer.spec.ts\`). Cierra gap F07 (solo cubría prompt missing, no JSON inválido).

## Notas Ola 10

- F10 es **prompt largo y persistencia** — Pact valida \`POST /factory/jobs\` con prompt \`a\`.repeat(1500) (regex ^a{1000,}$) → 201 queued (valida que Factory no trunca a 120 — solo resultPreview trunca) + \`GET /factory/jobs/job-f10-large01\` → 200 con prompt regex ^a{1000,}$ idéntico (persistencia, len 1500, state queued|running|done|error, logs type, dir Windows). StateHandler "a job with large prompt exists" asegura job con prompt large via POST id determinístico o fallback manual (ver \`pact/consumer/F10.consumer.spec.ts\`). Cierra gap >1K nunca probado.

## Notas Ola 11

- F11 es **unicode y espacio en worktree/prompt** — Pact valida \`POST /factory/jobs\` con prompt \`"línea1\\nlínea2 con ñ y → y tildes ó í"\` + worktree \`"C:\\\\tmp\\\\playground F11 ñ test"\` → 201 queued (path regex Windows con espacio y \\.agents\\factory, job.prompt regex "línea1") + \`GET /factory/jobs/job-f11-unicode01\` → 200 con prompt regex "línea1.*ñ" worktree regex "playground F11 ñ" idénticos sin mojibake (no Ã³). StateHandler "a job with unicode prompt exists" asegura job con prompt unicode via POST id determinístico o fallback manual utf-8 (prompt.md utf-8). Valida headers plain, worktree con espacio, saltos de línea \\n y unicode tildes. Cierra gap encoding submitHuman (ver \`pact/consumer/F11.consumer.spec.ts\`).

## Notas Ola 12

- F12 es **cancel errores 409/404** — Pact valida \`POST /factory/jobs/job-f12-done01/cancel\` sobre job ya done/error → 409 \`{error regex "already (done|error)"}\` (Given "a job that is done" con id job-f12-done01, handler deja job en done) + \`POST /factory/jobs/job-notexist-99/cancel\` sobre inexistente → 404 \`{error regex "job not found"}\` (Given "no job exists" reuse). Headers plain application/json body {}, Windows only. Complementa F04 (cancel 200) y cierra gap nunca probado POST cancel sobre done y sobre inexistente (ver \`pact/consumer/F12.consumer.spec.ts\` y factoryServer.ts ~596).

## Notas Ola 13

- F13 es **JSON escaping, backslashes y emoji** — Pact valida \`POST /factory/jobs\` con prompt \`"He said \\"hola\\" y path C:\\\\tmp\\\\a\\\\b\\nlínea con emoji 😀 y →"\` + worktree \`"C:\\\\tmp\\\\playground-F13-escape"\` → 201 queued (prompt regex "He said", path regex Windows, job.state queued, worktree regex playground-F13-escape) + \`GET /factory/jobs/job-f13-escape01\` → 200 con prompt regex "He said.*hola.*😀" worktree regex "playground-F13-escape" idénticos sin mojibake ni truncamiento (contains " y \\ y 😀 y \\n, no Ã). StateHandler "a job with escaped prompt exists" asegura job con prompt escaped via POST id determinístico o fallback manual utf-8 (prompt.md utf-8 con comillas/backslash/emoji). Valida headers plain, JSON escaping, backslashes Windows y emoji. Cierra gap curl.exe -d "{\\"prompt\\":\\"...\\"}" mal escapado (ver \`pact/consumer/F13.consumer.spec.ts\`).

## Notas Ola 14

- F14 es **markdown con code fence y backticks** — Pact valida \`POST /factory/jobs\` con prompt markdown \`"\\\`\\\`\\\`js\\nconsole.log(\\"hola\\")\\n\\\`\\\`\\\`\\nMarkdown con \\\`code\\\` y →"\` + worktree \`"C:\\\\tmp\\\\playground-F14-markdown"\` → 201 queued (prompt regex "\`\`\`js", path regex Windows, job.state queued, worktree regex playground-F14-markdown) + \`GET /factory/jobs/job-f14-md01\` → 200 con prompt regex "\`\`\`js.*console\\.log.*\`\`\`" ([\s\S]* s flag) worktree regex "playground-F14-markdown" idénticos sin mojibake ni truncamiento (contiene \`\`\`js y \`code\` y → y \\n, no Ã). StateHandler "a job with markdown prompt exists" asegura job con markdown prompt via POST id determinístico o fallback manual utf-8 (prompt.md utf-8 con fences/backticks). Valida headers plain, fences markdown, backticks y saltos. Cierra gap markdown con triple backtick nunca probado (ver \`pact/consumer/F14.consumer.spec.ts\`).
- \`p:ci\` pasa solo si F01-03 verified y F04-14 no están failed (mock_only/not_generated no bloquea, ver \`pact/support/ci.ts\`) — total 14 pacts, 26 interactions (F01 1 + F02 1 + F03 2 + F04 2 + F05 2 + F06 2 + F07 2 + F08 2 + F09 2 + F10 2 + F11 2 + F12 2 + F13 2 + F14 2)

---
*Generado por \`software-testing-playground-v2/pact/support/report.ts\` — no editar a mano, regenerar con \`pnpm p:report --md\`*
`;

  return header + rowsMd + legend;
}

function main(): void {
  const { md, json, outPath } = parseArgs();
  const rows = buildRows();

  if (json) {
    const payload = {
      generatedAt: new Date().toISOString(),
      commitSha: getCommitSha(),
      commitDirty: isDirty(),
      features: rows,
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    if (md) {
      // both --json and --md → write both
      console.log(jsonStr);
    } else {
      console.log(jsonStr);
    }
    if (md) {
      const mdStr = renderMarkdown(rows);
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, mdStr, "utf-8");
        console.log(`[report] Markdown escrito: ${outPath}`);
      } catch (e) {
        console.error(`[report] Failed to write ${outPath}: ${String(e)}`);
        process.exit(1);
      }
    }
    return;
  }

  if (md) {
    const mdStr = renderMarkdown(rows);
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, mdStr, "utf-8");
      console.log(`[report] ✓ docs/playground-report.md generado — ${rows.length} features — ${new Date().toISOString()}`);
      console.log(`[report] Archivo: ${outPath}`);
      // Also stdout summary
      for (const r of rows) {
        console.log(`[report] ${r.featureId}: ${r.pactStatus} — ${r.pactFile} — ${r.commitSha.slice(0, 8)} — ${r.verdictId ?? "no verdict"}`);
      }
    } catch (e) {
      console.error(`[report] Failed: ${String(e)}`);
      process.exit(1);
    }
  } else {
    // stdout table
    console.log("Feature | Status | Pact | Commit | Verdict");
    console.log("--------|--------|------|--------|--------");
    for (const r of rows) {
      console.log(`${r.featureId} | ${r.pactStatus} | ${r.pactFile} | ${r.commitSha.slice(0, 8)} | ${r.verdictId ?? "—"}`);
    }
    console.log("\nTip: pnpm p:report --md  → genera docs/playground-report.md");
  }
}

const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].replace(/\\/g, "/").endsWith("report.ts") ||
    process.argv[1].replace(/\\/g, "/").endsWith("report.js") ||
    process.argv[1].replace(/\\/g, "/").endsWith("report.mjs"));

if (isDirect) {
  main();
}

export { buildRows, renderMarkdown };
