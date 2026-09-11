/**
 * sync-factory-agents — materializa factory/agents/*\/agent.md como agentes
 * opencode reales.
 * - Por defecto: `.opencode/agents/*.md` del proyecto (dir local gitignored).
 * - Con `--global`: `~/.config/opencode/agents/*.md` (vale para TODOS los
 *   proyectos/sesiones; requiere reiniciar el server opencode para verlos).
 * Uso: `pnpm sync:agents [--global]`. Nunca falla con exit!=0 (dir descartable).
 */
import {
  checkFactoryMirrorsInSync,
  syncFactoryAgentsGlobal,
  syncFactoryAgentsToOpencode,
  syncFactorySkillsGlobal,
  syncFactorySkillsToOpencode,
} from "../headless-runtime/factory/opencodeAgentSync.ts";

if (process.argv.includes("--check")) {
  const check = checkFactoryMirrorsInSync();
  for (const diff of check.diffs) console.log(`[sync:agents] drift: ${diff}`);
  console.log(`[sync:agents] check: ${check.ok ? "en sync" : `${check.diffs.length} diferencias`}`);
  process.exit(check.ok ? 0 : 1);
}

const global = process.argv.includes("--global");
const report = global ? syncFactoryAgentsGlobal() : syncFactoryAgentsToOpencode();
for (const name of report.written) console.log(`[sync:agents] escrito ${report.dir}/${name}.md`);
for (const skip of report.skipped) console.log(`[sync:agents] skip ${skip.name}: ${skip.reason}`);
console.log(`[sync:agents] ok: ${report.written.length} escritos, ${report.skipped.length} skips`);
const skills = global ? syncFactorySkillsGlobal() : syncFactorySkillsToOpencode();
for (const name of skills.written) console.log(`[sync:agents] escrito ${skills.dir}/${name}/SKILL.md`);
for (const skip of skills.skipped) console.log(`[sync:agents] skills skip ${skip.name}: ${skip.reason}`);
console.log(`[sync:agents] skills ok: ${skills.written.length} escritos, ${skills.skipped.length} skips`);
