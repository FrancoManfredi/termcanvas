import { spawn } from "node:child_process";

/**
 * Probe rápido para MCPs locales (stdio).
 * No descarga el paquete completo: solo verifica que `command` existe y que `npx` responde.
 * Para `npx -y <pkg>` asumimos ok si `npx --help` funciona, el paquete se descarga bajo demanda al conectar.
 */
export async function probeLocal(
  command: string,
  _args: string[],
  timeoutMs = 4000,
): Promise<{ ok: boolean; error?: string; details?: string }> {
  try {
    // 1. Verificar que el binario base existe (npx, node, etc.)
    await new Promise<void>((resolve, reject) => {
      const checkCmd = process.platform === "win32" ? "where" : "which";
      const proc = spawn(checkCmd, [command], { windowsHide: true, stdio: "ignore", shell: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill(); } catch {}
        reject(new Error(`Timeout verificando ${command}`));
      }, timeoutMs);
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) return;
        if (code === 0) resolve();
        else reject(new Error(`Comando no encontrado: ${command}`));
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // 2. Si es npx, verificar que npx --help funciona (indica que npm/node están bien)
    if (command === "npx") {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("npx", ["--help"], { windowsHide: true, stdio: "ignore", shell: true });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try { proc.kill(); } catch {}
          reject(new Error("Timeout npx --help"));
        }, timeoutMs);
        proc.on("close", (code) => {
          clearTimeout(timer);
          if (timedOut) return;
          // npx --help suele salir con 0 o 1, ambos son ok
          if (code === 0 || code === 1) resolve();
          else reject(new Error(`npx no disponible (exit ${code})`));
        });
        proc.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      return { ok: true, details: "npx disponible (paquete se descarga bajo demanda)" };
    }

    return { ok: true, details: `Comando ${command} encontrado` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Probe completo: intenta spawnear el MCP y hacer handshake initialize.
 * Más pesado, solo para health check explícito, no para validación previa.
 */
export async function probeLocalWithHandshake(
  command: string,
  args: string[],
  projectPath: string,
  timeoutMs = 7000,
  envOverrides: Record<string, string> = {},
): Promise<{ ok: boolean; error?: string; details?: string }> {
  // Primero probe rápido
  const quick = await probeLocal(command, args, 3000);
  if (!quick.ok) return quick;

  // Luego intentar handshake real con el MCP
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { proc.kill(); } catch {}
        resolve({ ok: false, error: "Timeout handshake initialize (7s)", details: "El MCP no respondió a initialize" });
      }
    }, timeoutMs);

    const finalArgs = args.map((a) => (a === "{projectPath}" ? projectPath : a.replace("{projectPath}", projectPath)));
    // En Windows, npx es npx.cmd y necesita shell o cmd /c
    const isWin = process.platform === "win32";
    const spawnCmd = isWin && command === "npx" ? "cmd" : command;
    const spawnArgs = isWin && command === "npx" ? ["/c", "npx", ...finalArgs] : finalArgs;
    const proc = spawn(spawnCmd, spawnArgs, { windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      cwd: projectPath || undefined,
      env: { ...process.env, ...envOverrides } as NodeJS.ProcessEnv,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      // Buscar respuesta JSON-RPC
      if (stdout.includes('"result"') || stdout.includes('"error"')) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          try { proc.kill(); } catch {}
          if (stdout.includes("-32000") || stdout.includes("Connection closed")) {
            resolve({ ok: false, error: "MCP error -32000: Connection closed", details: stderr.slice(0, 500) || stdout.slice(0, 500) });
          } else if (stdout.toLowerCase().includes("api key") || stdout.toLowerCase().includes("apikey") || stdout.toLowerCase().includes("no api key")) {
            resolve({ ok: false, error: "No API Key", details: stdout.slice(0, 500) || stderr.slice(0, 500) });
          } else {
            resolve({ ok: true, details: "Handshake initialize ok" });
          }
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (!resolved && (stderr.toLowerCase().includes("api key") || stderr.toLowerCase().includes("no api key"))) {
        // Algunos MCPs reportan el error por stderr antes de cerrar
        // No resolvemos aún, esperamos stdout o close, pero guardamos para el error final
      }
    });

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message, details: stderr.slice(0, 500) });
      }
    });

    proc.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        const combined = (stdout + "\n" + stderr).toLowerCase();
        if (combined.includes("api key") || combined.includes("apikey") || combined.includes("no api key")) {
          resolve({ ok: false, error: "No API Key", details: (stderr || stdout).slice(0, 500) });
          return;
        }
        if (code === 0 || code === null) {
          resolve({ ok: false, error: `Proceso cerrado con código ${code ?? "null"}`, details: stderr.slice(0, 500) || stdout.slice(0, 500) || "Sin salida" });
        } else {
          resolve({ ok: false, error: `Proceso falló con código ${code}`, details: (stderr || stdout).slice(0, 500) });
        }
      }
    });

    // Enviar initialize
    try {
      const initMsg = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "termcanvas-health", version: "1.0.0" } },
      }) + "\n";
      proc.stdin?.write(initMsg);
    } catch (e) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  });
}
