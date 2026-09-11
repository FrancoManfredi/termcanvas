/**
 * FlowBar — Ola 2 P0-3: flujo horizontal Intake → Foreman → Building → Review → Complete con rama Triage.
 * Activo destacado (ring + pulse), rama Triage resaltada si status===Triage, polling 2.5s vivo.
 * Puro Tailwind, flex row, círculos + conectores, rama absoluta bajo Foreman.
 */

import type { WorkItemStatus } from "../../../../shared/types/workItem";
import { FLOW_LINEAR_STAGES, FLOW_STEPS, TRIAGE_STEP } from "../../../../shared/types/flow";
import type { VerificationReport } from "../../../../shared/types/implement";

interface FlowBarProps {
  currentStatus: WorkItemStatus;
  verification?: VerificationReport | null;
  resultStatus?: "pass" | "fail" | null;
  /** Ola 4: veredicto del último review (para badge en paso Review). */
  reviewVerdict?: "accept" | "revise" | "ask_human" | null;
  /** Ola 4: revisiones consumidas (0..2). */
  reviewCount?: number | null;
  className?: string;
}

function statusToIndex(status: WorkItemStatus): number {
  const idx = FLOW_LINEAR_STAGES.indexOf(status as typeof FLOW_LINEAR_STAGES[number]);
  return idx;
}

function getStepState(
  currentStatus: WorkItemStatus,
  stepId: string,
): "active" | "completed" | "pending" | "triage-active" {
  if (currentStatus === stepId) return "active";
  if (currentStatus === "Triage" && stepId === "Triage") return "triage-active";
  // For Triage, linear steps after Foreman are pending (attenuated)
  if (currentStatus === "Triage") {
    if (stepId === "Intake") return "completed";
    return "pending";
  }
  const currIdx = statusToIndex(currentStatus);
  const stepIdx = FLOW_LINEAR_STAGES.indexOf(stepId as typeof FLOW_LINEAR_STAGES[number]);
  if (currIdx === -1) {
    // Cancelled or unknown
    if (currentStatus === "Cancelled") return "pending";
    return "pending";
  }
  if (stepIdx < currIdx) return "completed";
  if (stepIdx > currIdx) return "pending";
  return "pending";
}

function StepCircle({
  state,
  label,
}: {
  state: "active" | "completed" | "pending" | "triage-active";
  label: string;
}) {
  const base = "flex h-8 w-8 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-all";
  if (state === "active") {
    return (
      <div className={`${base} border-blue-600 bg-blue-100 text-blue-800 ring-2 ring-blue-500 ring-offset-2 animate-pulse`}>
        ●
      </div>
    );
  }
  if (state === "triage-active") {
    return (
      <div className={`${base} border-amber-500 bg-amber-100 text-amber-800 ring-2 ring-amber-500 ring-offset-2 animate-pulse`}>
        !
      </div>
    );
  }
  if (state === "completed") {
    return <div className={`${base} border-green-500 bg-green-500 text-white`}>✓</div>;
  }
  return <div className={`${base} border-zinc-300 bg-zinc-100 text-zinc-500`}>{label[0]}</div>;
}

function Connector({ state }: { state: "completed" | "pending" | "active" }) {
  if (state === "completed") return <div className="h-0.5 flex-1 bg-green-500" />;
  return <div className="h-0.5 flex-1 bg-zinc-200" />;
}

