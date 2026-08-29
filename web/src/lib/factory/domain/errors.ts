// Structured parse errors — ISP: narrow error shape per consumer
export interface FileParseError {
  file: string;
  line?: number;
  col?: number;
  message: string;
  code: string;
}

export function formatZodIssues(issues: { path: (string | number)[]; message: string; code: string }[], file = "input"): { path: string; message: string; code: string }[] {
  return issues.map((i) => ({
    path: i.path.length ? `${file}.${i.path.join(".")}` : file,
    message: i.message,
    code: i.code,
  }));
}
