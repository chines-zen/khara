import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchGongCalls, type GongCall } from "@/lib/api/gong-calls";

function formatCallDate(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  date.setDate(date.getDate() + 1);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function renderPoint(point: unknown) {
  if (typeof point === "string") return point;
  try {
    return JSON.stringify(point);
  } catch {
    return String(point);
  }
}

function stripBulletPrefix(value: string) {
  return value.replace(/(^|\n)\s*-\s+/g, "$1").replace(/:\s*-\s+/g, ": ");
}

function flattenJson(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJson(item, prefix));
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      flattenJson(item, prefix ? `${prefix}: ${key}` : key),
    );
  }

  const text = value == null ? "" : String(value);
  if (!text) return [];
  return [stripBulletPrefix(prefix ? `${prefix}: ${text}` : text)];
}

function NextSteps({ value }: { value: string }) {
  try {
    const parsed = JSON.parse(value);
    if (parsed !== null && typeof parsed === "object") {
      const items = flattenJson(parsed);
      if (items.length > 0) {
        return (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-zd-dark/85">
            {items.map((item, index) => (
              <li key={`next-step-${index}`}>{item}</li>
            ))}
          </ul>
        );
      }
    }
  } catch {
    // Plain-text next steps are rendered below.
  }

  return (
    <p className="whitespace-pre-line text-sm leading-relaxed text-zd-dark/85">
      {value}
    </p>
  );
}

function Attendees({ attendees }: { attendees: GongCall["attendees"] }) {
  const isZendeskAttendee = (attendee: GongCall["attendees"][number]) =>
    attendee.company.trim().toLowerCase().startsWith("zendesk");
  const zendeskAttendees = attendees.filter(isZendeskAttendee);
  const otherAttendees = attendees.filter(
    (attendee) => !isZendeskAttendee(attendee),
  );

  const attendeeList = (items: GongCall["attendees"]) =>
    items.length > 0 ? (
      <ul className="space-y-1 text-sm leading-relaxed text-zd-dark/85">
        {items.map((attendee, index) => (
          <li key={`${attendee.name}-${attendee.company}-${index}`}>
            {attendee.name}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-zd-teal/50">None</p>
    );

  return (
    <div>
      <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-zd-dark">
        Attendees ({attendees.length})
      </h5>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h6 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zd-dark/70">
            Zendesk
          </h6>
          {attendeeList(zendeskAttendees)}
        </div>
        <div>
          <h6 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zd-dark/70">
            Client
          </h6>
          {attendeeList(otherAttendees)}
        </div>
      </div>
    </div>
  );
}

function CallDetails({ call }: { call: GongCall }) {
  return (
    <div className="grid gap-5 border-t border-zd-border/50 bg-zd-bg/40 px-4 py-4">
      <Attendees attendees={call.attendees} />
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-zd-dark">
            Next Steps
          </h5>
          <NextSteps value={call.nextSteps} />
        </div>
        <div>
          <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-zd-dark">
            Brief
          </h5>
          <p className="whitespace-pre-line text-sm leading-relaxed text-zd-dark/85">
            {call.brief}
          </p>
        </div>
      </div>
      <div>
        <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-zd-dark">
          Key Points
        </h5>
        {call.keyPoints.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-zd-dark/85">
            {call.keyPoints.map((point, index) => (
              <li key={`${call.conversationKey}-point-${index}`}>
                {renderPoint(point)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zd-teal/50">No key points available.</p>
        )}
      </div>
    </div>
  );
}

export function GongCallsSection({ oppId }: { oppId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["gongCalls", oppId],
    queryFn: () => fetchGongCalls(oppId),
    retry: false,
  });
  const calls = useMemo(() => data?.calls ?? [], [data]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpanded(
      calls.length > 0 ? new Set([calls[0].conversationKey]) : new Set(),
    );
  }, [oppId, calls]);

  const toggle = (conversationKey: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(conversationKey)) next.delete(conversationKey);
      else next.add(conversationKey);
      return next;
    });
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h4 className="text-base font-bold uppercase tracking-widest text-zd-dark">
          Recent Gong Calls
        </h4>
        <span className="text-[10px] uppercase tracking-wider text-zd-teal/50">
          Last 30 days
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-zd-teal/50">Loading Gong calls…</p>
      ) : isError ? (
        <p className="text-sm text-red-600">
          {(error as Error)?.message || "Failed to load Gong calls."}
        </p>
      ) : calls.length === 0 ? (
        <p className="text-sm text-zd-teal/50">
          No Gong calls found for this opportunity.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-zd-border/70">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zd-bg text-left text-[10px] uppercase tracking-widest text-zd-teal/60">
                <th className="w-8 px-3 py-2" aria-label="Expand" />
                <th className="px-3 py-2 font-bold">Date</th>
                <th className="px-3 py-2 font-bold">Call</th>
                <th className="px-3 py-2 text-right font-bold">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zd-border">
              {calls.map((call) => {
                const isExpanded = expanded.has(call.conversationKey);
                return (
                  <Fragment key={call.conversationKey}>
                    <tr
                      onClick={() => toggle(call.conversationKey)}
                      className="cursor-pointer transition-colors hover:bg-zd-bg/60"
                    >
                      <td className="px-3 py-3 text-zd-teal/60">
                        {isExpanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-zd-dark/75">
                        {formatCallDate(call.callDate)}
                      </td>
                      <td className="truncate px-3 py-3 font-medium text-zd-dark">
                        {call.title}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <a
                          href={call.gongUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex text-zd-teal hover:text-zd-dark"
                          aria-label={`Open ${call.title} in Gong`}
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={4} className="p-0">
                          <CallDetails call={call} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
