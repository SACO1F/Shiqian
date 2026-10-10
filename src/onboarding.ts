export type OnboardingStep = "ai" | "guide" | "done";

// Installation-local UI state, intentionally independent of library backups.
export const onboardingKey = (library: string) =>
  `shiqian-onboarding:v1:${library}`;

export function readOnboarding(
  storage: Pick<Storage, "getItem">,
  library: string,
): OnboardingStep {
  try {
    const value = storage.getItem(onboardingKey(library));
    return value === "guide" || value === "done" ? value : "ai";
  } catch {
    return "ai";
  }
}

export function saveOnboarding(
  storage: Pick<Storage, "setItem">,
  library: string,
  step: OnboardingStep,
) {
  storage.setItem(onboardingKey(library), step);
}
