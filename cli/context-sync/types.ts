// Contratos compartidos del motor de sincronización de contexto.
// El runner es inyectable para que los tests corran con repos locales
// (bare + clones) sin tocar la red ni gh.

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<RunResult>;
