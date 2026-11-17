import { Check } from 'lucide-react'

export type StepItem = { label: string; detail?: string }

type StepperProps = {
  steps: StepItem[]
  currentStep: number
  orientation?: 'horizontal' | 'vertical'
}

export function Stepper({ steps, currentStep, orientation = 'horizontal' }: StepperProps) {
  return (
    <ol
      className={`steps ${orientation === 'vertical' ? 'steps-vertical' : 'steps-horizontal'} w-full`}
      aria-label="Progress"
    >
      {steps.map((step, index) => {
        const complete = index < currentStep
        const active = index === currentStep
        return (
          <li
            className={`step ${complete || active ? 'step-primary' : ''}`}
            key={step.label}
            aria-current={active ? 'step' : undefined}
          >
            <span className="step-label flex flex-col gap-1 text-left">
              <span className="text-xs font-semibold">
                {complete ? <Check className="inline size-3.5" aria-label="Complete" /> : null}
                {step.label}
              </span>
              {step.detail && <span className="text-xs text-base-content/55">{step.detail}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
