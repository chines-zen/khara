import { createFileRoute } from "@tanstack/react-router";
import { useIsManager } from "@/hooks/use-is-manager";

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
  const isManager = useIsManager();
  const sections = [
    ["Metrics", "Overview of your business"],
    [
      "Opportunities",
      "See your SFDC notes, D-Scores, and Gong calls, all in one place. Generate an AI summary to get a 360 view of the opp health.",
    ],
    ["Punch List", "Curated list of opps that need your attention."],
    ...(isManager
      ? []
      : [["Blind Spots", "Opps that may have slipped under the radar."]]),
    ["Activities", "All of your hard work!"],
  ];

  return (
    <main className="p-6 space-y-4">
      <div className="rounded border border-zd-border bg-white p-6">
        <h2 className="text-lg font-semibold text-zd-dark">Help</h2>
        <p className="mt-1 text-sm text-zd-teal/70">
          A quick guide to each section. Contact @chines on Slack with
          questions.
        </p>
      </div>

      <div className="rounded border border-zd-border bg-white divide-y divide-zd-border">
        {sections.map(([name, description]) => (
          <div key={name} className="px-6 py-4">
            <h3 className="text-sm font-semibold text-zd-dark">{name}</h3>
            <p className="mt-1 text-sm text-zd-teal/80">{description}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
