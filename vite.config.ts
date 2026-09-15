import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "fs";
import path from "path";
import { build as esbuild, context as esbuildCtx, type Plugin as EsbuildPlugin } from "esbuild";
import { ensureCliLauncher } from "./electron/cli-launchers";
import { FACTORY_WATCH_EXCLUDES } from "./scripts/factory-watch-excludes.mjs";

function buildPreload(): Plugin {
  const opts = {
    entryPoints: ["electron/preload.ts"],
    outfile: "dist-electron/preload.cjs",
    format: "cjs" as const,
    platform: "node" as const,
    bundle: true,
    external: ["electron"],
  };
  return {
    name: "build-preload",
    async buildStart() {
      if (this.meta.watchMode) {
        const ctx = await esbuildCtx(opts);
        await ctx.watch();
      } else {
        await esbuild(opts);
      }
    },
  };
}

/** esbuild plugin: after write, create the platform-appropriate CLI launcher. */
function cliSymlinkPlugin(outfile: string): EsbuildPlugin {
  const jsPath = path.resolve(outfile);
  return {
    name: "cli-symlink",
    setup(build) {
      build.onEnd(() => {
        ensureCliLauncher(jsPath);
      });
    },
  };
}

function buildCli(): Plugin {
  const outfile = "dist-cli/termcanvas.js";
  const opts = {
    entryPoints: ["cli/termcanvas.ts"],
    outfile,
    format: "esm" as const,
    platform: "node" as const,
    bundle: true,
    banner: { js: "#!/usr/bin/env node" },
    plugins: [cliSymlinkPlugin(outfile)],
  };
  return {
    name: "build-cli",
    async buildStart() {
      if (this.meta.watchMode) {
        const ctx = await esbuildCtx(opts);
        await ctx.watch();
      } else {
        await esbuild(opts);
      }
    },
  };
}

function buildBrowse(): Plugin {
  const outfile = "dist-cli/browse.js";
  const opts = {
    entryPoints: ["browse/src/cli.ts"],
    outfile,
    format: "esm" as const,
    platform: "node" as const,
    bundle: true,
    banner: { js: "#!/usr/bin/env node" },
    external: ["playwright"],
    plugins: [cliSymlinkPlugin(outfile)],
  };
  return {
    name: "build-browse",
    async buildStart() {
      if (this.meta.watchMode) {
        const ctx = await esbuildCtx(opts);
        await ctx.watch();
      } else {
        await esbuild(opts);
      }
    },
  };
}

/**
 * Dev-only: `pnpm dev` levanta el Factory daemon standalone (fuera de
 * Electron), igual que `scripts/start-factory.mjs`. El daemon corre con
 * `node --watch`, así que cada edición de headless-runtime/* lo reinicia
 * solo: la app (que reutiliza el daemon healthy por singleton) nunca más
 * sirve código viejo — el bug "No mergear no borra nada" fue un daemon
 * huérfano de horas antes.
 *
 * - Singleton: si 17680/17681 ya responden health, no se spawnea nada.
 * - Al cerrar Vite se mata el árbol completo (taskkill /T en Windows):
 *   cero huérfanos, que era la otra mitad del problema.
 * - `dev:web`/`dev:web-local` quedan afuera (VITE_NO_ELECTRON=1; el local
 *   ya lo levanta por scripts/dev-web-local.mjs).
 */
