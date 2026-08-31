// Medición de rutas de render del renderer. Los logs de consola se
// retiraron (ruido en dev): la función conserva su contrato — devuelve los
// milisegundos medidos por si un caller quiere reaccionar.

interface PerfOptions {
  details?: Record<string, unknown>;
  thresholdMs?: number;
}

export function logSlowRendererPath(
  label: string,
  startedAt: number,
  options: PerfOptions = {},
): number {
  void label;
  void options;
  return performance.now() - startedAt;
}

export function measureRendererSync<T>(
  label: string,
  run: () => T,
  options: PerfOptions = {},
): T {
  const startedAt = performance.now();

  try {
    return run();
  } finally {
    logSlowRendererPath(label, startedAt, options);
  }
}
