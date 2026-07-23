import { Fragment, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Minus,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  fetchDispassionateReviews,
  type DScoreReview,
} from "@/lib/api/dispassionate-reviews";
import { formatDisplayDate } from "@/lib/utils";

// Each expanded row shows one score dimension. Note the score/notes key
// asymmetry: the `competitiveness` score pairs with the `otherCompetitors` note.
const DIMENSIONS: {
  title: string;
  scoreKey: keyof DScoreReview["scores"];
  noteKey: keyof DScoreReview["notes"];
}[] = [
  { title: "Discovery", scoreKey: "discovery", noteKey: "discovery" },
  { title: "IT Alignment", scoreKey: "itAlignment", noteKey: "itAlignment" },
  { title: "Services", scoreKey: "services", noteKey: "services" },
  { title: "Partner", scoreKey: "partner", noteKey: "partner" },
  { title: "Architecture", scoreKey: "architecture", noteKey: "architecture" },
  { title: "Security", scoreKey: "security", noteKey: "security" },
  { title: "Solution Fit", scoreKey: "solutionFit", noteKey: "solutionFit" },
  { title: "Integration", scoreKey: "integration", noteKey: "integration" },
  {
    title: "Other Comps",
    scoreKey: "competitiveness",
    noteKey: "otherCompetitors",
  },
  { title: "Net Value", scoreKey: "netValue", noteKey: "netValue" },
  { title: "Advanced Demo", scoreKey: "advancedDemo", noteKey: "advancedDemo" },
  {
    title: "Testing Access",
    scoreKey: "testingAccess",
    noteKey: "testingAccess",
  },
  { title: "Exec Goals", scoreKey: "execGoals", noteKey: "execGoals" },
];

