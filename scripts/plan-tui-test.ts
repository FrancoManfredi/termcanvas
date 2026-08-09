import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { buildPlanningPrompt } from "../src/planner/planningPrompt.ts";

/**
 * Smoke test manual de la Fase 2: abre la TUI de opencode con el prompt
 * de Planificación apuntando al proyecto activo de la app.
 *
 * Uso: npx tsx scripts/plan-tui-test.ts [audit]
 *
 * Resuelve el repo activo leyendo ~/.termcanvas(-dev)/state.json
 * que la app persiste (focusedProjectId -> projects[].path). Si la app
 * no corrió nunca o no hay proyecto activo, el script falla con mensaje
 * claro en lugar de abrir una TUI en el lugar equivocado.
 *
 * El prompt se pasa por --prompt (single-line, como exige opencode en
 * Windows). El roadmap de ejemplo se hardcodea acá para no depender del
 * modal todavía; la Fase 3 reutilizará este mismo builder desde el
 * store con el texto real pegado por el usuario.
 */

const MODE = process.argv.includes("--audit") ? "audit" : "roadmap";

const instance = process.env.TERMCANVAS_INSTANCE ?? "dev";
const statePath = path.join(os.homedir(), `.termcanvas-${instance}`, "state.json");

function findActiveProjectRepo(): string {
  if (!fs.existsSync(statePath)) {
    throw new Error(
      `No existe ${statePath}: ¿corriste la app en modo ${instance} al menos una vez?`,
    );
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  // La app persiste la escena en workspace.canvases[*].scene; el foco
  // (focusedProjectId) solo vive en memoria, así que acá resolvemos el
  // PRIMER proyecto del canvas activo como "proyecto activo" y el
  // usuario puede overridearlo con --repo <ruta>.
  const workspace = state?.workspace;
  const canvases = Array.isArray(workspace?.canvases) ? workspace.canvases : [];
  const activeId = workspace?.activeCanvasId;
  const scene = (activeId
    ? canvases.find((c: { id: string }) => c.id === activeId)
    : canvases[0]
  )?.scene;
  const projects = Array.isArray(scene?.projects) ? scene.projects : [];
  const first = projects[0];
  if (!first || typeof first.path !== "string") {
    throw new Error(
      "No hay proyectos en la escena guardada; creá/abril un proyecto en la app antes de correr este test.",
    );
  }
  return first.path;
}

const repoFlagIndex = process.argv.indexOf("--repo");
const REPO_PATH =
  repoFlagIndex !== -1
    ? process.argv[repoFlagIndex + 1]
    : findActiveProjectRepo();

const OUT_PATH = path.join(
  REPO_PATH,
  ".agents",
  "planning",
  `plan-${Date.now()}.json`,
);

const roadmapText = process.argv.includes("--audit") ? "" : `# Roadmap Q3 — termcanvas
- Agregar vista de calendario por milestone (feature, ui)
- Persistir el estado colapsado de la barra lateral (improvement)
- Migrar las consultas de issues a query keys tipadas (refactor)
- Paginación por cursor en la lista de issues (perf)`;

// En Windows opencode suele instalarse via npm global, que deja shims
// .cmd que a su vez delegan al exe real:
//   "%dp0%\node_modules\opencode-ai\bin\opencode.exe"   %*
// child_process.spawn no ejecuta .cmd directamente (ENOENT), así que
// replicamos el patrón resolveWindowsShimTarget de pty-launch.ts:
// leer el shim, extraer el target y lanzar ESO.
function resolveOpenCodeBinary(): string {
  if (process.platform !== "win32") return "opencode";
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter);
  const candidates = ["opencode.cmd", "opencode.bat"];
  for (const dir of pathEntries) {
    for (const name of candidates) {
      const shimPath = path.join(dir, name);
      if (!fs.existsSync(shimPath)) continue;
      let content: string;
      try {
        content = fs.readFileSync(shimPath, "utf-8");
      } catch {
        continue;
      }
      const match = content.match(/"([^"]*\.exe(?:\s+%[\w]+%)?)"/);
      if (!match) return shimPath;
      const target = match[1].replace(/%dp0%/g, path.dirname(shimPath)).trim();
      if (fs.existsSync(target)) return target;
      return shimPath;
    }
  }
  return "opencode";
}

const openCodeBinary = resolveOpenCodeBinary();

const prompt = buildPlanningPrompt({
  mode: MODE,
  repoPath: REPO_PATH,
  roadmapText,
  attachmentNames: [],
  outputPath: OUT_PATH,
});

// El tsconfig de la app solo incluye src/, así que scripts/ no recibe los
// types de node (spawn devuelve un ChildProcess sin .on). Tipamos los
// eventos que usamos con una forma local en lugar de tocar la config.
interface ChildProcessLike {
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
}

console.log("[plan-tui-test] repo activo:", REPO_PATH);
console.log("[plan-tui-test] salida esperada:", OUT_PATH);
console.log("[plan-tui-test] prompt muy largo (single-line), longitud:", prompt.length);

const args = ["-m", "opencode/big-pickle", "--prompt", prompt];
console.log("[plan-tui-test] ejecutando: opencode " + args.join(" ").slice(0, 120) + "…");

// --headless: usa "opencode run" (termina solo, no abre TUI) para validar
// el flujo del agente sin necesidad de un terminal humano. El spawn no
// bloquea: hacemos polling del archivo de salida hasta que exista.
const headless = process.argv.includes("--headless");
const spawnArgs = headless
  ? ["run", prompt, "-m", "opencode/big-pickle", "--auto"]
  : args;

const child = spawn(openCodeBinary, spawnArgs, {
  cwd: REPO_PATH,
  stdio: headless ? "ignore" : "inherit",
}) as unknown as ChildProcessLike;

if (headless) {
  console.log("[plan-tui-test] modo headless: esperando el archivo de salida…");
  const deadline = Date.now() + 5 * 60 * 1000;
  const timer = setInterval(() => {
    if (fs.existsSync(OUT_PATH)) {
      clearInterval(timer);
      console.log("[plan-tui-test] OK: se generó", OUT_PATH);
      console.log(fs.readFileSync(OUT_PATH, "utf-8").slice(0, 400));
      process.exit(0);
    }
    if (Date.now() > deadline) {
      clearInterval(timer);
      console.error("[plan-tui-test] TIMEOUT: opencode no generó el archivo en 5 min.");
      process.exit(1);
    }
  }, 2000);
} else {
  child.on("error", (err) => {
    console.error("[plan-tui-test] no se pudo abrir opencode:", err.message);
    process.exit(1);
  });
  child.on("close", (code) => {
    console.log("[plan-tui-test] opencode terminó con código", code);
    console.log("[plan-tui-test] verificá que exista:", OUT_PATH);
    process.exit(code ?? 0);
  });
}