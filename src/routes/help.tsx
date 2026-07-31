import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help — KHARA" },
      { name: "description", content: "Get help using KHARA." },
    ],
  }),
  component: HelpPage,
});

function HelpPage() {
  return (
    <main className="p-6">
      <div className="rounded border border-zd-border bg-white p-8 text-center">
        <h2 className="text-sm font-semibold text-zd-dark">Help</h2>
        <p className="mt-2 text-sm text-zd-teal/70">
          Help resources are coming soon.
        </p>
      </div>
    </main>
  );
}
