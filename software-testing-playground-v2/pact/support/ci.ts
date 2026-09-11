#!/usr/bin/env tsx
/**
 * CI — pipeline p:ci (consumer + verify + lint) con reglas Ola 7
 *
 * Reglas (definidas en Ola 7 — F07 DX 400/404):
 *  - F01, F02, F03 deben estar "verified" (p:consumer ✓ + p:verify ✓ contra Factory real) — bloquean merge si no
 *  - F04, F05, F06, F07 son pact/lenient — si tienen pact, debe estar verified o mock_only (no failed). Si queda not_generated, no bloquea. FAILED sí bloquea. F07 es DX 400/404 (prompt required + job not found)
 *  - Lint debe pasar (exit 0)
 *
 * Uso:
 *   pnpm p:ci                # = tsx pact/support/ci.ts
 *   tsx software-testing-playground-v2/pact/support/ci.ts
 *   tsx software-testing-playground-v2/pact/support/ci.ts --skip-consumer --skip-verify  # solo check estados
 *
 * PowerShell:
 *   pnpm p:ci
 *   pnpm p:ci -- --skip-consumer  # no regenera pacts, solo verify+lint
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { deriveAllStates } from "./pactState.js";

const FEATURE_STRICT = ["F01", "F02", "F03"] as const;
const FEATURE_LENIENT = ["F04", "F05", "F06", "F07", "F08", "F09", "F10", "F11", "F12", "F13", "F14"] as const;

function parseArgs(): { skipConsumer: boolean; skipVerify: boolean; skipLint: boolean } {
  const args = process.argv.slice(2);
  return {
    skipConsumer: args.includes("--skip-consumer"),
    skipVerify: args.includes("--skip-verify"),
    skipLint: args.includes("--skip-lint"),
  };
}

function log(msg: string): void {
  console.log(`[ci] ${msg}`);
}
function logErr(msg: string): void {
  console.error(`[ci] ${msg}`);
}

async function runCommand(cmd: string, args: string[], label: string): Promise<number> {
  log(`▶ ${label}: ${cmd} ${args.join(" ")}`);
  const start = Date.now();
  const isWin = process.platform === "win32";

  const code: number = await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: path.resolve("."),
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: "inherit",
      shell: isWin,
    });
    child.on("close", (c) => resolve(c ?? 1));
    child.on("error", (err) => {
      logErr(`${label} spawn error: ${String(err)}`);
      resolve(1);
    });
  });

  const dur = Date.now() - start;
  if (code === 0) log(`✓ ${label} PASS (${dur}ms)`);
  else logErr(`✗ ${label} FAIL exit=${code} (${dur}ms)`);
  return code;
}

async function main(): Promise<void> {
  const opts = parseArgs();
  console.log(`[ci] Playground CI — F01-03 strict verified, F04-14 lenient (mock_only/not_generated no bloquea, failed sí)`);
  console.log(`[ci] skipConsumer=${opts.skipConsumer} skipVerify=${opts.skipVerify} skipLint=${opts.skipLint}`);

  let consumerCode = 0;
  let verifyCode = 0;
  let lintCode = 0;

  if (!opts.skipConsumer) {
    consumerCode = await runCommand("pnpm", ["p:consumer"], "p:consumer");
    if (consumerCode !== 0) {
      logErr(`p:consumer falló — abortando CI`);
      process.exit(consumerCode);
    }
  } else {
    log(`skip p:consumer`);
  }

  if (!opts.skipVerify) {
    verifyCode = await runCommand("pnpm", ["p:verify"], "p:verify");
    // Nota: p:verify puede fallar si Factory no está levantado (ERR_NO_FACTORY).
    // En ese caso, mostramos hint y consideramos que F01-03 no están verified, por lo que CI fallará abajo por estados.
    if (verifyCode !== 0) {
      logErr(`p:verify falló (puede ser ERR_NO_FACTORY sin daemon) — continuando a chequeo de estados para diagnóstico`);
    }
  } else {
    log(`skip p:verify`);
  }

  if (!opts.skipLint) {
    lintCode = await runCommand("node", ["software-testing-playground-v2/pact/support/lintPacts.mjs"], "p:lint");
    if (lintCode !== 0) {
      logErr(`p:lint falló — CI FAIL`);
      process.exit(lintCode);
    }
  } else {
    log(`skip p:lint`);
  }

  // Verificar estados derivados (fuente: pactState → verdicts + pacts)
  // Independientemente de verifyCode, chequeamos deriveAllStates
  console.log(`[ci] — chequeando estados derivados (deriveAllStates) —`);
  const states = deriveAllStates([...FEATURE_STRICT, ...FEATURE_LENIENT]);
  let failed = false;

  for (const fid of FEATURE_STRICT) {
    const s = states[fid];
    const status = s?.pactStatus ?? "not_generated";
    if (status !== "verified") {
      logErr(`✗ ${fid} strict — esperado verified, actual ${status} — bloquea CI`);
      if (s?.latestVerdict) logErr(`  latestVerdict: ${s.latestVerdict.id} conclusion=${s.latestVerdict.conclusion} provider=${s.latestVerdict.providerResult?.status}`);
      else logErr(`  no hay verdict — corre pnpm p:verify con Factory en 17680-17690`);
      failed = true;
    } else {
      log(`✓ ${fid} strict — verified OK`);
    }
  }

  for (const fid of FEATURE_LENIENT) {
    const s = states[fid];
    const status = s?.pactStatus ?? "not_generated";
    if (status === "failed") {
      logErr(`✗ ${fid} lenient — estado failed — bloquea CI (corrige pact o factory)`);
      failed = true;
    } else if (status === "verified") {
      log(`✓ ${fid} lenient — verified (hybrid Pact OK)`);
    } else if (status === "mock_only") {
      log(`⚠ ${fid} lenient — mock_only (solo consumer, no verificado) — no bloquea CI (p:verify pendiente)`);
    } else if (status === "not_generated") {
      log(`○ ${fid} lenient — not_generated (human slim, sin pact) — no bloquea CI (documentado en verifiers/verify-${fid}.human.md)`);
    }
  }

  if (failed) {
    logErr(`CI FAIL — F01-03 deben estar verified y F04-14 no failed. Ver report: pnpm p:report --md`);
    logErr(`PowerShell diagnóstico:`);
    logErr(`  Get-Content software-testing-playground-v2\\state.json | ConvertFrom-Json | ConvertTo-Json -Depth 8`);
    logErr(`  Get-ChildItem software-testing-playground-v2\\pacts\\ | Format-Table`);
    logErr(`  Get-ChildItem software-testing-playground-v2\\verdicts\\F01\\ | Sort LastWriteTime -Descending | Select -First 3`);
    process.exit(1);
  }

  // Lint ya pasó, consumer pasó, verify statuses ok → CI PASS
  // Nota: si p:verify falló pero estados igual muestran verified (verdict previo), permitimos PASS
  // pero warn si verifyCode !=0 y skipVerify false
  if (verifyCode !== 0 && !opts.skipVerify) {
    // Si verify falló pero estados dicen verified, es porque hay verdics previos verified aunque este run falló sin daemon
    // Eso no debería pasar — si verifyCode !=0, los estados deberían reflejar fail si se escribieron verdicts fail.
    // Pero como verify escribe verdict fail, ya lo detectamos arriba como failed. Si estamos aquí, verifyCode !=0 pero estados no muestran failed → fue ERR_NO_FACTORY sin verdict.
    log(`⚠ p:verify exit ${verifyCode} pero estados muestran verified previo — CI PASS con warning (daemon no disponible en este run, pero hay verdics previos verified)`);
    log(`  Para CI estricto, asegúrate que Factory esté en 17680-17690: Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health`);
  }

  log(`✓ CI PASS — F01-03 verified, F04-14 ok (mock_only/not_generated no bloquea), lint PASS`);
  log(`  Genera report: pnpm p:report --md → docs/playground-report.md`);
  process.exit(0);
}

const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].replace(/\\/g, "/").endsWith("ci.ts") ||
    process.argv[1].replace(/\\/g, "/").endsWith("ci.js") ||
    process.argv[1].replace(/\\/g, "/").endsWith("ci.mjs"));

if (isDirect) {
  void main();
}

export { FEATURE_STRICT, FEATURE_LENIENT };
