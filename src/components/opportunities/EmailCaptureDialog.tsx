import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onSave: (email: string) => Promise<void>;
};

export function EmailCaptureDialog({ open, onSave }: Props) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to Snowflake");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="bg-white border-zd-border text-zd-dark sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zd-dark">Sign in with your email</DialogTitle>
          <DialogDescription className="text-zd-teal/70">
            Enter your Zendesk email. We&apos;ll open a browser 
            window to sign in to Snowflake through Okta.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@zendesk.com"
              className="w-full bg-white border border-zd-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green placeholder:text-zd-teal/40"
            />
          </div>

          {saving && (
            <p className="text-xs text-zd-teal/70">
              Waiting for Snowflake sign-in in your browser...
            </p>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="pt-2 flex items-center justify-end">
            <button
              type="submit"
              disabled={saving || !email.trim()}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-zd-green text-zd-dark rounded hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? "Connecting..." : "Continue"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
