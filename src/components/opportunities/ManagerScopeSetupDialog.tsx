import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
};

// Managers rarely have opportunities tied to their own name, so the first data
// sync needs the SEs they manage before it can pull anything meaningful. This
// blocks the app and points them at Settings to enter those SE emails.
export function ManagerScopeSetupDialog({ open }: Props) {
  const navigate = useNavigate();

  return (
    <Dialog open={open}>
      <DialogContent className="bg-white border-zd-border text-zd-dark sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zd-dark">
            Enter SE emails for first time data sync
          </DialogTitle>
          <DialogDescription className="text-zd-teal/70">
            Add the Sales Engineers you manage in Settings so we can pull their
            opportunities. We need at least one SE email before the first data
            sync can run.
          </DialogDescription>
        </DialogHeader>

        <div className="pt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={() => navigate({ to: "/settings" })}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-zd-green text-zd-dark rounded hover:opacity-90 transition-opacity"
          >
            Go to Settings
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
