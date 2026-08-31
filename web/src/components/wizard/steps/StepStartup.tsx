import { WarpLogo } from "../../atoms/icons/WarpLogo";
import { GithubIcon } from "../../atoms/icons/GithubIcon";
import { PIPELINE } from "../../../lib/factory/fixtures/figma.fixtures";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

export function StepStartup({ onOpenFactory }: { onOpenFactory: () => void }) {
  return (
    <div className="min-h-full bg-white flex flex-col items-center justify-center px-6 py-12">
      <WarpLogo />
      <h1 className="text-2xl font-semibold text-gray-900 mt-6 mb-2 anim-fade-in-up delay-0">Starting up your factory…</h1>
      <p className="text-sm text-gray-400 mb-12 anim-fade-in-up delay-60">This should only take a few moments. Review your factory flow below.</p>
      <div className="w-full max-w-4xl grid grid-cols-4 gap-3 mb-12">
        {PIPELINE.map((stage, idx) => (
          <div key={stage.label} className={`relative rounded-xl p-4 ${stage.color} min-h-48 anim-fade-in-up`} style={{ animationDelay: `${(idx + 2) * 60}ms` }}>
            {idx < 3 && (
              <div className="absolute right-0 top-1/2 translate-x-full -translate-y-1/2 z-10 px-1">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M5 10h10M12 7l3 3-3 3" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
            <div className="flex items-center gap-2 mb-1">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{ backgroundColor: stage.accent }}>
                {stage.num}
              </span>
              <span className="text-sm font-semibold text-gray-800">{stage.label}</span>
            </div>
            <p className="text-xs text-gray-400 mb-4">{stage.sub}</p>
            {stage.items.map((item) => (
              <div key={item.label} className="flex items-start gap-2 bg-white/70 rounded-lg p-2.5" style={{ outline: "1px solid oklch(0 0 0 / 0.06)", outlineOffset: "-1px" }}>
                <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
                  {item.icon === "github" ? (
                    <GithubIcon size={13} className="text-gray-700" />
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <rect x="1.5" y="3.5" width="10" height="7" rx="2" stroke="#6b7280" strokeWidth="1.2" />
                      <path d="M4.5 3.5V3a2 2 0 014 0v.5" stroke="#6b7280" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-700">{item.label}</p>
                  <p className="text-xs text-gray-400 leading-snug">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <button type="button" onClick={onOpenFactory} className={`${BTN_PRIMARY} px-6 py-2.5`}>
        Open factory
      </button>
    </div>
  );
}
