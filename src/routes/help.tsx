import { createFileRoute, Link } from "@tanstack/react-router";
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
    { name: "Metrics", description: "Overview of your business", to: "/" },
    {
      name: "Opportunities",
      description:
        "See your SFDC notes, D-Scores, and Gong calls, all in one place. Generate an AI summary to get a 360 view of the opp health.",
      to: "/opportunities",
    },
    {
      name: "Punch List",
      description: "Curated list of opps that need your attention.",
      to: "/punch-list",
    },
    ...(isManager
      ? []
      : [
          {
            name: "Blind Spots",
            description: "Opps that may have slipped under the radar.",
            to: "/blind-spots",
          },
        ]),
    {
      name: "Activities",
      description: "All of your hard work!",
      to: "/activities",
    },
  ];

  return (
    <main className="p-6 space-y-4">
      <div className="rounded border border-zd-border bg-white p-6">
        <h2 className="text-lg font-semibold text-zd-dark">Help</h2>
        <p className="mt-1 text-sm text-zd-teal/70">
          See{" "}
          <a
            href="https://docs.google.com/presentation/d/1-1Ej7rSpKAWKSRiDK7ZVASCoe2CNPYdURBs0aGhOB2I/edit?usp=sharing"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-zd-teal"
          >
            this deck
          </a>{" "}
          for more info.
        </p>
        <p className="mt-1 text-sm text-zd-teal/70">
          Contact @chines on Slack with questions / bugs.
        </p>
      </div>

      <div className="rounded border border-zd-border bg-white divide-y divide-zd-border">
        {sections.map(({ name, description, to }) => (
          <Link
            key={name}
            to={to}
            className="block px-6 py-4 transition-colors hover:bg-zd-bg"
          >
            <h3 className="text-sm font-semibold text-zd-dark">{name}</h3>
            <p className="mt-1 text-sm text-zd-teal/80">{description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
