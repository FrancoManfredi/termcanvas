import { useState } from "react";
import { GithubIcon } from "../../atoms/icons/GithubIcon";
import { LinearIcon } from "../../atoms/icons/LinearIcon";
import { SlackIcon } from "../../atoms/icons/SlackIcon";
import { JiraIcon } from "../../atoms/icons/JiraIcon";
import type { TriggerConfig } from "../../../lib/factory/fixtures/figma.fixtures";

export function TriggerDropdown({ onSelect }: { onSelect: (t: TriggerConfig) => void }) {
  const [hoveredScheduled, setHoveredScheduled] = useState(false);

  return (
    <div className="flex rounded-xl border border-gray-200 bg-white overflow-hidden text-sm anim-fade-in-up" style={{ boxShadow: "0 8px 24px oklch(0 0 0 / 0.12), 0 1px 4px oklch(0 0 0 / 0.06)" }}>
      <div className="w-44 py-2 border-r border-gray-100">
        <button
          type="button"
          onMouseEnter={() => setHoveredScheduled(true)}
          onMouseLeave={() => setHoveredScheduled(false)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 transition-[background-color] duration-100 ${hoveredScheduled ? "bg-gray-50" : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5" stroke="#6b7280" strokeWidth="1.5" />
            <path d="M7 4.5V7l2 1" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Scheduled
        </button>
        {[
          { icon: <GithubIcon size={14} className="text-gray-700" />, label: "GitHub" },
          { icon: <LinearIcon size={14} />, label: "Linear", disabled: true },
          { icon: <SlackIcon size={14} />, label: "Slack", disabled: true },
          { icon: <JiraIcon size={14} />, label: "Jira", disabled: true },
        ].map(({ icon, label, disabled }) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            className={`w-full flex items-center gap-2.5 px-3 py-2 transition-[background-color] duration-100 ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-gray-50"}`}
          >
            {icon}
            <span>{label}</span>
            {disabled && <span className="ml-auto text-[10px] text-gray-400">Not connected</span>}
          </button>
        ))}
      </div>
      {hoveredScheduled && (
        <div className="w-36 py-2 anim-fade-in" onMouseEnter={() => setHoveredScheduled(true)} onMouseLeave={() => setHoveredScheduled(false)}>
          {(["Hourly", "Daily", "Weekly", "Custom (cron)"] as const).map((freq) => (
            <button
              key={freq}
              type="button"
              onClick={() => onSelect({ type: "scheduled", frequency: freq.toLowerCase().replace(" (cron)", "") as TriggerConfig extends { frequency: infer F } ? F : never, day: "Monday", time: "09:00 AM" })}
              className="w-full text-left px-4 py-2 hover:bg-gray-50 transition-[background-color] duration-100 text-sm active:scale-[0.97]"
            >
              {freq}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
