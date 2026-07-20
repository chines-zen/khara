export async function fetchHiddenOpportunities(): Promise<string[]> {
  const response = await fetch("/api/hidden-opportunities", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch hidden opportunities");
  }

  const data = await response.json();
  return data.hiddenOpportunityIds;
}
