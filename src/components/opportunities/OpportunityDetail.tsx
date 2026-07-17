import { useRef, useState, useLayoutEffect, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Opportunity } from "@/lib/opportunities";

const fmt = (n: number) => `$${n.toLocaleString()}`;

function buildDScoreHistory(opp: Opportunity) {
  // Synthesize 5 mock entries ending at the current score.
  // recentDScoreDate only exists on mock data; live Snowflake opps fall
  // back to lastUpdateDate/closeDate, then today, to avoid an invalid Date.
  const rawEndDate =
    (opp as { recentDScoreDate?: string }).recentDScoreDate ||
    opp.lastUpdateDate ||
    opp.closeDate;
  const parsedEnd = rawEndDate ? new Date(rawEndDate) : new Date();
  const end = Number.isNaN(parsedEnd.getTime()) ? new Date() : parsedEnd;
  const entries: { date: string; score: number }[] = [];
  let score = opp.dScore;
  for (let i = 0; i < 5; i++) {
    const d = new Date(end);
    d.setDate(end.getDate() - i * 14);
    entries.push({ date: d.toISOString().slice(0, 10), score: Math.max(0, Math.min(100, score)) });
    // walk backwards using delta-like steps
    const step = ((opp.dScoreDelta || 3) + (i % 2 === 0 ? 4 : -2));
    score = score - step;
  }
  return entries.reverse();
}

function NoteBlock({ label, body }: { label: string; body: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflows(el.scrollHeight - 1 > el.clientHeight);
  }, [body]);

  return (
    <section>
      <h4 className="text-[10px] font-bold text-zd-teal/40 uppercase tracking-widest mb-2">
        {label}
      </h4>
      <p
        ref={ref}
        className={`text-sm leading-relaxed text-zd-dark/80 bg-zd-bg p-3 rounded border border-zd-border/50 min-h-[64px] whitespace-pre-line ${
          expanded ? "" : "line-clamp-[8]"
        }`}
      >
        {body}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zd-teal/70 hover:text-zd-dark transition-colors"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </section>
  );
}

type Props = {
  opp: Opportunity;
  isHidden?: boolean;
};

