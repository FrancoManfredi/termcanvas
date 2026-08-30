// SRP: renders one definition file with simple syntax highlight and line numbers
// OCP: adding new language only extends language map

import { useMemo } from "react";

export interface FileViewerProps {
  path: string;
  raw: string;
  language: "yaml" | "markdown";
  githubUrl?: string;
  readOnly?: boolean;
}

function tokenizeYaml(line: string): { text: string; cls: string }[] {
  if (line.trim().startsWith("#")) return [{ text: line, cls: "text-zinc-500" }];
  const colonIdx = line.indexOf(":");
  if (colonIdx > 0 && !line.trim().startsWith("-")) {
    const key = line.slice(0, colonIdx);
    const rest = line.slice(colonIdx);
    return [
      { text: key, cls: "text-sky-700 font-medium" },
      { text: rest, cls: "text-zinc-700" },
    ];
  }
  if (line.trim().startsWith("-")) {
    return [{ text: line, cls: "text-zinc-700" }];
  }
  return [{ text: line, cls: "text-zinc-700" }];
}

function tokenizeMarkdown(line: string): { text: string; cls: string }[] {
  if (line.startsWith("#")) return [{ text: line, cls: "text-zinc-900 font-semibold" }];
  if (line.startsWith("---")) return [{ text: line, cls: "text-zinc-400" }];
  if (line.startsWith("- ") || line.startsWith("* ")) return [{ text: line, cls: "text-zinc-700" }];
  return [{ text: line, cls: "text-zinc-700" }];
}

export function FileViewer({ path, raw, language, githubUrl, readOnly }: FileViewerProps) {
  const lines = useMemo(() => raw.split("\n"), [raw]);
  const badge = language === "yaml" ? "YAML" : "Markdown";

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[12px] border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[12px] font-medium text-zinc-700 truncate">{path}</span>
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white">{badge}</span>
          {readOnly && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">read-only</span>}
        </div>
        <div className="flex items-center gap-2">
          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-white"
            >
              Open in GitHub
            </a>
          )}
          <span className="text-[11px] text-zinc-400">{lines.length} lines</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-subsurface">
        <pre className="p-0 text-[12px] leading-[18px]">
          {lines.map((line, idx) => {
            const tokens = language === "yaml" ? tokenizeYaml(line) : tokenizeMarkdown(line);
            return (
              <div key={idx} className="flex">
                <span className="w-10 shrink-0 select-none border-r border-zinc-200 bg-zinc-50 px-2 py-0 text-right font-mono text-[11px] text-zinc-400">
                  {idx + 1}
                </span>
                <span className="whitespace-pre-wrap break-words px-3 py-0 font-mono text-[12px]">
                  {line === "" ? "\u00A0" : tokens.map((t, i) => (
                    <span key={i} className={t.cls}>{t.text}</span>
                  ))}
                </span>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
