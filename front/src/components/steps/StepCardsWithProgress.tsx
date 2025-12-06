import { Progress } from "@heroui/react";

import StepCard from "./StepCard";

type Step = { title: string; description?: string };

type Props = {
  steps: Step[];
  currentStep?: number; // 1-based
  color?: "primary" | "warning" | "danger" | string;
  className?: string;
  onStepClick?: (index: number) => void; // 0-based
};

export default function StepCardsWithProgress({
  steps,
  currentStep = 1,
  color = "warning",
  className = "",
  onStepClick,
}: Props) {
  const total = steps.length;
  const value = Math.max(0, Math.min(total, currentStep));

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">Pasos</div>
        <div className="text-sm text-default-500">
          {value} de {total}
        </div>
      </div>

      <Progress
        className="w-full"
        color={color as any}
        maxValue={total}
        showValueLabel={false}
        size="sm"
        value={value}
      />

      <div className="mt-4 space-y-3">
        {steps.map((s, idx) => {
          const index1 = idx + 1;
          const completed = index1 < value;
          const active = index1 === value;

          return (
            <StepCard
              key={idx}
              active={active}
              completed={completed}
              onClick={() => onStepClick && onStepClick(idx)}
            >
              <div className="flex items-start gap-3 w-full">
                <div className="flex-shrink-0">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border ${completed ? "bg-warning border-warning" : active ? "ring-2 ring-warning-500 border-warning-500" : "border-default-300"}`}
                  >
                    {completed ? (
                      <svg
                        className="w-5 h-5 text-black"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M5 13l4 4L19 7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                        />
                      </svg>
                    ) : (
                      <div
                        className={`${active ? "text-warning-400 font-semibold" : "text-default-500"}`}
                      >
                        {index1}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 w-full">
                  <div className={`font-medium ${active ? "text-white" : ""}`}>
                    {s.title}
                  </div>
                  {s.description && (
                    <div className="text-sm text-default-500">
                      {s.description}
                    </div>
                  )}
                </div>
              </div>
            </StepCard>
          );
        })}
      </div>
    </div>
  );
}
