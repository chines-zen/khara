import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/blind-spots")({
  head: () => ({
    meta: [
      { title: "Blind Spots — KHARA" },
      {
        name: "description",
        content: "Surface potential gaps in opportunity coverage.",
      },
    ],
  }),
  component: BlindSpotsPage,
});

function BlindSpotsPage() {
  return (
    <main className="p-6">
      <div className="rounded border border-zd-border bg-white p-8 text-center">
        <h2 className="text-sm font-semibold text-zd-dark">Blind Spots</h2>
        <p className="mt-2 text-sm text-zd-teal/70">
          This view is coming soon.
        </p>
      </div>
    </main>
  );
}
