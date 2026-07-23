import "../styles.css";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
} from "@tanstack/react-router";
import { EmailCaptureDialog } from "@/components/opportunities/EmailCaptureDialog";
import { ManagerScopeSetupDialog } from "@/components/opportunities/ManagerScopeSetupDialog";
import {
  MANAGER_SCOPE_GATE_QUERY_KEY,
  fetchManagerNeedsScopeSetup,
} from "@/lib/api/manager-scope";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "KHARA" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // index.html already provides <html>/<body>; this mounts into its
  // <div id="root">. React hoists title/meta/link to the real <head>
  // regardless of where they're rendered, so per-route head() tags still
  // apply without needing our own <html>/<head> here.
  return (
    <QueryClientProvider client={queryClient}>
      <HeadContent />
      <EmailSetupGate />
      <ManagerScopeGate />
      <Outlet />
    </QueryClientProvider>
  );
}

// Managers whose account has no SEs configured yet can't run a meaningful first
// sync (their own name rarely owns opps), so block the app behind a dialog that
// sends them to Settings. Clears automatically once SE emails are saved.
function ManagerScopeGate() {
  const { data: needsSetup } = useQuery({
    queryKey: MANAGER_SCOPE_GATE_QUERY_KEY,
    queryFn: fetchManagerNeedsScopeSetup,
    retry: false,
  });

  // Don't cover the Settings page — that's where they enter the SE emails.
  const onSettings = useRouterState({
    select: (s) => s.location.pathname === "/settings",
  });

  return <ManagerScopeSetupDialog open={Boolean(needsSetup) && !onSettings} />;
}

// DEV_MODE only: blocks the app behind a first-use email capture dialog until
// a real email has been provided (see needsEmailSetup in middleware/auth.js).
function EmailSetupGate() {
  const queryClient = useQueryClient();
  const [devMode, setDevMode] = useState(false);
  const [needsEmailSetup, setNeedsEmailSetup] = useState(false);

  const refreshMe = () => {
    fetch("/api/health", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((health) => {
        if (!health?.devMode) {
          setDevMode(false);
          setNeedsEmailSetup(false);
          return;
        }
        setDevMode(true);
        return fetch("/api/me", { credentials: "include" })
          .then((res) => (res.ok ? res.json() : null))
          .then((me) => setNeedsEmailSetup(Boolean(me?.needsEmailSetup)));
      })
      .catch(() => {
        setDevMode(false);
        setNeedsEmailSetup(false);
      });
  };

  useEffect(() => {
    refreshMe();
  }, []);

  const handleSave = async (email: string) => {
    const response = await fetch("/api/dev/session-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.details || data?.error || "Failed to connect to Snowflake");
    }

    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    refreshMe();
  };

  if (!devMode) return null;

  return <EmailCaptureDialog open={needsEmailSetup} onSave={handleSave} />;
}