// yyyy-mm-dd portion of an ISO timestamp (chart x-axis + table date column).
function toDateOnly(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

// Sub-scores are stored as text like "1- Basic discovery ..." / "2 - 71% to
// 85%"; the numeric sub-score is the leading digit (same rule the backend uses
// to compute summed_d_score). Returns null when there's no digit to compare.
function leadingDigit(value: string | null): number | null {
  if (value == null) return null;
  const match = String(value).match(/\d/);
  return match ? Number(match[0]) : null;
}

// Split a score value like "2 - Detailed discovery ..." or "1- Basic ..." into
// its leading number and the trailing description. Falls back to treating the
// whole string as the description if it doesn't match the "N - desc" shape.
function parseScore(value: string | null): {
  score: string | null;
  description: string | null;
} {
  if (value == null) return { score: null, description: null };
  const match = String(value).match(/^\s*(\d+)\s*-\s*(.*)$/s);
  if (!match) return { score: null, description: value.trim() || null };
  return { score: match[1], description: match[2].trim() || null };
}

// Renders a score value as "X (description)" with the description italic and a
// touch smaller. The number and description are separate flex items so wrapped
// description lines align under the description, not under the number. Shows an
// em dash when there's no value at all.
function ScoreValue({ value }: { value: string | null }) {
  const { score, description } = parseScore(value);
  if (score == null && description == null) return <span>—</span>;
  return (
    <span className="flex items-start gap-1">
      {score != null && <span className="shrink-0">{score}</span>}
      {description != null && (
        <span className="text-[13px] italic text-zd-dark/70">
          ({description})
        </span>
      )}
    </span>
  );
}

// Green up arrow / red down arrow / blue dash based on current vs previous
// numeric value. Renders nothing when either side is unknown (no baseline).
export function TrendIndicator({
  current,
  previous,
  className = "size-3.5",
}: {
  current: number | null;
  previous: number | null;
  className?: string;
}) {
  if (current == null || previous == null) return null;
  if (current > previous)
    return <ArrowUp className={`${className} shrink-0 text-green-600`} />;
  if (current < previous)
    return <ArrowDown className={`${className} shrink-0 text-red-600`} />;
  return <Minus className={`${className} shrink-0 text-blue-500`} />;
}

function ReviewDetail({
  review,
  previous,
}: {
  review: DScoreReview;
  previous: DScoreReview | null;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-zd-bg text-left text-[10px] uppercase tracking-widest text-zd-teal/60">
          <th className="px-4 py-2 font-bold">Title</th>
          <th className="px-4 py-2 font-bold">Score</th>
          <th className="px-4 py-2 font-bold">Notes</th>
        </tr>
      </thead>
      <tbody>
        {DIMENSIONS.map((dim) => (
          <tr
            key={dim.scoreKey}
            className="border-t border-zd-border/40 align-top"
          >
            <td className="px-4 py-2 font-medium text-zd-dark whitespace-nowrap">
              {dim.title}
            </td>
            <td className="px-4 py-2 text-zd-dark/90">
              <span className="flex items-start gap-1.5">
                <span className="mt-0.5">
                  <TrendIndicator
                    current={leadingDigit(review.scores[dim.scoreKey])}
                    previous={leadingDigit(
                      previous?.scores[dim.scoreKey] ?? null,
                    )}
                  />
                </span>
                <ScoreValue value={review.scores[dim.scoreKey]} />
              </span>
            </td>
            <td className="px-4 py-2 text-zd-dark/80 whitespace-pre-line">
              {review.notes[dim.noteKey] ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DScoreSection({ oppId }: { oppId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dispassionateReviews", oppId],
    queryFn: () => fetchDispassionateReviews(oppId),
    retry: false,
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const reviews = useMemo(() => data?.reviews ?? [], [data]);

  // Chart needs oldest-first, dated scores only. When multiple reviews share a
  // calendar date we plot a single point using the latest one (by full
  // timestamp), so the x-axis stays date-only without duplicate points.
  const chartData = useMemo(() => {
    const dated = reviews
      .map((r) => ({
        ts: r.validFromTimestamp,
        date: toDateOnly(r.validFromTimestamp),
        score: r.summedDScore,
      }))
      .filter(
        (d): d is { ts: string; date: string; score: number } =>
          d.ts !== null && d.date !== null && d.score !== null,
      )
      .sort((a, b) => a.ts.localeCompare(b.ts));

    // Keep the last (latest timestamp) score per date.
    const latestByDate = new Map<string, number>();
    for (const d of dated) latestByDate.set(d.date, d.score);

    return Array.from(latestByDate, ([date, score]) => ({ date, score }));
  }, [reviews]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  return (
    <section className="border border-zd-border rounded p-4">
      <h4 className="text-base font-bold text-zd-dark uppercase tracking-widest mb-4">
        D-Score Over Time
      </h4>

      {isLoading ? (
        <p className="text-sm text-zd-teal/50">Loading D-Score history…</p>
      ) : isError ? (
        <p className="text-sm text-red-600">
          {(error as Error)?.message || "Failed to load D-Score history."}
        </p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-zd-teal/50">
          No D-Score reviews found for this opportunity.
        </p>
      ) : (
        <>
          {/* Summed D-Score over time */}
          {chartData.length > 0 && (
            <div className="h-64 w-full mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e5e7eb"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#5b7a89" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#5b7a89" }}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip formatter={(v: number) => [v, "D-Score"]} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#17494d"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Reviews table - click a row to expand its per-dimension scores */}
          <div className="border border-zd-border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zd-bg/50 border-b border-zd-border">
                <tr className="text-left text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                  <th className="px-4 py-2 w-8" />
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 text-right">Summed D-Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zd-border">
                {reviews.map((review, i) => {
                  const isOpen = expanded.has(review.id);
                  const dateOnly = toDateOnly(review.validFromTimestamp);
                  // API is newest-first, so the chronologically prior review is
                  // the next one in the list (null for the oldest review).
                  const previous = reviews[i + 1] ?? null;
                  return (
                    <Fragment key={review.id}>
                      <tr
                        onClick={() => toggle(review.id)}
                        className="hover:bg-zd-bg/60 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-2 text-zd-teal/60">
                          {isOpen ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono text-zd-teal/80 whitespace-nowrap">
                          {dateOnly ? formatDisplayDate(dateOnly) : "—"}
                        </td>
                        <td className="px-4 py-2 font-mono text-zd-dark">
                          <span className="flex items-center justify-end gap-1.5">
                            <TrendIndicator
                              current={review.summedDScore}
                              previous={previous?.summedDScore ?? null}
                            />
                            <span>{review.summedDScore ?? "—"}</span>
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-zd-bg/30">
                          <td colSpan={3} className="p-0">
                            <ReviewDetail review={review} previous={previous} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