export function FlowBar({ currentStatus, verification, resultStatus, reviewVerdict, reviewCount, className }: FlowBarProps) {
  const isTriage = currentStatus === "Triage";
  const isCancelled = currentStatus === "Cancelled";
  const isBuilding = currentStatus === "Building";
  const isReview = currentStatus === "Review";
  const isComplete = currentStatus === "Complete";
  // Derive pass/fail from verification or resultStatus
  const isPass = resultStatus === "pass" || verification?.overall === "pass";
  const isFail = resultStatus === "fail" || verification?.overall === "fail";
  void isPass;
  void isFail;

  return (
    <div className={`relative ${className ?? ""}`} aria-label="Flujo WorkItem" role="region">
      <div className="overflow-x-auto">
        <div className="w-full px-2 py-4">
          {/* Linear flow */}
          <div className="relative flex items-center justify-between">
            {FLOW_STEPS.map((step, idx) => {
              const state = getStepState(currentStatus, step.id);
              // For triage, attenuate linear path after Foreman
              const attenuatedTri = isTriage && idx > 1;
              // Ola4: Review es paso real (Building→Review→Complete). Solo atenuar mientras Building (pendiente).
              const isReviewStep = step.id === "Review";
              const attenuatedReview = isReviewStep && isBuilding ? "opacity-40" : "";
              const attenuated = attenuatedTri ? "opacity-40" : attenuatedReview;
              const isLast = idx === FLOW_STEPS.length - 1;
              const isBuildingStep = step.id === "Building";
              return (
                <div
                  key={step.id}
                  className={`flex flex-1 flex-col items-center ${attenuated}`}
                  aria-current={state === "active" ? "step" : undefined}
                >
                  <div className="relative flex w-full items-center">
                    {idx > 0 ? (
                      <Connector
                        state={getStepState(currentStatus, FLOW_STEPS[idx - 1].id) === "completed" ? "completed" : "pending"}
                      />
                    ) : (
                      <div className="flex-1" />
                    )}
                    <StepCircle state={state} label={step.label} />
                    {!isLast ? (
                      <Connector
                        state={state === "completed" || getStepState(currentStatus, step.id) === "completed" ? "completed" : "pending"}
                      />
                    ) : (
                      <div className="flex-1" />
                    )}
                  </div>
                  <div className={`mt-2 text-center ${state === "active" ? "font-bold text-blue-700" : state === "triage-active" ? "font-bold text-amber-700" : state === "completed" ? "font-semibold text-green-700" : "text-zinc-500"}`}>
                    <div className="text-xs flex items-center justify-center gap-1">
                      {step.label}
                      {isBuildingStep && isBuilding ? (
                        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-blue-600" aria-hidden="true" />
                      ) : null}
                      {step.id === "Review" && isReview ? (
                        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-purple-600" aria-hidden="true" />
                      ) : null}
                    </div>
                    <div className="text-[11px] font-normal">
                      {isBuildingStep && isBuilding
                        ? "Implementando…"
                        : step.id === "Review" && isReview
                          ? "Revisando…"
                          : step.description}
                    </div>
                    {isBuildingStep && isBuilding ? (
                      <div className="mt-1 inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 border border-blue-200 animate-pulse">
                        linux-build
                      </div>
                    ) : null}
                    {step.id === "Review" && isReview ? (
                      <div className="mt-1 inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800 border border-purple-200 animate-pulse">
                        revisor read-only
                      </div>
                    ) : null}
                    {step.id === "Review" && isReview && reviewVerdict ? (
                      <div
                        className={`mt-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${
                          reviewVerdict === "accept"
                            ? "bg-green-600"
                            : reviewVerdict === "revise"
                              ? "bg-amber-500"
                              : "bg-red-600"
                        }`}
                        aria-label={`veredicto ${reviewVerdict}`}
                      >
                        {reviewVerdict}
                        {typeof reviewCount === "number" ? ` · ${reviewCount}/2` : ""}
                      </div>
                    ) : step.id === "Review" && isReview && typeof reviewCount === "number" && reviewCount > 0 ? (
                      <div className="mt-1 inline-flex items-center rounded-full bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        R{reviewCount}/2
                      </div>
                    ) : null}
                    {step.id === "Complete" && isComplete ? (
                      isPass ? (
                        <div className="mt-1 inline-flex items-center rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">pass</div>
                      ) : isFail ? (
                        <div className="mt-1 inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">fail</div>
                      ) : (
                        <div className="mt-1 inline-flex items-center rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">✓ .done</div>
                      )
                    ) : null}
                  </div>
                  {/* Highlight Foreman when triage is source */}
                  {step.id === "Foreman" && isTriage ? (
                    <div className="mt-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
                      rama Triage
                    </div>
                  ) : null}
                  {step.id === "Triage" && isTriage && isFail ? (
                    <div className="mt-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
                      fail
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Triage branch — absolute below Foreman */}
          <div className="relative mt-2 h-16">
            {/* Connector from Foreman down to Triage */}
            <div
              className={`absolute left-[20%] top-0 h-6 w-0.5 ${isTriage ? "bg-amber-500" : "bg-zinc-200"} ${isTriage ? "opacity-100" : "opacity-40"}`}
              aria-hidden="true"
              style={{ marginLeft: "calc(10% - 1px)" }}
            />
            <div
              className={`absolute left-[20%] top-6 h-0.5 w-[12%] ${isTriage ? "bg-amber-500" : "bg-zinc-200"} ${isTriage ? "opacity-100" : "opacity-40"}`}
              aria-hidden="true"
              style={{ marginLeft: "calc(10% - 1px)" }}
            />
            <div
              className={`absolute left-[22%] top-6 flex flex-col items-center ${isTriage ? "opacity-100" : "opacity-60"}`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${
                    isTriage
                      ? "border-amber-500 bg-amber-100 text-amber-800 ring-2 ring-amber-500 ring-offset-2"
                      : "border-zinc-300 bg-zinc-50 text-zinc-500"
                  } ${isTriage ? "animate-pulse" : ""}`}
                  aria-current={isTriage ? "step" : undefined}
                >
                  !
                </div>
                <div className={`text-xs ${isTriage ? "font-bold text-amber-700" : "text-zinc-500"}`}>
                  {TRIAGE_STEP.label}
                  <span className="ml-1 text-[11px] font-normal text-zinc-500">— {TRIAGE_STEP.description}</span>
                  {isTriage ? (
                    <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">ACTIVO</span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Cancelled indicator far right if needed */}
            {isCancelled ? (
              <div className="absolute right-0 top-6 rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 border border-red-200">
                Cancelled
              </div>
            ) : null}
          </div>

          {/* Legend Ola3 */}
          <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500" /> completado
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-600 ring-1 ring-blue-500 animate-pulse" /> Building/Implementando
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> triage
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="rounded bg-green-600 px-1 py-0.5 text-[10px] font-bold text-white">pass</span>
              <span className="rounded bg-amber-500 px-1 py-0.5 text-[10px] font-bold text-white">fail</span>
            </span>
            <span className="ml-auto text-[11px] text-zinc-400">polling 2.5s</span>
          </div>
        </div>
      </div>

      {/* Aria live for status changes */}
      <div aria-live="polite" className="sr-only">
        Estado actual: {currentStatus}
      </div>
    </div>
  );
}

export default FlowBar;