function devFactoryDaemon(): Plugin {
  let child: ChildProcess | null = null;
  const kill = (): void => {
    const pid = child?.pid;
    child = null;
    if (pid === undefined || pid === null) return;
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      // best-effort: nunca frena el cierre de Vite
    }
  };
  const probe = async (port: number): Promise<boolean> => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 700);
      const res = await fetch(`http://127.0.0.1:${port}/factory/health`, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  };
  return {
    name: "dev-factory-daemon",
    apply: "serve",
    async configureServer(server) {
      if (process.env.VITE_NO_ELECTRON === "1") return;
      for (const port of [17680, 17681]) {
        if (await probe(port)) {
          console.log(
            `[dev-factory-daemon] factory ya healthy en ${port} — singleton, no spawneo otro`,
          );
          return;
        }
      }
      const root = path.resolve(__dirname);
      const entry = path.join(root, "headless-runtime", "factory", "factoryServer.ts");
      const watch = process.env.TERMCANVAS_FACTORY_NO_WATCH !== "1";
      // Watch explícito de tsx (subcomando `watch`): el alias `--watch` lo
      // maneja NODE (su watcher no soporta excludes) y `--exclude` revienta
      // con "node: bad option". El subcomando sí acepta los excludes que
      // evitan que los writes de runtime reinicien al daemon (ver incidente).
      const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
      const args = watch
        ? [tsxCli, "watch", ...FACTORY_WATCH_EXCLUDES.flatMap((glob) => ["--exclude", glob]), entry]
        : ["--import", "tsx", entry];
      // F1b: stdout/stderr del daemon a archivo. Sin esto un exit del child
      // (crash) no deja rastro: el watch lo relanza y solo se ve el parkeo.
      // Vive bajo .agents/ (runtime excluido del watch, no ensucia el repo).
      let stdio: "inherit" | ["ignore", number, number] = "inherit";
      try {
        const logDir = path.join(root, ".agents", "factory");
        fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, "daemon-dev.log");
        const fd = fs.openSync(logPath, "a");
        fs.appendFileSync(
          logPath,
          `\n=== daemon start ${new Date().toISOString()} (watch=${watch ? "on" : "off"}) ===\n`,
          "utf-8",
        );
        stdio = ["ignore", fd, fd];
        console.log(`[dev-factory-daemon] log: ${logPath}`);
      } catch {
        stdio = "inherit";
      }
      try {
        child = spawn(process.execPath, args, {
          cwd: root,
          stdio,
          windowsHide: true,
          env: { ...process.env },
        });
        console.log(
          `[dev-factory-daemon] daemon standalone lanzado (pid ${child.pid ?? "?"}${watch ? ", watch on" : ""})`,
        );
        child.on("exit", (code) => {
          console.log(`[dev-factory-daemon] daemon salió (code=${code ?? "?"})`);
          child = null;
        });
      } catch (e) {
        console.warn(`[dev-factory-daemon] no se pudo lanzar: ${String(e)}`);
        child = null;
      }
      server.httpServer?.once("close", kill);
      process.once("exit", kill);
    },
  };
}

