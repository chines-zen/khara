export type OnboardingScopeType = "se" | "blind-spot-owner";

export type OnboardingEmailResult = {
  email: string;
  found: boolean;
  userId: string | null;
  fullName: string | null;
  isDirectReport: boolean;
};

export async function validateAndSaveOnboardingScope(
  type: OnboardingScopeType,
  emails: string[],
): Promise<{ results: OnboardingEmailResult[]; savedEmails: string[] }> {
  const response = await fetch("/api/onboarding/validate-scope", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, emails }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      data?.details || data?.error || "Failed to validate onboarding emails",
    );
  }
  return data;
}

export async function completeOnboarding(): Promise<void> {
  const response = await fetch("/api/onboarding/complete", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.details || data?.error || "Failed to complete onboarding",
    );
  }
}