export function OpportunityDetail({ opp, isHidden: initialIsHidden = false }: Props) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showDateHelp, setShowDateHelp] = useState(false);
  const [isHidden, setIsHidden] = useState(initialIsHidden);

  // Update local state when prop changes
  useEffect(() => {
    setIsHidden(initialIsHidden);
  }, [initialIsHidden, opp.id]);

  // Reset summary state when switching opportunities — no fetch, generation is click-only
  useEffect(() => {
    setSummary(null);
    setGeneratedAt("");
  }, [opp.id]);

  const history = buildDScoreHistory(opp);
  const maxScore = Math.max(...history.map((h) => h.score), 100);
  const latest = history[history.length - 1];

  // Check if there's a parsing error (notes exist but no date found)
  const hasParsingError = !opp.lastUpdateDate && opp.scNotes && opp.scNotes.trim() !== '';

  const handleGenerateSummary = async () => {
    try {
      setIsGenerating(true);
      const response = await fetch(`/api/opportunities/${opp.id}/summary`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (response.ok) {
        setSummary(data.summary);
        setGeneratedAt(new Date(data.generatedAt).toLocaleDateString());
      } else {
        setSummary("Unable to generate summary. Please try again.");
      }
    } catch (error) {
      console.error('Failed to fetch summary:', error);
      setSummary("Error loading summary.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateSummary = async () => {
    try {
      setIsRegenerating(true);
      const response = await fetch(`/api/opportunities/${opp.id}/summary?regenerate=true`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (response.ok) {
        setSummary(data.summary);
        setGeneratedAt(new Date(data.generatedAt).toLocaleDateString());
      } else {
        setSummary("Unable to regenerate summary. Please try again.");
      }
    } catch (error) {
      console.error('Failed to regenerate summary:', error);
      setSummary("Error regenerating summary.");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleHideToggle = async (checked: boolean) => {
    try {
      if (checked) {
        // Hide opportunity
        await fetch(`/api/hidden-opportunities/${opp.id}`, {
          method: 'POST',
          credentials: 'include',
        });
      } else {
        // Unhide opportunity
        await fetch(`/api/hidden-opportunities/${opp.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      }
      setIsHidden(checked);

      // Invalidate the hidden opportunities query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['hiddenOpportunities'] });
    } catch (error) {
      console.error('Failed to toggle hidden state:', error);
    }
  };

  // Map Snowflake fields to display, with fallback for null/empty values
  const aeNotes = opp.nextSteps || "No data available";
  const aeMgrNotes = opp.managerNotes || "No data available";
  const overlayNotes = opp.productSpecialistNotes || "No data available";
  const engagementType = opp.scEngagementType || "No data available";

  return (
    <div
      key={opp.id}
      className="col-span-7 flex flex-col h-full min-h-0 min-w-0 bg-white animate-row"
    >
      {/* Header */}
      <div className="p-6 border-b border-zd-border">
        <div className="flex justify-between items-start gap-6 mb-6">
          <h2 className="text-2xl font-bold tracking-tight text-zd-dark truncate flex-1">
            {opp.name}
          </h2>
          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isHidden}
                onChange={(e) => handleHideToggle(e.target.checked)}
                className="w-4 h-4 cursor-pointer"
              />
              <span className="text-sm text-zd-dark">Hide Opp</span>
            </label>
            <a
              href={`https://zendesk.lightning.force.com/lightning/r/Opportunity/${opp.id}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-zd-teal text-white text-xs font-bold rounded hover:bg-zd-dark transition-colors shadow-sm"
            >
              EDIT IN SFDC
            </a>
          </div>
        </div>

        {/* Two rows of fields + D-Score */}
        <div className="grid grid-cols-4 gap-x-8 gap-y-4">
          {/* Row 1 */}
          <div>
            <dt className="text-[10px] font-bold text-zd-teal/40 uppercase tracking-widest">Owner</dt>
            <dd className="text-sm font-medium text-zd-dark mt-1">{opp.owner}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold text-zd-teal/40 uppercase tracking-widest">Account</dt>
            <dd className="text-sm font-medium text-zd-dark mt-1">{opp.account}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold text-zd-teal/40 uppercase tracking-widest">Last SC Update</dt>
            <dd className="text-sm font-medium text-zd-dark mt-1">
              {hasParsingError ? (
                <button
                  onClick={() => setShowDateHelp(true)}
                  className="text-red-600 hover:text-red-700 underline flex items-center gap-1"
                >
                  <AlertCircle className="size-3" />
                  Error - click for help
                </button>
              ) : opp.lastUpdateDate ? (
                opp.lastUpdateDate
              ) : (
                <span className="text-zd-teal/40">No SC notes</span>
              )}
            </dd>
          </div>

          {/* D-Score Tile - spans both rows */}
          <div className="row-span-2 flex items-center justify-center">
            <div className="border border-zd-border rounded-lg p-4 flex flex-col items-center justify-center w-full">
              <h4 className="text-[10px] font-bold text-zd-teal/60 uppercase tracking-widest mb-2">
                D-Score
              </h4>
              <span className={`text-5xl font-bold font-mono ${
                opp.dScore >= 31 ? 'text-green-600' :
                opp.dScore >= 21 ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                {opp.dScore}
              </span>
            </div>
          </div>

          {/* Row 2 */}
          <div>
            <dt className="text-[10px] font-bold text-zd-teal/40 uppercase tracking-widest">ARR</dt>
            <dd className="text-sm font-mono font-medium text-zd-dark mt-1">{fmt(opp.amount)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold text-zd-teal/40 uppercase tracking-widest">Stage</dt>
            <dd className="text-sm font-medium text-zd-dark mt-1">{opp.stage}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold text-zd-teal/40 uppercase tracking-widest">Close Date</dt>
            <dd className="text-sm font-medium text-zd-dark mt-1">{opp.closeDate}</dd>
          </div>
        </div>
      </div>

      {/* Date Format Help Dialog */}
      {showDateHelp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDateHelp(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="size-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-zd-dark mb-2">Date Parsing Error</h3>
                <p className="text-sm text-zd-dark/80 mb-3">
                  The "Last SC Update" field is automatically calculated by scanning the SC Notes for dates.
                  No valid date format was found in the current SC Notes.
                </p>
                <div className="bg-zd-bg rounded p-3 mb-3">
                  <p className="text-xs font-bold text-zd-teal/60 uppercase tracking-wider mb-2">Supported Date Formats</p>
                  <ul className="text-sm space-y-1 text-zd-dark/80 font-mono">
                    <li>• MM/DD/YYYY (e.g., 05/26/2026)</li>
                    <li>• M/D/YY (e.g., 5/26/26)</li>
                    <li>• MM-DD-YYYY (e.g., 05-26-2026)</li>
                    <li>• MM.DD.YYYY (e.g., 05.26.2026)</li>
                  </ul>
                </div>
                <p className="text-sm text-zd-dark/80">
                  Please ensure your SC Notes include dates in one of these standard formats at the beginning of each update entry.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setShowDateHelp(false)}
                className="px-4 py-2 bg-zd-teal text-white text-xs font-bold rounded hover:bg-zd-dark transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Opp Summary */}
        <section className="border border-zd-border rounded p-4 bg-gradient-to-br from-zd-bg to-white">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold text-zd-teal/40 uppercase tracking-widest">
              Opp Summary
            </h4>
            <span className="text-[10px] uppercase tracking-wider text-zd-green font-bold">AI</span>
          </div>
          <p className="text-sm leading-relaxed text-zd-dark/85 whitespace-pre-line">
            {isGenerating ? (
              <span className="text-zd-teal/50 animate-pulse">Generating summary...</span>
            ) : isRegenerating ? (
              <span className="text-zd-teal/50 animate-pulse">Regenerating summary...</span>
            ) : summary === null ? (
              <span className="text-zd-teal/50">No summary generated yet.</span>
            ) : (
              summary
            )}
          </p>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11px] italic text-zd-teal/50">
              {summary !== null ? `Generated by Gemini on ${generatedAt || "N/A"}` : ""}
            </p>
            {summary === null ? (
              <button
                onClick={handleGenerateSummary}
                disabled={isGenerating}
                className="text-[10px] font-bold uppercase tracking-wider text-zd-teal hover:text-zd-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? "Generating..." : "Generate Summary"}
              </button>
            ) : (
              <button
                onClick={handleRegenerateSummary}
                disabled={isRegenerating}
                className="text-[10px] font-bold uppercase tracking-wider text-zd-teal hover:text-zd-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRegenerating ? "Regenerating..." : "Regenerate Summary"}
              </button>
            )}
          </div>
        </section>

        {/* Two columns of notes */}
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <NoteBlock label="SC Notes" body={opp.scNotes} />
            <NoteBlock label="SC Manager Notes" body={opp.scManagerNotes} />
            <NoteBlock label="SC Engagement Type" body={engagementType} />
          </div>
          <div className="space-y-4">
            <NoteBlock label="AE Notes" body={aeNotes} />
            <NoteBlock label="AE Manager Notes" body={aeMgrNotes} />
            <NoteBlock label="PreSales Specialist Notes" body={overlayNotes} />
          </div>
        </div>

        {/* Keep any remaining content below */}
        <div className="hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zd-bg text-[10px] uppercase tracking-widest text-zd-teal/60">
                <th className="text-left px-4 py-2 font-bold">Date</th>
                <th className="text-left px-4 py-2 font-bold">Score</th>
                <th className="text-left px-4 py-2 font-bold">Δ</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => {
                const prev = i > 0 ? history[i - 1].score : h.score;
                const delta = h.score - prev;
                return (
                  <tr key={h.date} className="border-t border-zd-border/60">
                    <td className="px-4 py-2 font-mono text-zd-dark/80">{h.date}</td>
                    <td className="px-4 py-2 font-mono text-zd-dark">{h.score}</td>
                    <td className={`px-4 py-2 font-mono ${delta > 0 ? "text-zd-green" : delta < 0 ? "text-red-500" : "text-zd-teal/40"}`}>
                      {delta > 0 ? "+" : ""}{delta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