function buildAgentShims(): Plugin {
  const shimNames = ["codex", "claude"] as const;
  const buildOptions = shimNames.map((name) => {
    const outfile = `dist-cli/agent-shims/${name}.js`;
    return {
      entryPoints: [`cli/agent-shims/${name}.ts`],
      outfile,
      format: "esm" as const,
      platform: "node" as const,
      bundle: true,
      banner: { js: "#!/usr/bin/env node" },
      plugins: [cliSymlinkPlugin(outfile)],
    };
  });

  return {
    name: "build-agent-shims",
    async buildStart() {
      fs.mkdirSync("dist-cli/agent-shims", { recursive: true });
      if (this.meta.watchMode) {
        for (const opts of buildOptions) {
          const ctx = await esbuildCtx(opts);
          await ctx.watch();
        }
      } else {
        await Promise.all(buildOptions.map((opts) => esbuild(opts)));
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    buildPreload(),
    buildCli(),
    buildBrowse(),
    buildAgentShims(),
    devFactoryDaemon(),
    // Perf dev-boot (C): `pnpm dev:web` salta el build de Electron
    // (main 3.6MB/22s) para trabajo solo-UI: ~1-2s. `pnpm dev` intacto.
    // Flag por env (los flags CLI desconocidos los rechaza vite).
    ...(!(process.env.VITE_NO_ELECTRON === "1")
      ? [
          electron([
            {
              entry: "electron/main.ts",
              vite: {
                define: {
                  "process.env.VITE_SUPABASE_URL": JSON.stringify(
                    process.env.VITE_SUPABASE_URL ?? "",
                  ),
                  "process.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
                    process.env.VITE_SUPABASE_ANON_KEY ?? "",
                  ),
                },
                build: {
                  outDir: "dist-electron",
                  // Perf dev-boot (B1): sin reporte gzip en dev (3.6MB).
                  reportCompressedSize: false,
                  rollupOptions: {
                    // Perf dev-boot (B1): estas deps puras-JS no se
                    // transforman ni empaquetan (require directo a
                    // node_modules en dev y empaquetado). Solo CJS-safe:
                    // nada ESM-only acá (rompería el main CJS).
                    external: ["node-pty", "adm-zip", "@anthropic-ai/sdk", "zod", "ws"],
                  },
                },
              },
            },
          ]),
        ]
      : []),
    renderer(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Pre-bundling @wterm/* would move the modules into .vite/deps, breaking
  // the `new URL("../wasm/...", import.meta.url)` lookup the ghostty core
  // uses to find its WASM blob. Keep them as-is so the relative URL stays
  // valid against node_modules.
  optimizeDeps: {
    exclude: ["@wterm/core", "@wterm/dom", "@wterm/ghostty", "@wterm/react"],
  },
  base: "./",
  // Hydra writes worktrees, dispatch state, and result.json under
  // .hydra/ + .worktrees/ at runtime. The dev server's chokidar
  // watcher would otherwise see those writes, decide a "source file"
  // changed, and trigger a full renderer reload (visible as a
  // Cmd+R-style flash whenever a child Claude is dispatched). The
  // .gitignore covers git but not Vite - explicit ignore here.
  //
  // scripts/.tools/ and .termcanvas/ are runtime caches too: the
  // issue-gate/diagnostico scripts download & extract binaries into
  // .tools WHILE the dev server runs, and watching freshly extracted
  // files races their Windows locks — chokidar's fs.watch then throws
  // EBUSY and the unhandled 'error' event kills the whole dev process.
  //
  // factory/ runtime evidence (same bug class as .hydra above): the daemon
  // writes these files WHILE jobs run, and every write used to full-reload
  // the renderer (Cmd+R-style flash, console wiped). The visible case was
  // the review→awaiting transition: the ask_human notification lands in
  // `factory/.notifications.json` (+ `factory/.automations.json` when the
  // announce-ask-human event fires) at the exact tick the row moves to
  // AWAITING YOU, so the panel always "restarted" on that transition and
  // never on intake/foreman/building/review (those write under the ignored
  // .agents/ tree or outside the repo). The resolve→In Progress flash is the
  // same bug class: every POST /factory/jobs (every Resolve click) rewrites
  // `factory/.job-index.json` (workItemStore.create → recordJobDirInIndex,
  // tmp→rename in the same dir) ~100ms after the click. Only dot-runtime is
  // ignored —
  // factory source (factory.yaml, prompts/, runners/, scorers/, skills/,
  // benchmarks/) stays watched, EXCEPT `factory/agents/**/agent.md`: the
  // Agents panel PUTs that file at runtime (PUT /factory/agents/:name writes
  // the body + `agent.md.tmp-<ts>-<rand>` sibling, then regenerates the
  // `.opencode/agents/*.md` mirror), and every Save used to full-reload the
  // renderer (black screen + app "restart", same bug class as the flashes
  // above). Tradeoff aceptado: editar un agent.md en el editor ya no recarga
  // solo; la UI es ahora su editor vivo. The trailing `*` on the ring/index/
  // agent files also covers their tmp→rename siblings
  // (`.notifications.json.tmp-<ts>-<rand>`), which are created in the same
  // watched dir and would otherwise reload twice per write.
  server: {
    watch: {
      ignored: [
        "**/.hydra/**",
        "**/.worktrees/**",
        "**/.hydra-result-*.md",
        "**/.hydra-task-*.md",
        "**/scripts/.tools/**",
        "**/.termcanvas/**",
        "**/docs/**",
        "**/.agents/**",
        "**/factory/.notifications.json*",
        "**/factory/.automations.json*",
        "**/factory/.integrations-mock.json*",
        "**/factory/.job-index.json*",
        "**/factory/.proposals/**",
        "**/factory/.benchmark-results/**",
        "**/factory/agents/**/agent.md*",
        "**/.opencode/agents/**",
      ],
    },
  },
  build: {
    outDir: "dist",
  },
});
