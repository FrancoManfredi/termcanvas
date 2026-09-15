/**
 * validate-factory-agents — valida `factory/agents/*\/agent.md` (frontmatter,
 * tools/stage/blocking, exactamente un FOREMAN) SIN escribir nada.
 *
 * Los agentes viajan INLINE en el config del server efímero de TermCanvas
 * (`Config.agent`): no hay espejos en disco y el opencode del usuario nunca
 * los ve. Uso: `pnpm validate:agents`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAgentFile,
  validateAgentSet,
  type AgentDef,
} from "../headless-runtime/factory/agentLoader.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_DIR = path.join(ROOT, "factory", "agents");

const defs: AgentDef[] = [];
const errors: string[] = [];
try {
  for (const name of fs.readdirSync(AGENTS_DIR).sort()) {
    const dir = path.join(AGENTS_DIR, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    try {
      const text = fs.readFileSync(path.join(dir, "agent.md"), "utf-8");
      const parsed = parseAgentFile(text);
      defs.push({ name, frontmatter: parsed.frontmatter, body: parsed.body });
      console.log(`[validate:agents] ok ${name}`);
    } catch (e) {
      errors.push(`agente "${name}": agent.md inválido (${e instanceof Error ? e.message : String(e)})`);
    }
  }
} catch {
  errors.push("no se pudo leer factory/agents/");
}
errors.push(...validateAgentSet(defs));
for (const err of errors) console.error(`[validate:agents] error: ${err}`);
console.log(`[validate:agents] ${errors.length === 0 ? "OK" : `${errors.length} error(es)`}`);
process.exit(errors.length === 0 ? 0 : 1);
