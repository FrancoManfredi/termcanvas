// Structured parse errors — ISP: narrow error shape per consumer
export interface FileParseError {
  file: string;
  line?: number;
  col?: number;
  message: string;
  code: string;
}

export function formatZodIssues(
  issues: { path: (string | number)[]; message: string; code: string; line?: number }[],
  file = "input",
): { path: string; message: string; code: string }[] {
  return issues.map((i) => {
    if (i.line !== undefined) {
      const field = i.path.length ? i.path.join(".") : "";
      const suffix = field ? ` — ${field}` : "";
      return { path: `${file}:${i.line}${suffix}`, message: i.message, code: i.code };
    }
    return {
      path: i.path.length ? `${file}.${i.path.join(".")}` : file,
      message: i.message,
      code: i.code,
    };
  });
}
