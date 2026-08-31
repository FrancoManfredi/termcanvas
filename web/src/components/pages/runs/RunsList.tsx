import { RunStatusIcon } from "../../atoms/icons/RunStatusIcon";
import { GithubIcon } from "../../atoms/icons/GithubIcon";
import { SlackIcon } from "../../atoms/icons/SlackIcon";
import type { Run } from "../../../lib/factory/fixtures/figma.fixtures";

export function RunsList({ runs }: { runs: readonly Run[] }) {
  return (
    <div className="divide-y divide-gray-50">
      {runs.map((run) => (
        <button key={run.id} type="button" className="w-full flex items-center gap-3 px-8 py-2.5 hover:bg-gray-50 text-left group transition-[background-color] duration-100 active:scale-[0.99]">
          <RunStatusIcon status={run.status} />
          <span className="flex-1 text-sm text-gray-800 truncate min-w-0">{run.title}</span>
          <span className="text-xs font-mono text-gray-400 uppercase tabular-nums flex-shrink-0">{run.hash}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {run.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 rounded text-[11px] text-gray-500">
                {(tag === "PR Creat" || tag === "2 PRs Creat") && <GithubIcon size={10} className="text-gray-500" />}
                {tag.includes("Slack") && <SlackIcon size={10} />}
                {tag}
              </span>
            ))}
          </div>
          <span className="w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">{run.agentInitial}</span>
          <span className="text-xs text-gray-400 flex-shrink-0 w-16 text-right tabular-nums">{run.time}</span>
        </button>
      ))}
    </div>
  );
}
