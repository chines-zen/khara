export async function fetchUserPreference<T = unknown>(key: string): Promise<T | null> {
  const response = await fetch(`/api/user-preferences/${key}`, {
    credentials: "include",
  });

  if (!response.ok) {
    return null; // Return null if not found
  }

  const data = await response.json();
  return data.value;
}

export async function saveUserPreference(key: string, value: unknown) {
  const response = await fetch(`/api/user-preferences/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ value }),
  });

  if (!response.ok) {
    throw new Error("Failed to save preference");
  }

  return response.json();
}
