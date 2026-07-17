import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getDefaultCloseDateRange } from "@/lib/fiscal-quarter";

export type OppScopeSettings = {
  arrThreshold: number;
  closeDateFrom: string | null;
  closeDateTo: string | null;
};

export const DEFAULT_ARR_THRESHOLD = 50000;

type Props = {
  open: boolean;
  onSave: (settings: OppScopeSettings) => Promise<void>;
};

export function OppScopeOnboardingDialog({ open, onSave }: Props) {
  const recommendedRange = getDefaultCloseDateRange();

  const [arrThreshold, setArrThreshold] = useState(String(DEFAULT_ARR_THRESHOLD));
  const [useRecommendedRange, setUseRecommendedRange] = useState(true);
  const [closeDateFrom, setCloseDateFrom] = useState(recommendedRange.from);
  const [closeDateTo, setCloseDateTo] = useState(recommendedRange.to);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        arrThreshold: Number(arrThreshold) || DEFAULT_ARR_THRESHOLD,
        closeDateFrom: useRecommendedRange ? null : closeDateFrom,
        closeDateTo: useRecommendedRange ? null : closeDateTo,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="bg-white border-zd-border text-zd-dark sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zd-dark">Set up your opportunity view</DialogTitle>
          <DialogDescription className="text-zd-teal/70">
            Choose the ARR floor and close-date window used to scope which
            opportunities you see. You can change these later in Settings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider mb-1">
              ARR Minimum
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-zd-teal/50">$</span>
              <input
                type="number"
                min={0}
                value={arrThreshold}
                onChange={(e) => setArrThreshold(e.target.value)}
                className="w-full bg-white border border-zd-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider mb-1">
              Close Date Range
            </label>

            <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={useRecommendedRange}
                onChange={(e) => setUseRecommendedRange(e.target.checked)}
                className="w-3.5 h-3.5 cursor-pointer"
              />
              <span>
                Use recommended range ({recommendedRange.from} to {recommendedRange.to})
              </span>
            </label>

            {!useRecommendedRange && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={closeDateFrom}
                  onChange={(e) => setCloseDateFrom(e.target.value)}
                  className="flex-1 bg-white border border-zd-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
                />
                <span className="text-zd-teal/50 text-xs">to</span>
                <input
                  type="date"
                  value={closeDateTo}
                  onChange={(e) => setCloseDateTo(e.target.value)}
                  className="flex-1 bg-white border border-zd-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
                />
              </div>
            )}
          </div>

          <div className="pt-2 flex items-center justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-zd-green text-zd-dark rounded hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? "Saving..." : "Get Started"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
